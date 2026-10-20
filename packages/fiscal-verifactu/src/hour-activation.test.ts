import { beforeEach, expect, it } from "vitest";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { activateModuleAllocation, withCollectedModuleAllocation } from "./allocation-operation.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const firstSeries = [
  { code: "A-06RB", purpose: "standard" },
  { code: "FF-06RB", purpose: "full" },
  { code: "R-06RB", purpose: "rectificative" },
  { code: "a/B_1.2-3-06RB", purpose: "standard" },
];

function fixture(action = "setup", identity = "06RB", eventId = "first-hour") {
  const binding: OperationBinding = {
    module: "fiscal-verifactu",
    action,
    eventId,
    sourceId: "owned-attempt",
    targetNodeId: node.nodeId,
  };
  const operatorId =
    action === "setup"
      ? "administrator"
      : {
          kind: "recovery-key" as const,
          nodeId: node.nodeId,
          eventId,
        };
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
      issuedAt: identity === "06RC" ? "2026-10-16T12:00:00.000Z" : "2026-10-16T11:40:00.000Z",
    },
    approval: {
      version: 1,
      eventId,
      operatorId,
      sourceId: binding.sourceId,
      targetNodeId: node.nodeId,
      oldMachineOffline: action !== "setup",
      oldMachineAbsent: action === "setup",
      noParallelRecovery: true,
      confirmedAt: "2026-10-16T11:40:00.000Z",
      incidentEvidence: `owned/${eventId}`,
    },
  };
  return { binding, operatorId, input };
}

async function activate(f = fixture(), priorActivation: "none" | "committed" = "none") {
  return withOperationAuthority(f.binding, f.operatorId, (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    return withHourAdmission(operation, { requiredBases: bases, priorActivation }, (evidence) =>
      withCollectedModuleAllocation(
        operation,
        async (request) => ({ ...request, evidence }),
        (write) => withTransaction(suite.db, (tx) => write(tx, node)),
      ),
    );
  });
}

async function snapshot() {
  return {
    sifs: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    allocations: await suite.db.select().from(fiscalAllocations),
  };
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
});

it("stores the first hour and every configured base through the unchanged writer", async () => {
  const result = await activate();
  expect(result.activationEventId).toBe("first-hour");
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual(firstSeries);
  const saved = await snapshot();
  expect(saved.sifs).toHaveLength(1);
  expect(saved.sifs[0]!.numeroInstalacion).toBe("06RB");
  expect(saved.allocations).toHaveLength(1);
  expect(saved.allocations[0]!.bases).toEqual(bases);
  expect(saved.allocations[0]!.allocation).toEqual(fixture().input.allocation);
});

it.each(["restore", "re-register"])(
  "retires the old series on %s without changing recovered counters",
  async (action) => {
    await activate();
    await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
    const original = await snapshot();
    const result = await activate(fixture(action, "06RC", "recovery-hour"));
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-06RC", purpose: "standard" },
      { code: "FF-06RC", purpose: "full" },
      { code: "R-06RC", purpose: "rectificative" },
      { code: "a/B_1.2-3-06RC", purpose: "standard" },
    ]);
    const after = await snapshot();
    expect(
      after.sifs.filter((row) => row.revocadoEn === null).map((row) => row.numeroInstalacion),
    ).toEqual(["06RC"]);
    expect(after.allocations).toHaveLength(2);
    for (const old of original.series) {
      expect(after.series.find((row) => row.id === old.id)).toEqual({
        ...old,
        retiredAt: expect.any(Date),
      });
    }
    expect(
      after.series.filter((row) => row.retiredAt === null).map((row) => row.nextNumber),
    ).toEqual([1, 1, 1, 1]);
  },
);

it("replays exactly with fresh authority and leaves all rows and counters unchanged", async () => {
  const first = await activate();
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  const before = await snapshot();
  expect(await activate(fixture(), "committed")).toEqual(first);
  expect(await snapshot()).toEqual(before);
});

