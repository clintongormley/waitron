import { describe, expect, it, vi } from "vitest";
import type { ClockServiceStatus } from "./box-host-client.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import {
  backToWaitingForRefusal,
  backToWaitingUnlessSynchronised,
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

  it("is by the internet when synchronised whatever the service reports, as the host refuses a set", async () => {
    for (const service of ["off", "stopped"] as const) {
      const l = look(async () => ({ ...clockServiceAnswer(true), service }));
      await expect(startClockCheck(l.deps)).resolves.toBe("by_internet");
    }
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

  it("keeps by the internet whatever confirms it", async () => {
    const l = look(async () => clockServiceAnswer(true));
    await startClockCheck(l.deps);
    for (const by of ["by_devices", "by_person", "by_internet"] as const) {
      l.state.confirm(by, { "node-a": 99 });
      expect(l.state.status).toBe("by_internet");
    }
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

describe("counting the waits that begin", () => {
  it("counts the start's wait, and each move back to waiting from a confirmed time, not a repeat while waiting", () => {
    const state = startClockState();
    expect(state.waitsBegun()).toBe(1);
    state.backToWaiting("clock_jumped");
    expect(state.waitsBegun()).toBe(1);
    state.confirm("by_person", HEADS);
    expect(state.waitsBegun()).toBe(1);
    state.backToWaiting("future_date_refused", "2027-03-15");
    expect(state.waitsBegun()).toBe(2);
    state.confirm("by_devices", HEADS);
    state.backToWaiting("start");
    expect(state.waitsBegun()).toBe(3);
  });
});

describe("remembering a person's confirmation", () => {
  it("remembers it for the process, through a return to waiting, and never for devices or the internet", () => {
    const state = startClockState();
    expect(state.confirmedByPerson).toBe(false);
    state.confirm("by_devices", { "node-a": 1 });
    state.backToWaiting("clock_jumped");
    expect(state.confirmedByPerson).toBe(false);
    state.confirm("by_person", { "node-a": 2 });
    state.backToWaiting("clock_jumped");
    state.confirm("by_devices", { "node-a": 3 });
    state.backToWaiting("future_date_refused");
    expect(state.confirmedByPerson).toBe(true);
  });
});

describe("waiting because AEAT refused a sale as dated in the future", () => {
  it("keeps that cause and the refused sale's date when sent back to waiting for a jump, and clears the date on confirmation", () => {
    const state = startClockState();
    state.confirm("by_person", { "node-a": 4 });
    state.backToWaiting("future_date_refused", "2027-03-15");
    state.backToWaiting("clock_jumped");
    expect(state).toMatchObject({
      status: "waiting",
      cause: "future_date_refused",
      refusedOn: "2027-03-15",
    });
    state.confirm("by_person", { "node-a": 6 });
    expect(state).toMatchObject({ status: "by_person", cause: null, refusedOn: null });
  });

  it("stays confirmed when a person confirms while the time service is read", async () => {
    const state = startClockState();
    state.confirm("by_person", { "node-a": 4 });
    const clockStatus = vi.fn(async () => {
      state.confirm("by_person", { "node-a": 6 });
      return clockServiceAnswer(false);
    });
    await expect(
      backToWaitingForRefusal({ state, clockStatus }, "node-a", {
        position: 5,
        issuedOn: "2027-03-15",
      }),
    ).resolves.toBe("unchanged");
    expect(state.status).toBe("by_person");
  });

  it.each([
    [
      "throws",
      async (): Promise<ClockServiceStatus> => {
        throw new Error("socket gone");
      },
    ],
    [
      "answers unavailable",
      async (): Promise<ClockServiceStatus> => ({ available: false, reason: "timeout" }),
    ],
  ])(
    "notes that the host does not answer when it %s as a box confirmed by the internet goes back to waiting",
    async (_name, failing) => {
      const l = look(async () => clockServiceAnswer(true));
      await startClockCheck(l.deps);
      expect(l.state).toMatchObject({ status: "by_internet", hostAnswers: true });
      await expect(
        backToWaitingForRefusal({ state: l.state, clockStatus: failing }, "node-a", {
          position: 8,
          issuedOn: "2027-03-15",
        }),
      ).resolves.toBe("moved");
      expect(l.state).toMatchObject({
        status: "waiting",
        cause: "future_date_refused",
        hostAnswers: false,
      });
    },
  );

  it("notes that the host answers again when it answers unsynchronised", async () => {
    const state = startClockState();
    state.confirm("by_person", { "node-a": 4 });
    state.noteHost(false);
    await expect(
      backToWaitingForRefusal(
        { state, clockStatus: async () => clockServiceAnswer(false) },
        "node-a",
        { position: 5, issuedOn: "2027-03-15" },
      ),
    ).resolves.toBe("moved");
    expect(state).toMatchObject({ status: "waiting", hostAnswers: true });
  });
});

describe("going back to waiting unless the time service is synchronised", () => {
  it("sends a box confirmed by the internet back to waiting with the cause it is given, leaving the mark", async () => {
    const state = startClockState();
    state.confirm("by_internet", HEADS);
    const clockStatus = vi.fn(async () => clockServiceAnswer(false));
    await expect(
      backToWaitingUnlessSynchronised({ state, clockStatus }, "clock_jumped"),
    ).resolves.toBe(true);
    expect(state).toMatchObject({ status: "waiting", cause: "clock_jumped", mark: HEADS });
    expect(state.unconfirmed()).toBe(true);
    expect(clockStatus).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "throws",
      async (): Promise<ClockServiceStatus> => {
        throw new Error("socket gone");
      },
    ],
    [
      "answers unavailable",
      async (): Promise<ClockServiceStatus> => ({ available: false, reason: "timeout" }),
    ],
  ])(
    "notes that the host does not answer when it %s, and that it answers again once it does",
    async (_name, failing) => {
      const l = look(async () => clockServiceAnswer(true));
      await startClockCheck(l.deps);
      expect(l.state).toMatchObject({ status: "by_internet", hostAnswers: true });
      await expect(
        backToWaitingUnlessSynchronised({ state: l.state, clockStatus: failing }, "clock_jumped"),
      ).resolves.toBe(true);
      expect(l.state).toMatchObject({
        status: "waiting",
        cause: "clock_jumped",
        hostAnswers: false,
      });
      await backToWaitingUnlessSynchronised(
        { state: l.state, clockStatus: async () => clockServiceAnswer(false) },
        "clock_jumped",
      );
      expect(l.state.hostAnswers).toBe(true);
    },
  );
});

it("shows the waiting notice a count of at most 1, so never 2 of 2 while the box still waits", () => {
  expect(startClockAgreed(witnesses())).toBe(0);
  expect(startClockAgreed(witnesses(["192.168.10.20", 3_000]))).toBe(1);
  expect(startClockAgreed(witnesses(["192.168.10.20", 3_000], ["192.168.10.21", 4_000]))).toBe(1);
});

it("tells its listener each time a wait ends by a confirmation, and at no other change", async () => {
  const onConfirmed = vi.fn();
  const state = startClockState(onConfirmed);
  state.confirm("by_person", {});
  state.confirm("by_person", {});
  expect(onConfirmed).toHaveBeenCalledTimes(1);

  state.backToWaiting("clock_jumped");
  expect(onConfirmed).toHaveBeenCalledTimes(1);
  await state.confirmDevices(
    witnesses(["192.168.10.20", 1_000], ["192.168.10.21", 2_000]),
    async () => ({}),
  );
  expect(onConfirmed).toHaveBeenCalledTimes(2);
});
