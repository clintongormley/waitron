import { describe, expect, it, vi } from "vitest";
import type { BoxHostClient, ClockServiceStatus, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";
import { keepTimeServiceOn } from "./time-service-kept-on.js";

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

describe("keepTimeServiceOn", () => {
  it("switches a time service it reads as off back on, logs it, and answers the reading", async () => {
    const host = fakeHost(OFF, [{ available: true }]);
    const log = vi.fn<Logger>();
    expect(await keepTimeServiceOn(host, log).clockStatus()).toEqual(OFF);
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
    expect(await keepTimeServiceOn(host, log).clockStatus()).toEqual(status);
    expect(host.timeServiceOn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("reads a host that cannot switch it on as it is", async () => {
    const host: BoxHostClient = {
      clockStatus: async () => OFF,
      setClock: async () => ({ available: false, reason: "missing" }),
    };
    const log = vi.fn<Logger>();
    expect(await keepTimeServiceOn(host, log).clockStatus()).toEqual(OFF);
    expect(log).not.toHaveBeenCalled();
  });

  it("shares one switch-on between readings that arrive together", async () => {
    const host = fakeHost(OFF, []);
    const kept = keepTimeServiceOn(host, vi.fn<Logger>());
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
    const kept = keepTimeServiceOn(host, log);
    for (let i = 0; i < 6; i++) await kept.clockStatus();
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
    expect(await keepTimeServiceOn(host, vi.fn<Logger>()).setClock(input)).toEqual({
      available: true,
      beforeMs: 1,
      afterMs: 2,
    });
    expect(host.setClock).toHaveBeenCalledWith(input);
  });
});