it.each([
  ["oldMachineOffline", false, "old_machine_active"],
  ["oldMachineAbsent", true, "old_machine_absence_unconfirmed"],
  ["noParallelRecovery", false, "parallel_recovery"],
] as const)("refuses recovery with %s=%s", async (key, value, reason) => {
  await activate();
  const f = fixture("restore", "06RC", "recovery-hour");
  f.input.approval[key] = value;
  const before = await snapshot();
  await expect(activate(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason },
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses a changed exact replay instead of allocating again", async () => {
  await activate();
  const f = fixture();
  f.input.approval.confirmedAt = "2026-10-16T11:41:00.000Z";
  const before = await snapshot();
  await expect(activate(f, "committed")).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses JSON-recreated hour admission while the real callback remains valid", async () => {
  const f = fixture();
  await withOperationAuthority(f.binding, f.operatorId, (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    return withHourAdmission(
      operation,
      { requiredBases: bases, priorActivation: "none" },
      async (evidence) => {
        await expect(
          withTransaction(suite.db, (tx) =>
            activateModuleAllocation(tx, node, operation, structuredClone(evidence)),
          ),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "outside_confirmation_missing" },
        });
        const result = await withTransaction(suite.db, (tx) =>
          activateModuleAllocation(tx, node, operation, evidence),
        );
        expect(result.series.map(({ code }) => code)).toEqual([
          "A-06RB",
          "FF-06RB",
          "R-06RB",
          "a/B_1.2-3-06RB",
        ]);
      },
    );
  });
  expect((await snapshot()).allocations).toHaveLength(1);
});

