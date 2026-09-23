import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  deviceProfiles,
  devices,
  kitchenStations,
  locations,
  openVenueDatabase,
  readDeploymentMode,
  readSingletonRole,
  readStandardSeriesId,
  setDeploymentMode,
  stampDeployment,
  tenants,
  tills,
  withTransaction,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, hashSecret, persons } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import type { Endorsement, SignedMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { mountPromoteApi } from "./promote-api.js";
import { readOnlyGate } from "./read-only-gate.js";
import { parseEnvFile } from "./env-file.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";

// Task 10 — the END-TO-END RECEIPT for the promote endpoint (spec §8/§9.1). No new production code: this
// suite drives the whole arc over the real HTTP endpoint, each boot on its own venue DIRECTORY of
// SQLite files:
//
//   1. HAPPY PATH (admin login): POST /management-api/promote with a valid admin credential +
//      `oldNodeNeutralised:true` on a booted adopted mirror → 200 `{alreadyPrimary:false,
//      restarting:true}`; the box restarts into `mode=primary`; the promoted primary SELLS a real
//      cash sale over `POST /api/sales` and CHAINS it locally on its OWN reserved SIF; and it does NOT
//      file — `awaitingFiscalCertificate:true` on box-status and the seeded envío is never submitted.
//   2. BREAK-GLASS PATH: the same promotion authorized with the adopt-minted break-glass secret instead
//      of a login → 200 promoted.
//   3. REFUSALS: a wrong break-glass → 401 and the node stays a read-only mirror; a valid credential
//      with `oldNodeNeutralised:false` → 400 `promotion.fence_not_attested`, node unchanged.
//   4. THE READ-ONLY-GATE HOLE, proven by DELETION: on the real booted mirror the exempt promote POST
//      reaches the handler while an ordinary write POST still gets 403 `node.read_only`; and, at the
//      exemption-clause level, removing the `/management-api/promote` clause turns the same authorized
//      promote into a 403 (the negative control), restoring it turns it green again (CLAUDE.md §4).
//
// WHAT WENT WITH POSTGRESQL, AND IS NOT REPLACED.
//
// The container was justified by role separation: the read-only gate was served through a
// non-superuser `app_login` pool, the promote's point-of-no-return write went through a separate
// table-owner connection, and the promoted primary's fiscal drain ran as the deployment role. There
// is no role on this engine — `pg.connectAs` has no counterpart — and there is no second
// connection either: `PromoteDeps.db` is ONE handle (`promote.ts:40-52`) and boot opens the venue
// directory once. Nothing below now distinguishes a write the deployment role may make from one it
// may not.
//
// **Step 5, `non-owner WAITRON_ADMIN_DATABASE_URL → 500 promotion.failed, node unchanged; unset →
// falls back and succeeds`, is DELETED: its subject no longer exists.** It booted a node whose
// `WAITRON_ADMIN_DATABASE_URL` named the non-owner `app_login` role, so the promote's owner write
// was refused `42501` and surfaced as a loud 500 rather than a silent no-op, and then booted the
// same node with the variable unset to show the fallback to the migrations URL. That variable is
// gone from the CODE, and the scope is the whole receipt:
// `grep -rn WAITRON_ADMIN_DATABASE_URL apps packages scripts deploy .github` returns only these
// three comment lines (run 2026-09-23). The UNSCOPED grep over the worktree is not zero and never
// will be — it also reaches the retired plans and specs under `docs/superpowers/`, which record the
// variable as it was. `grep -c 'DATABASE_URL\|databaseUrl' apps/server/src/config.ts` returns 0, so
// config reads no connection URL at all, and there is no second connection for a
// promote to fail over to. **What is no longer covered:** that a promote whose point-of-no-return
// write is refused fails CLOSED — a 500 with the deployment untouched — rather than reporting
// success. The failure mode it guarded (a promote that half-succeeds) is not reachable through a
// connection this box may not write with any more, but nothing has re-derived what else could
// refuse that write on this engine.
//
// STEP 1 WAS RED FROM ITS `awaitingFiscalCertificate` POLL ONWARD, ON A BROKEN PRODUCT FUNCTION,
// AND IT PASSES NOW. `drain`'s `workIsDue` (`packages/fiscal-verifactu/src/drain.ts`) used to issue
// `select envios_work_due(<instant>::timestamptz)`. Measured here 2026-09-22 on this suite's OWN
// venue directory, after the sale: the statement as written threw `unrecognized token: ":"` at the
// cast, and with the cast removed `no such function: envios_work_due`. Nothing created that
// function — `packages/fiscal-verifactu/drizzle/` holds one baseline and it names no such thing. So
// the promoted primary's fiscal pass failed outright (`duty.failed` with `fiscal.drain`, every
// pass) instead of finding due work and skipping it for want of a certificate, and the
// awaiting-cert cell never flipped. This box is `WAITRON_ENV=production`, which is why the failure
// showed here and not in a preproduction boot: `fiscalDrainEnabled` (`onboarding-policy.ts`)
// short-circuits a preproduction pass to an empty result before any SQL runs. `workIsDue` is an
// ordinary query now and the step passes unedited.

// `undici`'s `fetch` is mocked to REJECT so no background pull/tunnel dial reaches a real host; Node's
// own global `fetch` (a distinct module identity — see boot.promote.test.ts) still serves the probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in promote-endpoint-e2e.test.ts")),
    ),
  };
});

