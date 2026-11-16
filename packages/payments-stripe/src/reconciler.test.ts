import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  insertCapturedPayment,
  insertInitiated,
  listAbandonedRefundOutcomes,
  markReconcileRemediated,
} from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { StripeReconciler } from "./reconciler.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";
import { FakeStripe } from "./testing/fake-stripe.js";
import type { NodeId } from "@waitron/shared";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // Child before parent: `payment_refunds.payment_id` references `payments(id)` ON DELETE restrict.
  await suite.db.execute(sql`delete from payment_refunds`);
  await suite.db.execute(sql`delete from payments`);
  await suite.db.execute(sql`delete from incidents`);
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

function reconciler(
  client: FakeStripeReport,
  refunder: FakeStripe = new FakeStripe(),
): StripeReconciler {
  return new StripeReconciler({
    db: suite.db,
    resolveAccount: () => Promise.resolve({ report: client, refund: refunder }),
  });
}

/** A `captured` stripe payment on an ABANDONED working order — the auto-reversible orphan shape:
 * money we hold, no sale, and a working order that will never produce one. */
async function abandonedOrphan(params: {
  deviceId: string;
  workingOrderId: string;
  nodeId: NodeId;
  paymentRef: string;
  externalRef: string;
}): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: deviceOrigin(params.deviceId),
      workingOrderId: params.workingOrderId,
      nodeId: params.nodeId,
      provider: "stripe",
      paymentRef: params.paymentRef,
      externalRef: params.externalRef,
      amount: decimal("10.00"),
      settledAt: OLD,
    }),
  );
  await suite.db.execute(
    `update working_orders set status = 'abandoned' where id = '${params.workingOrderId}'`,
  );
}

