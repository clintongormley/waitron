import { describe, expect, it, vi } from "vitest";
import type {
  ClockAdminConfirm,
  ClockStepRecorded,
  ClockStepRequest,
  ClockStopState,
  ClockWitness,
  TrustedReading,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { ClockServiceStatus, ClockSetAnswer } from "./box-host-client.js";
import { clockCorrection, type ClockAnchor } from "./clock-correction.js";

const TX = { fake: "tx" } as unknown as Transaction;
const S = 1_000;
const H = 3_600_000;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");

const STOPPED: ClockStopState = {
  clockAt: "2026-10-31T10:00:00.000Z",
  offsetMinutes: 60,
  lastRecordAt: "2026-10-31T11:00:00.000Z",
  lastRecordOffsetMinutes: 60,
  recordId: "record-1",
  gapMs: H,
  proof: "none",
  agreeing: { authority: null, devices: [] },
  contrary: { authority: null, devices: [] },
  confirmation: null,
};

const UNSYNCHRONISED: ClockServiceStatus = {
  available: true,
  service: "on",
  unit: "chrony.service",
  synchronised: false,
  lastSyncAt: null,
};

function authority(boxMs: number, differenceMs: number): ClockWitness {
  return {
    kind: "authority",
    id: "authority",
    boxAt: new Date(boxMs).toISOString(),
    witnessAt: new Date(boxMs + differenceMs).toISOString(),
    uncertaintyMs: 40,
  };
}

function device(id: string, address: string, differenceMs: number): ClockWitness {
  return {
    kind: "device",
    id,
    address,
    boxAt: new Date(START_MS).toISOString(),
    witnessAt: new Date(START_MS + differenceMs).toISOString(),
    uncertaintyMs: 0,
  };
}

const LUIS: ClockAdminConfirm = {
  personId: "0b6f1c1e-7f2a-4a35-9c1d-2f0e5a8b9c10",
  personName: "Luis",
  reading: {
    boxAt: new Date(START_MS).toISOString(),
    witnessAt: new Date(START_MS + H).toISOString(),
    uncertaintyMs: 30,
  },
};

const ANA_ON_A_TILL: ClockAdminConfirm = {
  personId: "5d2a9b7e-1c3f-4e8a-b6d0-7a1f2e3c4b5d",
  personName: "Ana",
  role: "staff",
  reading: LUIS.reading,
  device: {
    deviceId: "8e4c2a1b-9d7f-4b3e-a5c6-1f0e2d3c4b5a",
    deviceLabel: "Barra 1",
    address: "10.0.0.7",
  },
};

function withoutMethod<T extends { clockStopState?: unknown; confirmClockStep?: unknown }>(
  seat: "no-stop-state" | "no-step" | undefined,
  backend: T,
): T {
  if (seat === "no-stop-state") return { ...backend, clockStopState: undefined };
  if (seat === "no-step") return { ...backend, confirmClockStep: undefined };
  return backend;
}

type HostBehaviour =
  "sets" | "answers-unmoved" | "refuses" | "times-out-after-moving" | "times-out";

function harness(
  options: {
    stop?: () => ClockStopState | null;
    unusable?: () => boolean;
    /** The seat's date check throws this instead of `clock.unusable`. */
    recordableThrows?: Error;
    /** A seat with no clock stop, or one that records no step. */
    seat?: "no-stop-state" | "no-step";
    status?: ClockServiceStatus;
    host?: HostBehaviour;
    /** How far the host's set lands from the target. */
    missByMs?: number;
    /** The seat's transaction throws a full-disk refusal this many times. */
    seatFails?: number;
    witnesses?: ClockWitness[];
    anchors?: ClockAnchor[];
    /** The boot-time clock cannot be read. */
    bootNaN?: boolean;
    /** The wall clock moves against the steady clock while the host's status is read. */
    statusMovesWallMs?: number;
    onCorrectedThrows?: boolean;
    /** Steady time the host takes to set. */
    setTakesMs?: number;
  } = {},
) {
  const calls: string[] = [];
  const hostSets: { targetMs: number; requester: Record<string, string | null> }[] = [];
  const seatCalls: ClockStepRequest[] = [];
  const corrected: unknown[] = [];
  const log = vi.fn();
  let wallMs = START_MS;
  let monoMs = 2 * H;
  let bootMs = 3 * H;
  let seatFails = options.seatFails ?? 0;

  const correction = clockCorrection({
    host: {
      clockStatus: async () => {
        calls.push("clockStatus");
        wallMs += options.statusMovesWallMs ?? 0;
        return options.status ?? UNSYNCHRONISED;
      },
      setClock: async (input): Promise<ClockSetAnswer> => {
        calls.push("setClock");
        hostSets.push(input);
        const beforeMs = wallMs;
        const takes = options.setTakesMs ?? 50;
        monoMs += takes;
        bootMs += takes;
        wallMs += takes;
        const behaviour = options.host ?? "sets";
        if (behaviour === "sets" || behaviour === "times-out-after-moving")
          wallMs = input.targetMs + takes + (options.missByMs ?? 0);
        if (behaviour === "sets" || behaviour === "answers-unmoved")
          return { available: true, beforeMs, afterMs: wallMs };
        if (behaviour === "refuses")
          return { available: false, reason: "refused", refusal: "set_failed" };
        return { available: false, reason: "timeout" };
      },
    },
    backend: withoutMethod(options.seat, {
      clockStopState: async () => {
        calls.push("clockStopState");
        return (options.stop ?? (() => STOPPED))();
      },
      assertRecordableAt: () => {
        if (options.recordableThrows !== undefined) throw options.recordableThrows;
        if (options.unusable?.() === true)
          throw new AppError("clock.unusable", {
            clockAt: "2020-01-01T00:00:00.000Z",
            offsetMinutes: 60,
          });
      },
      confirmClockStep: async (_tx, input): Promise<ClockStepRecorded> => {
        calls.push("confirmClockStep");
        if (seatFails > 0) {
          seatFails--;
          throw new AppError("storage.disk_full", {});
        }
        seatCalls.push(input);
        return {
          confirmation: input.verified
            ? {
                id: `confirmation-${seatCalls.length}`,
                seq: seatCalls.length,
                source: input.source,
                personId: input.admin?.personId ?? null,
                confirmedAt: input.after.instant.toISOString(),
                checkId: "check-1",
                recordId: null,
              }
            : null,
          corrected: { id: `incident-${seatCalls.length}`, params: { stepMs: input.stepMs } },
        };
      },
    }),
    store: {
      clear: () => calls.push("clear"),
      witnesses: () => options.witnesses ?? [],
    },
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as unknown as TrustedReading,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: {
      readBoot: () =>
        options.bootNaN === true ? { ms: Number.NaN, id: null } : { ms: bootMs, id: "boot-1" },
    },
    read: (fn) => fn(TX),
    transaction: (fn) => fn(TX),
    onCorrected: (incident) => {
      if (options.onCorrectedThrows === true) throw new Error("email duty broke");
      calls.push("onCorrected");
      corrected.push(incident);
    },
    nodeId: "node-1",
    log,
  });
  for (const anchor of options.anchors ?? [
    {
      stepComing: async () => void calls.push("stepComing"),
      reanchor: async () => void calls.push("reanchor"),
    },
  ])
    correction.addAnchor(anchor);

  return {
    correction,
    calls,
    hostSets,
    seatCalls,
    corrected,
    log,
    measured: () => ({ wallMs, monoMs }),
    moveWall: (ms: number) => void (wallMs += ms),
  };
}

type Harness = ReturnType<typeof harness>;
type SetInput = Parameters<Harness["correction"]["set"]>[0];

function aeat(h: Harness, over: Partial<SetInput> = {}): SetInput {
  return {
    reason: "behind_chain",
    source: "authority",
    offsetMs: H,
    measuredAt: h.measured(),
    stepsSeen: h.correction.steps(),
    witnesses: [authority(START_MS, H)],
    requester: { source: "authority", check: "check-1" },
    ...over,
  };
}

function byAdmin(h: Harness, over: Partial<SetInput> = {}): SetInput {
  return aeat(h, {
    source: "admin",
    admin: LUIS,
    witnesses: [],
    requester: { source: "admin", person: LUIS.personId },
    ...over,
  });
}

function byStaff(h: Harness, over: Partial<SetInput> = {}): SetInput {
  return aeat(h, {
    source: "staff",
    admin: ANA_ON_A_TILL,
    witnesses: [],
    requester: {
      source: "staff",
      person: ANA_ON_A_TILL.personId,
      device: ANA_ON_A_TILL.device!.deviceId,
    },
    admit: async () => null,
    ...over,
  });
}

describe("setting the box's clock", () => {
  it("judges the stop, reads the service, tells the anchors, sets, re-anchors, clears and records, in that order", async () => {
    const h = harness();
    const answer = await h.correction.set(aeat(h));

    expect(h.calls).toEqual([
      "clockStopState",
      "clockStatus",
      "stepComing",
      "setClock",
      "reanchor",
      "clear",
      "confirmClockStep",
      "onCorrected",
    ]);
    expect(answer).toEqual({ set: true, confirmationId: "confirmation-1", stepMs: H });
    expect(h.hostSets).toEqual([
      { targetMs: START_MS + H, requester: { source: "authority", check: "check-1" } },
    ]);
    expect(h.correction.steps()).toBe(1);
  });

  it("records the step it measured, from before and after readings of both clocks", async () => {
    const h = harness({ setTakesMs: 300 });
    await h.correction.set(aeat(h));

    const [request] = h.seatCalls;
    expect(request).toMatchObject({
      before: { instant: new Date(START_MS), offsetMinutes: 60 },
      after: { instant: new Date(START_MS + H + 300), offsetMinutes: 60 },
      bootBefore: { ms: 3 * H, id: "boot-1" },
      bootAfter: { ms: 3 * H + 300, id: "boot-1" },
      targetAt: new Date(START_MS + H).toISOString(),
      stepMs: H,
      verified: true,
      reason: "behind_chain",
      source: "authority",
      witnesses: [authority(START_MS, H)],
      nodeId: "node-1",
    });
  });

  it("hands each step's alert to the email duty once", async () => {
    const h = harness();
    await h.correction.set(aeat(h));
    await h.correction.set(aeat(h, { offsetMs: 2 * H }));

    expect(h.corrected).toEqual([
      { id: "incident-1", code: "clock.corrected", params: { stepMs: H } },
      { id: "incident-2", code: "clock.corrected", params: { stepMs: 2 * H } },
    ]);
  });

  it("keeps the row of a step whose re-anchoring failed, and writes it once on the next writePending", async () => {
    const calls: string[] = [];
    let failing = true;
    const h = harness({
      anchors: [
        {
          stepComing: async () => void calls.push("stepComing"),
          reanchor: async () => {
            calls.push("reanchor");
            if (failing) throw new AppError("storage.disk_full", {});
          },
        },
      ],
    });
    const answer = await h.correction.set(aeat(h));

    expect(h.hostSets).toHaveLength(1);
    expect(h.calls).not.toContain("confirmClockStep");
    expect(answer).toEqual({ set: true, confirmationId: null, stepMs: H });
    expect(h.log).toHaveBeenCalledWith("warn", "clock_correction.row_pending", expect.anything());

    failing = false;
    await h.correction.writePending();
    await h.correction.writePending();
    expect(h.seatCalls).toHaveLength(1);
    expect(h.seatCalls[0]).toMatchObject({ stepMs: H, verified: true });
    expect(h.corrected).toHaveLength(1);
  });

  it("keeps a step whose seat transaction failed on a full disk, and writes it once on the next writePending", async () => {
    const h = harness({ seatFails: 1 });
    const answer = await h.correction.set(aeat(h));

    expect(answer).toEqual({ set: true, confirmationId: null, stepMs: H });
    expect(h.seatCalls).toHaveLength(0);
    expect(h.corrected).toHaveLength(0);
    expect(
      h.log.mock.calls.filter(([, event]) => event === "clock_correction.row_pending"),
    ).toHaveLength(1);

    await h.correction.writePending();
    await h.correction.writePending();
    expect(h.seatCalls).toHaveLength(1);
    expect(h.corrected).toHaveLength(1);
  });

  it("keeps the step when writePending's write fails again, logging it pending only once", async () => {
    const h = harness({ seatFails: 2 });
    await h.correction.set(aeat(h));

    await expect(h.correction.writePending()).rejects.toThrow();
    await h.correction.writePending();
    expect(h.seatCalls).toHaveLength(1);
    expect(
      h.log.mock.calls.filter(([, event]) => event === "clock_correction.row_pending"),
    ).toHaveLength(1);
  });
});

describe("rows kept pending", () => {
  function failingFirstReanchor() {
    let failing = true;
    return {
      anchor: {
        stepComing: async () => {},
        reanchor: async () => {
          if (failing) {
            failing = false;
            throw new AppError("storage.disk_full", {});
          }
        },
      },
    };
  }

  it("refuses a set while an earlier step's row is pending, so rows are written in step order", async () => {
    const { anchor } = failingFirstReanchor();
    const h = harness({ anchors: [anchor] });
    await h.correction.set(aeat(h));
    const calls = h.calls.length;

    expect(await h.correction.set(byAdmin(h, { stepsSeen: 1, measuredAt: h.measured() }))).toEqual({
      set: false,
      reason: "pending_disproofs",
    });
    expect(h.calls.slice(calls)).toEqual([]);

    await h.correction.writePending();
    expect(
      await h.correction.set(byAdmin(h, { stepsSeen: 1, measuredAt: h.measured() })),
    ).toMatchObject({ set: true });
    expect(h.seatCalls.map((request) => request.source)).toEqual(["authority", "admin"]);
  });

  it("writes a pending row once when two writePending calls overlap", async () => {
    const { anchor } = failingFirstReanchor();
    const h = harness({ anchors: [anchor] });
    await h.correction.set(aeat(h));

    await Promise.all([h.correction.writePending(), h.correction.writePending()]);
    expect(h.seatCalls).toHaveLength(1);
  });
});

describe("a set that asks nothing of the host", () => {
  it("refuses while the time service is synchronised", async () => {
    const h = harness({ status: { ...UNSYNCHRONISED, synchronised: true } });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "synchronised" });
    expect(h.calls).toEqual(["clockStopState", "clockStatus"]);
  });

  it("refuses while the box's clock service is unavailable", async () => {
    const h = harness({ status: { available: false, reason: "missing", detail: "ENOENT" } });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "host_unavailable" });
    expect(h.calls).toEqual(["clockStopState", "clockStatus"]);
  });

  it("refuses once the stop no longer holds", async () => {
    const h = harness({ stop: () => null });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "not_stopped" });
    expect(h.calls).toEqual(["clockStopState"]);
  });

  it("refuses once a confirmation covers the reading", async () => {
    const h = harness({ stop: () => ({ ...STOPPED, proof: "confirmed" }) });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "not_stopped" });
  });

  it("refuses when an anchor cannot record what it holds, re-anchoring every anchor", async () => {
    const calls: string[] = [];
    const h = harness({
      anchors: [
        {
          stepComing: async () => {
            calls.push("first.stepComing");
            throw new AppError("storage.disk_full", {});
          },
          reanchor: async () => void calls.push("first.reanchor"),
        },
        {
          stepComing: async () => void calls.push("second.stepComing"),
          reanchor: async () => void calls.push("second.reanchor"),
        },
      ],
    });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "pending_disproofs" });
    expect(h.hostSets).toEqual([]);
    expect(calls).toContain("first.reanchor");
    expect(calls).toContain("second.reanchor");
  });

  it("refuses a target before 28 October 2024", async () => {
    const h = harness();
    const offsetMs = Date.UTC(2024, 9, 27, 23) - START_MS;
    expect(await h.correction.set(aeat(h, { offsetMs }))).toEqual({
      set: false,
      reason: "target_invalid",
    });
    expect(h.calls).toEqual([]);
  });

  it("refuses a target from 2100 on", async () => {
    const h = harness();
    const offsetMs = Date.UTC(2100, 0, 1) - START_MS;
    expect(await h.correction.set(aeat(h, { offsetMs }))).toEqual({
      set: false,
      reason: "target_invalid",
    });
    expect(h.calls).toEqual([]);
  });

  it("takes a target just inside both bounds", async () => {
    const h = harness({ unusable: () => true });
    const early = Date.UTC(2024, 9, 28, 1) - START_MS;
    expect(
      await h.correction.set(byAdmin(h, { reason: "unusable", offsetMs: early })),
    ).toMatchObject({ set: true });
  });
});

