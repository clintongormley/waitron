import { describe, expect, it, vi } from "vitest";
import type {
  AuthorityTimeSample,
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
  restart: null,
  offer: "none" as ClockStopState["offer"],
  proof: { authority: null, devices: [] },
  contrary: { authority: null, devices: [] },
};

function harness(
  options: {
    stop?: ClockStopState | null;
    files?: boolean;
    primary?: boolean;
    newAuthority?: ClockWitness[][];
    note?: (tx: Transaction, input: ClockProvedWrong) => Promise<unknown>;
    seat?: "full" | "empty";
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
    noteClockProvedWrong: vi.fn(
      options.note ??
        (async () => ({ recorded: [] as string[], unused: [] as string[], held: [] as string[] })),
    ),
  };
  const store = {
    noteAuthority: vi.fn(),
    witnesses: vi.fn((): ClockWitness[] => []),
    takeNewAuthority: vi.fn((): ClockWitness[] => queued.shift() ?? []),
    endStop: vi.fn(),
  };
  const read = vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX));
  const transaction = vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX));
  const files = { current: options.files ?? true };
  const primary = { current: options.primary ?? true };
  const watch = startClockWatch({
    backend:
      options.seat === "empty"
        ? {}
        : (backend as unknown as Parameters<typeof startClockWatch>[0]["backend"]),
    store,
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 120 }) as never,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
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
  it("arms its first check a minute after start", () => {
    const h = harness();
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(60_000);
    expect(h.backend.readAuthorityTime).not.toHaveBeenCalled();
  });

  it("reads AEAT's time once a tick during a stop on a filing primary, and notes the sample", async () => {
    const h = harness();
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
    expect(h.store.noteAuthority).toHaveBeenCalledExactlyOnceWith(h.sample);
    expect(h.backend.clockStopState).toHaveBeenCalledWith(
      TX,
      { instant: new Date(h.wall()), offsetMinutes: 120 },
      [],
    );
    expect(h.store.endStop).not.toHaveBeenCalled();
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(2);
  });

  it("still reads AEAT's time while a restart is in force, the raw comparison still behind", async () => {
    const h = harness({
      stop: {
        ...STOPPED,
        restart: {
          personId: "p",
          restartedAt: "2026-07-20T18:00:00.000Z",
          clockAt: "2026-07-20T18:00:00.000Z",
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

  it("runs on the real clocks and timer when none are given", async () => {
    const watch = startClockWatch({
      backend: {},
      store: {
        noteAuthority: vi.fn(),
        witnesses: vi.fn(() => []),
        takeNewAuthority: vi.fn(() => []),
        endStop: vi.fn(),
      },
      clock: { now: () => ({ instant: new Date(), offsetMinutes: 0 }) as never },
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
