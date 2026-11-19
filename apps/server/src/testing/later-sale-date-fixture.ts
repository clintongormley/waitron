import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { billPayments, saleLines, sales, withTransaction } from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import type { TrustedClock } from "@waitron/fiscal";
import { startManagementSession } from "@waitron/identity";
import { insertCapturedPayment, payments, recordAttemptResolution } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { centsToDecimal, decimal, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { mountPaymentsApi } from "../payments-api.js";
import { readTransactionReceipt } from "../transaction-receipt.js";
import { send, type BillVenue } from "./bill-venue.js";
import { clockAt } from "./deferred-close-fixture.js";
import { testTradingAdmission } from "./trading-admission.js";

/** A clock whose every reading is the instant `iso`. */
export function clockAtIso(iso: string): TrustedClock {
  return clockAt(Date.parse(iso));
}

/** What the order's sale stored, printed and filed, and the VAT rate of each of its lines. */
export async function filedFor(venue: BillVenue, orderId: string) {
  const [sale] = await venue.db
    .select({ id: sales.id, supplyDay: sales.supplyDay })
    .from(sales)
    .where(eq(sales.workingOrderId, orderId));
  const ticket = await withTransaction(venue.db, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, sale!.id),
  );
  const [record] = venue.db.all<{ operationDate: string | null; issueDate: string }>(sql`
    select fecha_operacion as operationDate, fecha_expedicion_factura as issueDate
    from registros_facturacion where sale_id = ${sale!.id}`);
  const rates = (
    await venue.db
      .select({ rate: saleLines.vatRate })
      .from(saleLines)
      .where(eq(saleLines.saleId, sale!.id))
  ).map((line) => line.rate);
  return { supplyDay: sale!.supplyDay, ticket, record: record!, rates };
}

/** A pending card bill payment whose provider row captured it, each row dated as given: the card
 * row created at `card`, settled at `settled` (default `card`), and carrying the provider's time
 * `takenAt` when given. */
export async function capturedPending(
  venue: BillVenue,
  billId: string,
  cents: number,
  dated: { bill: string; card: string; settled?: string; takenAt?: string },
): Promise<{ billPaymentId: string; paymentId: string }> {
  const paymentRef = `captured-${randomUUID()}`;
  const billPaymentId = await withTransaction(venue.db, async (tx) => {
    const [row] = await tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "stranded",
        kind: "contribution",
        method: "card",
        applied: cents,
        tip: 0,
        state: "pending",
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        createdAt: dated.bill,
      })
      .returning({ id: billPayments.id });
    await insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      workingOrderId: brandWorkingOrderId(billId),
      provider: venue.card.provider,
      paymentRef,
      amount: centsToDecimal(cents),
      externalRef: `fake-ext-${paymentRef}`,
      settledAt: new Date(dated.settled ?? dated.card),
      billPaymentId: row!.id,
    });
    await liftPaymentGuard(tx, () =>
      tx
        .update(payments)
        .set({ createdAt: dated.card, providerTakenAt: dated.takenAt ?? null })
        .where(eq(payments.paymentRef, paymentRef)),
    );
    return row!.id;
  });
  const [payment] = await venue.db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.paymentRef, paymentRef));
  return { billPaymentId, paymentId: payment!.id };
}

/**
 * A card the reader captured for the bill, whose sale a restart left unfiled for automatic
 * recovery: the card row dated `asked`, its capture and resolution `settled`.
 */
export async function retainedCapture(
  venue: BillVenue,
  billId: string,
  card: { amount: string; asked: string; settled: string },
): Promise<void> {
  const paymentRef = randomUUID();
  await withTransaction(venue.db, async (tx) => {
    await insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      workingOrderId: brandWorkingOrderId(billId),
      provider: venue.card.provider,
      paymentRef,
      amount: decimal(card.amount),
      externalRef: `fake-ext-${paymentRef}`,
      settledAt: new Date(card.settled),
    });
    await recordAttemptResolution(
      tx,
      { provider: venue.card.provider, paymentRef },
      {
        personId: null,
        outcome: "captured",
        cancelledAtProvider: false,
        providerStatus: "succeeded",
        resolvedAt: new Date(card.settled),
      },
    );
  });
  await liftPaymentGuard(venue.db, () =>
    venue.db
      .update(payments)
      .set({ createdAt: card.asked })
      .where(eq(payments.paymentRef, paymentRef)),
  );
}

/** The payments routes on `at`'s clock, with a manager signed in (PIN 1234). */
export async function managementPayments(
  venue: BillVenue,
  at: string,
  provider: { partialRefundRelease?: boolean } = {},
) {
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const sid = await withTransaction(venue.db, async (tx) => {
    await putCredential(tx, ring, {
      personId: null,
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_ok",
        webhookSecret: "whsec_x",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      },
    });
    return (await startManagementSession(tx, { method: "password", personId: venue.adminId }))
      .token;
  });
  const seat = createStripeCardProvider((() => {
    throw new Error("the seat's own Stripe SDK is never built");
  }) as unknown as MakeStripe);
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      isPrimary: () => true,
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: clockAtIso(at),
      cfg: venue.cfg,
      ring,
      environment: "preproduction",
      pool: venue.pool,
      providers: [{ ...seat, providerId: venue.card.provider, ...provider }],
    },
    () => {},
  );
  const cookie = `${MANAGEMENT_COOKIE}=${sid}`;
  return (path: string, body?: unknown) => send(app, cookie, "POST", path, body);
}
