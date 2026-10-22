import { describe, expect, it } from "vitest";
import { createModuleOperationHost } from "@waitron/provisioning";
import { withOperationAuthority } from "@waitron/module";
import { hostedHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { hostedHourRecovery } from "@waitron/fiscal-verifactu/src/hosted-hour-recovery.js";
import { createHourTestClock, selectPastWaits } from "./hour-test-clock.js";

const T = Date.parse("2026-10-24T09:00:04Z");

describe("createHourTestClock", () => {
  it("reads the instant it was started at", () => {
    expect(createHourTestClock(T).wall()).toBe(T);
  });

  it("moves the wall and the monotonic clock together", () => {
    const clock = createHourTestClock(T);
    const monotonic = clock.monotonic();
    clock.advance(90_000);
    expect(clock.wall()).toBe(T + 90_000);
    expect(clock.monotonic()).toBe(monotonic + 90_000);
    clock.set(T + 120_000);
    expect(clock.wall()).toBe(T + 120_000);
    expect(clock.monotonic()).toBe(monotonic + 120_000);
  });

  it("never runs backwards", () => {
    const clock = createHourTestClock(T);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.set(T - 1)).toThrow(RangeError);
    expect(clock.wall()).toBe(T);
  });

  it("is the box's clock for a setup host built with it", async () => {
    const clock = createHourTestClock(T);
    const host = createModuleOperationHost(
      {},
      {
        testClock: clock,
        readSetupFacts: async () => ({
          context: {} as never,
          contextKey: "hour-test-clock",
          localHistory: { reference: "empty", complete: true, records: [] },
        }),
        withPreparationState: (_binding, run) =>
          run({ value: null, history: [], replace: async () => {} }),
      },
    );
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: "event",
      sourceId: "source",
      targetNodeId: "node",
    } as const;
    const session = hostedHourPreparation(host);
    expect((await session.clockChallenge(binding)).boxInstantMs).toBe(T);
    clock.advance(90_000);
    expect((await session.clockChallenge(binding)).boxInstantMs).toBe(T + 90_000);
  });

  it("is the box's clock for a restore host built with it", async () => {
    const clock = createHourTestClock(T);
    const host = createModuleOperationHost(
      {},
      {
        testClock: clock,
        readRecoveryFacts: async () => ({
          country: "ES",
          taxId: "89890001K",
          environment: "preproduction",
          bases: [],
          contextKey: "hour-test-clock",
          history: [],
          oldMachineOffline: true,
          oldMachineAbsent: false,
          noParallelRecovery: true,
          priorActivation: "none",
        }),
        withPreparationState: (_binding, run) =>
          run({ value: null, history: [], replace: async () => {} }),
      },
    );
    const binding = {
      module: "fiscal-verifactu",
      action: "restore",
      eventId: "event",
      sourceId: "source",
      targetNodeId: "node",
    } as const;
    const key = { kind: "recovery-key", nodeId: "node", eventId: "event" } as const;
    const challenge = () =>
      withOperationAuthority(binding, key, (authority) =>
        hostedHourRecovery(host).recovery(
          { binding, authority },
          { action: "clock-challenge" },
          { onBox: true },
        ),
      ) as Promise<{ boxInstantMs: number }>;
    expect((await challenge()).boxInstantMs).toBe(T);
    clock.advance(90_000);
    expect((await challenge()).boxInstantMs).toBe(T + 90_000);
  });
});

describe("selectPastWaits", () => {
  it("advances the clock past each wait's target and asks again", async () => {
    const clock = createHourTestClock(T);
    const asked: number[] = [];
    const targets = [T + 116_000, T + 200_000];
    const answer = await selectPastWaits(clock, async () => {
      asked.push(clock.wall());
      const targetMs = targets.shift();
      return targetMs === undefined
        ? { status: "selected" as const, at: clock.wall() }
        : { status: "waiting" as const, targetMs, remainingMs: targetMs - clock.wall() };
    });
    expect(asked).toEqual([T, T + 116_001, T + 200_001]);
    expect(answer).toEqual({ status: "selected", at: T + 200_001 });
  });

  it("reads a route's waiting answer under `preparation`", async () => {
    const clock = createHourTestClock(T);
    let first = true;
    const answer = await selectPastWaits(clock, async () => {
      if (!first) return { preparation: { status: "selected" } };
      first = false;
      return { preparation: { status: "waiting", targetMs: T + 90_000, remainingMs: 90_000 } };
    });
    expect(answer).toEqual({ preparation: { status: "selected" } });
    expect(clock.wall()).toBe(T + 90_001);
  });

  it("returns a refusal or a selection without moving the clock", async () => {
    const clock = createHourTestClock(T);
    expect(await selectPastWaits(clock, async () => ({ status: "preview" }))).toEqual({
      status: "preview",
    });
    expect(clock.wall()).toBe(T);
  });

  it("stops after a bounded number of waits", async () => {
    const clock = createHourTestClock(T);
    await expect(
      selectPastWaits(clock, async () => ({
        status: "waiting",
        targetMs: clock.wall() + 90_000,
        remainingMs: 90_000,
      })),
    ).rejects.toThrow(/still waiting/);
  });

  it("refuses to wait with no clock to move", async () => {
    await expect(
      selectPastWaits(undefined, async () => ({
        status: "waiting",
        targetMs: T,
        remainingMs: 90_000,
      })),
    ).rejects.toThrow(/no test clock/);
  });
});
