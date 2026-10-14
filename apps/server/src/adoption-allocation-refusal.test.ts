import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { deployment, locations, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALLOCATED_FISCAL_STANDBY, FISCAL_OPERATIONS } from "@waitron/fiscal-verifactu";
import type { WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { loadKeyRing } from "@waitron/credentials";
import { adoptFromPrimary } from "./adopt.js";
import {
  readPendingAdoption,
  runFinishAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";
import { mountSetup } from "./setup-api.js";
import type { MirrorBundle } from "./mirror-bundle.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const LOCATION = "a7000000-0000-4000-8000-000000000001";
const PRIMARY = "a7000000-0000-4000-8000-000000000002";
const STANDBY = "a7000000-0000-4000-8000-000000000003";
const credential = {
  personId: "a7000000-0000-4000-8000-000000000004",
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
    designated: { locationId: LOCATION, nodeId: PRIMARY },
    tenant: { country: "ES", taxId: "89890001K" },
    primaryNode: { name: "Primary", filingModule: "fiscal-verifactu", taxModule: null },
    environment: "preproduction",
    boxHostname: "waitron.local",
    boxCaPem: "synthetic-public-ca",
    relayUrl: "https://relay.test/",
    accountKey: Buffer.alloc(32, 3).toString("base64"),
    reservedIdentity: {
      modules: { "fiscal-verifactu": { version: 1, evidence: {} } },
      series: [],
      endorsement: {} as never,
    },
    moduleOverrides: {},
  };
}
function deps(value = bundle()) {
  return {
    ownerDb: suite.db,
    advertisedOrigin: "https://spare.test",
    environment: "preproduction" as const,
    fetchBundle: async () => value,
    persistTrading: async () => {},
    persistModuleConfig: async () => {},
    stateDir,
    database: "synthetic-spare",
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
async function state() {
  const rows = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like '__drizzle%' order by name`,
  );
  const snapshot: Record<string, unknown> = {};
  for (const { name } of rows.rows) {
    snapshot[name] = (
      await suite.db.execute(
        sql.raw(`select * from "${name.replaceAll('"', '""')}" order by rowid`),
      )
    ).rows;
  }
  return snapshot;
}
it("refuses allocation-dependent adoption before its first local write or handover", async () => {
  const before = await state();
  let reachedFirstWrite = false;
  await expect(
    adoptFromPrimary(deps(), request, {
      beforeFirstWrite: async () => {
        reachedFirstWrite = true;
      },
    }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "fiscal-verifactu" },
  });
  expect(reachedFirstWrite).toBe(false);
  expect(await state()).toEqual(before);
  expect(await readPendingAdoption(stateDir)).toBeNull();
});
it("still adopts when the allocation-dependent module is disabled", async () => {
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
    locationId: LOCATION,
    originNodeId: PRIMARY,
  });
});
it("the setup route returns an allocation refusal and does not restart", async () => {
  let restarts = 0;
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      adopt: (req, hooks) => adoptFromPrimary(deps(), req, hooks),
      requestRestart: () => {
        restarts += 1;
      },
    },
    () => {},
  );
  const response = await app.request("/setup-api/adopt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "module.operation_invalid", params: { module: "fiscal-verifactu" } },
  });
  expect(restarts).toBe(0);
  expect(await suite.db.select().from(deployment)).toEqual([]);
  expect(await readPendingAdoption(stateDir)).toBeNull();
});
it("a pending allocated adoption refuses without creating a selling identity and retains its exact latch", async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Synthetic SL" });
  await suite.db
    .insert(locations)
    .values({ id: LOCATION, name: "Venue", invoiceLocales: ["es"], operationDescription: "Venta" });
  await suite.db.insert(nodes).values({ id: PRIMARY, locationId: LOCATION, name: "Primary" });
  const pending: PendingAdoption = {
    locationId: LOCATION,
    originNodeId: PRIMARY,
    standby: { nodeId: STANDBY, publicKey: "synthetic-public", privateKey: "synthetic-private" },
    nodeName: "Spare",
    filingModule: "fiscal-verifactu",
    taxModule: null,
    reserved: bundle().reservedIdentity,
  };
  await writePendingAdoption(stateDir, pending);
  const before = await state();
  const events: unknown[] = [];
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 4).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  for (let retry = 0; retry < 2; retry += 1) {
    await runFinishAdoption({
      ownerDb: suite.db,
      ring,
      stateDir,
      modules,
      log: (level, event, fields) => {
        events.push({ level, event, fields });
      },
    });
    expect(await readPendingAdoption(stateDir)).toEqual(pending);
    expect(await state()).toEqual(before);
  }
  expect(events).toEqual([
    {
      level: "error",
      event: "adoption.establish_failed",
      fields: { code: "module.operation_invalid" },
    },
    {
      level: "error",
      event: "adoption.establish_failed",
      fields: { code: "module.operation_invalid" },
    },
  ]);
});
