import { describe, expect, it, vi } from "vitest";
import type {
  AuthorityTimeSample,
  BootReading,
  ClockConfirmation,
  ClockStopState,
  ClockWitness,
} from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { clockStartUp, type ClockStartUp } from "./clock-start-up.js";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";

const TX = { fake: "tx" } as unknown as Transaction;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");
const FIRST_ISSUE_MS = Date.parse("2024-10-28T00:00:00.000Z");
const BOOT: BootReading = { ms: 9_000_000, id: "boot-start-up-test" };

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

function device(id: string, address: string): ClockWitness {
  return {
    kind: "device",
    id,
    address,
    boxAt: "2026-10-31T10:00:00.000Z",
    witnessAt: "2026-10-31T10:00:01.000Z",
    uncertaintyMs: 100,
  };
}

const AUTHORITY: ClockWitness = {
  kind: "authority",
  id: "authority",
  boxAt: "2026-10-31T10:00:00.000Z",
  witnessAt: "2026-10-31T10:00:00.500Z",
  uncertaintyMs: 100,
};

const DEVICES_READY: ClockStopState = {
  ...STOPPED,
  proof: "ready",
  agreeing: {
    authority: null,
    devices: [device("till-1", "10.0.0.2"), device("till-2", "10.0.0.3")],
  },
};

const AUTHORITY_READY: ClockStopState = {
  ...DEVICES_READY,
  agreeing: { ...DEVICES_READY.agreeing, authority: AUTHORITY },
};

function harness(
  options: {
    stop?: ClockStopState | null;
    startMs?: number;
    startUp?: Pick<ClockStartUp, "open" | "noStop" | "authorityAsked"> | null;
    sample?: AuthorityTimeSample | null;
  } = {},
) {
  let wallMs = options.startMs ?? START_MS;
  let monoMs = 1_000;
  const timers: { fn: () => void }[] = [];
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
  startClockWatch({
    backend: backend as unknown as Parameters<typeof startClockWatch>[0]["backend"],
    store: {
      noteAuthority: vi.fn(),
      witnesses: vi.fn(() => []),
      forSetting: vi.fn(() => []),
      takeNewAuthority: vi.fn(() => []),
      endStop: vi.fn(),
      clear: vi.fn(),
    },
    clock: { now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as never },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: { readBoot: () => ({ ...BOOT }), elapsed: () => monoMs },
    nodeId: "node-1",
    read: (async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX)) as never,
    transaction: (async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX)) as never,
    filesRecords: () => true,
    isPrimary: () => true,
    intervalMs: CLOCK_WATCH_MS,
    log: (_level, event, fields) => logs.push({ event, fields }),
    timer: (_ms, fn) => {
      timers.push({ fn });
      return { cancel: () => {} };
    },
    ...(startUp === undefined ? {} : { startUp }),
  });

  async function tick() {
    monoMs += CLOCK_WATCH_MS;
    wallMs += CLOCK_WATCH_MS;
    const count = timers.length;
    timers.at(-1)!.fn();
    await vi.waitFor(() => expect(timers.length).toBe(count + 1));
  }

  return { backend, state, startUp, logs, tick };
}

describe("the clock watch and the start-up window", () => {
  it("closes the window on a look that finds no stop at a recordable reading", async () => {
    const h = harness({ stop: null });
    await h.tick();
    expect(h.startUp!.noStop).toHaveBeenCalledTimes(1);
  });

  it("closes the window on a look whose stop a confirmation covers", async () => {
    const h = harness({ stop: { ...STOPPED, proof: "confirmed" } });
    await h.tick();
    expect(h.startUp!.noStop).toHaveBeenCalledTimes(1);
  });

  it("keeps the window open on a look at a reading no record could carry", async () => {
    const h = harness({ stop: null, startMs: Date.parse("2001-01-01T00:00:00.000Z") });
    await h.tick();
    expect(h.startUp!.noStop).not.toHaveBeenCalled();
  });

  it("keeps the window open on a look during the stop proper", async () => {
    const h = harness();
    await h.tick();
    expect(h.backend.clockStopState).toHaveBeenCalledTimes(1);
    expect(h.startUp!.noStop).not.toHaveBeenCalled();
  });

  it("tells the window AEAT did not answer when its ask answers nothing", async () => {
    const h = harness({ sample: null });
    await h.tick();
    expect(h.backend.readAuthorityTime).toHaveBeenCalledTimes(1);
    expect(h.startUp!.authorityAsked).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("tells the window AEAT answered when its ask answers a sample", async () => {
    const h = harness();
    await h.tick();
    expect(h.startUp!.authorityAsked).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does not confirm on two agreeing devices alone while the window is open", async () => {
    const h = harness({ stop: DEVICES_READY });
    await h.tick();
    expect(h.backend.openClockCheck).toHaveBeenCalledTimes(1);
    expect(h.backend.confirmClockStop).not.toHaveBeenCalled();
  });

  it("confirms while the window is open when AEAT is among the agreeing witnesses", async () => {
    const h = harness({ stop: AUTHORITY_READY });
    await h.tick();
    expect(h.backend.confirmClockStop).toHaveBeenCalledTimes(1);
    expect(h.logs).toContainEqual({
      event: "clock_watch.confirmed",
      fields: { confirmationId: "confirmation-1", source: "authority" },
    });
  });

  it("confirms on two agreeing devices once the window has closed", async () => {
    const h = harness({ stop: null, startUp: clockStartUp({ primaryAtStart: true }) });
    await h.tick();
    h.state.stop = DEVICES_READY;
    await h.tick();
    expect(h.backend.confirmClockStop).toHaveBeenCalledTimes(1);
    expect(h.logs).toContainEqual({
      event: "clock_watch.confirmed",
      fields: { confirmationId: "confirmation-1", source: "devices" },
    });
  });

  it("confirms on two agreeing devices with no window, as before", async () => {
    const h = harness({ stop: DEVICES_READY, startUp: null });
    await h.tick();
    expect(h.backend.confirmClockStop).toHaveBeenCalledTimes(1);
    expect(h.logs).toContainEqual({
      event: "clock_watch.confirmed",
      fields: { confirmationId: "confirmation-1", source: "devices" },
    });
  });
});