const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-e2e-state-"));
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

// Short ticks so the boot loop's first (empty) pass — and, after the sale, the skip that flips the
// awaiting-cert cell — land inside the poll budget without a long idle sleep.
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

// The mirror's OWN venue ids — one venue, seeded identically on each venue directory (each is
// migrated and seeded afresh, so the fixed ids never collide across them).
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // inert, must be overwritten
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // the primary this mirror pulls
const MIRROR_NUMERO_INSTALACION = 7;

// The admin the promote endpoint authenticates (role `admin` is the only role holding `node.promote`).
// The SAME person carries a dashboard email + password so it also logs a management session in for the
// box-status read (`till.configure`, which admin holds). `password_hash` backs BOTH login paths; a
// `pin_hash` is supplied because the column is NOT NULL.
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_EMAIL = "admin@promote-e2e.test";
const ADMIN_PW = "correct-horse-battery-staple";

// The staff operator the till session logs in (device-gated PIN login), so the sale is attributed and
// files under the promoted node's SIF.
const STAFF_ID = "88888888-8888-4888-8888-888888888888";
const STAFF_PIN = "5555";

// A seeded till device bound to the venue's own till — the sale resolves its `till_id` from THIS device
// (SP-A.2 cutover), and the `waitron_device=<id>.<token>` cookie authenticates against the seeded row.
const DEVICE_ID = "77777777-7777-4777-8777-777777777777";
const DEVICE_TOKEN = "promote-e2e-device-token";
const DEVICE_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const DEVICE_COOKIE_HEADER = `${DEVICE_COOKIE}=${DEVICE_ID}.${DEVICE_TOKEN}`;

// Two venue directories: the main happy-path arc (which promotes destructively) and the break-glass
// promote. Each is migrated and seeded on its own, so one test's deployment flip never leaks into
// another's. A directory is migrated through `applyMigrations` — the product's own entry point,
// which installs each set's append-only triggers as well as its tables — and boot's own re-run over
// the same directory is a no-op. The handle beside it stays open alongside the booted server's own
// open of the same directory, which write-ahead mode and the store's `busy_timeout` allow
// (`packages/store/src/index.ts`).
const VENUES = ["main", "breakGlass"] as const;
type VenueName = (typeof VENUES)[number];
const venueDir = {} as Record<VenueName, string>;
const stores = {} as Record<VenueName, VenueDatabase>;
const db = {} as Record<VenueName, Database>;

let migrationsRoot: string;

// SAFETY (CLAUDE.md §4/§5): a promote's point of no return schedules a REAL
// `process.kill(process.pid, "SIGTERM")` on the next macrotask (`boot.ts:2259`), and the manual
// `startServer` in each case IS that restart.
//
// FILE-scoped, and restored only once every case has finished, because a per-case spy restored in a
// `finally` does NOT cover it here: the reads a case takes between its promote and its own teardown
// resolve without yielding to the macrotask queue on this engine, so the restore runs BEFORE the
// timer fires and the signal reaches the vitest worker — which exits silently, taking the rest of
// the file's results with it. Measured 2026-09-22 with a `process.on("SIGTERM")` probe on the
// per-case shape: two signals arrived, both after the last per-case restore, and the run reported
// `Tests 1 failed (4)` with three results lost.
let killSpy: MockInstance<typeof process.kill>;

/** Seed a fresh venue directory as a read-only adopted mirror holding its OWN dormant identity (R2/R3a), plus the
 * admin the promote endpoint + box-status authenticate — the shape boot.promote-endpoint.test.ts uses.
 * Returns the cloud's own nodeId + the reserved standard series id the promote must correct trading.env
 * to. Deployment is stamped production then mode='mirror'. */
