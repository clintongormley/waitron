import { describe, expect, it, vi } from "vitest";
import type { AuthorityTimeSample, ClockConfirmation, ClockStopState } from "@waitron/fiscal";
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

function harness(
  options: {
    stop?: ClockStopState | null;
    startMs?: number;
    startUp?: Pick<ClockStartUp, "open" | "noStop"> | null;
    sample?: AuthorityTimeSample | null;
    /** The host's clock service, read through the shared one-minute reading boot uses. */
    host?: () => Promise<ClockServiceStatus>;
    startState?: StartClockState;
    heads?: () => Promise<Record<string, number>>;
  } = {},
) {
  let wallMs = options.startMs ?? START_MS;
  let monoMs = 1_000;
  const state = { stop: options.stop === undefined ? STOPPED : options.stop };
  const sample: AuthorityTimeSample | null =
    options.sample === undefined
      ? { authorityMs: wallMs, uncertaintyMs: 100, at: { wallMs, monoMs } }
      : options.sample;
  const backend = {
    clockStopState: vi.fn(async () => state.stop),
    readAuthorityTime: vi.fn(async () => sample),
    assertRecordableAt: vi.fn((reading: { instant: Date }) => {
      if (reading.instant.getTime() < FIRST_ISSUE_MS) throw new Error("fiscal.before_first");
    }),
    noteClockProvedWrong: vi.fn(async () => ({ recorded: [], unused: [], held: [] })),
    openClockCheck: vi.fn(async () => ({ id: "check-1" })),
    confirmClockStop: vi.fn(async (): Promise<{ confirmation: ClockConfirmation | null }> => ({
      confirmation: {
        id: "confirmation-1",
        seq: 1,
        source: state.stop?.agreeing.authority === null ? "devices" : "authority",
        personId: null,
        confirmedAt: "2026-10-31T10:00:15.000Z",
        checkId: "check-1",
        recordId: "record-1",
      },
    })),
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
  const startState = options.startState ?? startClockState();
  const heads = vi.fn(options.heads ?? (async () => ({ "node-1": 7 })));
  const transaction = vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX));
  const watch = createClockWatch({
    backend: backend as unknown as Parameters<typeof createClockWatch>[0]["backend"],
    store,
    clock: { now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as never },
    read: (async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX)) as never,
    log: (_level, event, fields) => logs.push({ event, fields }),
    ...(startUp === undefined ? {} : { startUp }),
    ...(clockStatus === undefined ? {} : { start: { state: startState, clockStatus, heads } }),
  });

  async function tick() {
    monoMs += CLOCK_WATCH_MS;
    wallMs += CLOCK_WATCH_MS;
    await watch.check();
  }

  /** A device's equipment read arriving now, its clock `aheadMs` from the box's. */
  function noteDevice(id: string, address: string, aheadMs: number) {
    store.noteDevice(id, address, wallMs + aheadMs, { wallMs, monoMs });
  }

  return {
    backend,
    state,
    startUp,
    logs,
    tick,
    host,
    clockStatus,
    startState,
    heads,
    transaction,
    noteDevice,
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
    const h = harness({ stop: null, host: async () => NOT_SYNCHRONISED });
    for (let look = 0; look < 4; look++) await h.tick();
    expect(h.clockStatus).toHaveBeenCalledTimes(4);
    expect(h.host).toHaveBeenCalledTimes(1);
    await h.tick();
    expect(h.host).toHaveBeenCalledTimes(2);
    expect(h.startState.status).toBe("waiting");
  });

  it("is confirmed by the internet at the next look once the time service synchronises", async () => {
    let answer = NOT_SYNCHRONISED;
    const h = harness({ stop: null, host: async () => answer });
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
    const h = harness({ stop: null, host: async () => NOT_SYNCHRONISED });
    await h.tick();
    expect(h.startState.status).toBe("waiting");
    expect(h.heads).not.toHaveBeenCalled();
    h.noteDevice("till-1", "10.0.0.2", 3_000);
    h.noteDevice("till-2", "10.0.0.3", 4_000);
    await h.tick();
    expect(h.startState.status).toBe("by_devices");
    expect(h.startState.mark).toEqual({ "node-1": 7 });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.backend.confirmClockStop).not.toHaveBeenCalled();
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
      stop: null,
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
    const h = harness({ stop: null, host: async () => NOT_SYNCHRONISED, startState });
    h.noteDevice("till-1", "10.0.0.2", 3_000);
    h.noteDevice("till-2", "10.0.0.3", 4_000);
    await h.tick();
    await h.tick();
    expect(h.clockStatus).not.toHaveBeenCalled();
    expect(h.heads).not.toHaveBeenCalled();
    expect(startLogs(h)).toEqual([]);
  });
});
