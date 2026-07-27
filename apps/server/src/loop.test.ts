import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { PassReport } from "./pass.js";
import { realSleep, runLoop, sleepMsFor, type LoopDeps } from "./loop.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const MIN = 5_000;
const MAX = 3_600_000;

function report(nextDueAt: Date | null): PassReport {
  return { duties: [{ duty: "fiscal.drain", ok: true, nextDueAt }], nextDueAt };
}

describe("sleepMsFor", () => {
  it("sleeps until the due time when it lies inside the clamps", () => {
    expect(sleepMsFor(new Date("2026-07-26T09:10:00Z"), NOW, MIN, MAX)).toBe(600_000);
  });

  it("never sleeps longer than the max, however distant the due time", () => {
    // A liveness floor, not a tuning knob: drain's hourly duty must not be lengthened by a quiet
    // ledger, nor by a nextDueAt computed before a till wrote a sale.
    expect(sleepMsFor(new Date("2026-08-01T00:00:00Z"), NOW, MIN, MAX)).toBe(MAX);
  });

  it("never sleeps less than the min, even for work due now or overdue", () => {
    expect(sleepMsFor(NOW, NOW, MIN, MAX)).toBe(MIN);
    expect(sleepMsFor(new Date("2026-07-26T08:00:00Z"), NOW, MIN, MAX)).toBe(MIN);
  });

  it("sleeps the max when there is no work anywhere", () => {
    expect(sleepMsFor(null, NOW, MIN, MAX)).toBe(MAX);
  });
});

