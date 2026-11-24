import { seedModuleSettings } from "../test/module-settings.js";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_ROOM_NOTE_FILE } from "@waitron/provisioning";
import {
  nodes,
  readStandardSeriesId,
  openVenueDatabase,
  stampDeployment,
  taxpayer,
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
import { poll, withCapturedStdout } from "./testing/boot-harness.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { withPromotionModuleOperation } from "./promotion-operation.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintMasterKey } from "./testing/master-key.js";
import { establishDormantContract } from "./testing/dormant-contract.js";
import { invoiceSeries } from "@waitron/db";
import { parseEnvFile } from "./env-file.js";
import { writeTradingEnv } from "./trading-config.js";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { freePort } from "./testing/free-ports.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { TEST_PRODUCER, useTestProducer } from "./testing/test-producer.js";

useTestProducer();

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

// An in-process boot installs no shutdown handlers, so the real `restartProcess` only keeps the
// ask; these cases observe the ask itself.
const restartAsked = vi.hoisted(() => vi.fn<() => void>());
vi.mock("./run-server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-server.js")>()),
  restartProcess: restartAsked,
}));
beforeEach(() => {
  restartAsked.mockReset();
});

// Keep the filing control local: a primary records a failed attempt without calling AEAT.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() => Promise.reject(new Error("undici fetch disabled in boot.promote.test.ts"))),
  };
});

const TILL_ENV = {
  WAITRON_NODE_ID: "33333333-3333-4333-8333-333333333333",
};

// Disables `fiscal-none` so a trading or mirror boot does not refuse `module.fiscal_slot_ambiguous`.

const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-state-"));

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
async function seedIdentity(db: Database, node: NodeDatabase): Promise<void> {
  await seedModuleSettings(db, { "fiscal-none": false });
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "90111111H", legalName: "Promote Venue SL" })
    .onConflictDoNothing();
  await seedVenueSettings(db, {
    name: "Barra",
    invoiceLocales: ["en"],
  });
  await seedBusinessDay(db, {});
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_NODE_ID,
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
  await seedIdentity(appDb, appNode);

  await stampDeployment(appDb, "production");
  await setSingletonRole(
    { venue: appDb, node: appNode },
    TILL_ENV.WAITRON_NODE_ID,
    "secondary",
    "fenced",
  );
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

/** Waits for the background loop to record at least one pass (proof it is live). */
async function waitForPass(state: { lastPassAt: Date | null }): Promise<void> {
  await poll(async () => state.lastPassAt ?? undefined);
  expect(state.lastPassAt).not.toBeNull();
}

/** One due `verifactu_submissions` row and a usable `fiscal.aeat` credential, so a singleton's drain tries it. */
async function seedFiscalWork(): Promise<{ recordIds: string[] }> {
  const seeded = await seedPendingEnvios(appDb, {
    count: 1,
    identity: {
      nodeId: TILL_ENV.WAITRON_NODE_ID,
      nif: "90111111H",
    },
    producerNif: TEST_PRODUCER.WAITRON_PRODUCER_TAX_ID,
  });
  const material = mintMtlsMaterial();
  await withTransaction(appDb, (tx) =>
    putCredential(tx, loadKeyRing(KEY_ENV), {
      personId: null,
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: material.clientPfx.toString("base64"),
        passphrase: material.clientPassphrase,
        certKind: "representante",
      },
    }),
  );
  return { recordIds: seeded.registroIds };
}

/** A raw statement reaches no column mapper, so the `incidencia` flag arrives as 1 or 0. */
async function readSubmission(
  recordId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await appDb.execute<{ estado: string; intentos: number; incidencia: number }>(
    sql`select estado, intentos, incidencia from verifactu_submissions where registro_id = ${recordId}`,
  );
  const row = rows.rows[0]!;
  return { estado: row.estado, intentos: row.intentos, incidencia: row.incidencia === 1 };
}

const TIMINGS = { minTickMs: 250, maxTickMs: 1_000, skipRetryMs: 250 };

describe("boot as a local secondary", () => {
  it("does not file or reconcile and still serves the till", async () => {
    const { recordIds } = await seedFiscalWork();
    const env = {
      ...KEY_ENV,
      WAITRON_VENUE_DIR: appVenueDir,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    };

    const server = await startServer(env, {}, { timings: TIMINGS });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      // A secondary keeps a filing heartbeat but starts no payment or fiscal lookup.
      await waitForPass(server.health);
      expect(server.health.readJobs?.()).toMatchObject({
        "payments.reconcile": { state: "not_applicable", lastRunAt: null },
        "fiscal.reconciliation": { state: "not_applicable", lastRunAt: null },
      });

      expect(server.promoteMirrorToPrimary).toBeUndefined();
      expect(await readSubmission(recordIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 0,
        incidencia: false,
      });
      const staffA = await fetch(`${base}/api/staff`);
      expect(staffA.status).toBe(200);
      expect(await staffA.json()).toEqual([]);
    } finally {
      await server.close();
    }

    // A primary must attempt the same record to prove it was eligible to file.
    await setSingletonRole(
      { venue: appDb, node: appNode },
      TILL_ENV.WAITRON_NODE_ID,
      "primary",
      "promote",
    );
    const primary = await startServer(env, {}, { timings: TIMINGS });
    try {
      await waitForPass(primary.health);
      expect(await readSubmission(recordIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 1,
        incidencia: true,
      });
    } finally {
      await primary.close();
    }
  }, 60_000);
});

