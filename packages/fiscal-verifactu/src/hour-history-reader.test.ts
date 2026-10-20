import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, invoiceSeries, withTransaction, readDeploymentEnvironment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { withHourAdmission } from "./allocation-envelope.js";
import {
  readModuleAllocationSeries,
  withCollectedModuleAllocation,
} from "./allocation-operation.js";
import { liveSeriesBases } from "./reserved-series.js";
import { readHourHistory } from "./hour-history-reader.js";
import { projectHourHistory } from "./hour-history.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";
import { registroSif } from "./schema/sif.js";
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
async function readInventory() {
  const environment = await readDeploymentEnvironment(suite.db);
  return withTransaction(suite.db, (tx) => readHourHistory(tx, environment));
}
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
it("enumerates the higher retired other-node hour that current-node readers omit", async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  for (const [nodeId, identity, issuedAt] of [
    [TENANT_A.nodeId, "06RB", "2026-10-16T11:40:00.000Z"],
    [TENANT_A.nodeId2, "06RC", "2026-10-16T12:00:00.000Z"],
  ] as const) {
    const binding: OperationBinding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: identity,
      sourceId: `attempt/${identity}`,
      targetNodeId: nodeId,
    };
    const input = {
      allocation: {
        version: 1,
        allocationId: `hour/${identity}`,
        taxpayerNif: "89890001K",
        softwareId: "W1",
        environment: "preproduction",
        installationIdentity: identity,
        series: bases.map((b) => ({ ...b, code: `${b.code}-${identity}` })),
        source: "hour",
        reservationEvidence: null,
        issuedAt,
      },
      approval: {
        version: 1,
        eventId: identity,
        operatorId: "administrator",
        sourceId: binding.sourceId,
        targetNodeId: nodeId,
        oldMachineOffline: false,
        oldMachineAbsent: true,
        noParallelRecovery: true,
        confirmedAt: issuedAt,
        incidentEvidence: `owned/${identity}`,
      },
    };
    await withOperationAuthority(binding, "administrator", (authority) => {
      const operation = { binding, authority, input };
      return withHourAdmission(
        operation,
        { requiredBases: bases, priorActivation: "none" },
        (evidence) =>
          withCollectedModuleAllocation(
            operation,
            async (request) => ({ ...request, evidence }),
            (write) =>
              withTransaction(suite.db, (tx) =>
                write(tx, { nodeId, locationId: locationId(TENANT_A.locationId) }),
              ),
          ),
      );
    });
  }
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: new Date("2026-10-16T12:30:00Z") })
    .where(eq(invoiceSeries.nodeId, TENANT_A.nodeId2));
  await suite.db
    .update(registroSif)
    .set({ revocadoEn: new Date("2026-10-16T12:30:00Z") })
    .where(eq(registroSif.nodeId, TENANT_A.nodeId2));
  const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
  const result = await withTransaction(suite.db, async (tx) => ({
    bases: await liveSeriesBases(tx, node),
    series: await readModuleAllocationSeries(tx, node, bases),
  }));
  expect(result.series.map((s) => s.code)).not.toContain("A-06RC");
  const source = await readInventory();
  const history = projectHourHistory({
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    sources: [source],
  });
  expect(history.greatestSpentHour).toBe(6924);
  expect(history.contradictions).toEqual([]);
  expect(
    source.records.filter(
      (row) => typeof row === "object" && row !== null && "kind" in row && row.kind === "series",
    ),
  ).toHaveLength(6);
  expect(
    source.records.filter(
      (row) =>
        typeof row === "object" && row !== null && "kind" in row && row.kind === "activation",
    ),
  ).toHaveLength(2);
});

