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
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { parseEnvFile } from "./env-file.js";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";

// A booted local secondary (mode='primary', singleton_role='secondary') files nothing; an
// in-process promote flips singleton_role live, and the running fiscal pass starts draining on its
// next tick, with the till surface answering 200 throughout.
//
// The suite writes through its own handles only while no server is running.
//
// `undici`'s `fetch` rejects, so the post-promote drain's AEAT submit fails fast into an observable
// attempted state instead of dialling AEAT. Node's global `fetch`, a separate module identity, still
// serves the `/api/staff` probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() => Promise.reject(new Error("undici fetch disabled in boot.promote.test.ts"))),
  };
});

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// Disables `fiscal-none` so a trading or mirror boot does not refuse `module.fiscal_slot_ambiguous`.
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);
// `WAITRON_ENV: "production"` matches the deployment stamp and `seedPendingEnvios`'s default
// `entorno`; otherwise the drain's environment guard refuses the seeded row before any submit.
const KEY_ENV = {
  // Keeps the plain-HTTP landing listener off privileged port 80.
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
// Two venue directories, so neither suite's role flips leak into the other's.
let appVenueDir: string;
let mirrorVenueDir: string;
let appDb: Database;
let mirrorDb: Database;
const openStores: VenueDatabase[] = [];

// The same credentials key boot loads, so the identity sealed here is the one the promote unseals.
const PROMOTE_RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

/** Includes a node identity, so the promote's membership-document mint has a key to sign with. */
async function seedTillIdentity(db: Database): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
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

/** Migrated here, not by boot, because the identity rows have to exist before boot reads them. */
async function migratedVenue(): Promise<[string, Database]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-promote-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue];
}

beforeAll(async () => {
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

  await stampDeployment(appDb, "production");
  await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "secondary");
  expect(await readDeploymentMode(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("primary");
  expect(await readSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("secondary");
}, 180_000);

afterAll(async () => {
  while (openStores.length > 0) await openStores.pop()?.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  for (const directory of [appVenueDir, mirrorVenueDir]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** `WAITRON_HTTP_PORT` refuses "0", so the OS picks a free port first. */
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

/** Up to ~10s: the boot loop's wall clock is not injectable, so passes are observed by polling. */
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

/** One due `envios` row and a usable `fiscal.aeat` credential, so a singleton's drain tries it. */
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

/** A raw statement reaches no column mapper, so the `incidencia` flag arrives as 1 or 0. */
async function readEnvio(
  registroId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await appDb.execute<{ estado: string; intentos: number; incidencia: number }>(
    sql`select estado, intentos, incidencia from envios where registro_id = ${registroId}`,
  );
  const row = rows.rows[0]!;
  return { estado: row.estado, intentos: row.intentos, incidencia: row.incidencia === 1 };
}

/** Keeps the shared directory order-independent; `incidents` has no registro id, so it is cleared
 * wholesale. Every caller runs after `server.close()`. */
async function cleanupFiscalWork(seeded: { registroIds: string[] }): Promise<void> {
  await appDb.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
  await appDb.execute(sql`delete from incidents `);
}

// Short ticks so both passes land inside the poll budget: an idle secondary's empty pass returns
// `nextDueAt: null`, so the loop would otherwise sleep `maxTickMs`.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

describe("promote: local secondary → primary, live", () => {
  it("does not file as a secondary, then files on the next tick after a live promote — tills answer throughout", async () => {
    // A prior test may have flipped the shared directory's singleton_role to 'primary'.
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
      // Phase A — a secondary: the loop is live, but its fiscal pass is empty.
      await waitForPass(server.health);

      expect(server.promoteLocalSecondaryToPrimary).toBeDefined();
      expect(server.promoteMirrorToPrimary).toBeUndefined();
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 0,
        incidencia: false,
      });
      const staffA = await fetch(`${base}/api/staff`);
      expect(staffA.status).toBe(200);
      expect(await staffA.json()).toEqual([]);

      const result = await server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: true });
      expect(result).toEqual({ alreadyPrimary: false });
      expect(await readSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("primary");

      // Phase B — now the singleton. Poll on `incidencia`, set as the LAST step of a failed attempt,
      // not `intentos`, set at claim while estado is still 'enviando'.
      await poll(async () => ((await readEnvio(registroIds[0]!)).incidencia ? true : undefined));
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 1,
        incidencia: true,
      });

      const staffB = await fetch(`${base}/api/staff`);
      expect(staffB.status).toBe(200);
      expect(await staffB.json()).toEqual([]);
    } finally {
      await server.close();
      await cleanupFiscalWork(seeded);
    }
  }, 60_000);

  it("refuses an unattested promote and keeps filing off", async () => {
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
      await waitForPass(server.health);

      const error = await captureError(() =>
        server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: false }),
      );
      expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");

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

// A booted mirror's promote flips mode and singleton_role to primary, rewrites `trading.env` with
// the cloud's own reserved standard series id, and schedules a restart.

// The mirror boots with the primary's inert designated series, which the promote must overwrite.
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MIRROR_NUMERO_INSTALACION = 7;

/** A mirror holding its own dormant identity. */
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
  // A placeholder signature: the promote signer only attaches it to the minted document.
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
    // Its own state dir, so the rewritten `trading.env` can be read back.
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-mirror-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
      WAITRON_TILL_NODE_ID: seed.nodeId,
      WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
      WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
      WAITRON_VENUE_DIR: mirrorVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      // `server` is never assigned on a failed boot, so the `finally` below cannot clean up.
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    // The promote schedules a SIGTERM at this process; the spy must be in place before it runs.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      expect(server.promoteMirrorToPrimary).toBeDefined();
      expect(server.promoteLocalSecondaryToPrimary).toBeUndefined();

      const result = await server.promoteMirrorToPrimary!({ oldNodeNeutralised: true });
      expect(result).toEqual({ alreadyPrimary: false, seriesId: seed.standardSeriesId });

      expect(await readDeploymentMode(mirrorDb, seed.nodeId)).toBe("primary");
      expect(await readSingletonRole(mirrorDb, seed.nodeId)).toBe("primary");

      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

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