const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** A mirror holding its own dormant identity. */
async function seedMirrorIdentity(
  db: Database,
  node: NodeDatabase,
): Promise<{ nodeId: string; fixture: Awaited<ReturnType<typeof establishDormantContract>> }> {
  await seedModuleSettings(db, { "fiscal-none": false });
  await db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote Cloud SL" })
    .onConflictDoNothing();
  await seedVenueSettings(db, { name: "Barra" });
  await seedBusinessDay(db, {});
  const t = await db.execute<{ tax_id: string }>(sql`select tax_id from taxpayer where id = 1`);
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
    sourceId: MIRROR_ORIGIN_NODE_ID,
    taxpayerNif: nif,
    standby,
    endorsement,
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
    originUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  // Deployment: production (matching WAITRON_ENV) then mode='mirror' (co-sets singleton_role='secondary').
  await stampDeployment(db, "production");
  await setNodeMode({ venue: db, node }, standby.nodeId, "mirror", "adopt");
  return { nodeId: standby.nodeId, fixture };
}

describe("promote: mirror → primary, in-process, restart-into-primary", () => {
  it("exposes promoteMirrorToPrimary, promotes, and leaves the trading.env its join wrote untouched", async () => {
    const seed = await seedMirrorIdentity(mirrorDb, mirrorNode);
    const secret = (await mintMasterKey(mirrorDb)).secret;
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-mirror-state-"));

    // As the spare's join writes it (`adopt.ts`).
    const tradingEnv = await writeTradingEnv(stateDir, {
      nodeId: seed.nodeId,
      environment: "production",
    });
    const joined = { ino: (await stat(tradingEnv)).ino, bytes: await readFile(tradingEnv, "utf8") };

    const server = await startServer(
      {
        ...KEY_ENV,
        ...parseEnvFile(joined.bytes),
        WAITRON_VENUE_DIR: mirrorVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      },
      {},
      { timings: TIMINGS },
    ).catch(async (err: unknown) => {
      // `server` is never assigned on a failed boot, so the `finally` below cannot clean up.
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    try {
      expect(server.promoteMirrorToPrimary).toBeDefined();

      const request = seed.fixture();
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
      ).toBe("FA-0CNPG");
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
      const write = await fetch(`${base}/management-api/menus`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(401);
      const pageClaim = await fetch(`${base}/print-api/agent/page-jobs/claim`, { method: "POST" });
      expect(pageClaim.status).toBe(404);

      await delay(50);
      expect(restartAsked).toHaveBeenCalled();

      expect({
        ino: (await stat(tradingEnv)).ino,
        bytes: await readFile(tradingEnv, "utf8"),
      }).toEqual(joined);
      expect(await readStandardSeriesId(mirrorDb, seed.nodeId)).toBe(activeSeriesId);
      await server.close();
      await mirrorDb.execute(
        sql`update settings set doc = json_set(doc, '$.timeZone', 'Invalid/Zone') where module = 'business_day'`,
      );
      const records = mirrorDb.all(sql`select * from verifactu_records order by secuencia`);
      const attempts = mirrorDb.all(sql`select * from verifactu_submissions order by registro_id`);
      const restarted = await startServer(
        {
          ...KEY_ENV,
          ...parseEnvFile(joined.bytes),
          WAITRON_VENUE_DIR: mirrorVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
        },
        {},
        { timings: TIMINGS },
      );
      try {
        const node = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
        expect(await node.json()).toEqual({ acceptingSales: false });
        const health = await fetch(`http://127.0.0.1:${httpPort()}/health`);
        expect(await health.json()).toEqual({ ok: true, tradingAvailable: false });
        expect(restarted.promoteMirrorToPrimary).toBeUndefined();
        expect(mirrorDb.all(sql`select * from verifactu_records order by secuencia`)).toEqual(
          records,
        );
        expect(mirrorDb.all(sql`select * from verifactu_submissions order by registro_id`)).toEqual(
          attempts,
        );
        expect((await readNodeMode(mirrorNode, seed.nodeId)).mode).toBe("primary");
      } finally {
        await restarted.close();
      }
    } finally {
      await server.close();
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
    return startServer(
      {
        ...KEY_ENV,
        ...extraEnv,
        WAITRON_NODE_ID: nodeId,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      },
      {},
      { timings: TIMINGS },
    );
  }

  async function writeStatus(): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/menus`, {
      method: "POST",
      body: "{}",
    });
    return response.status;
  }

  it("a promotion whose role write is lost finishes at the next start, activating once", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = (await mintMasterKey(db)).secret;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-lost-role-"));

    await node.execute(
      sql`create trigger refuse_role_update before update on box begin select raise(abort, 'role refused'); end`,
    );
    await node.execute(
      sql`create trigger refuse_role_insert before insert on box begin select raise(abort, 'role refused'); end`,
    );

    try {
      const first = await bootMirror(venueDir, stateDir, seed.nodeId);
      try {
        const request = seed.fixture();
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
        expect(restartAsked).toHaveBeenCalled();
      } finally {
        await first.close();
      }
      await node.execute(sql`drop trigger refuse_role_update`);
      await node.execute(sql`drop trigger refuse_role_insert`);
      expect(await readNodeMode(node, seed.nodeId)).toEqual({
        mode: "mirror",
        singletonRole: "secondary",
      });

      const second = await bootMirror(venueDir, stateDir, seed.nodeId);
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
        sql`select id from verifactu_identities where node_id = ${seed.nodeId} and revocado_en is null`,
      );
      expect(live.rows).toHaveLength(1);
    } finally {
      await delay(50);
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 90_000);

  it("a held document naming this box the main box but signed with another key does not move it", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-forged-chart-"));

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
    const secret = (await mintMasterKey(db)).secret;
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-note-state-"));
    const note = join(stateDir, BACKUP_ROOM_NOTE_FILE);

    const server = await startServer(
      {
        ...KEY_ENV,
        WAITRON_NODE_ID: seed.nodeId,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      },
      {},
      { timings: TIMINGS },
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
      throw err;
    });

    const noteAtRestart: boolean[] = [];
    restartAsked.mockImplementation(() => {
      noteAtRestart.push(existsSync(note));
    });
    try {
      const request = seed.fixture();
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
      expect(restartAsked).toHaveBeenCalled();
      expect(noteAtRestart).toEqual([false]);
    } finally {
      await server.close();
      // A promotion that went through asks for its restart on a later tick.
      await delay(50);
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("what a caller must record before the restart runs after the backup note's last deletion, and the restart comes through the seam", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = (await mintMasterKey(db)).secret;
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-before-restart-state-"));
    const note = join(stateDir, BACKUP_ROOM_NOTE_FILE);

    const steps: string[] = [];
    const server = await startServer(
      {
        ...KEY_ENV,
        WAITRON_NODE_ID: seed.nodeId,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      },
      undefined,
      { timings: TIMINGS, restart: () => steps.push("restart") },
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const request = seed.fixture();
      const promote = (beforeRestart: () => Promise<void>) =>
        server.promoteMirrorToPrimary!(
          { oldNodeNeutralised: true },
          (context, consume) => {
            // Written after the promotion's first deletion, so only the last one can remove it.
            writeFileSync(note, "{}");
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
          },
          beforeRestart,
        );
      await promote(async () => {
        steps.push(`before restart, note ${existsSync(note) ? "there" : "gone"}`);
        await delay(20);
        steps.push("recorded");
      });
      await delay(50);
      expect(steps).toEqual(["before restart, note gone", "recorded", "restart"]);
      expect(restartAsked).not.toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      await server.close();
      await delay(50);
      killSpy.mockRestore();
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a failed record still restarts, so the start that follows can finish it", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = (await mintMasterKey(db)).secret;
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-before-restart-state-"));

    const restart = vi.fn();
    const server = await startServer(
      {
        ...KEY_ENV,
        WAITRON_NODE_ID: seed.nodeId,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      },
      undefined,
      { timings: TIMINGS, restart },
    );
    try {
      const request = seed.fixture();
      await expect(
        server.promoteMirrorToPrimary!(
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
          async () => {
            throw new Error("record lost");
          },
        ),
      ).rejects.toThrow("record lost");
      await delay(50);
      expect(restart).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
      await delay(50);
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("restarts once and logs the failure when the note cannot be deleted after promoting", async () => {
    const [venueDir, db, node] = await migratedVenue();
    const seed = await seedMirrorIdentity(db, node);
    const secret = (await mintMasterKey(db)).secret;
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-note-after-"));
    const note = join(stateDir, BACKUP_ROOM_NOTE_FILE);

    await withCapturedStdout(async (lines) => {
      const server = await startServer(
        {
          ...KEY_ENV,
          WAITRON_NODE_ID: seed.nodeId,
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
        },
        {},
        { timings: TIMINGS },
      ).catch(async (err: unknown) => {
        await rm(stateDir, { recursive: true, force: true });
        await rm(venueDir, { recursive: true, force: true });
        throw err;
      });

      try {
        const request = seed.fixture();
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
        expect(restartAsked).toHaveBeenCalledTimes(1);
        const failures = lines
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line) as { event: string; errno?: unknown })
          .filter((entry) => entry.event === "backup.room_note_delete_failed");
        expect(failures).toEqual([
          expect.objectContaining({ errno: expect.stringMatching(/^(EISDIR|EPERM)$/) }),
        ]);
      } finally {
        await server.close();
        // A promotion that went through asks for its restart on a later tick.
        await delay(50);
        vi.unstubAllEnvs();
        await rm(stateDir, { recursive: true, force: true });
        await rm(venueDir, { recursive: true, force: true });
      }
    });
  }, 60_000);
});

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  const { hourPromotionOperations } = await import("./testing/dormant-contract.js");
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu"
        ? { ...module, operations: hourPromotionOperations }
        : module,
    ),
  };
});
