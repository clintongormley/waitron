import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  captureError,
  locations,
  nodes,
  readDeploymentMode,
  readSingletonRole,
  readStandardSeriesId,
  setDeploymentMode,
  setSingletonRole,
  openVenueDatabase,
  stampDeployment,
  tenants,
  tills,
  withTransaction,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import type { Endorsement, SignedMembershipDocument } from "@waitron/membership";
// The same test-only entry point `packages/fiscal-verifactu`'s own drain suites use to seed a due
// `envios` row (boot.test.ts's drain e2e reuses it identically) — no `exports` map restricts either
// package, so the deep import resolves the way a same-package one would.
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { parseEnvFile } from "./env-file.js";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";

// The headline e2e for the promote action (promote runbook design §8): a booted LOCAL SECONDARY
// (mode='primary', singleton_role='secondary') files NOTHING; an in-process promote flips
// singleton_role live; and the running fiscal pass BEGINS draining on its next tick — with the
// till surface answering 200 throughout (no restart).
//
// ## Two things to know about this file
//
// **There is no ROLE SPLIT on this engine.** Every statement below, and every statement each booted
// server issues, runs on the one handle `openVenueStore` hands out. What the file drives for
// real is the wall-clock loop — which is why the polling below stays.
//
// **The suite keeps a handle open on each venue directory while a server holds one, and only READS
// through it while a server is up.** Write-ahead mode admits a reader beside the writer and both
// opens set `busy_timeout` (`packages/store/src/index.ts`, `openConnection`); every write this file
// makes — the seeding, and `cleanupFiscalWork` in each `finally` — happens with no server running.
//
// ## One case below is RED, and it is a PRODUCT path, not a test to edit
//
// `does not file as a secondary, then files on the next tick after a live promote` expects the
// promoted primary's drain to have ATTEMPTED the submission — `intentos: 1, incidencia: true`.
// The row is still `intentos: 0, incidencia: false`, because the drain never reaches a submission.
//
// The cause MOVED on 2026-09-22 and this paragraph is its replacement. It used to be `workIsDue`,
// which issued `select envios_work_due(<instant>::timestamptz)` — a function no migration creates
// and a cast this engine does not parse — so `drain()` threw before it enumerated anything at all.
// `workIsDue` is an ordinary query now, and the drain gets one statement further and throws there
// instead: `countDue` (`packages/fiscal-verifactu/src/drain.ts`) selects `count(*)::text`, and
// SQLite refuses the `::` with `unrecognized token: ":"`. Measured by running this file with the
// swallowed error printed from `drain`'s own catch — the stack names `countDue`, `errcode` 1 — and
// visible without that patch as the booted server's `drain.tenant_skipped` warning carrying
// `errorCode: "unknown"`, which is `codeOf`'s fallback for a driver error.
//
// The secondary half of the case — that a secondary files NOTHING — passes, so what is red is
// only the post-promote half.
//
// `undici`'s `fetch` is module-mocked to REJECT so the AEAT submit the post-promote drain makes fails
// fast: the seeded `envios` row transitions to an OBSERVABLE attempted state (`backoffBatch` sets
// intentos=1, incidencia=true, estado='pendiente') rather than leaving this suite dialling AEAT's real
// preproduction host. Node's OWN global `fetch` (a separate module identity from the `"undici"` npm
// specifier this mock intercepts — see boot.test.ts's header) still serves the `/api/staff` probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() => Promise.reject(new Error("undici fetch disabled in boot.promote.test.ts"))),
  };
});

