import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  readSingletonRole,
  setDeploymentMode,
  stampDeployment,
  writeMirrorConfig,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import { enrolPeer } from "@waitron/sync";
import { drain } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { runPass, DRAIN_DUTY } from "./pass.js";
import { singletonPass } from "./singleton-pass.js";
import { seedFiscalRegistro } from "./testing/fiscal-fixtures.js";
import { roleUrl } from "./testing/postgres.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { sealMirrorToken } from "./mirror-token.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// C2a mirror-mode server (Task 5), rewired for C2b (Task 10): the mirror now reads its connection to
// its primary (relay URL, box CA + hostname, per-peer token) from the DATABASE (`mirror_config`) + the
// vault (`sync.mirror_token`), NOT from env. Real Postgres, not PGlite: the mirror serves its dashboard
// through the ambient viewer session, which writes `persons` / `management_sessions` as the
// NON-superuser `app_user` — so the table GRANTS are enforced, where a PGlite superuser holds every
// privilege and a missing one would pass (CLAUDE.md §4). `readMirrorConfig`/`readMirrorToken` run as
// that same app role. THREE manifest clones: a
// `mirror`-stamped database seeded with its DB connection config (does NOT mount the sync source,
// refuses writes), a `primary`-stamped one of the SAME identity (DOES mount it) — the control that the
// mirror's absence is not vacuous — and a `noConfig` mirror-stamped one with NO `mirror_config` row (the
// fail-closed control).
//
// `DATABASE_URL` is `app_login` (an app_user member) exactly as a real mirror pool is: the ambient
// session's `ensureMirrorViewer` / `mirrorSession` write through the CONNECTION's role, so they
// must run on the app-role pool, never a superuser one (Task 3 carry-over note). Migrations run over
// the SUPERUSER uri (`WAITRON_MIGRATIONS_DATABASE_URL`) — the clone is already manifest-migrated, so
// this is an idempotent re-run the app role could not do (it lacks CREATE — boot.test.ts's PROBE_ROLE
// note). The pull worker is pointed at an UNREACHABLE relay, so it backs off and the box still serves.

const mirror = useTemplateDb({ template: "manifest" });
const primary = useTemplateDb({ template: "manifest" });
// A third mirror-stamped clone that is NEVER seeded with a `mirror_config` row — the fail-closed
// control: a box stamped `deployment.mode='mirror'` with no DB connection config must refuse to boot
// (server.config_invalid), never serve a mirror that can never reach its primary.
const noConfig = useTemplateDb({ template: "manifest" });

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

// One unreachable "peer" for the PRIMARY control's WAITRON_SYNC_PEERS. Port 1 never listens, so every
// pull handshake fails and the worker backs off (the same unreachable-endpoint shape boot.test.ts's
// sync test uses); the box still binds and serves. The token is irrelevant here (no pull completes).
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);

// The mirror's DB-stored connection config (C2b, spec §7) — written into `mirror_config` (owner-role)
// on the `mirror` clone, replacing C2a's WAITRON_MIRROR_BOX_* + WAITRON_SYNC_PEERS env. The relay is
// the same unreachable port-1 endpoint (the pull worker dials it through the tunnel http client and
// backs off), so the box still binds and serves; the token seals into the vault under `sync.mirror_token`.
const MIRROR_RELAY_URL = "http://127.0.0.1:1/";
const MIRROR_BOX_HOSTNAME = "mirror-box.local";
const MIRROR_SYNC_TOKEN = "mirror-peer-token";
// The sync ORIGIN — the PRIMARY's node id, DISTINCT from this mirror's own `WAITRON_TILL_NODE_ID`
// (membership promotion R3a: the mirror runs under its own identity, and `mirror_config.origin_node_id`
// is the separate primary node whose rows it pulls). The relay is unreachable here so no pull completes;
// this only has to be a well-formed, distinct id to model the split faithfully.
const MIRROR_ORIGIN_NODE = "77777777-7777-4777-8777-777777777777";
// The vault key ring the boot's `loadKeyRing(env)` builds from KEY_ENV — used here to SEAL the sync
// token the same way `adoptFromPrimary` would, so the boot's `readMirrorToken` (app_user) unseals it.
const RING = loadKeyRing(KEY_ENV);
// A real box CA PEM for `mirror_config.box_ca_pem` — `tunnelHttpClient` hands it to undici. Never used
// for a real handshake here (the relay is unreachable), but a genuine PEM keeps the wiring faithful.
const BOX_CA_PEM = mintSelfSignedServerCert({
  hostnames: [MIRROR_BOX_HOSTNAME],
  ipAddresses: [],
  now: new Date(),
}).caCertPem;

