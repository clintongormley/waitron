import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type ModuleOperationInput,
  type OperationBinding,
} from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { createHourPreparation } from "./hour-preparation.js";
import {
  createHourRecoveryPreparation,
  type HourRecoveryFacts,
} from "./hour-recovery-preparation.js";
import { compareHourClocks } from "./hour-clock.js";
import type { HourSelectionStore } from "./hour-selection.js";
import { readHourHistory } from "./hour-history-reader.js";
import { ALLOCATED_FISCAL_RESTORE } from "./allocated-lifecycle.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { assertFiscalRestoreCommitted } from "./restore-committed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "restore-hour",
  sourceId: "exact-selected-artifact",
  targetNodeId: node.nodeId,
};
const operator = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
function clock(instant = "2026-10-16T12:40:00.000Z") {
  const at = Date.parse(instant);
  return compareHourClocks(
    ["box", "browser"].map((source) => ({
      source: source as "box" | "browser",
      result: "usable" as const,
      instantMs: at,
      uncertaintyMs: 0,
      wallStartedMs: at,
      wallFinishedMs: at,
      monotonicStartedMs: 0,
      monotonicFinishedMs: 0,
    })),
    Date.parse("2026-10-15T00:00:00Z"),
  );
}
function store() {
  let value: unknown = null;
  const history: unknown[] = [];
  let held = false;
  const withState: HourSelectionStore = async (_binding, run) => {
    if (held) throw new Error("nested exclusion");
    held = true;
    try {
      return await run({
        get value() {
          return structuredClone(value);
        },
        get history() {
          return structuredClone(history);
        },
        async replace(next) {
          value = structuredClone(next);
          history.push(structuredClone(next));
        },
      });
    } finally {
      held = false;
    }
  };
  return { withState, history };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00.000Z"));
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  const setup = createHourPreparation({
    ...store(),
    monotonicNow: () => 0,
    read: async () => ({
      scope,
      bases,
      contextKey: "original-owner",
      clock: clock("2026-10-16T11:40:00.000Z"),
      history: [{ reference: "empty", complete: true, records: [] }],
    }),
  });
  const first = { ...binding, action: "setup", eventId: "original-hour" };
  await withOperationAuthority(first, "administrator", async (authority) => {
    const selected = await setup.select({ binding: first, authority, answer: "no" });
    if (selected.status !== "selected") throw new Error("setup not selected");
    await setup.prepare({ binding: first, authority, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
  });
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  vi.setSystemTime(new Date("2026-10-16T12:40:00.000Z"));
});
afterEach(() => vi.useRealTimers());
async function fixture(monotonicNow = () => 0) {
  const state = store();
  const facts: HourRecoveryFacts = {
    scope,
    bases,
    contextKey: "selected-backup/key-name/isolated",
    clock: clock(),
    history: [await withTransaction(suite.db, (tx) => readHourHistory(tx, "preproduction"))],
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    priorActivation: "none",
  };
  return {
    state,
    facts,
    preparation: createHourRecoveryPreparation({
      ...state,
      read: async () => facts,
      monotonicNow,
    }),
  };
}
async function snapshot() {
  return {
    series: await suite.db.select().from(invoiceSeries),
    sifs: await suite.db.select().from(registroSif),
    activations: await suite.db.select().from(fiscalAllocations),
  };
}
async function restore(
  preparation: ReturnType<typeof createHourRecoveryPreparation>,
  operation: ModuleOperationInput,
) {
  return preparation.prepare(operation, (prepared) =>
    withTransaction(suite.db, (tx) => ALLOCATED_FISCAL_RESTORE(tx, node, prepared)),
  );
}

it("selects and activates the next hour through the unchanged restore hook while retaining recovered counters", async () => {
  const f = await fixture();
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    const selected = await f.preparation.select({ binding, authority, answer: "no" });
    expect(selected.status).toBe("selected");
    if (selected.status !== "selected") throw new Error("not selected");
    expect(selected.identity).toBe("06RC");
    expect(selected.input.approval.operatorId).toEqual(operator);
    expect(selected.input.allocation.series).toEqual([
      { code: "A-06RC", purpose: "standard" },
      { code: "FF-06RC", purpose: "full" },
      { code: "R-06RC", purpose: "rectificative" },
    ]);
    await restore(f.preparation, { binding, authority, input: selected.input });
  });
  const after = await snapshot();
  for (const old of before.series)
    expect(after.series.find((row) => row.id === old.id)).toEqual({
      ...old,
      retiredAt: expect.any(Date),
    });
  expect(after.series.filter((row) => row.retiredAt === null).map((row) => row.nextNumber)).toEqual(
    [1, 1, 1],
  );
  expect(
    after.sifs.filter((row) => row.revocadoEn === null).map((row) => row.numeroInstalacion),
  ).toEqual(["06RC"]);
  expect(after.activations).toHaveLength(2);
  expect(after.activations.find((row) => row.eventKey === "original-hour")).toEqual(
    before.activations[0],
  );
});