it("positively inventories an unprovisioned empty database", async () => {
  const source = await readInventory();
  expect(source).toEqual({ reference: "venue", complete: true, records: [] });
});
async function seedRows(
  options: { identity?: string; nif?: string; softwareId?: string; retired?: boolean } = {},
) {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  const identity = options.identity ?? "06RB";
  const [sif] = await suite.db
    .insert(registroSif)
    .values({
      nodeId: TENANT_A.nodeId,
      nif: options.nif ?? "89890001K",
      idSistemaInformatico: options.softwareId ?? "W1",
      numeroInstalacion: identity,
      registradoEn: new Date("2026-10-16T11:20:00Z"),
      revocadoEn: options.retired ? new Date("2026-10-16T11:30:00Z") : null,
    })
    .returning({ id: registroSif.id });
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({
      nodeId: TENANT_A.nodeId,
      code: `other-base-${identity}`,
      purpose: "full",
      retiredAt: options.retired ? new Date("2026-10-16T11:35:00Z") : null,
    })
    .returning({ id: invoiceSeries.id });
  return { sifId: sif!.id, seriesId: series!.id };
}
const projection = async () =>
  projectHourHistory({
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    sources: [await readInventory()],
  });
it("retains revoked identities and retired series under another software ID", async () => {
  await seedRows({ identity: "06RC", softwareId: "OTHER", retired: true });
  const result = await projection();
  expect(result.greatestSpentHour).toBe(6924);
  expect(result.recordedTimeFloorMs).toBe(Date.parse("2026-10-16T11:35:00Z"));
  expect(result.contradictions).toEqual([]);
});
it("another taxpayer's higher identity stays independent", async () => {
  await seedRows({ identity: "ZZZZ", nif: "89890002M" });
  expect((await projection()).greatestSpentHour).toBeNull();
  expect((await projection()).contradictions).toEqual([]);
});
it("does not assume a nonempty unstamped database is the requested environment", async () => {
  await seedTenants(suite.db);
  await suite.db.insert(registroSif).values({
    nodeId: TENANT_A.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "06RC",
  });
  expect((await projection()).contradictions).toContain("venue:incomplete");
});
it("an unassignable series refuses completeness instead of disappearing", async () => {
  await seedRows();
  await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: TENANT_A.nodeId2, code: "R-06RC", purpose: "rectificative" });
  expect((await projection()).contradictions).toContain("venue:incomplete");
});
it("a malformed hour suffix cannot become empty history", async () => {
  await seedRows({ identity: "06rb" });
  expect((await projection()).contradictions.length).toBeGreaterThan(0);
});
it("a dormant reservation raises the floor without active series on its node", async () => {
  await seedRows();
  await suite.db.insert(fiscalReservations).values({
    eventKey: "dormant",
    allocationKey: "reserved",
    nodeId: TENANT_A.nodeId2,
    sourceNodeId: TENANT_A.nodeId,
    taxpayerNif: "89890001K",
    softwareId: "OTHER",
    environment: "preproduction",
    installationIdentity: "06RC",
    evidence: { public: "retained" },
    bases: [{ code: "different", purpose: "standard" }],
    establishedAt: new Date("2026-10-16T12:00:00Z"),
  });
  const result = await projection();
  expect(result.greatestSpentHour).toBe(6924);
  expect(result.recordedTimeFloorMs).toBe(Date.parse("2026-10-16T12:00:00Z"));
  expect(result.references).toContain("fiscal_reservations/dormant");
  expect(result.contradictions).toEqual([]);
});
it("an explicit reservation environment remains separate from the database stamp", async () => {
  await seedRows();
  await suite.db.insert(fiscalReservations).values({
    eventKey: "foreign",
    allocationKey: "reserved",
    nodeId: TENANT_A.nodeId2,
    sourceNodeId: TENANT_A.nodeId,
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "production",
    installationIdentity: "ZZZZ",
    evidence: { public: "retained" },
    bases: [{ code: "A", purpose: "standard" }],
  });
  expect((await projection()).greatestSpentHour).toBe(6923);
  expect((await projection()).contradictions).toEqual([]);
});
async function seedAllocation(change: Partial<typeof fiscalAllocations.$inferInsert> = {}) {
  const ids = await seedRows();
  const series = [{ id: ids.seriesId, code: "other-base-06RB", purpose: "full" }];
  // A standard base is required by admission; retain both purposes in this synthetic receipt.
  const [standard] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: TENANT_A.nodeId, code: "A-06RB", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  series.push({ id: standard!.id, code: "A-06RB", purpose: "standard" });
  const input = {
    version: 1 as const,
    allocationId: "allocation",
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction" as const,
    installationIdentity: "06RB",
    series: series.map(({ code, purpose }) => ({ code, purpose })),
    source: "hour" as const,
    reservationEvidence: null,
    issuedAt: "2026-10-16T11:40:00.000Z",
  };
  const approval = {
    version: 1 as const,
    eventId: "event",
    operatorId: "administrator",
    sourceId: "attempt",
    targetNodeId: TENANT_A.nodeId,
    oldMachineOffline: false,
    oldMachineAbsent: true,
    noParallelRecovery: true,
    confirmedAt: input.issuedAt,
    incidentEvidence: "owned/event",
  };
  await suite.db.insert(fiscalAllocations).values({
    eventKey: "event",
    allocationKey: "allocation",
    nodeId: TENANT_A.nodeId,
    sifId: ids.sifId,
    taxpayerNif: input.taxpayerNif,
    softwareId: input.softwareId,
    environment: input.environment,
    installationIdentity: input.installationIdentity,
    allocation: input,
    approval,
    bases: [
      { code: "other-base", purpose: "full" },
      { code: "A", purpose: "standard" },
    ],
    result: { activationEventId: "event", sifId: ids.sifId, series },
    activatedAt: new Date("2026-10-16T11:50:00Z"),
    ...change,
  });
}
it("includes the retained allocation's later commit time in the floor", async () => {
  await seedAllocation();
  const result = await projection();
  expect(result.recordedTimeFloorMs).toBe(Date.parse("2026-10-16T11:50:00Z"));
  expect(result.references).toContain("fiscal_allocations/event");
  expect(result.contradictions).toEqual([]);
});
it.each([
  { allocationKey: "changed" },
  { softwareId: "OTHER" },
  { installationIdentity: "06RC" },
  { nodeId: TENANT_A.nodeId2 },
  { allocation: {} },
  { approval: {} },
  { result: {} },
  { bases: [] },
])("a contradictory committed receipt %j refuses completeness", async (change) => {
  await seedAllocation(change as Partial<typeof fiscalAllocations.$inferInsert>);
  expect((await projection()).contradictions).toContain("venue:incomplete");
});