let migrationsRoot: string;
let mirrorDatabaseUrl: string;
let mirrorSyncDatabaseUrl: string;
let noConfigDatabaseUrl: string;
let noConfigSyncDatabaseUrl: string;
let primaryDatabaseUrl: string;
let primarySyncDatabaseUrl: string;
// The retention (sync_pruner, an app_user member) URL for the primary — the connection the
// retention sweep opens and the C2b mirror-bundle endpoint reuses to mint peer tokens. Set on the
// primary control boot so that endpoint mounts there (the mirror never opens one, so it never
// mounts — the primary-only proof).
let primaryRetentionDatabaseUrl: string;
// A peer enrolled on the PRIMARY clone (enrolPeer runs as the superuser admin — setup bypasses
// grants). The control's /sync-api/hello probe presents this token, which the source resolves against
// `sync_peers` through the sync_applier pool.
let primaryPeerToken: string;

/**
 * Seed the FK identity (tenant, location, node, till, series) with the WAITRON_TILL_*_ID on one
 * clone, as the container superuser. None of these tables is sync-enrolled, so this captures no
 * sync_log rows. Mirrors sync-e2e.test.ts's `seedParents`.
 */
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

  await seedIdentity(mirror.admin);
  await seedIdentity(primary.admin);
  await seedIdentity(noConfig.admin);
  // Stamp all three preproduction (matching WAITRON_ENV so the deployment guard passes), then flip the
  // two mirror clones' mode. setDeploymentMode is an OWNER write (app_user holds no UPDATE on
  // deployment), so it runs on the superuser admin. The primary clone keeps the column default
  // ('primary').
  await stampDeployment(mirror.admin, "preproduction");
  await setDeploymentMode(mirror.admin, "mirror");
  await stampDeployment(primary.admin, "preproduction");
  await stampDeployment(noConfig.admin, "preproduction");
  await setDeploymentMode(noConfig.admin, "mirror");

  // The `mirror` clone's DB-stored connection config + sealed sync token (C2b), written owner-role
  // exactly as `adoptFromPrimary` would — this is what the boot's `readMirrorConfig` / `readMirrorToken`
  // (app_user) read INSTEAD of the retired env. The `noConfig` clone deliberately gets NEITHER (the
  // fail-closed control).
  await writeMirrorConfig(mirror.admin, {
    relayUrl: MIRROR_RELAY_URL,
    boxHostname: MIRROR_BOX_HOSTNAME,
    boxCaPem: BOX_CA_PEM,
    originNodeId: MIRROR_ORIGIN_NODE,
  });
  await sealMirrorToken(mirror.admin, RING, TILL_ENV.WAITRON_TILL_TENANT_ID, MIRROR_SYNC_TOKEN);

  primaryPeerToken = (await enrolPeer(primary.admin, { subscriberId: "mirror-ctl", name: "ctl" }))
    .token;

  mirrorDatabaseUrl = roleUrl(mirror.pg.uri, "app_login", "app_pw");
  mirrorSyncDatabaseUrl = roleUrl(mirror.pg.uri, "sync_applier", "ap");
  noConfigDatabaseUrl = roleUrl(noConfig.pg.uri, "app_login", "app_pw");
  noConfigSyncDatabaseUrl = roleUrl(noConfig.pg.uri, "sync_applier", "ap");
  primaryDatabaseUrl = roleUrl(primary.pg.uri, "app_login", "app_pw");
  primarySyncDatabaseUrl = roleUrl(primary.pg.uri, "sync_applier", "ap");
  primaryRetentionDatabaseUrl = roleUrl(primary.pg.uri, "sync_pruner", "pp");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
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
      // No WAITRON_SYNC_PEERS and no WAITRON_MIRROR_BOX_* (C2b retired both for the mirror): the relay
      // URL, box CA + hostname and the per-peer token are read from the DB (`mirror_config`, seeded in
      // beforeAll) and the vault (`sync.mirror_token`), and the pull worker dials through the tunnel
      // http client built from that DB config. Only the local sync pool stays in env.
      WAITRON_SYNC_DATABASE_URL: mirrorSyncDatabaseUrl,
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

      // The C2b mirror-bundle endpoint is PRIMARY-only (a mirror emits no bundle), so it is never
      // mounted here. A POST is caught by the read-only gate FIRST (node.read_only 403), which is
      // the observable guarantee that a mirror never serves a bundle — the primary control below
      // reaches its OWN auth screen (401) on the same request, the primary-only A/B (the mount
      // itself is gated on the mirror having no retention connection, which it never opens).
      const bundle = await fetch(`${base}/management-api/mirror-bundle`, {
        method: "POST",
        body: "{}",
      });
      expect(bundle.status).toBe(403);
      expect(await bundle.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The operational agent/device groups are NOT mounted on a mirror — boot.ts wraps both mounts in
      // its `if (!isMirror)` mount guard (boot.ts, Task 4). These are GETs, so the read-only gate would pass them
      // through; the guarantee that a mirror never runs their write-behind-a-GET (`GET /print-api/agent/
      // jobs` → claimPrintJobs, a locking UPDATE — read-only-gate.ts's own comment flags exactly this)
      // rests on the route being ABSENT (404), not on the verb. The primary control below reaches each
      // route's agent/device auth (NOT 404) — the A/B that these 404s are the guard, not a missing route.
      const printJobs = await fetch(`${base}/print-api/agent/jobs`);
      expect(printJobs.status).toBe(404);
      const deviceStation = await fetch(`${base}/api/device/station`);
      expect(deviceStation.status).toBe(404);

      // Till/KDS reads, unlike device/print above, ARE mounted on a mirror (`mountTillApi` is not
      // wrapped in boot.ts's `!isMirror` mount guard). The 401 below holds because a mirror refuses a
      // till session at the door: `POST /api/session` (till PIN login) is a write, the read-only gate
      // 403s every non-GET on a mirror, and `requireSession` — which every route calls FIRST — 401s
      // before `listHeldOrders` ever runs. Reads are venue-wide since till-reroute §3.6, so no
      // node-scope premise remains: a promoted node reads the venue's tabs whatever `node_id` they carry.
      const heldOrders = await fetch(`${base}/api/working-orders`);
      expect(heldOrders.status).toBe(401);
      expect(await heldOrders.json()).toEqual({ error: { code: "session.required", params: {} } });

      // Mirror ⇒ acceptingSales:false; the primary boot in "primary boot of the same identity DOES
      // mount the sync source" is the control on the same identity.
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({ acceptingSales: false });

      // The mirror's health-only pass ran: recordPass advanced lastPassAt (its "work" is the pull
      // worker, not fiscal duties). setDeploymentMode('mirror') co-set singleton_role='secondary'
      // above, so singletonPass (singleton-pass.ts) resolves this node as a non-singleton and runs
      // its trivial empty pass rather than drain/reconcile — that empty pass is what this proves ran.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
    // The listener is genuinely gone after close() (workers + pools torn down).
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("runs the trivial empty pass on a mirror — the fiscal drain (AEAT submission) is never invoked", async () => {
    // The first test proves the mirror's health-only pass RAN (`lastPassAt` advanced). This proves the
    // stronger fiscal claim: that empty pass SUBMITS NOTHING. A mirror holds replicated `pendiente`
    // `envios` (rows its primary generated) — if the singleton gate leaked, drain would pick them up,
    // decrypt a certificate and file them to AEAT under a chain this node does not own, an unrecoverable
    // fiscal error (CLAUDE.md §5). `startServer` builds the AEAT resolver internally from `mtlsFetch`
    // (boot.ts ~1917), so there is NO `resolveClient` seam to inject through the full boot; per the task
    // brief we DRIVE THE BOOT PASS PATH directly instead — the same `singletonPass(getRole, () =>
    // runPass({ drain, reconcile, … }))` wiring boot.ts assembles (boot.ts ~1908) — with a reject-if-
    // called `resolveClient` tripwire in place of the real transport (the pattern the fiscal suites use,
    // e.g. split-bill.fiscal.test.ts). If drain ever runs, the tripwire fires; on a mirror it must not.

    // A replicated pending envío this node must NOT submit (fresh FK closure + registro + a 'pendiente'
    // `envios` row). `entorno` matches this box's stamp so the row is genuinely due for the environment
    // the primary control below drains for — `resolveClient` is resolved BEFORE the entorno guard
    // regardless (drain.ts:226), so the tripwire fires on the tenant either way.
    const seeded = await seedFiscalRegistro(mirror.admin, {
      envio: true,
      cadena: true,
      entorno: "preproduction",
    });

    let resolveClientCalled = false;
    // The reject-if-called tripwire: drain resolves one of these per tenant with due work
    // (drain.ts:226). Reaching it at all on a mirror is the failure this gate catches.
    const tripwireResolveClient = (): Promise<never> => {
      resolveClientCalled = true;
      return Promise.reject(new Error("mirror must not contact AEAT"));
    };
    // Build the pass EXACTLY as boot.ts wires it: the singleton gate wrapping `runPass`, whose `drain`
    // is the real `@waitron/fiscal-verifactu` drainer with the tripwire transport, and a trivial
    // reconcile (the settlement duty is out of scope for this fiscal gate). `getRole` models boot.ts's
    // `() => holders.singletonRole.current` — an in-memory holder a promotion flips (boot.ts ~1901).
    const buildPass = (getRole: () => "primary" | "secondary") =>
      singletonPass(getRole, (at) =>
        runPass(
          {
            drain: (at2) =>
              drain(
                {
                  db: mirror.admin,
                  resolveClient: tripwireResolveClient,
                  skipRetryMs: 300_000,
                  environment: "preproduction",
                },
                at2,
              ),
            reconcile: () =>
              Promise.resolve({
                ran: [],
                deferred: 0,
                beyondHorizon: 0,
                skipped: [],
                nextDueAt: null,
              }),
            monotonicMs: () => performance.now(),
            log: () => {},
          },
          at,
        ),
      );

    // The mirror clone's REAL role, as `setDeploymentMode('mirror')` co-set it in beforeAll — this is a
    // genuine mirror, not a role invented for the test.
    const role = await readSingletonRole(mirror.admin);
    expect(role).toBe("secondary");

    // Drive the pass an hour ahead of wall-clock so the seeded envío is unambiguously DUE for the
    // primary control below (`envios_tenants_with_work` gates on `proximo_intento_en <= now`, whose
    // default is the CONTAINER's `now()` at insert — which can sit microseconds ahead of the host's
    // `new Date()`, leaving the row not-yet-due and the tripwire silent for a clock-skew reason). The
    // mirror direction ignores `now` (the gate short-circuits), so one instant serves both.
    const drainAt = new Date(Date.now() + 3_600_000);

    // The mirror pass: the singleton gate short-circuits to the trivial empty pass, so drain (and thus
    // the AEAT transport) is never invoked. No rejection surfaces; the report has no duties at all.
    const mirrorReport = await buildPass(() => role)(drainAt);
    expect(resolveClientCalled).toBe(false);
    expect(mirrorReport).toEqual({ nextDueAt: null, duties: [] });

    // Belt-and-braces: the replicated envío is untouched — still 'pendiente', no submission side effect.
    const afterMirror = await mirror.admin.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${seeded.registroId}`,
    );
    expect(afterMirror.rows[0]?.estado).toBe("pendiente");

    // Prove-by-deletion, baked in as the other-direction control (CLAUDE.md §1): the SAME wiring with
    // the node promoted to 'primary' DOES run the pass, drain reaches `resolveClient`, and the tripwire
    // FIRES — so the mirror's clean pass above is the singleton gate working, not a drainer that never
    // fires. (Documented RED confirmed in a scratch run before this control was added; see the report.)
    const primaryReport = await buildPass(() => "primary")(drainAt);
    expect(resolveClientCalled).toBe(true);
    // drain contains the tripwire rejection per-tenant (drain.ts:228 → `skipped`), so the pass still
    // completes with a drain duty entry rather than throwing — the drainer genuinely RAN on the primary.
    expect(primaryReport.duties.some((d) => d.duty === DRAIN_DUTY)).toBe(true);

    // The envío is STILL 'pendiente' even on the primary run: `resolveClient` throws before `drainTenant`
    // (drain.ts:226-227), so nothing was ever submitted — the tripwire proves reachability, not filing.
    const afterPrimary = await mirror.admin.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${seeded.registroId}`,
    );
    expect(afterPrimary.rows[0]?.estado).toBe("pendiente");
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
      // The retention sweep's own retention connection — the one the C2b mirror-bundle endpoint
      // reuses to mint peer tokens. Set here so that endpoint mounts on this primary (the mirror
      // never opens one, so it never mounts there — the primary-only proof, alongside the sync
      // source above).
      WAITRON_SYNC_RETENTION_DATABASE_URL: primaryRetentionDatabaseUrl,
      // No mirror connection config: a primary is not `isMirror`, so boot never reads `mirror_config`
      // / the vault token, and its peers come from WAITRON_SYNC_PEERS above (loadSyncConfig).
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
        membership: null, // no document adopted → the handshake carries a null membership (design §5)
        // Real boot computes the per-module applied versions from the migrated DB (SP-2b) and /hello
        // echoes them; the exact numbers drift with every migration, so assert the map is genuinely
        // populated (`core` a real number) rather than pinning drift-prone values — the content is
        // covered exactly in sync-api.test.ts.
        moduleVersions: expect.objectContaining({ core: expect.any(Number) }),
      });

      // The C2b mirror-bundle endpoint IS mounted on this primary (it holds a retention
      // connection): a body-less POST is screened as password.invalid (401) BEFORE any DB work —
      // proof the route registered. On the mirror boot above the same request is a 403 (read-only
      // gate), never a 401: the mirror never serves this route, the primary does (the
      // primary-only A/B, CLAUDE.md §1).
      const bundle = await fetch(`${base}/management-api/mirror-bundle`, { method: "POST" });
      expect(bundle.status).toBe(401);
      expect((await bundle.json()).error.code).toBe("password.invalid");

      // The operational agent/device groups DO mount on a primary (Task 4 control, CLAUDE.md §1's
      // other direction): each GET reaches its own agent/device auth (401 — a missing Bearer / device
      // cookie), never a 404. This is what makes the mirror's 404s above the guard rather than a route
      // that never existed. Flip boot.ts's `if (!isMirror)` off and the mirror 404s become 401s like
      // these; keep it and the two disagree, which is the whole point.
      const printJobs = await fetch(`${base}/print-api/agent/jobs`);
      expect(printJobs.status).not.toBe(404);
      const deviceStation = await fetch(`${base}/api/device/station`);
      expect(deviceStation.status).not.toBe(404);

      // Primary ⇒ acceptingSales:true — the control for the mirror's false; both boots are unfenced,
      // so `mode` is the only axis that differs.
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: true,
      });
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("refuses a mirror boot binding a non-loopback host without the WAITRON_MIRROR_ALLOW_EXPOSED opt-in", async () => {
    // The mirror serves its dashboard through an ambient full-admin viewer (the first test above proves
    // that surface is UNAUTHENTICATED), so binding it to a routable host would expose admin with no auth.
    // `assertMirrorBindSafe` (wired right after `isMirror` is read, before the ambient viewer is seeded)
    // fails the boot CLOSED with `server.mirror_bind_exposed` naming the host — BEFORE the socket binds.
    // The `mirror` clone (mirror_config seeded) is the subject; the guard fires ahead of the config read,
    // so this refusal does not depend on that row. The throw closes `db` before propagating (no leak).
    //
    // Prove-by-deletion (verified 2026-08-29, then restored): with the `if (!isMirror) return` in
    // `assertMirrorBindSafe` inverted to `if (isMirror) return` (i.e. the guard disabled), this boot
    // proceeds to bind 0.0.0.0 and the opt-in case below stops being the only path that binds — this
    // assertion then fails to catch a throw. Restored, it refuses here as asserted.
    let caught: unknown;
    try {
      await startServer({
        ...KEY_ENV,
        DATABASE_URL: mirrorDatabaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: mirror.pg.uri,
        WAITRON_HTTP_HOST: "0.0.0.0",
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_SYNC_DATABASE_URL: mirrorSyncDatabaseUrl,
      });
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect(isAppError(caught) && caught.code).toBe("server.mirror_bind_exposed");
    expect(isAppError(caught) && caught.params).toEqual({ host: "0.0.0.0" });
  }, 60_000);

  it("boots a mirror on a non-loopback host WITH the explicit opt-in (binds 0.0.0.0, guard silenced)", async () => {
    // The opt-in is the operator's deliberate escape hatch: `WAITRON_MIRROR_ALLOW_EXPOSED=true` silences
    // ONLY this stopgap guard — real per-user auth + TLS is still owed (the hosting slice). With it set,
    // the same non-loopback bind the previous test refused now completes, and the mirror serves. Bound to
    // 0.0.0.0 but reached over loopback, so the test never actually exposes anything off this host.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: mirrorDatabaseUrl,
      WAITRON_MIGRATIONS_DATABASE_URL: mirror.pg.uri,
      WAITRON_HTTP_HOST: "0.0.0.0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_SYNC_DATABASE_URL: mirrorSyncDatabaseUrl,
      WAITRON_MIRROR_ALLOW_EXPOSED: "true",
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      // The ambient viewer serves the dashboard exactly as the loopback boot does — the first GET primes
      // the session cookie on its RESPONSE, the next request carries it and the gated read resolves 200.
      // That the server bound and serves at all is the proof the opt-in silenced the guard.
      const primer = await fetch(`${base}/management-api/catalogues`);
      expect(primer.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("refuses a mirror boot that has no mirror_config row (a mirror REQUIRES its DB connection config)", async () => {
    // A mirror's whole job is to pull through the tunnel, which needs the DB-stored connection config
    // (`mirror_config`); a deployment stamped 'mirror' with no such row is a misconfiguration, refused
    // LOUDLY at boot (server.config_invalid { variable: "mirror_config", reason:
    // "mirror_requires_mirror_config" }) rather than serving
    // a box that can never reach its primary. Proven on the `noConfig` clone (mirror-stamped, never
    // seeded with a mirror_config row). The throw closes `db` before propagating (no leak); the line
    // coverage on that `await db.close()` is what proves it ran.
    //
    // Prove-by-deletion (verified 2026-08-29, then restored): with the `if (loaded === null) throw`
    // removed, this boot proceeds past the guard to `readMirrorToken`, which throws the CONFUSING
    // `credentials.missing` — a token error for a box that has no connection config at all — and this
    // assertion fails `expected 'credentials.missing' to be 'server.config_invalid'`. Restored, it
    // fails cleanly here with the loud server.config_invalid this asserts.
    let caught: unknown;
    try {
      await startServer({
        ...KEY_ENV,
        DATABASE_URL: noConfigDatabaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: noConfig.pg.uri,
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_SYNC_DATABASE_URL: noConfigSyncDatabaseUrl,
      });
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect(isAppError(caught) && caught.code).toBe("server.config_invalid");
    expect(isAppError(caught) && caught.params).toEqual({
      variable: "mirror_config",
      reason: "mirror_requires_mirror_config",
    });
  }, 60_000);
});
