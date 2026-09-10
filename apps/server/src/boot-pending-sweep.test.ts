import { describe, expect, it, vi } from "vitest";
import type { ForwardResult, PaymentProvider } from "@waitron/payments";
import { withPendingSweep } from "./boot.js";
import type { PassReport } from "./pass.js";

// `withPendingSweep` is a PURE wrapper over the loop's `pass` — a stubbed `inner` and a fake provider
// suffice (no container). It runs the card provider's `resolvePending` around the singleton fiscal
// pass and returns the INNER report verbatim, so the `/health` contract is untouched by a sweep that
// runs, logs, or throws. See its header for why it is a wrapper, not a health-tracked duty.

const REPORT: PassReport = { duties: [], nextDueAt: null };

/** A `PaymentProvider`-shaped double: only `resolvePending` is called by `withPendingSweep`. */
function fakeProvider(resolvePending: () => Promise<ForwardResult>): PaymentProvider {
  return { resolvePending } as unknown as PaymentProvider;
}

describe("withPendingSweep", () => {
  it("returns `inner` unchanged and never calls the provider when there is no provider", async () => {
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const wrapped = withPendingSweep(inner, undefined, log);
    // Same function reference: no wrapper is layered on a no-card node.
    expect(wrapped).toBe(inner);
    expect(await wrapped(new Date())).toBe(REPORT);
    expect(log).not.toHaveBeenCalled();
  });

  it("calls resolvePending once, logs resolve_pending.complete, and returns the inner report verbatim", async () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const nextDueAt = new Date("2026-09-10T12:01:00.000Z");
    const result: ForwardResult = { nextDueAt, forwarded: 2, declined: 1, incidentsRaised: 0 };
    const resolvePending = vi.fn(async () => result);
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();

    const report = await withPendingSweep(inner, fakeProvider(resolvePending), log)(now);

    expect(report).toBe(REPORT);
    expect(resolvePending).toHaveBeenCalledTimes(1);
    expect(resolvePending).toHaveBeenCalledWith(now);
    expect(log).toHaveBeenCalledWith("info", "resolve_pending.complete", {
      captured: 2,
      failed: 1,
      incidentsRaised: 0,
      nextDueAt: "2026-09-10T12:01:00.000Z",
    });
  });

  it("logs nextDueAt as null when the sweep reports nothing pending", async () => {
    // The `r.nextDueAt?.toISOString() ?? null` null branch: an all-zeros ForwardResult (nothing left
    // pending) logs `nextDueAt: null`, not an ISO string.
    const result: ForwardResult = {
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    };
    const log = vi.fn();
    await withPendingSweep(
      async () => REPORT,
      fakeProvider(async () => result),
      log,
    )(new Date());
    expect(log).toHaveBeenCalledWith("info", "resolve_pending.complete", {
      captured: 0,
      failed: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    });
  });

  it("logs resolve_pending.failed and still returns the inner report when resolvePending rejects", async () => {
    const resolvePending = vi.fn(async () => {
      throw new Error("sweep boom");
    });
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();

    const report = await withPendingSweep(inner, fakeProvider(resolvePending), log)(new Date());

    // A sweep failure never breaks the pass — the inner report is returned unchanged.
    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: sweep boom",
    });
  });
});
