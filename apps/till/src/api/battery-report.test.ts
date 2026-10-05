import { describe, expect, it, vi } from "vitest";
import { startBatteryReport, type BatteryLike } from "./battery-report.js";

function fakeBattery(level: number, charging: boolean): BatteryLike {
  return Object.assign(new EventTarget(), { level, charging });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs `body`, then counts the rejections the page saw nobody handle. */
async function unhandledRejectionsDuring(body: () => Promise<void>): Promise<number> {
  let count = 0;
  const onUnhandled = (event: PromiseRejectionEvent): void => {
    count++;
    event.preventDefault();
  };
  window.addEventListener("unhandledrejection", onUnhandled);
  try {
    await body();
    await settle();
    await settle();
  } finally {
    window.removeEventListener("unhandledrejection", onUnhandled);
  }
  return count;
}

describe("startBatteryReport", () => {
  it("sends the level as a whole percentage and the charging state once the battery is read", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    startBatteryReport(send, () => Promise.resolve(fakeBattery(0.82, false)));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ level: 82, charging: false });
  });

  it("rounds a fractional percentage to the nearest whole one", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    startBatteryReport(send, () => Promise.resolve(fakeBattery(0.825, true)));
    await settle();
    expect(send).toHaveBeenCalledWith({ level: 83, charging: true });
  });

  it("sends again when the level changes and when the charging state changes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const battery = fakeBattery(0.82, false);
    startBatteryReport(send, () => Promise.resolve(battery));
    await settle();

    battery.level = 0.81;
    battery.dispatchEvent(new Event("levelchange"));
    battery.charging = true;
    battery.dispatchEvent(new Event("chargingchange"));

    expect(send.mock.calls).toEqual([
      [{ level: 82, charging: false }],
      [{ level: 81, charging: false }],
      [{ level: 81, charging: true }],
    ]);
  });

  it("sends nothing where the browser does not expose the battery", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    startBatteryReport(send, undefined);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing after stop()", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const battery = fakeBattery(0.5, false);
    const reporter = startBatteryReport(send, () => Promise.resolve(battery));
    await settle();
    send.mockClear();

    reporter.stop();
    battery.dispatchEvent(new Event("levelchange"));
    battery.dispatchEvent(new Event("chargingchange"));

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing, then or later, when stopped before the battery is read", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const battery = fakeBattery(0.5, false);
    const reporter = startBatteryReport(send, () => Promise.resolve(battery));
    reporter.stop();
    await settle();
    battery.dispatchEvent(new Event("levelchange"));

    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a refused report, and the next change still sends", async () => {
    // A plain function: with a `vi.fn` here, deleting the reporter's `.catch` still passed.
    const sent: unknown[] = [];
    const send = (report: unknown): Promise<void> => {
      sent.push(report);
      return sent.length === 1
        ? Promise.reject({ code: "device.unauthorized" })
        : Promise.resolve();
    };
    const battery = fakeBattery(0.4, false);

    const unhandled = await unhandledRejectionsDuring(async () => {
      startBatteryReport(send, () => Promise.resolve(battery));
      await settle();
      battery.level = 0.39;
      battery.dispatchEvent(new Event("levelchange"));
    });

    expect(sent).toEqual([
      { level: 40, charging: false },
      { level: 39, charging: false },
    ]);
    expect(unhandled).toBe(0);
  });

  it("swallows a failure to read the battery", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const unhandled = await unhandledRejectionsDuring(async () => {
      startBatteryReport(send, () => Promise.reject(new Error("not allowed")));
    });
    expect(send).not.toHaveBeenCalled();
    expect(unhandled).toBe(0);
  });
});
