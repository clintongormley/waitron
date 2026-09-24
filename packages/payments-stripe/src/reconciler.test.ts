import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertCapturedPayment, insertInitiated } from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { StripeReconciler } from "./reconciler.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";
import { FakeStripe } from "./testing/fake-stripe.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // Child before parent: `payment_refunds.payment_id` references `payments(id)` ON DELETE restrict.
  await pg.db.execute(sql`delete from payment_refunds`);
  await pg.db.execute(sql`delete from payments`);
  await pg.db.execute(sql`delete from incidents`);
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

function reconciler(
  client: FakeStripeReport,
  refunder: FakeStripe = new FakeStripe(),
): StripeReconciler {
  return new StripeReconciler({
    db: pg.db,
    nodeId: "11111111-1111-4111-8111-111111111111",
    resolveAccount: () => Promise.resolve({ report: client, refund: refunder }),
  });
}

/** A `captured` stripe payment on an ABANDONED working order — the auto-reversible orphan shape:
 * money we hold, no sale, and a working order that will never produce one. */
async function abandonedOrphan(params: {
  workingOrderId: string;
  paymentRef: string;
  externalRef: string;
}): Promise<void> {
  await withTransaction(pg.db, (tx) =>
    insertCapturedPayment(tx, {
      workingOrderId: params.workingOrderId,
      provider: "stripe",
      paymentRef: params.paymentRef,
      externalRef: params.externalRef,
      amount: decimal("10.00"),
      settledAt: OLD,
    }),
  );
  await pg.db.execute(
    `update working_orders set status = 'abandoned' where id = '${params.workingOrderId}'`,
  );
}

describe("StripeReconciler", () => {
  it("audits the settlement identity, not one capture mechanism", () => {
    expect(reconciler(new FakeStripeReport()).provider).toBe("stripe");
  });

  it("matches a terminal row by its payment intent and reports no mismatch", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    // No sale, but the working order is still open, so this is not an orphan — the clean case.
    await withTransaction(pg.db, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: seeded.workingOrderId,
        provider: "stripe",
        paymentRef: "ref-terminal",
        externalRef: "pi_terminal",
        amount: decimal("10.00"),
        settledAt: OLD,
      }),
    );
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_terminal", chargeId: "ch_1", amountMinor: 1000, settledAt: OLD },
      ],
    });
    const result = await reconciler(client).reconcile(PERIOD, NOW);
    expect(result.checked).toBe(1);
    expect(result.unsettled).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.missingLocal).toEqual([]);
  });

  it("matches a HOSTED row by its checkout session id, which the ledger never carries", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await withTransaction(pg.db, (tx) =>
      insertInitiated(tx, {
        workingOrderId: seeded.workingOrderId,
        provider: "stripe",
        paymentRef: "ref-hosted",
        externalRef: "cs_hosted",
        amount: decimal("10.00"),
      }),
    );
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_hosted", chargeId: "ch_2", amountMinor: 1000, settledAt: OLD },
      ],
      sessions: [{ sessionId: "cs_hosted", paymentIntentId: "pi_hosted" }],
    });
    const result = await reconciler(client).reconcile(now, NOW);
    expect(result.lostSettlement).toHaveLength(1);
    expect(result.missingLocal).toEqual([]);
  });

  it("reports a settlement with no local row as missingLocal", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_ghost", chargeId: "ch_ghost", amountMinor: 1000, settledAt: OLD },
      ],
    });
    const result = await reconciler(client).reconcile(PERIOD, NOW);
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0].references).toEqual(["pi_ghost", "ch_ghost"]);
  });

  it("threads a caller-supplied settlementLagMs to BOTH windows it must reach", async () => {
    // Pins that ONE supplied value reaches both consumers: a divergence would silently unmatch every
    // hosted payment. It must differ from the seven-day default and exceed the report source's 24h
    // session-lookback floor, or the floor rather than the lag would set the backwards edge.
    const LAG_MS = 2 * 24 * 60 * 60 * 1000;
    const client = new FakeStripeReport();
    const r = new StripeReconciler({
      db: pg.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      resolveAccount: () => Promise.resolve({ report: client, refund: new FakeStripe() }),
      settlementLagMs: LAG_MS,
    });
    await r.reconcile(PERIOD, NOW);

    expect(client.settlementWindows[0]).toEqual({
      from: PERIOD.from,
      to: new Date(PERIOD.to.getTime() + LAG_MS),
    });
    expect(client.sessionWindows[0]).toEqual({
      from: new Date(PERIOD.from.getTime() - LAG_MS),
      to: new Date(PERIOD.to.getTime() + LAG_MS),
    });
  });

  it("resolves the account on every sweep, so a rotated credential is picked up", async () => {
    let resolved = 0;
    const client = new FakeStripeReport();
    const r = new StripeReconciler({
      db: pg.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      resolveAccount: () => {
        resolved += 1;
        return Promise.resolve({ report: client, refund: new FakeStripe() });
      },
    });
    await r.reconcile(PERIOD, NOW);
    await r.reconcile(PERIOD, NOW);
    expect(resolved).toBe(2);
  });

  it("auto-reverses a hosted orphan by resolving its session to a payment intent", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await abandonedOrphan({
      workingOrderId: seeded.workingOrderId,
      paymentRef: "ref-hosted-orphan",
      externalRef: "cs_orphan",
    });
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_orphan", chargeId: "ch_o", amountMinor: 1000, settledAt: OLD },
      ],
      sessions: [{ sessionId: "cs_orphan", paymentIntentId: "pi_orphan" }],
    });
    const refunder = new FakeStripe();
    const result = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([]);
    // The stored ref was `cs_orphan`; the refund went to the PaymentIntent behind it.
    expect(refunder.lastRefund?.paymentIntentId).toBe("pi_orphan");
  });

  it("auto-reverses a terminal orphan against its stored payment intent, unresolved", async () => {
    // This report carries no sessions at all, so a lookup would resolve to null and fail the
    // reversal.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await abandonedOrphan({
      workingOrderId: seeded.workingOrderId,
      paymentRef: "ref-terminal-orphan",
      externalRef: "pi_terminal_orphan",
    });
    const client = new FakeStripeReport({
      settlements: [
        {
          paymentIntentId: "pi_terminal_orphan",
          chargeId: "ch_t",
          amountMinor: 1000,
          settledAt: OLD,
        },
      ],
    });
    const refunder = new FakeStripe();
    const result = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([]);
    expect(refunder.lastRefund?.paymentIntentId).toBe("pi_terminal_orphan");
  });

  it("fails one hosted orphan's reversal when its session was never paid, and never retries it", async () => {
    // The marker is stamped before the attempt, so a failed reversal is never attempted again.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await abandonedOrphan({
      workingOrderId: seeded.workingOrderId,
      paymentRef: "ref-unpaid-orphan",
      externalRef: "cs_unpaid",
    });
    const client = new FakeStripeReport({ sessions: [] });
    const refunder = new FakeStripe();
    const sweep = reconciler(client, refunder);
    const result = await sweep.reconcile(PERIOD, NOW);
    expect(result.remediated).toBe(0);
    expect(result.remediationFailures).toEqual([
      { paymentRef: "ref-unpaid-orphan", reason: "payment.not_found" },
    ]);
    expect(refunder.lastRefund).toBeUndefined(); // no money moved
    // The marker is permanent by design: the next sweep still SEES the orphan but claims nothing.
    const again = await sweep.reconcile(PERIOD, NOW);
    expect(again.orphan).toHaveLength(1);
    expect(again.remediated).toBe(0);
    expect(again.remediationFailures).toEqual([]);
  });
});
