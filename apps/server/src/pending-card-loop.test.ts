import { describe, expect, it, vi } from "vitest";
import * as recovery from "./pending-card-recovery.js";

describe("the independent pending-card loop", () => {
  it.each([null, new Date("2026-10-18T00:00:00Z")])(
    "checks immediately and again within a minute when the fiscal next due is %s",
    async (nextDueAt) => {
      expect(recovery.runPendingCardLoop).toBeTypeOf("function");
      const controller = new AbortController();
      const calls: string[] = [];
      await recovery.runPendingCardLoop({
        now: () => new Date("2026-10-17T00:00:00Z"),
        signal: controller.signal,
        log: () => {},
        pass: async () => {
          calls.push("check");
          return { duties: [], nextDueAt };
        },
        sleep: async (ms, signal) => {
          calls.push(`sleep ${ms}`);
          expect(signal).toBe(controller.signal);
          controller.abort();
        },
      });
      expect(calls).toEqual(["check", "sleep 60000"]);
    },
  );

  it("contains a failed pass and checks again before stopping", async () => {
    expect(recovery.runPendingCardLoop).toBeTypeOf("function");
    const controller = new AbortController();
    const log = vi.fn();
    let passes = 0;
    const waits: number[] = [];
    await recovery.runPendingCardLoop({
      now: () => new Date("2026-10-17T00:00:00Z"),
      signal: controller.signal,
      log,
      pass: async () => {
        if (++passes === 1) throw new Error("provider down");
        controller.abort();
        return { duties: [], nextDueAt: null };
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(passes).toBe(2);
    expect(waits).toEqual([5000]);
    expect(log).toHaveBeenCalledWith("error", "pass.threw", expect.any(Object));
  });

  it("finishes the current pass on abort and starts no later work", async () => {
    expect(recovery.runPendingCardLoop).toBeTypeOf("function");
    const controller = new AbortController();
    const pass = vi.fn(async () => {
      controller.abort();
      return { duties: [], nextDueAt: null };
    });
    await recovery.runPendingCardLoop({
      now: () => new Date(),
      signal: controller.signal,
      log: () => {},
      pass,
    });
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
