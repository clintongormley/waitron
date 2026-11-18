import "./errors.js";
import type { Logger } from "./logger.js";
import { and, eq, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  billPaymentRefunds,
  billPayments,
  correctivesOf,
  workingOrders,
  devices,
  deviceProfiles,
  readTaxpayer,
  sales,
  tenderRefunds,
  tenders,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { cardReaders, payments, type PaymentResult } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  decimalToCents,
  decimal,
  subtractDecimal,
  type Decimal,
} from "@waitron/shared";
import { enqueuePrintJob } from "@waitron/printing";
import { profileAllows } from "@waitron/layouts";
import { readReceiptLanguage } from "@waitron/menu";
import { cardDetailsOf } from "./card-details.js";
import { formatPaymentSlip } from "./payment-slip.js";
import { readReceiptOrder } from "./receipt-order.js";
import { resolvePaymentSlipPrinter } from "./receipt-print.js";
import type { OriginConfig } from "./trading-context.js";

type CardSlipRequest = { printerId: string; locale: string } | null | undefined;

export async function freezeCardSlip(
  tx: Transaction,
  cfg: OriginConfig,
  workingOrderId: string,
  requested: boolean | undefined,
  readerId: string | undefined,
): Promise<CardSlipRequest> {
  if (requested !== true || cfg.origin.source !== "device") return;
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor, capabilities: deviceProfiles.capabilities })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, cfg.origin.deviceId));
  if (
    profile === undefined ||
    !profileAllows({ ...profile, capabilities: profile.capabilities as string[] }, "print-receipt")
  )
    return;
  if (readerId !== undefined) {
    const [reader] = await tx.select().from(cardReaders).where(eq(cardReaders.id, readerId));
    if (reader?.printsOwnSlipAutomatically === true) return;
  }
  const printer = await resolvePaymentSlipPrinter(tx, cfg.origin);
  if (printer === undefined) return null;
  const [order] = await tx
    .select({ locale: workingOrders.receiptLocale })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  return { printerId: printer.id, locale: order?.locale ?? (await readReceiptLanguage(tx)).locale };
}

export async function printCapturedCardSlip(
  db: Database,
  cfg: OriginConfig,
  workingOrderId: string,
  result: PaymentResult,
  requested: CardSlipRequest,
  wholeTip?: Decimal,
  log?: Logger,
): Promise<{ slipPrintFailed?: true }> {
  if (requested === undefined) return {};
  if (requested === null) return { slipPrintFailed: true };
  let reason = "enqueue_failed";
  try {
    // Money has committed; a printer refusal must not roll back or retry the charge.
    await withTransaction(db, async (tx) => {
      const printer = await resolvePaymentSlipPrinter(tx, cfg.origin);
      if (printer?.id !== requested.printerId) {
        reason = "printer_changed";
        throw new Error("Payment slip printer changed");
      }
      const [payment] = await tx
        .select()
        .from(payments)
        .where(
          and(eq(payments.provider, result.provider), eq(payments.paymentRef, result.paymentRef)),
        );
      if (payment === undefined) {
        reason = "capture_missing";
        throw new Error("Captured payment missing");
      }
      const [bill] =
        payment.billPaymentId === null
          ? []
          : await tx
              .select({ remaining: billPayments.remainingAfter, tip: billPayments.tip })
              .from(billPayments)
              .where(eq(billPayments.id, payment.billPaymentId));
      await enqueueSlips(
        tx,
        cfg,
        workingOrderId,
        [
          {
            charged: payment.amount,
            paidAt: payment.settledAt,
            tip: bill?.tip ?? decimalToCents(wholeTip ?? decimal("0.00")),
            remaining: payment.billPaymentId === null ? 0 : (bill?.remaining ?? null),
            scheme: payment.cardScheme,
            last4: payment.cardLast4,
            entryMode: payment.cardEntryMode,
            authCode: payment.cardAuthCode,
          },
        ],
        requested.locale,
        false,
      );
    });
    return {};
  } catch {
    log?.("warn", "payment.slip_print_failed", { workingOrderId, reason });
    return { slipPrintFailed: true };
  }
}

/** Prints a copy of one card payment's slip; one the sale has no copy for prints nothing. */
export async function printSalePaymentSlip(
  db: Database,
  cfg: OriginConfig,
  workingOrderId: string,
  paymentId: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [sale] = await tx
      .select({ id: sales.id, locale: sales.locale })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId });
    const [payment] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.saleId, sale.id),
          eq(payments.workingOrderId, workingOrderId),
        ),
      );
    if (payment === undefined) throw new AppError("bill.payment_not_found", { paymentId });
    const cards = (await readSaleSlipCards(tx, sale.id, workingOrderId)).filter(
      (card) => card.id === paymentId,
    );
    await enqueueSlips(tx, cfg, workingOrderId, cards, sale.locale, true);
  });
}

/** The card payments this device can print a copy of, for the till to offer. */
export async function readSalePaymentSlips(
  tx: Transaction,
  cfg: OriginConfig,
  saleId: string,
  workingOrderId: string,
) {
  if ((await resolvePaymentSlipPrinter(tx, cfg.origin)) === undefined) return [];
  const cards = await readSaleSlipCards(tx, saleId, workingOrderId);
  return cards.map((card) => ({
    id: card.id,
    amount: centsToDecimal(card.charged),
    last4: card.last4,
  }));
}

