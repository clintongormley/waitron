import { describe, expect, it, vi } from "vitest";
import type {
  BootReading,
  ClockProvedWrong,
  ClockStopState,
  ClockWitness,
  TrustedReading,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { ClockSetAnswer, ClockSetInput } from "./clock-correction.js";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";
import { createClockWitnessStore } from "./clock-witnesses.js";

const TX = { fake: "tx" } as unknown as Transaction;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;
const BOOT: BootReading = { ms: 9_000_000, id: "boot-correction-test" };

const STOPPED: ClockStopState = {
  clockAt: "2026-10-31T10:00:00.000Z",
  offsetMinutes: 60,
  lastRecordAt: "2026-10-31T11:00:00.000Z",
  lastRecordOffsetMinutes: 60,
  recordId: "record-1",
  gapMs: 3_600_000,
  proof: "none",
  agreeing: { authority: null, devices: [] },
  contrary: { authority: null, devices: [] },
  confirmation: null,
};

/** The seat's answer: every authority and device witness handed in disagrees. */
function contraryStop(witnesses: readonly ClockWitness[]): ClockStopState {
  const authority = witnesses.filter((witness) => witness.kind === "authority").at(-1) ?? null;
  const devices = witnesses.filter((witness) => witness.kind === "device");
  return {
    ...STOPPED,
    proof: authority === null && devices.length === 0 ? "none" : "contrary",
    contrary: { authority, devices },
  };
}

function harness(
  options: {
    answer?: (input: ClockSetInput, call: number) => ClockSetAnswer;
    note?: (input: ClockProvedWrong) => Promise<void>;
    /** A reading no record could carry: the seat answers no stop. */
    unusable?: boolean;
    /** The correction's step counter rises while the seat judges the stop, after the witnesses
     * were read. */
    stepDuringStopRead?: boolean;
  } = {},
) {
  let wallMs = START_MS;
  let monoMs = 1_000;
  let checkId = "check-1";
  const timers: { fn: () => void }[] = [];
  const order: string[] = [];
  const sets: ClockSetInput[] = [];
  const log = vi.fn();
  const store = createClockWitnessStore({ wall: () => wallMs, monotonic: () => monoMs });
  let steps = 0;
  const backend = {
    clockStopState: vi.fn(async (_tx: Transaction, _at: unknown, witnesses: ClockWitness[]) => {
      if (options.stepDuringStopRead === true) steps += 5;
      return options.unusable === true ? null : contraryStop(witnesses);
    }),
    assertRecordableAt: () => {
      if (options.unusable === true)
        throw new AppError("clock.unusable", {
          clockAt: "2001-01-01T00:00:00.000Z",
          offsetMinutes: 60,
        });
    },
    noteClockProvedWrong: vi.fn(async (_tx: Transaction, input: ClockProvedWrong) => {
      await options.note?.(input);
      order.push(`disproof ${input.reason}`);
      return { recorded: [], unused: [], held: [] };
    }),
    openClockCheck: vi.fn(async () => ({ id: checkId })),
  };
  const correction = {
    inTurn: <T>(fn: () => Promise<T>) => fn(),
    steps: () => steps,
    set: vi.fn(async (input: ClockSetInput) => {
      // As the correction's counter rises once for every set sent to the host.
      steps++;
      sets.push(input);
      order.push("set");
      return (options.answer ?? (() => ({ set: false, reason: "synchronised" as const })))(
        input,
        sets.length,
      );
    }),
    writePending: vi.fn(async () => void order.push("writePending")),
  };
  const watch = startClockWatch({
    backend: backend as unknown as Parameters<typeof startClockWatch>[0]["backend"],
    store,
    clock: {
      now: () =>
        ({
          instant: new Date(options.unusable === true ? Date.UTC(2001, 0, 1) : wallMs),
          offsetMinutes: 60,
        }) as unknown as TrustedReading,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: { readBoot: () => ({ ...BOOT }), elapsed: () => monoMs },
    nodeId: "node-1",
    read: async (fn) => fn(TX),
    transaction: async (fn) => fn(TX),
    correction,
    filesRecords: () => false,
    isPrimary: () => true,
    intervalMs: CLOCK_WATCH_MS,
    log,
    timer: (_ms, fn) => {
      timers.push({ fn });
      return { cancel: () => {} };
    },
  });

  /** Moves both clocks a look's interval, fires the armed look and waits for the next. */
  async function look(): Promise<void> {
    monoMs += CLOCK_WATCH_MS;
    wallMs += CLOCK_WATCH_MS;
    const count = timers.length;
    timers.at(-1)!.fn();
    // Thousands of looks: yield to the event loop rather than poll on a timer.
    for (let turn = 0; timers.length === count; turn++) {
      if (turn > 1_000) throw new Error("the look did not finish");
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /** AEAT's clock reads `offsetMs` from the box's, measured now. */
  function aeatSays(offsetMs: number): { wallMs: number; monoMs: number } {
    const at = { wallMs, monoMs };
    store.noteAuthority({ authorityMs: wallMs + offsetMs, uncertaintyMs: 100, at });
    return at;
  }

  function devicesSay(offsetMs: number): void {
    store.noteDevice("device-a", "10.0.0.2", wallMs + offsetMs, { wallMs, monoMs });
    store.noteDevice("device-b", "10.0.0.3", wallMs + offsetMs, { wallMs, monoMs });
  }

  return {
    watch,
    backend,
    correction,
    sets,
    order,
    log,
    look,
    aeatSays,
    devicesSay,
    newCheck: (id: string) => {
      checkId = id;
    },
    /** Looks every 15 s of the steady clock for `ms`, AEAT disagreeing on each. */
    async looksFor(ms: number, offsetMs = 2 * DAY): Promise<void> {
      for (let elapsed = 0; elapsed < ms; elapsed += CLOCK_WATCH_MS) {
        aeatSays(offsetMs);
        await look();
      }
    },
  };
}

describe("the clock watch sets the clock from AEAT during a stop", () => {
  it("sets AEAT's offset once when AEAT disagrees, with where AEAT's reading was measured", async () => {
    const h = harness();
    const at = h.aeatSays(2 * DAY);
    await h.look();

    expect(h.sets).toEqual([
      {
        reason: "behind_chain",
        source: "authority",
        offsetMs: 2 * DAY,
        measuredAt: at,
        stepsSeen: 0,
        witnesses: [expect.objectContaining({ kind: "authority" }) as unknown],
        requester: { source: "authority", check: "check-1" },
      },
    ]);
  });

  it("sets AEAT's offset, not the devices', when devices disagree too", async () => {
    const h = harness();
    h.devicesSay(-3 * DAY);
    h.aeatSays(2 * DAY);
    await h.look();

    expect(h.sets).toHaveLength(1);
    expect(h.sets[0]).toMatchObject({ source: "authority", offsetMs: 2 * DAY });
    expect(h.sets[0]!.witnesses.map((witness) => witness.kind)).toEqual(["authority"]);
  });

  it("sets nothing when only devices from two addresses disagree", async () => {
    const h = harness();
    h.devicesSay(2 * DAY);
    await h.look();
    expect(h.sets).toEqual([]);

    // The control: the same harness sets once AEAT disagrees.
    h.aeatSays(2 * DAY);
    await h.look();
    expect(h.sets).toHaveLength(1);
  });

  it("sets nothing while the clock reads a date no record could carry, devices disagreeing", async () => {
    const h = harness({ unusable: true });
    h.devicesSay(2 * DAY);
    h.aeatSays(2 * DAY);
    await h.look();
    expect(h.sets).toEqual([]);

    const usable = harness();
    usable.devicesSay(2 * DAY);
    usable.aeatSays(2 * DAY);
    await usable.look();
    expect(usable.sets).toHaveLength(1);
  });

  it("sets nothing from an AEAT disagreement older than five minutes, which the stop still lists", async () => {
    const h = harness();
    h.aeatSays(2 * DAY);
    // 21 looks of 15 s: the reading is 5 min 15 s old on the last.
    for (let look = 0; look < 21; look++) await h.look();
    h.correction.set.mockClear();
    h.sets.length = 0;
    await h.look();
    expect(h.sets).toEqual([]);

    // The control: a fresh reading sets.
    h.aeatSays(2 * DAY);
    await h.look();
    expect(h.sets).toHaveLength(1);
  });

  it("logs a refusal once while its reason stays the same", async () => {
    const h = harness({ answer: () => ({ set: false, reason: "synchronised" }) });
    await h.looksFor(3 * CLOCK_WATCH_MS);

    expect(h.sets).toHaveLength(3);
    const refusals = h.log.mock.calls.filter(([, event]) => event === "clock_watch.cannot_set");
    expect(refusals).toEqual([["info", "clock_watch.cannot_set", { reason: "synchronised" }]]);

    h.correction.set.mockImplementation(async (input: ClockSetInput) => {
      h.sets.push(input);
      return { set: false, reason: "host_unavailable" };
    });
    await h.looksFor(CLOCK_WATCH_MS);
    expect(h.log.mock.calls.filter(([, event]) => event === "clock_watch.cannot_set")).toHaveLength(
      2,
    );
  });

  it("logs the same refusal again after a set went through", async () => {
    const h = harness({
      answer: (_input, call) =>
        call === 2
          ? { set: true, confirmationId: "confirmation-1", stepMs: 2 * DAY }
          : { set: false, reason: "synchronised" },
    });
    await h.looksFor(3 * CLOCK_WATCH_MS);
    expect(h.log.mock.calls.filter(([, event]) => event === "clock_watch.cannot_set")).toEqual([
      ["info", "clock_watch.cannot_set", { reason: "synchronised" }],
      ["info", "clock_watch.cannot_set", { reason: "synchronised" }],
    ]);
  });

  it("calls writePending straight after the look's first disproof write, never when it failed", async () => {
    let failing = true;
    const h = harness({
      note: async () => {
        if (failing) throw new AppError("storage.disk_full", {});
      },
    });
    h.aeatSays(2 * DAY);
    // stepComing keeps the disagreement pending when its write fails.
    await expect(h.watch.stepComing()).rejects.toThrow(AppError);
    await h.look();
    expect(h.correction.writePending).not.toHaveBeenCalled();

    failing = false;
    h.order.length = 0;
    await h.look();
    expect(h.correction.writePending).toHaveBeenCalledTimes(1);
    expect(h.order.slice(0, 2)).toEqual(["disproof authority", "writePending"]);
  });

  it("reads the step counter when it reads the witnesses, not when it sets", async () => {
    const h = harness({ stepDuringStopRead: true });
    h.aeatSays(2 * DAY);
    await h.look();
    expect(h.sets).toEqual([expect.objectContaining({ stepsSeen: 0 })]);
  });

  it("sets nothing on a look whose first disproof write failed", async () => {
    let failing = false;
    const h = harness({
      note: async () => {
        if (failing) throw new AppError("storage.disk_full", {});
      },
    });
    h.aeatSays(2 * DAY);
    await h.look();
    expect(h.sets).toHaveLength(1);

    // The next look's first write fails on the disagreement this look leaves unrecorded.
    failing = true;
    h.aeatSays(2 * DAY);
    await h.look();
    h.aeatSays(2 * DAY);
    await h.look();
    expect(h.sets).toHaveLength(2);
  });

  it("logs a failing writePending and still sets on that look", async () => {
    const h = harness();
    h.correction.writePending.mockRejectedValue(new AppError("storage.disk_full", {}));
    h.aeatSays(2 * DAY);
    await h.look();

    expect(h.log).toHaveBeenCalledWith("warn", "clock_watch.check_failed", {
      errorCode: "storage.disk_full",
    });
    expect(h.sets).toHaveLength(1);
  });

  it("logs a set that throws and still records AEAT's disagreement on that look", async () => {
    const h = harness();
    h.correction.set.mockRejectedValue(new AppError("storage.disk_full", {}));
    h.aeatSays(2 * DAY);
    await h.look();

    expect(h.log).toHaveBeenCalledWith("warn", "clock_watch.check_failed", {
      errorCode: "storage.disk_full",
    });
    expect(h.order).toEqual(["writePending", "disproof authority"]);
  });

  it.each([
    ["writePending", []],
    ["set", ["writePending"]],
  ] as const)("does nothing more on a look once stopped during its %s", async (method, before) => {
    const h = harness();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    h.correction[method].mockImplementation((async () => {
      entered();
      await held;
      return { set: false, reason: "synchronised" };
    }) as never);
    h.aeatSays(2 * DAY);
    const looking = h.look();
    await inside;
    const stopping = h.watch.stop();
    release();
    await stopping;
    await looking.catch(() => {});

    // No stop read or disproof write after the stop.
    expect(h.order).toEqual(before);
    expect(h.backend.clockStopState).toHaveBeenCalledTimes(method === "set" ? 1 : 0);
  });

  describe("backs off after a set the host refused, timed out or did not verify", () => {
    it("asks once in the first 10 minutes, again at 10, then 20 minutes after that", async () => {
      const h = harness({ answer: () => ({ set: false, reason: "refused" }) });
      await h.looksFor(CLOCK_WATCH_MS);
      await h.looksFor(10 * MINUTE - CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(1);

      await h.looksFor(CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(2);

      await h.looksFor(20 * MINUTE - CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(2);
      await h.looksFor(CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(3);
    });

    it("never waits longer than four hours between two asks", async () => {
      const h = harness({ answer: () => ({ set: false, reason: "unverified" }) });
      // 10 + 20 + 40 + 80 + 160 minutes, then 240 each time.
      await h.looksFor(CLOCK_WATCH_MS);
      await h.looksFor(310 * MINUTE);
      expect(h.sets).toHaveLength(6);
      await h.looksFor(240 * MINUTE - CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(6);
      await h.looksFor(CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(7);
    });

    it("asks every look when the answer asked nothing of the host", async () => {
      const h = harness({ answer: () => ({ set: false, reason: "synchronised" }) });
      await h.looksFor(4 * CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(4);
    });

    it("asks at once when a new check opens", async () => {
      const h = harness({ answer: () => ({ set: false, reason: "refused" }) });
      await h.looksFor(2 * CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(1);

      h.newCheck("check-2");
      await h.looksFor(CLOCK_WATCH_MS);
      expect(h.sets).toHaveLength(2);
      expect(h.sets[1]).toMatchObject({
        stepsSeen: 1,
        requester: { source: "authority", check: "check-2" },
      });
    });

    it("so a correction recording clock.corrected for each unverified answer records at most one a backoff step", async () => {
      const corrected: number[] = [];
      const h = harness({
        answer: (_input, call) => {
          corrected.push(call);
          return { set: false, reason: "unverified" };
        },
      });
      await h.looksFor(30 * MINUTE - CLOCK_WATCH_MS);
      expect(corrected).toEqual([1, 2]);
    });
  });
});
