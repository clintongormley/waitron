import { describe, expect, it, vi } from "vitest";
import { runRetentionSweep } from "./retention.js";
import type { Database } from "@waitron/db";

const db = {} as Database;

describe("runRetentionSweep", () => {
  it("prunes each tick and stops on abort", async () => {
    const controller = new AbortController();
    const prune = vi.fn(async () => ({ pruned: 2, highWater: 5n }));
    let ticks = 0;
    await runRetentionSweep({
      db,
      signal: controller.signal,
      tickMs: 10,
      log: () => {},
      prune,
      lag: async () => [],
      sleep: async () => {
        ticks += 1;
        if (ticks >= 3) controller.abort();
      },
    });
    expect(prune.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("emits sync.stream_stalled for a subscriber past the lag threshold", async () => {
    const controller = new AbortController();
    const logged: Array<[string, string]> = [];
    await runRetentionSweep({
      db,
      signal: controller.signal,
      tickMs: 10,
      lagAlarmRows: 5,
      log: (level, code) => logged.push([level, code]),
      prune: async () => ({ pruned: 0, highWater: 0n }),
      lag: async () => [
        { subscriberId: "cloud", originId: "o", lag: 9n, alive: false },
        { subscriberId: "peerB", originId: "o", lag: 1n, alive: true },
      ],
      sleep: async () => controller.abort(),
    });
    expect(logged).toContainEqual(["error", "sync.stream_stalled"]);
  });

  it("logs sync.retention_failed and swallows a prune error, continuing rather than dying", async () => {
    // The documented contract: "errors are logged and swallowed so a transient DB fault does not kill
    // the sweep". Prove BOTH halves — the throw is logged as a warn (not propagated: the call resolves
    // rather than rejecting), and the loop runs a SECOND tick after the first prune threw.
    const controller = new AbortController();
    const logged: Array<[string, string]> = [];
    let pruneCalls = 0;
    let ticks = 0;
    await runRetentionSweep({
      db,
      signal: controller.signal,
      tickMs: 10,
      log: (level, code) => logged.push([level, code]),
      prune: async () => {
        pruneCalls += 1;
        throw new Error("transient db fault");
      },
      lag: async () => [],
      sleep: async () => {
        ticks += 1;
        if (ticks >= 2) controller.abort();
      },
    });
    expect(logged).toContainEqual(["warn", "sync.retention_failed"]);
    // Swallowed, not fatal: a second prune ran after the first one threw.
    expect(pruneCalls).toBeGreaterThanOrEqual(2);
  });

  it("breaks before sleeping when aborted mid-tick, so close() stops it promptly", async () => {
    // The pre-sleep abort check (`if (deps.signal.aborted) break`): when close() aborts DURING a prune,
    // the sweep must break rather than sleep out the tick. Abort from inside `prune`, then prove the
    // idle sleep never ran.
    const controller = new AbortController();
    let sleeps = 0;
    await runRetentionSweep({
      db,
      signal: controller.signal,
      tickMs: 10,
      log: () => {},
      prune: async () => {
        controller.abort(); // aborted mid-tick, before the pre-sleep check
        return { pruned: 0, highWater: 0n };
      },
      lag: async () => [],
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(sleeps).toBe(0);
  });
});
