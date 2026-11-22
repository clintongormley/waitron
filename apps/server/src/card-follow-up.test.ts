import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import type { ForwardResult, PaymentProvider } from "@waitron/payments";
import { testCardFollowUp } from "./testing/card-follow-up.js";
import { createJobRunner, type JobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";

const epoch = Date.parse("2026-11-22T18:00:00Z");
const elapsed = () => Date.now() - epoch;
const advance = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const empty: ForwardResult = { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
const settled = { received: 0, failed: 0, pending: 0, errors: [] };
let runner: JobRunner;
let emit: (change: ResourceChange) => void;
const log = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  log.mockClear();
  runner = createJobRunner({
    now: () => new Date(),
    monotonicMs: elapsed,
    delay: fakeTimerDelay,
    log,
    subscribe: (subscriber) => {
      emit = subscriber;
      return () => {};
    },
  });
});

afterEach(async () => {
  await runner.stopJobs();
  vi.useRealTimers();
});

function provider(resolvePending: PaymentProvider["resolvePending"]): PaymentProvider {
  return { provider: "sumup", resolvePending } as PaymentProvider;
}

describe("card follow-up on the job runner", () => {
  it("runs at the earliest provider or refund due time with a five-second floor and minute ceiling", async () => {
    const passes: number[] = [];
    const providerDue = [12_000, 40_000, 90_000, 90_000];
    const refundDue = [25_000, 1_000, 70_000, 70_000];
    runner.add(
      testCardFollowUp(
        {
          sweepProviders: async () => [
            provider(async (now) => {
              passes.push(elapsed());
              return { ...empty, nextDueAt: new Date(now.getTime() + providerDue.shift()!) };
            }),
          ],
          recoverRefunds: async () => ({
            pending: 1,
            nextDueAt: new Date(Date.now() + refundDue.shift()!),
          }),
        },
        { getRole: () => "primary", recoversRefunds: true, admissionReady: () => true, log },
      ),
    );

    await advance(11_999);
    expect(passes).toEqual([0]);
    await advance(5_001);
    expect(passes).toEqual([0, 12_000, 17_000]);
    await advance(59_999);
    expect(passes).toEqual([0, 12_000, 17_000]);
    await advance(1);
    expect(passes).toEqual([0, 12_000, 17_000, 77_000]);
  });

  it("holds off until admission, then coalesces payment and refund changes", async () => {
    let ready = false;
    const passes: number[] = [];
    runner.add(
      testCardFollowUp(
        {
          sweepProviders: async () => {
            passes.push(elapsed());
            return [];
          },
        },
        { getRole: () => "primary", recoversRefunds: true, admissionReady: () => ready, log },
      ),
    );
    await advance(10_000);
    expect(passes).toEqual([]);
    ready = true;
    emit({ resources: [{ type: "payments" }] });
    await advance();
    expect(passes).toEqual([10_000]);
    for (const [index, type] of ["payments", "payment_refunds", "refunds"].entries()) {
      for (let write = 0; write < 3; write++) emit({ resources: [{ type }] });
      await advance(4_999);
      expect(passes).toHaveLength(index + 1);
      await advance(1);
      expect(passes.at(-1)).toBe(15_000 + index * 5_000);
    }
    await advance(5_000);
    expect(passes).toEqual([10_000, 15_000, 20_000, 25_000]);
  });

  it("tries settlement and refund recovery after a sweep throw and retries with backoff", async () => {
    const ran: string[] = [];
    runner.add(
      testCardFollowUp(
        {
          sweepProviders: async () => {
            ran.push("sweep");
            if (elapsed() === 0) throw Error("provider unavailable");
            return [];
          },
          settle: async () => {
            ran.push("settle");
            return settled;
          },
          recoverRefunds: async () => {
            ran.push("refunds");
            return { pending: 0, nextDueAt: null };
          },
        },
        { getRole: () => "primary", recoversRefunds: true, admissionReady: () => true, log },
      ),
    );

    await advance(4_999);
    expect(ran).toEqual(["sweep", "settle", "refunds"]);
    expect(runner.views()["card.follow_up"]?.consecutiveFailures).toBe(1);
    await advance(1);
    expect(ran).toEqual(["sweep", "settle", "refunds", "sweep", "settle", "refunds"]);
    expect(runner.views()["card.follow_up"]?.consecutiveFailures).toBe(0);
  });

  it("reads the role again before settlement and refund recovery", async () => {
    let role: "secondary" | "primary" = "secondary";
    const settle = vi.fn(async () => {
      role = "secondary";
      return settled;
    });
    const recoverRefunds = vi.fn(async () => ({ pending: 0, nextDueAt: null }));
    runner.add(
      testCardFollowUp(
        {
          sweepProviders: async () => [
            provider(async () => {
              role = "primary";
              return empty;
            }),
          ],
          settle,
          recoverRefunds,
        },
        { getRole: () => role, log },
      ),
    );

    await advance();
    expect(settle).toHaveBeenCalledOnce();
    expect(recoverRefunds).not.toHaveBeenCalled();
  });

  it("starts shutting down request-owned refund resolvers even before the first sweep returns", async () => {
    let release = () => {};
    const stopRefundResolvers = vi.fn(async () => []);
    runner.add(
      testCardFollowUp(
        {
          sweepProviders: () =>
            new Promise((resolve) => {
              release = () => resolve([]);
            }),
          stopRefundResolvers,
        },
        { getRole: () => "primary", recoversRefunds: true, admissionReady: () => true, log },
      ),
    );

    runner.signalStepdown();
    try {
      expect(stopRefundResolvers).toHaveBeenCalledOnce();
    } finally {
      release();
    }
  });

  it("starts refund resolvers on promotion and stops them immediately during the next sweep", async () => {
    let role: "secondary" | "primary" = "secondary";
    const ran: string[] = [];
    let release = () => {};
    runner.add(
      testCardFollowUp(
        {
          sweepProviders: async () => {
            if (elapsed() === 10_000)
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            return [];
          },
          startRefundResolvers: () => ran.push("start"),
          recoverRefunds: async () => {
            ran.push("recover");
            return { pending: 0, nextDueAt: null };
          },
          stopRefundResolvers: async () => {
            ran.push("stop");
            return ["still-out"];
          },
        },
        { getRole: () => role, recoversRefunds: true, admissionReady: () => true, log },
      ),
    );
    await advance();
    expect(ran).toEqual([]);
    role = "primary";
    emit({ resources: [{ type: "refunds" }] });
    await advance(5_000);
    expect(ran).toEqual(["start", "recover"]);
    emit({ resources: [{ type: "payments" }] });
    await advance(5_000);
    runner.signalStepdown();
    try {
      expect(ran).toEqual(["start", "recover", "stop"]);
    } finally {
      release();
    }
    await runner.stopJobs();
    expect(ran).toEqual(["start", "recover", "stop"]);
    expect(
      log.mock.calls.filter(([, event]) => event === "tender_refund.shutdown_pending"),
    ).toEqual([["warn", "tender_refund.shutdown_pending", { refundIds: ["still-out"] }]]);
  });
});
