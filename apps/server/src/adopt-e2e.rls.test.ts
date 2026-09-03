import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  readDeploymentMode,
  readMirrorConfig,
  stampDeployment,
  withTenant,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import { createCatalogue } from "@waitron/catalogue";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
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
import { mountSetup } from "./setup-api.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { fetchMirrorBundle } from "./mirror-bundle-fetch.js";
import {
  adoptFromPrimary,
  type AdoptCredential,
  type AdoptDeps,
  type PersistTradingArgs,
} from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { readMirrorToken } from "./mirror-token.js";

// C2b — the HEADLINE end-to-end (Task 11): a fresh mirror in SETUP mode adopts a bundle fetched from a
// booted primary, then REBOOTS into mirror mode and pulls + serves the primary's catalogues read-only
// through B's outbound tunnel. It ties the whole operator flow together, composing the two suites that
// each cover one half:
//
//   * mirror-bundle-api.rls.test.ts — mounts the primary's `POST /management-api/mirror-bundle`
//     (provision via applyVenue, mint the bundle as app_user + sync_retention). Reused here as the
//     primary side, served over plain HTTP so the mirror's real `fetchMirrorBundle` reaches it.
//   * mirror-e2e.rls.test.ts — stands up the relay stand-in + runTunnelClient in front of a box HTTPS
//     sync-api and boots a real mirror whose own runSyncPull drains the primary through the tunnel.
//     Reused VERBATIM for the transport scaffolding + the reboot-into-mirror-mode pull assertions.
//
// What is genuinely NEW is the join across the SETUP→ADOPT→REBOOT transition: the mirror's identity,
// its DB-stored connection config and its sealed sync token are NOT hand-seeded (as the two suites
// above do) — they are produced by driving `POST /setup-api/adopt`, which fetches the primary's bundle
// and calls the production `adoptFromPrimary`. The reboot then reads exactly what adopt wrote.
//
// Real Postgres × 2 (a mirror adopts + applies under FORCE RLS as the non-superuser roles, and the
// vault seal/unseal runs under a real key — PGlite is a superuser-only false pass, CLAUDE.md §4):
// `primary` (provisioned, holds the seeded catalogues + serves the bundle + the HTTPS sync source) and
// `mirror` (the fresh box adopted then rebooted). The bundle-fetch, adopt orchestration and reboot pull
// are the whole point, so the closest existing patterns (mirror-bundle-api.rls + mirror-e2e.rls) are
// copied rather than re-derived.
const log: Logger = () => {};
const noopLog: Logger = () => {};

const LOCALE = "es-ES";
const ADMIN_PASSWORD = "dashPass123";

// The two catalogues seeded on the primary and expected to arrive on the mirror. Catalogues ride the
// ORDERED lane, FK only tenants, and are one of the 17 synced tables — the simplest applied row a
// dashboard GET returns end-to-end (mirror-e2e.rls.test.ts's choice, reused).
const CATALOGUE_NAMES = ["Dinner menu", "Lunch menu"] as const;