describe("what a seat or host may lack", () => {
  it("answers not_stopped for the payment stop when the seat has no clock stop", async () => {
    const h = harness({ seat: "no-stop-state" });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "not_stopped" });
    expect(h.calls).toEqual([]);
  });

  it("sets but records nothing when the seat records no step", async () => {
    const h = harness({ seat: "no-step" });
    expect(await h.correction.set(aeat(h))).toEqual({ set: true, confirmationId: null, stepMs: H });
    expect(h.corrected).toEqual([]);
  });

  it("passes on an error of the seat's date check that is not clock.unusable", async () => {
    const h = harness({ recordableThrows: new Error("seat broke") });
    await expect(h.correction.set(byAdmin(h, { reason: "unusable" }))).rejects.toThrow(
      "seat broke",
    );
    expect(h.hostSets).toEqual([]);
  });

  it("answers refused when the host answered but the clock did not move", async () => {
    const h = harness({ host: "answers-unmoved" });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "refused" });
    expect(h.log).toHaveBeenCalledWith("warn", "clock_correction.set_refused", {
      reason: "unmoved",
    });
    expect(h.calls).not.toContain("confirmClockStep");
  });

  it("reads the box's own wall and steady clocks when none are given", async () => {
    const correction = clockCorrection({
      host: { clockStatus: vi.fn(), setClock: vi.fn() },
      backend: { assertRecordableAt: () => {} },
      store: { clear: () => {}, witnesses: () => [] },
      clock: {
        now: () => ({ instant: new Date(), offsetMinutes: 0 }) as unknown as TrustedReading,
      },
      boot: { readBoot: () => ({ ms: 0, id: null }) },
      read: (fn) => fn(TX),
      transaction: (fn) => fn(TX),
      nodeId: "node-1",
      log: vi.fn(),
    });
    const answer = await correction.set({
      reason: "unusable",
      source: "authority",
      offsetMs: Date.UTC(2101, 0, 1) - Date.now(),
      measuredAt: { wallMs: Date.now(), monoMs: performance.now() },
      stepsSeen: 0,
      witnesses: [],
      requester: {},
    });
    // Not stale: both clocks were read where the offset was measured.
    expect(answer).toEqual({ set: false, reason: "target_invalid" });
  });
});

