import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { withHourAdmission, type AllocationContext } from "./allocation-envelope.js";
import { activateModuleAllocation, withCollectedModuleAllocation } from "./allocation-operation.js";
import { activateAuthenticatedHourStandbyAllocation } from "./allocation.js";
import { FISCAL_OPERATIONS } from "./index.js";
import { compareHourClocks } from "./hour-clock.js";
import { createHourSelection } from "./hour-selection.js";
import type { HourHistorySource } from "./hour-history.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";
import { registroSif } from "./schema/sif.js";
import { cadenas } from "./schema/cadenas.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];

function fixture(action = "promote", identity = "06RC", eventId = "promotion") {
  const target = action === "setup" ? primary : standby;
  const binding: OperationBinding = {
    module: "fiscal-verifactu",
    action,
    eventId,
    sourceId: primary.nodeId,
    targetNodeId: target.nodeId,
  };
  const operatorId = "administrator";
  const issuedAt =
    identity === "06RB"
      ? "2026-10-16T11:40:00.000Z"
      : identity === "06RD"
        ? "2026-10-16T13:00:00.000Z"
        : "2026-10-16T12:00:00.000Z";
  const input = {
    allocation: {
      version: 1,
      allocationId: `hour/${eventId}`,
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "preproduction",
      installationIdentity: identity,
      series: bases.map((base) => ({ ...base, code: `${base.code}-${identity}` })),
      source: "hour",
      reservationEvidence: null,
      issuedAt,
    },
    approval: {
      version: 1,
      eventId,
      operatorId,
      sourceId: binding.sourceId,
      targetNodeId: target.nodeId,
      oldMachineOffline: action !== "setup",
      oldMachineAbsent: action === "setup",
      noParallelRecovery: true,
      confirmedAt: issuedAt,
      incidentEvidence: `hour/${eventId}`,
    },
  };
  return { binding, operatorId, input, target };
}

async function activate(
  f = fixture(),
  priorActivation: "none" | "committed" | "uncertain" = "none",
  requiredBases = bases,
) {
  return withOperationAuthority(f.binding, f.operatorId, (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    return withHourAdmission(operation, { requiredBases, priorActivation }, (evidence) =>
      withCollectedModuleAllocation(
        operation,
        async (request) => ({ ...request, evidence }),
        (write) => withTransaction(suite.db, (tx) => write(tx, f.target)),
      ),
    );
  });
}

async function snapshot() {
  return {
    sifs: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    allocations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
    chains: await suite.db.select().from(cadenas),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00.000Z"));
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await activate(fixture("setup", "06RB", "original"));
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
});
afterEach(() => vi.useRealTimers());

it("refuses the original box's same-hour code before writing any standby fiscal row", async () => {
  const before = await snapshot();
  await expect(activate(fixture("promote", "06RB"))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "installation_used" },
  });
  expect(await snapshot()).toEqual(before);
});

it("activates all next-hour bases without an advance reservation and preserves original counters", async () => {
  const before = await snapshot();
  const result = await activate();
  expect(result.activationEventId).toBe("promotion");
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-06RC", purpose: "standard" },
    { code: "FF-06RC", purpose: "full" },
    { code: "R-06RC", purpose: "rectificative" },
    { code: "a/B_1.2-3-06RC", purpose: "standard" },
  ]);
  const after = await snapshot();
  expect(after.reservations).toEqual([]);
  expect(after.allocations).toHaveLength(2);
  expect(after.allocations[1]!.bases).toEqual(bases);
  expect(after.sifs.find((row) => row.nodeId === standby.nodeId)?.numeroInstalacion).toBe("06RC");
  expect(
    after.series.filter((row) => row.nodeId === standby.nodeId).map((row) => row.nextNumber),
  ).toEqual([1, 1, 1, 1]);
  expect(after.sifs.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.sifs);
  expect(after.series.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.series);
  expect(after.chains.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.chains);
});

it("replays the exact committed promotion without changing counters or fiscal rows", async () => {
  const first = await activate();
  await suite.db
    .update(invoiceSeries)
    .set({ nextNumber: 321 })
    .where(eq(invoiceSeries.nodeId, standby.nodeId));
  const before = await snapshot();
  expect(await activate(fixture(), "committed")).toEqual(first);
  expect(await snapshot()).toEqual(before);
});

