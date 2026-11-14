import { describe, expect, it, vi } from "vitest";
import type {
  ClockAdminConfirm,
  ClockConfirmation,
  ClockStepRecorded,
  ClockStepRequest,
  TrustedReading,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { ClockServiceStatus, ClockSetAnswer } from "./box-host-client.js";
import { clockCorrection, latestClockStepFor, type ClockAnchor } from "./clock-correction.js";
import { createClockWatch } from "./clock-watch.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { startClockGateHolds } from "./start-clock-gate.js";
import { startClockState, type ChainHeads, type StartClockState } from "./start-clock-check.js";

const TX = { fake: "tx" } as unknown as Transaction;
const S = 1_000;
const H = 3_600_000;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");
/** The box's reading once the default host has set it an hour on, taking 50 ms. */
const SET_AT = new Date(START_MS + H + 50).toISOString();

const UNSYNCHRONISED: ClockServiceStatus = {
  available: true,
  service: "on",
  unit: "chrony.service",
  synchronised: false,
  lastSyncAt: null,
};

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

function withoutMethod<T extends { confirmClockStep?: unknown }>(
  seat: "no-step" | undefined,
  backend: T,
): T {
  if (seat === "no-step") return { ...backend, confirmClockStep: undefined };
  return backend;
}

type HostBehaviour =
  | "sets"
  | "answers-unmoved"
  | "refuses"
  | "times-out-after-moving"
  | "times-out"
  | "missing"
  | "throws"
  | "throws-after-moving";

function harness(
  options: {
    /** Whether the clock reads before 28-10-2024; by default it does. */
    unusable?: () => boolean;
    /** The seat's date check throws this instead of `clock.unusable`. */
    recordableThrows?: Error;
    /** A seat that records no step. */
    seat?: "no-step";
    status?: ClockServiceStatus;
    host?: HostBehaviour;
    /** How far the host's set lands from the target. */
    missByMs?: number;
    /** The seat's transaction throws a full-disk refusal this many times. */
    seatFails?: number;
    anchors?: ClockAnchor[];
    /** The boot-time clock cannot be read. */
    bootNaN?: boolean;
    /** Reading the boot-time clock throws once the host has been asked to set. */
    bootThrowsAfterSet?: boolean;
    /** The wall clock moves against the steady clock while the host's status is read. */
    statusMovesWallMs?: number;
    /** Runs while the host's status is read. */
    duringStatus?: () => void;
    /** Runs while the host sets the clock. */
    duringSet?: () => void | Promise<void>;
    onCorrectedThrows?: boolean;
    /** Steady time the host takes to set. */
    setTakesMs?: number;
    /** The start's clock check, and the chain heads the seat reads for it. */
    start?: { state: StartClockState; heads: () => ChainHeads | Promise<ChainHeads> };
    /** A real witness store in place of the recording stand-in. */
    store?: ClockWitnessStore;
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
        options.duringStatus?.();
        return options.status ?? UNSYNCHRONISED;
      },
      setClock: async (input): Promise<ClockSetAnswer> => {
        calls.push("setClock");
        hostSets.push(input);
        await options.duringSet?.();
        const beforeMs = wallMs;
        const takes = options.setTakesMs ?? 50;
        monoMs += takes;
        bootMs += takes;
        wallMs += takes;
        const behaviour = options.host ?? "sets";
        if (
          behaviour === "sets" ||
          behaviour === "times-out-after-moving" ||
          behaviour === "throws-after-moving"
        )
          wallMs = input.targetMs + takes + (options.missByMs ?? 0);
        if (behaviour === "throws" || behaviour === "throws-after-moving")
          throw new Error("host client broke");
        if (behaviour === "sets" || behaviour === "answers-unmoved")
          return { available: true, beforeMs, afterMs: wallMs };
        if (behaviour === "refuses")
          return { available: false, reason: "refused", refusal: "set_failed" };
        if (behaviour === "missing") return { available: false, reason: "missing" };
        return { available: false, reason: "timeout" };
      },
    },
    backend: withoutMethod(options.seat, {
      assertRecordableAt: () => {
        if (options.recordableThrows !== undefined) throw options.recordableThrows;
        if (options.unusable?.() ?? true)
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
                source: input.source as ClockConfirmation["source"],
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
    store: options.store ?? {
      clear: () => calls.push("clear"),
    },
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as unknown as TrustedReading,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: {
      readBoot: () => {
        if (options.bootThrowsAfterSet === true && hostSets.length > 0)
          throw new Error("boot clock broke");
        return options.bootNaN === true
          ? { ms: Number.NaN, id: null }
          : { ms: bootMs, id: "boot-1" };
      },
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
    ...(options.start === undefined
      ? {}
      : {
          start: {
            state: options.start.state,
            heads: async () => {
              calls.push("heads");
              return options.start!.heads();
            },
          },
        }),
  });
  for (const anchor of options.anchors ?? [{ reanchor: async () => void calls.push("reanchor") }])
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

/** An administrator's set while the clock reads before 28-10-2024. */
function byAdmin(h: Harness, over: Partial<SetInput> = {}): SetInput {
  return {
    reason: "unusable",
    source: "admin",
    offsetMs: H,
    measuredAt: h.measured(),
    stepsSeen: h.correction.steps(),
    witnesses: [],
    admin: LUIS,
    requester: { source: "admin", person: LUIS.personId },
    ...over,
  };
}

function byStaff(h: Harness, over: Partial<SetInput> = {}): SetInput {
  return byAdmin(h, {
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
  it("reads the service, sets, re-anchors, clears and records, in that order", async () => {
    const h = harness();
    const answer = await h.correction.set(byAdmin(h));

    expect(h.calls).toEqual([
      "clockStatus",
      "setClock",
      "reanchor",
      "clear",
      "confirmClockStep",
      "onCorrected",
    ]);
    expect(answer).toEqual({
      set: true,
      confirmationId: "confirmation-1",
      stepMs: H,
      confirmedAt: SET_AT,
    });
    expect(h.hostSets).toEqual([
      { targetMs: START_MS + H, requester: { source: "admin", person: LUIS.personId } },
    ]);
    expect(h.correction.steps()).toBe(1);
  });

  it("records the step it measured, from before and after readings of both clocks", async () => {
    const h = harness({ setTakesMs: 300 });
    await h.correction.set(byAdmin(h));

    const [request] = h.seatCalls;
    expect(request).toMatchObject({
      before: { instant: new Date(START_MS), offsetMinutes: 60 },
      after: { instant: new Date(START_MS + H + 300), offsetMinutes: 60 },
      bootBefore: { ms: 3 * H, id: "boot-1" },
      bootAfter: { ms: 3 * H + 300, id: "boot-1" },
      targetAt: new Date(START_MS + H).toISOString(),
      stepMs: H,
      verified: true,
      reason: "unusable",
      source: "admin",
      witnesses: [],
      nodeId: "node-1",
    });
  });

  it("hands each step's alert to the email duty once", async () => {
    const h = harness();
    await h.correction.set(byAdmin(h));
    await h.correction.set(byAdmin(h, { offsetMs: 2 * H }));

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
          reanchor: async () => {
            calls.push("reanchor");
            if (failing) throw new AppError("storage.disk_full", {});
          },
        },
      ],
    });
    const answer = await h.correction.set(byAdmin(h));

    expect(h.hostSets).toHaveLength(1);
    expect(h.calls).not.toContain("confirmClockStep");
    expect(answer).toEqual({ set: true, confirmationId: null, stepMs: H, confirmedAt: SET_AT });
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
    const answer = await h.correction.set(byAdmin(h));

    expect(answer).toEqual({ set: true, confirmationId: null, stepMs: H, confirmedAt: SET_AT });
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
    await h.correction.set(byAdmin(h));

    await expect(h.correction.writePending()).rejects.toThrow();
    await h.correction.writePending();
    expect(h.seatCalls).toHaveLength(1);
    expect(
      h.log.mock.calls.filter(([, event]) => event === "clock_correction.row_pending"),
    ).toHaveLength(1);
  });
});

