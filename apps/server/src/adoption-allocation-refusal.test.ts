import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { deployment, nodes, taxpayer, withNodeTransaction } from "@waitron/db";
import { readPairLink } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALLOCATED_FISCAL_STANDBY, FISCAL_OPERATIONS } from "@waitron/fiscal-verifactu";
import type { WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { loadKeyRing, sealNodeSigningKeyTx, writePairLinkTx } from "@waitron/credentials";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { adoptFromPrimary, type AdoptHooks } from "./adopt.js";
import { writeCredentialsRing } from "./box-secrets.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import {
  readPendingAdoption,
  runFinishAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { MAIN_AUTHORITY } from "./testing/main-authority.js";
import { PAIR_BUNDLE_FIELDS } from "./testing/pair-bundle.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const PRIMARY = "a7000000-0000-4000-8000-000000000002";
const STANDBY = "a7000000-0000-4000-8000-000000000003";
const PRIMARY_KEYS = generateNodeKeyPair();
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "adoption-allocation-"));
  modules.splice(
    0,
    modules.length,
    fakeModule("fiscal-verifactu", {
      provisioning: { standby: ALLOCATED_FISCAL_STANDBY },
      operations: FISCAL_OPERATIONS,
    }),
  );
});
afterEach(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});
function bundle(): MirrorBundle {
  return {
    designated: { nodeId: PRIMARY },
    taxpayer: { country: "ES", taxId: "89890001K" },
    primaryNode: { name: "Primary", filingModule: "fiscal-verifactu", taxModule: null },
    environment: "preproduction",
    boxHostname: "waitron.local",
    boxCaPem: MAIN_AUTHORITY.caCertPem,
    ...PAIR_BUNDLE_FIELDS,

    reservedIdentity: {
      modules: {},
      series: [],
      endorsement: endorseKey(STANDBY, "synthetic-standby-key", PRIMARY, PRIMARY_KEYS.privateKey),
    },
    moduleOverrides: {},
    primaryPublicKey: PRIMARY_KEYS.publicKey,
    credentialsRing: { key: Buffer.alloc(32, 5).toString("base64"), version: 1 },
    backupSettings: null,
    boxCaKeyPem: MAIN_AUTHORITY.caKeyPem,
  };
}
function deps() {
  return {
    ownerDb: suite.db,
    ownerNode: suite.node,
    environmentKeys: {},
    ring: loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 4).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    }),
    assertStartsWith: () => {},
    environment: "preproduction" as const,
    persistTrading: async () => {},
    persistBackupSettings: async () => {},
    persistModuleConfig: async () => {},
    persistCredentialsRing: (ring: MirrorBundle["credentialsRing"]) =>
      writeCredentialsRing(stateDir, ring),
    stateDir,
    database: "synthetic-spare",
    listIpv4: () => [],
    now: () => new Date(),
  };
}
/** This box's identity and the bundle the main box endorsed it in, handed to adopt as a code join does. */
async function adoptJoined(value: MirrorBundle, hooks: AdoptHooks) {
  const identity = generateStandbyIdentity();
  const storeUrl = "https://spare.test:7443";
  const endorsement = endorseKey(
    identity.nodeId,
    identity.publicKey,
    PRIMARY,
    PRIMARY_KEYS.privateKey,
  );
  const joined = { ...value, reservedIdentity: { ...value.reservedIdentity, endorsement } };
  return adoptFromPrimary(deps(), { identity, bundle: joined, storeUrl }, hooks);
}