// The till's fiscal identity — the four WAITRON_TILL_*_ID that put boot into TRADING mode (which is
// what exposes the in-process promote method). Distinct per field. Seeded (tenant + location) in
// `beforeAll` so boot's `readOrderFlow` / `readVenueLocale` reads resolve.
const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// Filesystem paths are isolated under this suite's temporary root and removed in afterAll.
// A `modules.json` that resolves the two-member fiscal slot to Veri*Factu (disabling the no-regime
// `fiscal-none`), the shape a real ES provision persists. Every trading/mirror boot here reaches
// `makeFiscalBackend`, which would refuse `module.fiscal_slot_ambiguous` under the default-on both-enabled
// set. Folded into `KEY_ENV`'s state dir; a boot with its own state dir writes the same file into it.
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);
// Boot config every production host carries: the credentials key `loadKeyRing` requires (a secondary
// is still a trading boot, so the ring is loaded before the fiscal pass is gated), plus the passkey RP
// id + origin `loadConfig` demands in production. `WAITRON_ENV: "production"` so it agrees with the
// deployment stamp below AND with `seedPendingEnvios`'s default `entorno` ("production") — otherwise
// `claimBatch`'s deployment-environment guard would refuse the seeded row before any submit attempt.
const KEY_ENV = {
  // Task 3: keep the plain-HTTP landing listener (default port 80) OUT of every boot test — 80 is
  // privileged, and a root CI container would otherwise stand up a live service on it. Its own
  // behaviour is proven directly in landing-listener.test.ts.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
  ...TILL_ENV,
};

let migrationsRoot: string;
// Two venue directories, each with the handle this suite keeps on it. The local-secondary suite's
// deployment stamp and singleton_role flips must never leak into the mirror suite's (primary,
// primary) flip, and vice versa.
let appVenueDir: string;
let mirrorVenueDir: string;
let appDb: Database;
let mirrorDb: Database;
const openStores: VenueDatabase[] = [];

// The box key ring, built from the SAME credentials key boot loads from `KEY_ENV` — so the identity
// this suite seals is the one the in-process promote unseals to sign the minted membership document.
const PROMOTE_RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

/**
 * Seed the boot till's tenant + location + node, so boot's
 * `readOrderFlow` / `readVenueLocale` reads resolve — the same minimal identity boot.test.ts's
 * drain suite seeds — plus a node identity (sealed signing key + stamped `nodes.public_key`) so
 * the promote's membership-document mint has a key to sign with. `order_flow` defaults to
 * `prepay`.
 */
async function seedTillIdentity(db: Database): Promise<void> {
  // Every row goes in through its TABLE DEFINITION, the same change `packages/db/src/testing/seed.ts`
  // and `testing/fiscal-fixtures.ts` took. Two reasons: a raw insert reaches no `$defaultFn`
  // generator, and `created_at` on `tenants`, `nodes` and `tills` is one of those on this engine;
  // and `array['en']::text[]` is a PostgreSQL array constructor plus a PostgreSQL cast operator,
  // both refused at prepare here. `on conflict do nothing` stays UNTARGETED, as the statements it
  // replaces were — narrowing it would be a behaviour change this conversion is not making.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90111111H", legalName: "Promote Till SL" })
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
      name: "Promote node",
    })
    .onConflictDoNothing();
  await db
    .insert(tills)
    .values({
      id: TILL_ENV.WAITRON_TILL_TILL_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Promote till",
    })
    .onConflictDoNothing();
  await establishNodeIdentity({ ownerDb: db, ring: PROMOTE_RING }, TILL_ENV.WAITRON_TILL_NODE_ID);
}

/**
 * A fresh venue directory migrated through the manifest, plus a handle on it the suite keeps.
 *
 * The migration run is this suite's, not boot's, because the identity rows have to exist before boot
 * reads them; boot's own `applyMigrations` over the same directory then finds nothing to do.
 */
