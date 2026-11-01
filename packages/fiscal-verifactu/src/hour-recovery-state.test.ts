import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, invoiceSeries, stampDeployment, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { recordSale } from "@waitron/core";
import { locationId, seriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedVenueNodes, TENANT_A } from "../test/fixtures.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { withCollectedModuleAllocation } from "./allocation-operation.js";
import { FISCAL_OPERATIONS } from "./index.js";
import { projectHourHistory } from "./hour-history.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { VerifactuBackend } from "./backend.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "recovery",
  sourceId: "selected-artifact",
  targetNodeId: node.nodeId,
};
const bases = [
  { code: "a/b_.-", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const read = (operation = binding, target = node) =>
  FISCAL_OPERATIONS.readRecoveryState!(suite.db, target, operation);
afterEach(() => vi.useRealTimers());

async function seed(configuration = bases, seedParents = seedVenueNodes) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  await seedParents(suite.db);
  await stampDeployment(suite.db, "preproduction");
  const initial = { ...binding, action: "setup", eventId: "first", sourceId: "original" };
  await activate(initial, "0CNNW", "2026-10-16T11:40:00.000Z", configuration);
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
}

async function activate(
  initial: OperationBinding,
  identity: string,
  issuedAt: string,
  configuration = bases,
) {
  const operatorId =
    initial.action === "setup"
      ? "administrator"
      : {
          kind: "recovery-key" as const,
          nodeId: node.nodeId,
          eventId: initial.eventId,
        };
  await withOperationAuthority(initial, operatorId, async (authority) => {
    const operation = {
      binding: initial,
      authority,
      input: {
        allocation: {
          version: 1,
          allocationId: `hour/${initial.eventId}`,
          taxpayerNif: "89890001K",
          softwareId: "W1",
          environment: "preproduction",
          installationIdentity: identity,
          source: "hour",
          reservationEvidence: null,
          issuedAt,
          series: configuration.map((base) => ({ ...base, code: `${base.code}-${identity}` })),
        },
        approval: {
          version: 1,
          eventId: initial.eventId,
          sourceId: initial.sourceId,
          targetNodeId: node.nodeId,
          operatorId,
          oldMachineOffline: initial.action !== "setup",
          oldMachineAbsent: initial.action === "setup",
          noParallelRecovery: true,
          confirmedAt: issuedAt,
          incidentEvidence: `owned/${initial.eventId}`,
        },
      },
    };
    await withHourAdmission(
      operation,
      { requiredBases: configuration, priorActivation: "none" },
      (evidence) =>
        withCollectedModuleAllocation(
          operation,
          async (request) => ({ ...request, evidence }),
          (write) => withTransaction(suite.db, (tx) => write(tx, node)),
        ),
    );
  });
}

it("recognises a matching committed restore without modifying its retained result", async () => {
  await seed();
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  await activate(binding, "0CNQR", "2026-10-16T12:40:00.000Z");
  const before = await suite.db.select().from(invoiceSeries);
  expect((await read()).priorActivation).toBe("committed");
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
});

it("reads each configured prefix and exact spelling without writing counters", async () => {
  await seed();
  const before = await suite.db.select().from(invoiceSeries);
  const facts = await read();
  expect([...facts.bases].sort((a, b) => a.code.localeCompare(b.code))).toEqual(
    [...bases].sort((a, b) => a.code.localeCompare(b.code)),
  );
  expect(facts).toMatchObject({
    country: "ES",
    taxId: "89890001K",
    environment: "preproduction",
    priorActivation: "none",
  });
  expect(
    projectHourHistory({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      sources: facts.history,
    }),
  ).toMatchObject({
    greatestSpentMinute: 415420,
    contradictions: [],
  });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("includes higher retired names on another node under another software identifier", async () => {
  await seed();
  await suite.db.insert(registroSif).values({
    nodeId: TENANT_A.nodeId2,
    nif: "89890001K",
    idSistemaInformatico: "OTHER",
    numeroInstalacion: "0CNRP",
    registradoEn: new Date("2026-10-16T13:10:00Z"),
    revocadoEn: new Date("2026-10-16T13:20:00Z"),
  });
  await suite.db.insert(invoiceSeries).values({
    nodeId: TENANT_A.nodeId2,
    code: "different-0CNRP",
    purpose: "standard",
    retiredAt: new Date("2026-10-16T13:20:00Z"),
  });
  const facts = await read();
  expect(
    projectHourHistory({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      sources: facts.history,
    }),
  ).toMatchObject({
    greatestSpentMinute: 415510,
    recordedTimeFloorMs: Date.parse("2026-10-16T13:20:00Z"),
    contradictions: [],
  });
  expect(facts.bases).toHaveLength(3);
});

it.each([{ module: "another-module" }, { action: "promote" }, { targetNodeId: TENANT_A.nodeId2 }])(
  "refuses a changed operation %j before reading fiscal state",
  async (change) => {
    await expect(read({ ...binding, ...change })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
  },
);

it("refuses a missing taxpayer rather than manufacturing a scope", async () => {
  await expect(read()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
});

it("refuses an unstamped recovered database", async () => {
  await seed();
  await suite.db.delete(deployment);
  await expect(read()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
});

it("refuses a changed active series instead of treating it as newly configured bases", async () => {
  await seed();
  await suite.db
    .update(invoiceSeries)
    .set({ purpose: "rectificative" })
    .where(eq(invoiceSeries.code, "FF-0CNNW"));
  await expect(read()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "series_mismatch" },
  });
});

it("does not use another source's committed event as permission to replay", async () => {
  await seed();
  await expect(read({ ...binding, eventId: "first" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
});

describe("recorded country", () => {
  it("returns the database country rather than a Spanish fallback", async () => {
    await seed();
    await suite.db.update(tenants).set({ country: "GB" });
    expect((await read()).country).toBe("GB");
  });
});

it.each(["standard", "full", "rectificative"])(
  "refuses recovery with two %s prefixes without changing fiscal rows",
  async (purpose) => {
    await seed([...bases, { code: "second", purpose }]);
    const before = await suite.db.select().from(invoiceSeries);
    await expect(read()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "series_configuration_unsupported" },
    });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  },
);

it("consults an exact committed restore without changing counters or evidence", async () => {
  await seed();
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  const operation = { ...binding, action: "restore" };
  await activate(operation, "0CNQR", "2026-10-16T12:40:00.000Z");
  const before = {
    allocations: await suite.db.select().from(fiscalAllocations),
    series: await suite.db.select().from(invoiceSeries),
    sifs: await suite.db.select().from(registroSif),
  };
  expect((await read(operation)).priorActivation).toBe("committed");
  expect({
    allocations: await suite.db.select().from(fiscalAllocations),
    series: await suite.db.select().from(invoiceSeries),
    sifs: await suite.db.select().from(registroSif),
  }).toEqual(before);
  await expect(read({ ...operation, sourceId: "another-recovery" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(before.allocations);
});

it("gives a restore the backup's newest fiscal record time as its floor", async () => {
  await seed();
  const clock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date("2026-10-22T20:15:00Z") }),
  };
  const backend = new VerifactuBackend({
    deploymentEnvironment: "preproduction",
    clock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
  const [standard] = await suite.db
    .select()
    .from(invoiceSeries)
    .where(eq(invoiceSeries.code, "a/b_.--0CNNW"));
  await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({ nodeId: node.nodeId, seriesId: seriesId(standard!.id), clock }),
    ),
  );
  const facts = await read();
  expect(
    projectHourHistory({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      sources: facts.history,
    }),
  ).toMatchObject({
    recordedTimeFloorMs: Date.parse("2026-10-22T20:15:00Z"),
    contradictions: [],
  });
});
