import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBatteryReport, type BatteryLike } from "./battery-report.js";

function fakeBattery(level: number, charging: boolean): BatteryLike {
  return Object.assign(new EventTarget(), { level, charging });
}

// Taken before any test fakes the timers, so it still yields to the page when they are faked.
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

const reporters: { stop(): void }[] = [];
function start(...args: Parameters<typeof startBatteryReport>): { stop(): void } {
  const reporter = startBatteryReport(...args);
  reporters.push(reporter);
  return reporter;
}
function stopReporters(): void {
  for (const reporter of reporters.splice(0)) reporter.stop();
}
afterEach(stopReporters);

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

/** A send that answers only when the test releases it. */
function heldSends() {
  const releases: { resolve(): void; reject(error: unknown): void }[] = [];
  const send = vi.fn<Parameters<typeof startBatteryReport>[0]>(
    () =>
      new Promise<void>((resolve, reject) => {
        releases.push({ resolve, reject });
      }),
  );
  return { send, releases };
}

describe("startBatteryReport", () => {
  it("sends the level as a whole percentage and the charging state once the battery is read", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    start(send, () => Promise.resolve(fakeBattery(0.82, false)));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ level: 82, charging: false }, expect.any(AbortSignal));
  });

  it("rounds a fractional percentage to the nearest whole one", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    start(send, () => Promise.resolve(fakeBattery(0.825, true)));
    await settle();
    expect(send).toHaveBeenCalledWith({ level: 83, charging: true }, expect.any(AbortSignal));
  });

  it("sends again when the level changes and when the charging state changes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const battery = fakeBattery(0.82, false);
    start(send, () => Promise.resolve(battery));
    await settle();

    battery.level = 0.81;
    battery.dispatchEvent(new Event("levelchange"));
    await settle();
    battery.charging = true;
    battery.dispatchEvent(new Event("chargingchange"));

    expect(send.mock.calls).toEqual([
      [{ level: 82, charging: false }, expect.any(AbortSignal)],
      [{ level: 81, charging: false }, expect.any(AbortSignal)],
      [{ level: 81, charging: true }, expect.any(AbortSignal)],
    ]);
  });

  it("sends nothing where the browser does not expose the battery", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    start(send, undefined);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing after stop()", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const battery = fakeBattery(0.5, false);
    const reporter = start(send, () => Promise.resolve(battery));
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
    const reporter = start(send, () => Promise.resolve(battery));
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
      start(send, () => Promise.resolve(battery));
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

  it("swallows a send that throws instead of rejecting, on a change as on the first report", async () => {
    const send = vi.fn((): Promise<void> => {
      throw new TypeError("api.reportBattery is not a function");
    });
    const battery = fakeBattery(0.4, false);
    let uncaught = 0;
    const onError = (event: ErrorEvent): void => {
      uncaught++;
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    let unhandled: number;
    try {
      unhandled = await unhandledRejectionsDuring(async () => {
        start(send, () => Promise.resolve(battery));
        await settle();
        battery.dispatchEvent(new Event("levelchange"));
      });
    } finally {
      window.removeEventListener("error", onError);
    }

    expect(send).toHaveBeenCalledTimes(2);
    expect(uncaught).toBe(0);
    expect(unhandled).toBe(0);
  });

  it("swallows a failure to read the battery", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const unhandled = await unhandledRejectionsDuring(async () => {
      start(send, () => Promise.reject(new Error("not allowed")));
    });
    expect(send).not.toHaveBeenCalled();
    expect(unhandled).toBe(0);
  });

  it("swallows a getBattery that throws instead of rejecting", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const unhandled = await unhandledRejectionsDuring(async () => {
      expect(() =>
        start(send, () => {
          throw new TypeError("Illegal invocation");
        }),
      ).not.toThrow();
    });
    expect(send).not.toHaveBeenCalled();
    expect(unhandled).toBe(0);
  });
});

