import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDeploymentMode, stampDeployment, withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createCatalogue } from "@waitron/catalogue";
import { enrolPeer } from "@waitron/sync";
import { runTunnelClient } from "@waitron/tunnel";
import { createRelayStandin, type RelayStandin } from "@waitron/tunnel/testing/relay.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { roleUrl } from "./testing/postgres.js";
import type { Logger } from "./logger.js";
import { realSleep } from "./loop.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountSyncApi } from "./sync-api.js";

// C2a — the HEADLINE tunnel e2e (Task 6): a real booted mirror pulls a real primary's captured
// sync_log THROUGH B's outbound tunnel, applies it under FORCE RLS as the non-superuser sync roles,
// and serves the APPLIED data on its dashboard read-only. It COMPOSES the two suites that stop one
// step short of this:
//
//   * tunnel-e2e.test.ts — stands up the relay stand-in + runTunnelClient in front of a box HTTPS
//     sync-api and drives a HAND-CALLED syncPullOnce through tunnelHttpClient. Reused here VERBATIM
//     for the transport scaffolding (cert/relay/box-client), minus the hand-called pull.
//   * boot.mirror.rls.test.ts (Task 5) — boots apps/server in mirror mode (read-only gate + ambient
//     viewer + no sync source) against an UNREACHABLE relay, so its pull worker only ever backs off.
//
// What is genuinely NEW, and tested nowhere else, is the join: the booted mirror's OWN
// runSyncPull (Task-5-wired with tunnelHttpClient) is pointed at the RELAY's client port with the box
// CA + hostname, so the production pull worker — not a test harness — drains the primary through the
// tunnel, applies the rows, advances its cursor, and the dashboard GET serves what it applied. The
// gate (POST -> 403) and the ambient session (login-less GET) are Task 5's coverage; this suite fires
// ONE assertion of each inside the composed e2e (design §12), never rebuilding them.
//
// Real Postgres × 3 (a mirror is a non-superuser apply under FORCE RLS — PGlite would be a false
// pass, CLAUDE.md §4): `source` (the primary, holding the seeded catalogues + its HTTPS sync-api),
// `mirror` (the positive booted mirror), and `wrongMirror` (the deletion control's booted mirror).
const log: Logger = () => {};

// The primary's sync ORIGIN id — the marker sync_capture stamps on source.sync_log and the id the
// mirror's peer pulls (`?originId=`). Distinct from the mirror's own node id (WAITRON_TILL_NODE_ID
// below), which is the SUBSCRIBER half of the cursor key: subscriber and origin are never the same
// node, and they live in two different databases.
const PRIMARY_SYNC_NODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// The peer's subscriber_id AT THE SOURCE — the identity the source resolves the Bearer token to. Its
// value is irrelevant to /hello + /log (they need only a valid peer), so one enrolment serves the pull.
const PEER_SUBSCRIBER = "mirror-e2e";

// The two catalogues seeded on the primary and expected to arrive on the mirror. Catalogues ride the
// ORDERED lane (fast carries only payments/payment_refunds), FK only tenants, and are one of the 17
// synced tables — the simplest applied row a dashboard GET returns end-to-end.
const CATALOGUE_NAMES = ["Dinner menu", "Lunch menu"] as const;

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode, seeded
// identically on all three clones (boot.mirror.rls.test.ts's shape) so a booted mirror's reads resolve
// and an applied catalogue's tenant FK lands. WAITRON_TILL_NODE_ID is the mirror's SUBSCRIBER id.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};
const TENANT = TILL_ENV.WAITRON_TILL_TENANT_ID;

// The credentials key + media dir the trading boot requires (a mirror is still a trading boot, so the
// ring loads before the mode is read — it just files nothing), plus WAITRON_ENV=preproduction to match
// the deployment stamp and the source's advertised environment. A tight tick so both the pull worker's
// retry and the health pass loop turn over quickly during the bounded waits below.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-mirror-e2e-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_ENV: "preproduction",
  WAITRON_MIN_TICK_MS: "200",
  WAITRON_SYNC_FAST_TICK_MS: "200",
  ...TILL_ENV,
};

const source = useTemplateDb({ template: "manifest" });
const mirror = useTemplateDb({ template: "manifest" });
const wrongMirror = useTemplateDb({ template: "manifest" });

