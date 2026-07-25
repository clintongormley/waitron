import { describe, expect, it } from "vitest";
import { FakeStripeReport } from "./fake-stripe-report.js";

const WINDOW = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

describe("FakeStripeReport", () => {
  it("returns the configured settlements and records the window it was asked for", async () => {
    const fake = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1250, settledAt: new Date(0) },
      ],
    });
    expect(await fake.listSettlements(WINDOW)).toHaveLength(1);
    expect(fake.settlementWindows).toEqual([WINDOW]);
  });

  it("returns the configured sessions and records their window separately", async () => {
    const fake = new FakeStripeReport({
      sessions: [{ sessionId: "cs_1", paymentIntentId: "pi_1" }],
    });
    expect(await fake.listCheckoutSessions(WINDOW)).toEqual([
      { sessionId: "cs_1", paymentIntentId: "pi_1" },
    ]);
    expect(fake.sessionWindows).toEqual([WINDOW]);
    expect(fake.settlementWindows).toEqual([]);
  });

  it("resolves a session to its payment intent, and to null when unknown", async () => {
    const fake = new FakeStripeReport({
      sessions: [{ sessionId: "cs_1", paymentIntentId: "pi_1" }],
    });
    expect(await fake.paymentIntentForSession("cs_1")).toBe("pi_1");
    expect(await fake.paymentIntentForSession("cs_missing")).toBeNull();
  });

  it("defaults every collection to empty", async () => {
    const fake = new FakeStripeReport();
    expect(await fake.listSettlements(WINDOW)).toEqual([]);
    expect(await fake.listCheckoutSessions(WINDOW)).toEqual([]);
  });
});
