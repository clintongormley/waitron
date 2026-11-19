import type { Logger } from "./logger.js";
import { and, eq } from "drizzle-orm";
import {
  billPayments,
  workingOrders,
  devices,
  deviceProfiles,
  readTaxpayer,
  sales,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { cardReaders, payments, type PaymentResult } from "@waitron/payments";
import {
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
import { optionalDocument } from "./optional-document.js";
import { formatPaymentSlip } from "./payment-slip.js";
import { readReceiptOrder } from "./receipt-order.js";
import {
  resolvePaymentSlipPrinter,
  type DevicePrinter,
  type PrinterLookup,
} from "./receipt-print.js";
import type { OriginConfig } from "./trading-context.js";

type CardSlipRequest = { printerId: string; locale: string } | null | undefined;

export async function freezeCardSlip(
  tx: Transaction,
  cfg: OriginConfig,
  workingOrderId: string,
  requested: boolean | undefined,
  readerId: string | undefined,
): Promise<CardSlipRequest> {
  if (requested !== true || !(await deviceMayPrintSlips(tx, cfg))) return;
  if (readerId !== undefined) {
    const [reader] = await tx.select().from(cardReaders).where(eq(cardReaders.id, readerId));
    if (reader?.printsOwnSlipAutomatically === true) return;
  }
  const printer = await resolvePaymentSlipPrinter(tx, cfg.origin);
  if (printer === undefined) return null;
  return { printerId: printer.id, locale: await orderSlipLocale(tx, workingOrderId) };
}

async function orderSlipLocale(tx: Transaction, workingOrderId: string): Promise<string> {
  // `sales_working_order_id_key` allows one sale per order; correctives carry no order id.
  const [sale] = await tx
    .select({ locale: sales.locale })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  if (sale !== undefined) return sale.locale;
  const [order] = await tx
    .select({ locale: workingOrders.receiptLocale })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  return order?.locale ?? (await readReceiptLanguage(tx)).locale;
}

async function deviceMayPrintSlips(tx: Transaction, cfg: OriginConfig): Promise<boolean> {
  if (cfg.origin.source !== "device") return false;
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor, capabilities: deviceProfiles.capabilities })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, cfg.origin.deviceId));
  return (
    profile !== undefined &&
    profileAllows({ ...profile, capabilities: profile.capabilities as string[] }, "print-receipt")
  );
}

/**
 * The slip a payer asked for, for cash or a card typed into another machine, queued in the
 * transaction that takes the payment. A device whose profile may not print receipts is offered no
 * slip, so asks nothing; otherwise a slip that cannot be queued is answered `slipPrintFailed` and
 * the payment stands.
 */
export async function enqueueRequestedPaymentSlip(
  tx: Transaction,
  cfg: OriginConfig,
  workingOrderId: string,
  requested: boolean | undefined,
  payment: {
    method: "cash" | "card";
    charged: number;
    tip: number;
    paidAt: string;
    reference: string | null;
    machine: string | null;
  },
  printers: PrinterLookup,
): Promise<{ slipPrintFailed?: true }> {
  if (requested !== true || !(await deviceMayPrintSlips(tx, cfg))) return {};
  const queued = await optionalDocument(
    tx,
    "enqueueRequestedPaymentSlip",
    workingOrderId,
    async () => {
      const printer = await printers("payment_slip");
      if (printer === undefined) return false;
      const card = { scheme: null, last4: null, entryMode: null, authCode: null };
      const locale = await orderSlipLocale(tx, workingOrderId);
      await enqueueSlips(tx, printer, workingOrderId, [{ ...payment, ...card }], locale);
      return true;
    },
  );
  return queued === true ? {} : { slipPrintFailed: true };
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
      // A slip prints the payment's time; a capture that records none prints no slip.
      if (payment.settledAt === null) {
        reason = "settlement_missing";
        throw new Error("Captured payment has no settlement instant");
      }
      const [bill] =
        payment.billPaymentId === null
          ? []
          : await tx
              .select({ tip: billPayments.tip })
              .from(billPayments)
              .where(eq(billPayments.id, payment.billPaymentId));
      await enqueueSlips(
        tx,
        printer,
        workingOrderId,
        [
          {
            charged: payment.amount,
            paidAt: payment.settledAt,
            tip: bill?.tip ?? decimalToCents(wholeTip ?? decimal("0.00")),
            scheme: payment.cardScheme,
            last4: payment.cardLast4,
            entryMode: payment.cardEntryMode,
            authCode: payment.cardAuthCode,
          },
        ],
        requested.locale,
      );
    });
    return {};
  } catch {
    log?.("warn", "payment.slip_print_failed", { workingOrderId, reason });
    return { slipPrintFailed: true };
  }
}

async function enqueueSlips(
  tx: Transaction,
  printer: DevicePrinter,
  workingOrderId: string,
  cards: readonly {
    /** Absent for a reader card's slip. */
    method?: "cash" | "card";
    reference?: string | null;
    machine?: string | null;
    charged: number;
    paidAt: string;
    tip: number;
    scheme: string | null;
    last4: string | null;
    entryMode: string | null;
    authCode: string | null;
  }[],
  locale: string,
): Promise<void> {
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
      paidAt: payment.paidAt,
      amount: subtractDecimal(charged, tip),
      charged,
      tip,
      ...(payment.method === undefined ? {} : { method: payment.method }),
      reference: payment.reference ?? null,
      machine: payment.machine ?? null,
      card: cardDetailsOf(payment),
      invoiceLocale: locale,
      printer: { paperWidth: printer.paperWidth, resolution: printer.resolution },
    });
    await enqueuePrintJob(tx, printer.id, payload, "document");
  }
}