describe("the step not yet written, for the backups' hold", () => {
  it("is setting while the host is asked, then null once the step's row is written", async () => {
    const seen: unknown[] = [];
    const h = harness({ duringSet: () => void seen.push(h.correction.unwrittenStep()) });
    seen.push(h.correction.unwrittenStep());
    await h.correction.set(byAdmin(h));
    seen.push(h.correction.unwrittenStep());
    expect(seen).toEqual([null, "setting", null]);
  });

  it("is the step made while its row waits to be written, and null once writePending writes it", async () => {
    const h = harness({ seatFails: 1 });
    await h.correction.set(byAdmin(h));
    expect(h.correction.unwrittenStep()).toEqual({ confirmedAt: SET_AT, stepMs: H });

    await h.correction.writePending();
    expect(h.correction.unwrittenStep()).toBeNull();
  });

  it("is the step made while its row waits for a failed re-anchoring", async () => {
    const h = harness({
      anchors: [
        {
          reanchor: async () => {
            throw new AppError("storage.disk_full", {});
          },
        },
      ],
    });
    await h.correction.set(byAdmin(h));
    expect(h.correction.unwrittenStep()).toEqual({ confirmedAt: SET_AT, stepMs: H });
  });

  it("is null when the host refused and the clock did not move", async () => {
    const h = harness({ host: "refuses" });
    await h.correction.set(byAdmin(h));
    expect(h.correction.unwrittenStep()).toBeNull();
  });

  it("is null, with the anchor re-anchored, when the host client throws and the clock did not move", async () => {
    const h = harness({ host: "throws" });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "refused" });
    expect(h.correction.unwrittenStep()).toBeNull();
    expect(h.calls).toContain("reanchor");
    expect(h.calls).not.toContain("confirmClockStep");
    expect(h.log).toHaveBeenCalledWith("warn", "clock_correction.set_threw", {
      errorCode: "unknown",
    });
  });

  it("is as it was before the set, and the error passed on, when reading the clocks throws after the host answered", async () => {
    const h = harness({ bootThrowsAfterSet: true });
    await expect(h.correction.set(byAdmin(h))).rejects.toThrow("boot clock broke");
    expect(h.hostSets).toHaveLength(1);
    expect(h.correction.unwrittenStep()).toBeNull();
  });

  it("is null when the seat records no step", async () => {
    const h = harness({ seat: "no-step" });
    await h.correction.set(byAdmin(h));
    expect(h.correction.unwrittenStep()).toBeNull();
  });

  it("is answered for the hold before the recorded step is read, and the recorded one only when none is unwritten", async () => {
    const order: string[] = [];
    let unwritten: { confirmedAt: string; stepMs: number } | "setting" | null = "setting";
    const recorded = { confirmedAt: SET_AT, stepMs: H };
    const latest = latestClockStepFor(
      {
        unwrittenStep: () => {
          order.push("unwritten");
          return unwritten;
        },
      },
      async () => {
        order.push("recorded");
        return recorded;
      },
    );

    expect(await latest()).toBe("setting");
    unwritten = null;
    expect(await latest()).toEqual(recorded);
    expect(order).toEqual(["unwritten", "unwritten", "recorded"]);
  });
});