it.each([
  "administrator",
  { ...operator, nodeId: TENANT_A.nodeId2 },
  { ...operator, eventId: "different-event" },
])("refuses an authority that does not name the recovered node and event: %j", async (supplied) => {
  const f = await fixture();
  const before = await snapshot();
  await withOperationAuthority(binding, supplied, async (authority) => {
    await expect(f.preparation.select({ binding, authority, answer: "no" })).rejects.toMatchObject(
      refusal("reauthentication_required"),
    );
  });
  expect(f.state.history).toEqual([]);
  expect(await snapshot()).toEqual(before);
});

it.each([
  [{ oldMachineOffline: false }, "old_machine_active"],
  [{ noParallelRecovery: false }, "parallel_recovery"],
  [{ oldMachineAbsent: true }, "old_machine_absence_unconfirmed"],
] as const)("refuses missing isolation before spending an hour: %j", async (changed, reason) => {
  const f = await fixture();
  Object.assign(f.facts, changed);
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(f.preparation.select({ binding, authority, answer: "no" })).rejects.toMatchObject(
      refusal(reason),
    );
  });
  expect(f.state.history).toEqual([]);
  expect(await snapshot()).toEqual(before);
});

it("allows a later surviving host floor to raise an older selected backup floor", async () => {
  const f = await fixture();
  Object.assign(f.facts, {
    history: [
      ...f.facts.history,
      {
        reference: "surviving-host",
        complete: true,
        records: [
          {
            ...scope,
            reference: "other-node",
            nodeId: TENANT_A.nodeId2,
            softwareId: "OTHER",
            kind: "retirement",
            identity: "06RD",
            recordedAtMs: Date.parse("2026-10-16T13:00:00Z"),
          },
        ],
      },
    ],
  });
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(f.preparation.select({ binding, authority, answer: "no" })).rejects.toMatchObject(
      refusal("hour_not_later"),
    );
  });
  expect(f.state.history).toEqual([]);
});

it("rejects an operation moved to another backup after selection without changing recovered rows", async () => {
  const f = await fixture();
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    const selected = await f.preparation.select({ binding, authority, answer: "no" });
    if (selected.status !== "selected") throw new Error("not selected");
    const other = { ...binding, sourceId: "different-selected-artifact" };
    await withOperationAuthority(other, operator, async (otherAuthority) => {
      await expect(
        restore(f.preparation, {
          binding: other,
          authority: otherAuthority,
          input: selected.input,
        }),
      ).rejects.toMatchObject(refusal("event_mismatch"));
    });
  });
  expect(await snapshot()).toEqual(before);
});

it("does not let a forward wall-clock jump complete a retained recovery wait early", async () => {
  let monotonic = 0;
  const f = await fixture(() => monotonic);
  await withOperationAuthority(binding, operator, async (authority) => {
    expect(await f.preparation.select({ binding, authority, answer: "yes" })).toMatchObject({
      status: "waiting",
      remainingMs: 1200000,
    });
    Object.assign(f.facts, { clock: clock("2026-10-16T13:10:00.000Z") });
    expect(await f.preparation.select({ binding, authority, answer: "yes" })).toMatchObject({
      status: "waiting",
      remainingMs: 1200000,
    });
    monotonic = 1200000;
    expect(await f.preparation.select({ binding, authority, answer: "yes" })).toMatchObject({
      status: "selected",
      identity: "06RD",
    });
  });
});

it("previews a later recovery hour without spending it", async () => {
  const f = await fixture();
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    expect(await f.preparation.preview({ binding, authority })).toMatchObject({
      status: "preview",
      identity: "06RC",
    });
  });
  expect(f.state.history).toEqual([]);
  expect(await snapshot()).toEqual(before);
});

