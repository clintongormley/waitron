import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import type { ClockServiceStatus } from "./box-host-client.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";
import type { ClockStartUp } from "./clock-start-up.js";
import { sharedClockServiceReading } from "./clock-service-reading.js";
import { CLOCK_WATCH_MS, createClockWatch } from "./clock-watch.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";

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
  const clearClockStatus = reading === undefined ? undefined : vi.fn(reading.clear);
  let steps = 0;
  let countSteps = () => steps;
  const correction = {
    steps: () => countSteps(),
    inTurn: <T>(fn: () => Promise<T>) => fn(),
    writePending: vi.fn(async () => {}),
  };
  const startState = options.startState ?? startClockState();
  const heads = vi.fn(options.heads ?? (async () => ({ "node-1": 7 })));
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
      : { start: { state: startState, clockStatus, clearClockStatus, heads } }),
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

  function failStepCount() {
    countSteps = () => {
      throw new Error("count failed");
    };
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
    clockStatus,
    startState,
    heads,
    transaction,
    noteDevice,
    jump,
    failStepCount,
    writePending: correction.writePending,
    clearClockStatus,
    wall: () => wallMs,
  };
}

const NOT_SYNCHRONISED = clockServiceAnswer(false);
const SYNCHRONISED = clockServiceAnswer(true);

function startLogs(h: { logs: { event: string; fields: unknown }[] }) {
  return h.logs.filter((entry) => entry.event.startsWith("clock_start."));
}

describe("the clock watch and the start check", () => {
  it("reads the time service at each waiting look, starting one host read for four looks 15 s apart and a second a minute after the first", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(h.clockStatus).toHaveBeenCalledTimes(4);
    expect(h.host).toHaveBeenCalledTimes(1);
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(2);
    expect(h.startState.status).toBe("waiting");
  });

  it("is confirmed by the internet at the next look once the time service synchronises", async () => {
    let answer = NOT_SYNCHRONISED;
    const h = harness({ host: async () => answer });
    await h.tick();
    expect(h.startState.status).toBe("waiting");
    answer = SYNCHRONISED;
    // Past the shared reading's minute, so the host is read again.
    for (let look = 0; look < 4; look++) await h.tick();
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

  it.each([
    ["back", -2 * MINUTE, "by_internet"],
    ["forward", 2 * MINUTE, "by_devices"],
  ] as const)(
    "leaves a box whose time service is synchronised as it was when its clock jumps %s, saying so in the log",
    async (_name, ms, by) => {
      const h = harness({ host: async () => SYNCHRONISED, startState: confirmed(by) });
      // by_devices moves to by_internet at the first look once the time service is synchronised.
      await h.tick();
      const status = h.startState.status;
      h.jump(ms);
      await h.tick();
      expect(h.startState.status).toBe(status);
      expect(h.startState.cause).toBeNull();
      expect(jumpLogs(h)).toHaveLength(1);
      expect(jumpLogs(h)[0]!.fields).toMatchObject({ backToWaiting: false });
    },
  );

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

  it("logs a jump on a box with no start check, sending nothing back to waiting", async () => {
    const h = harness();
    await h.tick();
    h.jump(2 * MINUTE);
    await h.tick();
    expect(jumpLogs(h)).toHaveLength(1);
    expect(jumpLogs(h)[0]!.fields).toMatchObject({ backToWaiting: null });
  });

  it("still runs the rest of the look when the jump cannot be checked", async () => {
    const h = harness({ host: async () => NOT_SYNCHRONISED });
    h.failStepCount();
    await h.tick();
    expect(h.logs).toContainEqual({
      event: "clock_watch.check_failed",
      fields: { errorCode: "unknown" },
    });
    expect(h.writePending).toHaveBeenCalledOnce();
  });

  it("reads the time service afresh after a jump, not the reading taken before it", async () => {
    let answer = SYNCHRONISED;
    const h = harness({ host: async () => answer });
    await h.tick();
    expect(h.startState.status).toBe("by_internet");
    answer = NOT_SYNCHRONISED;
    // Back, so the shared reading's minute would still serve the synchronised answer.
    h.jump(-2 * MINUTE);
    await h.tick();
    expect(h.clearClockStatus).toHaveBeenCalledOnce();
    expect(h.startState).toMatchObject({ status: "waiting", cause: "clock_jumped" });
  });
});