describe("StripeReconciler", () => {
  it("audits the settlement identity, not one capture mechanism", () => {
    expect(reconciler(new FakeStripeReport()).provider).toBe("stripe");
  });

  it("matches a terminal row by its payment intent and reports no mismatch", async () => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    // No sale, but the working order is still open, so this is not an orphan — the clean case.
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        nodeId: seeded.nodeId,
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
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await withTransaction(suite.db, (tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        nodeId: seeded.nodeId,
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
      db: suite.db,
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
      db: suite.db,
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
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({
      deviceId: seeded.deviceId,
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
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
    expect(refunder.createRefundCalls[0]?.paymentIntentId).toBe("pi_orphan");
  });

  it("auto-reverses a terminal orphan against its stored payment intent, unresolved", async () => {
    // This report carries no sessions at all, so a lookup would resolve to null and fail the
    // reversal.
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({
      deviceId: seeded.deviceId,
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
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
    expect(refunder.createRefundCalls[0]?.paymentIntentId).toBe("pi_terminal_orphan");
  });

  it("commits a stable reversal key before sending the captured amount", async () => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({ ...seeded, paymentRef: "durable", externalRef: "pi_durable" });
    const client = new FakeStripeReport();
    const refunder = new FakeStripe();
    const send = refunder.createRefund.bind(refunder);
    let observed = false;
    vi.spyOn(refunder, "createRefund").mockImplementation(async (request) => {
      const [claim] = await withTransaction(suite.db, (tx) =>
        listAbandonedRefundOutcomes(tx, "stripe"),
      );
      expect(claim?.claimedAt).toBe(NOW.toISOString());
      expect(request).toEqual({
        paymentIntentId: "pi_durable",
        amount: "10.00",
        idempotencyKey: `sr_${claim!.paymentId}`,
        metadata: { reconcile_payment_id: claim!.paymentId },
      });
      observed = true;
      return send(request);
    });
    const result = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(result.remediated).toBe(1);
    expect(observed).toBe(true);
    const refunds = await suite.db.execute(
      "select state, provider_refund_ref from payment_refunds",
    );
    expect(refunds.rows).toEqual([{ state: "succeeded", provider_refund_ref: expect.any(String) }]);
  });

  it("recovers a lost reply with a fresh reconciler outside the original period", async () => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({ ...seeded, paymentRef: "lost", externalRef: "pi_lost" });
    const client = new FakeStripeReport();
    const refunder = new FakeStripe();
    refunder.scriptNextCreateRefund({ status: "succeeded", answer: { httpStatus: null } });
    const first = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(first.remediated).toBe(0);
    expect(first.remediationUnconfirmed).toEqual(["lost"]);
    expect(first.resweepAfter).toEqual(new Date("2026-07-25T13:00:00Z"));
    const later = { from: new Date("2026-07-26"), to: new Date("2026-07-27") };
    const recovered = await reconciler(client, refunder).reconcile(later, new Date("2026-07-27"));
    expect(recovered.remediated).toBe(1);
    expect(recovered.resweepAfter).toBeUndefined();
    expect(refunder.createRefundCalls).toHaveLength(1);
    const refunds = await suite.db.execute(
      "select state, provider_refund_ref from payment_refunds",
    );
    expect(refunds.rows).toEqual([{ state: "succeeded", provider_refund_ref: expect.any(String) }]);
    await reconciler(client, refunder).reconcile(later, new Date("2026-07-28"));
    expect((await suite.db.execute("select id from payment_refunds")).rows).toHaveLength(1);
  });

  it.each(["pending", "failed", "canceled", "unknown"])(
    "recovers a saved %s outcome without another send",
    async (status) => {
      const seeded = await seedWorkingOrder(suite.db, freshNif());
      await abandonedOrphan({ ...seeded, paymentRef: "status", externalRef: "pi_status" });
      const client = new FakeStripeReport();
      const refunder = new FakeStripe();
      refunder.scriptNextCreateRefund({ status });
      const first = await reconciler(client, refunder).reconcile(PERIOD, NOW);
      if (status === "failed" || status === "canceled") {
        expect(first.remediationFailures).toHaveLength(1);
        expect((await suite.db.execute("select state from payment_refunds")).rows).toEqual([
          { state: "failed" },
        ]);
        expect(
          (
            await suite.db.execute(
              "select code from incidents where code = 'payment.reconcile_remediation_failed'",
            )
          ).rows,
        ).toHaveLength(1);
      } else {
        expect(first.remediationUnconfirmed).toEqual(["status"]);
        const [refund] = await refunder.listRefunds("pi_status");
        refunder.setRefundStatus(refund!.id, "succeeded");
      }
      const recovered = await reconciler(client, refunder).reconcile(
        PERIOD,
        new Date("2026-07-25T13:00:00Z"),
      );
      expect(recovered.remediated).toBe(status === "failed" || status === "canceled" ? 0 : 1);
      expect(recovered.remediationFailures).toEqual([]);
      expect(recovered.resweepAfter).toBeUndefined();
      expect(refunder.createRefundCalls).toHaveLength(1);
      expect((await suite.db.execute("select id from payment_refunds")).rows).toHaveLength(1);
    },
  );

  it.each([
    { now: "2026-07-25T13:00:00Z", sends: 2, remediated: 1 },
    { now: "2026-07-26T12:00:00Z", sends: 1, remediated: 0 },
    { now: "2026-07-25T11:59:59Z", sends: 1, remediated: 0 },
  ])("only resends the saved key within its window ($now)", async ({ now, sends, remediated }) => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({ ...seeded, paymentRef: "retry", externalRef: "pi_retry" });
    const client = new FakeStripeReport();
    const refunder = new FakeStripe();
    refunder.scriptNextCreateRefund({ httpStatus: 500 });
    const first = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(first.remediationUnconfirmed).toEqual(["retry"]);
    const later = await reconciler(client, refunder).reconcile(PERIOD, new Date(now));
    expect(later.remediated).toBe(remediated);
    expect(later.resweepAfter).toBeUndefined();
    expect(refunder.createRefundCalls).toHaveLength(sends);
    expect(new Set(refunder.createRefundCalls.map((r) => r.idempotencyKey)).size).toBe(1);
    if (!remediated) expect(later.remediationUnconfirmed).toEqual(["retry"]);
  });

  it.each(["unreachable", "unmatched", "mixed"])(
    "keeps %s evidence uncertain without sending",
    async (evidence) => {
      const seeded = await seedWorkingOrder(suite.db, freshNif());
      await abandonedOrphan({ ...seeded, paymentRef: "evidence", externalRef: "pi_evidence" });
      await withTransaction(suite.db, (tx) =>
        markReconcileRemediated(tx, { provider: "stripe", paymentRef: "evidence", at: NOW }),
      );
      const [claim] = await withTransaction(suite.db, (tx) =>
        listAbandonedRefundOutcomes(tx, "stripe"),
      );
      const refunder = new FakeStripe();
      if (evidence === "unreachable") refunder.listRefundsUnreachableNext();
      else {
        await refunder.createRefund({
          paymentIntentId: "pi_evidence",
          amount: decimal("1"),
          idempotencyKey: "outside",
          metadata: {},
        });
        if (evidence === "mixed")
          await refunder.createRefund({
            paymentIntentId: "pi_evidence",
            amount: decimal("10"),
            idempotencyKey: "matching",
            metadata: { reconcile_payment_id: claim!.paymentId },
          });
      }
      const sendsBefore = refunder.createRefundCalls.length;
      const result = await reconciler(new FakeStripeReport(), refunder).reconcile(PERIOD, NOW);
      expect(result.remediationUnconfirmed).toEqual(["evidence"]);
      expect(result.remediated).toBe(0);
      expect(result.resweepAfter).toBeUndefined();
      expect(refunder.createRefundCalls).toHaveLength(sendsBefore);
      expect((await suite.db.execute("select id from payment_refunds")).rows).toEqual([]);
    },
  );

  it("records a documented refusal once and reports its failure", async () => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({ ...seeded, paymentRef: "refused", externalRef: "pi_refused" });
    const refunder = new FakeStripe();
    refunder.scriptNextCreateRefund({ httpStatus: 400 });
    const client = new FakeStripeReport();
    const first = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(first.remediationFailures).toHaveLength(1);
    const second = await reconciler(client, refunder).reconcile(PERIOD, NOW);
    expect(second.remediationFailures).toEqual([]);
    expect(refunder.createRefundCalls).toHaveLength(1);
    expect((await suite.db.execute("select state from payment_refunds")).rows).toEqual([
      { state: "failed" },
    ]);
  });

  it("fails one hosted orphan's reversal when its session was never paid, and never retries it", async () => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    await abandonedOrphan({
      deviceId: seeded.deviceId,
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
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
    expect(refunder.createRefundCalls).toHaveLength(0); // no money moved
    const again = await sweep.reconcile(PERIOD, NOW);
    expect(again.orphan).toHaveLength(1);
    expect(again.remediated).toBe(0);
    expect(again.remediationFailures).toEqual([]);
  });
});
