import { describe, expect, it, vi } from "vitest";
import type { ClockServiceStatus } from "./box-host-client.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import {
  backToWaitingForRefusal,
  backToWaitingUnlessSynchronised,
  confirmByPerson,
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

describe("holding a confirmation for a new fiscal installation", () => {
  const LATER: ChainHeads = { "node-a": 9 };
  const agreeing = () => witnesses(["10.0.0.5", 1_000], ["10.0.0.6", 2_000]);

  it("ends the wait at the internet's confirmation with the hold off, and keeps waiting with it on", () => {
    const onConfirmed = vi.fn();
    const free = startClockState(onConfirmed);
    expect(free.confirm("by_internet", HEADS)).toBe(true);
    expect(free).toMatchObject({ status: "by_internet", cause: null, heldConfirmation: null });
    expect(onConfirmed).toHaveBeenCalledOnce();

    onConfirmed.mockClear();
    const held = startClockState(onConfirmed);
    expect(held.cause).toBe("start");
    held.holdForIdentityChange();
    expect(held.confirm("by_internet", HEADS)).toBe(false);
    expect(held).toMatchObject({
      status: "waiting",
      cause: "identity_change",
      mark: null,
      heldConfirmation: { by: "by_internet", heads: HEADS },
    });
    expect(held.unconfirmed()).toBe(true);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("holds a synchronised time service's answer at each look, and the start's look answers waiting", async () => {
    const l = look(async () => clockServiceAnswer(true));
    l.state.holdForIdentityChange();
    await expect(startClockCheck(l.deps)).resolves.toBe("waiting");
    await lookAtClockService(l.deps);
    expect(l.clockStatus).toHaveBeenCalledTimes(2);
    expect(l.state.heldConfirmation).toEqual({ by: "by_internet", heads: HEADS });
  });

  it.each(["by_person", "by_devices"] as const)(
    "takes nothing from a confirmation %s, and leaves one held for the internet",
    (by) => {
      const state = startClockState();
      state.holdForIdentityChange();
      expect(state.confirm(by, LATER)).toBe(false);
      expect(state).toMatchObject({
        status: "waiting",
        mark: null,
        heldConfirmation: null,
        confirmedByPerson: false,
      });
      state.confirm("by_internet", HEADS);
      expect(state.confirm(by, LATER)).toBe(false);
      expect(state.heldConfirmation).toEqual({ by: "by_internet", heads: HEADS });
    },
  );

  it("confirms nothing by two agreeing devices, reading no heads, and does once the hold is released", async () => {
    const state = startClockState();
    state.holdForIdentityChange();
    const heads = vi.fn(async () => HEADS);
    expect(await state.confirmDevices(agreeing(), heads)).toEqual([]);
    expect(heads).not.toHaveBeenCalled();
    expect(state.status).toBe("waiting");

    state.releaseIdentityChange();
    expect(await state.confirmDevices(agreeing(), heads)).toHaveLength(2);
    expect(state.status).toBe("by_devices");
  });

  it("confirms nothing by devices when the hold begins while the heads are read", async () => {
    const state = startClockState();
    const heads = async () => {
      state.holdForIdentityChange();
      return HEADS;
    };
    expect(await state.confirmDevices(agreeing(), heads)).toEqual([]);
    expect(state.status).toBe("waiting");
  });

  it.each(["start", "clock_jumped", "future_date_refused"] as const)(
    "drops a held confirmation when sent back to waiting for %s, twice over",
    (cause) => {
      const onConfirmed = vi.fn();
      const state = startClockState(onConfirmed);
      state.holdForIdentityChange();
      for (let time = 0; time < 2; time++) {
        state.confirm("by_internet", HEADS);
        expect(state.heldConfirmation).not.toBeNull();
        state.backToWaiting(cause);
        expect(state).toMatchObject({ cause: "identity_change", heldConfirmation: null });
      }
      state.releaseIdentityChange();
      expect(state).toMatchObject({ status: "waiting", cause });
      expect(onConfirmed).not.toHaveBeenCalled();
    },
  );

  it("drops a held confirmation when told to", () => {
    const state = startClockState();
    state.holdForIdentityChange();
    state.confirm("by_internet", HEADS);
    state.dropHeldConfirmation();
    expect(state.heldConfirmation).toBeNull();
    state.releaseIdentityChange();
    expect(state).toMatchObject({ status: "waiting", cause: "start" });
  });

  it("applies the held confirmation, with the heads it was held with, and tells it once", () => {
    const onConfirmed = vi.fn();
    const state = startClockState(onConfirmed);
    state.holdForIdentityChange();
    state.confirm("by_internet", HEADS);
    state.releaseIdentityChange();
    expect(state).toMatchObject({
      status: "by_internet",
      cause: null,
      mark: HEADS,
      heldConfirmation: null,
    });
    expect(state.unconfirmed()).toBe(false);
    expect(state.waitsBegun()).toBe(1);
    state.releaseIdentityChange();
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it("gives the alert the cause identity_change, with no refused date", () => {
    const state = startClockState();
    state.holdForIdentityChange();
    state.backToWaiting("future_date_refused", "2027-03-15");
    expect(state).toMatchObject({ cause: "identity_change", refusedOn: null });
  });
});

describe("holding a person's confirmation for a new fiscal installation", () => {
  const LATER: ChainHeads = { "node-a": 9 };

  /** A hold that keeps a person's confirmation, vouched for by `clock.stands` as it was then. */
  function holding(onConfirmed = () => {}) {
    const state = startClockState(onConfirmed);
    const clock = { stands: true, readings: 0 };
    const onHeld = vi.fn(() => expect(state.heldConfirmation?.by).toBe("by_person"));
    state.holdForIdentityChange({
      standing: () => {
        clock.readings++;
        return () => clock.stands;
      },
      onHeld,
    });
    const standing = () => {
      const held = state.heldConfirmation;
      if (held?.by !== "by_person") throw new Error("no person's confirmation is held");
      return held.standing;
    };
    return { state, clock, onHeld, standing };
  }

  it("keeps the box waiting and holds it, with the heads and the clock's reading taken then, and tells it once", () => {
    const onConfirmed = vi.fn();
    const h = holding(onConfirmed);
    expect(h.clock.readings).toBe(0);
    const heads = { ...HEADS };
    expect(h.state.confirm("by_person", heads)).toBe(false);
    heads["node-a"] = 99;
    expect(h.state).toMatchObject({
      status: "waiting",
      cause: "identity_change",
      mark: null,
      heldConfirmation: { by: "by_person", heads: HEADS },
    });
    expect(h.clock.readings).toBe(1);
    expect(h.onHeld).toHaveBeenCalledOnce();
    expect(onConfirmed).not.toHaveBeenCalled();
    const standing = h.standing();
    expect(standing()).toBe(true);
    h.clock.stands = false;
    expect(standing()).toBe(false);
    expect(h.clock.readings).toBe(1);
  });

  it("gives way to the internet's at the next look at a synchronised time service, and never takes its place", async () => {
    const h = holding();
    h.state.confirm("by_person", LATER);
    const standing = h.standing();
    const l = look(async () => clockServiceAnswer(true), h.state);
    await lookAtClockService(l.deps);
    expect(h.state.heldConfirmation).toEqual({ by: "by_internet", heads: HEADS });
    expect(standing()).toBe(false);

    expect(h.state.confirm("by_person", LATER)).toBe(false);
    expect(h.state.heldConfirmation).toEqual({ by: "by_internet", heads: HEADS });
    expect(h.onHeld).toHaveBeenCalledOnce();
    expect(h.clock.readings).toBe(1);
  });

  it("stays held at a look at a time service that is not synchronised", async () => {
    const h = holding();
    h.state.confirm("by_person", HEADS);
    await lookAtClockService(look(async () => clockServiceAnswer(false), h.state).deps);
    expect(h.state.heldConfirmation?.by).toBe("by_person");
  });

  it("is replaced by a later person's, which alone stands", () => {
    const h = holding();
    h.state.confirm("by_person", HEADS);
    const earlier = h.standing();
    h.state.confirm("by_person", LATER);
    expect(h.state.heldConfirmation).toMatchObject({ by: "by_person", heads: LATER });
    expect(earlier()).toBe(false);
    expect(h.standing()()).toBe(true);
    expect(h.onHeld).toHaveBeenCalledTimes(2);
  });

  it.each<[string, (state: ReturnType<typeof startClockState>) => void]>([
    ["sent back to waiting", (state) => state.backToWaiting("clock_jumped")],
    ["dropped", (state) => state.dropHeldConfirmation()],
  ])("no longer stands once %s, and a person can confirm again", (_label, drop) => {
    const h = holding();
    h.state.confirm("by_person", HEADS);
    const dropped = h.standing();
    drop(h.state);
    expect(h.state.heldConfirmation).toBeNull();
    expect(dropped()).toBe(false);

    h.state.confirm("by_person", LATER);
    expect(dropped()).toBe(false);
    expect(h.standing()()).toBe(true);
  });

  it("ends the wait by a person once released, with the heads it was held with, and only then counts as confirmed by one", () => {
    const onConfirmed = vi.fn();
    const h = holding(onConfirmed);
    h.state.confirm("by_person", HEADS);
    expect(h.state.confirmedByPerson).toBe(false);
    h.state.releaseIdentityChange();
    expect(h.state).toMatchObject({
      status: "by_person",
      cause: null,
      mark: HEADS,
      heldConfirmation: null,
      confirmedByPerson: true,
    });
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it("holds nothing from devices", async () => {
    const h = holding();
    expect(h.state.confirm("by_devices", HEADS)).toBe(false);
    const agreeing = witnesses(["10.0.0.5", 1_000], ["10.0.0.6", 2_000]);
    expect(await h.state.confirmDevices(agreeing, async () => HEADS)).toEqual([]);
    expect(h.state.heldConfirmation).toBeNull();
    expect(h.onHeld).not.toHaveBeenCalled();
  });

  it("says what a person's confirmation did", () => {
    expect(confirmByPerson(startClockState(), HEADS)).toBe("confirmed");
    const h = holding();
    expect(confirmByPerson(h.state, HEADS)).toBe("held");
    h.state.confirm("by_internet", HEADS);
    expect(confirmByPerson(h.state, HEADS)).toBe("unused");
    h.state.dropHeldConfirmation();
    expect(confirmByPerson(h.state, HEADS)).toBe("held");
  });
});