it("refuses a new event for an already active standby without retiring its series", async () => {
  await activate();
  const before = await snapshot();
  await expect(activate(fixture("promote", "06RD", "replacement"))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "standby_already_active" },
  });
  expect(await snapshot()).toEqual(before);
});

it("also refuses reuse after the original SIF and every original series are retired", async () => {
  await suite.db.update(registroSif).set({ revocadoEn: new Date("2026-10-16T11:45:00Z") });
  await suite.db.update(invoiceSeries).set({ retiredAt: new Date("2026-10-16T11:45:00Z") });
  const before = await snapshot();
  await expect(activate(fixture("promote", "06RB"))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "installation_used" },
  });
  expect(await snapshot()).toEqual(before);
});

it.each(["no", "yes", "unknown"] as const)(
  "refuses same-hour promotion selection against actual original-box history even after a %s answer",
  async (answer) => {
    const f = fixture();
    let instant = Date.parse("2026-10-16T11:50:00.000Z");
    let value: unknown = null;
    const writes: unknown[] = [];
    const selector = createHourSelection({
      withState: async (_binding, run) =>
        run({
          value,
          history: writes,
          async replace(next) {
            value = structuredClone(next);
            writes.push(structuredClone(next));
          },
        }),
      monotonicNow: () => 0,
      read: async () => ({
        scope: { taxpayerNif: "89890001K", environment: "preproduction" },
        bases,
        contextKey: "current-promotion-scope",
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable" as const,
            instantMs: instant,
            uncertaintyMs: 0,
            wallStartedMs: instant,
            wallFinishedMs: instant,
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          })),
          Date.parse("2026-10-15T00:00:00.000Z"),
        ),
        history: (await FISCAL_OPERATIONS.readRecoveryHistory!(suite.db)) as HourHistorySource[],
      }),
    });
    const before = await snapshot();
    await withOperationAuthority(f.binding, f.operatorId, async (authority) => {
      await expect(
        selector.select({ binding: f.binding, authority, answer }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "hour_not_later" },
      });
      expect(writes).toEqual([]);
      instant = Date.parse("2026-10-16T12:00:00.000Z");
      const next = await selector.select({ binding: f.binding, authority, answer: "no" });
      expect(next).toMatchObject({ status: "selected", identity: "06RC" });
      expect(writes).toHaveLength(1);
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([
  ["oldMachineOffline", false, "old_machine_active"],
  ["oldMachineAbsent", true, "old_machine_absence_unconfirmed"],
  ["noParallelRecovery", false, "parallel_recovery"],
] as const)("refuses promotion with %s=%s", async (key, value, reason) => {
  const f = fixture();
  f.input.approval[key] = value;
  const before = await snapshot();
  await expect(activate(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason },
  });
  expect(await snapshot()).toEqual(before);
});

it.each(["taxpayerNif", "softwareId", "environment"] as const)(
  "refuses promotion with changed %s against the real stored scope",
  async (field) => {
    const f = fixture();
    const replacement = { taxpayerNif: "89890002M", softwareId: "W2", environment: "production" };
    const reason = {
      taxpayerNif: "taxpayer_mismatch",
      softwareId: "software_mismatch",
      environment: "environment_mismatch",
    };
    f.input.allocation[field] = replacement[field];
    const before = await snapshot();
    await expect(activate(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: reason[field] },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses an incomplete base set instead of dropping a configured series", async () => {
  const before = await snapshot();
  await expect(activate(fixture(), "none", bases.slice(1))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "series_mismatch" },
  });
  expect(await snapshot()).toEqual(before);
});

