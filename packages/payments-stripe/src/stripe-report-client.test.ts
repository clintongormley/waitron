import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertCapturedPayment } from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { StripeReconciler } from "./reconciler.js";
import { stripeReportClient } from "./stripe-report-client.js";
import { FakeStripe } from "./testing/fake-stripe.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  await suite.db.execute(sql`delete from payment_refunds`);
  await suite.db.execute(sql`delete from payments`);
  await suite.db.execute(sql`delete from incidents`);
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/** The two list calls `stripeReportClient` makes, answered from fixed pages. `amount`, `fee` and
 * `net` are Stripe's own fields on a balance transaction: `net` is `amount` less `fee`. */
function sdkWith(transactions: { amount: number; fee: number; net: number; pi: string }[]): Stripe {
  const pager = <T>(items: T[]) => ({
    autoPagingEach: async (each: (item: T) => void) => {
      for (const item of items) each(item);
    },
  });
  return {
    balanceTransactions: {
      list: () =>
        pager(
          transactions.map((t, i) => ({
            amount: t.amount,
            fee: t.fee,
            net: t.net,
            created: Math.floor(OLD.getTime() / 1000),
            type: "charge",
            source: { id: `ch_${i}`, payment_intent: t.pi },
          })),
        ),
    },
    checkout: { sessions: { list: () => pager([]) } },
  } as unknown as Stripe;
}

async function abandonedOrphan(paymentRef: string, externalRef: string): Promise<void> {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: deviceOrigin(seeded.deviceId),
      workingOrderId: seeded.workingOrderId,
      provider: "stripe",
      paymentRef,
      externalRef,
      amount: decimal("10.00"),
      settledAt: OLD,
    }),
  );
  await suite.db.execute(
    `update working_orders set status = 'abandoned' where id = '${seeded.workingOrderId}'`,
  );
}

function sweep(sdk: Stripe, refunder: FakeStripe): StripeReconciler {
  return new StripeReconciler({
    db: suite.db,
    resolveAccount: () => Promise.resolve({ report: stripeReportClient(sdk), refund: refunder }),
  });
}

describe("stripeReportClient: Stripe's fee never makes a payment held", () => {
  it("reads a charge's gross amount, not the amount left after Stripe's fee", async () => {
    const settlements = await stripeReportClient(
      sdkWith([{ amount: 1000, fee: 34, net: 966, pi: "pi_fee" }]),
    ).listSettlements(PERIOD);
    expect(settlements.map((s) => s.amountMinor)).toEqual([1000]);
  });

  it("refunds an orphan whose charge lost a fee, as an ordinary orphan", async () => {
    await abandonedOrphan("ref-fee", "pi_fee");
    const refunder = new FakeStripe();
    const result = await sweep(
      sdkWith([{ amount: 1000, fee: 34, net: 966, pi: "pi_fee" }]),
      refunder,
    ).reconcile(PERIOD, NOW);
    expect(result.drift).toEqual([]);
    expect(result.orphan.map((m) => m.settledAmount)).toEqual([decimal("10.00")]);
    expect(result.remediated).toBe(1);
    expect(refunder.lastRefund?.paymentIntentId).toBe("pi_fee");
  });

  it("holds an orphan whose GROSS amount differs, so the case above is not passing by default", async () => {
    await abandonedOrphan("ref-gross", "pi_gross");
    const refunder = new FakeStripe();
    const result = await sweep(
      sdkWith([{ amount: 1250, fee: 39, net: 1211, pi: "pi_gross" }]),
      refunder,
    ).reconcile(PERIOD, NOW);
    expect(result.drift.map((m) => m.settledAmount)).toEqual([decimal("12.50")]);
    expect(result.remediated).toBe(0);
    expect(refunder.lastRefund).toBeUndefined();
  });
});