describe("rows kept pending", () => {
  function failingFirstReanchor() {
    let failing = true;
    return {
      anchor: {
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
    await h.correction.set(byAdmin(h));
    const calls = h.calls.length;

    expect(await h.correction.set(byAdmin(h, { stepsSeen: 1, measuredAt: h.measured() }))).toEqual({
      set: false,
      reason: "pending_step",
    });
    expect(h.calls.slice(calls)).toEqual([]);

    await h.correction.writePending();
    expect(
      await h.correction.set(byAdmin(h, { stepsSeen: 1, measuredAt: h.measured() })),
    ).toMatchObject({ set: true });
    expect(h.seatCalls.map((request) => request.source)).toEqual(["admin", "admin"]);
  });

  /** A watch over the harness's correction with no start check, its looks run by hand. */
  function watchOver(h: Harness, noStop: () => void = () => {}) {
    const log = vi.fn();
    const watch = createClockWatch({
      backend: { assertRecordableAt: () => {} },
      store: createClockWitnessStore({ wall: () => START_MS, monotonic: () => 0 }),
      clock: {
        now: () =>
          ({
            instant: new Date(h.measured().wallMs),
            offsetMinutes: 60,
          }) as unknown as TrustedReading,
      },
      read: (fn) => fn(TX),
      correction: h.correction,
      startUp: { noStop },
      log,
    });
    return { look: () => watch.check(), log };
  }

  it("is written by the clock watch's next look, after which a set is no longer refused", async () => {
    const h = harness({ seatFails: 1 });
    await h.correction.set(byAdmin(h));
    expect(h.seatCalls).toHaveLength(0);
    expect(h.correction.unwrittenStep()).not.toBeNull();

    await watchOver(h).look();
    expect(h.seatCalls).toHaveLength(1);
    expect(h.correction.unwrittenStep()).toBeNull();
    expect(
      await h.correction.set(byAdmin(h, { stepsSeen: 1, measuredAt: h.measured() })),
    ).toMatchObject({ set: true });
  });

  it("is kept when the watch's write fails again, the rest of the look still runs, and the next look writes it", async () => {
    const h = harness({ seatFails: 2 });
    await h.correction.set(byAdmin(h));
    const noStop = vi.fn();
    const w = watchOver(h, noStop);

    await w.look();
    expect(h.seatCalls).toHaveLength(0);
    expect(w.log).toHaveBeenCalledWith("warn", "clock_watch.check_failed", {
      errorCode: "storage.disk_full",
    });
    expect(noStop).toHaveBeenCalledTimes(1);

    await w.look();
    expect(h.seatCalls).toHaveLength(1);
  });

  it("writes a pending row once when two writePending calls overlap", async () => {
    const { anchor } = failingFirstReanchor();
    const h = harness({ anchors: [anchor] });
    await h.correction.set(byAdmin(h));

    await Promise.all([h.correction.writePending(), h.correction.writePending()]);
    expect(h.seatCalls).toHaveLength(1);
  });
});

describe("a set that asks nothing of the host", () => {
  it("refuses while the time service is synchronised", async () => {
    const h = harness({ status: { ...UNSYNCHRONISED, synchronised: true } });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "synchronised" });
    expect(h.calls).toEqual(["clockStatus"]);
  });

  it("refuses while the box's clock service is unavailable", async () => {
    const h = harness({ status: { available: false, reason: "missing", detail: "ENOENT" } });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "host_unavailable" });
    expect(h.calls).toEqual(["clockStatus"]);
  });

  it("refuses once the stop no longer holds", async () => {
    const h = harness({ unusable: () => false });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "not_stopped" });
    expect(h.calls).toEqual([]);
  });

  it("refuses a target before 28 October 2024", async () => {
    const h = harness();
    const offsetMs = Date.UTC(2024, 9, 27, 23) - START_MS;
    expect(await h.correction.set(byAdmin(h, { offsetMs }))).toEqual({
      set: false,
      reason: "target_invalid",
    });
    expect(h.calls).toEqual([]);
  });

  it("refuses a target from 2100 on", async () => {
    const h = harness();
    const offsetMs = Date.UTC(2100, 0, 1) - START_MS;
    expect(await h.correction.set(byAdmin(h, { offsetMs }))).toEqual({
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
  it("sets but records nothing when the seat records no step", async () => {
    const h = harness({ seat: "no-step" });
    expect(await h.correction.set(byAdmin(h))).toEqual({
      set: true,
      confirmationId: null,
      stepMs: H,
      confirmedAt: SET_AT,
    });
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
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "refused" });
    expect(h.log).toHaveBeenCalledWith("warn", "clock_correction.set_refused", {
      reason: "unmoved",
    });
    expect(h.calls).not.toContain("confirmClockStep");
  });

  it("reads the box's own wall and steady clocks when none are given", async () => {
    const correction = clockCorrection({
      host: { clockStatus: vi.fn(), setClock: vi.fn() },
      backend: { assertRecordableAt: () => {} },
      store: { clear: () => {} },
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
      source: "admin",
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
    await h.correction.set(byAdmin(h));
    const calls = h.calls.length;

    expect(await h.correction.set(byAdmin(h, { stepsSeen: 0 }))).toEqual({
      set: false,
      reason: "stale",
    });
    expect(h.calls.slice(calls)).toEqual([]);
  });

  it("refuses an offset measured before the wall clock moved against the steady clock", async () => {
    const h = harness();
    const input = byAdmin(h);
    h.moveWall(5 * S);
    expect(await h.correction.set(input)).toEqual({ set: false, reason: "stale" });
    expect(h.calls).toEqual([]);
  });

  it("takes an offset when nothing moved since it was measured", async () => {
    const h = harness();
    const input = byAdmin(h);
    expect(await h.correction.set(input)).toMatchObject({ set: true });
  });
});

describe("clocks that move or cannot be read", () => {
  it("refuses stale when the wall clock steps while the host's status is read", async () => {
    const h = harness({ statusMovesWallMs: 5 * S });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "stale" });
    expect(h.hostSets).toEqual([]);
    expect(h.calls).toEqual(["clockStatus"]);
  });

  it("measures the step on the steady clock when the boot-time clock cannot be read", async () => {
    const h = harness({ bootNaN: true });
    expect(await h.correction.set(byAdmin(h))).toEqual({
      set: true,
      confirmationId: "confirmation-1",
      stepMs: H,
      confirmedAt: SET_AT,
    });
    expect(h.seatCalls[0]).toMatchObject({ verified: true, stepMs: H });
  });

  it("keeps a set's answer, and writes no second row, when the email duty throws", async () => {
    const h = harness({ onCorrectedThrows: true });
    expect(await h.correction.set(byAdmin(h))).toEqual({
      set: true,
      confirmationId: "confirmation-1",
      stepMs: H,
      confirmedAt: SET_AT,
    });
    await h.correction.writePending();
    expect(h.seatCalls).toHaveLength(1);
  });
});

