import { describe, expect, it } from "vitest";
import { clockUnconfirmedAlertSource, startClockWaiting } from "./clock-unconfirmed-alert.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import { startClockState } from "./start-clock-check.js";

const BOX_MS = Date.parse("2026-11-13T10:00:00.000Z");

function oneDeviceAgreeing() {
  const store = createClockWitnessStore({ wall: () => BOX_MS + 1_000, monotonic: () => 1_000 });
  store.noteDevice("till-a", "192.168.10.31", BOX_MS + 2_000, { wallMs: BOX_MS, monoMs: 0 });
  return store;
}

async function read(waiting: ReturnType<typeof startClockWaiting>) {
  return clockUnconfirmedAlertSource(() => waiting).read({
    tx: {} as never,
    now: new Date(BOX_MS),
  });
}

describe("clock.unconfirmed", () => {
  it("is a box alert for whoever manages the system", () => {
    const source = clockUnconfirmedAlertSource(() => null);
    expect(source.area).toBe("box");
    expect(source.permission).toBe("system.manage");
  });

  it("is raised while the start waits, counting the one device that agrees", async () => {
    const state = startClockState();
    const waiting = startClockWaiting({
      state,
      filesRecords: () => true,
      witnesses: oneDeviceAgreeing(),
    });
    expect(waiting).toEqual({ agreed: 1, hostAnswers: true });
    expect(await read(waiting)).toEqual([
      {
        key: "clock.unconfirmed",
        code: "clock.unconfirmed",
        severity: "error",
        since: null,
        screen: "box-status",
        params: { agreed: 1, hostSilent: false },
      },
    ]);
  });

  it("says when the box's clock service does not answer", async () => {
    const state = startClockState();
    state.noteHost(false);
    const waiting = startClockWaiting({
      state,
      filesRecords: () => true,
      witnesses: createClockWitnessStore({ wall: () => BOX_MS, monotonic: () => 0 }),
    });
    expect(waiting).toEqual({ agreed: 0, hostAnswers: false });
    expect((await read(waiting))[0]?.params).toEqual({ agreed: 0, hostSilent: true });
  });

  it("is not raised once the start is confirmed", async () => {
    const state = startClockState();
    state.confirm("by_person", {});
    const waiting = startClockWaiting({
      state,
      filesRecords: () => true,
      witnesses: oneDeviceAgreeing(),
    });
    expect(waiting).toBeNull();
    expect(await read(waiting)).toEqual([]);
  });

  it("is not raised on a box that files no records", () => {
    expect(
      startClockWaiting({
        state: startClockState(),
        filesRecords: () => false,
        witnesses: oneDeviceAgreeing(),
      }),
    ).toBeNull();
  });
});
