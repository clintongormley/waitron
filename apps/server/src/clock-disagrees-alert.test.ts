import { describe, expect, it } from "vitest";
import { clockDisagreesAlertSource } from "./clock-disagrees-alert.js";
import { createClockWitnessStore } from "./clock-witnesses.js";

const BOX_MS = Date.parse("2026-10-23T10:00:00.000Z");
const HOUR_MS = 3_600_000;

function storeAt(wallMs: number, monoMs: number) {
  return createClockWitnessStore({ wall: () => wallMs, monotonic: () => monoMs });
}

async function readAlerts(
  store: ReturnType<typeof createClockWitnessStore>,
  now: Date,
): Promise<readonly unknown[]> {
  return clockDisagreesAlertSource(store).read({ tx: {} as never, now });
}

describe("clock.disagrees", () => {
  it("is a box alert for whoever manages the system", () => {
    const source = clockDisagreesAlertSource(storeAt(BOX_MS, 0));
    expect(source.area).toBe("box");
    expect(source.permission).toBe("system.manage");
  });

  it("warns when two fresh devices agree the box's clock is two hours off", async () => {
    const store = storeAt(BOX_MS + 10_000, 10_000);
    store.noteDevice("till-a", "192.168.10.31", BOX_MS + 2 * HOUR_MS, {
      wallMs: BOX_MS,
      monoMs: 0,
    });
    store.noteDevice("till-b", "192.168.10.32", BOX_MS + 5_000 + 2 * HOUR_MS + 20_000, {
      wallMs: BOX_MS + 5_000,
      monoMs: 5_000,
    });
    const now = new Date(BOX_MS + 10_000);
    expect(await readAlerts(store, now)).toEqual([
      {
        key: "clock.disagrees",
        code: "clock.disagrees",
        severity: "warning",
        since: null,
        screen: "box-status",
        params: {
          count: 2,
          deviceAt: new Date(BOX_MS + 10_000 + 2 * HOUR_MS + 10_000).toISOString(),
          boxAt: now.toISOString(),
        },
      },
    ]);
  });

  it("says nothing with only one device off", async () => {
    const store = storeAt(BOX_MS, 0);
    store.noteDevice("till-a", "192.168.10.31", BOX_MS + 2 * HOUR_MS, {
      wallMs: BOX_MS,
      monoMs: 0,
    });
    expect(await readAlerts(store, new Date(BOX_MS))).toEqual([]);
  });

  it("says nothing when two devices are within a minute of the box", async () => {
    const store = storeAt(BOX_MS, 0);
    store.noteDevice("till-a", "192.168.10.31", BOX_MS + 59_000, { wallMs: BOX_MS, monoMs: 0 });
    store.noteDevice("till-b", "192.168.10.32", BOX_MS - 59_000, { wallMs: BOX_MS, monoMs: 0 });
    expect(await readAlerts(store, new Date(BOX_MS))).toEqual([]);
  });

  it("says nothing once the two readings are more than five minutes old", async () => {
    const store = storeAt(BOX_MS + 300_001, 300_001);
    store.noteDevice("till-a", "192.168.10.31", BOX_MS + 2 * HOUR_MS, {
      wallMs: BOX_MS,
      monoMs: 0,
    });
    store.noteDevice("till-b", "192.168.10.32", BOX_MS + 2 * HOUR_MS, {
      wallMs: BOX_MS,
      monoMs: 0,
    });
    expect(await readAlerts(store, new Date(BOX_MS + 300_001))).toEqual([]);
  });

  it("says nothing when the two devices that are off share one address", async () => {
    const store = storeAt(BOX_MS, 0);
    store.noteDevice("till-a", "192.168.10.31", BOX_MS + 2 * HOUR_MS, {
      wallMs: BOX_MS,
      monoMs: 0,
    });
    store.noteDevice("till-b", "192.168.10.31", BOX_MS + 2 * HOUR_MS, {
      wallMs: BOX_MS,
      monoMs: 0,
    });
    expect(await readAlerts(store, new Date(BOX_MS))).toEqual([]);
  });

  it("counts two devices whose address reads empty as two", async () => {
    const store = storeAt(BOX_MS, 0);
    store.noteDevice("till-a", "", BOX_MS + 2 * HOUR_MS, { wallMs: BOX_MS, monoMs: 0 });
    store.noteDevice("till-b", "", BOX_MS + 2 * HOUR_MS, { wallMs: BOX_MS, monoMs: 0 });
    expect(await readAlerts(store, new Date(BOX_MS))).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ count: 2 }) }),
    ]);
  });
});