async function readSaleSlipCards(tx: Transaction, saleId: string, workingOrderId: string) {
  const corrective = alias(sales, "corrective");
  const [corrected] = await tx
    .select({ id: corrective.id })
    .from(corrective)
    .where(correctivesOf(sql`${corrective}`, sql`${saleId}`));
  if (corrected !== undefined) return [];
  return (
    tx
      .select({
        id: payments.id,
        charged: payments.amount,
        paidAt: payments.settledAt,
        tip: tenders.tipAmount,
        remaining: sql<
          number | null
        >`case when ${payments.billPaymentId} is null then 0 else ${billPayments.remainingAfter} end`,
        scheme: payments.cardScheme,
        last4: payments.cardLast4,
        entryMode: payments.cardEntryMode,
        authCode: payments.cardAuthCode,
      })
      .from(payments)
      .innerJoin(
        tenders,
        and(
          eq(tenders.saleId, payments.saleId),
          eq(tenders.method, "card"),
          // A bill paid by several cards: each payment's own tender carries its own tip.
          or(
            eq(tenders.billPaymentId, payments.billPaymentId),
            and(isNull(tenders.billPaymentId), isNull(payments.billPaymentId)),
          ),
        ),
      )
      .leftJoin(billPayments, eq(billPayments.id, payments.billPaymentId))
      .leftJoin(cardReaders, eq(cardReaders.id, payments.readerId))
      .where(
        and(
          or(isNull(cardReaders.id), eq(cardReaders.printsOwnSlipAutomatically, false)),
          eq(payments.saleId, saleId),
          eq(payments.workingOrderId, workingOrderId),
          ne(payments.provider, "manual"),
          eq(payments.state, "captured"),
          // An associated capture carries its settlement instant; do not invent a payment date.
          isNotNull(payments.settledAt),
          // A refund still being sent counts as money given back; a failed one does not.
          notExists(
            tx
              .select({ id: billPaymentRefunds.id })
              .from(billPaymentRefunds)
              .where(
                and(
                  eq(billPaymentRefunds.billPaymentId, payments.billPaymentId),
                  ne(billPaymentRefunds.state, "failed"),
                ),
              ),
          ),
          notExists(
            tx
              .select({ id: tenderRefunds.id })
              .from(tenderRefunds)
              .where(
                and(eq(tenderRefunds.tenderId, tenders.id), ne(tenderRefunds.state, "failed")),
              ),
          ),
        ),
      )
      // Two cards can settle in the same millisecond; a tie falls back to `rowid`, the order the
      // rows were written in.
      .orderBy(payments.settledAt, sql`${payments}.rowid`)
  );
}

export async function readBillSlipPayments(tx: Transaction, workingOrderId: string) {
  return tx
    .select({
      id: billPayments.id,
      charged: payments.amount,
      paidAt: payments.settledAt,
      tip: billPayments.tip,
      remaining: billPayments.remainingAfter,
      scheme: payments.cardScheme,
      last4: payments.cardLast4,
      entryMode: payments.cardEntryMode,
      authCode: payments.cardAuthCode,
    })
    .from(billPayments)
    .innerJoin(payments, eq(payments.billPaymentId, billPayments.id))
    .leftJoin(cardReaders, eq(cardReaders.id, payments.readerId))
    .where(
      and(
        eq(billPayments.workingOrderId, workingOrderId),
        eq(billPayments.state, "received"),
        isNotNull(billPayments.remainingAfter),
        isNotNull(payments.settledAt),
        ne(payments.provider, "manual"),
        or(isNull(cardReaders.id), eq(cardReaders.printsOwnSlipAutomatically, false)),
      ),
    );
}

export async function printBillPaymentSlip(
  db: Database,
  cfg: OriginConfig,
  workingOrderId: string,
  paymentId: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [payment] = await tx
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(and(eq(billPayments.id, paymentId), eq(billPayments.workingOrderId, workingOrderId)));
    if (payment === undefined) throw new AppError("bill.payment_not_found", { paymentId });
    const cards = (await readBillSlipPayments(tx, workingOrderId)).filter(
      (card) => card.id === paymentId,
    );
    await enqueueSlips(
      tx,
      cfg,
      workingOrderId,
      cards,
      (await readReceiptLanguage(tx)).locale,
      true,
    );
  });
}

async function enqueueSlips(
  tx: Transaction,
  cfg: OriginConfig,
  workingOrderId: string,
  cards: readonly {
    charged: number;
    paidAt: string | null;
    tip: number;
    scheme: string | null;
    last4: string | null;
    entryMode: string | null;
    authCode: string | null;
    remaining: number | null;
  }[],
  locale: string,
  copy: boolean,
): Promise<void> {
  const printer = await resolvePaymentSlipPrinter(tx, cfg.origin);
  if (printer === undefined) return;
  const taxpayer = await readTaxpayer(tx);
  /* v8 ignore start -- the taxpayer row is the database's one row; presentation still degrades */
  if (taxpayer === null) return;
  /* v8 ignore stop */
  const order = await readReceiptOrder(tx, workingOrderId);
  for (const payment of cards) {
    const charged = centsToDecimal(payment.charged);
    const tip = centsToDecimal(payment.tip);
    const payload = formatPaymentSlip({
      issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
      ...order,
      paidAt: payment.paidAt!,
      amount: subtractDecimal(charged, tip),
      charged,
      tip,
      card: cardDetailsOf(payment),
      invoiceLocale: locale,
      copy,
      remaining: payment.remaining === null ? null : centsToDecimal(payment.remaining),
      printer: { paperWidth: printer.paperWidth, resolution: printer.resolution },
    });
    await enqueuePrintJob(tx, printer.id, payload, "document");
  }
}
