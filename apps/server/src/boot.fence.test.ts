import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readDeploymentAxes,
  setSingletonRole,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import type { SignedMembershipDocument } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { roleUrl } from "./testing/postgres.js";

// Membership rejoin R1 (design §6) boot integration: a returned ex-primary whose held membership
// document marks it sell-only/evicted must come up FENCED — its saved singleton axis reconciled DOWN to
// 'secondary' (so the existing isSingletonPrimary gates suppress the submitter/reconciler/config-writer
// AND the authoritative sync source) and its whole write surface behind the read-only gate. Real
// Postgres is mandatory (CLAUDE.md §4): the demote is an OWNER-role write on `deployment` (app_user
// holds no UPDATE), and the singleton-source mount is served through the non-superuser `app_login`
// pool — both false passes on PGlite (every PGlite connection is a superuser).

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode. The NODE id
// is the one the fence read (`isFenced(held, config.till.nodeId)`) looks up in the held chart.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A media dir under this suite's own temp root so boot's `mkdirSync(mediaDir)` never writes into
// `apps/server/src`. Created synchronously so `KEY_ENV` can reference it; torn down in `afterAll`.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-fence-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
  ...TILL_ENV,
};

// Short ticks so the boot loop's first (empty) pass lands inside the poll budget without a long idle
// sleep. No fiscal work is seeded, so no drain ever dials AEAT.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// A dead loopback sync peer so `loadSyncConfig` turns sync ON (sync is enabled iff WAITRON_SYNC_PEERS is
// a non-empty array — config.ts) and `mountSyncApi` is reached: the singleton SOURCE the fence must
// suppress. The pull worker dials this dead port in the background and backs off; it never blocks boot.
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);

// A clone of the full-manifest template — this suite's own database (each `useTemplateDb` call clones
// afresh), so the deployment stamp + singleton_role flips it performs are isolated to this file.
const suite = useTemplateDb({ template: "manifest" });

// The box key ring `establishNodeIdentity` seals under, built from the SAME credentials key boot loads.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

let migrationsRoot: string;
let appDatabaseUrl: string;
let syncDatabaseUrl: string;

/** Seed the boot till's tenant + location + node (so boot's `readOrderFlow` / `readVenueLocale` reads
 * resolve) plus a node identity, mirroring boot.promote.test.ts's `seedTillIdentity`. */
async function seedTillIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90111111H', 'Fence Till SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Barra',
            array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Fence node')
    on conflict do nothing`);
  await establishNodeIdentity(
    { ownerDb: admin, ring: RING },
    TILL_ENV.WAITRON_TILL_TENANT_ID,
    TILL_ENV.WAITRON_TILL_NODE_ID,
  );
}

/** A held membership document (design §3/§5) naming THIS node with `standing`. The fence read is
 * UNVERIFIED (`readNodeMembership` returns the blob whole), so the placeholder signature is fine — we
 * write it directly through the plain-upsert setter, exactly as an owner/promote path would persist an
 * already-verified document. */
function selfDoc(standing: "sell-only" | "serving-primary"): SignedMembershipDocument {
  return {
    body: {
      term: 5,
      nodes: [{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }],
    },
    signerNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.promote.test.ts does: boot's from-source default does
  // not exist under source, so `WAITRON_MIGRATIONS_DIR` must point `applyMigrations` at the real
  // journal content per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-fence-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  await seedTillIdentity(suite.admin);
  // Stamp production (matching WAITRON_ENV so the boot guard passes); singleton_role keeps its column
  // default 'primary' (migration 0071) — so this clone is a PRIMARY, the state a returned ex-primary is
  // in before its held fence is reconciled.
  await stampDeployment(suite.admin, "production");

  appDatabaseUrl = roleUrl(suite.pg.uri, "app_login", "app_pw");
  syncDatabaseUrl = roleUrl(suite.pg.uri, "sync_applier", "ap");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (boot.promote.test.ts's helper — WAITRON_HTTP_PORT
 * rejects "0", so the host cannot bind an ephemeral port itself). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Boot a trading server against this clone with sync enabled (a dead peer), the shared env for both
 * cases. */
async function bootFenceServer(port: number) {
  return startServer({
    ...KEY_ENV,
    ...TICK_ENV,
    DATABASE_URL: appDatabaseUrl,
    // Superuser: boot's fenced demote opens a short-lived owner pool from this URL for the
    // `setSingletonRole` write (app_user holds no UPDATE on `deployment`), and boot re-runs the
    // (idempotent) migrations over it too.
    WAITRON_MIGRATIONS_DATABASE_URL: suite.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_PEERS: SYNC_PEERS,
    WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
  });
}

describe("boot fence (real Postgres): a held sell-only membership doc fences a returned primary", () => {
  it("Case A: a held sell-only self-doc demotes the singleton axis, gates writes, and unmounts the source", async () => {
    // A fresh primary starting point (a prior test may have demoted the shared clone).
    await setSingletonRole(suite.admin, "primary");
    // The held document marks THIS node sell-only — the fence.
    await writeNodeMembership(suite.admin, selfDoc("sell-only"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Reconciled: boot demoted the singleton axis DOWN to 'secondary' (mode stays 'primary' — the
      // (primary, secondary) pair is valid, deployment_role_valid_ck).
      const axes = await readDeploymentAxes(suite.admin);
      expect(axes).toEqual({ mode: "primary", singletonRole: "secondary" });

      // A write verb is refused by the read-only gate BEFORE the route (a cookieless POST 403s), the
      // error-boundary shape.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The authoritative sync SOURCE is NOT mounted: mountSyncApi gates on isSingletonPrimary, now
      // false, so the singleton workers are suppressed by the reconciled axis. 404, not 401.
      const source = await fetch(`${base}/sync-api/log`);
      expect(source.status).toBe(404);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("Case B: a held serving-primary self-doc does NOT fence — primary stays open and sources", async () => {
    // A fresh primary starting point, then a held document that keeps this node SERVING — not fenced.
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Unfenced: the singleton axis stays 'primary' (no demote fired).
      const axes = await readDeploymentAxes(suite.admin);
      expect(axes).toEqual({ mode: "primary", singletonRole: "primary" });

      // Writes are open — the read-only gate is not mounted, so a POST reaches its OWN auth screen
      // (management-session cookie missing → 401), NOT the gate's 403.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).not.toBe(403);

      // The singleton sync SOURCE IS mounted (isSingletonPrimary true): a tokenless request reaches the
      // peer-auth screen (401 sync.node_unauthorized), NOT a 404 — the route exists. This is the control
      // proving Case A's 404 is the fence's doing, not a missing route.
      const source = await fetch(`${base}/sync-api/log`);
      expect(source.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 60_000);
});

/** Polls `predicate` up to ~10s for its first defined value — boot.promote.test.ts's shape. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}
