import { cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import { BACKUP_ROOM_NOTE_FILE } from "@waitron/provisioning";
import {
  captureError,
  locations,
  nodes,
  readStandardSeriesId,
  openVenueDatabase,
  stampDeployment,
  tenants,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { readNodeMode, setNodeMode, setSingletonRole, writeMirrorLink } from "@waitron/node-db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { generateNodeKeyPair, signDocumentBody, type Endorsement } from "@waitron/membership";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { withCapturedStdout } from "./testing/boot-harness.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { withPromotionModuleOperation } from "./promotion-operation.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { establishDormantContract } from "./testing/dormant-contract.js";
import { writeAllocationInput } from "./testing/allocation-input.js";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { invoiceSeries } from "@waitron/db";
import { parseEnvFile } from "./env-file.js";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { freePort } from "./testing/free-ports.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

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

const TILL_LOCATION_ID = "55555555-5555-4555-8555-555555555555";
const TILL_ENV = {
  WAITRON_NODE_ID: "33333333-3333-4333-8333-333333333333",
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
let appNode: NodeDatabase;
let mirrorDb: Database;
let mirrorNode: NodeDatabase;
const openStores: VenueDatabase[] = [];

// The same credentials key boot loads, so the identity sealed here is the one the promote unseals.
const PROMOTE_RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

/** Includes a node identity, so the promote's membership-document mint has a key to sign with. */
async function seedTillIdentity(db: Database, node: NodeDatabase): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90111111H", legalName: "Promote Till SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: TILL_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_NODE_ID,
      locationId: TILL_LOCATION_ID,
      name: "Promote node",
    })
    .onConflictDoNothing();
  await establishNodeIdentity({ ownerDb: db, node, ring: PROMOTE_RING }, TILL_ENV.WAITRON_NODE_ID);
}

/** Migrated here, not by boot, because the identity rows have to exist before boot reads them. */
async function migratedVenue(): Promise<[string, Database, NodeDatabase]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-promote-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue, store.node];
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  [appVenueDir, appDb, appNode] = await migratedVenue();
  [mirrorVenueDir, mirrorDb, mirrorNode] = await migratedVenue();
  await seedTillIdentity(appDb, appNode);

  await stampDeployment(appDb, "production");
  await setSingletonRole({ venue: appDb, node: appNode }, TILL_ENV.WAITRON_NODE_ID, "secondary");
  expect((await readNodeMode(appNode, TILL_ENV.WAITRON_NODE_ID)).mode).toBe("primary");
  expect((await readNodeMode(appNode, TILL_ENV.WAITRON_NODE_ID)).singletonRole).toBe("secondary");
}, 180_000);