it("expires the hour admission at callback exit even while operation authority is live", async () => {
  const f = fixture();
  await withOperationAuthority(f.binding, f.operatorId, async (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    const evidence = await withHourAdmission(
      operation,
      { requiredBases: bases, priorActivation: "none" },
      async (value) => value,
    );
    await expect(
      withTransaction(suite.db, (tx) => activateModuleAllocation(tx, node, operation, evidence)),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("refuses expired operation authority at admission", async () => {
  const f = fixture();
  const authority = await withOperationAuthority(f.binding, f.operatorId, async (value) => value);
  await expect(
    withHourAdmission(
      { binding: f.binding, authority, input: f.input },
      { requiredBases: bases, priorActivation: "none" },
      async () => null,
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
});

it("rejects paper protocol names from the new hour admission boundary", async () => {
  const f = fixture("setup", "S000001");
  f.input.allocation.source = "initial-paper";
  await expect(activate(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "source_mismatch" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["2025-12-31T23:59:59.999Z", "2145-08-15T16:00:00.000Z"])(
  "reports a domain refusal for selection outside the hour range at %s",
  async (issuedAt) => {
    const f = fixture();
    f.input.allocation.issuedAt = issuedAt;
    await expect(activate(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  },
);

it.each(["taxpayerNif", "softwareId", "environment"] as const)(
  "checks the selected %s against the real database",
  async (field) => {
    const f = fixture();
    const replacement = { taxpayerNif: "89890002M", softwareId: "W2", environment: "production" };
    const refusal = {
      taxpayerNif: "taxpayer_mismatch",
      softwareId: "software_mismatch",
      environment: "environment_mismatch",
    };
    f.input.allocation[field] = replacement[field];
    const before = await snapshot();
    await expect(activate(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: refusal[field] },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["missing", "extra", "duplicate", "purpose", "base"])(
  "refuses a %s configured series before any write",
  async (change) => {
    const f = fixture();
    if (change === "missing") f.input.allocation.series.pop();
    if (change === "extra")
      f.input.allocation.series.push({ code: "extra-06RB", purpose: "standard" });
    if (change === "duplicate") f.input.allocation.series[1] = f.input.allocation.series[0]!;
    if (change === "purpose") f.input.allocation.series[2]!.purpose = "standard";
    if (change === "base") f.input.allocation.series[1]!.code = "A/B_1.2-3-06RB";
    await expect(activate(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "series_mismatch" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  },
);

it("cannot reuse a live token with changed operation input or copied operation authority", async () => {
  const f = fixture();
  await withOperationAuthority(f.binding, f.operatorId, (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    return withHourAdmission(
      operation,
      { requiredBases: bases, priorActivation: "none" },
      async (evidence) => {
        const changed = structuredClone(f.input);
        changed.approval.confirmedAt = "2026-10-16T11:41:00.000Z";
        await expect(
          withTransaction(suite.db, (tx) =>
            activateModuleAllocation(tx, node, { ...operation, input: changed }, evidence),
          ),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "reservation_mismatch" },
        });
        await expect(
          withTransaction(suite.db, (tx) =>
            activateModuleAllocation(
              tx,
              node,
              { ...operation, authority: structuredClone(authority) },
              evidence,
            ),
          ),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "reauthentication_required" },
        });
      },
    );
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("detaches admitted input, binding and base facts before invoking its callback", async () => {
  const f = fixture();
  await withOperationAuthority(f.binding, f.operatorId, (authority) => {
    const operation = { binding: { ...f.binding }, authority, input: structuredClone(f.input) };
    const facts = { requiredBases: structuredClone(bases), priorActivation: "none" as const };
    return withHourAdmission(operation, facts, async (evidence) => {
      operation.binding.eventId = "altered";
      operation.input.allocation.series[0]!.code = "altered";
      facts.requiredBases[0]!.code = "altered";
      const original = { binding: f.binding, authority, input: f.input };
      const result = await withTransaction(suite.db, (tx) =>
        activateModuleAllocation(tx, node, original, evidence),
      );
      expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual(firstSeries);
    });
  });
});

it("keeps hour admission bound to the exact authenticated recovery action", async () => {
  await activate();
  const f = fixture("restore", "06RC", "recovery-hour");
  const before = await snapshot();
  await withOperationAuthority(f.binding, f.operatorId, (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    return withHourAdmission(
      operation,
      { requiredBases: bases, priorActivation: "none" },
      async (evidence) => {
        const otherBinding = { ...f.binding, action: "re-register" };
        await withOperationAuthority(otherBinding, f.operatorId, async (otherAuthority) => {
          await expect(
            withTransaction(suite.db, (tx) =>
              activateModuleAllocation(
                tx,
                node,
                {
                  binding: otherBinding,
                  authority: otherAuthority,
                  input: f.input,
                },
                evidence,
              ),
            ),
          ).rejects.toMatchObject({
            code: "sif.allocation_invalid",
            params: { reason: "reservation_mismatch" },
          });
        });
      },
    );
  });
  expect(await snapshot()).toEqual(before);
});

it("rolls back activation when hour admission expires during the writer's awaited work", async () => {
  const f = fixture();
  let entered!: () => void;
  let release!: () => void;
  const reachedWrite = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const resumeWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withOperationAuthority(f.binding, f.operatorId, async (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    await expect(
      withTransaction(suite.db, async (tx) => {
        const heldTx = new Proxy(tx, {
          get(target, key, receiver) {
            if (key !== "insert") return Reflect.get(target, key, receiver);
            return (table: Parameters<typeof tx.insert>[0]) => {
              const query = target.insert(table);
              if (table !== registroSif) return query;
              return new Proxy(query, {
                get(builder, property, owner) {
                  if (property !== "values") return Reflect.get(builder, property, owner);
                  return async (values: Parameters<typeof query.values>[0]) => {
                    entered();
                    await resumeWrite;
                    return builder.values(values);
                  };
                },
              });
            };
          },
        });
        let pending!: ReturnType<typeof activateModuleAllocation>;
        try {
          await withHourAdmission(
            operation,
            { requiredBases: bases, priorActivation: "none" },
            async (evidence) => {
              pending = activateModuleAllocation(heldTx, node, operation, evidence);
              void pending.catch(() => undefined);
              await Promise.race([reachedWrite, pending]);
            },
          );
        } finally {
          release();
        }
        await pending;
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});

it.each([
  ["missing input", null, "malformed_allocation"],
  [
    "extra input field",
    { allocation: {}, approval: {}, secret: "forbidden" },
    "malformed_allocation",
  ],
  ["missing allocation", { allocation: null, approval: {} }, "malformed_allocation"],
  [
    "invalid hour identity",
    {
      allocation: { ...fixture().input.allocation, installationIdentity: "S000001" },
      approval: fixture().input.approval,
    },
    "malformed_allocation",
  ],
  [
    "missing approval",
    { allocation: fixture().input.allocation, approval: null },
    "malformed_approval",
  ],
  [
    "non-null reservation",
    {
      allocation: { ...fixture().input.allocation, reservationEvidence: {} },
      approval: fixture().input.approval,
    },
    "reservation_mismatch",
  ],
  [
    "out-of-range timestamp",
    {
      allocation: { ...fixture().input.allocation, issuedAt: "1900-01-01T00:00:00.000Z" },
      approval: fixture().input.approval,
    },
    "reservation_mismatch",
  ],
])("refuses %s at hour admission without entering the callback", async (_name, input, reason) => {
  const f = fixture();
  let entered = false;
  await expect(
    withOperationAuthority(f.binding, f.operatorId, (authority) =>
      withHourAdmission(
        { binding: f.binding, authority, input },
        {
          requiredBases: bases,
          priorActivation: "none",
        },
        async () => {
          entered = true;
        },
      ),
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason } });
  expect(entered).toBe(false);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
