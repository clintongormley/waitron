import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { setDeploymentMode, stampDeployment, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { enrolPeer } from "@waitron/sync";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { roleUrl } from "./testing/postgres.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// C2a — the cloud "mirror-mode server" (Task 5). Real Postgres, not PGlite: the mirror serves its
// dashboard through the ambient viewer session, which writes `persons` / `management_sessions` under
// FORCE RLS as the NON-superuser `app_user` (a PGlite superuser bypasses FORCE RLS → a false pass,
// CLAUDE.md §4). TWO manifest clones so the guard is proven in BOTH directions in one suite (§1): a
// `mirror`-stamped database (does NOT mount the sync source, refuses writes) and a `primary`-stamped
// one of the SAME identity (DOES mount it) — the control that the mirror's absence is not vacuous.
//
// `DATABASE_URL` is `app_login` (an app_user member) exactly as a real mirror pool is: the ambient
// session's `ensureMirrorViewer` / `mirrorSession` rely on the CONNECTION's role for RLS, so they
// must run on the app-role pool, never a superuser one (Task 3 carry-over note). Migrations run over
// the SUPERUSER uri (`WAITRON_MIGRATIONS_DATABASE_URL`) — the clone is already manifest-migrated, so
// this is an idempotent re-run the app role could not do (it lacks CREATE — boot.test.ts's PROBE_ROLE
// note). The pull worker is pointed at an UNREACHABLE relay, so it backs off and the box still serves.

const mirror = useTemplateDb({ template: "manifest" });
const primary = useTemplateDb({ template: "manifest" });

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode. Distinct
// per field. Seeded on BOTH clones in `beforeAll` (tenant/location/node/till/series) so a successful
// boot's `readOrderFlow` / `readVenueLocale` reads resolve and the sync source (on the primary) names
// this node.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// The credentials key the trading branch's `loadKeyRing` requires (a mirror is still a trading boot,
// so the ring is loaded before the mode is read — it just files nothing). Plus a media dir under
// this suite's own temp root so the boot's `mkdirSync(mediaDir)` never writes into `apps/server/src`.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-mirror-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

// One unreachable "peer" for both boots — its `url` is the RELAY on a mirror (dialed via the tunnel
// http client) and a direct peer on the primary. Port 1 never listens, so every pull handshake fails
// and the worker backs off (the same unreachable-endpoint shape boot.test.ts's sync test uses); the
// box still binds and serves. The token is irrelevant here (no pull completes).
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);

let migrationsRoot: string;
let caFile: string;
let mirrorDatabaseUrl: string;
let mirrorSyncDatabaseUrl: string;
let primaryDatabaseUrl: string;
let primarySyncDatabaseUrl: string;
// A peer enrolled on the PRIMARY clone (enrolPeer runs as the superuser admin — setup bypasses
// grants). The control's /sync-api/hello probe presents this token, which the source resolves against
// `sync_peers` through the sync_applier pool.
let primaryPeerToken: string;

/** Seed the FK identity (tenant, location, node, till, series) with the WAITRON_TILL_*_ID on one
 * clone, as the container superuser (RLS bypassed). None of these tables is sync-enrolled, so this
 * captures no sync_log rows. Mirrors sync-e2e.rls.test.ts's `seedParents`. */
