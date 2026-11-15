import { afterEach, describe, expect, it, vi } from "vitest";
import type { SilentReason } from "./boot-peer-check.js";
import { startMainSilenceWatch, type MainAskResult } from "./main-silence-watch.js";

const T0 = Date.UTC(2026, 10, 15, 21, 0);

afterEach(() => {
  vi.useRealTimers();
});

/** Each ask takes `takesMs` and gives the next scripted result; the last one repeats. */
function watch(
  script: (MainAskResult | Error)[],
  options: { takesMs?: number; silentFromFirst?: boolean } = {},
) {
  vi.useFakeTimers({ now: T0 });
  const asks: number[] = [];
  const changes: boolean[] = [];
  const log = vi.fn();
  const w = startMainSilenceWatch({
    ask: async () => {
      asks.push(Date.now() - T0);
      if (options.takesMs !== undefined)
        await new Promise((resolve) => setTimeout(resolve, options.takesMs));
      const next = script.length > 1 ? script.shift()! : script[0]!;
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => Date.now(),
    intervalMs: 5_000,
    silentAfterMs: 20_000,
    silentFromFirst: options.silentFromFirst ?? false,
    onChange: (silent) => changes.push(silent),
    log,
  });
  return { w, asks, changes, log };
}

/** Lets the ask in flight finish, as the real one does within its time limit. */
async function stopNow(w: { stop(): Promise<void> }): Promise<void> {
  const stopping = w.stop();
  await vi.advanceTimersByTimeAsync(5_000);
  await stopping;
}

const repeat = <T>(value: T, times: number): T[] => Array.from({ length: times }, () => value);

describe("the spare's watch on its main server", () => {
  it("silent 20 seconds after the first unreachable ask, not before", async () => {
    const { w, asks } = watch(["unreachable"], { takesMs: 5_000 });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(w.state()).toEqual({ silentSinceMs: T0, reached: true, silent: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(asks).toEqual([0, 5_000, 10_000, 15_000, 20_000]);
    expect(w.state()).toEqual({ silentSinceMs: T0, reached: true, silent: true });
    // The responder reads it for every query heard on the network.
    expect(w.state()).toBe(w.state());
    await stopNow(w);
  });

  it.each(["refused", "not_established", "certificate", "answered", new Error("boom")] as const)(
    "any other result, or a throwing ask, ends the silence at once: %s",
    async (result) => {
      const { w, log } = watch([...repeat<MainAskResult>("unreachable", 6), result]);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(w.state()).toEqual({ silentSinceMs: T0, reached: true, silent: true });
      await vi.advanceTimersByTimeAsync(1);
      expect(w.state()).toEqual({ silentSinceMs: null, reached: true, silent: false });
      const failed = log.mock.calls.filter(([, event]) => event === "main_silence.ask_failed");
      expect(failed).toEqual(
        result instanceof Error
          ? [["warn", "main_silence.ask_failed", { errorCode: "unknown" }]]
          : [],
      );
      await w.stop();
    },
  );

  it("a box never reached is never silent", async () => {
    const { w, asks } = watch(["not_established"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asks).toHaveLength(13);
    expect(w.state()).toEqual({ silentSinceMs: null, reached: false, silent: false });
    await w.stop();
  });

  it("silentFromFirst counts the first unreachable ask as silent", async () => {
    for (const silentFromFirst of [true, false]) {
      const { w } = watch(["unreachable"], { takesMs: 5_000, silentFromFirst });
      await vi.advanceTimersByTimeAsync(5_000);
      expect({ silentFromFirst, state: w.state() }).toEqual({
        silentFromFirst,
        state: { silentSinceMs: T0, reached: true, silent: silentFromFirst },
      });
      await stopNow(w);
      vi.useRealTimers();
    }
  });

  it("silentFromFirst no longer counts once another result has come between", async () => {
    const { w } = watch(["answered", "unreachable"], { silentFromFirst: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.state()).toEqual({ silentSinceMs: T0 + 5_000, reached: true, silent: false });
    await w.stop();
  });

  it("stop() waits for the ask in flight and asks no more", async () => {
    const { w, asks } = watch(["unreachable"], { takesMs: 5_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const stopping = w.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asks).toEqual([0]);
  });

  it("onChange fires when silent flips, and only then", async () => {
    const reasons: (MainAskResult | Error)[] = [
      ...repeat<SilentReason>("unreachable", 7),
      ...repeat<MainAskResult>("answered", 2),
      "unreachable",
    ];
    const { w, changes, log } = watch(reasons);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(changes).toEqual([true]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changes).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changes).toEqual([true, false]);
    expect(log.mock.calls.map(([, event]) => event)).toEqual([
      "main_silence.silent",
      "main_silence.answering",
    ]);
    await w.stop();
  });
});