describe("verifying the step", () => {
  it("verifies a step that lands within two seconds of the target", async () => {
    const h = harness({ missByMs: 2_000 });
    expect(await h.correction.set(byAdmin(h))).toMatchObject({ set: true });
    expect(h.seatCalls[0]).toMatchObject({ verified: true });
  });

  it("records a step that lands further than two seconds from the target as unverified", async () => {
    const h = harness({ missByMs: 2_001 });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "unverified" });
    expect(h.seatCalls).toHaveLength(1);
    expect(h.seatCalls[0]).toMatchObject({ verified: false, stepMs: H + 2_001 });
    expect(h.calls).toContain("reanchor");
  });

  it("asks the seat for nothing when the host refused and the clock did not move", async () => {
    const h = harness({ host: "refuses" });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "refused" });
    expect(h.calls).not.toContain("confirmClockStep");
    expect(h.calls).not.toContain("clear");
    expect(h.calls).toContain("reanchor");
    expect(h.correction.steps()).toBe(1);
  });

  it("records an unverified step when the host moved the clock and then never answered", async () => {
    const h = harness({ host: "times-out-after-moving" });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "unverified" });
    expect(h.seatCalls).toHaveLength(1);
    expect(h.seatCalls[0]).toMatchObject({ verified: false, stepMs: H });
    expect(h.calls).toContain("reanchor");
  });

  it("records an unverified step when the host client threw after the clock moved, as for a lost answer", async () => {
    const h = harness({ host: "throws-after-moving" });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "unverified" });
    expect(h.seatCalls).toHaveLength(1);
    expect(h.seatCalls[0]).toMatchObject({ verified: false, stepMs: H });
    expect(h.calls).toContain("reanchor");
    expect(h.correction.unwrittenStep()).toBeNull();
  });

  it("answers host_unavailable when the host's socket was gone at the set, with the clock unmoved", async () => {
    const h = harness({ host: "missing" });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "host_unavailable" });
    expect(h.log).toHaveBeenCalledWith("warn", "clock_correction.set_refused", {
      reason: "missing",
    });
    expect(h.calls).not.toContain("confirmClockStep");
    expect(h.calls).toContain("reanchor");
  });

  it("asks the seat for nothing when the host timed out with the clock unmoved", async () => {
    const h = harness({ host: "times-out" });
    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "refused" });
    expect(h.calls).not.toContain("confirmClockStep");
    expect(h.calls).toContain("reanchor");
  });
});