describe("runLoop", () => {
  function harness(over: Partial<LoopDeps> = {}) {
    const controller = new AbortController();
    const slept: number[] = [];
    const lines: string[] = [];
    const passes: Date[] = [];
    const deps: LoopDeps = {
      pass: (at) => {
        passes.push(at);
        return Promise.resolve(report(null));
      },
      now: () => NOW,
      sleep: (ms) => {
        slept.push(ms);
        // Three passes is enough to show the loop loops; the fourth sleep stops it.
        if (slept.length >= 3) controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event) => lines.push(`${level} ${event}`),
      ...over,
    };
    return { deps, controller, slept, lines, passes };
  }

  it("passes repeatedly, sleeping the clamped interval between", async () => {
    const h = harness();
    await runLoop(h.deps);
    expect(h.passes).toHaveLength(3);
    expect(h.slept).toEqual([MAX, MAX, MAX]);
  });

  it("returns without passing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness({ signal: controller.signal });
    await runLoop({ ...h.deps, signal: controller.signal });
    expect(h.passes).toEqual([]);
  });

  it("finishes the pass in flight when the signal aborts mid-pass, then stops", async () => {
    const controller = new AbortController();
    let finished = false;
    const h = harness({ signal: controller.signal });
    await runLoop({
      ...h.deps,
      signal: controller.signal,
      pass: async () => {
        controller.abort();
        await Promise.resolve();
        finished = true;
        return report(null);
      },
    });
    // Politeness, not correctness — the duties are already crash-safe — but it must not become a
    // reason to abandon a partially-submitted batch.
    expect(finished).toBe(true);
    expect(h.slept).toEqual([]);
  });

  it("keeps looping when a pass itself throws", async () => {
    // runPass contains its own duties' failures, so a throw HERE is something unforeseen — a bug in
    // the pass, or an OOM in a log sink. The loop still must not die: a process that exits on the
    // unforeseen breaches the hourly duty in exactly the case nobody predicted.
    const controller = new AbortController();
    const slept: number[] = [];
    let calls = 0;
    const lines: string[] = [];
    await runLoop({
      pass: () => {
        calls += 1;
        return Promise.reject(new Error("unforeseen"));
      },
      now: () => NOW,
      sleep: (ms) => {
        slept.push(ms);
        if (slept.length >= 2) controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event) => lines.push(`${level} ${event}`),
    });
    expect(calls).toBe(2);
    // Retried on the floor, not the ceiling: an unexplained pass failure is due now.
    expect(slept).toEqual([MIN, MIN]);
    expect(lines).toContain("error pass.threw");
  });

  it("logs pass.threw with a structured code, never the raw error message", async () => {
    // Whatever reaches this branch is by definition unclassified — `runPass` already turned every
    // ordinary duty failure into a `DutyReport` before it got here — so a bare `.message` could
    // carry anything a driver or client library chose to embed, like connection credentials.
    const controller = new AbortController();
    const events: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
    const secret = "postgres://user:hunter2@host/db";
    await runLoop({
      pass: () => Promise.reject(new Error(`connection failed: ${secret}`)),
      now: () => NOW,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event, fields) => events.push({ level, event, fields }),
    });
    const threw = events.find((e) => e.event === "pass.threw");
    // A plain Error (not an AppError) has no code of its own, so "unknown" is the honest reading —
    // and critically, the field set is exactly this, with no `message` key at all.
    expect(threw?.fields).toEqual({ errorCode: "unknown" });
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("logs pass.threw's real code when the throw is an AppError", async () => {
    const controller = new AbortController();
    const events: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
    await runLoop({
      pass: () =>
        Promise.reject(
          new AppError("server.credential_unusable", {
            tenantId: "t",
            purpose: "fiscal.aeat",
            field: "certKind",
          }),
        ),
      now: () => NOW,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event, fields) => events.push({ level, event, fields }),
    });
    const threw = events.find((e) => e.event === "pass.threw");
    expect(threw?.fields).toEqual({ errorCode: "server.credential_unusable" });
  });

  it("hands each report to onPass so health state can follow it", async () => {
    const seen: PassReport[] = [];
    const h = harness({ onPass: (r) => seen.push(r) });
    await runLoop({ ...h.deps, onPass: (r) => seen.push(r) });
    expect(seen).toHaveLength(3);
  });

  it("labels an onPass failure separately from a pass failure and keeps the pass's own nextDueAt", async () => {
    // The pass itself succeeded here; only the health-state observer misbehaved. Confusing this
    // with a pass failure would both misdirect a reader hunting the wrong file AND wrongly discard
    // a legitimate nextDueAt in favour of a false due-immediately retry.
    const controller = new AbortController();
    const events: { level: string; event: string }[] = [];
    const slept: number[] = [];
    const dueAt = new Date("2026-07-26T09:10:00Z");
    await runLoop({
      pass: () => Promise.resolve(report(dueAt)),
      now: () => NOW,
      sleep: (ms) => {
        slept.push(ms);
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event) => events.push({ level, event }),
      onPass: () => {
        throw new Error("health sink boom");
      },
    });
    expect(events.map((e) => e.event)).toContain("onPass.threw");
    expect(events.map((e) => e.event)).not.toContain("pass.threw");
    // 600_000ms — the pass's real 10-minute nextDueAt, clamped as normal. An implementation that
    // conflated the two failures would instead report `startedAt` (due now) and sleep MIN.
    expect(slept).toEqual([600_000]);
  });

  it("keeps looping when sleep itself rejects with something other than the abort", async () => {
    // A well-behaved sleep resolves — never rejects — for the ordinary abort (see realSleep), so a
    // rejection reaching runLoop is itself unforeseen: structurally the same case as a pass that
    // throws, and it must be contained the same way rather than ending the loop and, with it, the
    // hourly duty.
    const controller = new AbortController();
    const events: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
    let calls = 0;
    let sleepCalls = 0;
    await runLoop({
      pass: () => {
        calls += 1;
        return Promise.resolve(report(null));
      },
      now: () => NOW,
      sleep: () => {
        sleepCalls += 1;
        if (sleepCalls === 1) return Promise.reject(new Error("sleep backend unavailable"));
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event, fields) => events.push({ level, event, fields }),
    });
    // The loop survived the rejection and passed again — not just "didn't crash": a version that
    // let the rejection propagate would never reach the second pass, and `await runLoop(...)` would
    // itself reject, failing this test outright before any assertion below ran.
    expect(calls).toBe(2);
    const threw = events.filter((e) => e.event === "sleep.threw");
    // Exactly one line, naming the failure with a code — never the raw message, same reason as
    // pass.threw.
    expect(threw).toHaveLength(1);
    expect(threw[0]?.fields).toEqual({ errorCode: "unknown" });
  });
});

describe("realSleep", () => {
  it("resolves after the real delay elapses", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    await realSleep(20, controller.signal);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
  });

  it("resolves promptly when the signal is already aborted, rather than waiting out the duration", async () => {
    const controller = new AbortController();
    controller.abort();
    const startedAt = Date.now();
    await realSleep(5_000, controller.signal);
    // A version that swallowed the abort by waiting out the full duration would take ~5000ms here;
    // a broken test that didn't measure elapsed time would pass either way.
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  // realSleep's non-abort rethrow has no reachable trigger through this repo's own call sites (see
  // its /* v8 ignore start */ / stop block) — a cast-driven "malformed signal" test would only
  // prove a shape no real caller can produce. runLoop's own "keeps looping when sleep itself
  // rejects" test, above, exercises the actual contract this rethrow exists to serve: an injected
  // `sleep` that rejects for a reason other than the abort must not go unnoticed or end the loop.
});
