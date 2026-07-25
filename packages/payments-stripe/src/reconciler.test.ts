import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertCapturedPayment, insertInitiated } from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { StripeReconciler } from "./reconciler.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";
import { FakeStripe } from "./testing/fake-stripe.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute("truncate incidents, payment_refunds, payments cascade");
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

function reconciler(
  client: FakeStripeReport,
  refunder: FakeStripe = new FakeStripe(),
): StripeReconciler {
  return new StripeReconciler({
    db,
    resolveAccount: () => Promise.resolve({ report: client, refund: refunder }),
  });
}

/** A `captured` stripe payment on an ABANDONED working order — the auto-reversible orphan shape:
 * money we hold, no sale, and a working order that will never produce one. */
async function abandonedOrphan(params: {
  tenantId: string;
  workingOrderId: string;
  paymentRef: string;
  externalRef: string;
}): Promise<void> {
  await withTenant(db, params.tenantId, (tx) =>
    insertCapturedPayment(tx, {
      tenantId: params.tenantId,
      workingOrderId: params.workingOrderId,
      provider: "stripe",
      paymentRef: params.paymentRef,
      externalRef: params.externalRef,
      amount: decimal("10.00"),
      settledAt: OLD,
    }),
  );
  await db.execute(
    `update working_orders set status = 'abandoned' where id = '${params.workingOrderId}'`,
  );
}

describe("StripeReconciler", () => {
  it("audits the settlement identity, not one capture mechanism", () => {
    expect(reconciler(new FakeStripeReport()).provider).toBe("stripe");
  });

  it("matches a terminal row by its payment intent and reports no mismatch", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    // No sale, but the working order is still open, so this is not an orphan — the clean case.
    await withTenant(db, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
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
    const result = await reconciler(client).reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(result.checked).toBe(1);
    expect(result.unsettled).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.missingLocal).toEqual([]);
  });

  it("matches a HOSTED row by its checkout session id, which the ledger never carries", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await withTenant(db, seeded.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
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
    const result = await reconciler(client).reconcile(brandTenantId(seeded.tenantId), now, NOW);
    // The bridge worked: the local `initiated` row was matched, so this is the missed-webhook
    // class rather than an unrecognised settlement.
    expect(result.lostSettlement).toHaveLength(1);
    expect(result.missingLocal).toEqual([]);
  });

  it("reports a settlement with no local row as missingLocal", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_ghost", chargeId: "ch_ghost", amountMinor: 1000, settledAt: OLD },
      ],
    });
    const result = await reconciler(client).reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0].references).toEqual(["pi_ghost", "ch_ghost"]);
  });

  it("threads a caller-supplied settlementLagMs to BOTH windows it must reach", async () => {
    // No test elsewhere in this suite ever supplies `settlementLagMs`, so every other case takes
    // only the `?? DEFAULT_SETTLEMENT_LAG_MS` fallback branch. That leaves two things unpinned: that
    // an explicit override is honoured at all, and — the money-critical part — that the SAME value
    // reaches both consumers `reconcile` hands it to. The neutral sweep (`reconcilePayments`) widens
    // the settlement pass's `to` FORWARDS by it; `stripeSettlementReport` separately widens the
    // session pass's `from` BACKWARDS by it. A divergence between the two — e.g. a future refactor
    // that reads the option twice and defaults each read independently — would silently unmatch
    // every hosted payment without failing loudly anywhere.
    //
    // The value must EXCEED the report source's 24h session-lookback floor, or the backwards window
    // would be set by the floor rather than by the lag and this test would stop proving that the one
    // value reached both consumers. Two days: not the seven-day default (so the override is really
    // honoured), comfortably above the floor (so the lag is what sets both edges).
    const seeded = await seedWorkingOrder(db, freshNif());
    const LAG_MS = 2 * 24 * 60 * 60 * 1000;
    const client = new FakeStripeReport();
    const r = new StripeReconciler({
      db,
      resolveAccount: () => Promise.resolve({ report: client, refund: new FakeStripe() }),
      settlementLagMs: LAG_MS,
    });
    await r.reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);

    // Forward-widened ledger window, using the supplied lag rather than the seven-day default.
    expect(client.settlementWindows[0]).toEqual({
      from: PERIOD.from,
      to: new Date(PERIOD.to.getTime() + LAG_MS),
    });
    // Backward-widened session window, off the SAME already-forward-widened `to` — proving the one
    // value flowed to both places, not two independently-defaulted ones that happened to agree only
    // because both fell back to the same default.
    expect(client.sessionWindows[0]).toEqual({
      from: new Date(PERIOD.from.getTime() - LAG_MS),
      to: new Date(PERIOD.to.getTime() + LAG_MS),
    });
  });

  it("resolves a per-tenant account for every sweep", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const asked: string[] = [];
    const client = new FakeStripeReport();
    const r = new StripeReconciler({
      db,
      resolveAccount: (tenantId) => {
        asked.push(tenantId);
        return Promise.resolve({ report: client, refund: new FakeStripe() });
      },
    });
    await r.reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(asked).toEqual([seeded.tenantId]);
  });

  it("auto-reverses a hosted orphan by resolving its session to a payment intent", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await abandonedOrphan({
      tenantId: seeded.tenantId,
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
    const result = await reconciler(client, refunder).reconcile(
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([]);
    // The stored ref was `cs_orphan`; the refund went to the PaymentIntent behind it.
    expect(refunder.lastRefund?.paymentIntentId).toBe("pi_orphan");
  });

  it("auto-reverses a terminal orphan against its stored payment intent, unresolved", async () => {
    // The other half of the resolver: a non-`cs_` ref IS already the identifier `stripe.refunds`
    // wants, so it must pass straight through — the report client is never consulted for it. This
    // report carries no sessions at all, so a lookup would resolve to null and fail the reversal.
    const seeded = await seedWorkingOrder(db, freshNif());
    await abandonedOrphan({
      tenantId: seeded.tenantId,
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
    const result = await reconciler(client, refunder).reconcile(
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([]);
    expect(refunder.lastRefund?.paymentIntentId).toBe("pi_terminal_orphan");
  });

  it("fails one hosted orphan's reversal when its session was never paid, and never retries it", async () => {
    // A session with no PaymentIntent behind it: nobody paid, so there is nothing to hand back.
    // `payment.not_found` is the honest outcome — reported, incident-raised, and (because the
    // marker was stamped before the attempt) never attempted again.
    const seeded = await seedWorkingOrder(db, freshNif());
    await abandonedOrphan({
      tenantId: seeded.tenantId,
      workingOrderId: seeded.workingOrderId,
      paymentRef: "ref-unpaid-orphan",
      externalRef: "cs_unpaid",
    });
    const client = new FakeStripeReport({ sessions: [] });
    const refunder = new FakeStripe();
    const sweep = reconciler(client, refunder);
    const result = await sweep.reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(result.remediated).toBe(0);
    expect(result.remediationFailures).toEqual([
      { paymentRef: "ref-unpaid-orphan", reason: "payment.not_found" },
    ]);
    expect(refunder.lastRefund).toBeUndefined(); // no money moved
    // The marker is permanent by design: the next sweep still SEES the orphan but claims nothing.
    const again = await sweep.reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(again.orphan).toHaveLength(1);
    expect(again.remediated).toBe(0);
    expect(again.remediationFailures).toEqual([]);
  });
});
