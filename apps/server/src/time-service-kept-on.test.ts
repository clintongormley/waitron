import { describe, expect, it, vi } from "vitest";
import type { BoxHostClient, ClockServiceStatus, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";
import {
  keepTimeServiceOn,
  SWITCH_ON_FIRST_WAIT_MS,
  SWITCH_ON_LONGEST_WAIT_MS,
} from "./time-service-kept-on.js";

const MINUTE = 60_000;
const SYNC_ON_FAILED = {
  available: false as const,
  reason: "refused" as const,
  refusal: "sync_on_failed",
};

const OFF: ClockServiceStatus = {
  available: true,
  service: "off",
  unit: null,
  synchronised: false,
  lastSyncAt: null,
};
const ON: ClockServiceStatus = { ...OFF, service: "on", unit: "chrony.service" };

function fakeHost(status: ClockServiceStatus, answers: Array<TimeServiceOnAnswer | Error>) {
  const timeServiceOn = vi.fn(async () => {
    const next = answers.shift() ?? { available: true };
    if (next instanceof Error) throw next;
    return next;
  });
  const setClock = vi.fn(async () => ({ available: true as const, beforeMs: 1, afterMs: 2 }));
  const host = { clockStatus: vi.fn(async () => status), setClock, timeServiceOn };
  return host satisfies BoxHostClient;
}

/** A clock the test moves; it starts at an arbitrary fixed time. */
function testClock() {
  let ms = Date.parse("2026-11-15T10:00:00.000Z");
  return {
    now: () => new Date(ms),
    advance: (by: number) => {
      ms += by;
    },
  };
}

describe("keepTimeServiceOn", () => {
  it("switches a time service it reads as off back on, logs it, and answers the reading", async () => {
    const host = fakeHost(OFF, [{ available: true }]);
    const log = vi.fn<Logger>();
    expect(await keepTimeServiceOn(host, log, testClock().now).clockStatus()).toEqual(OFF);
    expect(host.timeServiceOn).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([["info", "time_service.switched_on"]]);
  });

  it.each([
    ON,
    { ...ON, service: "stopped" as const },
    { available: false as const, reason: "missing" as const },
  ])("asks nothing for a reading of %o", async (status) => {
    const host = fakeHost(status, []);
    const log = vi.fn<Logger>();
    expect(await keepTimeServiceOn(host, log, testClock().now).clockStatus()).toEqual(status);
    expect(host.timeServiceOn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("reads a host that cannot switch it on as it is", async () => {
    const host: BoxHostClient = {
      clockStatus: async () => OFF,
      setClock: async () => ({ available: false, reason: "missing" }),
    };
    const log = vi.fn<Logger>();
    expect(await keepTimeServiceOn(host, log, testClock().now).clockStatus()).toEqual(OFF);
    expect(log).not.toHaveBeenCalled();
  });

  it("shares one switch-on between readings that arrive together", async () => {
    const host = fakeHost(OFF, []);
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), testClock().now);
    await Promise.all([kept.clockStatus(), kept.clockStatus()]);
    expect(host.timeServiceOn).toHaveBeenCalledTimes(1);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(2);
  });

  it("warns of a failure once, again for a different one, and again after a success", async () => {
    const host = fakeHost(OFF, [
      { available: false, reason: "refused", refusal: "sync_on_failed" },
      { available: false, reason: "refused", refusal: "sync_on_failed" },
      { available: false, reason: "missing", detail: "ENOENT" },
      new Error("socket gone"),
      { available: true },
      { available: false, reason: "missing", detail: "ENOENT" },
    ]);
    const log = vi.fn<Logger>();
    const clock = testClock();
    const kept = keepTimeServiceOn(host, log, clock.now);
    // Each reading past the longest wait, so every one asks.
    for (let i = 0; i < 6; i++) {
      await kept.clockStatus();
      clock.advance(SWITCH_ON_LONGEST_WAIT_MS);
    }
    expect(host.timeServiceOn).toHaveBeenCalledTimes(6);
    expect(log.mock.calls).toEqual([
      ["warn", "time_service.switch_on_failed", { reason: "refused", refusal: "sync_on_failed" }],
      ["warn", "time_service.switch_on_failed", { reason: "missing", detail: "ENOENT" }],
      ["warn", "time_service.switch_on_failed", { reason: "lost" }],
      ["info", "time_service.switched_on"],
      ["warn", "time_service.switch_on_failed", { reason: "missing", detail: "ENOENT" }],
    ]);
  });

  it("passes a clock set straight to the host", async () => {
    const host = fakeHost(ON, []);
    const input = { targetMs: 1793425531250, requester: { source: "aeat" } };
    expect(await keepTimeServiceOn(host, vi.fn<Logger>(), testClock().now).setClock(input)).toEqual(
      {
        available: true,
        beforeMs: 1,
        afterMs: 2,
      },
    );
    expect(host.setClock).toHaveBeenCalledWith(input);
  });

  it("passes a restart of the time service straight to the host, and leaves it out for a host without one", async () => {
    const retryTimeService = vi.fn(async () => ({
      available: false as const,
      reason: "refused" as const,
      refusal: "busy",
    }));
    const host = { ...fakeHost(ON, []), retryTimeService };
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), testClock().now);
    expect(await kept.retryTimeService?.()).toEqual({
      available: false,
      reason: "refused",
      refusal: "busy",
    });
    expect(retryTimeService).toHaveBeenCalledTimes(1);
    expect(
      keepTimeServiceOn(fakeHost(ON, []), vi.fn<Logger>(), testClock().now).retryTimeService,
    ).toBeUndefined();
  });

  it("answers the reading and warns lost when the switch-on throws before it returns a promise", async () => {
    const host: BoxHostClient = {
      clockStatus: async () => OFF,
      setClock: async () => ({ available: false, reason: "missing" }),
      timeServiceOn: () => {
        throw new Error("thrown synchronously");
      },
    };
    const log = vi.fn<Logger>();
    expect(await keepTimeServiceOn(host, log, testClock().now).clockStatus()).toEqual(OFF);
    expect(log.mock.calls).toEqual([["warn", "time_service.switch_on_failed", { reason: "lost" }]]);
  });

  it("asks again a minute after a single failed switch-on, not before", async () => {
    const host = fakeHost(OFF, [SYNC_ON_FAILED, { available: true }]);
    const clock = testClock();
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), clock.now);
    expect(await kept.clockStatus()).toEqual(OFF);
    expect(host.timeServiceOn).toHaveBeenCalledTimes(1);
    clock.advance(MINUTE - 1);
    // Still answered as read.
    expect(await kept.clockStatus()).toEqual(OFF);
    expect(host.timeServiceOn).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(2);
    expect(SWITCH_ON_FIRST_WAIT_MS).toBe(MINUTE);
  });

  it("doubles the wait after each further failure in a row, up to an hour", async () => {
    const host = fakeHost(
      OFF,
      Array.from({ length: 9 }, () => SYNC_ON_FAILED),
    );
    const clock = testClock();
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), clock.now);
    await kept.clockStatus();
    const waits = [];
    for (let asked = 1; asked < 9; asked++) {
      let waited = 0;
      while (host.timeServiceOn.mock.calls.length === asked) {
        clock.advance(MINUTE);
        waited += MINUTE;
        await kept.clockStatus();
      }
      waits.push(waited / MINUTE);
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
    expect(SWITCH_ON_LONGEST_WAIT_MS).toBe(60 * MINUTE);
  });

  it("starts again at a minute after a success", async () => {
    const host = fakeHost(OFF, [
      SYNC_ON_FAILED,
      SYNC_ON_FAILED,
      { available: true },
      SYNC_ON_FAILED,
    ]);
    const clock = testClock();
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), clock.now);
    await kept.clockStatus();
    clock.advance(MINUTE);
    await kept.clockStatus();
    clock.advance(2 * MINUTE);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(3);
    // The success leaves no wait: the next reading asks, and fails.
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(4);
    clock.advance(MINUTE);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["a timeout", { available: false as const, reason: "timeout" as const }],
    ["a lost connection", new Error("socket gone")],
  ])("backs off after %s too", async (_name, failure) => {
    const host = fakeHost(OFF, [failure]);
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), testClock().now);
    await kept.clockStatus();
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(1);
  });

  it("asks again at the next reading after a busy refusal, which a clock set in flight causes", async () => {
    const host = fakeHost(OFF, [{ available: false, reason: "refused", refusal: "busy" }]);
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), testClock().now);
    await kept.clockStatus();
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(2);
  });

  it("does not lengthen the wait for a busy refusal between failures", async () => {
    const busy = { available: false as const, reason: "refused" as const, refusal: "busy" };
    const host = fakeHost(OFF, [SYNC_ON_FAILED, busy, SYNC_ON_FAILED, SYNC_ON_FAILED]);
    const clock = testClock();
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), clock.now);
    await kept.clockStatus();
    clock.advance(MINUTE);
    await kept.clockStatus();
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(3);
    // The second failure in a row, the busy refusal not counted: two minutes.
    clock.advance(2 * MINUTE - 1);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(3);
    clock.advance(1);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(4);
  });

  it("asks again at once, and starts again at a minute, once the service has been read as not off in between", async () => {
    let status: ClockServiceStatus = OFF;
    const host = fakeHost(OFF, [SYNC_ON_FAILED, SYNC_ON_FAILED, SYNC_ON_FAILED, SYNC_ON_FAILED]);
    host.clockStatus.mockImplementation(async () => status);
    const clock = testClock();
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), clock.now);
    await kept.clockStatus();
    status = { available: false, reason: "missing" };
    await kept.clockStatus();
    status = OFF;
    await kept.clockStatus();
    // An unavailable reading says nothing of the service, so the back-off still holds.
    expect(host.timeServiceOn).toHaveBeenCalledTimes(1);
    status = ON;
    await kept.clockStatus();
    status = OFF;
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(2);
    // Two failures in a row, then a reading of it on: the next failure waits a minute, not four.
    clock.advance(2 * MINUTE);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(3);
    status = ON;
    await kept.clockStatus();
    status = OFF;
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(4);
    clock.advance(MINUTE);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(5);
  });

  it("does not stretch the back-off when the clock is set back", async () => {
    const host = fakeHost(OFF, [
      { available: false, reason: "refused", refusal: "sync_on_failed" },
    ]);
    const clock = testClock();
    const kept = keepTimeServiceOn(host, vi.fn<Logger>(), clock.now);
    await kept.clockStatus();
    clock.advance(-24 * 60 * 60_000);
    await kept.clockStatus();
    expect(host.timeServiceOn).toHaveBeenCalledTimes(2);
  });
});
