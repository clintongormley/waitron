import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { PaymentResult, PaymentResultState } from "./provider.js";

describe("PaymentResult shape", () => {
  it("accepts a captured online result", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-1",
      state: "captured",
      amount: decimal("10.00"),
      settledAt: new Date("2026-07-22T10:00:00Z"),
    };
    expect(r.state satisfies PaymentResultState).toBe("captured");
    expect(r.settledAt).not.toBeNull();
  });

  it("accepts a failed result with no settlement", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-2",
      state: "failed",
      amount: decimal("10.00"),
      settledAt: null,
    };
    expect(r.settledAt).toBeNull();
  });

  it("accepts an offline-accepted result carrying the offline flag", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-3",
      state: "accepted_offline",
      amount: decimal("10.00"),
      settledAt: new Date("2026-07-22T10:00:00Z"),
      offline: true,
    };
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
  });

  it("accepts a network_unavailable result (return-only, nothing settled)", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-4",
      state: "network_unavailable",
      amount: decimal("10.00"),
      settledAt: null,
    };
    expect(r.state).toBe("network_unavailable");
  });
});