describe("startBatteryReport between changes", () => {
  const FIVE_MINUTES = 5 * 60_000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    stopReporters();
    vi.useRealTimers();
  });

  it("re-sends a steady reading every five minutes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    start(send, () => Promise.resolve(fakeBattery(1, true)));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FIVE_MINUTES - 1);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(FIVE_MINUTES);
    await settle();
    expect(send.mock.calls).toEqual([
      [{ level: 100, charging: true }, expect.any(AbortSignal)],
      [{ level: 100, charging: true }, expect.any(AbortSignal)],
      [{ level: 100, charging: true }, expect.any(AbortSignal)],
    ]);
  });

  it("re-sends the current reading at the next interval, so a change the server dropped is sent again", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const battery = fakeBattery(0.82, false);
    start(send, () => Promise.resolve(battery));
    await settle();
    battery.level = 0.81;
    battery.dispatchEvent(new Event("levelchange"));
    await settle();

    vi.advanceTimersByTime(FIVE_MINUTES);
    await settle();
    expect(send).toHaveBeenLastCalledWith({ level: 81, charging: false }, expect.any(AbortSignal));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sends nothing after stop(), however long passes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = start(send, () => Promise.resolve(fakeBattery(1, true)));
    await settle();
    send.mockClear();

    reporter.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3 * FIVE_MINUTES);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("startBatteryReport while a send is in flight", () => {
  it("holds later changes until it settles, then sends only the latest reading", async () => {
    const { send, releases } = heldSends();
    const battery = fakeBattery(0.5, false);
    start(send, () => Promise.resolve(battery));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    battery.charging = true;
    battery.dispatchEvent(new Event("chargingchange"));
    battery.charging = false;
    battery.level = 0.49;
    battery.dispatchEvent(new Event("chargingchange"));
    battery.dispatchEvent(new Event("levelchange"));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    releases[0]!.resolve();
    await settle();
    expect(send.mock.calls).toEqual([
      [{ level: 50, charging: false }, expect.any(AbortSignal)],
      [{ level: 49, charging: false }, expect.any(AbortSignal)],
    ]);
  });

  it("sends the held reading after a send that was refused", async () => {
    const { send, releases } = heldSends();
    const battery = fakeBattery(0.5, false);
    const unhandled = await unhandledRejectionsDuring(async () => {
      start(send, () => Promise.resolve(battery));
      await settle();
      battery.charging = true;
      battery.dispatchEvent(new Event("chargingchange"));
      expect(send).toHaveBeenCalledTimes(1);
      releases[0]!.reject({ code: "server.internal" });
    });
    expect(send.mock.calls).toEqual([
      [{ level: 50, charging: false }, expect.any(AbortSignal)],
      [{ level: 50, charging: true }, expect.any(AbortSignal)],
    ]);
    expect(unhandled).toBe(0);
  });

  it("drops the held reading when stopped before the send settles", async () => {
    const { send, releases } = heldSends();
    const battery = fakeBattery(0.5, false);
    const reporter = start(send, () => Promise.resolve(battery));
    await settle();
    battery.charging = true;
    battery.dispatchEvent(new Event("chargingchange"));

    reporter.stop();
    releases[0]!.resolve();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("startBatteryReport when a send is never answered", () => {
  const FIVE_MINUTES = 5 * 60_000;
  const ONE_MINUTE = 60_000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    stopReporters();
    vi.useRealTimers();
  });

  it("still re-sends at the next interval", async () => {
    const { send } = heldSends();
    start(send, () => Promise.resolve(fakeBattery(1, true)));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FIVE_MINUTES);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops waiting after a minute and sends the reading held behind it", async () => {
    const { send } = heldSends();
    const battery = fakeBattery(0.5, false);
    start(send, () => Promise.resolve(battery));
    await settle();
    battery.charging = true;
    battery.dispatchEvent(new Event("chargingchange"));

    vi.advanceTimersByTime(ONE_MINUTE - 1);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(send.mock.calls.map(([report]) => report)).toEqual([
      { level: 50, charging: false },
      { level: 50, charging: true },
    ]);
  });

  it("aborts the signal it handed to the send when it stops waiting", async () => {
    const { send } = heldSends();
    start(send, () => Promise.resolve(fakeBattery(0.5, false)));
    await settle();
    const signal = send.mock.calls[0]![1];

    vi.advanceTimersByTime(ONE_MINUTE - 1);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
  });

  it("holds a change behind the next send when a given-up send answers late", async () => {
    const { send, releases } = heldSends();
    const battery = fakeBattery(0.5, false);
    start(send, () => Promise.resolve(battery));
    await settle();
    battery.dispatchEvent(new Event("levelchange"));
    vi.advanceTimersByTime(ONE_MINUTE);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);

    releases[0]!.resolve();
    await settle();
    battery.level = 0.49;
    battery.dispatchEvent(new Event("levelchange"));
    await settle();
    expect(send).toHaveBeenCalledTimes(2);

    releases[1]!.resolve();
    await settle();
    expect(send).toHaveBeenLastCalledWith({ level: 49, charging: false }, expect.any(AbortSignal));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("aborts the send in flight on stop() and leaves no timers running", async () => {
    const { send } = heldSends();
    const reporter = start(send, () => Promise.resolve(fakeBattery(0.5, false)));
    await settle();
    const signal = send.mock.calls[0]![1];

    reporter.stop();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