describe("a stale offset", () => {
  it("refuses an offset measured before a step the correction made", async () => {
    const h = harness();
    await h.correction.set(aeat(h));
    const calls = h.calls.length;

    expect(await h.correction.set(aeat(h, { stepsSeen: 0 }))).toEqual({
      set: false,
      reason: "stale",
    });
    expect(h.calls.slice(calls)).toEqual([]);
  });

  it("refuses an offset measured before the wall clock moved against the steady clock", async () => {
    const h = harness();
    const input = aeat(h);
    h.moveWall(5 * S);
    expect(await h.correction.set(input)).toEqual({ set: false, reason: "stale" });
    expect(h.calls).toEqual([]);
  });

  it("takes an offset when nothing moved since it was measured", async () => {
    const h = harness();
    const input = aeat(h);
    expect(await h.correction.set(input)).toMatchObject({ set: true });
  });
});

describe("clocks that move or cannot be read", () => {
  it("refuses stale when the wall clock steps while the host's status is read, re-anchoring", async () => {
    const h = harness({ statusMovesWallMs: 5 * S });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "stale" });
    expect(h.hostSets).toEqual([]);
    expect(h.calls).toContain("reanchor");
  });

  it("measures the step on the steady clock when the boot-time clock cannot be read", async () => {
    const h = harness({ bootNaN: true });
    expect(await h.correction.set(aeat(h))).toEqual({
      set: true,
      confirmationId: "confirmation-1",
      stepMs: H,
    });
    expect(h.seatCalls[0]).toMatchObject({ verified: true, stepMs: H });
  });

  it("keeps a set's answer, and writes no second row, when the email duty throws", async () => {
    const h = harness({ onCorrectedThrows: true });
    expect(await h.correction.set(aeat(h))).toEqual({
      set: true,
      confirmationId: "confirmation-1",
      stepMs: H,
    });
    await h.correction.writePending();
    expect(h.seatCalls).toHaveLength(1);
  });
});

