import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import type { ClockServiceStatus, TimeServiceOnAnswer } from "./box-host-client.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";
import type { ClockStartUp } from "./clock-start-up.js";
import { sharedClockServiceReading } from "./clock-service-reading.js";
import { CLOCK_WATCH_MS, clockWatchJob, createClockWatch } from "./clock-watch.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import { createJobRunner } from "./job-runner.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";
import { standingHold } from "./testing/standing-hold.js";
import { timeServiceRetry } from "./time-service-retry.js";

const TX = { fake: "tx" } as unknown as Transaction;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");
const FIRST_ISSUE_MS = Date.parse("2024-10-28T00:00:00.000Z");

function harness(
  options: {
    startMs?: number;
    startUp?: Pick<ClockStartUp, "open" | "noStop"> | null;
    /** The host's clock service, read through the shared one-minute reading boot uses. */
    host?: () => Promise<ClockServiceStatus>;
    startState?: StartClockState;
    heads?: () => Promise<Record<string, number>>;
    /** Hands the watch the same shared reading to read at every look, as boot does. */
    readTimeService?: boolean;
    /** Hands the start a restart of the time service, as boot does, on a host whose restarts
     * succeed unless `restartAnswer` answers otherwise. */
    restarts?: boolean;
    restartAnswer?: () => Promise<TimeServiceOnAnswer>;
    /** Whether the box files records, asked at each look; it does unless this answers otherwise. */
    filesRecords?: () => boolean;
    /** Hands the start an identity change's opening, as boot does while one waits. */
    attemptIdentityChange?: (state: StartClockState) => Promise<void>;
  } = {},
) {
  let wallMs = options.startMs ?? START_MS;
  let monoMs = 1_000;
  const backend = {
    assertRecordableAt: vi.fn((reading: { instant: Date }) => {
      if (reading.instant.getTime() < FIRST_ISSUE_MS) throw new Error("fiscal.before_first");
    }),
  };
  const startUp =
    options.startUp === null
      ? undefined
      : (options.startUp ?? {
          open: vi.fn(() => true),
          noStop: vi.fn(),
          authorityAsked: vi.fn(),
        });
  const logs: { event: string; fields: unknown }[] = [];
  const store = createClockWitnessStore({ wall: () => wallMs, monotonic: () => monoMs });
  const host = options.host === undefined ? undefined : vi.fn(options.host);
  const reading =
    host === undefined
      ? undefined
      : sharedClockServiceReading({ clockStatus: host }, () => new Date(wallMs));
  const clockStatus = reading === undefined ? undefined : vi.fn(reading.read);
  const clearClockStatus = reading?.clear;
  const readTimeService =
    options.readTimeService === true && reading !== undefined ? vi.fn(reading.read) : undefined;
  let steps = 0;
  let inTurnNow = false;
  let turnsAsked = 0;
  const heldTurns = new Map<number, Promise<void>>();
  const hostReadsInTurn: boolean[] = [];
  host?.mockImplementation(async () => {
    hostReadsInTurn.push(inTurnNow);
    return options.host!();
  });
  const correction = {
    steps: () => steps,
    inTurn: async <T>(fn: () => Promise<T>) => {
      turnsAsked++;
      await heldTurns.get(turnsAsked);
      inTurnNow = true;
      try {
        return await fn();
      } finally {
        inTurnNow = false;
      }
    },
    writePending: vi.fn(async () => {}),
  };
  const startState = options.startState ?? startClockState();
  const restartsInTurn: boolean[] = [];
  const retryTimeService =
    options.restarts === true
      ? timeServiceRetry({
          host: {
            retryTimeService: async () => {
              restartsInTurn.push(inTurnNow);
              return options.restartAnswer?.() ?? { available: true };
            },
          },
          state: startState,
          steps: () => steps,
          monotonic: () => monoMs,
          log: (_level, event, fields) => logs.push({ event, fields }),
        })
      : undefined;
  const heads = vi.fn(options.heads ?? (async () => ({ "node-1": 7 })));
  const attemptsInTurn: boolean[] = [];
  const { attemptIdentityChange } = options;
  const transaction = vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX));
  const watch = createClockWatch({
    backend: backend as unknown as Parameters<typeof createClockWatch>[0]["backend"],
    store,
    clock: { now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as never },
    read: (async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX)) as never,
    log: (_level, event, fields) => logs.push({ event, fields }),
    wall: () => wallMs,
    monotonic: () => monoMs,
    correction,
    ...(startUp === undefined ? {} : { startUp }),
    ...(clockStatus === undefined
      ? {}
      : {
          start: {
            state: startState,
            clockStatus,
            clearClockStatus,
            filesRecords: options.filesRecords ?? (() => true),
            heads,
            ...(retryTimeService === undefined ? {} : { retryTimeService }),
            ...(attemptIdentityChange === undefined
              ? {}
              : {
                  attemptIdentityChange: async () => {
                    attemptsInTurn.push(inTurnNow);
                    await attemptIdentityChange(startState);
                  },
                }),
          },
        }),
    ...(readTimeService === undefined ? {} : { readTimeService }),
  });

  async function tick() {
    monoMs += CLOCK_WATCH_MS;
    wallMs += CLOCK_WATCH_MS;
    await watch.check();
  }

  /** The wall clock moving by `ms` while the steady clock does not, as a set would or not. */
  function jump(ms: number, options: { bySet?: boolean } = {}) {
    wallMs += ms;
    if (options.bySet === true) steps++;
  }

  /** Holds the `nth` turn asked for from now until the answer is called. */
  function holdTurn(nth: number): () => void {
    let release!: () => void;
    heldTurns.set(turnsAsked + nth, new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  /** The steady clock answering NaN from now on, as the boot reader does when a read fails. */
  function breakSteady() {
    monoMs = Number.NaN;
  }

  /** A device's equipment read arriving now, its clock `aheadMs` from the box's. */
  function noteDevice(id: string, address: string, aheadMs: number) {
    store.noteDevice(id, address, wallMs + aheadMs, { wallMs, monoMs });
  }

  return {
    backend,
    startUp,
    logs,
    tick,
    host,
    halt: () => watch.halt(),
    watch,
    attemptsInTurn,
    writePending: correction.writePending,
    hostReadsInTurn,
    restartsInTurn,
    clockStatus,
    readTimeService,
    startState,
    heads,
    transaction,
    noteDevice,
    jump,
    breakSteady,
    holdTurn,
    turnsAsked: () => turnsAsked,
    wall: () => wallMs,
  };
}

const NOT_SYNCHRONISED = clockServiceAnswer(false);
const SYNCHRONISED = clockServiceAnswer(true);

function startLogs(h: { logs: { event: string; fields: unknown }[] }) {
  return h.logs.filter((entry) => entry.event.startsWith("clock_start."));
}

describe("the clock watch and the start check", () => {
  it("reads the time service afresh at each waiting look, starting one host read for each of five looks 15 s apart", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(h.clockStatus).toHaveBeenCalledTimes(4);
    expect(h.host).toHaveBeenCalledTimes(4);
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(5);
    expect(h.startState.status).toBe("waiting");
  });

  it("is confirmed by the internet at the next look once the time service synchronises", async () => {
    let answer = NOT_SYNCHRONISED;
    const h = harness({ host: async () => answer });
    await h.tick();
    expect(h.startState.status).toBe("waiting");
    answer = SYNCHRONISED;
    // 15 s after the first read, well inside the shared reading's minute.
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(2);
    expect(h.startState.status).toBe("by_internet");
    expect(startLogs(h)).toEqual([
      {
        event: "clock_start.confirmed",
        fields: {
          source: "internet",
          boxAt: new Date(h.wall()).toISOString(),
          heads: { "node-1": 7 },
        },
      },
    ]);
  });

  it("leaves the shared reading's minute alone once the start is confirmed", async () => {
    const h = harness({ host: async () => SYNCHRONISED, readTimeService: true });
    await h.tick();
    expect(h.startState.status).toBe("by_internet");
    expect(h.host).toHaveBeenCalledTimes(1);
    for (let look = 0; look < 3; look++) await h.tick();
    expect(h.readTimeService).toHaveBeenCalledTimes(4);
    expect(h.host).toHaveBeenCalledTimes(1);
  });

  it.each(["by_person", "by_devices"] as const)(
    "leaves the shared reading's minute alone once the start is confirmed %s, the time service not synchronised",
    async (by) => {
      const h = harness({ host: async () => NOT_SYNCHRONISED, readTimeService: true });
      if (by === "by_person") h.startState.confirm("by_person", { "node-1": 7 });
      else {
        h.noteDevice("till-1", "10.0.0.2", 3_000);
        h.noteDevice("till-2", "10.0.0.3", 4_000);
      }
      await h.tick();
      expect(h.startState.status).toBe(by);
      expect(h.host).toHaveBeenCalledTimes(1);
      for (let look = 0; look < 3; look++) await h.tick();
      expect(h.clockStatus).toHaveBeenCalledTimes(4);
      expect(h.host).toHaveBeenCalledTimes(1);
      // Sent back to waiting, the next look reads afresh again.
      h.startState.backToWaiting("future_date_refused", "2026-10-31");
      await h.tick();
      expect(h.host).toHaveBeenCalledTimes(2);
      await h.tick();
      expect(h.host).toHaveBeenCalledTimes(3);
    },
  );

  it("reads no chain heads while no devices agree, and is confirmed by two noted between looks, writing no row", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED });
    await h.tick();
    expect(h.startState.status).toBe("waiting");
    expect(h.heads).not.toHaveBeenCalled();
    h.noteDevice("till-1", "10.0.0.2", 3_000);
    h.noteDevice("till-2", "10.0.0.3", 4_000);
    await h.tick();
    expect(h.startState.status).toBe("by_devices");
    expect(h.startState.mark).toEqual({ "node-1": 7 });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(startLogs(h)).toEqual([
      {
        event: "clock_start.confirmed",
        fields: {
          source: "devices",
          devices: ["till-1", "till-2"],
          boxAt: new Date(h.wall()).toISOString(),
          heads: { "node-1": 7 },
        },
      },
    ]);
  });

  it("still runs the rest of the look when the chain heads cannot be read", async () => {
    const h = harness({
      host: async () => NOT_SYNCHRONISED,
      heads: async () => {
        throw new Error("read failed");
      },
    });
    h.noteDevice("till-1", "10.0.0.2", 3_000);
    h.noteDevice("till-2", "10.0.0.3", 4_000);
    await h.tick();
    expect(h.startState.status).toBe("waiting");
    expect(h.logs).toContainEqual({
      event: "clock_watch.check_failed",
      fields: { errorCode: "unknown" },
    });
    expect(h.startUp!.noStop).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for the start check once confirmed by the internet", async () => {
    const startState = startClockState();
    startState.confirm("by_internet", {});
    const h = harness({ host: async () => NOT_SYNCHRONISED, startState });
    h.noteDevice("till-1", "10.0.0.2", 3_000);
    h.noteDevice("till-2", "10.0.0.3", 4_000);
    await h.tick();
    await h.tick();
    expect(h.clockStatus).not.toHaveBeenCalled();
    expect(h.heads).not.toHaveBeenCalled();
    expect(startLogs(h)).toEqual([]);
  });
});

