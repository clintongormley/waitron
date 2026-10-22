import { afterEach, expect, it, vi } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { createWaitCountdown, formatRemaining } from "./wait-countdown.js";

function host() {
  const controllers: ReactiveController[] = [];
  let updates = 0;
  const value: ReactiveControllerHost & { readonly updates: number } = {
    addController: (c) => void controllers.push(c),
    removeController: () => undefined,
    requestUpdate: () => void ++updates,
    updateComplete: Promise.resolve(true),
    get updates() {
      return updates;
    },
  };
  return { value, controllers };
}
afterEach(() => {
  vi.useRealTimers();
});

it("counts down on a faked interval and performance clock", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  try {
    const onZero = vi.fn();
    const countdown = createWaitCountdown(host().value, onZero);
    countdown.start(84_000);
    expect(formatRemaining(countdown.remainingMs!)).toBe("1:24");
    vi.advanceTimersByTime(1_000);
    expect(formatRemaining(countdown.remainingMs!)).toBe("1:23");
    vi.advanceTimersByTime(83_000);
    expect(countdown.remainingMs).toBe(0);
    expect(onZero).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(onZero).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("stops without calling back, and stops when the host disconnects", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  try {
    const onZero = vi.fn();
    const { value, controllers } = host();
    const countdown = createWaitCountdown(value, onZero);
    countdown.start(1_000);
    countdown.stop();
    expect(countdown.remainingMs).toBeUndefined();
    vi.advanceTimersByTime(2_000);
    countdown.start(1_000);
    controllers.forEach((c) => c.hostDisconnected?.());
    vi.advanceTimersByTime(2_000);
    expect(onZero).not.toHaveBeenCalled();
    expect(countdown.remainingMs).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  [0, "0:00"],
  [1, "0:01"],
  [1_000, "0:01"],
  [1_001, "0:02"],
  [59_001, "1:00"],
  [61_000, "1:01"],
  [150_000, "2:30"],
])("formats %i ms as %s, rounding seconds up", (ms, text) => {
  expect(formatRemaining(ms)).toBe(text);
});
