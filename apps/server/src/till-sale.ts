import { outsideCardDetails } from "./outside-card.js";
import type { RecipientIdentifierType } from "@waitron/country-packs";
import type { OptionSnapshot } from "@waitron/shared";
import { readReceiptPresentation } from "./receipt-presentation.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { clearBillRequestIfPaid } from "./bill-request.js";
// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { cardOf } from "./card-details.js";
import { readReceiptPayments, type BillTenderLine } from "./receipt-payments.js";
import { replayPrepayMadeHere, storePrepayMadeHere } from "./made-here.js";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { AppError, centsToDecimal, saleId as brandSaleId, subtractDecimal } from "@waitron/shared";
import {
  billPayments,
  invoiceSeries,
  saleSettlements,
  sales,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { SaleId, ReceiptElement, ReceiptPresentation } from "@waitron/shared";
import { payments } from "@waitron/payments";
import type { CardDetails } from "@waitron/payments";
import { formatInvoiceNumber, settleSale } from "@waitron/core";
import type { SettleSaleTender } from "@waitron/core";
import type { FiscalBackend, ReceiptQrText } from "@waitron/fiscal";
import {
  fireLines,
  paysAfterSending,
  readStoredOrder,
  refusePendingPartPayment,
  refuseRefundInProgress,
  toVatBreakdown,
  unsentDishLines,
  lateUnsentDishes,
} from "./working-order.js";
import type { TillSaleDeps as BaseTillSaleDeps, WorkingOrderStatus } from "./working-order.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
type TillSaleDeps = BaseTillSaleDeps & {
  attendance?: AttendanceRecorder;
  /**
   * Unset in suites that test no full-disk stop; unset, nothing is refused for a full disk. A live
   * boot supplies it.
   */
  disk?: DiskFullState;
};
import { type DiskFullState } from "./disk-full-state.js";
import { type DishesNotSent } from "./dish-not-sent-alert.js";
import { readIssuedSales, type IssuedSale } from "./sale-due.js";
import { VENUE_SERVICE } from "./modules.js";
import { readReceiptOrder } from "./receipt-order.js";
import { receiptLines } from "./receipt-adjustments.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import { readOfferedReceiptLanguages } from "./venue-locale.js";
import { enqueueOriginalReceipt, enqueueReceiptReprint, printerLookup } from "./receipt-print.js";
import { owesOriginal } from "./owed-receipts.js";

export interface TillMoneyOperator {
  personId: string;
  sessionId: string;
}

export async function captureWholePayment(
  tx: Transaction,
  attendance: AttendanceRecorder | undefined,
  orderId: string,
  personId: string | undefined,
  at: Date | undefined,
): Promise<void> {
  if (attendance === undefined || personId === undefined || at === undefined) return;
  await attendance(tx, {
    source: "whole-payment",
    key: orderId,
    personId,
    kind: "payment",
    at: at.toISOString(),
    offsetMinutes: 0,
    outcome: "qualified",
  });
}

/**
 * One line of the FILED composition, for the receipt's goods-identification list (RD 1619/2012
 * art. 7.1.e). It comes from the lines the server filed, never a client basket, so the printed line
 * list cannot diverge from the invoice.
 */
export interface TillSaleLine {
  /** F1 figures read from the filed sale line; unitPrice is per priceQuantity, base is the line total. */
  net?: { unitPrice: string; priceQuantity: string; base: string; rate: string; tax?: string };
  /** locale → text: the line's goods descriptions, snapshotted at add-time and filed verbatim. */
  descriptions: Record<string, string>;
  /** Unit label frozen with the filed line, including a weighted extra child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** Presentation marker derived from the working line's stored unit identity. */
  soldInEach?: true;
  /** The filed quantity; weighted extra children retain the saved fractional scale for display. */
  quantity: string;
  /** The filed line's VAT rate, as a percentage. */
  vatRate?: string;
  /** The GROSS (VAT-inclusive) line total the line was filed at, as a decimal string. */
  gross: string;
  /**
   * The line's total at its price before a comp or a discount lowered it, present only when that
   * differs from `gross`. F1 replay reads it from the saved sale line.
   */
  listGross?: string;
  /**
   * The unit price with VAT per price quantity before any comp or discount; present only with
   * listGross. A full invoice reads it from the filed sale line, a simplified one from the order line.
   */
  listUnitPriceGross?: string;
  /**
   * Simplified receipts only: the unit price with VAT per price quantity the line was sold at, from
   * the stored order line; absent when no stored order line of the same number still has the line's
   * quantity, price quantity and total, and on a printed row merging lines sold at different prices.
   */
  unitPriceGross?: string;
  /**
   * Simplified receipts only: what `unitPriceGross` and `listUnitPriceGross` are priced per; absent
   * means one. A full invoice's line keeps its price quantity in `net.priceQuantity`.
   */
  priceQuantity?: string;
  /**
   * Presentation only. On a full invoice's line whose order line an adjustment on this bill split
   * into several dish rows: the index in lines of the family's first row. The family shares its
   * own discount.
   */
  dishFamily?: number;
  /** The comps and discounts printed beneath this row's dish; absent when there are none. */
  adjustments?: ReceiptAdjustment[];
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line, else `null`/absent.
   *  Presentation only: it groups already-filed lines and is no fiscal figure. */
  parentLineNo?: number | null;
  /** The diner's answers to this dish's OPTIONS lists, copied by value so a later menu edit
   *  cannot rewrite what a completed sale says was ordered. An extras pick is a child line instead. */
  optionSnapshots?: OptionSnapshot[];
  /** On a line taking an advance off this invoice: the advance as its own ticket names it, read
   *  through the line's `deducts_sale_id`. `issuedOn` is its issue day in the venue's zone. */
  advance?: { invoiceNumber: string; issuedOn: string };
  /** The filed line's set-menu role; absent on a line with none. */
  setMenuRole?: "set_menu" | "dish";
}

/** An amount taken off, printed as its own line: presentation only, nothing is filed from it. */
export interface ReceiptAdjustment {
  /** `comp`: a full comp, printed as the discount word with 100%. */
  kind: "comp" | "discount";
  percentBp?: number;
  /** The positive amount taken off, as a decimal string. */
  amount: string;
}

export type TenderBlock =
  | { method: "unpaid" }
  | { method: "deferred" }
  | { method: "cash"; change: string }
  | {
      method: "card";
      charged: string;
      tip: string;
      reference: string | null;
      externalProvider?: "connected_account" | "other";
      externalMachine?: string;
      card?: CardDetails;
    };

export interface TillSaleResult extends ReceiptPresentation {
  /** `venueAddressLine` of the venue read for `venueAddress`. */
  venueAddressLine: string;
  /** The payer asked for a payment slip and none could be queued. */
  slipPrintFailed?: true;
  receiptPreview?: readonly ReceiptElement[];
  simulatedCardPayment: boolean;
  invoiceEvidence?: import("@waitron/fiscal").FiledInvoiceEvidence;
  issuedOffsetMinutes?: number;
  invoiceType?: "F1" | "F2" | "R4" | "R5";
  /** On a corrective invoice (R4, R5), the invoice it corrects; `inFull` when it replaces it whole. */
  corrects?: {
    invoiceNumber: string;
    issuedAt: string;
    issuedOffsetMinutes?: number;
    inFull?: true;
  };
  /** The real day (`YYYY-MM-DD`) of the sale, when it is not its issue day: an F1/F2 issued on a later day, or a replacement. */
  saleDay?: string;
  issuer?: { venueName: string; nif: string; domicile?: string };
  recipient?: {
    taxId: string;
    legalName: string;
    countryCode: string;
    address: string;
    identifierType?: RecipientIdentifierType;
    identifierCountryCode?: string;
  };
  receiptHeader?: { tradingName: string; printTradingName: boolean };
  /** The language the sale was filed in (`sales.locale`). */
  locale: string;
  /** The language the receipt looks the goods' names up by (`sales.invoice_locales[0]`). Absent
   * reads as `locale`. */
  namesLocale?: string;
  orderLabel: string | null;
  orderNumber: number;
  /** The order was taken away; absent when it was eaten here. */
  takeAway?: true;
  /** `NumSerieFactura`-shaped "A/1", read back from the sale row + its series after filing. */
  invoiceNumber: string;
  /** The fiscal record's issuance instant, ISO-8601. */
  issuedAt: string;
  /** Taxable base + VAT, the authoritative figure the fiscal record carries. */
  total: string;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  /** The FILED line list (goods identification, art. 7.1.e). */
  lines: TillSaleLine[];
  /** The sale's FIRST tender by settle time, read back from the committed tender and payment rows;
   * `payments` lists them all when the bill was paid in parts. */
  tender: TenderBlock;
  /** Every bill payment the sale was paid with, or, while it is unpaid, received so far. */
  payments?: BillTenderLine[];
  /** What an issued, unsettled sale still owes, tips aside; absent when nothing is. */
  owed?: string;
  /** Discounts on the whole bill, printed after the goods; absent when there are none. */
  billAdjustments?: ReceiptAdjustment[];
  /** Where a customer can verify the record, or "" when the regime offers none. */
  qr: string;
  /** The fiscal backend's words around the QR; present only beside a non-empty `qr`. */
  qrText?: ReceiptQrText;
}

/** A receipt's QR, with the fiscal backend's words around it only when there is a QR to print. */
export function receiptQr(
  backend: FiscalBackend,
  verificationUrl: string | undefined,
): Pick<TillSaleResult, "qr" | "qrText"> {
  const qr = verificationUrl ?? "";
  if (qr === "" || backend.receiptQrText === undefined) return { qr };
  return { qr, qrText: { ...backend.receiptQrText } };
}

export async function readTenderBlock(
  tx: Transaction,
  saleId: SaleId,
  workingOrderId: string | null,
): Promise<TenderBlock> {
  const [row] = await tx
    .select({
      method: tenders.method,
      amount: tenders.amount,
      tip: tenders.tipAmount,
      cashTendered: tenders.cashTendered,
      billPaymentId: tenders.billPaymentId,
    })
    .from(tenders)
    .where(eq(tenders.saleId, saleId))
    // Two tenders can share a millisecond; a tie falls back to `rowid`, the order the rows were
    // written in.
    .orderBy(tenders.settledAt, sql`${tenders}.rowid`)
    .limit(1);
  // Invoice-first issuance legitimately precedes the tender.
  if (row === undefined) return { method: "unpaid" };
  if (row.method === "deferred") return { method: "deferred" };
  const tender = {
    ...row,
    amount: centsToDecimal(row.amount),
    tip: centsToDecimal(row.tip),
    cashTendered: row.cashTendered === null ? null : centsToDecimal(row.cashTendered),
  };
  if (tender.method === "cash") {
    return {
      method: "cash",
      change: subtractDecimal(tender.cashTendered ?? tender.amount, tender.amount),
    };
  }
  const [payment] = await tx
    .select({
      externalRef: payments.externalRef,
      externalProvider: payments.externalProvider,
      externalMachine: payments.externalMachine,
    })
    .from(payments)
    .where(
      and(
        eq(payments.saleId, saleId),
        workingOrderId === null
          ? isNull(payments.workingOrderId)
          : eq(payments.workingOrderId, workingOrderId),
        eq(payments.provider, "manual"),
      ),
    )
    .limit(1);
  const [captured] = await tx
    .select(CARD_COLUMNS)
    .from(payments)
    .where(
      and(
        eq(payments.saleId, saleId),
        tender.billPaymentId === null
          ? isNull(payments.billPaymentId)
          : eq(payments.billPaymentId, tender.billPaymentId),
        // The card was charged: every capture writes `settled_at`, and a refund or a void keeps it.
        isNotNull(payments.settledAt),
      ),
    )
    .orderBy(payments.settledAt, sql`${payments}.rowid`)
    .limit(1);
  return {
    method: "card",
    charged: tender.amount,
    tip: tender.tip,
    reference: payment?.externalRef ?? null,
    ...outsideCardDetails(payment ?? {}),
    ...cardOf(captured),
  };
}

const CARD_COLUMNS = {
  scheme: payments.cardScheme,
  last4: payments.cardLast4,
  entryMode: payments.cardEntryMode,
  authCode: payments.cardAuthCode,
};

export function refuseUnavailableInvoiceRequest(invoiceType: unknown, recipient: unknown): void {
  if (invoiceType !== undefined && invoiceType !== "F1" && invoiceType !== "F2") {
    throw new AppError("management.request_invalid", { field: "invoiceType" });
  }
  if (invoiceType === "F1") throw new AppError("sale.full_invoice_unavailable", {});
  if (recipient !== undefined && recipient !== null) {
    throw new AppError("management.request_invalid", { field: "recipient" });
  }
}

/**
 * Store the receipt language a pay request sent on an existing order that has no sale yet, as its
 * own update one revision on: `working_orders_enforce_transition` refuses a placed order's language
 * changing in the update that settles it. `order` is the row as the caller read it in this
 * transaction, with nothing written to it since.
 */
export async function storeSentReceiptLanguage(
  tx: Transaction,
  workingOrderId: string,
  order: { revision: number; receiptLocale: string | null },
  language: string | undefined,
): Promise<void> {
  if (language === undefined || order.receiptLocale === language) return;
  await tx
    .update(workingOrders)
    .set({ receiptLocale: language, revision: order.revision + 1 })
    .where(eq(workingOrders.id, workingOrderId));
}

/** Reconstruct the recorded sale and persisted payment facts for original, duplicate or pay replay. */
export async function readSettledTicket(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
): Promise<TillSaleResult> {
  await replayPrepayMadeHere(tx, cfg, workingOrderId);
  // `sales_working_order_id_key` allows at most one.
  const [issued] = await tx
    .select({
      saleId: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      total: sales.total,
      locale: sales.locale,
      invoiceLocales: sales.invoiceLocales,
      fiscalBackend: sales.fiscalBackend,
      vatBreakdown: sales.vatBreakdown,
      settlementId: saleSettlements.id,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
    .where(eq(sales.workingOrderId, workingOrderId));

  /* v8 ignore start */
  if (issued === undefined) {
    // The settle UPDATE and the sale INSERT commit in one transaction, so this is corruption.
    throw new Error(`readSettledTicket: settled working order ${workingOrderId} has no sale`);
  }
  /* v8 ignore stop */

  const stored = await readStoredOrder(tx, workingOrderId);
  const ticketLines = await receiptLines(
    tx,
    workingOrderId,
    stored.gross,
    stored.identities,
    issued.saleId,
  );

  // Reads the already-filed record; never re-files.
  const filed = await backend.filedReceiptFor(tx, brandSaleId(issued.saleId));
  if (filed === undefined && issued.fiscalBackend !== "none") {
    // Fail rather than reprint a legal receipt with an invented breakdown (§5).
    throw new Error(
      `readSettledTicket: settled working order ${workingOrderId} has no filed fiscal record`,
    );
  }

  const tender = await readTenderBlock(tx, brandSaleId(issued.saleId), workingOrderId);

  return {
    ...(await readReceiptOrder(tx, workingOrderId)),
    ...(await readReceiptPresentation(tx, issued.saleId, issued.locale, cfg.practiceMode === true)),
    locale: issued.locale,
    namesLocale: issued.invoiceLocales[0]!,
    invoiceNumber: formatInvoiceNumber(issued.code, issued.number),
    // So a replay's `issuedAt` reads identically to the original's `fiscal.issuedAt.toISOString()`.
    issuedAt: new Date(issued.issuedAt).toISOString(),
    total: centsToDecimal(issued.total),
    vatBreakdown: filed === undefined ? issued.vatBreakdown : toVatBreakdown(filed.vatBreakdown),
    ...ticketLines,
    tender,
    ...(await readReceiptPayments(
      tx,
      brandSaleId(issued.saleId),
      workingOrderId,
      issued.settlementId !== null,
    )),
    ...receiptQr(backend, filed?.verificationUrl),
    ...(await readReceiptIssuer(backend, tx, brandSaleId(issued.saleId))),
  };
}

/**
 * Queues the order's sale's original receipt, on a switched-off printer too, when the sale still
 * owes it and has no original job; says whether it queued one.
 */
export async function queueOwedOriginal(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: OriginConfig,
  workingOrderId: string,
  personId: string | null,
): Promise<boolean> {
  const [sale] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  if (sale === undefined || !(await owesOriginal(tx, sale.id))) return false;
  const ticket = await readSettledTicket(backend, tx, cfg, workingOrderId);
  const made = await enqueueOriginalReceipt(tx, cfg, ticket, sale.id, {
    personId,
    printers: printerLookup(tx, cfg.origin, { whileSwitchedOff: true }),
  });
  return typeof made === "object";
}

/** Every mode only enqueues paper for an existing sale. */
export async function printSaleReceipt(
  deps: { db: Database; backend: FiscalBackend },
  cfg: OriginConfig,
  workingOrderId: string,
  mode: "original" | "duplicate" | "owed",
  { language, personId }: { language?: string; personId?: string } = {},
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const [existing] = await tx
      .select({ id: sales.id, locale: sales.locale })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    if (language !== undefined && language !== existing?.locale) {
      // The sale's own language stays accepted after the venue stops offering it.
      const offered = await readOfferedReceiptLanguages(tx);
      if (!offered.includes(language)) {
        throw new AppError("management.request_invalid", { field: "language" });
      }
    }
    // No filed sale → nothing to print. This keeps `readSettledTicket`'s "no sale" throw unreachable.
    if (existing === undefined) return;
    if (mode === "owed") {
      await queueOwedOriginal(tx, deps.backend, cfg, workingOrderId, personId ?? null);
      return;
    }
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    if (mode === "duplicate") {
      await enqueueReceiptReprint(tx, cfg, ticket, existing.id, language, personId);
      return;
    }
    const printers = printerLookup(tx, cfg.origin);
    const made = await enqueueOriginalReceipt(tx, cfg, ticket, existing.id, { personId, printers });
    // "not_queued" also covers a receipt that could not be built; only a missing printer is refused.
    if (made === "not_queued" && (await printers("receipt")) === undefined)
      throw new AppError("receipt.no_printer", {});
  });
}

export async function readOutstandingSaleForOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<IssuedSale | undefined> {
  return (await readIssuedSales(tx, [workingOrderId])).get(workingOrderId);
}

/** A placed bill cannot be changed while a provider payment could still file its sale. */
export async function refusePlacedPaymentInFlight(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  const unfiled = await ordersWithUnfiledPayment(tx, orderIds);
  const inFlight = orderIds.find((id) => unfiled.has(id));
  if (inFlight !== undefined) {
    throw new AppError("order.payment_in_flight", { workingOrderId: inFlight });
  }
}

/** Refuse while a bill's payment or refund is still moving. */
export async function refuseBillPaymentInFlight(
  tx: Transaction,
  billId: string,
  status: WorkingOrderStatus,
): Promise<void> {
  await refuseRefundInProgress(tx, [billId]);
  await refusePendingPartPayment(tx, [billId], "any");
  if (status !== "open") await refusePlacedPaymentInFlight(tx, [billId]);
}

/**
 * Which of these orders has a payment that is, or could still become, a capture no sale records:
 * an attempt its provider has not resolved, or a capture not yet filed.
 */
export async function ordersWithUnfiledPayment(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ id: payments.workingOrderId })
    .from(payments)
    .leftJoin(billPayments, eq(billPayments.id, payments.billPaymentId))
    .where(
      and(
        inArray(payments.workingOrderId, [...orderIds]),
        or(
          eq(payments.state, "attempting"),
          and(
            inArray(payments.state, ["captured", "partially_refunded"]),
            isNull(payments.saleId),
            or(isNull(billPayments.id), ne(billPayments.state, "received")),
          ),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * Fire an open order's unsent dishes at payment when its service mode (prepay for
 * an order with none) is prepay, or when it is a counter order (no party) in a mode that sends
 * before payment; a party's bill in such a mode is left alone. A bill moved here from a table has
 * dishes already sent, which are not sent again. A zoned order's dish no station can take is not
 * sent and does not refuse the payment; it is returned, for the caller to raise
 * `raiseDishesNotSent` once the sale exists.
 */
export async function fireDishesAtPayment(
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
  // The order's party as the caller already read it in `tx`; omitted, it is read here.
  partyId?: string | null,
): Promise<DishesNotSent | null> {
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, workingOrderId);
  if ((serviceContext?.serviceMode ?? "prepay") !== "prepay") {
    if (!paysAfterSending(serviceContext?.serviceMode)) return null;
    const party =
      partyId !== undefined
        ? partyId
        : (
            await tx
              .select({ partyId: workingOrders.partyId })
              .from(workingOrders)
              .where(eq(workingOrders.id, workingOrderId))
          )[0]!.partyId;
    if (party !== null) return null;
  }
  const unsent = await unsentDishLines(tx, workingOrderId);
  await lateUnsentDishes(tx, workingOrderId, unsent, "mark");
  const unrouted = await fireLines(tx, cfg, workingOrderId, unsent, { unroutable: "skip" });
  await storePrepayMadeHere(tx, workingOrderId, [...(cfg.madeHereSink ?? [])]);
  return unrouted.length === 0 ? null : { productIds: unrouted.map((line) => line.productId!) };
}

/** Close a bill whose issued sale owes nothing without taking a tender. */
export async function settleIssuedOwingNothing(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "clock" | "log">,
  workingOrderId: string,
  saleId: SaleId,
): Promise<void> {
  await settleIssuedOrder(tx, { workingOrderId, saleId }, [], deps.clock.now().instant, deps.log);
}

/**
 * Settle an order's issued sale with these tenders and mark the order settled. `label` is for a
 * sale issued in this transaction: a presented order's label changes only as it settles.
 */
export async function settleIssuedOrder(
  tx: Transaction,
  order: { workingOrderId: string; saleId: SaleId; label?: string | null },
  tenders: SettleSaleTender[],
  settledAt: Date,
  log: TillSaleDeps["log"],
): Promise<void> {
  await settleSale(tx, { saleId: order.saleId, tenders });
  await tx
    .update(workingOrders)
    .set({
      ...(order.label === undefined ? {} : { label: order.label }),
      status: "settled",
      settledAt: settledAt.toISOString(),
    })
    .where(eq(workingOrders.id, order.workingOrderId));
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [order.workingOrderId]);
  await clearBillRequestIfPaid(tx, order.workingOrderId, log);
}

export async function reprintSale(
  deps: { db: Database; backend: FiscalBackend },
  cfg: OriginConfig,
  workingOrderId: string,
  language?: string,
  personId?: string,
): Promise<void> {
  await printSaleReceipt(deps, cfg, workingOrderId, "duplicate", { language, personId });
}