describe("verifying the step", () => {
  it("verifies a step that lands within two seconds of the target", async () => {
    const h = harness({ missByMs: 2_000 });
    expect(await h.correction.set(aeat(h))).toMatchObject({ set: true });
    expect(h.seatCalls[0]).toMatchObject({ verified: true });
  });

  it("records a step that lands further than two seconds from the target as unverified", async () => {
    const h = harness({ missByMs: 2_001 });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "unverified" });
    expect(h.seatCalls).toHaveLength(1);
    expect(h.seatCalls[0]).toMatchObject({ verified: false, stepMs: H + 2_001 });
    expect(h.calls).toContain("reanchor");
  });

  it("asks the seat for nothing when the host refused and the clock did not move", async () => {
    const h = harness({ host: "refuses" });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "refused" });
    expect(h.calls).not.toContain("confirmClockStep");
    expect(h.calls).not.toContain("clear");
    expect(h.calls).toContain("reanchor");
    expect(h.correction.steps()).toBe(1);
  });

  it("records an unverified step when the host moved the clock and then never answered", async () => {
    const h = harness({ host: "times-out-after-moving" });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "unverified" });
    expect(h.seatCalls).toHaveLength(1);
    expect(h.seatCalls[0]).toMatchObject({ verified: false, stepMs: H });
    expect(h.calls).toContain("reanchor");
  });

  it("asks the seat for nothing when the host timed out with the clock unmoved", async () => {
    const h = harness({ host: "times-out" });
    expect(await h.correction.set(aeat(h))).toEqual({ set: false, reason: "refused" });
    expect(h.calls).not.toContain("confirmClockStep");
    expect(h.calls).toContain("reanchor");
  });
});

