import { describe, expect, it, vi } from "vitest";
import type { ClockStopState, ClockWitness } from "@waitron/fiscal";
import type { Transaction } from "@waitron/db";
import { clockStartUp, tillClockCheck } from "./clock-start-up.js";

const TX = { fake: "tx" } as unknown as Transaction;
const NOW = { instant: new Date("2026-10-31T10:00:00.000Z"), offsetMinutes: 60 };
const IN_2001 = { instant: new Date("2001-01-01T00:00:00.000Z"), offsetMinutes: 60 };
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

const STOP = { stopped: true, unusable: false, canAskAuthority: true };

describe("clockStartUp", () => {
  it("is open on the primary at its start, and asks AEAT before the till is offered", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    expect(startUp.open()).toBe(true);
    expect(startUp.tillMayOffer(STOP)).toBe(false);
    expect(startUp.admit({ unusable: false, canAskAuthority: true })).toBe("authority_pending");
  });

  it("offers the till once AEAT did not answer", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    startUp.authorityAsked(false);
    expect(startUp.tillMayOffer(STOP)).toBe(true);
    expect(startUp.admit({ unusable: false, canAskAuthority: true })).toBeNull();
  });

  it("keeps AEAT's answer for the rest of the window, offering nothing and admitting a request", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    startUp.authorityAsked(true);
    startUp.authorityAsked(false);
    expect(startUp.tillMayOffer(STOP)).toBe(false);
    expect(startUp.admit({ unusable: false, canAskAuthority: true })).toBeNull();
  });

  it("offers the till before any ask at a reading no record could carry", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    expect(startUp.tillMayOffer({ stopped: false, unusable: true, canAskAuthority: true })).toBe(
      true,
    );
    expect(startUp.admit({ unusable: true, canAskAuthority: true })).toBeNull();
  });

  it("offers the till before any ask when the box cannot ask AEAT", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    expect(startUp.tillMayOffer({ ...STOP, canAskAuthority: false })).toBe(true);
    expect(startUp.admit({ unusable: false, canAskAuthority: false })).toBeNull();
  });

  it("offers nothing while no stop holds", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    startUp.authorityAsked(false);
    expect(startUp.tillMayOffer({ ...STOP, stopped: false })).toBe(false);
  });

  it("closes for good once a reader sees no stop holding", () => {
    const startUp = clockStartUp({ primaryAtStart: true });
    startUp.authorityAsked(false);
    startUp.noStop();
    expect(startUp.open()).toBe(false);
    expect(startUp.tillMayOffer(STOP)).toBe(false);
    expect(startUp.tillMayOffer({ stopped: false, unusable: true, canAskAuthority: false })).toBe(
      false,
    );
    expect(startUp.admit({ unusable: false, canAskAuthority: true })).toBe("not_start_up");
    startUp.authorityAsked(false);
    expect(startUp.open()).toBe(false);
    expect(startUp.admit({ unusable: true, canAskAuthority: false })).toBe("not_start_up");
  });

  it("is closed from the start on a node that is not the primary at its start", () => {
    const startUp = clockStartUp({ primaryAtStart: false });
    expect(startUp.open()).toBe(false);
    expect(startUp.tillMayOffer({ stopped: false, unusable: true, canAskAuthority: false })).toBe(
      false,
    );
    expect(startUp.admit({ unusable: false, canAskAuthority: true })).toBe("not_start_up");
  });
});

describe("tillClockCheck", () => {
  function check(state: ClockStopState | null, options: { files?: boolean } = {}) {
    const startUp = clockStartUp({ primaryAtStart: true });
    const witnesses: ClockWitness[] = [];
    const backend = {
      assertRecordableAt: vi.fn((reading: { instant: Date }) => {
        if (reading.instant.getTime() < FIRST_ISSUE_MS) throw new Error("fiscal.before_first");
      }),
      clockStopState: vi.fn(async () => state),
      readAuthorityTime: vi.fn(async () => null),
    };
    const clockCheck = tillClockCheck({
      startUp,
      backend,
      witnesses: () => witnesses,
      filesRecords: () => options.files ?? true,
    });
    return { startUp, backend, clockCheck, witnesses };
  }

  it("answers false and closes the window when its read sees no stop at a recordable reading", async () => {
    const h = check(null);
    expect(await h.clockCheck(TX, NOW)).toBe(false);
    expect(h.startUp.open()).toBe(false);
  });

  it("answers false and closes the window when a confirmation covers the stop", async () => {
    const h = check({ ...STOPPED, proof: "confirmed" });
    expect(await h.clockCheck(TX, NOW)).toBe(false);
    expect(h.startUp.open()).toBe(false);
  });

  it("keeps the window open during the stop proper, offering once AEAT did not answer", async () => {
    const h = check(STOPPED);
    expect(await h.clockCheck(TX, NOW)).toBe(false);
    expect(h.startUp.open()).toBe(true);
    h.startUp.authorityAsked(false);
    expect(await h.clockCheck(TX, NOW)).toBe(true);
    expect(h.backend.clockStopState).toHaveBeenLastCalledWith(TX, NOW, h.witnesses);
  });

  it("offers the till during the stop proper when the box files no records", async () => {
    const h = check(STOPPED, { files: false });
    expect(await h.clockCheck(TX, NOW)).toBe(true);
  });

  it("keeps the window open and offers the till at a reading no record could carry", async () => {
    const h = check(null);
    expect(await h.clockCheck(TX, IN_2001)).toBe(true);
    expect(h.startUp.open()).toBe(true);
  });

  it("reads no stop once the window has closed", async () => {
    const h = check(STOPPED);
    h.startUp.noStop();
    expect(await h.clockCheck(TX, NOW)).toBe(false);
    expect(h.backend.clockStopState).not.toHaveBeenCalled();
  });
});
