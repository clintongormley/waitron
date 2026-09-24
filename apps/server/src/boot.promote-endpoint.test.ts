import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  locations,
  nodes,
  openVenueDatabase,
  readStandardSeriesId,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  tenants,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import type {
  Endorsement,
  MembershipDocumentBody,
  SignedMembershipDocument,
} from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";

// Slice 2 Task 7 boot integration: the promote endpoint (`POST /management-api/promote`) is mounted on
// BOTH deployment modes before the SPA catch-alls, and its path is exempt from the read-only gate — so a
// mirror AND a fenced node reach the handler. Three real boots prove it end to end:
//  - a MIRROR: a credential-less POST reaches the credential screen (401), NOT a gated 403 or a 404 —
//    proof the endpoint is mounted on a mirror and the read-only gate lets the promote POST through;
//  - an unfenced PRIMARY: an admin login promotes and gets the idempotent `{alreadyPrimary,restarting}`;
//  - a FENCED node: the gate IS mounted, yet the exempt POST reaches the handler, which returns the
//    precise `promotion.node_fenced` (409), not a lying already-primary nor a generic gate 403.
//
// ## Two things to know about this file
//
// **There is no ROLE SPLIT on this engine.** Every statement below, and every statement each booted
// server issues, runs on the one handle `openVenueStore` hands out, so nothing here separates
// what the gate refuses from what a grant refuses.
//
// **The suite keeps a handle open on each venue directory while a server holds one.** Write-ahead
// mode admits a second connection and both opens set `busy_timeout`
// (`packages/store/src/index.ts:128-136`); every seeding write below happens while no server is
// running, so the two handles never want the write lock at the same moment.

// `undici`'s `fetch` is mocked to REJECT so no background pull/tunnel dial reaches a real host; Node's
// own global `fetch` (a distinct module identity — see boot.promote.test.ts) still serves the probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in boot.promote-endpoint.test.ts")),
    ),
  };
});

// Filesystem paths stay under this suite's temporary root. The modules.json selects Veri*Factu (disabling
// `fiscal-none`) so a trading/mirror boot does not refuse `module.fiscal_slot_ambiguous`.
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-endpoint-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);

const CREDENTIALS_KEY = Buffer.alloc(32, 5).toString("base64");
const KEY_ENV = {
  // Task 3: keep the plain-HTTP landing listener (default port 80) OUT of every boot test — 80 is
  // privileged, and a root CI container would otherwise stand up a live service on it. Its own
  // behaviour is proven directly in landing-listener.test.ts.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
};

// Short ticks so the boot loop's first (empty) pass lands inside the poll budget without a long idle
// sleep. No fiscal work is seeded, so no drain ever dials AEAT.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// The box key ring, built from the SAME credentials key boot loads — so the identity this suite seals is
// the one a promote unseals to sign its minted membership document.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The non-mirror (primary/fenced) till identity — the four WAITRON_TILL_*_ID that put boot into TRADING
// mode. The NODE id is the one the fence read (`isFenced(held, config.till.nodeId)`) looks up.
const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// The admin the promote endpoint authenticates for the primary/fenced cases. Role `admin` is the only
// role that holds `node.promote` (permissions.test.ts), and a `password_hash` lets `loginManagerById`
// verify a supplied password (the admin-login path the endpoint takes, mirror-bundle-api shape).
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_PW = "correct-horse-battery-staple";

// The mirror's OWN venue ids, distinct from TILL_ENV so the two directories' seeds never collide.
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MIRROR_NUMERO_INSTALACION = 7;

let migrationsRoot: string;
// Separate venue directories: the non-mirror deployment stamps (primary/fenced) must never leak into
// the mirror directory's (mirror, primary) flip, and vice versa.
let appVenueDir: string;
let mirrorVenueDir: string;
let appDb: Database;
let mirrorDb: Database;
const openStores: VenueDatabase[] = [];

/** A held membership document naming THIS node with `standing`. The fence read is UNVERIFIED
 * (`readNodeMembership` returns the blob whole), so the placeholder signature is fine — written directly
 * through the plain-upsert setter, as an owner/promote path persists an already-verified document. */