let migrationsRoot: string;
let caFile: string;
let sourceReader: Database; // sync_reader: the HTTPS sync-api reads source.sync_log through this
let sourceWriter: Database; // app_login: captures the catalogues into source.sync_log
let peerToken: string; // enrolled on the SOURCE; the Bearer every pull presents
let relay: RelayStandin;
let httpsServer: HttpsServer;
const tunnelAc = new AbortController();
let tunnelWorker: Promise<void>;
let relayClientUrl: string;

/** Seed the FK identity (tenant, location, node, till, series) with the WAITRON_TILL_*_ID on one clone
 * as the container superuser (RLS bypassed). None of these tables is sync-enrolled, so this captures no
 * sync_log rows. Mirrors boot.mirror.rls.test.ts's `seedIdentity`. */
async function seedIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`insert into tenants (id, country, tax_id, legal_name)
    values (${TENANT}, 'ES', '90333333P', 'Mirror E2E SL') on conflict do nothing`);
  await admin.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TENANT}, 'Loc', array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  await admin.execute(sql`insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TENANT}, ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Node')
    on conflict do nothing`);
  await admin.execute(sql`insert into tills (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_TILL_ID}, ${TENANT}, ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Till')
    on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${TILL_ENV.WAITRON_TILL_SERIES_ID}, ${TENANT}, ${TILL_ENV.WAITRON_TILL_NODE_ID}, 'A')
    on conflict do nothing`);
}

/** An OS-assigned free port, released before use (boot.mirror.rls.test.ts's helper — WAITRON_HTTP_PORT
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

/** Poll `pred` until true (returns true) or the budget elapses (returns false). Used BOTH as a
 * convergence gate the positive test asserts true and as the deletion control's bounded absence wait. */
async function waitFor(pred: () => boolean | Promise<boolean>, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await pred()) return true;
    if (Date.now() >= deadline) return false;
    await delay(100);
  }
}

/** How many catalogue rows have landed in a mirror's OWN database (the applied-row assertion). */
async function catalogueCount(admin: Database): Promise<number> {
  const r = await admin.execute<{ v: string }>(
    sql`select count(*)::int::text as v from catalogues`,
  );
  return Number(r.rows[0]!.v);
}

/** The mirror's (subscriber=this node, origin=primary, ordered) cursor as text, or null if it never
 * advanced (no row) — the cursor-advance assertion, and the deletion control's "never applied" proof. */
async function orderedCursor(admin: Database): Promise<string | null> {
  const r = await admin.execute<{ seq: string }>(
    sql`select last_applied_seq::text as seq from sync_cursor
        where subscriber_id = ${TILL_ENV.WAITRON_TILL_NODE_ID}
          and origin_id = ${PRIMARY_SYNC_NODE}::uuid and lane = 'ordered'`,
  );
  return r.rows[0]?.seq ?? null;
}

/** Boot apps/server in mirror mode against the SHARED relay's client port. Everything is identical
 * across the positive and deletion-control boots EXCEPT `boxHostname` — which is the single deletion:
 * "box.test" is the box cert's SAN (tunnelHttpClient authenticates it and the pull succeeds), any other
 * value fails checkServerIdentity on every pull so nothing is ever fetched or applied. */
