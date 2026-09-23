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

  it("works under a timer host that hands back a plain number", () => {
    const pending: Array<() => void> = [];
    const cleared: unknown[] = [];
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      pending.push(fn);
      return 7;
    });
    vi.stubGlobal("clearTimeout", (t: unknown) => void cleared.push(t));
    try {
      const fn = vi.fn();
      const timer = unrefTimer(1000, fn);
      pending[0]!();
      expect(fn).toHaveBeenCalledOnce();
      timer.cancel();
      expect(cleared).toEqual([7]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