describe("one set at a time", () => {
  it("sends one set when two are started together on one measurement", async () => {
    let stop: ClockStopState | null = STOPPED;
    const h = harness({ stop: () => stop });
    const first = aeat(h);
    const second = byAdmin(h);
    h.correction.addAnchor({
      stepComing: async () => {},
      reanchor: async () => {
        stop = null;
      },
    });

    const answers = await Promise.all([h.correction.set(first), h.correction.set(second)]);

    expect(h.hostSets).toHaveLength(1);
    expect(answers[1]).toEqual({ set: false, reason: "stale" });
    expect(h.seatCalls).toHaveLength(1);
  });

  it("judges a set started after the first finished on its own", async () => {
    let stop: ClockStopState | null = STOPPED;
    const h = harness({ stop: () => stop });
    h.correction.addAnchor({
      stepComing: async () => {},
      reanchor: async () => void (stop = null),
    });
    await h.correction.set(aeat(h));

    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "not_stopped" });
    expect(h.hostSets).toHaveLength(1);
  });

  it("holds another user of the turn until a set has finished", async () => {
    const h = harness();
    const order: string[] = [];
    const setting = h.correction.set(aeat(h)).then(() => order.push("set"));
    const other = h.correction.inTurn(async () => void order.push("other"));
    await Promise.all([setting, other]);
    expect(order).toEqual(["set", "other"]);
  });

  it("runs the next turn after one that threw", async () => {
    const h = harness();
    await expect(
      h.correction.inTurn(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await h.correction.inTurn(async () => "next")).toBe("next");
  });
});