describe("the clock watch restarting the time service while the start waits", () => {
  it("restarts it at most every 30 s while waiting, in the correction's turn", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED, restarts: true });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(h.restartsInTurn).toEqual([true, true]);
  });

  it("restarts nothing once confirmed by the internet", async () => {
    let answer = NOT_SYNCHRONISED;
    const h = harness({ host: async () => answer, restarts: true, readTimeService: true });
    await h.tick();
    expect(h.restartsInTurn).toHaveLength(1);
    answer = SYNCHRONISED;
    await h.tick();
    expect(h.startState.status).toBe("by_internet");
    for (let look = 0; look < 8; look++) await h.tick();
    expect(h.restartsInTurn).toHaveLength(1);
  });

  it("is confirmed by the internet at the look after the host refuses a restart as synchronised, the service having synchronised since that look read it", async () => {
    let answer = NOT_SYNCHRONISED;
    let synchroniseAtNextRestart = false;
    const h = harness({
      host: async () => answer,
      restarts: true,
      restartAnswer: async () => {
        if (!synchroniseAtNextRestart) return { available: true };
        answer = SYNCHRONISED;
        return { available: false, reason: "refused", refusal: "synchronised" };
      },
    });
    for (let look = 0; look < 6; look++) await h.tick();
    expect(h.restartsInTurn).toHaveLength(3);
    synchroniseAtNextRestart = true;
    await h.tick();
    expect(h.restartsInTurn).toHaveLength(4);
    expect(h.logs).toContainEqual({
      event: "time_service.restart_failed",
      fields: { reason: "refused", refusal: "synchronised" },
    });
    expect(h.startState.status).toBe("waiting");
    // 15 s after the look that read it unsynchronised, inside the shared reading's minute.
    await h.tick();
    expect(h.startState.status).toBe("by_internet");
  });

  it("on a box that does not file records, reads the shared minute-long reading and restarts nothing while the start waits, and reads afresh and restarts once it files records", async () => {
    let files = false;
    const h = harness({
      host: async () => NOT_SYNCHRONISED,
      restarts: true,
      readTimeService: true,
      filesRecords: () => files,
    });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(h.startState.status).toBe("waiting");
    expect(h.clockStatus).toHaveBeenCalledTimes(4);
    expect(h.host).toHaveBeenCalledTimes(1);
    expect(h.restartsInTurn).toEqual([]);
    files = true;
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(2);
    expect(h.restartsInTurn).toEqual([true]);
    // 15 s after that read, inside the shared reading's minute.
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(3);
  });

  it("confirms by two agreeing devices without waiting for a restart the host has not answered", async () => {
    let answerRestart: ((answer: TimeServiceOnAnswer) => void) | undefined;
    const h = harness({
      host: async () => NOT_SYNCHRONISED,
      restarts: true,
      restartAnswer: () => new Promise((resolve) => (answerRestart = resolve)),
    });
    h.noteDevice("till-1", "10.0.0.2", 3_000);
    h.noteDevice("till-2", "10.0.0.3", 4_000);
    const look = h.tick();
    await vi.waitFor(() => expect(h.startState.status).toBe("by_devices"), { timeout: 500 });
    answerRestart?.({ available: true });
    await look;
    expect(h.restartsInTurn).toEqual([]);
  });

  it("asks for no restart queued behind another turn once the watch has halted", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED, restarts: true });
    const release = h.holdTurn(2);
    const look = h.tick();
    await vi.waitFor(() => expect(h.turnsAsked()).toBe(2), { timeout: 500 });
    h.halt();
    release();
    await look;
    expect(h.restartsInTurn).toEqual([]);
  });

  it("restarts nothing once the box's clock has been set", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED, restarts: true });
    h.jump(-120_000, { bySet: true });
    for (let look = 0; look < 8; look++) await h.tick();
    expect(h.startState.status).toBe("waiting");
    expect(h.restartsInTurn).toEqual([]);
  });

  it("restarts nothing while confirmed by devices or a person, nor after a person's confirmation when a jump sends the box back to waiting", async () => {
    const byDevices = startClockState();
    byDevices.confirm("by_devices", {});
    const d = harness({
      host: async () => NOT_SYNCHRONISED,
      restarts: true,
      startState: byDevices,
    });
    for (let look = 0; look < 4; look++) await d.tick();
    expect(d.restartsInTurn).toEqual([]);

    const byPerson = startClockState();
    byPerson.confirm("by_person", {});
    const p = harness({ host: async () => NOT_SYNCHRONISED, restarts: true, startState: byPerson });
    await p.tick();
    p.jump(-120_000);
    await p.tick();
    expect(p.startState.status).toBe("waiting");
    for (let look = 0; look < 4; look++) await p.tick();
    expect(p.restartsInTurn).toEqual([]);
  });
});

