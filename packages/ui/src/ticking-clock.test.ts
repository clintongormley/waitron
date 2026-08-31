import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TickingClock } from "./ticking-clock.js";

class StubHost {
  updates = 0;
  controllers: { hostConnected?(): void; hostDisconnected?(): void }[] = [];
  addController(c: { hostConnected?(): void; hostDisconnected?(): void }) {
    this.controllers.push(c);
  }
  requestUpdate() {
    this.updates++;
  }
}

describe("TickingClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances now and requests an update each interval while connected", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    const first = clock.now;
    vi.advanceTimersByTime(3000);
    expect(clock.now).toBeGreaterThanOrEqual(first);
    expect(host.updates).toBe(3);
  });

  it("stops ticking after disconnect", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    clock.hostDisconnected();
    vi.advanceTimersByTime(5000);
    expect(host.updates).toBe(0);
  });

  it("does not leak a second interval when hostConnected runs twice without a disconnect in between", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    clock.hostConnected(); // reconnect / DOM adoption without an intervening hostDisconnected
    vi.advanceTimersByTime(3000);
    // One interval firing three times, not two intervals firing three times each (6).
    expect(host.updates).toBe(3);
  });
});