describe("a person's set", () => {
  it("refuses an administrator's offset within a minute of the box, uncertainty included", async () => {
    const h = harness();
    expect(await h.correction.set(byAdmin(h, { offsetMs: 59_970 }))).toEqual({
      set: false,
      reason: "agrees",
    });
    expect(h.hostSets).toEqual([]);
    expect(h.calls).not.toContain("stepComing");
  });

  it("refuses a staff member's offset within a minute of the box", async () => {
    const h = harness();
    expect(await h.correction.set(byStaff(h, { offsetMs: -30 * S }))).toEqual({
      set: false,
      reason: "agrees",
    });
    expect(h.hostSets).toEqual([]);
  });

  it("sets an administrator's offset that agrees only once its uncertainty is left out", async () => {
    const h = harness();
    expect(await h.correction.set(byAdmin(h, { offsetMs: 59_980 }))).toMatchObject({ set: true });
  });

  it("sets an administrator's offset of 61 seconds", async () => {
    const h = harness();
    expect(await h.correction.set(byAdmin(h, { offsetMs: 61 * S }))).toMatchObject({ set: true });
  });

  it("refuses an administrator once AEAT disagreed with the box during the stop", async () => {
    const h = harness({
      stop: () => ({
        ...STOPPED,
        proof: "contrary",
        contrary: { authority: authority(START_MS, H), devices: [] },
      }),
    });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "witnessed" });
    expect(h.hostSets).toEqual([]);
  });

  it("refuses an administrator and a staff member once AEAT agreed with the box during the stop", async () => {
    const agreeing = {
      ...STOPPED,
      proof: "ready" as const,
      agreeing: { authority: authority(START_MS, 0), devices: [] },
    };
    const h = harness({ stop: () => agreeing });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "witnessed" });
    expect(await h.correction.set(byStaff(h))).toEqual({ set: false, reason: "witnessed" });
    expect(h.hostSets).toEqual([]);
  });

  it("goes on when only devices from two addresses disagree and AEAT has not spoken", async () => {
    const h = harness({
      stop: () => ({
        ...STOPPED,
        proof: "contrary",
        contrary: {
          authority: null,
          devices: [device("a", "10.0.0.1", H), device("b", "10.0.0.2", H)],
        },
      }),
    });
    expect(await h.correction.set(byAdmin(h))).toMatchObject({ set: true });
  });

  it("refuses an administrator during clock.unusable once AEAT has a reading taken during it", async () => {
    const before2024 = Date.parse("2020-01-01T00:00:00.000Z");
    const h = harness({ unusable: () => true, witnesses: [authority(before2024, H)] });
    expect(await h.correction.set(byAdmin(h, { reason: "unusable" }))).toEqual({
      set: false,
      reason: "witnessed",
    });
  });

  it("does not count an AEAT disagreement kept from before clock.unusable began", async () => {
    const h = harness({ unusable: () => true, witnesses: [authority(START_MS, H)] });
    expect(await h.correction.set(byAdmin(h, { reason: "unusable" }))).toMatchObject({ set: true });
  });

  it("does not refuse AEAT's own set for AEAT's reading", async () => {
    const h = harness({
      stop: () => ({
        ...STOPPED,
        proof: "contrary",
        contrary: { authority: authority(START_MS, H), devices: [] },
      }),
    });
    expect(await h.correction.set(aeat(h))).toMatchObject({ set: true });
  });

  it("passes the requester to the host as it is, never a person's name or a till's label", async () => {
    const h = harness();
    await h.correction.set(byStaff(h));
    expect(h.hostSets[0]!.requester).toEqual({
      source: "staff",
      person: ANA_ON_A_TILL.personId,
      device: ANA_ON_A_TILL.device!.deviceId,
    });
    expect(JSON.stringify(h.hostSets)).not.toMatch(/Ana|Barra/);
  });

  it("records an administrator's step under admin with the person", async () => {
    const h = harness();
    await h.correction.set(byAdmin(h));
    expect(h.seatCalls[0]).toMatchObject({ source: "admin", admin: LUIS });
  });
});