function bootMirror(
  clone: { pg: { uri: string } },
  boxHostname: string,
  port: number,
): Promise<StartedServer> {
  return startServer({
    ...KEY_ENV,
    DATABASE_URL: roleUrl(clone.pg.uri, "app_login", "app_pw"),
    WAITRON_MIGRATIONS_DATABASE_URL: clone.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    // The peer's `url` is the RELAY (dialed by the tunnel http client), NOT the box directly; its
    // `nodeId` is the primary's ORIGIN id, which the pull sends as `?originId=`.
    WAITRON_SYNC_PEERS: JSON.stringify([
      { nodeId: PRIMARY_SYNC_NODE, url: relayClientUrl, token: peerToken },
    ]),
    WAITRON_SYNC_DATABASE_URL: roleUrl(clone.pg.uri, "sync_applier", "ap"),
    WAITRON_MIRROR_BOX_CA_FILE: caFile,
    WAITRON_MIRROR_BOX_HOSTNAME: boxHostname,
  });
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.mirror.rls.test.ts does: boot's from-source default does
  // not exist, so WAITRON_MIGRATIONS_DIR must point applyMigrations at the journal content per set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-mirror-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // Identity on all three clones; the two mirror clones are stamped preproduction (matching WAITRON_ENV)
  // and flipped to mode='mirror' (an OWNER write — app_user holds no UPDATE on deployment). The source
  // needs no stamp: it only SERVES its log, advertising its environment from mountSyncApi's deps.
  await seedIdentity(source.admin);
  await seedIdentity(mirror.admin);
  await seedIdentity(wrongMirror.admin);
  await stampDeployment(mirror.admin, "preproduction");
  await setDeploymentMode(mirror.admin, "mirror");
  await stampDeployment(wrongMirror.admin, "preproduction");
  await setDeploymentMode(wrongMirror.admin, "mirror");

  sourceReader = await source.pg.connectAs("sync_reader", "rp");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  peerToken = (await enrolPeer(source.admin, { subscriberId: PEER_SUBSCRIBER, name: "mirror-e2e" }))
    .token;

  // Capture the catalogues on the PRIMARY under withTenant{nodeId: PRIMARY_SYNC_NODE}: createCatalogue
  // inserts them and the catalogues_capture trigger writes each to source.sync_log with
  // origin_id = PRIMARY_SYNC_NODE — the exact rows the mirror's ordered lane pulls.
  for (const name of CATALOGUE_NAMES) {
    await withTenant(sourceWriter, TENANT, (tx) => createCatalogue(tx, { name }), {
      nodeId: PRIMARY_SYNC_NODE,
    });
  }

  // The box's HTTPS sync-api behind the tunnel (tunnel-e2e.test.ts's shape): a leaf whose SAN is
  // `box.test` ONLY — never a 127.0.0.1 IP-SAN shortcut — so the mirror must authenticate the box
  // hostname. Its CA is written to `caFile` for WAITRON_MIRROR_BOX_CA_FILE. Advertises `preproduction`
  // on /hello so the mirror's environment handshake matches.
  const { caCertPem, serverCertPem, serverKeyPem } = mintSelfSignedServerCert({
    hostnames: ["box.test"],
    ipAddresses: [],
    now: new Date(),
  });
  const caDir = await mkdtemp(join(tmpdir(), "waitron-mirror-e2e-ca-"));
  caFile = join(caDir, "box-ca.crt");
  await writeFile(caFile, caCertPem);

  const app = new Hono();
  mountSyncApi(
    app,
    { db: sourceReader, tenantId: TENANT, nodeId: PRIMARY_SYNC_NODE, environment: "preproduction" },
    log,
  );
  httpsServer = createHttpsServer(
    { key: serverKeyPem, cert: serverCertPem },
    getRequestListener(app.fetch),
  );
  await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
  const httpsPort = (httpsServer.address() as AddressInfo).port;

  // Relay + box tunnel client: the box dials OUT and parks a pool of idle connections. Wait for the
  // first `tunnel.connection_registered` before any mirror boots, so a mirror's very first pull finds a
  // ready tunnel rather than racing the pool warm-up. poolSize 8 comfortably serves the positive
  // convergence and the deletion control's repeated (failing) pulls in the same run.
  relay = await createRelayStandin({ verifyToken: () => true });
  let markRegistered!: () => void;
  const registered = new Promise<void>((resolve) => {
    markRegistered = resolve;
  });
  const tunnelLog: Logger = (_level, event) => {
    if (event === "tunnel.connection_registered") markRegistered();
  };
  tunnelWorker = runTunnelClient({
    relayHost: "127.0.0.1",
    relayPort: relay.boxPort,
    boxId: "box.test",
    token: "t", // the box<->relay registration token; verifyToken accepts any here
    localPort: httpsPort,
    poolSize: 8,
    sleep: realSleep,
    signal: tunnelAc.signal,
    log: tunnelLog,
  });
  await registered;
  relayClientUrl = `https://127.0.0.1:${relay.clientPort}/`;
}, 180_000);