it("replays the exact committed restore without another hour or counter change", async () => {
  const f = await fixture();
  let input: unknown;
  await withOperationAuthority(binding, operator, async (authority) => {
    const selected = await f.preparation.select({ binding, authority, answer: "no" });
    if (selected.status !== "selected") throw new Error("not selected");
    input = selected.input;
    await restore(f.preparation, { binding, authority, input });
  });
  Object.assign(f.facts, { priorActivation: "committed" });
  const before = await snapshot();
  const revisions = structuredClone(f.state.history);
  const restarted = createHourRecoveryPreparation({
    ...f.state,
    read: async () => f.facts,
    monotonicNow: () => 0,
  });
  await withOperationAuthority(binding, operator, async (authority) => {
    await withTransaction(suite.db, (tx) => assertFiscalRestoreCommitted(tx, node, binding));
    await expect(restore(restarted, { binding, authority, input })).resolves.toHaveProperty(
      "report",
    );
  });
  expect(await snapshot()).toEqual(before);
  expect(f.state.history).toEqual(revisions);
});

it.each(["context", "bases", "input", "isolation"])(
  "refuses changed %s between selection and restore",
  async (part) => {
    const f = await fixture();
    const before = await snapshot();
    await withOperationAuthority(binding, operator, async (authority) => {
      const selected = await f.preparation.select({ binding, authority, answer: "no" });
      if (selected.status !== "selected") throw new Error("not selected");
      const input = structuredClone(selected.input);
      if (part === "context") Object.assign(f.facts, { contextKey: "other-backup-or-key" });
      if (part === "bases")
        Object.assign(f.facts, { bases: [...bases, { code: "EXTRA", purpose: "standard" }] });
      if (part === "input") input.allocation.series[0]!.code = "OTHER-06RC";
      if (part === "isolation") Object.assign(f.facts, { oldMachineOffline: false });
      await expect(restore(f.preparation, { binding, authority, input })).rejects.toMatchObject(
        refusal(part === "isolation" ? "old_machine_active" : "event_mismatch"),
      );
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("does not treat supplied hour material as a substitute for the durable selected intent", async () => {
  const f = await fixture();
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    const selected = await f.preparation.select({ binding, authority, answer: "no" });
    if (selected.status !== "selected") throw new Error("not selected");
    const empty = createHourRecoveryPreparation({
      ...store(),
      read: async () => f.facts,
      monotonicNow: () => 0,
    });
    await expect(
      restore(empty, { binding, authority, input: selected.input }),
    ).rejects.toMatchObject(refusal("reservation_missing"));
  });
  expect(await snapshot()).toEqual(before);
});

it("rechecks authority after a delayed source read before spending an hour", async () => {
  const f = await fixture();
  let release!: () => void;
  let reading!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reading = resolve;
  });
  const delayed = createHourRecoveryPreparation({
    ...f.state,
    monotonicNow: () => 0,
    read: async () => {
      reading();
      await gate;
      return f.facts;
    },
  });
  let pending!: ReturnType<typeof delayed.select>;
  await withOperationAuthority(binding, operator, async (authority) => {
    pending = delayed.select({ binding, authority, answer: "no" });
    await entered;
  });
  const rejected = expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  release();
  await rejected;
  expect(f.state.history).toEqual([]);
});

it.each(["setup", "promote", "reserve"])(
  "does not admit the %s action through recovery preparation",
  async (action) => {
    const f = await fixture();
    const other = { ...binding, action };
    await withOperationAuthority(other, operator, async (authority) => {
      await expect(
        f.preparation.select({ binding: other, authority, answer: "no" }),
      ).rejects.toMatchObject(refusal("event_mismatch"));
    });
    expect(f.state.history).toEqual([]);
  },
);

it("refuses uncloneable submitted input before a restore write", async () => {
  const f = await fixture();
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(
      restore(f.preparation, { binding, authority, input: { unexpected: () => {} } }),
    ).rejects.toMatchObject(refusal("malformed_allocation"));
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses an unknown prior-activation classification before spending an hour", async () => {
  const f = await fixture();
  Object.assign(f.facts, { priorActivation: "unknown" });
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(f.preparation.select({ binding, authority, answer: "no" })).rejects.toMatchObject(
      refusal("event_mismatch"),
    );
  });
  expect(f.state.history).toEqual([]);
});

it("cannot prepare another module's recovery event", async () => {
  const f = await fixture();
  const other = { ...binding, module: "other-module" };
  await withOperationAuthority(other, operator, async (authority) => {
    await expect(
      f.preparation.select({ binding: other, authority, answer: "no" }),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  });
  expect(f.state.history).toEqual([]);
});
