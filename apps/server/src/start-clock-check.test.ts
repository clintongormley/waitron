import { describe, expect, it, vi } from "vitest";
import type { ClockServiceStatus } from "./box-host-client.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import {
  lookAtClockService,
  startClockAgreed,
  startClockCheck,
  startClockState,
  type ChainHeads,
} from "./start-clock-check.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";

const BOX_WALL = Date.parse("2027-03-14T10:00:00.000Z");
const BOX_MONO = 50_000;
const DAY_MS = 24 * 60 * 60_000;
const HEADS: ChainHeads = { "node-a": 7 };

function look(answer: () => Promise<ClockServiceStatus>, state = startClockState()) {
  const clockStatus = vi.fn(answer);
  return { state, clockStatus, deps: { state, clockStatus, heads: async () => HEADS } };
}

/** Device readings arriving now, each `[address, clock ahead of the box's in ms]`. */
function witnesses(...devices: [string, number][]) {
  const store = createClockWitnessStore({ wall: () => BOX_WALL, monotonic: () => BOX_MONO });
  devices.forEach(([address, aheadMs], index) =>
    store.noteDevice(`till-${index + 1}`, address, BOX_WALL + aheadMs, {
      wallMs: BOX_WALL,
      monoMs: BOX_MONO,
    }),
  );
  return store.witnesses();
}

describe("the start's look at the time service", () => {
  it("is by the internet when the time service is synchronised, and then asks it nothing", async () => {
    const l = look(async () => clockServiceAnswer(true));
    await expect(startClockCheck(l.deps)).resolves.toBe("by_internet");
    expect(l.state).toMatchObject({ status: "by_internet", hostAnswers: true, mark: HEADS });
    expect(l.state.unconfirmed()).toBe(false);
    await lookAtClockService(l.deps);
    expect(l.clockStatus).toHaveBeenCalledTimes(1);
  });

  it("waits when the time service is not synchronised", async () => {
    const l = look(async () => clockServiceAnswer(false));
    await expect(startClockCheck(l.deps)).resolves.toBe("waiting");
    expect(l.state).toMatchObject({ status: "waiting", cause: "start", hostAnswers: true });
    expect(l.state.mark).toBeNull();
    expect(l.state.unconfirmed()).toBe(true);
  });

  it("waits, saying the host does not answer, when it answers unavailable or throws, until it answers", async () => {
    let answer: () => Promise<ClockServiceStatus> = async () => {
      throw new Error("socket gone");
    };
    const l = look(() => answer());
    await expect(startClockCheck(l.deps)).resolves.toBe("waiting");
    expect(l.state).toMatchObject({ status: "waiting", hostAnswers: false });
    answer = async () => clockServiceAnswer(false);
    await lookAtClockService(l.deps);
    expect(l.state.hostAnswers).toBe(true);
    answer = async () => ({ available: false, reason: "missing" });
    await lookAtClockService(l.deps);
    expect(l.state).toMatchObject({ status: "waiting", hostAnswers: false });
  });
});

describe("devices confirming a waiting start", () => {
  it("confirms by devices with two at two addresses within 5 s, handing back their readings", async () => {
    const state = startClockState();
    const heads = vi.fn(async () => HEADS);
    const readings = await state.confirmDevices(
      witnesses(["10.0.0.5", 3_000], ["10.0.0.6", 4_000]),
      heads,
    );
    expect(readings.map((reading) => reading.id).sort()).toEqual(["till-1", "till-2"]);
    expect(state).toMatchObject({ status: "by_devices", mark: HEADS });
    expect(state.unconfirmed()).toBe(false);
    expect(heads).toHaveBeenCalledOnce();
  });

  it("stays waiting, reading no chain heads, with two devices two days out that agree with each other", async () => {
    const state = startClockState();
    const heads = vi.fn(async () => HEADS);
    const devices = witnesses(["10.0.0.5", 2 * DAY_MS], ["10.0.0.6", 2 * DAY_MS + 1_000]);
    expect(await state.confirmDevices(devices, heads)).toEqual([]);
    expect(state).toMatchObject({ status: "waiting", mark: null });
    expect(heads).not.toHaveBeenCalled();
  });

  it("does not move a box confirmed by a person to by devices", async () => {
    const state = startClockState();
    state.confirm("by_person", HEADS);
    const heads = vi.fn(async () => ({ "node-a": 9 }));
    const devices = witnesses(["10.0.0.5", 0], ["10.0.0.6", 0]);
    expect(await state.confirmDevices(devices, heads)).toEqual([]);
    expect(state).toMatchObject({ status: "by_person", mark: HEADS });
    expect(heads).not.toHaveBeenCalled();
  });

  it("does not confirm by devices when a person confirms while the heads are read", async () => {
    const state = startClockState();
    const devices = witnesses(["10.0.0.5", 0], ["10.0.0.6", 0]);
    const heads = async () => {
      state.confirm("by_person", HEADS);
      return { "node-a": 9 };
    };
    expect(await state.confirmDevices(devices, heads)).toEqual([]);
    expect(state).toMatchObject({ status: "by_person", mark: HEADS });
  });
});

describe("moving between states", () => {
  it.each(["by_devices", "by_person"] as const)(
    "moves %s to by the internet at a look that finds the time service synchronised",
    async (by) => {
      let synchronised = false;
      const l = look(async () => clockServiceAnswer(synchronised));
      await startClockCheck(l.deps);
      l.state.confirm(by, { "node-a": 3 });
      await lookAtClockService(l.deps);
      expect(l.state.status).toBe(by);
      synchronised = true;
      await lookAtClockService(l.deps);
      expect(l.state).toMatchObject({ status: "by_internet", mark: HEADS });
    },
  );

  it("keeps by the internet whatever confirms it or sends it back", async () => {
    const l = look(async () => clockServiceAnswer(true));
    await startClockCheck(l.deps);
    for (const by of ["by_devices", "by_person", "by_internet"] as const) {
      l.state.confirm(by, { "node-a": 99 });
      expect(l.state.status).toBe("by_internet");
    }
    l.state.backToWaiting("future_date_refused");
    expect(l.state).toMatchObject({ status: "by_internet", cause: null, mark: HEADS });
    expect(l.state.unconfirmed()).toBe(false);
  });

  it("sends by a person back to waiting with the cause it is given, leaving the mark", () => {
    const state = startClockState();
    state.confirm("by_person", { "node-a": 4 });
    state.backToWaiting("future_date_refused");
    expect(state).toMatchObject({
      status: "waiting",
      cause: "future_date_refused",
      mark: { "node-a": 4 },
    });
    expect(state.unconfirmed()).toBe(true);
  });
});

it("shows the waiting notice a count of at most 1, so never 2 of 2 while the box still waits", () => {
  expect(startClockAgreed(witnesses())).toBe(0);
  expect(startClockAgreed(witnesses(["192.168.10.20", 3_000]))).toBe(1);
  expect(startClockAgreed(witnesses(["192.168.10.20", 3_000], ["192.168.10.21", 4_000]))).toBe(1);
});