describe("the clock watch and an identity change's opening", () => {
  function holding(): StartClockState {
    const state = startClockState();
    state.holdForIdentityChange(standingHold());
    return state;
  }

  it("attempts the opening at each look, in the correction's turn, after its look at the time service", async () => {
    const held: boolean[] = [];
    const h = harness({
      host: async () => SYNCHRONISED,
      startState: holding(),
      attemptIdentityChange: async (state) => {
        held.push(state.heldConfirmation !== null);
      },
    });
    await h.tick();
    await h.tick();
    expect(held).toEqual([true, true]);
    expect(h.attemptsInTurn).toEqual([true, true]);
    expect(startLogs(h)).toEqual([]);
  });

  it("logs the start confirmed by the internet once an attempt opens, and attempts no more", async () => {
    let attempts = 0;
    const h = harness({
      host: async () => SYNCHRONISED,
      startState: holding(),
      attemptIdentityChange: async (state) => {
        attempts++;
        if (attempts === 2) state.releaseIdentityChange();
      },
    });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(attempts).toBe(2);
    expect(h.startState.status).toBe("by_internet");
    expect(startLogs(h)).toEqual([
      {
        event: "clock_start.confirmed",
        fields: {
          source: "internet",
          boxAt: new Date(h.wall() - 2 * CLOCK_WATCH_MS).toISOString(),
          heads: { "node-1": 7 },
        },
      },
    ]);
  });

  it("runs no attempt queued behind another turn once the stepdown has stopped the job", async () => {
    const h = harness({
      host: async () => SYNCHRONISED,
      startState: holding(),
      attemptIdentityChange: async () => {},
    });
    const job = clockWatchJob(h.watch, CLOCK_WATCH_MS);
    const stop = new AbortController();
    await job.pass({ signal: stop.signal, now: new Date(h.wall()) });
    expect(h.attemptsInTurn).toHaveLength(1);

    const release = h.holdTurn(1);
    const asked = h.turnsAsked();
    const pass = job.pass({ signal: stop.signal, now: new Date(h.wall()) });
    await vi.waitFor(() => expect(h.turnsAsked()).toBe(asked + 1), { timeout: 500 });
    stop.abort();
    release();
    await pass;
    expect(h.startState.heldConfirmation).not.toBeNull();
    expect(h.attemptsInTurn).toHaveLength(1);
  });
});

