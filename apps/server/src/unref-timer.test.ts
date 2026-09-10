import { afterEach, describe, expect, it, vi } from "vitest";
import { unrefTimer } from "./unref-timer.js";

afterEach(() => vi.useRealTimers());

describe("unrefTimer", () => {
  it("runs the callback after the delay", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    unrefTimer(1000, fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("cancel() stops the callback from running", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    unrefTimer(1000, fn).cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
