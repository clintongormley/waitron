import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { withCollectedModuleAllocation } from "./allocation-operation.js";
import { FISCAL_OPERATIONS } from "./index.js";
import { projectHourHistory } from "./hour-history.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "first",
  sourceId: "source",
  targetNodeId: node.nodeId,
};
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const scope = { taxpayerNif: "89890001K", environment: "preproduction" };
const read = () => FISCAL_OPERATIONS.readRecoveryHistory!(suite.db);
afterEach(() => vi.useRealTimers());
async function seed() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await activate(binding, "06RB", "2026-10-16T11:40:00.000Z");
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
}
async function activate(
  initial: OperationBinding,
  identity: string,
  issuedAt: string,
  target = node,
) {
  const operatorId =
    initial.action === "setup"
      ? "administrator"
      : {
          kind: "recovery-key" as const,
          nodeId: target.nodeId,
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
          series: bases.map((base) => ({ ...base, code: `${base.code}-${identity}` })),
        },
        approval: {
          version: 1,
          eventId: initial.eventId,
          sourceId: initial.sourceId,
          targetNodeId: target.nodeId,
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
      { requiredBases: bases, priorActivation: "none" },
      (evidence) =>
        withCollectedModuleAllocation(
          operation,
          async (request) => ({ ...request, evidence }),
          (write) => withTransaction(suite.db, (tx) => write(tx, target)),
        ),
    );
  });
}

it("retains the higher retired hour of another node without changing rows or counters", async () => {
  await seed();
  vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
  const other = { ...node, nodeId: TENANT_A.nodeId2 };
  await activate(
    { ...binding, eventId: "other-node", targetNodeId: other.nodeId },
    "06RD",
    "2026-10-16T13:40:00.000Z",
    other,
  );
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: new Date() })
    .where(eq(invoiceSeries.nodeId, other.nodeId));
  await suite.db
    .update(registroSif)
    .set({ revocadoEn: new Date() })
    .where(eq(registroSif.nodeId, other.nodeId));
  const before = {
    series: await suite.db.select().from(invoiceSeries),
    sifs: await suite.db.select().from(registroSif),
    allocations: await suite.db.select().from(fiscalAllocations),
  };
  const sources = await read();
  expect(projectHourHistory({ scope, sources })).toMatchObject({
    greatestSpentHour: 6925,
    contradictions: [],
  });
  expect(
    projectHourHistory({ scope: { ...scope, environment: "production" }, sources }),
  ).toMatchObject({ greatestSpentHour: null, contradictions: [] });
  expect(
    projectHourHistory({ scope: { ...scope, taxpayerNif: "92470001W" }, sources }),
  ).toMatchObject({ greatestSpentHour: null, contradictions: [] });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before.series);
  expect(await suite.db.select().from(registroSif)).toEqual(before.sifs);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(before.allocations);
});

it("combines snapshots taken before and after retirement without inventing conflicting rows", async () => {
  await seed();
  const earlier = await read();
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  await suite.db.update(invoiceSeries).set({ retiredAt: new Date() });
  await suite.db.update(registroSif).set({ revocadoEn: new Date() });
  const later = await read();
  expect(projectHourHistory({ scope, sources: [...earlier, ...later] })).toMatchObject({
    greatestSpentHour: 6923,
    contradictions: [],
  });
});

it("keeps incomplete scope evidence visibly incomplete", async () => {
  await seed();
  await suite.db.delete(deployment);
  expect(projectHourHistory({ scope, sources: await read() }).contradictions).toEqual(
    expect.arrayContaining([expect.stringMatching(/:incomplete$/)]),
  );
});

it("admits an empty migrated database as empty history without inventing an hour", async () => {
  expect(projectHourHistory({ scope, sources: await read() })).toMatchObject({
    greatestSpentHour: null,
    recordedTimeFloorMs: null,
    contradictions: [],
  });
});