it.each([{ evidence: [] }, { evidence: "bad" }, { bases: [] }, { sourceNodeId: TENANT_A.nodeId2 }])(
  "a malformed reservation %j cannot masquerade as complete history",
  async (change) => {
    await seedRows();
    await suite.db.insert(fiscalReservations).values({
      eventKey: "damaged",
      allocationKey: "reserved",
      nodeId: TENANT_A.nodeId2,
      sourceNodeId: TENANT_A.nodeId,
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "preproduction",
      installationIdentity: "06RC",
      evidence: { public: "retained" },
      bases: [{ code: "A", purpose: "standard" }],
      ...change,
    });
    expect((await projection()).contradictions).toContain("venue:incomplete");
  },
);

it("retains a later recorded approval time even when its database commit timestamp is earlier", async () => {
  await seedAllocation({
    approval: {
      version: 1,
      eventId: "event",
      operatorId: "administrator",
      sourceId: "attempt",
      targetNodeId: TENANT_A.nodeId,
      oldMachineOffline: false,
      oldMachineAbsent: true,
      noParallelRecovery: true,
      confirmedAt: "2026-10-16T12:30:00.000Z",
      incidentEvidence: "owned/event",
    },
  });
  expect((await projection()).recordedTimeFloorMs).toBe(Date.parse("2026-10-16T12:30:00Z"));
});
