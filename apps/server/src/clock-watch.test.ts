import { describe, expect, it, vi } from "vitest";
import type {
  AuthorityTimeSample,
  BootReading,
  ClockConfirmation,
  ClockProvedWrong,
  ClockStopState,
  ClockWitness,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";

const TX = { fake: "tx" } as unknown as Transaction;
const START_MS = Date.parse("2026-07-20T18:00:00.000Z");

const STOPPED: ClockStopState = {
  clockAt: "2026-07-20T18:00:00.000Z",
  offsetMinutes: 120,
  lastRecordAt: "2026-07-20T19:00:00.000Z",
  lastRecordOffsetMinutes: 120,
  recordId: "record-1",
  gapMs: 3_600_000,
  proof: "none",
  agreeing: { authority: null, devices: [] },
  contrary: { authority: null, devices: [] },
  confirmation: null,
};

const BOOT: BootReading = { ms: 9_000_000, id: "boot-watch-test" };

const CONFIRMATION: ClockConfirmation = {
  id: "confirmation-1",
  seq: 1,
  source: "devices",
  personId: null,
  confirmedAt: "2026-07-20T18:00:15.000Z",
  checkId: "check-1",
  recordId: "record-1",
};

function harness(
  options: {
    stop?: ClockStopState | null;
    files?: boolean;
    primary?: boolean;
    newAuthority?: ClockWitness[][];
    note?: (tx: Transaction, input: ClockProvedWrong) => Promise<unknown>;
    seat?: "full" | "empty";
    /** The seat also opens checks and confirms the clock. */
    checks?: boolean;
  } = {},
) {
  let wallMs = START_MS;
  let monoMs = 1_000;
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const logs: { level: string; event: string; fields: unknown }[] = [];
  const sample: AuthorityTimeSample = {
    authorityMs: START_MS,
    uncertaintyMs: 100,
    at: { wallMs: START_MS, monoMs: 1_000 },
  };
  const state = { stop: options.stop === undefined ? STOPPED : options.stop };
  const queued = [...(options.newAuthority ?? [])];
  const backend = {
    clockStopState: vi.fn<(...args: unknown[]) => Promise<ClockStopState | null>>(
      async () => state.stop,
    ),
    readAuthorityTime: vi.fn(async () => sample),
    assertRecordableAt: vi.fn<(reading: unknown) => void>(),
    noteClockProvedWrong: vi.fn(
      options.note ??
        (async () => ({ recorded: [] as string[], unused: [] as string[], held: [] as string[] })),
    ),
    ...(options.checks === true
      ? {
          openClockCheck: vi.fn<(...args: unknown[]) => Promise<{ id: string } | null>>(
            async () => ({ id: "check-1" }),
          ),
          confirmClockStop: vi.fn<
            (...args: unknown[]) => Promise<{ confirmation: ClockConfirmation | null }>
          >(async () => ({ confirmation: CONFIRMATION })),
        }
      : {}),
  };
  const store = {
    noteAuthority: vi.fn(),
    witnesses: vi.fn((): ClockWitness[] => []),
    takeNewAuthority: vi.fn((): ClockWitness[] => queued.shift() ?? []),
    endStop: vi.fn(),
    clear: vi.fn(),
  };
  const read = vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX));
  const transaction = vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX));
  const files = { current: options.files ?? true };
  const primary = { current: options.primary ?? true };
  const watch = startClockWatch({
    backend:
      options.seat === "empty"
        ? { assertRecordableAt: () => {} }
        : (backend as unknown as Parameters<typeof startClockWatch>[0]["backend"]),
    store,
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 120 }) as never,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: { readBoot: () => BOOT, elapsed: () => monoMs },
    nodeId: "node-1",
    read: read as never,
    transaction: transaction as never,
    filesRecords: () => files.current,
    isPrimary: () => primary.current,
    intervalMs: CLOCK_WATCH_MS,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    timer: (ms, fn) => {
      const timer = { ms, fn, cancelled: false };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
  });

  /** Moves both clocks, fires the armed timer and waits for the next one to be armed. */
  async function tick(advance: { wallMs?: number; monoMs?: number } = {}) {
    const steady = advance.monoMs ?? CLOCK_WATCH_MS;
    monoMs += steady;
    wallMs += advance.wallMs ?? steady;
    const armed = timers.at(-1)!;
    const count = timers.length;
    armed.fn();
    await vi.waitFor(() => expect(timers.length).toBe(count + 1));
  }

  return {
    backend,
    store,
    read,
    transaction,
    logs,
    timers,
    state,
    files,
    primary,
    sample,
    watch,
    tick,
    wall: () => wallMs,
    move: (by: { wallMs: number; monoMs: number }) => {
      wallMs += by.wallMs;
      monoMs += by.monoMs;
    },
  };
}

