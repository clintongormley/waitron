import { afterEach, describe, expect, it, vi } from "vitest";
import { observeTimeServiceHourClock } from "./hour-clock-time-service.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
afterEach(() => vi.useRealTimers());

function clocks() {
  let wall = NOW - 200;
  let monotonic = 800;
  return { wall: () => (wall += 200), monotonic: () => (monotonic += 200) };
}

describe("the box's internet time service as the series check's second clock", () => {
  it("a synchronised answer is a usable internet clock at the box's own time", async () => {
    expect(await observeTimeServiceHourClock(async () => true, clocks())).toEqual({
      source: "internet",
      result: "usable",
      instantMs: NOW + 100,
      uncertaintyMs: 0,
      wallStartedMs: NOW,
      wallFinishedMs: NOW + 200,
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1200,
    });
  });

  it("an unsynchronised answer is unavailable, keeping the read's interval", async () => {
    expect(await observeTimeServiceHourClock(async () => false, clocks())).toEqual({
      source: "internet",
      result: "unavailable",
      reason: "not_synchronised",
      wallStartedMs: NOW,
      wallFinishedMs: NOW + 200,
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1200,
      uncertaintyMs: null,
    });
  });

  it("a read that fails is unavailable", async () => {
    const result = await observeTimeServiceHourClock(
      () => Promise.reject(new Error("host service gone")),
      clocks(),
    );
    expect(result).toMatchObject({ result: "unavailable", reason: "not_synchronised" });
  });

  it("an answer that is not exactly true is unavailable", async () => {
    const result = await observeTimeServiceHourClock(
      async () => "yes" as unknown as boolean,
      clocks(),
    );
    expect(result).toMatchObject({ result: "unavailable", reason: "not_synchronised" });
  });

  it("a read that never answers is unavailable after two seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled = false;
    const pending = observeTimeServiceHourClock(() => new Promise<boolean>(() => {}), clocks());
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ result: "unavailable", reason: "not_synchronised" });
  });
});