const primary = useTemplateDb({ template: "manifest" });
const mirror = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling rls tests use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(83_000_000 + nifCounter).padStart(8, "0")}K`;
}

// The credentials key + media dir the trading (mirror) boot requires, plus WAITRON_ENV=preproduction to
// match the deployment stamp adopt applies and the primary's advertised environment. A tight tick so the
// pull worker's retry turns over quickly during the bounded waits below.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-adopt-e2e-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_ENV: "preproduction",
  WAITRON_MIN_TICK_MS: "200",
  WAITRON_SYNC_FAST_TICK_MS: "200",
};

// The mirror's OWN vault key ring — the same key adopt seals the token under AND the reboot boot reads
// it back with. In production the box mints this into `<stateDir>/secrets.env` (ensureBoxSecrets) and the
// supervisor sources it on reboot; here one fixed key stands in for both halves so `readMirrorToken`
// (app_user) round-trips what `adoptFromPrimary` sealed.
const RING = loadKeyRing(KEY_ENV);

let migrationsRoot: string;
let primaryStateDir: string; // holds tls/ca.crt — the box CA the bundle carries as `boxCaPem`
let designated: AdoptResult; // the five ids the primary was provisioned with; the mirror adopts them
let adminPersonId: string; // the primary admin the operator authenticates for the bundle

let appDb: Database; // app_login → app_user: the bundle endpoint's auth + RLS venue reads
let retentionDb: Database; // sync_pruner → sync_retention: mints the bundle's peer token
let sourceReader: Database; // sync_applier (sync_tailer + app_user): the HTTPS sync-api reads primary.sync_log and node_membership through this
let sourceWriter: Database; // app_login: captures the catalogues into primary.sync_log

let boxCaPem: string;
let relay: RelayStandin;
let httpsServer: HttpsServer; // the box HTTPS sync-api behind the tunnel
let primaryHttp: HttpServer; // the primary management surface (bundle endpoint) over plain HTTP
let primaryUrl: string; // http://127.0.0.1:<port> — what the mirror's adopt fetches from
let relayClientUrl: string; // https://127.0.0.1:<relay.clientPort>/ — the bundle's relayUrl
const tunnelAc = new AbortController();
let tunnelWorker: Promise<void>;

/** An OS-assigned free port, released before use (WAITRON_HTTP_PORT rejects "0", so the host cannot bind
 * an ephemeral port itself). */
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

/** Poll `pred` until true (returns true) or the budget elapses (returns false). */
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

/** How many `registro_sif` rows exist in a database — the no-second-chain guard (0 on the mirror). */
async function registroSifCount(admin: Database): Promise<number> {
  const r = await admin.execute<{ v: string }>(
    sql`select count(*)::int::text as v from registro_sif`,
  );
  return Number(r.rows[0]!.v);
}

/** Whether a row with `id` exists in `table` (a designated-id read-back on the mirror). */
async function rowExists(admin: Database, table: string, id: string): Promise<boolean> {
  const r = await admin.execute<{ v: string }>(
    sql`select count(*)::int::text as v from ${sql.raw(table)} where id = ${id}`,
  );
  return Number(r.rows[0]!.v) === 1;
}

/** Boot the mirror in MIRROR mode against the SHARED relay, its identity + connection config supplied by
 * the completed adopt (deployment.mode='mirror', `mirror_config`, the sealed `sync.mirror_token`). The
 * five WAITRON_TILL_*_ID are the ADOPTED ids, and the vault key is the same RING adopt sealed under. This
 * is mirror-e2e.rls.test.ts's `bootMirror`, its identity now sourced from `designated` rather than fixed
 * constants. */
function bootMirror(port: number): Promise<StartedServer> {
  return startServer({
    ...KEY_ENV,
    WAITRON_TILL_TENANT_ID: designated.tenantId,
    WAITRON_TILL_TILL_ID: designated.tillId,
    WAITRON_TILL_NODE_ID: designated.nodeId,
    WAITRON_TILL_SERIES_ID: designated.seriesId,
    WAITRON_TILL_LOCATION_ID: designated.locationId,
    DATABASE_URL: roleUrl(mirror.pg.uri, "app_login", "app_pw"),
    WAITRON_MIGRATIONS_DATABASE_URL: mirror.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_DATABASE_URL: roleUrl(mirror.pg.uri, "sync_applier", "ap"),
  });
}

// State captured across the adopt: the persisted trading config and the bundle the fetcher returned, so
// the token seal and the persist args can be asserted against exactly what crossed from the primary.
const persistedTrading: PersistTradingArgs[] = [];
let capturedBundle: MirrorBundle | undefined;

/** The real `fetchMirrorBundle`, wrapped to capture the bundle it returns (for the seal/round-trip
 * assertions). The wrapper adds no behaviour — adopt still fetches over real HTTP from the primary. */
async function fetchBundleCapturing(
  url: string,
  credential: AdoptCredential,
): Promise<MirrorBundle> {
  const bundle = await fetchMirrorBundle(url, credential);
  capturedBundle = bundle;
  return bundle;
}

/** The adopt deps a real setup-mode boot binds (boot.ts): the owner connection to the mirror's own DB,
 * the mirror's OWN vault key, the real HTTP fetcher, and the app/owner connection strings written into
 * `trading.env`. `persistTrading` captures rather than writes — the reboot env is built directly from
 * `designated`, so no `trading.env` file is needed. */
function adoptDeps(overrides: Partial<AdoptDeps> = {}): AdoptDeps {
  return {
    ownerDb: mirror.admin,
    ring: RING,
    fetchBundle: fetchBundleCapturing,
    persistTrading: async (args) => {
      persistedTrading.push(args);
    },
    databaseUrl: roleUrl(mirror.pg.uri, "app_login", "app_pw"),
    migrationsDatabaseUrl: mirror.pg.uri,
    // The mirror's OWN sync pool (a `sync_applier` role) — adopt persists it into trading.env as
    // WAITRON_SYNC_DATABASE_URL so the reboot's `loadMirrorSyncConfig` reads it back and enters mirror
    // mode. The same role the reboot env below (`mirrorBootEnv`) uses.
    syncDatabaseUrl: roleUrl(mirror.pg.uri, "sync_applier", "ap"),
    ...overrides,
  };
}

/** Mount the mirror's SETUP surface with the adopt route wired to the production `adoptFromPrimary`, as
 * boot.ts does in setup mode. Returns the Hono app to drive `POST /setup-api/adopt` on directly (the
 * setup surface is unauthenticated, so `.request()` is the whole interface — setup-api.test.ts's shape). */
function mountMirrorSetup(deps: AdoptDeps): Hono {
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      adopt: (req) => adoptFromPrimary(deps, req),
      requestRestart: () => {}, // the test reboots by calling startServer directly, not via SIGTERM
    },
    noopLog,
  );
  return app;
}

async function postAdopt(app: Hono, primaryUrlArg: string, credential: AdoptCredential) {
  return app.request("/setup-api/adopt", {
    method: "POST",
    body: JSON.stringify({ primaryUrl: primaryUrlArg, credential }),
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  // The migrations root, built as the sibling suites do: boot's from-source default does not exist, so
  // WAITRON_MIGRATIONS_DIR must point applyMigrations at the journal content per set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-adopt-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // The PRIMARY is a real trading node: stamp it preproduction (the bundle reads its environment) and
  // provision a full venue — applyVenue registers the primary's OWN SIF + chain (a `registro_sif` row on
  // the primary, never on the mirror). The seeded admin carries ADMIN_PASSWORD; its id is read back under
  // RLS as app_user, the only role the bundle endpoint uses.
  await stampDeployment(primary.admin, "preproduction");
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Adopt E2E SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(ADMIN_PASSWORD),
      },
    }),
    { db: primary.admin },
  );
  designated = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };

  appDb = await primary.pg.connectAs("app_login", "app_pw");
  retentionDb = await primary.pg.connectAs("sync_pruner", "pp");
  // Production source serve pool (boot.ts:1053): sync_tailer + app_user, since /hello now reads
  // node_membership (app_user's SELECT) as well as sync_peers.
  sourceReader = await primary.pg.connectAs("sync_applier", "ap");
  sourceWriter = await primary.pg.connectAs("app_login", "app_pw");

  adminPersonId = await withTenant(appDb, designated.tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(sql`select id from persons where role = 'admin'`);
    return r.rows[0]!.id;
  });

  // Capture the catalogues on the PRIMARY under withTenant{nodeId: designated.nodeId}: createCatalogue
  // inserts them and the catalogues_capture trigger writes each to primary.sync_log with
  // origin_id = designated.nodeId — the exact rows the mirror's ordered lane pulls once it has adopted
  // that same node id as its own subscriber.
  for (const name of CATALOGUE_NAMES) {
    await withTenant(sourceWriter, designated.tenantId, (tx) => createCatalogue(tx, { name }), {
      nodeId: designated.nodeId,
    });
  }

  // A REAL trading venue is not freshly-provisioned: it assigns a menu to its location
  // (`locations.catalogue_id`, catalogue.ts's `assignCatalogue`) and a receipt printer to its till
  // (`tills.receipt_printer_id`, print-api.ts). Both are NULLABLE out-of-scope FK columns the mirror
  // bundle carries VERBATIM, whose targets do NOT exist on the mirror at adopt time (`catalogues` is
  // empty in setup mode — sync starts only after the reboot — and `printers` is NEVER synced), so a
  // verbatim insert raises 23503 → an opaque `server.internal` 500 and rolls back: the Critical C2b
  // bug. Set them here via the owner (superuser bypasses RLS) so the primary models a real venue; the
  // mirror below asserts adoptVenue NULLED both. A `cloud_poll` printer needs only `poll_id`
  // (`printers_transport_fields_ck`), so it is the cheapest valid printer row.
  const primaryCatalogueId = (
    await primary.admin.execute<{ id: string }>(
      sql`select id from catalogues where tenant_id = ${designated.tenantId} order by name limit 1`,
    )
  ).rows[0]!.id;
  await primary.admin.execute(
    sql`update locations set catalogue_id = ${primaryCatalogueId} where id = ${designated.locationId}`,
  );
  const primaryPrinterId = (
    await primary.admin.execute<{ id: string }>(
      sql`insert into printers (tenant_id, location_id, name, transport, poll_id)
          values (${designated.tenantId}, ${designated.locationId}, 'Impresora Caja', 'cloud_poll', 'poll-caja-1')
          returning id`,
    )
  ).rows[0]!.id;
  await primary.admin.execute(
    sql`update tills set receipt_printer_id = ${primaryPrinterId} where id = ${designated.tillId}`,
  );

  // The box's HTTPS sync-api behind the tunnel (mirror-e2e.rls.test.ts's shape): a leaf whose SAN is
  // `box.test` ONLY, so the mirror must authenticate the box hostname. Its CA PEM is BOTH the box
  // sync-api's trust root AND what the bundle advertises as `boxCaPem` (written to primaryStateDir's
  // tls/ca.crt below), so the mirror trusts the same box on every pull.
  const { caCertPem, serverCertPem, serverKeyPem } = mintSelfSignedServerCert({
    hostnames: ["box.test"],
    ipAddresses: [],
    now: new Date(),
  });
  boxCaPem = caCertPem;

  const syncApp = new Hono();
  mountSyncApi(
    syncApp,
    {
      db: sourceReader,
      tenantId: designated.tenantId,
      nodeId: designated.nodeId,
      environment: "preproduction",
    },
    log,
  );
  httpsServer = createHttpsServer(
    { key: serverKeyPem, cert: serverCertPem },
    getRequestListener(syncApp.fetch),
  );
  await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
  const httpsPort = (httpsServer.address() as AddressInfo).port;

  // Relay + box tunnel client: the box dials OUT and parks a pool of idle connections. Wait for the
  // first `tunnel.connection_registered` before the mirror reboots, so its first pull finds a ready
  // tunnel rather than racing the pool warm-up.
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
    token: "t",
    localPort: httpsPort,
    poolSize: 8,
    sleep: realSleep,
    signal: tunnelAc.signal,
    log: tunnelLog,
  });
  await registered;
  relayClientUrl = `https://127.0.0.1:${relay.clientPort}/`;

  // The primary's mirror-bundle endpoint, served over plain HTTP so the mirror's real `fetchMirrorBundle`
  // (global fetch) reaches it (mirror-bundle-api.rls.test.ts mounts the same endpoint). Its stateDir
  // carries tls/ca.crt = the box CA, so the bundle's `boxCaPem` is exactly the CA the box sync-api serves
  // under; its relayUrl is the live relay client URL the mirror will dial after reboot.
  primaryStateDir = await mkdtemp(join(tmpdir(), "waitron-adopt-e2e-primary-state-"));
  await mkdir(join(primaryStateDir, "tls"), { recursive: true });
  await writeFile(join(primaryStateDir, "tls", "ca.crt"), boxCaPem);

  const mgmtApp = new Hono();
  mountMirrorBundleApi(
    mgmtApp,
    {
      appDb,
      retentionDb,
      stateDir: primaryStateDir,
      relayUrl: relayClientUrl,
      boxHostname: "box.test",
      designated,
    },
    log,
  );
  primaryHttp = createHttpServer(getRequestListener(mgmtApp.fetch));
  await new Promise<void>((resolve) => primaryHttp.listen(0, "127.0.0.1", () => resolve()));
  primaryUrl = `http://127.0.0.1:${(primaryHttp.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  // Only the four `connectAs` handles this suite opened are closed here; the two admin connections and
  // both clone databases are owned by `useTemplateDb`. Then the tunnel teardown in mirror-e2e's proven
  // order: abort the box client and await it, close the relay, then the HTTPS server, then the primary
  // HTTP server. Finally the temp dirs.
  if (appDb !== undefined) await appDb.close();
  if (retentionDb !== undefined) await retentionDb.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (sourceWriter !== undefined) await sourceWriter.close();
  tunnelAc.abort();
  if (tunnelWorker !== undefined) await tunnelWorker;
  if (relay !== undefined) await relay.close();
  if (httpsServer !== undefined) {
    httpsServer.closeAllConnections();
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
  }
  if (primaryHttp !== undefined) {
    primaryHttp.closeAllConnections();
    await new Promise<void>((resolve) => primaryHttp.close(() => resolve()));
  }
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (primaryStateDir !== undefined) await rm(primaryStateDir, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

describe("adopt headline e2e — setup-mode adopt, reboot into mirror mode, pull + serve read-only", () => {
  it("a fresh mirror adopts a bundle from a booted primary, then pulls + serves read-only", async () => {
    // 1. DRIVE THE ADOPT: the mirror's setup surface fetches the primary's bundle over real HTTP and runs
    // the production `adoptFromPrimary`. The operator supplies only the primary's URL + an admin login.
    const setupApp = mountMirrorSetup(adoptDeps());
    const res = await postAdopt(setupApp, primaryUrl, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      adopted: true,
      tenantId: designated.tenantId,
      restarting: true,
    });
    expect(capturedBundle).toBeDefined();

    // 2. ADOPT OUTCOMES ON THE MIRROR DB. The mode is flipped to 'mirror' (an OWNER write) — the whole
    // point of the deletion control below.
    expect(await readDeploymentMode(mirror.admin)).toBe("mirror");

    // The identity scaffold was inserted with the primary's EXACT ids (the pulled rows resolve their FKs
    // against these). All five parents, read back by id.
    expect(await rowExists(mirror.admin, "tenants", designated.tenantId)).toBe(true);
    expect(await rowExists(mirror.admin, "locations", designated.locationId)).toBe(true);
    expect(await rowExists(mirror.admin, "nodes", designated.nodeId)).toBe(true);
    expect(await rowExists(mirror.admin, "tills", designated.tillId)).toBe(true);
    expect(await rowExists(mirror.admin, "invoice_series", designated.seriesId)).toBe(true);

    // THE CRITICAL FK FIX + a fidelity note. The primary is a REAL trading venue: its location carries a
    // `catalogue_id` and its till a `receipt_printer_id` (set in beforeAll). Both are out-of-scope FKs
    // whose targets are absent on the mirror at adopt — `catalogues` is empty in setup mode and
    // `printers` is never synced — so adoptVenue NULLS them (a verbatim copy would 23503 → 500, and the
    // mirror could not be provisioned). The mirror's rows therefore land with NULL: the location loses
    // its menu pointer (a v1 DR fidelity limitation, `locations` does not re-sync) and the till has no
    // printer (a mirror never prints). This assertion is what makes the beforeAll assignment
    // load-bearing — remove the strip in venue-adopt.ts and the adopt above 500s instead.
    const mirrorLoc = await mirror.admin.execute<{ catalogueId: string | null }>(
      sql`select catalogue_id as "catalogueId" from locations where id = ${designated.locationId}`,
    );
    expect(mirrorLoc.rows[0]!.catalogueId).toBeNull();
    const mirrorTill = await mirror.admin.execute<{ receiptPrinterId: string | null }>(
      sql`select receipt_printer_id as "receiptPrinterId" from tills where id = ${designated.tillId}`,
    );
    expect(mirrorTill.rows[0]!.receiptPrinterId).toBeNull();

    // THE KEY FISCAL ASSERTION: adopt forked NO second chain. `registro_sif` is empty on the mirror
    // (adoptVenue never calls registerSif — CLAUDE.md §5); the primary holds its own single row. The SIF
    // arrives on the mirror only via the pulled sync_log, and catalogues carry none.
    expect(await registroSifCount(mirror.admin)).toBe(0);
    expect(await registroSifCount(primary.admin)).toBe(1);

    // The DB-stored connection config + sealed token adopt wrote — what the reboot reads INSTEAD of env.
    const cfg = await readMirrorConfig(mirror.admin);
    expect(cfg).toEqual({ relayUrl: relayClientUrl, boxHostname: "box.test", boxCaPem });
    // The token round-trips under the mirror's OWN key: sealed by adopt, read back here as app_user.
    expect(await readMirrorToken(mirror.admin, RING, designated.tenantId)).toBe(
      capturedBundle!.syncToken,
    );

    // The trading config adopt persisted for the reboot carries the adopted ids + the mirror's own
    // connection strings + the primary's environment.
    expect(persistedTrading).toHaveLength(1);
    expect(persistedTrading[0]).toEqual({
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      tillId: designated.tillId,
      nodeId: designated.nodeId,
      seriesId: designated.seriesId,
      databaseUrl: roleUrl(mirror.pg.uri, "app_login", "app_pw"),
      migrationsDatabaseUrl: mirror.pg.uri,
      syncDatabaseUrl: roleUrl(mirror.pg.uri, "sync_applier", "ap"),
      environment: "preproduction",
    });

    // 3. REBOOT INTO MIRROR MODE. boot reads mode='mirror' + `mirror_config` + the vault token, composes
    // tunnelHttpClient + runSyncPull, and drains the primary through the tunnel.
    const port = await freePort();
    const server = await bootMirror(port);
    const base = `http://127.0.0.1:${port}`;
    try {
      // THE PULL THROUGH THE TUNNEL + APPLY: the booted mirror's own runSyncPull drains the primary and
      // applies the catalogues into the mirror's OWN database.
      expect(await waitFor(async () => (await catalogueCount(mirror.admin)) === 2, 40_000)).toBe(
        true,
      );
      const applied = await mirror.admin.execute<{ name: string }>(
        sql`select name from catalogues order by name`,
      );
      expect(applied.rows.map((r) => r.name)).toEqual([...CATALOGUE_NAMES]);

      // A DASHBOARD GET SERVES THE APPLIED DATA WITH NO LOGIN (C2a's ambient viewer). The first cookieless
      // hit primes the session cookie on the RESPONSE; the browser's next request carries only that
      // ambient cookie — no user login.
      const primer = await fetch(`${base}/management-api/catalogues`);
      expect(primer.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
      const rows = (await read.json()) as { name: string }[];
      expect(rows.map((r) => r.name).sort()).toEqual([...CATALOGUE_NAMES]);

      // A WRITE IS REFUSED by the read-only gate (C2a's gate). This is the assertion the deletion control
      // below makes load-bearing: with `setDeploymentMode('mirror')` removed from adopt.ts, the reboot
      // boots as a PRIMARY and this POST is no longer a 403.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });
    } finally {
      await server.close();
    }
    // The listener is genuinely gone after close().
    await expect(fetch(`${base}/management-api/catalogues`)).rejects.toThrow();
  }, 120_000);

  it("proven by deletion: a mismatched designated id makes adopt refuse — the explicit ids are used", async () => {
    // The control that pins "the primary's EXACT ids are actually adopted" (spec §12 control 3). adopt
    // fetches the real bundle, then a wrapper corrupts `designated.locationId` to a fresh random id that
    // is NOT among the inserted parent rows. `adoptVenue`'s designated-id read-back (`assertPresent`,
    // under the tenant scope) then fails LOUDLY with `provisioning.adopt_incomplete` naming "location",
    // rolling the whole transaction back — so nothing is stamped, no mode flip, no `mirror_config`.
    //
    // Why the failure is DETERMINISTIC, not a race: the read-back is a synchronous SELECT inside the same
    // transaction as the inserts; a location id absent from the inserted rows can never be found. The
    // positive test above is the other-direction control — the IDENTICAL flow with the UNCORRUPTED id
    // adopts, flips the mode, and serves. Deletion-proof of the GUARD: remove `adoptVenue`'s
    // `assertPresent(tx, "location", …)` line and this test goes green wrongly (the mismatch is accepted).
    const bogusLocationId = "00000000-0000-4000-8000-0000000000ff";
    const wrappedDeps = adoptDeps({
      fetchBundle: async (url, credential) => {
        const bundle = await fetchMirrorBundle(url, credential);
        return { ...bundle, designated: { ...bundle.designated, locationId: bogusLocationId } };
      },
    });
    const setupApp = mountMirrorSetup(wrappedDeps);

    const res = await postAdopt(setupApp, primaryUrl, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
    });
    // The adopt route maps a non-AppError to 500; `provisioning.adopt_incomplete` is a registered
    // AppError, and the setup-api adopt route surfaces an unmapped AppError as its default 400.
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("provisioning.adopt_incomplete");

    // The transaction rolled back: the bogus location id was never inserted on the mirror.
    expect(await rowExists(mirror.admin, "locations", bogusLocationId)).toBe(false);
  }, 60_000);
});