function selfDoc(standing: "sell-only" | "serving-primary"): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: 5,
    nodes: [{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }],
  };
  return {
    body,
    signerNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

/** Seed the non-mirror till's tenant + location + node + node identity (so boot's `readOrderFlow` /
 * `readVenueLocale` reads resolve and a promote has a key to sign with) plus the admin the endpoint
 * authenticates. `pin_hash` is NOT NULL, so a value is supplied even though the endpoint uses the
 * password. */
async function seedTillIdentity(db: Database): Promise<void> {
  // Every row goes in through its TABLE DEFINITION, the same change `packages/db/src/testing/seed.ts`
  // and `testing/fiscal-fixtures.ts` took. Two reasons: a raw insert reaches no `$defaultFn`
  // generator, and `created_at` on `tenants`, `nodes` and `persons` is one of those on this engine;
  // and `array['en']::text[]` is a PostgreSQL array constructor plus a PostgreSQL cast operator,
  // both refused at prepare here. `on conflict do nothing` stays UNTARGETED, as the statements it
  // replaces were — narrowing it would be a behaviour change this conversion is not making.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90111111H", legalName: "Promote Endpoint Till SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Promote Endpoint node",
    })
    .onConflictDoNothing();
  await db
    .insert(persons)
    .values({
      id: ADMIN_ID,
      displayName: "Promote Admin",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(ADMIN_PW),
      role: "admin",
    })
    .onConflictDoNothing();
  await establishNodeIdentity({ ownerDb: db, ring: RING }, TILL_ENV.WAITRON_TILL_NODE_ID);
}

/** Seed a fresh venue directory as a read-only mirror holding its OWN dormant identity (R2/R3a) — the shape
 * boot.promote.test.ts's mirror suite uses: tenant + location, a reserved standby identity, a held
 * term-3 chart, the DB-stored mirror connection config + sealed sync token the mirror boot reads, and
 * deployment stamped production then mode='mirror'. */