it("keeps the stamped-environment refusal before allocation-dependent adoption", async () => {
  await suite.db.insert(deployment).values({ id: 1, environment: "production" });
  const before = await state();
  let reachedFirstWrite = false;
  await expect(
    adoptJoined(bundle(), {
      beforeFirstWrite: async () => {
        reachedFirstWrite = true;
      },
    }),
  ).rejects.toMatchObject({
    code: "deployment.already_stamped",
    params: { stamped: "production", requested: "preproduction" },
  });
  expect(reachedFirstWrite).toBe(false);
  expect(await state()).toEqual(before);
});
async function state(db: Pick<typeof suite.db, "execute"> = suite.db) {
  const rows = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like '__drizzle%' order by name`,
  );
  const snapshot: Record<string, unknown> = {};
  for (const { name } of rows.rows) {
    snapshot[name] = (
      await db.execute(sql.raw(`select * from "${name.replaceAll('"', '""')}" order by rowid`))
    ).rows;
  }
  return snapshot;
}
const FISCAL_TABLES = ["verifactu_identities", "invoice_series", "verifactu_records"];
async function fiscalState() {
  const all = await state();
  return Object.fromEntries(FISCAL_TABLES.map((table) => [table, all[table]]));
}
it("adopts with the allocation-dependent module enabled, writing no fiscal row", async () => {
  const before = await fiscalState();
  expect(Object.values(before).every((rows) => Array.isArray(rows))).toBe(true);
  await expect(
    adoptJoined(bundle(), { beforeFirstWrite: async () => {} }),
  ).resolves.toBeUndefined();
  expect(await fiscalState()).toEqual(before);
  expect(await readPendingAdoption(stateDir)).toMatchObject({
    originNodeId: PRIMARY,
    reserved: { modules: {}, series: [] },
  });
});
it("adopts when the allocation-dependent module is disabled", async () => {
  const value = bundle();
  value.moduleOverrides = { "fiscal-verifactu": false };
  await expect(adoptJoined(value, { beforeFirstWrite: async () => {} })).resolves.toBeUndefined();
  expect(await suite.db.select().from(deployment)).toEqual([
    { id: 1, environment: "preproduction", stampedAt: expect.any(Date) },
  ]);
  expect(await readPendingAdoption(stateDir)).toMatchObject({
    originNodeId: PRIMARY,
  });
});
it("a pending adoption with the allocation-dependent module enabled finishes without writing to venue.db", async () => {
  await suite.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Synthetic SL" });
  await seedVenueSettings(suite.db, {
    name: "Venue",
    invoiceLocales: ["es"],
  });
  await seedBusinessDay(suite.db, {});
  const own = generateNodeKeyPair();
  await suite.db.insert(nodes).values([
    { id: PRIMARY, name: "Primary" },
    { id: STANDBY, name: "Spare", publicKey: own.publicKey },
  ]);
  await withNodeTransaction(suite.node, async (tx) => {
    await sealNodeSigningKeyTx(tx, RING, STANDBY, own.privateKey);
    await writePairLinkTx(tx, RING, STANDBY, {
      role: "serves",
      state: "awaiting_copy",
      peerNodeId: PRIMARY,
      peerPublicKey: PRIMARY_KEYS.publicKey,
      storeUrl: "https://main:7443",
      venueId: "venue-1",
      accessKeyId: "waitron0123456789abcdef",
      secretAccessKey: "ab".repeat(32),
    });
  });
  const pending: PendingAdoption = {
    originNodeId: PRIMARY,
    standby: { nodeId: STANDBY, publicKey: own.publicKey },
    nodeName: "Spare",
    filingModule: "fiscal-verifactu",
    taxModule: null,
    reserved: bundle().reservedIdentity,
  };
  await writePendingAdoption(stateDir, pending);
  const before = await state();
  const events: unknown[] = [];
  let restarts = 0;
  await runFinishAdoption({
    ownerDb: suite.db,
    node: suite.node,
    ring: RING,
    nodeId: STANDBY,
    stateDir,
    restart: () => {
      restarts += 1;
    },
    log: (level, event, fields) => {
      events.push({ level, event, fields });
    },
  });
  expect(events).toEqual([
    { level: "info", event: "adoption.established", fields: { nodeId: STANDBY } },
  ]);
  expect(restarts).toBe(1);
  expect(await readPendingAdoption(stateDir)).toBeNull();
  expect((await readPairLink(suite.node, STANDBY))?.state).toBe("copied");
  expect(await state()).toEqual(before);
});