afterAll(async () => {
  // Only the two `connectAs` handles this suite opened are closed here; the three admin connections and
  // all three clone databases are owned and torn down by the `useTemplateDb` calls. Then the tunnel
  // teardown in tunnel-e2e.test.ts's proven order: abort the box client and await it (destroys its
  // sockets), close the relay (destroys parked/paired sockets, which any lingering undici keep-alive
  // socket from a booted mirror observes and drops), then closeAllConnections() before close() on the
  // HTTPS server. Finally the temp dirs.
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  tunnelAc.abort();
  if (tunnelWorker !== undefined) await tunnelWorker;
  if (relay !== undefined) await relay.close();
  if (httpsServer !== undefined) {
    httpsServer.closeAllConnections();
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
  }
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (caFile !== undefined) await rm(join(caFile, ".."), { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

describe("mirror-mode headline e2e — pull through the tunnel, apply, serve read-only", () => {
  it("a mirror pulls the primary's sync_log through the tunnel, applies it, and serves it read-only", async () => {
    const port = await freePort();
    const server = await bootMirror(mirror, "box.test", port);
    const base = `http://127.0.0.1:${port}`;
    try {
      // 1. THE PULL THROUGH THE TUNNEL + APPLY: the booted mirror's own runSyncPull (via
      // tunnelHttpClient) drains the primary through the relay and applies the catalogues into the
      // mirror's OWN database. A generous budget for CI; convergence is normally the first pull (< 1s).
      expect(await waitFor(async () => (await catalogueCount(mirror.admin)) === 2, 40_000)).toBe(
        true,
      );
      const applied = await mirror.admin.execute<{ name: string }>(
        sql`select name from catalogues order by name`,
      );
      expect(applied.rows.map((r) => r.name)).toEqual([...CATALOGUE_NAMES]);

      // 2. THE CURSOR ADVANCED to the source's max ordered seq for this origin.
      const cursor = await orderedCursor(mirror.admin);
      expect(cursor).not.toBeNull();
      expect(BigInt(cursor!)).toBeGreaterThan(0n);
      const sourceMax = await source.admin.execute<{ seq: string }>(
        sql`select max(seq)::text as seq from sync_log where origin_id = ${PRIMARY_SYNC_NODE}::uuid`,
      );
      expect(cursor).toBe(sourceMax.rows[0]!.seq);

      // 3. A DASHBOARD GET SERVES THE APPLIED DATA WITH NO LOGIN (the ambient viewer). The browser's
      // first page load primes the session cookie on the RESPONSE (Hono setCookie is a response header,
      // not readable within the same request — Task 5 carry-over), so a cookieless primer GET yields the
      // Set-Cookie, and the browser's next request carries only that ambient cookie: no user login.
      const primer = await fetch(`${base}/management-api/catalogues`);
      expect(primer.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
      const rows = (await read.json()) as { name: string }[];
      expect(rows.map((r) => r.name).sort()).toEqual([...CATALOGUE_NAMES]);

      // 4. A WRITE IS REFUSED by the read-only gate (one assertion the gate is live in the composed
      // e2e; Task 5 owns the gate's full coverage).
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });
    } finally {
      await server.close();
    }
  }, 90_000);

  it("proven by deletion: a wrong box hostname makes the tunnel TLS validation refuse, so nothing is pulled or served", async () => {
    // The single deletion on the PULL/TUNNEL path (CLAUDE.md §4). This boot is BYTE-IDENTICAL to the
    // positive one above except WAITRON_MIRROR_BOX_HOSTNAME = "wrong.test" instead of "box.test". The
    // box leaf carries SAN=box.test only, so tunnelHttpClient's checkServerIdentity (servername drives
    // BOTH SNI and the identity check — tunnel-http.ts) refuses the box on EVERY pull; the pull throws
    // before any row is fetched, the worker backs off, and the mirror's own database stays empty.
    //
    // Why this is a real probe, not a slow one (CLAUDE.md §1 "say what the FAILING case would print"):
    // the positive test just proved the IDENTICAL tunnel/relay/box/seed delivers both catalogues and
    // advances the cursor. Were the tunnel path NOT load-bearing (the hostname ignored), this boot would
    // print catalogueCount 2, a non-null cursor and two rows on the GET — visibly different output. It
    // prints count 0, a null cursor and an empty GET. The positive is the other-direction control that
    // makes this absence meaningful.
    const port = await freePort();
    const server = await bootMirror(wrongMirror, "wrong.test", port);
    const base = `http://127.0.0.1:${port}`;
    try {
      // The server booted and its pass loop turned over — it had real running time on the same live
      // tunnel, so the absence below is a refused pull, not a server that never started.
      expect(await waitFor(() => server.health.lastPassAt != null, 20_000)).toBe(true);

      // Over a budget many multiples of the positive's first-pull convergence, nothing ever appears.
      const appeared = await waitFor(
        async () => (await catalogueCount(wrongMirror.admin)) > 0,
        4_000,
      );
      expect(appeared).toBe(false);
      expect(await catalogueCount(wrongMirror.admin)).toBe(0);
      expect(await orderedCursor(wrongMirror.admin)).toBeNull();

      // End-to-end: nothing pulled -> nothing served. The read-only dashboard resolves through the
      // ambient viewer (200, no login) but returns an EMPTY catalogue.
      const primer = await fetch(`${base}/management-api/catalogues`);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual([]);
    } finally {
      await server.close();
    }
  }, 90_000);
});