afterAll(async () => {
  while (openStores.length > 0) await openStores.pop()?.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  for (const directory of [appVenueDir, mirrorVenueDir]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

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
      locationId: TILL_LOCATION_ID,
      nodeId: TILL_ENV.WAITRON_NODE_ID,
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

/** A prior test may have promoted the shared directory's node. Its chart goes too, or the start
 * would finish that promotion's role from it. */
async function resetLocalSecondary(): Promise<void> {
  await setSingletonRole({ venue: appDb, node: appNode }, TILL_ENV.WAITRON_NODE_ID, "secondary");
  await appDb.execute(sql`delete from node_membership`);
}

describe("historical promote: local secondary → primary, live", () => {
  it("does not file as a secondary, then files on the next tick after a live promote — tills answer throughout", async () => {
    await resetLocalSecondary();
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
    const base = `http://127.0.0.1:${httpPort()}`;
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
      expect((await readNodeMode(appNode, TILL_ENV.WAITRON_NODE_ID)).singletonRole).toBe("primary");

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
    await resetLocalSecondary();
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

      expect((await readNodeMode(appNode, TILL_ENV.WAITRON_NODE_ID)).singletonRole).toBe(
        "secondary",
      );
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

const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** A mirror holding its own dormant identity. */
async function seedMirrorIdentity(
  db: Database,
  node: NodeDatabase,
): Promise<{ nodeId: string; fixture: ReturnType<typeof allocationFixture> }> {
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
  const fixture = await establishDormantContract({
    db: db,
    node,
    ring: PROMOTE_RING,
    locationId: MIRROR_LOCATION_ID,
    sourceId: MIRROR_ORIGIN_NODE_ID,
    taxpayerNif: nif,
    standby,
    endorsement,
    modules: ALL_MODULES,
    operatorId: "contract-administrator",
    recoveryKey: true,
  });

  // A held term-3 chart: the outgoing primary serving, this node secondary — the promote bumps it to 4.
  // Signed by the outgoing primary's key, which this box pins as adopt would.
  const origin = generateNodeKeyPair();
  const held = signedMembershipDoc(3, {
    signerNodeId: MIRROR_ORIGIN_NODE_ID,
    keyPair: origin,
    nodes: [
      { nodeId: MIRROR_ORIGIN_NODE_ID, contactUrl: "https://old", standing: "serving-primary" },
      { nodeId: standby.nodeId, contactUrl: "", standing: "serving-secondary" },
    ],
  });
  await writeNodeMembership(db, held);
  await pinMainBoxKey(node, standby.nodeId, {
    nodeId: MIRROR_ORIGIN_NODE_ID,
    publicKey: origin.publicKey,
  });

  await writeMirrorLink(node, standby.nodeId, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  // Deployment: production (matching WAITRON_ENV) then mode='mirror' (co-sets singleton_role='secondary').
  await stampDeployment(db, "production");
  await setNodeMode({ venue: db, node }, standby.nodeId, "mirror");
  return { nodeId: standby.nodeId, fixture };
}

describe("historical promote: mirror → primary, in-process, restart-into-primary", () => {
  it("exposes promoteMirrorToPrimary, promotes, and persists identity without a series cache", async () => {
    const seed = await seedMirrorIdentity(mirrorDb, mirrorNode);
    const secret = await mintBreakGlassSecret({ venue: mirrorDb, node: mirrorNode }, seed.nodeId);
    const port = await freePort();
    // Its own state dir, so the rewritten `trading.env` can be read back.
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-mirror-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);
    const allocationEnv = await writeAllocationInput(stateDir, seed.fixture, "promote");
    for (const [key, value] of Object.entries(allocationEnv)) vi.stubEnv(key, value);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_NODE_ID: seed.nodeId,
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

      const request = seed.fixture.request("promote");
      const result = await server.promoteMirrorToPrimary!(
        { oldNodeNeutralised: true },
        (context, consume) =>
          withPromotionModuleOperation(
            {
              db: context.db,
              node: context.nodeDb,
              nodeId: seed.nodeId,
              credentialKeyRing: TOTP_KEY_RING,
              modules: ALL_MODULES,
            },
            { binding: request.binding, input: request.input },
            { breakGlass: secret },
            (runner) => runner(context, consume),
          ),
      );
      const activeSeriesId = await readStandardSeriesId(mirrorDb, seed.nodeId);
      expect(
        (await mirrorDb.select().from(invoiceSeries)).find((row) => row.id === activeSeriesId)
          ?.code,
      ).toBe("FA-P000042");
      expect(result).toEqual({ alreadyPrimary: false, seriesId: activeSeriesId });
      expect(await server.promoteMirrorToPrimary!({ oldNodeNeutralised: true })).toEqual({
        alreadyPrimary: true,
        seriesId: activeSeriesId,
      });

      expect((await readNodeMode(mirrorNode, seed.nodeId)).mode).toBe("primary");
      expect((await readNodeMode(mirrorNode, seed.nodeId)).singletonRole).toBe("primary");

      // The read-only gate has lifted, so a write route mounted on the mirror answers its own
      // refusal; the agent routes boot left unmounted on the mirror stay absent until a restart.
      const base = `http://127.0.0.1:${httpPort()}`;
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(401);
      const pageClaim = await fetch(`${base}/print-api/agent/page-jobs/claim`, { method: "POST" });
      expect(pageClaim.status).toBe(404);

      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted).not.toHaveProperty("WAITRON_TILL_SERIES_ID");
      expect(await readStandardSeriesId(mirrorDb, seed.nodeId)).toBe(activeSeriesId);
      expect(persisted.WAITRON_NODE_ID).toBe(seed.nodeId);
      expect(persisted.WAITRON_ENV).toBe("production");
      await server.close();
      await mirrorDb.execute(
        sql`update locations set time_zone = 'Invalid/Zone' where id = ${MIRROR_LOCATION_ID}`,
      );
      const records = mirrorDb.all(sql`select * from registros_facturacion order by secuencia`);
      const attempts = mirrorDb.all(sql`select * from envios order by registro_id`);
      const restarted = await startServer({
        ...KEY_ENV,
        ...TICK_ENV,
        ...persisted,
        WAITRON_VENUE_DIR: mirrorVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      });
      try {
        const node = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
        expect(await node.json()).toEqual({ acceptingSales: false });
        const health = await fetch(`http://127.0.0.1:${httpPort()}/health`);
        expect(await health.json()).toEqual({ ok: true, tradingAvailable: false });
        expect(restarted.promoteMirrorToPrimary).toBeUndefined();
        expect(mirrorDb.all(sql`select * from registros_facturacion order by secuencia`)).toEqual(
          records,
        );
        expect(mirrorDb.all(sql`select * from envios order by registro_id`)).toEqual(attempts);
        expect((await readNodeMode(mirrorNode, seed.nodeId)).mode).toBe("primary");
      } finally {
        await restarted.close();
      }
    } finally {
      await server.close();
      killSpy.mockRestore();
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("a mirror's promotion whose role write is lost", () => {
  async function bootMirror(
    venueDir: string,
    stateDir: string,
    nodeId: string,
    extraEnv: Record<string, string> = {},
  ) {
    return startServer({
      ...KEY_ENV,
      ...extraEnv,
      ...TICK_ENV,
      WAITRON_NODE_ID: nodeId,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    });
  }

  async function writeStatus(): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/catalogues`, {
      method: "POST",
      body: "{}",
    });
    return response.status;
  }

  it("a promotion whose role write is lost finishes at the next start, activating once", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = await mintBreakGlassSecret({ venue: db, node }, seed.nodeId);
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-lost-role-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);
    const allocationEnv = await writeAllocationInput(stateDir, seed.fixture, "promote");
    for (const [key, value] of Object.entries(allocationEnv)) vi.stubEnv(key, value);
    await node.execute(
      sql`create trigger refuse_role_update before update on node_mode begin select raise(abort, 'role refused'); end`,
    );
    await node.execute(
      sql`create trigger refuse_role_insert before insert on node_mode begin select raise(abort, 'role refused'); end`,
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const first = await bootMirror(venueDir, stateDir, seed.nodeId, allocationEnv);
      try {
        const request = seed.fixture.request("promote");
        const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/promote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            oldNodeNeutralised: true,
            breakGlass: secret,
            moduleOperation: { binding: request.binding, input: request.input },
          }),
        });
        expect(response.status, await response.clone().text()).toBe(200);
        expect(((await response.json()) as { alreadyPrimary: boolean }).alreadyPrimary).toBe(false);
        await delay(50);
        expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      } finally {
        await first.close();
      }
      await node.execute(sql`drop trigger refuse_role_update`);
      await node.execute(sql`drop trigger refuse_role_insert`);
      expect(await readNodeMode(node, seed.nodeId)).toEqual({
        mode: "mirror",
        singletonRole: "secondary",
      });

      const second = await bootMirror(venueDir, stateDir, seed.nodeId, allocationEnv);
      try {
        expect(await readNodeMode(node, seed.nodeId)).toEqual({
          mode: "primary",
          singletonRole: "primary",
        });
        expect(await writeStatus()).toBe(401);
      } finally {
        await second.close();
      }
      const live = await db.execute<{ id: string }>(
        sql`select id from registro_sif where node_id = ${seed.nodeId} and revocado_en is null`,
      );
      expect(live.rows).toHaveLength(1);
    } finally {
      await delay(50);
      killSpy.mockRestore();
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 90_000);

  it("a held document naming this box the main box but signed with another key does not move it", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-forged-chart-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);
    const forger = generateNodeKeyPair();
    const body = {
      term: 4,
      nodes: [
        {
          nodeId: MIRROR_ORIGIN_NODE_ID,
          contactUrl: "https://old",
          standing: "sell-only" as const,
        },
        { nodeId: seed.nodeId, contactUrl: "", standing: "serving-primary" as const },
      ],
    };
    await writeNodeMembership(db, {
      body,
      signerNodeId: seed.nodeId,
      signature: signDocumentBody(body, forger.privateKey),
      endorsements: [],
    });

    try {
      const server = await bootMirror(venueDir, stateDir, seed.nodeId);
      try {
        expect(await readNodeMode(node, seed.nodeId)).toEqual({
          mode: "mirror",
          singletonRole: "secondary",
        });
        expect(await writeStatus()).toBe(403);
      } finally {
        await server.close();
      }
    } finally {
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("a mirror's promote and the backup room note", () => {
  it("is refused while the note cannot be deleted, and deletes it before promoting and before the restart", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = await mintBreakGlassSecret({ venue: db, node }, seed.nodeId);
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-note-state-"));
    const note = join(stateDir, BACKUP_ROOM_NOTE_FILE);
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);
    const allocationEnv = await writeAllocationInput(stateDir, seed.fixture, "promote");
    for (const [key, value] of Object.entries(allocationEnv)) vi.stubEnv(key, value);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_NODE_ID: seed.nodeId,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
      throw err;
    });

    const noteAtRestart: boolean[] = [];
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      noteAtRestart.push(existsSync(note));
      return true;
    });
    try {
      const request = seed.fixture.request("promote");
      let noteDuringPromotion: boolean | undefined;
      const promote = () =>
        server.promoteMirrorToPrimary!({ oldNodeNeutralised: true }, (context, consume) => {
          noteDuringPromotion = existsSync(note);
          // A backup reload while the promotion runs could write a note again.
          if (!noteDuringPromotion) writeFileSync(note, "{}");
          return withPromotionModuleOperation(
            {
              db: context.db,
              node: context.nodeDb,
              nodeId: seed.nodeId,
              credentialKeyRing: TOTP_KEY_RING,
              modules: ALL_MODULES,
            },
            { binding: request.binding, input: request.input },
            { breakGlass: secret },
            (runner) => runner(context, consume),
          );
        });

      mkdirSync(note);
      await expect(promote()).rejects.toMatchObject({
        code: expect.stringMatching(/^(EISDIR|EPERM)$/),
      });
      expect(noteDuringPromotion).toBeUndefined();
      expect((await readNodeMode(node, seed.nodeId)).mode).toBe("mirror");
      rmSync(note, { recursive: true });

      writeFileSync(note, "{}");
      expect((await promote()).alreadyPrimary).toBe(false);
      expect(noteDuringPromotion).toBe(false);
      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      expect(noteAtRestart).toEqual([false]);
    } finally {
      await server.close();
      // A promotion that went through schedules its restart signal on a later tick.
      await delay(50);
      killSpy.mockRestore();
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("restarts once and logs the failure when the note cannot be deleted after promoting", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = await mintBreakGlassSecret({ venue: db, node }, seed.nodeId);
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-note-after-"));
    const note = join(stateDir, BACKUP_ROOM_NOTE_FILE);
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);
    const allocationEnv = await writeAllocationInput(stateDir, seed.fixture, "promote");
    for (const [key, value] of Object.entries(allocationEnv)) vi.stubEnv(key, value);

    await withCapturedStdout(async (lines) => {
      const server = await startServer({
        ...KEY_ENV,
        ...TICK_ENV,
        WAITRON_NODE_ID: seed.nodeId,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      }).catch(async (err: unknown) => {
        await rm(stateDir, { recursive: true, force: true });
        await rm(venueDir, { recursive: true, force: true });
        throw err;
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        const request = seed.fixture.request("promote");
        const promote = () =>
          server.promoteMirrorToPrimary!({ oldNodeNeutralised: true }, (context, consume) => {
            // Something at the note's path that no unlink removes, appearing once promotion began.
            mkdirSync(note);
            return withPromotionModuleOperation(
              {
                db: context.db,
                node: context.nodeDb,
                nodeId: seed.nodeId,
                credentialKeyRing: TOTP_KEY_RING,
                modules: ALL_MODULES,
              },
              { binding: request.binding, input: request.input },
              { breakGlass: secret },
              (runner) => runner(context, consume),
            );
          });

        expect((await promote()).alreadyPrimary).toBe(false);
        expect((await readNodeMode(node, seed.nodeId)).mode).toBe("primary");
        await delay(50);
        expect(killSpy.mock.calls).toEqual([[process.pid, "SIGTERM"]]);
        const failures = lines
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line) as { event: string; errno?: unknown })
          .filter((entry) => entry.event === "backup.room_note_delete_failed");
        expect(failures).toEqual([
          expect.objectContaining({ errno: expect.stringMatching(/^(EISDIR|EPERM)$/) }),
        ]);
      } finally {
        await server.close();
        // A promotion that went through schedules its restart signal on a later tick.
        await delay(50);
        killSpy.mockRestore();
        vi.unstubAllEnvs();
        await rm(stateDir, { recursive: true, force: true });
        await rm(venueDir, { recursive: true, force: true });
      }
    });
  }, 60_000);
});

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  const { FISCAL_OPERATIONS: historicalFiscalOperations } =
    await import("@waitron/fiscal-verifactu/src/allocation-configuration.js");
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu"
        ? { ...module, operations: historicalFiscalOperations }
        : module,
    ),
  };
});