describe("a staff member's set", () => {
  for (const reason of ["not_start_up", "authority_pending", "not_admitted"] as const) {
    it(`answers ${reason} when the till's check refuses it, telling no anchor and asking the host nothing`, async () => {
      const h = harness();
      const admit = vi.fn(async () => reason);
      expect(await h.correction.set(byStaff(h, { admit }))).toEqual({ set: false, reason });
      expect(admit).toHaveBeenCalledWith(TX);
      expect(h.calls).toEqual(["clockStopState"]);
    });
  }

  it("sets when the till's check admits it, recording the staff member with their role", async () => {
    const h = harness();
    expect(await h.correction.set(byStaff(h))).toMatchObject({ set: true });
    expect(h.seatCalls[0]).toMatchObject({
      source: "staff",
      admin: { ...ANA_ON_A_TILL, role: "staff" },
    });
  });

  it("answers not_stopped, not the till's refusal, once the stop has ended", async () => {
    const h = harness({ stop: () => null });
    const admit = vi.fn(async () => "not_start_up" as const);
    expect(await h.correction.set(byStaff(h, { admit }))).toEqual({
      set: false,
      reason: "not_stopped",
    });
    expect(admit).not.toHaveBeenCalled();
  });
});

describe("clock.unusable", () => {
  it("sets during clock.unusable without reading the payment stop", async () => {
    const h = harness({ unusable: () => true });
    expect(await h.correction.set(byAdmin(h, { reason: "unusable" }))).toMatchObject({ set: true });
    expect(h.calls).not.toContain("clockStopState");
    expect(h.seatCalls[0]).toMatchObject({ reason: "unusable" });
  });

  it("refuses not_stopped once the clock reads a usable date", async () => {
    const h = harness({ unusable: () => false });
    expect(await h.correction.set(byAdmin(h, { reason: "unusable" }))).toEqual({
      set: false,
      reason: "not_stopped",
    });
  });
});
