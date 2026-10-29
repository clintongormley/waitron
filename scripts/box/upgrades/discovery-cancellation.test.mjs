import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const discoveryUrl = new URL("./discovery.mjs", import.meta.url).href;

describe("discovery cancellation across event-loop phases", () => {
  it.each(["setImmediate", "setTimeout"])(
    "retries after %s cleanup when a fresh process has a due grace timer",
    (turn) => {
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
            import { discoverRelease } from ${JSON.stringify(discoveryUrl)};
            import { setImmediate, setTimeout } from "node:timers/promises";
            const watchdog = globalThis.setTimeout(() => process.exit(2), 1_000);
            let attempts = 0;
            let running = 0;
            let maximumRunning = 0;
            const events = [];
            const cleanups = [];
            const result = await discoverRelease(
              { nowMs: 1_800_000_000_000, installedDigest: "a".repeat(64) },
              {
                platform: "linux/amd64",
                hostProtocol: 1,
                now: () => 1_800_000_000_000,
                sleep: async () => {},
                fetchManifest: async (signal) => {
                  const attempt = ++attempts;
                  maximumRunning = Math.max(maximumRunning, ++running);
                  events.push("start:" + attempt);
                  await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
                  const cleanup = ${turn}().then(() => {
                    running--;
                    events.push("settled:" + attempt);
                  });
                  cleanups.push(cleanup);
                  // Keep this checkpoint busy until the native grace timer is due.
                  let microtasks = 0;
                  const drain = () => {
                    if (microtasks++ < 10) queueMicrotask(drain);
                    else {
                      const until = performance.now() + 10;
                      while (performance.now() < until) {}
                    }
                  };
                  queueMicrotask(drain);
                  await cleanup;
                  throw new Error("cancelled");
                },
              },
              new globalThis.AbortController().signal,
            );
            await Promise.all(cleanups);
            globalThis.clearTimeout(watchdog);
            console.log(JSON.stringify({ result, attempts, maximumRunning, running, events }));
          `,
        ],
        { encoding: "utf8", timeout: 4_000 },
      );
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stderr).toBe("");
      expect(JSON.parse(child.stdout)).toEqual({
        result: {
          kind: "deferred",
          reason: "manifest-unavailable",
          nextCheckMs: 1_800_086_400_000,
        },
        attempts: 3,
        maximumRunning: 1,
        running: 0,
        events: ["start:1", "settled:1", "start:2", "settled:2", "start:3", "settled:3"],
      });
    },
    10_000,
  );
});