describe("the clock watch's job", () => {
  it("looks at once when woken, not only at its interval", async () => {
    const check = vi.fn(async () => {});
    const runner = createJobRunner({
      now: () => new Date(START_MS),
      log: () => {},
      subscribe: () => () => {},
    });
    runner.add(clockWatchJob({ check, halt: () => {}, reanchor: async () => {} }, CLOCK_WATCH_MS));
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(check).not.toHaveBeenCalled();
      for (const looks of [1, 2]) {
        runner.wake("clock.watch");
        await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(looks), { timeout: 2_000 });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      await runner.stopJobs();
    }
  });
});

describe("the clock watch's regular reading of the time service", () => {
  it("reads it at every look once the start is confirmed by the internet, one host read a minute, outside the correction's turn", async () => {
    const startState = startClockState();
    startState.confirm("by_internet", {});
    const h = harness({ host: async () => SYNCHRONISED, startState, readTimeService: true });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(h.readTimeService).toHaveBeenCalledTimes(4);
    expect(h.host).toHaveBeenCalledTimes(1);
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(2);
    expect(h.hostReadsInTurn).toEqual([false, false]);
    // The start check itself still asks nothing.
    expect(h.clockStatus).not.toHaveBeenCalled();
    expect(h.heads).not.toHaveBeenCalled();
  });

  it("does not read it when the watch is halted during the look", async () => {
    const startState = startClockState();
    startState.confirm("by_internet", {});
    const h = harness({ host: async () => SYNCHRONISED, startState, readTimeService: true });
    // The step just before the reading, which the look awaits.
    h.writePending.mockImplementationOnce(async () => h.halt());
    await h.tick();
    expect(h.writePending).toHaveBeenCalledTimes(1);
    expect(h.readTimeService).not.toHaveBeenCalled();
  });

  it("logs a reading that fails rather than failing the look", async () => {
    const startState = startClockState();
    startState.confirm("by_internet", {});
    const h = harness({
      host: async () => {
        throw new Error("host gone");
      },
      startState,
      readTimeService: true,
    });
    await h.tick();
    expect(h.readTimeService).toHaveBeenCalledTimes(1);
    expect(h.logs).toContainEqual({
      event: "clock_watch.check_failed",
      fields: { errorCode: "unknown" },
    });
  });
});