it("keeps an expired admission unusable while promotion authority is still live", async () => {
  const f = fixture();
  const before = await snapshot();
  await withOperationAuthority(f.binding, f.operatorId, async (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    const evidence = await withHourAdmission(
      operation,
      { requiredBases: bases, priorActivation: "none" },
      async (value) => value,
    );
    await expect(
      withTransaction(suite.db, (tx) => activateModuleAllocation(tx, standby, operation, evidence)),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
  expect(await snapshot()).toEqual(before);
});

function contextFor(
  f: ReturnType<typeof fixture>,
  authority: AllocationContext["authority"],
): AllocationContext {
  return {
    ...f.binding,
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction",
    mode: "recovery",
    operatorId: f.operatorId,
    requiredBases: structuredClone(bases),
    priorActivation: "none",
    reauthentication: null,
    incidentEvidence: f.input.approval.incidentEvidence,
    authority,
  };
}

it("rejects a non-hour carrier before entering the standby writer", async () => {
  const f = fixture();
  const before = await snapshot();
  await withOperationAuthority(f.binding, f.operatorId, async (authority) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        activateAuthenticatedHourStandbyAllocation(
          tx,
          standby,
          f.input.allocation,
          f.input.approval,
          contextFor(f, { kind: "cloud" }),
          authority,
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "source_mismatch" },
    });
  });
  expect(await snapshot()).toEqual(before);
});

it("rejects expired promotion authentication even with a fresh hour admission", async () => {
  const f = fixture();
  const expired = await withOperationAuthority(f.binding, f.operatorId, async (value) => value);
  const before = await snapshot();
  await withOperationAuthority(f.binding, f.operatorId, (authority) =>
    withHourAdmission(
      { binding: f.binding, authority, input: f.input },
      { requiredBases: bases, priorActivation: "none" },
      async (evidence) => {
        await expect(
          withTransaction(suite.db, (tx) =>
            activateAuthenticatedHourStandbyAllocation(
              tx,
              standby,
              f.input.allocation,
              f.input.approval,
              contextFor(f, evidence.authority),
              expired,
            ),
          ),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "reauthentication_required" },
        });
      },
    ),
  );
  expect(await snapshot()).toEqual(before);
});

it.each(["sif", "series"] as const)(
  "refuses a standby retaining only an active %s before activating a fresh event",
  async (retained) => {
    await activate();
    if (retained === "sif") {
      await suite.db
        .update(invoiceSeries)
        .set({ retiredAt: new Date() })
        .where(eq(invoiceSeries.nodeId, standby.nodeId));
    } else {
      await suite.db
        .update(registroSif)
        .set({ revocadoEn: new Date() })
        .where(eq(registroSif.nodeId, standby.nodeId));
    }
    const before = await snapshot();
    await expect(activate(fixture("promote", "06RD", "new-event"))).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "standby_already_active" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("detaches target, authority carrier and bases before its first awaited read", async () => {
  const f = fixture();
  const before = await snapshot();
  await withOperationAuthority(f.binding, f.operatorId, (authority) =>
    withHourAdmission(
      { binding: f.binding, authority, input: f.input },
      { requiredBases: bases, priorActivation: "none" },
      async (evidence) => {
        const target = { ...standby };
        const required = structuredClone(bases);
        const carrier = { ...evidence.authority };
        const context = { ...contextFor(f, carrier), requiredBases: required };
        const result = await withTransaction(suite.db, (tx) => {
          const pending = activateAuthenticatedHourStandbyAllocation(
            tx,
            target,
            f.input.allocation,
            f.input.approval,
            context,
            authority,
          );
          target.nodeId = primary.nodeId;
          required[0]!.code = "changed";
          if (carrier.kind === "hour") carrier.token = {};
          return pending;
        });
        expect(result.series.map(({ code }) => code)).toEqual([
          "A-06RC",
          "FF-06RC",
          "R-06RC",
          "a/B_1.2-3-06RC",
        ]);
      },
    ),
  );
  const after = await snapshot();
  expect(after.allocations[1]!.nodeId).toBe(standby.nodeId);
  expect(after.allocations[1]!.bases).toEqual(bases);
  expect(after.sifs.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.sifs);
  expect(after.series.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.series);
});

it("refuses changed committed promotion input instead of issuing another identity", async () => {
  await activate();
  const f = fixture();
  f.input.approval.confirmedAt = "2026-10-16T12:01:00.000Z";
  const before = await snapshot();
  await expect(activate(f, "committed")).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  expect(await snapshot()).toEqual(before);
});