async function seedIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90222222J', 'Mirror SL') on conflict do nothing`);
  await admin.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Loc',
            array['en']::text[], 'Hospitality') on conflict do nothing`);
  await admin.execute(sql`insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Node') on conflict do nothing`);
  await admin.execute(sql`insert into tills (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_TILL_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Till') on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${TILL_ENV.WAITRON_TILL_SERIES_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_NODE_ID}, 'A') on conflict do nothing`);
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.test.ts does: boot's from-source default
  // (`apps/server/src/drizzle`) does not exist, so `WAITRON_MIGRATIONS_DIR` must point applyMigrations
  // at the real journal content copied out per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-mirror-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // A throwaway box CA for `WAITRON_MIRROR_BOX_CA_FILE` — a real PEM `loadMirrorConfig` can read and
  // `tunnelHttpClient` hands undici. It is never used for a real handshake here (the relay is
  // unreachable), but a genuine CA keeps the wiring faithful.
  const caDir = await mkdtemp(join(tmpdir(), "waitron-mirror-ca-"));
  caFile = join(caDir, "box-ca.crt");
  await writeFile(
    caFile,
    mintSelfSignedServerCert({ hostnames: ["mirror-box.local"], ipAddresses: [], now: new Date() })
      .caCertPem,
  );

  await seedIdentity(mirror.admin);
  await seedIdentity(primary.admin);
  // Stamp both preproduction (matching WAITRON_ENV so the deployment guard passes), then flip only the
  // mirror clone's mode. setDeploymentMode is an OWNER write (app_user holds no UPDATE on deployment),
  // so it runs on the superuser admin. The primary clone keeps the column default ('primary').
  await stampDeployment(mirror.admin, "preproduction");
  await setDeploymentMode(mirror.admin, "mirror");
  await stampDeployment(primary.admin, "preproduction");

  primaryPeerToken = (await enrolPeer(primary.admin, { subscriberId: "mirror-ctl", name: "ctl" }))
    .token;

  mirrorDatabaseUrl = roleUrl(mirror.pg.uri, "app_login", "app_pw");
  mirrorSyncDatabaseUrl = roleUrl(mirror.pg.uri, "sync_applier", "ap");
  primaryDatabaseUrl = roleUrl(primary.pg.uri, "app_login", "app_pw");
  primarySyncDatabaseUrl = roleUrl(primary.pg.uri, "sync_applier", "ap");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (caFile !== undefined) await rm(join(caFile, ".."), { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (boot.test.ts's helper — WAITRON_HTTP_PORT rejects
 * "0", so the host cannot bind an ephemeral port itself). */
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

/** Poll `predicate` up to ~10s for its first defined value (boot.test.ts's shape). */
async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

describe("mirror-mode boot (real Postgres, deployment.mode = 'mirror')", () => {
  it("serves a dashboard read via the ambient viewer, refuses writes, and does not mount the sync source", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: mirrorDatabaseUrl,
      WAITRON_MIGRATIONS_DATABASE_URL: mirror.pg.uri,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_SYNC_PEERS: SYNC_PEERS,
      WAITRON_SYNC_DATABASE_URL: mirrorSyncDatabaseUrl,
      // A mirror REQUIRES its box CA + hostname (loadMirrorConfig); the pull worker dials through the
      // tunnel http client built from them.
      WAITRON_MIRROR_BOX_CA_FILE: caFile,
      WAITRON_MIRROR_BOX_HOSTNAME: "mirror-box.local",
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      // A browser's first hit (with no cookie) is served by a GET, and the ambient-session middleware
      // hands back the viewer's session cookie on that RESPONSE — Hono's setCookie writes a response
      // header, NOT something the same request's gate can read (verified). This is the SPA page load
      // priming the cookie before the browser's first XHR.
      const primer = await fetch(`${base}/management-api/catalogues`);
      expect(primer.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;

      // The browser's next request carries only that ambient cookie — no user login — and the gated
      // read resolves through the admin viewer, returning the (empty) catalogue list. A 401 here would
      // mean the ambient session did not resolve; a 404 would mean the route never mounted.
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual([]);

      // A write is refused by the read-only gate BEFORE the route (so even a cookieless POST 403s, and
      // even a would-be-authorised one never reaches the DB). The gate returns the error-boundary shape.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The mirror is a SUBSCRIBER, not a source: mountSyncApi is skipped, so the peer-authenticated
      // source route is NOT mounted (404) even with a Bearer token. The primary control below proves
      // this route DOES exist on a non-mirror boot of the same identity — the guard is not vacuous.
      const source = await fetch(`${base}/sync-api/hello`);
      expect(source.status).toBe(404);

      // The mirror's health-only pass ran: recordPass advanced lastPassAt (its "work" is the pull
      // worker, not fiscal duties). Proves the isMirror pass arrow executed.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
    // The listener is genuinely gone after close() (workers + pools torn down).
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("primary boot of the same identity DOES mount the sync source (control: the mirror's absence is real)", async () => {
    // The other direction (CLAUDE.md §1): the SAME identity, stamped 'primary' (mode column default),
    // mounts the peer-authenticated source group. This is the prove-by-deletion control — flip
    // boot.ts's `isMirror` off and the mirror test's `/sync-api/hello 404` above becomes a 200 like
    // this one; keep it and the two disagree, which is the whole point.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: primaryDatabaseUrl,
      WAITRON_MIGRATIONS_DATABASE_URL: primary.pg.uri,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_SYNC_PEERS: SYNC_PEERS,
      WAITRON_SYNC_DATABASE_URL: primarySyncDatabaseUrl,
      // No WAITRON_MIRROR_* — a primary sets neither (loadMirrorConfig returns undefined).
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      const source = await fetch(`${base}/sync-api/hello`, {
        headers: { Authorization: `Bearer ${primaryPeerToken}` },
      });
      expect(source.status).toBe(200);
      expect(await source.json()).toEqual({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        environment: "preproduction",
      });
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("refuses a mirror boot that is missing its box CA + hostname (a mirror REQUIRES its link config)", async () => {
    // A mirror's whole job is to pull through the tunnel, which needs the box CA + hostname; a
    // deployment stamped 'mirror' with neither set is a misconfiguration, refused LOUDLY at boot
    // (server.config_invalid) rather than serving a box that can never reach its primary. Proven on
    // the mirror clone with no WAITRON_MIRROR_* set. The throw closes `db` before propagating (no leak
    // — Task 5 carry-over note); the line coverage on that `await db.close()` is what proves it ran.
    let caught: unknown;
    try {
      await startServer({
        ...KEY_ENV,
        DATABASE_URL: mirrorDatabaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: mirror.pg.uri,
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        // No WAITRON_MIRROR_BOX_CA_FILE / _HOSTNAME, and no sync peers — the mirror-required guard
        // fires before the sync block is even entered.
      });
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect(isAppError(caught) && caught.code).toBe("server.config_invalid");
    expect(isAppError(caught) && caught.params).toEqual({
      variable: "WAITRON_MIRROR_BOX_CA_FILE",
      reason: "mirror_requires_box_ca_and_hostname",
    });
  }, 60_000);

  it("fails the boot loudly when WAITRON_MIRROR_BOX_CA_FILE names a file that does not exist", async () => {
    // loadMirrorConfig reads the CA file INSIDE the loader (the house convention), so a bad path is a
    // raw ENOENT, not an AppError. boot wraps that read in the same db-cleanup guard the loadKeyRing
    // load uses, so the throw closes the pool before propagating rather than leaking it. Reached on the
    // mirror clone with a non-existent CA path (the hostname IS set, so loadMirrorConfig gets past its
    // both-or-neither checks to the readFileSync). The externally-observable half — the boot rejects —
    // is what this pins; the line coverage on the catch body proves the `await db.close()` ran.
    await expect(
      startServer({
        ...KEY_ENV,
        DATABASE_URL: mirrorDatabaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: mirror.pg.uri,
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_MIRROR_BOX_CA_FILE: join(migrationsRoot, "does-not-exist-box-ca.crt"),
        WAITRON_MIRROR_BOX_HOSTNAME: "mirror-box.local",
      }),
    ).rejects.toThrow(/ENOENT/);
  }, 60_000);
});