describe("the clock watch and a jump of the box's clock", () => {
  const MINUTE = 60_000;

  function confirmed(by: "by_internet" | "by_devices") {
    const state = startClockState();
    state.confirm(by, { "node-1": 3 });
    return state;
  }

  function jumpLogs(h: { logs: { event: string; fields: unknown }[] }) {
    return h.logs.filter((entry) => entry.event === "clock_watch.jumped");
  }

  it.each([
    ["back", -2 * MINUTE, "by_devices"],
    ["forward", 2 * MINUTE, "by_internet"],
  ] as const)(
    "sends a box whose time service is not synchronised back to waiting when its clock jumps %s",
    async (_name, ms, by) => {
      const h = harness({ host: async () => NOT_SYNCHRONISED, startState: confirmed(by) });
      await h.tick();
      expect(h.startState.status).toBe(by);
      const before = h.wall();
      h.jump(ms);
      await h.tick();
      expect(h.startState).toMatchObject({ status: "waiting", cause: "clock_jumped" });
      expect(jumpLogs(h)).toEqual([
        {
          event: "clock_watch.jumped",
          fields: {
            wallBefore: new Date(before).toISOString(),
            wallAfter: new Date(h.wall()).toISOString(),
            steadyMs: CLOCK_WATCH_MS,
            backToWaiting: true,
          },
        },
      ]);
    },
  );

  it("leaves a box whose time service is synchronised as it was when its clock jumps, saying so in the log", async () => {
    const h = harness({ host: async () => SYNCHRONISED, startState: confirmed("by_internet") });
    await h.tick();
    h.jump(-2 * MINUTE);
    await h.tick();
    expect(h.startState).toMatchObject({ status: "by_internet", cause: null });
    expect(jumpLogs(h)).toHaveLength(1);
    expect(jumpLogs(h)[0]!.fields).toMatchObject({ backToWaiting: false });
  });

  it("does not count a set of the box's clock as a jump", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED, startState: confirmed("by_devices") });
    await h.tick();
    h.jump(-2 * MINUTE, { bySet: true });
    await h.tick();
    expect(h.startState.status).toBe("by_devices");
    expect(jumpLogs(h)).toEqual([]);
    // The control: the same move with no set is a jump.
    h.jump(-2 * MINUTE);
    await h.tick();
    expect(h.startState).toMatchObject({ status: "waiting", cause: "clock_jumped" });
  });

  it("does not count a move of under a minute as a jump", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED, startState: confirmed("by_devices") });
    await h.tick();
    h.jump(-59_000);
    await h.tick();
    h.jump(59_000);
    await h.tick();
    expect(h.startState.status).toBe("by_devices");
    expect(jumpLogs(h)).toEqual([]);
  });

  it("reads the time service afresh after a jump, not the reading taken before it", async () => {
    let answer = SYNCHRONISED;
    const h = harness({ host: async () => answer });
    await h.tick();
    expect(h.startState.status).toBe("by_internet");
    // Confirmed by the internet, the looks read nothing, so the reading ages with the clock.
    for (let look = 0; look < 4; look++) await h.tick();
    answer = NOT_SYNCHRONISED;
    // Back 70 seconds, 75 seconds after the reading: by the box's clock it is 5 seconds old, so
    // the shared reading's minute would still serve the synchronised answer.
    h.jump(-70_000);
    await h.tick();
    expect(h.startState).toMatchObject({ status: "waiting", cause: "clock_jumped" });
    expect(h.host).toHaveBeenCalledTimes(2);
  });

  it("does not count a move as a jump when the steady clock cannot be read", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED, startState: confirmed("by_devices") });
    await h.tick();
    h.breakSteady();
    h.jump(2 * MINUTE);
    await h.tick();
    expect(h.startState.status).toBe("by_devices");
    expect(jumpLogs(h)).toEqual([]);
  });

  it("reads the time service afresh at the look after a jump, so a box whose service synchronises just after it is confirmed then", async () => {
    let answer = NOT_SYNCHRONISED;
    const h = harness({ host: async () => answer, startState: confirmed("by_internet") });
    await h.tick();
    h.jump(2 * MINUTE);
    await h.tick();
    expect(h.startState).toMatchObject({ status: "waiting", cause: "clock_jumped" });
    expect(h.host).toHaveBeenCalledTimes(1);
    answer = SYNCHRONISED;
    await h.tick();
    expect(h.startState.status).toBe("by_internet");
    expect(h.host).toHaveBeenCalledTimes(2);
    // Back to waiting, every look reads afresh, inside the shared reading's minute.
    h.startState.backToWaiting("clock_jumped");
    answer = NOT_SYNCHRONISED;
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(3);
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(4);
    expect(h.startState.status).toBe("waiting");
    answer = SYNCHRONISED;
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(5);
    expect(h.startState.status).toBe("by_internet");
    // Once confirmed, the start check asks nothing more.
    const asked = h.clockStatus!.mock.calls.length;
    await h.tick();
    await h.tick();
    expect(h.clockStatus).toHaveBeenCalledTimes(asked);
    expect(h.host).toHaveBeenCalledTimes(5);
  });
});