async function migratedVenue(): Promise<[string, Database]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-promote-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue];
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.test.ts / boot.mirror.test.ts do: boot's
  // from-source default (`apps/server/src/drizzle`) does not exist under source, so
  // `WAITRON_MIGRATIONS_DIR` must point `applyMigrations` at the real journal content per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  [appVenueDir, appDb] = await migratedVenue();
  [mirrorVenueDir, mirrorDb] = await migratedVenue();
  await seedTillIdentity(appDb);

  // Put the deployment into a local-secondary state: stamp production (matching WAITRON_ENV so the boot
  // guard passes; idempotent when the value already matches) then flip singleton_role to 'secondary'.
  // `mode` keeps its column default ('primary'). => (mode=primary, singleton_role=secondary).
  await stampDeployment(appDb, "production");
  await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "secondary");
  expect(await readDeploymentMode(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("primary");
  expect(await readSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("secondary");
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

/** Polls `predicate` up to ~10s (200 x 50ms) for its first defined value — boot.test.ts's shape. The
 * boot loop uses a real wall clock (not injectable at boot level), so passes are observed by polling. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

/** Waits for the background loop to record at least one pass (proof it is live). */
async function waitForPass(state: { lastPassAt: Date | null }): Promise<void> {
  await poll(async () => state.lastPassAt ?? undefined);
  expect(state.lastPassAt).not.toBeNull();
}

/**
 * Seeds ONE due registro + its `envios` sidecar (estado='pendiente', intentos=0,
 * incidencia=false, due immediately) and seals a usable `fiscal.aeat` credential for that tenant,
 * so the drain ATTEMPTS the row (rather than skipping it for a missing credential) once this node
 * holds the singleton.
 */
async function seedFiscalWork(): Promise<{ registroIds: string[] }> {
  const seeded = await seedPendingEnvios(appDb, {
    count: 1,
    identity: {
      tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
      nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      nif: "90111111H",
    },
  });
  const material = mintMtlsMaterial();
  await withTransaction(appDb, (tx) =>
    putCredential(tx, loadKeyRing(KEY_ENV), {
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: material.clientPfx.toString("base64"),
        passphrase: material.clientPassphrase,
        certKind: "representante",
      },
    }),
  );
  return { registroIds: seeded.registroIds };
}

/** Reads the seeded `envios` row's observable columns through this suite's own handle.
 *
 * `incidencia` is decided here rather than in the assertions: a raw statement reaches no drizzle
 * column mapper, so a `flag` column arrives as the number 1 or 0 and `toEqual({incidencia: true})`
 * fails on the type. Measured 2026-09-22 by running this file with the coercion removed:
 * `expected { …, incidencia: 1 } to deeply equal { …, incidencia: true }`. */
async function readEnvio(
  registroId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await appDb.execute<{ estado: string; intentos: number; incidencia: number }>(
    sql`select estado, intentos, incidencia from envios where registro_id = ${registroId}`,
  );
  const row = rows.rows[0]!;
  return { estado: row.estado, intentos: row.intentos, incidencia: row.incidencia === 1 };
}

/** Deletes the fiscal sidecar rows a test seeded so the shared venue directory stays order-independent
 * `envios` (keyed by registro id) is what keeps the drain perpetually due; `incidents` (which carries
 * no registro_id column, 0000_db_baseline.sql, so it is cleared wholesale) is defensive against a
 * failure path that raises one. Both run with no server up — every caller is in a `finally` after
 * `server.close()` — so they never contend with boot's own handle for the write lock. */
async function cleanupFiscalWork(seeded: { registroIds: string[] }): Promise<void> {
  await appDb.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
  await appDb.execute(sql`delete from incidents `);
}

// Short ticks so both the Phase A empty pass and the post-flip drain pass land inside the poll budget:
// an idle secondary's empty pass returns `nextDueAt: null`, so the loop otherwise sleeps `maxTickMs`
// (loop.ts's `sleepMsFor`). 1000ms is comfortably below drain's staleness budget, so the boot guard
// passes. `skipRetryMs` is set for completeness; the seeded tenant has a credential so it is not hit.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

describe("promote: local secondary → primary, live", () => {
  it("does not file as a secondary, then files on the next tick after a live promote — tills answer throughout", async () => {
    // A fresh (mode=primary, singleton_role=secondary) starting point for this test (a prior test may
    // have flipped the shared venue directory's singleton_role to 'primary').
    await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "secondary");
    const seeded = await seedFiscalWork();
    const { registroIds } = seeded;
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_VENUE_DIR: appVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      // Phase A — a secondary. A pass has run (the loop is live), but the singleton-gated fiscal pass
      // is EMPTY for a non-singleton, so the seeded row is untouched.
      await waitForPass(server.health);

      // Mode-gated exposure (R3b): a NON-mirror trading box surfaces the local-secondary promote and
      // NOT the mirror promote — the discriminated dispatch in makeStartedServer picks exactly one.
      expect(server.promoteLocalSecondaryToPrimary).toBeDefined();
      expect(server.promoteMirrorToPrimary).toBeUndefined();
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 0,
        incidencia: false,
      });
      // The sale path answers (mode='primary', so no read-only gate; the route is unauthenticated).
      const staffA = await fetch(`${base}/api/staff`);
      expect(staffA.status).toBe(200);
      expect(await staffA.json()).toEqual([]);

      // Promote the running secondary IN-PROCESS — no restart. The single owner write flips
      // singleton_role to 'primary'; the holder refresh flips the running fiscal pass on its next tick.
      const result = await server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: true });
      expect(result).toEqual({ alreadyPrimary: false });
      expect(await readSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("primary");

      // Phase B — now the singleton. The next drain pass claims the seeded row and attempts the submit;
      // the mocked `undici` fetch rejects, so `claimBatch` incremented intentos to 1 and `backoffBatch`
      // set incidencia=true and re-queued it 'pendiente'. Poll — the wall-clock loop is not injectable.
      // Poll on `incidencia` (set by `backoffBatch`, the LAST step of a failed attempt), NOT `intentos`
      // (set at CLAIM, when estado is transiently 'enviando'): polling intentos races the assertion below
      // and can catch the row mid-attempt as {estado:'enviando', incidencia:false}.
      await poll(async () => ((await readEnvio(registroIds[0]!)).incidencia ? true : undefined));
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 1,
        incidencia: true,
      });

      // The sale path STILL answers across the live flip — the "no restart" claim, hit not asserted.
      const staffB = await fetch(`${base}/api/staff`);
      expect(staffB.status).toBe(200);
      expect(await staffB.json()).toEqual([]);
    } finally {
      await server.close();
      await cleanupFiscalWork(seeded);
    }
  }, 60_000);

  it("refuses an unattested promote and keeps filing off", async () => {
    // A fresh (mode=primary, singleton_role=secondary) starting point and its own seeded work.
    await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "secondary");
    const seeded = await seedFiscalWork();
    const { registroIds } = seeded;
    const port = await freePort();

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_VENUE_DIR: appVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      // A pass has run — the loop is live — but the node is still a secondary, so the seeded row is
      // untouched before the promote is even attempted.
      await waitForPass(server.health);

      // The fence guard refuses a promote whose attestation says the old node is NOT neutralised — a
      // plain throw BEFORE the owner write, so nothing changes. `captureError` + `isAppError` is the
      // repo idiom for asserting a thrown AppError code (`toSatisfy` is unavailable here).
      const error = await captureError(() =>
        server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: false }),
      );
      expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");

      // The refusal left the node exactly as it was: still a secondary, still filing nothing.
      expect(await readSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("secondary");
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 0,
        incidencia: false,
      });
    } finally {
      await server.close();
      await cleanupFiscalWork(seeded);
    }
  }, 60_000);
});

