import { describe, expect, it } from "vitest";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { DEFAULT_SETTLEMENT_LAG_MS } from "@waitron/payments";
import { stripeSettlementReport } from "./report-source.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";

const TENANT = brandTenantId("11111111-1111-1111-1111-111111111111");
const WINDOW = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-09T00:00:00Z") };
const SETTLED_AT = new Date("2026-07-02T10:00:00Z");

describe("stripeSettlementReport", () => {
  it("carries the payment intent and charge ids as references", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1250, settledAt: SETTLED_AT },
      ],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(record.references).toEqual(["pi_1", "ch_1"]);
    expect(record.amount).toBe(decimal("12.50"));
    expect(record.settledAt).toEqual(SETTLED_AT);
    expect(record.hint).toBeUndefined();
  });

  it("adds the checkout session id when one maps to the payment intent", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1250, settledAt: SETTLED_AT },
      ],
      sessions: [{ sessionId: "cs_1", paymentIntentId: "pi_1" }],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    // The session id is what a HOSTED payments row stores in external_ref; without it every hosted
    // payment reads as `unsettled` for ever and every hosted settlement as `missingLocal`.
    expect(record.references).toEqual(["pi_1", "ch_1", "cs_1"]);
  });

  it("carries the session metadata through as the attribution hint", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 500, settledAt: SETTLED_AT },
      ],
      sessions: [
        {
          sessionId: "cs_1",
          paymentIntentId: "pi_1",
          hint: { workingOrderId: "wo-1", paymentRef: "ref-1" },
        },
      ],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(record.hint).toEqual({ workingOrderId: "wo-1", paymentRef: "ref-1" });
  });

  it("omits a null payment intent from the references rather than emitting a null id", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: null, chargeId: "ch_1", amountMinor: 100, settledAt: SETTLED_AT },
      ],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(record.references).toEqual(["ch_1"]);
  });

  it("widens the session window BACKWARDS by the settlement lag, leaving the ledger window alone", async () => {
    const client = new FakeStripeReport();
    await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(TENANT, WINDOW);
    // The ledger pass asks for exactly the window the sweep gave it...
    expect(client.settlementWindows).toEqual([WINDOW]);
    // ...while the session pass reaches further back, because a session created BEFORE the window
    // can have its charge settle inside it. The seven-day default comfortably exceeds the 24h
    // lookback floor, so the lag itself is what sets this window (the floor's own case is below).
    expect(client.sessionWindows[0].from).toEqual(
      new Date(WINDOW.from.getTime() - DEFAULT_SETTLEMENT_LAG_MS),
    );
    expect(client.sessionWindows[0].to).toEqual(WINDOW.to);
  });

  it("never lets a short settlement tolerance shrink the session lookback below 24h", async () => {
    // The two quantities are different things: `settlementLagMs` is how long the processor may take
    // to REPORT a settlement, while the session lookback is how long before its charge a session may
    // have been CREATED — bounded by Stripe's 24h Checkout expiry, not by our tolerance. An operator
    // tightening the tolerance to an hour must not silently narrow this window: every hosted payment
    // whose session was created earlier would lose its `cs_` reference, read as `unsettled` for ever,
    // and have its settlement read as `missingLocal`. The literal 24h is written out rather than
    // imported, so changing the constant cannot quietly change what this test demands.
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const client = new FakeStripeReport();
    await stripeSettlementReport(client, ONE_HOUR_MS).fetch(TENANT, WINDOW);

    expect(client.sessionWindows[0].from).toEqual(
      new Date(WINDOW.from.getTime() - 24 * 60 * 60 * 1000),
    );
    // The LEDGER pass is untouched by the floor — it takes the sweep's window verbatim, and widening
    // it here would audit settlements from outside the period the caller asked about.
    expect(client.settlementWindows).toEqual([WINDOW]);
  });

  it("converts minor units exactly, including amounts a float would mangle", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1010, settledAt: SETTLED_AT },
        { paymentIntentId: "pi_2", chargeId: "ch_2", amountMinor: 7, settledAt: SETTLED_AT },
      ],
    });
    const records = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(records.map((r) => r.amount)).toEqual([decimal("10.10"), decimal("0.07")]);
  });

  it("returns an empty report without inventing records", async () => {
    const client = new FakeStripeReport();
    expect(
      await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(TENANT, WINDOW),
    ).toEqual([]);
  });
});
