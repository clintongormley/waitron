import { expect, it } from "vitest";
import { withOperationAuthority } from "@waitron/module";
import {
  createHourRecoveryPreparation,
  type HourRecoveryFacts,
} from "./hour-recovery-preparation.js";
import { compareHourClocks } from "./hour-clock.js";
import type { HourSelectionStore } from "./hour-selection.js";

const binding = {
  module: "fiscal-verifactu",
  action: "conflict-switch",
  eventId: "conflict-event",
  sourceId: "committed-conflict",
  targetNodeId: "node-1",
};
const operator = { kind: "recovery-key" as const, nodeId: "node-1", eventId: "conflict-event" };
const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
function fixture() {
  let instant = Date.parse("2026-10-16T12:38:00Z");
  let monotonic = 0;
  let value: unknown = null;
  const history: unknown[] = [];
  const withState: HourSelectionStore = async (_binding, run) =>
    run({
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
  const read = async (): Promise<HourRecoveryFacts> => ({
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    bases: [{ code: "A", purpose: "standard" }],
    contextKey: "live-key-and-series",
    history: [{ reference: "live", complete: true, records: [] }],
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    priorActivation: "none",
    clock: compareHourClocks(
      ["box", "browser"].map((source) => ({
        source: source as "box" | "browser",
        result: "usable",
        instantMs: instant,
        uncertaintyMs: 0,
        wallStartedMs: instant,
        wallFinishedMs: instant,
        monotonicStartedMs: monotonic,
        monotonicFinishedMs: monotonic,
      })),
      Date.parse("2026-10-15T00:00:00Z"),
    ),
  });
  const options = { withState, read, monotonicNow: () => monotonic };
  return {
    options,
    preparation: createHourRecoveryPreparation(options),
    history,
    settle() {
      instant = Date.parse("2026-10-16T12:40:00Z");
      monotonic = 120_000;
    },
  };
}

it("settles a live conflict minute and grants one callback-scoped activation", async () => {
  const f = fixture();
  await withOperationAuthority(binding, operator, async (authority) => {
    expect(await f.preparation.select({ binding, authority, comparisonId: "clock" })).toEqual({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T12:40:00Z"),
      remainingMs: 120_000,
    });
    f.settle();
    const selected = await f.preparation.select({ binding, authority, comparisonId: "clock" });
    expect(selected.status).toBe("selected");
    if (selected.status !== "selected") throw new Error("not selected");
    expect(selected.input.approval.operatorId).toEqual(operator);
    expect(selected.input.allocation.installationIdentity).toBe("0CNQR");
    expect(
      await f.preparation.prepare(
        { binding, authority, input: selected.input },
        async () => "activated",
      ),
    ).toBe("activated");
    await expect(
      f.preparation.prepare(
        { binding, authority, input: selected.input },
        async () => "unexpected",
      ),
    ).rejects.toMatchObject(refusal("uncertain_prior_activation"));
  });
});

it.each(["restart", "failed-activation", "duplicate-select"])(
  "does not recreate spent admission after %s",
  async (loss) => {
    const f = fixture();
    await withOperationAuthority(binding, operator, async (authority) => {
      await f.preparation.select({ binding, authority, comparisonId: "clock" });
      f.settle();
      const selected = await f.preparation.select({ binding, authority, comparisonId: "clock" });
      if (selected.status !== "selected") throw new Error("not selected");
      if (loss !== "restart")
        await expect(
          f.preparation.prepare({ binding, authority, input: selected.input }, async () => {
            throw new Error("rolled back");
          }),
        ).rejects.toThrow("rolled back");
      if (loss === "duplicate-select")
        expect(await f.preparation.select({ binding, authority, comparisonId: "clock" })).toEqual(
          selected,
        );
      const retry = loss === "restart" ? createHourRecoveryPreparation(f.options) : f.preparation;
      await expect(
        retry.prepare({ binding, authority, input: selected.input }, async () => "unexpected"),
      ).rejects.toMatchObject(refusal("uncertain_prior_activation"));
      expect(f.history).toHaveLength(2);
    });
  },
);

it("requires a recovery key rather than an account authority for conflict switching", async () => {
  const f = fixture();
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await expect(
      f.preparation.select({ binding, authority, comparisonId: "clock" }),
    ).rejects.toMatchObject(refusal("reauthentication_required"));
  });
  expect(f.history).toEqual([]);
});

it("compares an activation binding by values when its properties arrive in another order", async () => {
  const f = fixture();
  await withOperationAuthority(binding, operator, async (authority) => {
    await f.preparation.select({ binding, authority, comparisonId: "clock" });
    f.settle();
    const selected = await f.preparation.select({ binding, authority, comparisonId: "clock" });
    if (selected.status !== "selected") throw new Error("not selected");
    const reordered = {
      targetNodeId: binding.targetNodeId,
      sourceId: binding.sourceId,
      eventId: binding.eventId,
      action: binding.action,
      module: binding.module,
    };
    expect(
      await f.preparation.prepare(
        { binding: reordered, authority, input: selected.input },
        async () => "activated",
      ),
    ).toBe("activated");
  });
});