// R3b — the in-process MIRROR→PRIMARY promote wired into boot (spec §4). A booted mirror exposes
// `promoteMirrorToPrimary` (and NOT the local-secondary method); calling it runs the point-of-no-return
// owner transaction (mode+singleton → primary, term-guarded endorsed document), rewrites `trading.env`
// with the cloud's OWN reserved standard series id, and schedules a restart into mode=primary. It
// runs against its own venue directory (`mirrorVenueDir`, opened in `beforeAll`) so the mirror stamp
// and the (primary,primary) flip never leak into the local-secondary suite above.

// The mirror's OWN venue ids, distinct from TILL_ENV so the two directories' seeds never collide. The NODE id
// is the generated standby's own id (filled in at seed time), and WAITRON_TILL_SERIES_ID boots as the
// primary's INERT designated series — the value the promote must OVERWRITE with the cloud's own reserved
// standard series.
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // inert, must be overwritten
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // the primary this mirror pulls
const MIRROR_NUMERO_INSTALACION = 7;

/** Seed a fresh venue directory as a read-only mirror holding its OWN dormant identity (R2/R3a): tenant + location,
 * a reserved standby identity (own node + sealed key + endorsement + reserved SIF + reserved standard
 * series), a held term-3 membership chart, the DB-stored mirror connection config + sealed sync token the
 * mirror boot reads, and deployment stamped production then mode='mirror'. Returns the cloud's own nodeId
 * + the reserved standard series id the promote corrects trading.env to. */