async function seedMirror(admin: Database): Promise<{ nodeId: string; standardSeriesId: string }> {
  // Every fixture row in this file goes in through its TABLE DEFINITION, the same change
  // `packages/db/src/testing/seed.ts` and `testing/fiscal-fixtures.ts` took. Two reasons: a raw
  // insert reaches no `$defaultFn` generator, and `created_at` on `tenants`, `tills`, `persons`,
  // `device_profiles`, `devices` and `kitchen_stations` is one of those on this engine; and
  // `array['en']::text[]` / `'[]'::jsonb` are PostgreSQL array and cast syntax refused at prepare
  // here. `on conflict do nothing` stays UNTARGETED, as the statements it replaces were —
  // narrowing it would be a behaviour change this conversion is not making.
  await admin
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote E2E Cloud SL" })
    .onConflictDoNothing();
  await admin
    .insert(locations)
    .values({
      id: MIRROR_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  const t = await admin.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = 1`);
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: admin, ring: RING },
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
  await writeNodeMembership(admin, held);

  await writeMirrorConfig(admin, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  // The admin/manager the endpoint + box-status authenticate. Through the table definition, not raw
  // SQL: `persons.created_at` is a `$defaultFn` generator on a NOT NULL column
  // (`packages/identity/src/schema/persons.ts`), which a raw statement reaches no generator for.
  await admin
    .insert(persons)
    .values({
      id: ADMIN_ID,
      displayName: "Promote Admin",
      email: ADMIN_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(ADMIN_PW),
      role: "admin",
    })
    .onConflictDoNothing();

  await stampDeployment(admin, "production");
  await setDeploymentMode(admin, "mirror");
  const standardSeriesId = await readStandardSeriesId(admin, standby.nodeId);
  return { nodeId: standby.nodeId, standardSeriesId };
}

/** Seed the venue-sale prerequisites onto the mirror's venue directory, so the PROMOTED primary can
 * ring a real cash sale over HTTP that chains on its own reserved SIF: a till bound to the venue, a
 * catalogue with one sellable product, a staff operator on a known PIN, and an enrolled till device
 * (`token_hash` = scrypt of `DEVICE_TOKEN`, the same shape `acceptDeviceJoinRequest` stores, so the
 * device cookie verifies). */
async function seedSaleVenue(admin: Database, nodeId: string): Promise<void> {
  await seedLegacySellingUnits(admin);
  await admin
    .insert(tills)
    .values({ id: MIRROR_TILL_ID, locationId: MIRROR_LOCATION_ID, name: "Barra" })
    .onConflictDoNothing();
  await admin
    .insert(persons)
    .values({
      id: STAFF_ID,
      displayName: "Cajera",
      pinHash: hashPin(STAFF_PIN),
      role: "staff",
    })
    .onConflictDoNothing();
  await admin
    .insert(deviceProfiles)
    .values({
      id: DEVICE_PROFILE_ID,
      name: "Counter",
      formFactor: "till",
      // The empty capability list, handed over as a value: the column's own write mapping is what
      // encodes it, where the raw statement spelled a PostgreSQL jsonb cast.
      capabilities: [],
    })
    .onConflictDoNothing();
  await admin
    .insert(devices)
    .values({
      id: DEVICE_ID,
      locationId: MIRROR_LOCATION_ID,
      deviceProfileId: DEVICE_PROFILE_ID,
      tillId: MIRROR_TILL_ID,
      label: "Counter till",
      tokenHash: hashSecret(DEVICE_TOKEN),
    })
    .onConflictDoNothing();
  await admin
    .insert(kitchenStations)
    .values({
      locationId: MIRROR_LOCATION_ID,
      name: "Kitchen",
      displayOrder: 0,
      isDefault: true,
      active: true,
    })
    .onConflictDoNothing();

  await withTransaction(admin, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const drinks = await createCategory(tx, { name: { en: "Bebidas" } });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Mineral water",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, brandLocationId(MIRROR_LOCATION_ID), cat.id);
  });
  // Silence an unused-parameter lint without changing the seed shape: nodeId scopes nothing here (the
  // venue rows key on tenant/location/till), but it documents which node this venue promotes onto.
  void nodeId;
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  for (const name of VENUES) {
    venueDir[name] = await mkdtemp(join(tmpdir(), `waitron-promote-e2e-venue-${name}-`));
    await applyMigrations(venueDir[name], fromSource);
    stores[name] = await openVenueDatabase(venueDir[name]);
    db[name] = stores[name].venue;
  }
}, 180_000);

afterAll(async () => {
  if (killSpy !== undefined) killSpy.mockRestore();
  // Every file is closed before the directory holding it is removed, and each step is guarded on its
  // own so a store that never opened does not stop the rest of the teardown.
  for (const name of VENUES) if (stores[name] !== undefined) await stores[name].close();
  for (const name of VENUES)
    if (venueDir[name] !== undefined) await rm(venueDir[name], { recursive: true, force: true });
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
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

/** Polls `predicate` up to ~15s for its first defined value, THROWING on timeout so a call site can
 * never silently proceed on an unmet condition. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 300; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~15s");
}

/** POST the promote endpoint with a JSON body. */
async function postPromote(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The mirror boot env for `dir` at `port`, seeded venue overriding KEY_ENV's absence of till ids. */
function mirrorEnv(
  dir: string,
  port: number,
  nodeId: string,
  stateDir: string,
): Record<string, string> {
  return {
    ...KEY_ENV,
    ...TICK_ENV,
    WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
    WAITRON_TILL_NODE_ID: nodeId,
    WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
    WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
    WAITRON_VENUE_DIR: dir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_STATE_DIR: stateDir,
  };
}

/** Read the observable columns of every envío for a tenant — the "was it submitted?" evidence. */
async function readEnvios(
  admin: Database,
): Promise<{ estado: string; intentos: number; incidencia: boolean }[]> {
  // A RAW read skips drizzle's decoding, and this engine stores a boolean as 0/1 — so `incidencia`
  // is read as the integer it is stored as and compared back to a boolean here, rather than the
  // expectation being loosened to whatever came out.
  const rows = await admin.execute<{ estado: string; intentos: number; incidencia: number }>(
    sql`select estado, intentos, incidencia from envios order by registro_id`,
  );
  return rows.rows.map((row) => ({ ...row, incidencia: row.incidencia === 1 }));
}

describe("promote endpoint e2e — the whole arc over HTTP", () => {
  // STEP 1 (+ its refusals and the real-boot gate control) — the headline receipt.
  it("admin login → 200 restarting; restart into primary; sells + chains on its own reserved SIF; does NOT file", async () => {
    const seed = await seedMirror(db.main);
    await seedSaleVenue(db.main, seed.nodeId);
    await mintBreakGlassSecret(db.main); // a verifier exists (an adopted mirror always has one)

    const mirrorPort = await freePort();
    const mirrorBase = `http://127.0.0.1:${mirrorPort}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-main-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    // Cleared, not installed, here: the spy is file-scoped (see its declaration), so the assertion
    // below is about THIS case's restart.
    killSpy.mockClear();

    const mirror = await startServer(
      mirrorEnv(venueDir.main, mirrorPort, seed.nodeId, stateDir),
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    let primary: StartedServer | undefined;
    try {
      await poll(async () => mirror.health.lastPassAt ?? undefined);

      // STEP 3 (refusals), run first on the still-unpromoted mirror so they leave it untouched:
      // a wrong break-glass → 401, node stays a mirror.
      const wrongBg = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        breakGlass: "not-the-secret",
      });
      expect(wrongBg.status).toBe(401);
      expect((await wrongBg.json()).error.code).toBe("promotion.break_glass_invalid");
      expect(await readDeploymentMode(db.main)).toBe("mirror");

      // A valid admin credential but `oldNodeNeutralised:false` → 400 fence_not_attested, node unchanged.
      const unattested = await postPromote(mirrorBase, {
        oldNodeNeutralised: false,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(unattested.status).toBe(400);
      expect((await unattested.json()).error.code).toBe("promotion.fence_not_attested");
      expect(await readDeploymentMode(db.main)).toBe("mirror");

      // STEP 4 (gate control, real boot): an ordinary write POST is refused by the read-only gate (403
      // node.read_only), so the promote POST reaching the handler above is the EXEMPTION's doing — not a
      // disabled gate. (The negative-control deletion is the separate exemption-clause test below.)
      const write = await fetch(`${mirrorBase}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // STEP 1 (happy path): a valid admin login + the attestation → 200, promoted, restarting.
      const res = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });

      // The point-of-no-return committed: deployment flipped to (primary, primary), and the restart
      // SIGTERM was scheduled (into the spy, never fired for real).
      expect(await readDeploymentMode(db.main)).toBe("primary");
      expect(await readSingletonRole(db.main)).toBe("primary");
      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      // trading.env was rewritten to the cloud's OWN reserved standard series (spec §4.3), NOT the inert
      // designated series it booted with — this is what the restart below numbers under.
      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted.WAITRON_TILL_SERIES_ID).toBe(seed.standardSeriesId);
      expect(persisted.WAITRON_TILL_SERIES_ID).not.toBe(MIRROR_DESIGNATED_SERIES_ID);

      // Restart into mode=primary: close the mirror and boot from the persisted trading.env (the box
      // the supervisor would source). `trading.env` names NO storage — the venue directory reaches
      // both processes through the supervisor's own environment (`trading-config.ts:15-20`) — so the
      // directory is supplied here rather than read back out of the file.
      await mirror.close();
      const primaryPort = await freePort();
      const primaryBase = `http://127.0.0.1:${primaryPort}`;
      primary = await startServer({
        ...KEY_ENV,
        ...TICK_ENV,
        WAITRON_TILL_TILL_ID: persisted.WAITRON_TILL_TILL_ID!,
        WAITRON_TILL_NODE_ID: persisted.WAITRON_TILL_NODE_ID!,
        WAITRON_TILL_SERIES_ID: persisted.WAITRON_TILL_SERIES_ID!, // the reserved series the promote wrote
        WAITRON_TILL_LOCATION_ID: persisted.WAITRON_TILL_LOCATION_ID!,
        WAITRON_VENUE_DIR: venueDir.main,
        WAITRON_HTTP_PORT: String(primaryPort),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      });
      await poll(async () => primary!.health.lastPassAt ?? undefined);

      // The restarted box is a selling primary now: /api/node answers acceptingSales:true (boot-captured
      // — a mirror answers false; only the fresh mode=primary boot flips it true).
      const node = await (await fetch(`${primaryBase}/api/node`)).json();
      expect(node.acceptingSales).toBe(true);

      // SELLS + CHAINS LOCALLY: ring a real cash sale over the HTTP surface. The seeded device cookie
      // authenticates, the staff operator logs in, and POST /api/sales files a chained fiscal record.
      expect(
        (await fetch(`${primaryBase}/api/device/me`, { headers: { cookie: DEVICE_COOKIE_HEADER } }))
          .status,
      ).toBe(200);
      const login = await fetch(`${primaryBase}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: DEVICE_COOKIE_HEADER },
        body: JSON.stringify({ personId: STAFF_ID, pin: STAFF_PIN }),
      });
      expect(login.status).toBe(200);
      const sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const bothCookies = `${sessionCookie}; ${DEVICE_COOKIE_HEADER}`;

      const products = (await (
        await fetch(`${primaryBase}/api/products`, { headers: { cookie: sessionCookie } })
      ).json()) as { products: { id: string; pricingUnit: string }[] };
      const water = products.products.find((p) => p.pricingUnit === "each")!;

      const saleRes = await fetch(`${primaryBase}/api/sales`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: bothCookies },
        body: JSON.stringify({
          lines: [{ productId: water.id, quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
        }),
      });
      expect(saleRes.status).toBe(200);
      const ticket = await saleRes.json();
      expect(ticket.total).toBe("3.00");
      // A genuine first filing carries the AEAT verification QR — chained locally, no AEAT round trip.
      expect(typeof ticket.qr).toBe("string");
      expect(ticket.qr.length).toBeGreaterThan(0);

      // A GENUINE chained fiscal record exists for the promoted node, on its OWN reserved SIF: exactly
      // one registro, a 64-hex huella, keyed to the node's non-revoked reserved SIF.
      const reservedSif = await db.main.execute<{ id: string }>(
        sql`select id from registro_sif where node_id = ${seed.nodeId} and revocado_en is null`,
      );
      const registros = await db.main.execute<{
        huella: string;
        node_id: string;
        sif_id: string;
      }>(
        sql`select huella, node_id, sif_id from registros_facturacion where node_id = ${seed.nodeId}`,
      );
      expect(registros.rows).toHaveLength(1);
      expect(registros.rows[0]!.huella).toMatch(/^[0-9A-F]{64}$/);
      expect(registros.rows[0]!.sif_id).toBe(reservedSif.rows[0]!.id);

      // DOES NOT FILE: the primary's real fiscal pass finds the due envío, has no `fiscal.aeat` cert, and
      // SKIPS it — so box-status flips awaitingFiscalCertificate:true and the envío is never submitted.
      //
      // RED FROM HERE ON, and it is the product that is broken, not these assertions: every pass's
      // fiscal drain throws before it can find the due envío (the file header carries the two
      // measurements), so the awaiting-cert cell never flips and the poll below times out. The
      // assertions are left as they are — weakening them to something that passes would hide a
      // fiscal duty that does not run at all.
      const mgmtLogin = await fetch(`${primaryBase}/management-api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW }),
      });
      expect(mgmtLogin.status).toBe(200);
      const mgmtCookie = mgmtLogin.headers.get("set-cookie")!.split(";")[0]!;
      const awaiting = await poll(async () => {
        const status = await (
          await fetch(`${primaryBase}/api/box/status`, { headers: { cookie: mgmtCookie } })
        ).json();
        return status.awaitingFiscalCertificate === true ? status : undefined;
      });
      expect(awaiting.awaitingFiscalCertificate).toBe(true);

      // The envío was never submitted — still pendiente, never attempted (a missing cert skips the
      // whole pass BEFORE the claim, so intentos stays 0).
      expect(await readEnvios(db.main)).toEqual([
        { estado: "pendiente", intentos: 0, incidencia: false },
      ]);
    } finally {
      if (primary !== undefined) await primary.close().catch(() => undefined);
      await mirror.close().catch(() => undefined);
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 120_000);

  // STEP 2 — the break-glass path: the offline fallback authorizes a promote with no login at all.
  it("break-glass secret → 200 promoted (no login)", async () => {
    const seed = await seedMirror(db.breakGlass);
    const breakGlass = await mintBreakGlassSecret(db.breakGlass);

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-bg-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer(
      mirrorEnv(venueDir.breakGlass, port, seed.nodeId, stateDir),
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      const res = await postPromote(base, { oldNodeNeutralised: true, breakGlass });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(await readDeploymentMode(db.breakGlass)).toBe("primary");
      expect(await readSingletonRole(db.breakGlass)).toBe("primary");
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 90_000);
});

// STEP 4 — the read-only-gate hole, proven by DELETION at the exemption-clause level (CLAUDE.md §4). The
// real booted mirror above already proves the exemption is IN PLACE (the promote POST reaches the handler
// while an ordinary write POST is 403). Here the negative control: a read-only gate WITHOUT the
// `/management-api/promote` clause turns the same authorized-shaped promote POST into a 403 node.read_only,
// and restoring the clause lets it reach the handler again. This exercises the exact `readOnlyGate`
// predicate boot.ts builds; it needs no boot (the gate is a pure middleware). Prove-by-deletion in
// boot.ts's own source is documented in the task report (removed the clause, saw the authorized promote
// become 403, restored it — boot.ts unchanged at commit).
describe("read-only-gate exemption for the promote POST — proven by deletion", () => {
  // A `run` that would ALWAYS promote if reached — so a 403 is unambiguously the gate, not the handler.
  const alwaysRun = () => Promise.resolve({ alreadyPrimary: false, restarting: true });
  // The exact exemption clause boot.ts installs (boot.ts ~line 1011).
  const promoteExempt = (c: { req: { method: string; path: string } }) =>
    c.req.method === "POST" && c.req.path === "/management-api/promote";

  function appWith(
    exempt: ((c: { req: { method: string; path: string } }) => boolean) | undefined,
  ): Hono {
    const app = new Hono();
    app.use(
      "*",
      readOnlyGate(() => true, exempt),
    ); // a read-only mirror (isReadOnly always true)
    mountPromoteApi(app, { appDb: db.main, run: alwaysRun });
    return app;
  }

  it("WITH the exemption clause: an ordinary write POST is 403 but the promote POST reaches the handler", async () => {
    const app = appWith(promoteExempt);

    const write = await app.request("/management-api/catalogues", { method: "POST", body: "{}" });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

    // No credential in the body → the handler's own credential screen answers 401 password.invalid. A
    // 401 (not the gate's 403) is proof the exempt POST reached the real handler.
    const promote = await app.request("/management-api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldNodeNeutralised: true }),
    });
    expect(promote.status).toBe(401);
    expect((await promote.json()).error.code).toBe("password.invalid");
  });

  it("WITHOUT the exemption clause (deletion): the SAME promote POST is blocked 403 node.read_only", async () => {
    const app = appWith(undefined);

    const promote = await app.request("/management-api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldNodeNeutralised: true }),
    });
    expect(promote.status).toBe(403);
    expect(await promote.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  });
});