describe("one set at a time", () => {
  it("sends one set when two are started together on one measurement", async () => {
    let unusable = true;
    const h = harness({ unusable: () => unusable });
    const first = byAdmin(h);
    const second = byAdmin(h);
    h.correction.addAnchor({
      reanchor: async () => {
        unusable = false;
      },
    });

    const answers = await Promise.all([h.correction.set(first), h.correction.set(second)]);

    expect(h.hostSets).toHaveLength(1);
    expect(answers[1]).toEqual({ set: false, reason: "stale" });
    expect(h.seatCalls).toHaveLength(1);
  });

  it("judges a set started after the first finished on its own", async () => {
    let unusable = true;
    const h = harness({ unusable: () => unusable });
    h.correction.addAnchor({
      reanchor: async () => void (unusable = false),
    });
    await h.correction.set(byAdmin(h));

    expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "not_stopped" });
    expect(h.hostSets).toHaveLength(1);
  });

  it("holds another user of the turn until a set has finished", async () => {
    const h = harness();
    const order: string[] = [];
    const setting = h.correction.set(byAdmin(h)).then(() => order.push("set"));
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

  it("with a closer agreement given, refuses within it, uncertainty included, and sets past it", async () => {
    const h = harness();
    expect(
      await h.correction.set(byAdmin(h, { offsetMs: 29_970, agreesWithinMs: 30_000 })),
    ).toEqual({ set: false, reason: "agrees" });
    expect(h.hostSets).toEqual([]);
    expect(
      await h.correction.set(byAdmin(h, { offsetMs: 29_980, agreesWithinMs: 30_000 })),
    ).toMatchObject({ set: true });
  });

  it("without one, a 45-second offset still agrees: the minute holds", async () => {
    const h = harness();
    expect(await h.correction.set(byAdmin(h, { offsetMs: 45 * S }))).toEqual({
      set: false,
      reason: "agrees",
    });
    expect(
      await h.correction.set(byAdmin(h, { offsetMs: 45 * S, agreesWithinMs: 30_000 })),
    ).toMatchObject({ set: true });
  });

  it("sets an administrator's offset of 61 seconds", async () => {
    const h = harness();
    expect(await h.correction.set(byAdmin(h, { offsetMs: 61 * S }))).toMatchObject({ set: true });
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

describe("a person's set judged again once the waits are over", () => {
  it("refuses a staff member when the till's check refuses once the waits are over", async () => {
    const h = harness();
    const admit = vi
      .fn<() => Promise<"not_admitted" | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue("not_admitted");
    expect(await h.correction.set(byStaff(h, { admit }))).toEqual({
      set: false,
      reason: "not_admitted",
    });
    expect(h.hostSets).toEqual([]);
    expect(h.calls).toEqual(["clockStatus"]);
  });
  it("passes on the error when the till's check throws once the waits are over, telling no anchor", async () => {
    const calls: string[] = [];
    const h = harness({
      anchors: [
        {
          reanchor: async () => void calls.push("first.reanchor"),
        },
        {
          reanchor: async () => void calls.push("second.reanchor"),
        },
      ],
    });
    const admit = vi
      .fn<() => Promise<null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValue(new AppError("session.required", {}));
    await expect(h.correction.set(byStaff(h, { admit }))).rejects.toMatchObject({
      code: "session.required",
    });
    expect(h.hostSets).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("a staff member's set", () => {
  for (const reason of ["not_start_up", "not_admitted"] as const) {
    it(`answers ${reason} when the till's check refuses it, telling no anchor and asking the host nothing`, async () => {
      const h = harness();
      const admit = vi.fn(async () => reason);
      expect(await h.correction.set(byStaff(h, { admit }))).toEqual({ set: false, reason });
      expect(admit).toHaveBeenCalledWith(TX);
      expect(h.calls).toEqual([]);
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
    const h = harness({ unusable: () => false });
    const admit = vi.fn(async () => "not_start_up" as const);
    expect(await h.correction.set(byStaff(h, { admit }))).toEqual({
      set: false,
      reason: "not_stopped",
    });
    expect(admit).not.toHaveBeenCalled();
  });
});

describe("clock.unusable", () => {
  it("sets during clock.unusable", async () => {
    const h = harness({ unusable: () => true });
    expect(await h.correction.set(byAdmin(h, { reason: "unusable" }))).toMatchObject({ set: true });
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

describe("a set at the start", () => {
  function waitingStart(hostSets: () => number) {
    const state = startClockState();
    // A head that moves once the host has set, so the mark shows when the heads were read.
    return { state, heads: () => ({ "node-1": hostSets() === 0 ? 7 : 8 }) };
  }

  it.each([
    ["waits", null],
    ["is confirmed by devices", "by_devices"],
  ] as const)(
    "sets from a staff member while the start %s, with no stop, and confirms by a person with the heads after it",
    async (_, by) => {
      let sets = 0;
      const start = waitingStart(() => sets);
      if (by !== null) start.state.confirm(by, { "node-1": 3 });
      const h = harness({ start, duringSet: () => void sets++ });
      expect(await h.correction.set(byStaff(h, { reason: "start" }))).toMatchObject({ set: true });
      expect(h.hostSets).toHaveLength(1);
      expect(h.seatCalls[0]).toMatchObject({ reason: "start", source: "staff" });
      expect(start.state.status).toBe("by_person");
      expect(start.state.mark).toEqual({ "node-1": 8 });
    },
  );

  it("refuses not_stopped once the start is confirmed by the internet, asking the host nothing", async () => {
    const start = waitingStart(() => 0);
    start.state.confirm("by_internet", { "node-1": 3 });
    const h = harness({ start });
    expect(await h.correction.set(byStaff(h, { reason: "start" }))).toEqual({
      set: false,
      reason: "not_stopped",
    });
    expect(h.hostSets).toEqual([]);
    expect(h.calls).not.toContain("clockStatus");
    expect(start.state.status).toBe("by_internet");
    expect(start.state.mark).toEqual({ "node-1": 3 });
  });

  it("still answers set when the heads cannot be read after the step, leaving the start waiting", async () => {
    const state = startClockState();
    const h = harness({
      start: {
        state,
        heads: () => {
          throw new Error("read failed");
        },
      },
    });
    expect(await h.correction.set(byStaff(h, { reason: "start" }))).toMatchObject({
      set: true,
      confirmationId: "confirmation-1",
    });
    expect(h.hostSets).toHaveLength(1);
    expect(h.seatCalls).toHaveLength(1);
    expect(state.status).toBe("waiting");
    expect(h.log).toHaveBeenCalledWith("warn", "clock_start.mark_failed", {
      errorCode: "unknown",
    });
  });

  it.each([
    [
      "a step an administrator asked for that the host moved but did not verify",
      "by_person",
      "waiting",
      "times-out-after-moving",
    ],
    ["a step the host refused", "by_devices", "by_devices", "refuses"],
    [
      "a step an administrator asked for that the host verified",
      "by_devices",
      "by_devices",
      "sets",
    ],
    [
      "a step the host moved but did not verify",
      "by_internet",
      "by_internet",
      "times-out-after-moving",
    ],
  ] as const)("after %s, a start confirmed %s is %s", async (_, by, after, host) => {
    const state = startClockState();
    state.confirm(by, { "node-1": 3 });
    const h = harness({ host, start: { state, heads: () => ({ "node-1": 8 }) } });
    expect(await h.correction.set(byAdmin(h))).toMatchObject({ set: host === "sets" });
    expect(state.status).toBe(after);
    expect(state.mark).toEqual({ "node-1": 3 });
  });

  it.each(["by_devices", "by_person"] as const)(
    "puts a start confirmed %s back to waiting before re-anchoring or writing a step the host moved but did not verify",
    async (by) => {
      const state = startClockState();
      state.confirm(by, { "node-1": 3 });
      const gate = startClockGateHolds(
        state,
        () => true,
        () => false,
      );
      const seen: { status: string; holds: boolean }[] = [];
      const h = harness({
        host: "times-out-after-moving",
        start: { state, heads: () => ({ "node-1": 8 }) },
        anchors: [
          {
            reanchor: async () => void seen.push({ status: state.status, holds: gate() }),
          },
        ],
      });
      expect(await h.correction.set(byAdmin(h))).toEqual({ set: false, reason: "unverified" });
      expect(seen).toEqual([{ status: "waiting", holds: true }]);
      expect(h.seatCalls).toHaveLength(1);
      expect(h.log).toHaveBeenCalledWith("warn", "clock_start.step_unverified", { stepMs: H });
    },
  );

  it.each([
    ["an administrator's set", "by_devices", "by_devices"],
    ["a staff member's set at the start", "by_devices", "by_person"],
    ["a staff member's set at the start", "by_person", "by_person"],
  ] as const)(
    "holds the gate while %s is with the host on a start confirmed %s, and opens it once the host verified the step",
    async (kind, by, after) => {
      const state = startClockState();
      state.confirm(by, { "node-1": 3 });
      let release!: () => void;
      const answered = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const asked = new Promise<void>((resolve) => (reached = resolve));
      const h = harness({
        start: { state, heads: () => ({ "node-1": 8 }) },
        duringSet: async () => {
          reached();
          await answered;
        },
      });
      const gate = startClockGateHolds(
        state,
        () => true,
        () => h.correction.unwrittenStep() === "setting",
      );
      expect(gate()).toBe(false);

      const set = h.correction.set(
        kind === "an administrator's set" ? byAdmin(h) : byStaff(h, { reason: "start" }),
      );
      await asked;
      expect({ status: state.status, holds: gate() }).toEqual({ status: by, holds: true });

      release();
      expect(await set).toMatchObject({ set: true });
      expect({ status: state.status, holds: gate() }).toEqual({ status: after, holds: false });
    },
  );
});

describe("the start check's device confirmation and a set", () => {
  const AGREEING = [
    ["till-1", "10.0.0.2"],
    ["till-2", "10.0.0.3"],
  ] as const;

  /** A watch over the harness's correction, its looks started by hand; the start never reaches
   * the internet and no stop holds. */
  function watching(
    h: Harness,
    state: StartClockState,
    store: ClockWitnessStore,
    heads: () => Promise<ChainHeads>,
    noStop: () => void = () => {},
  ) {
    const watchHeads = vi.fn(heads);
    const watch = createClockWatch({
      backend: { assertRecordableAt: () => {} },
      store,
      clock: {
        now: () =>
          ({
            instant: new Date(h.measured().wallMs),
            offsetMinutes: 60,
          }) as unknown as TrustedReading,
      },
      read: (fn) => fn(TX),
      correction: h.correction,
      startUp: { noStop },
      start: { state, clockStatus: async () => UNSYNCHRONISED, heads: watchHeads },
      log: () => {},
    });
    for (const [id, address] of AGREEING) store.noteDevice(id, address, START_MS, h.measured());
    /** Runs one look; resolves once it has finished. */
    const look = (): Promise<void> => watch.check();
    return { look, watchHeads };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("confirms nothing by devices while a set is in flight, so a step the host moved but did not verify leaves the start waiting", async () => {
    const state = startClockState();
    const store = createClockWitnessStore({
      wall: () => h.measured().wallMs,
      monotonic: () => h.measured().monoMs,
    });
    let looked: Promise<void> | undefined;
    let duringSet: string | undefined;
    const h = harness({
      store,
      start: { state, heads: async () => ({ "node-1": 8 }) },
      host: "times-out-after-moving",
      duringSet: async () => {
        looked = w.look();
        await settle();
        duringSet = state.status;
      },
    });
    const w = watching(h, state, store, async () => ({ "node-1": 7 }));
    expect(await h.correction.set(byStaff(h, { reason: "start" }))).toEqual({
      set: false,
      reason: "unverified",
    });
    await looked;
    expect(duringSet).toBe("waiting");
    expect(state.status).toBe("waiting");
    expect(
      startClockGateHolds(
        state,
        () => true,
        () => false,
      )(),
    ).toBe(true);
    expect(store.witnesses()).toEqual([]);
  });

  it("makes a set wait for a device confirmation already reading the heads, and a step the host moved but did not verify then sends the start back to waiting", async () => {
    const state = startClockState();
    const store = createClockWitnessStore({
      wall: () => h.measured().wallMs,
      monotonic: () => h.measured().monoMs,
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      store,
      start: { state, heads: async () => ({ "node-1": 8 }) },
      host: "times-out-after-moving",
    });
    const w = watching(h, state, store, async () => {
      await released;
      return { "node-1": 7 };
    });
    const looked = w.look();
    await vi.waitFor(() => expect(w.watchHeads).toHaveBeenCalledOnce());
    const setting = h.correction.set(byStaff(h, { reason: "start" }));
    await settle();
    expect(h.hostSets).toEqual([]);
    release();
    await looked;
    expect(await setting).toEqual({ set: false, reason: "unverified" });
    expect(h.hostSets).toHaveLength(1);
    expect(state.status).toBe("waiting");
    expect(state.mark).toEqual({ "node-1": 7 });
    expect(h.log).toHaveBeenCalledWith("warn", "clock_start.step_unverified", {
      stepMs: H,
    });
  });

  it("goes past the start's look without waiting for a set in flight once devices confirmed the start", async () => {
    const state = startClockState();
    state.confirm("by_devices", { "node-1": 3 });
    const store = createClockWitnessStore({
      wall: () => h.measured().wallMs,
      monotonic: () => h.measured().monoMs,
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      store,
      start: { state, heads: async () => ({ "node-1": 8 }) },
      duringSet: () => released,
    });
    // Called once the start's look is over.
    const lookOver = vi.fn();
    const w = watching(h, state, store, async () => ({ "node-1": 7 }), lookOver);
    const setting = h.correction.set(byStaff(h, { reason: "start" }));
    await vi.waitFor(() => expect(h.hostSets).toHaveLength(1));
    const looking = w.look();
    await vi.waitFor(() => expect(lookOver).toHaveBeenCalled(), { timeout: 200 });
    expect(w.watchHeads).not.toHaveBeenCalled();
    release();
    await looking;
    expect(await setting).toMatchObject({ set: true });
  });
});