async function seedMirrorIdentity(
  db: Database,
): Promise<{ nodeId: string; standardSeriesId: string }> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote Cloud SL" })
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
  // The primary's endorsement of the cloud's own key, stored on the standby's `nodes` row. A placeholder
  // signature is fine here — the promote signer only READS it and attaches it to the minted document; the
  // transitive-trust VERIFICATION of a real endorsement is the adopt e2e's assertion.
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: db, ring: PROMOTE_RING },
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

  // A held term-3 chart: the outgoing primary serving, this node secondary — the promote bumps it to 4.
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

  // The mirror's DB-stored connection config + sealed sync token the mirror boot requires (owner writes).
  // The relay is a dead loopback port — the pull/tunnel workers dial it and back off in the background,
  // which never blocks boot and is aborted on close().
  await writeMirrorConfig(db, standby.nodeId, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  // Deployment: production (matching WAITRON_ENV) then mode='mirror' (co-sets singleton_role='secondary').
  await stampDeployment(db, "production");
  await setDeploymentMode(db, standby.nodeId, "mirror");
  const standardSeriesId = await readStandardSeriesId(db, standby.nodeId);
  return { nodeId: standby.nodeId, standardSeriesId };
}

describe("promote: mirror → primary, in-process, restart-into-primary", () => {
  it("exposes promoteMirrorToPrimary (not the local method), promotes, and rewrites trading.env to the cloud's own series", async () => {
    const seed = await seedMirrorIdentity(mirrorDb);
    const port = await freePort();
    // A per-test state dir so the corrected `trading.env` lands somewhere isolated we can read back.
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-mirror-state-"));
    // The mirror boot reaches the fiscal slot too — resolve it to Veri*Factu so it does not refuse
    // `module.fiscal_slot_ambiguous` under the default-on two-member set.
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      // Override the local-secondary TILL_ENV that KEY_ENV carries with the mirror's own ids; the NODE id
      // is the cloud's OWN reserved id (R3a) and the series is the primary's INERT designated series.
      WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
      WAITRON_TILL_NODE_ID: seed.nodeId,
      WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
      WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
      WAITRON_VENUE_DIR: mirrorVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      // On a boot failure `server` is never assigned, so the finally below never runs — clean up the
      // temp state dir here rather than leaking it.
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    // SAFETY (CLAUDE.md §4): the promote schedules `setTimeout(() => process.kill(pid, "SIGTERM"), 0)`.
    // Spy on process.kill so the restart NEVER fires a real SIGTERM at the vitest process; assert it was
    // scheduled instead. Installed before the promote so the next-tick timer hits the spy, restored below.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      // Mode-gated exposure (R3b): a MIRROR surfaces the mirror promote and NOT the local-secondary one.
      expect(server.promoteMirrorToPrimary).toBeDefined();
      expect(server.promoteLocalSecondaryToPrimary).toBeUndefined();

      const result = await server.promoteMirrorToPrimary!({ oldNodeNeutralised: true });
      expect(result).toEqual({ alreadyPrimary: false, seriesId: seed.standardSeriesId });

      // The point-of-no-return committed: deployment flipped to (primary, primary).
      expect(await readDeploymentMode(mirrorDb, seed.nodeId)).toBe("primary");
      expect(await readSingletonRole(mirrorDb, seed.nodeId)).toBe("primary");

      // The next-tick restart timer has fired into the spy — never a real SIGTERM.
      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      // trading.env was rewritten: WAITRON_TILL_SERIES_ID is the cloud's OWN reserved standard series
      // (result.seriesId), NOT the inert designated series it booted with; every other id re-emitted.
      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted.WAITRON_TILL_SERIES_ID).toBe(seed.standardSeriesId);
      expect(persisted.WAITRON_TILL_SERIES_ID).not.toBe(MIRROR_DESIGNATED_SERIES_ID);
      expect(persisted.WAITRON_TILL_NODE_ID).toBe(seed.nodeId);
      expect(persisted.WAITRON_ENV).toBe("production");
    } finally {
      await server.close();
      killSpy.mockRestore();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