function authority(boxAtMs: number, offsetMs: number): ClockWitness {
  return {
    kind: "authority",
    id: "authority",
    boxAt: new Date(boxAtMs).toISOString(),
    witnessAt: new Date(boxAtMs + offsetMs).toISOString(),
    uncertaintyMs: 100,
  };
}

describe("startClockWatch", () => {
  it("arms its first check 15 seconds after start", () => {
    const h = harness();
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(15_000);
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
  });

  it("reads AEAT's time during a stop on a filing primary, again a minute later, and notes the sample", async () => {
    const h = harness();
    const device: ClockWitness = {
      kind: "device",
      id: "device-1",
      boxAt: "2026-07-20T18:00:30.000Z",
      witnessAt: "2026-07-20T19:00:30.000Z",
      uncertaintyMs: 0,
    };
    h.store.witnesses.mockReturnValueOnce([device]);
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
    expect(h.store.noteAuthority).toHaveBeenCalledExactlyOnceWith(h.sample);
    expect(h.backend.clockStopState).toHaveBeenCalledExactlyOnceWith(
      TX,
      { instant: new Date(h.wall()), offsetMinutes: 120 },
      [device],
    );
    expect(h.store.endStop).not.toHaveBeenCalled();
    await h.tick({ monoMs: 60_000 });
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(2);
  });

  it("still reads AEAT's time while a restart is in force, the raw comparison still behind", async () => {
    const h = harness({
      stop: {
        ...STOPPED,
        proof: "confirmed",
        confirmation: {
          id: "confirmation-0",
          source: "admin",
          personId: "p",
          confirmedAt: "2026-07-20T18:00:00.000Z",
        },
      },
    });
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
  });

  it("does not note a sample AEAT could not give", async () => {
    const h = harness();
    h.backend.readAuthorityTime.mockResolvedValueOnce(null as never);
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
    expect(h.store.noteAuthority).not.toHaveBeenCalled();
  });

  it("asks AEAT nothing when the clock is not behind, and ends the stop", async () => {
    const h = harness({ stop: null });
    await h.tick();
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
    expect(h.store.endStop).toHaveBeenCalledTimes(1);
    await h.tick();
    expect(h.store.endStop).toHaveBeenCalledTimes(2);
  });

  it("keeps AEAT's disagreements while the clock reads a date no record can carry", async () => {
    const h = harness({ stop: null });
    h.backend.assertRecordableAt.mockImplementation(() => {
      throw new AppError("clock.unusable", {
        clockAt: "2001-01-01T00:00:00.000Z",
        offsetMinutes: 60,
      });
    });
    await h.tick();
    expect(h.backend.assertRecordableAt).toHaveBeenCalledExactlyOnceWith(
      h.backend.clockStopState.mock.calls[0]![1],
    );
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
    expect(h.store.endStop).not.toHaveBeenCalled();
    h.backend.assertRecordableAt.mockReset();
    await h.tick();
    expect(h.store.endStop).toHaveBeenCalledTimes(1);
  });

  it("asks AEAT nothing on a box that does not file", async () => {
    const h = harness({ files: false });
    await h.tick();
    expect(h.backend.clockStopState).toHaveBeenCalledTimes(1);
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
  });

  it("does nothing on a node that is not the primary but drains AEAT's new witnesses", async () => {
    const h = harness({ primary: false, newAuthority: [[authority(START_MS, 120_000)]] });
    await h.tick({ wallMs: 200_000 });
    expect(h.backend.clockStopState).not.toHaveBeenCalled();
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
    expect(h.backend.noteClockProvedWrong).not.toHaveBeenCalled();
    expect(h.store.takeNewAuthority).toHaveBeenCalledTimes(1);
  });

  it("drains AEAT's new witnesses on every tick, stopped or not", async () => {
    const h = harness({ stop: null });
    await h.tick();
    h.state.stop = STOPPED;
    await h.tick();
    expect(h.store.takeNewAuthority).toHaveBeenCalledTimes(2);
  });

  it("does nothing a seat without the clock methods cannot do", async () => {
    const h = harness({ seat: "empty", newAuthority: [[authority(START_MS, 120_000)]] });
    await h.tick({ wallMs: 200_000 });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.store.endStop).toHaveBeenCalledTimes(1);
    expect(h.logs).toEqual([]);
  });

  it("reports a forward jump of 61 s between ticks, trusted until the earlier tick plus the steady time", async () => {
    const h = harness({ stop: null });
    await h.tick();
    const earlier = h.wall();
    await h.tick({ monoMs: 60_000, wallMs: 121_000 });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledExactlyOnceWith(TX, {
      trustedUntil: new Date(earlier + 60_000),
      observedAt: new Date(earlier + 121_000),
      reason: "jump",
    });
  });

  it("counts the jump from the start before the first tick", async () => {
    const h = harness({ stop: null });
    await h.tick({ monoMs: 60_000, wallMs: 121_000 });
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledExactlyOnceWith(TX, {
      trustedUntil: new Date(START_MS + 60_000),
      observedAt: new Date(START_MS + 121_000),
      reason: "jump",
    });
  });

  it("does not report a forward step of 59 s", async () => {
    const h = harness({ stop: null });
    await h.tick();
    await h.tick({ monoMs: 60_000, wallMs: 119_000 });
    expect(h.backend.noteClockProvedWrong).not.toHaveBeenCalled();
  });

  it("does not report a backward jump", async () => {
    const h = harness({ stop: null });
    await h.tick();
    await h.tick({ monoMs: 60_000, wallMs: -600_000 });
    expect(h.backend.noteClockProvedWrong).not.toHaveBeenCalled();
  });

  it("reports AEAT disagreeing, trusted until that witness's boxAt, observed at AEAT's time", async () => {
    const tickAt = START_MS + 60_000;
    const witness = authority(tickAt - 40_000, 3_600_000);
    const h = harness({ newAuthority: [[witness]] });
    await h.tick();
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledExactlyOnceWith(TX, {
      trustedUntil: new Date(tickAt - 40_000),
      observedAt: new Date(tickAt - 40_000 + 3_600_000),
      reason: "authority",
    });
  });

  it("does not report an AEAT witness that agrees", async () => {
    const h = harness({ newAuthority: [[authority(START_MS, 30_000)]] });
    await h.tick();
    expect(h.backend.noteClockProvedWrong).not.toHaveBeenCalled();
  });

  it("logs each restart the disproof found nothing written under, and each one held", async () => {
    const h = harness({
      stop: null,
      note: async () => ({ recorded: ["r0"], unused: ["r1"], held: ["r2"] }),
    });
    await h.tick();
    await h.tick({ wallMs: 200_000 });
    expect(h.logs).toEqual([
      {
        level: "info",
        event: "clock_watch.disproved_unused",
        fields: { restartId: "r1", reason: "jump" },
      },
      {
        level: "warn",
        event: "clock_watch.disproved_held",
        fields: { restartId: "r2", reason: "jump" },
      },
    ]);
  });

  it("retries a jump whose record failed on the next check, until it is recorded", async () => {
    const h = harness({ stop: null });
    h.backend.noteClockProvedWrong.mockRejectedValueOnce(new AppError("storage.disk_full", {}));
    await h.tick({ monoMs: 60_000, wallMs: 121_000 });
    const jump = {
      trustedUntil: new Date(START_MS + 60_000),
      observedAt: new Date(START_MS + 121_000),
      reason: "jump",
    };
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledExactlyOnceWith(TX, jump);
    await h.tick();
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(2);
    expect(h.backend.noteClockProvedWrong).toHaveBeenLastCalledWith(TX, jump);
    await h.tick();
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(2);
  });

  it("still reads the stop on every check, and asks AEAT once a minute, while a record keeps failing", async () => {
    const h = harness();
    h.backend.noteClockProvedWrong.mockRejectedValue(new AppError("storage.disk_full", {}));
    await h.tick({ monoMs: 60_000, wallMs: 121_000 });
    await h.tick({ monoMs: 60_000 });
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(2);
    expect(h.backend.clockStopState).toHaveBeenCalledTimes(2);
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(2);
    expect(h.store.takeNewAuthority).toHaveBeenCalledTimes(2);
    expect(h.store.endStop).not.toHaveBeenCalled();
    h.state.stop = null;
    await h.tick();
    expect(h.store.endStop).toHaveBeenCalledTimes(1);
    expect(h.store.takeNewAuthority).toHaveBeenCalledTimes(3);
    expect(h.logs.map((line) => line.event)).toEqual([
      "clock_watch.check_failed",
      "clock_watch.check_failed",
      "clock_watch.check_failed",
    ]);
  });

  it("records AEAT disagreements oldest first, and retries both when the first fails", async () => {
    const older = authority(START_MS + 10_000, 3_600_000);
    const newer = authority(START_MS + 50_000, 3_600_000);
    const h = harness({ newAuthority: [[newer, older]] });
    h.backend.noteClockProvedWrong.mockRejectedValueOnce(new AppError("storage.disk_full", {}));
    const asked = (witness: ClockWitness) => ({
      trustedUntil: new Date(witness.boxAt),
      observedAt: new Date(witness.witnessAt),
      reason: "authority",
    });
    await h.tick();
    expect(h.backend.noteClockProvedWrong.mock.calls).toEqual([[TX, asked(older)]]);
    await h.tick();
    expect(h.backend.noteClockProvedWrong.mock.calls).toEqual([
      [TX, asked(older)],
      [TX, asked(older)],
      [TX, asked(newer)],
    ]);
    await h.tick();
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(3);
  });

  it("reads no stop when stopped while a disproof is being recorded", async () => {
    const h = harness();
    let release!: () => void;
    h.backend.noteClockProvedWrong.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ recorded: [], unused: [], held: [] });
        }),
    );
    h.move({ wallMs: 121_000, monoMs: 60_000 });
    h.timers.at(-1)!.fn();
    await vi.waitFor(() => expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(1));
    const stopping = h.watch.stop();
    release();
    await stopping;
    expect(h.read).not.toHaveBeenCalled();
  });

  it("records no further disproof once stopped", async () => {
    const h = harness({
      newAuthority: [[authority(START_MS + 50_000, 3_600_000), authority(START_MS, 3_600_000)]],
    });
    let release!: () => void;
    h.backend.noteClockProvedWrong.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ recorded: [], unused: [], held: [] });
        }),
    );
    h.timers.at(-1)!.fn();
    await vi.waitFor(() => expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(1));
    const stopping = h.watch.stop();
    release();
    await stopping;
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(1);
  });

  it("keeps one disproof for the same witness noted twice", async () => {
    const witness = authority(START_MS, 3_600_000);
    const h = harness({ newAuthority: [[witness, witness]] });
    await h.tick();
    expect(h.backend.noteClockProvedWrong).toHaveBeenCalledTimes(1);
  });

  it("keeps at most six hours of unrecorded disproofs, logging each one it leaves out", async () => {
    const many = Array.from({ length: 1_441 }, (_, index) =>
      authority(START_MS - index * 1_000, 3_600_000),
    );
    const h = harness({ newAuthority: [many] });
    h.backend.noteClockProvedWrong.mockRejectedValue(new AppError("storage.disk_full", {}));
    await h.tick();
    expect(h.logs.filter((line) => line.event === "clock_watch.disproof_dropped")).toEqual([
      {
        level: "warn",
        event: "clock_watch.disproof_dropped",
        fields: { reason: "authority", trustedUntil: many[0]!.boxAt },
      },
    ]);
  });

  it("logs a failing check and still runs the next one", async () => {
    const h = harness();
    h.backend.clockStopState.mockRejectedValueOnce(new AppError("storage.disk_full", {}));
    await h.tick();
    expect(h.logs).toEqual([
      {
        level: "warn",
        event: "clock_watch.check_failed",
        fields: { errorCode: "storage.disk_full" },
      },
    ]);
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
  });

  it("stop waits for a check in flight, and nothing runs after it", async () => {
    const h = harness({ newAuthority: [[], [authority(START_MS, 3_600_000)]] });
    let release!: (sample: AuthorityTimeSample) => void;
    h.backend.readAuthorityTime.mockImplementationOnce(
      () => new Promise<AuthorityTimeSample>((resolve) => (release = resolve)),
    );
    h.timers.at(-1)!.fn();
    await vi.waitFor(() => expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1));
    let stopped = false;
    const stopping = h.watch.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);
    release(h.sample);
    await stopping;
    expect(h.timers.every((timer, index) => index === 0 || timer.cancelled)).toBe(true);
    for (const timer of h.timers) timer.fn();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.backend.clockStopState).toHaveBeenCalledTimes(1);
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
    expect(h.backend.noteClockProvedWrong).not.toHaveBeenCalled();
  });

  it("asks AEAT nothing when stopped while the stop is being read", async () => {
    const h = harness();
    let release!: (state: ClockStopState) => void;
    h.backend.clockStopState.mockImplementationOnce(
      () => new Promise<ClockStopState>((resolve) => (release = resolve)),
    );
    h.timers.at(-1)!.fn();
    await vi.waitFor(() => expect(h.backend.clockStopState).toHaveBeenCalledTimes(1));
    const stopping = h.watch.stop();
    release(STOPPED);
    await stopping;
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
    expect(h.store.takeNewAuthority).not.toHaveBeenCalled();
    expect(h.timers).toHaveLength(1);
  });

  it("opens a check, in a transaction, at each look during a stop with the reading, the boot reading and the node, and logs a check once", async () => {
    const h = harness({ checks: true });
    await h.tick();
    expect(h.backend.openClockCheck).toHaveBeenCalledExactlyOnceWith(TX, {
      reading: { instant: new Date(h.wall()), offsetMinutes: 120 },
      boot: BOOT,
      nodeId: "node-1",
    });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    await h.tick();
    expect(h.backend.openClockCheck).toHaveBeenCalledTimes(2);
    expect(h.logs).toEqual([
      { level: "info", event: "clock_watch.stop_opened", fields: { checkId: "check-1" } },
    ]);
    h.backend.openClockCheck!.mockResolvedValueOnce({ id: "check-2" });
    await h.tick();
    expect(h.logs.map((line) => line.fields)).toEqual([
      { checkId: "check-1" },
      { checkId: "check-2" },
    ]);
  });

  it("opens no check while the clock is not behind, and logs none when the seat opens none", async () => {
    const h = harness({ checks: true, stop: null });
    await h.tick();
    expect(h.backend.openClockCheck).not.toHaveBeenCalled();
    h.state.stop = STOPPED;
    h.backend.openClockCheck!.mockResolvedValueOnce(null);
    await h.tick();
    expect(h.backend.openClockCheck).toHaveBeenCalledTimes(1);
    expect(h.logs).toEqual([]);
  });

  it("confirms the clock once when the witnesses are ready, with what the stop was judged on, and clears the store", async () => {
    const device: ClockWitness = {
      kind: "device",
      id: "device-1",
      address: "192.168.10.31",
      boxAt: "2026-07-20T18:00:10.000Z",
      witnessAt: "2026-07-20T18:00:10.000Z",
      uncertaintyMs: 0,
    };
    const h = harness({ checks: true, stop: { ...STOPPED, proof: "ready" } });
    h.store.witnesses.mockReturnValue([device]);
    await h.tick();
    expect(h.backend.confirmClockStop).toHaveBeenCalledExactlyOnceWith(TX, {
      reading: { instant: new Date(h.wall()), offsetMinutes: 120 },
      boot: BOOT,
      witnesses: [device],
      nodeId: "node-1",
    });
    expect(h.store.clear).toHaveBeenCalledTimes(1);
    expect(h.logs).toContainEqual({
      level: "info",
      event: "clock_watch.confirmed",
      fields: { confirmationId: "confirmation-1", source: "devices" },
    });
  });

  it.each(["none", "contrary", "confirmed"] as const)(
    "asks for no confirmation when the proof is %s",
    async (proof) => {
      const h = harness({ checks: true, stop: { ...STOPPED, proof } });
      await h.tick();
      expect(h.backend.confirmClockStop).not.toHaveBeenCalled();
      expect(h.store.clear).not.toHaveBeenCalled();
    },
  );

  it("clears nothing and logs no confirmation when the seat confirms nothing", async () => {
    const h = harness({ checks: true, stop: { ...STOPPED, proof: "ready" } });
    h.backend.confirmClockStop!.mockResolvedValueOnce({ confirmation: null });
    await h.tick();
    expect(h.backend.confirmClockStop).toHaveBeenCalledTimes(1);
    expect(h.store.clear).not.toHaveBeenCalled();
    expect(h.logs.map((line) => line.event)).toEqual(["clock_watch.stop_opened"]);
  });

  it("logs a failing confirmation and confirms at the next look", async () => {
    const h = harness({ checks: true, stop: { ...STOPPED, proof: "ready" } });
    h.backend.confirmClockStop!.mockRejectedValueOnce(new AppError("storage.disk_full", {}));
    await h.tick();
    expect(h.logs).toContainEqual({
      level: "warn",
      event: "clock_watch.check_failed",
      fields: { errorCode: "storage.disk_full" },
    });
    expect(h.store.clear).not.toHaveBeenCalled();
    await h.tick();
    expect(h.backend.confirmClockStop).toHaveBeenCalledTimes(2);
    expect(h.store.clear).toHaveBeenCalledTimes(1);
  });

  it("asks AEAT at most once a minute by the steady clock during a stop", async () => {
    const h = harness();
    await h.tick();
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.backend.clockStopState).toHaveBeenCalledTimes(4);
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(2);
  });

  it("asks AEAT again when the steady clock cannot be read", async () => {
    const h = harness();
    await h.tick();
    await h.tick({ monoMs: Number.NaN, wallMs: 15_000 });
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(2);
  });

  it("stop waits for a confirmation in flight", async () => {
    const h = harness({ checks: true, stop: { ...STOPPED, proof: "ready" } });
    let release!: (answer: { confirmation: ClockConfirmation | null }) => void;
    h.backend.confirmClockStop!.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    h.timers.at(-1)!.fn();
    await vi.waitFor(() => expect(h.backend.confirmClockStop).toHaveBeenCalledTimes(1));
    let stopped = false;
    const stopping = h.watch.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);
    release({ confirmation: CONFIRMATION });
    await stopping;
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
    expect(h.timers).toHaveLength(1);
  });

  it("runs on the real clocks and timer when none are given", async () => {
    const watch = startClockWatch({
      backend: { assertRecordableAt: () => {} },
      store: {
        noteAuthority: vi.fn(),
        witnesses: vi.fn(() => []),
        takeNewAuthority: vi.fn(() => []),
        endStop: vi.fn(),
        clear: vi.fn(),
      },
      clock: { now: () => ({ instant: new Date(), offsetMinutes: 0 }) as never },
      nodeId: "node-1",
      read: (fn) => fn(TX),
      transaction: (fn) => fn(TX),
      filesRecords: () => true,
      isPrimary: () => true,
      intervalMs: CLOCK_WATCH_MS,
      log: () => {},
    });
    await expect(watch.stop()).resolves.toBeUndefined();
  });
});
