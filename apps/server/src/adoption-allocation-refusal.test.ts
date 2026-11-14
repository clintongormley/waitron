import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { deployment, nodes, tenants, withNodeTransaction } from "@waitron/db";
import { readPairLink } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALLOCATED_FISCAL_STANDBY, FISCAL_OPERATIONS } from "@waitron/fiscal-verifactu";
import type { WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { loadKeyRing, sealNodeSigningKeyTx, writePairLinkTx } from "@waitron/credentials";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { adoptFromPrimary } from "./adopt.js";
import { fetchMirrorBundle } from "./mirror-bundle-fetch.js";
import { JOIN_REFUSALS } from "./mirror-bundle-api.js";
import { writeCredentialsRing } from "./box-secrets.js";
import {
  readPendingAdoption,
  runFinishAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";
import { mountSetup } from "./setup-api.js";
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
const credential = {
  email: "owner@example.test",
  password: "synthetic-login",
};
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
    tenant: { country: "ES", taxId: "89890001K" },
    primaryNode: { name: "Primary", filingModule: "fiscal-verifactu", taxModule: null },
    environment: "preproduction",
    boxHostname: "waitron.local",
    boxCaPem: MAIN_AUTHORITY.caCertPem,
    ...PAIR_BUNDLE_FIELDS,
    accountKey: Buffer.alloc(32, 3).toString("base64"),
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
function deps(value = bundle()) {
  return {
    ownerDb: suite.db,
    ownerNode: suite.node,
    ring: loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 4).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    }),
    advertisedOrigin: "https://spare.test",
    spareStorePort: 7443,
    environment: "preproduction" as const,
    // The main box endorses the identity this box sends.
    fetchBundle: async (
      _url: string,
      _credential: unknown,
      standby: { nodeId: string; publicKey: string },
    ) => ({
      ...value,
      reservedIdentity: {
        ...value.reservedIdentity,
        endorsement: endorseKey(
          standby.nodeId,
          standby.publicKey,
          PRIMARY,
          PRIMARY_KEYS.privateKey,
        ),
      },
    }),
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
const request = { primaryUrl: "https://primary.test", credential };

it("keeps the stamped-environment refusal before allocation-dependent adoption", async () => {
  await suite.db.insert(deployment).values({ id: 1, environment: "production" });
  const before = await state();
  let reachedFirstWrite = false;
  await expect(
    adoptFromPrimary(deps(), request, {
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
const FISCAL_TABLES = [
  "registro_sif",
  "invoice_series",
  "fiscal_reservations",
  "fiscal_allocations",
  "registros_facturacion",
];
async function fiscalState() {
  const all = await state();
  return Object.fromEntries(FISCAL_TABLES.map((table) => [table, all[table]]));
}
it("adopts with the allocation-dependent module enabled, writing no fiscal row", async () => {
  const before = await fiscalState();
  expect(Object.values(before).every((rows) => Array.isArray(rows))).toBe(true);
  await expect(
    adoptFromPrimary(deps(), request, { beforeFirstWrite: async () => {} }),
  ).resolves.toMatchObject({ breakGlassKeyName: expect.any(String) });
  expect(await fiscalState()).toEqual(before);
  expect(await readPendingAdoption(stateDir)).toMatchObject({
    originNodeId: PRIMARY,
    reserved: { modules: {}, series: [] },
  });
});
it("adopts when the allocation-dependent module is disabled", async () => {
  const value = bundle();
  value.moduleOverrides = { "fiscal-verifactu": false };
  const adopted = adoptFromPrimary(deps(value), request, { beforeFirstWrite: async () => {} });
  await expect(adopted).resolves.toMatchObject({ breakGlassKeyName: expect.any(String) });
  const result = await adopted;
  expect(result.breakGlassKeyName).toMatch(/^\d{4}-\d{2}-\d{2} · /);
  expect(await suite.db.select().from(deployment)).toEqual([
    { id: 1, environment: "preproduction", stampedAt: expect.any(Date) },
  ]);
  expect(await readPendingAdoption(stateDir)).toMatchObject({
    originNodeId: PRIMARY,
  });
});
it("a pending adoption with the allocation-dependent module enabled finishes without writing to venue.db", async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Synthetic SL" });
  await seedVenueSettings(suite.db, {
    name: "Venue",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
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

// The main box's answer to the join, as `mirror-bundle-api.ts` sends each refusal; typed by
// `JOIN_REFUSALS`, so a refusal added there without a case here does not compile.
const JOIN_REFUSAL_CASES: Record<(typeof JOIN_REFUSALS)[number], Record<string, unknown>> = {
  "mirror.bucket_stream_active": {},
  "mirror.standby_name_taken": {},
  "mirror.spare_already_joined": {},
  "backup.recovery_key_missing": {},
  "mirror.clocks_apart": {
    primaryAt: "2026-11-10T12:00:00.000Z",
    standbyAt: "2026-11-10T12:05:00.000Z",
  },
};
it.each(Object.entries(JOIN_REFUSAL_CASES))(
  "the setup route passes on the main box's %s through the real fetch, writes nothing and does not restart",
  async (code, params) => {
    const main = new Hono();
    main.post("/management-api/mirror-bundle", (c) =>
      c.json({ error: { code, params: { ...params, detail: "https://primary.internal" } } }, 409),
    );
    const server = await new Promise<ServerType>((resolve) => {
      const started = serve({ fetch: main.fetch, hostname: "127.0.0.1", port: 0 }, () =>
        resolve(started),
      );
    });
    try {
      const { port } = server.address() as AddressInfo;
      const before = {
        venue: await state(),
        node: await state(suite.node),
        files: await readdir(stateDir),
      };
      let restarts = 0;
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          adopt: (req, hooks) =>
            adoptFromPrimary({ ...deps(), fetchBundle: fetchMirrorBundle }, req, hooks),
          requestRestart: () => {
            restarts += 1;
          },
        },
        () => {},
      );
      const response = await app.request("/setup-api/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryUrl: `http://127.0.0.1:${port}`, credential }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code, params } });
      expect(restarts).toBe(0);
      expect({
        venue: await state(),
        node: await state(suite.node),
        files: await readdir(stateDir),
      }).toEqual(before);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
