import { describe, expect, it, vi } from "vitest";
import type { BoxHostClient, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";
import { startClockState, type StartClockStatus } from "./start-clock-check.js";
import { RETRY_SPACING_MS, timeServiceRetry } from "./time-service-retry.js";

function harness(answers: Array<TimeServiceOnAnswer | Error> = []) {
  let steadyMs = 5_000;
  let steps = 0;
  const state = startClockState();
  const retryTimeService = vi.fn(async (): Promise<TimeServiceOnAnswer> => {
    const next = answers.shift() ?? { available: true };
    if (next instanceof Error) throw next;
    return next;
  });
  const host: Pick<BoxHostClient, "retryTimeService"> = { retryTimeService };
  const log = vi.fn<Logger>();
  const retry = timeServiceRetry({
    host,
    state,
    steps: () => steps,
    monotonic: () => steadyMs,
    log,
  });
  return {
    retry,
    retryTimeService,
    log,
    state,
    advance: (ms: number) => {
      steadyMs += ms;
    },
    step: () => {
      steps++;
    },
  };
}

describe("restarting the time service while the start waits", () => {
  it("asks at once, then not again until 30 s have passed on the steady clock", async () => {
    const h = harness();
    await h.retry();
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);
    h.advance(RETRY_SPACING_MS - 1);
    await h.retry();
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);
    h.advance(1);
    await h.retry();
    expect(h.retryTimeService).toHaveBeenCalledTimes(2);
    expect(RETRY_SPACING_MS).toBe(30_000);
  });

  it("counts a failed request towards the spacing", async () => {
    const h = harness([{ available: false, reason: "refused", refusal: "busy" }]);
    await h.retry();
    h.advance(RETRY_SPACING_MS - 1);
    await h.retry();
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while the steady clock cannot be read, and asks again once it can", async () => {
    const retryTimeService = vi.fn(async () => ({ available: true as const }));
    const readings = [Number.NaN, 60_000, 120_000];
    const retry = timeServiceRetry({
      host: { retryTimeService },
      state: startClockState(),
      steps: () => 0,
      monotonic: () => readings.shift()!,
      log: vi.fn<Logger>(),
    });
    const asked: number[] = [];
    for (let look = 0; look < 3; look++) {
      await retry();
      asked.push(retryTimeService.mock.calls.length);
    }
    expect(asked).toEqual([0, 1, 2]);
  });

  it("never asks once the clock has been set in this process", async () => {
    const h = harness();
    h.step();
    for (let look = 0; look < 3; look++) {
      await h.retry();
      h.advance(RETRY_SPACING_MS);
    }
    expect(h.retryTimeService).not.toHaveBeenCalled();
  });

  it("never asks once a person has confirmed the time, even after the box goes back to waiting", async () => {
    const h = harness();
    await h.retry();
    h.state.confirm("by_person", { "node-a": 1 });
    h.state.backToWaiting("clock_jumped");
    for (let look = 0; look < 3; look++) {
      h.advance(RETRY_SPACING_MS);
      await h.retry();
    }
    expect(h.state.status).toBe("waiting");
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);
  });

  it.each(["by_internet", "by_devices", "by_person"] as const)(
    "never asks while the start is confirmed %s",
    async (status: StartClockStatus) => {
      const retryTimeService = vi.fn(async () => ({ available: true as const }));
      const retry = timeServiceRetry({
        host: { retryTimeService },
        state: { status, confirmedByPerson: false, heldConfirmation: null },
        steps: () => 0,
        monotonic: () => 1_000,
        log: vi.fn<Logger>(),
      });
      await retry();
      expect(retryTimeService).not.toHaveBeenCalled();
    },
  );

  it("asks nothing while the internet's confirmation is held for an identity change, and asks again once it is dropped", async () => {
    const h = harness();
    h.state.holdForIdentityChange();
    h.state.confirm("by_internet", { "node-a": 1 });
    expect(h.state.status).toBe("waiting");
    await h.retry();
    expect(h.retryTimeService).not.toHaveBeenCalled();

    h.state.dropHeldConfirmation();
    await h.retry();
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while a person's confirmation is held, asks again once it is dropped, and never again once it has ended the wait", async () => {
    const h = harness();
    h.state.holdForIdentityChange({ standing: () => () => true, onHeld: () => {} });
    h.state.confirm("by_person", { "node-a": 1 });
    await h.retry();
    expect(h.retryTimeService).not.toHaveBeenCalled();

    h.state.dropHeldConfirmation();
    await h.retry();
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);

    h.state.confirm("by_person", { "node-a": 1 });
    h.state.releaseIdentityChange();
    h.state.backToWaiting("clock_jumped");
    h.advance(RETRY_SPACING_MS);
    await h.retry();
    expect(h.state.status).toBe("waiting");
    expect(h.retryTimeService).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a host that cannot restart the service", async () => {
    const log = vi.fn<Logger>();
    const retry = timeServiceRetry({
      host: {},
      state: startClockState(),
      steps: () => 0,
      monotonic: () => 1_000,
      log,
    });
    await retry();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs the first restart and every tenth, with the running count", async () => {
    const h = harness();
    for (let look = 0; look < 21; look++) {
      await h.retry();
      h.advance(RETRY_SPACING_MS);
    }
    expect(h.retryTimeService).toHaveBeenCalledTimes(21);
    expect(h.log.mock.calls).toEqual([
      ["info", "time_service.restarted", { count: 1 }],
      ["info", "time_service.restarted", { count: 10 }],
      ["info", "time_service.restarted", { count: 20 }],
    ]);
  });

  it("warns of a failure once, again for a different one, and again after a success", async () => {
    const saved = {
      available: false as const,
      reason: "refused" as const,
      refusal: "saved_time_ahead",
    };
    const h = harness([saved, saved, new Error("socket"), { available: true }, saved]);
    for (let look = 0; look < 5; look++) {
      await h.retry();
      h.advance(RETRY_SPACING_MS);
    }
    expect(h.log.mock.calls).toEqual([
      ["warn", "time_service.restart_failed", { reason: "refused", refusal: "saved_time_ahead" }],
      ["warn", "time_service.restart_failed", { reason: "lost" }],
      ["info", "time_service.restarted", { count: 1 }],
      ["warn", "time_service.restart_failed", { reason: "refused", refusal: "saved_time_ahead" }],
    ]);
  });
});