async function seedMirrorIdentity(db: Database): Promise<{ nodeId: string }> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote Endpoint Cloud SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: MIRROR_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  const t = await db.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = 1`);
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: db, ring: RING },
    {
      locationId: MIRROR_LOCATION_ID,
      standby,
      nodeName: "cloud",
      filingModule: "verifactu",
      taxModule: "vat",
      modules: ALL_MODULES,
      reserved: {
        modules: {
          "fiscal-verifactu": {
            nif,
            idSistemaInformatico: "W1",
            numeroInstalacion: MIRROR_NUMERO_INSTALACION,
          },
        },
        series: [{ code: "FA-7", purpose: "standard" }],
        endorsement,
      },
    },
  );

  const held: SignedMembershipDocument = {
    body: {
      term: 3,
      nodes: [
        { nodeId: MIRROR_ORIGIN_NODE_ID, contactUrl: "https://old", standing: "serving-primary" },
        { nodeId: standby.nodeId, contactUrl: "", standing: "serving-secondary" },
      ],
    },
    signerNodeId: MIRROR_ORIGIN_NODE_ID,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
  await writeNodeMembership(db, held);

  await writeMirrorConfig(db, standby.nodeId, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  await stampDeployment(db, "production");
  await setDeploymentMode(db, standby.nodeId, "mirror");
  // Prove the reserved series exists (the value a real promote would correct trading.env to) — not
  // asserted here (the mirror case never reaches the promote), but a cheap invariant on the seed.
  await readStandardSeriesId(db, standby.nodeId);
  return { nodeId: standby.nodeId };
}

/**
 * A fresh venue directory migrated through the manifest, plus a handle on it the suite keeps.
 *
 * The migration run is this suite's, not boot's, because the identity rows have to exist before boot
 * reads them; boot's own `applyMigrations` over the same directory then finds nothing to do.
 */
async function migratedVenue(): Promise<[string, Database]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue];
}

beforeAll(async () => {
  // The migrations root. Boot's from-source default (`DEFAULT_MIGRATIONS_ROOT`, `boot.ts`) resolves to
  // `apps/server/src/drizzle`, which does not exist, so each set's real folder is copied into one
  // directory and `WAITRON_MIGRATIONS_DIR` points `applyMigrations` at that journal content.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  [appVenueDir, appDb] = await migratedVenue();
  [mirrorVenueDir, mirrorDb] = await migratedVenue();
  await seedTillIdentity(appDb);
  // Stamp production (matching WAITRON_ENV so the boot guard passes). No `node_roles` row is
  // written, so `readDeploymentAxes`'s missing-row fallback reads (mode=primary,
  // singleton_role=primary), the primary starting point.
  await stampDeployment(appDb, "production");
}, 180_000);

afterAll(async () => {
  // `pop()` returns `VenueDatabase | undefined`, so the `?.` is a real guard rather than a decorative
  // one, and the array is left empty. Guard: `scripts/guarded-teardowns.test.ts`, which reads a
  // teardown hook as TEXT.
  while (openStores.length > 0) await openStores.pop()?.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  for (const directory of [appVenueDir, mirrorVenueDir]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (WAITRON_HTTP_PORT rejects "0"). */
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

/** Polls `predicate` up to ~10s for its first defined value, THROWING on timeout rather than
 * returning `undefined`, so a call site can never silently proceed on an unmet condition: every call
 * here discards the value and uses this as a barrier — wait until boot's health check has passed — so
 * a silent timeout would aim the request below at a server that had not finished booting, and the
 * failure would surface somewhere other than the unmet condition. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~10s");
}

/** POST the promote endpoint with a JSON body. */
async function postPromote(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("boot promote endpoint: mounted on both modes, exempt from the read-only gate", () => {
  it("a MIRROR serves the endpoint: a credential-less POST reaches the handler (401), not a gated 403 or 404", async () => {
    const seed = await seedMirrorIdentity(mirrorDb);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-mirror-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
      // The NODE id is the cloud's OWN reserved id (R3a); the series is the primary's INERT designated one.
      WAITRON_TILL_NODE_ID: seed.nodeId,
      WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
      WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
      WAITRON_VENUE_DIR: mirrorVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // No credential → the handler's credential screen throws `password.invalid` (401). A 401 (not the
      // gate's 403 and not a 404) is the proof the endpoint is MOUNTED on a mirror and the read-only gate
      // EXEMPTS the promote POST — a request that reached the real handler, not one the gate turned back.
      const res = await postPromote(base, { oldNodeNeutralised: true });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("password.invalid");

      // Control on the SAME boot: an ordinary write POST is still refused by the read-only gate (403
      // node.read_only) — so the 401 above is the exemption's doing, not a disabled gate.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("an unfenced PRIMARY serves the endpoint and returns alreadyPrimary with a valid admin login", async () => {
    // A fresh unfenced primary: singleton_role primary and a held self-doc that keeps it serving.
    await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "primary");
    await writeNodeMembership(appDb, selfDoc("serving-primary"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootTrading(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      const res = await postPromote(base, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(200);
      // The non-mirror `promoteRun`: an unfenced node is already-primary and never restarts.
      expect(await res.json()).toEqual({ alreadyPrimary: true, restarting: false });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a FENCED node returns promotion.node_fenced (409), not a lying alreadyPrimary or a 403/404", async () => {
    // A returned ex-primary whose held document marks it sell-only — boot reconciles the singleton axis
    // to 'secondary' and mounts the read-only gate.
    await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "primary");
    await writeNodeMembership(appDb, selfDoc("sell-only"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootTrading(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Control: the read-only gate IS mounted on this fenced node (an ordinary write POST is 403).
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // Yet the exempt promote POST reaches the handler: the admin authenticates, then `promoteRun`
      // reads the held (sell-only) document and `assertNotFenced` throws — mapped to 409, the precise
      // node_fenced code, NOT a gate 403, a 404, or a lying already-primary.
      const res = await postPromote(base, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("promotion.node_fenced");
    } finally {
      await server.close();
    }
  }, 60_000);
});

/** Boot a non-mirror trading server against the shared venue directory. */
async function bootTrading(port: number) {
  return startServer({
    ...KEY_ENV,
    ...TICK_ENV,
    ...TILL_ENV,
    WAITRON_VENUE_DIR: appVenueDir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
  });
}
