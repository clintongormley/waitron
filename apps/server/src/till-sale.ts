import { selectOrderInvoice } from "./invoice-selection.js";
import { withReceiptListPrices } from "./receipt-lines.js";
import type { ExtraSelection, OptionSelection, OptionSnapshot } from "@waitron/shared";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { randomUUID } from "node:crypto";
import { clearBillRequestIfPaid } from "./bill-request.js";
// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { replayPrepayMadeHere, storePrepayMadeHere } from "./made-here.js";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  addDecimal,
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  saleId as brandSaleId,
  subtractDecimal,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import {
  billPaymentRefunds,
  billPayments,
  invoiceSeries,
  isUniqueViolation,
  nowIso,
  sales,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { Decimal, SaleId } from "@waitron/shared";
import { readReceiptLanguage } from "@waitron/catalogue";
import type { GrossLines } from "@waitron/catalogue";
import {
  payments,
  associatePaymentWithSale,
  findCapturedPaymentForWorkingOrder,
  recordManualCardPayment,
} from "@waitron/payments";
import type { CapturedPaymentForOrder, PaymentProvider, PaymentResult } from "@waitron/payments";
import { formatInvoiceNumber, recordSale, settleSale } from "@waitron/core";
import type { FiscalBackend, ReceiptQrText } from "@waitron/fiscal";
import {
  createOpenOrder,
  fireLines,
  paysAfterSending,
  priceStoredOrderForIssuance,
  refuseUnavailableFullInvoice,
  readInvoiceNumber,
  readStoredOrder,
  refusePaymentInFlight,
  toVatBreakdown,
  unsentDishLines,
} from "./working-order.js";
import type { GrossOrder, LineExtras, OrderLineIdentity, TillSaleDeps } from "./working-order.js";
import { issuancePass } from "./issuance-pass.js";
import { raiseDishesNotSent, type DishesNotSent } from "./dish-not-sent-alert.js";
import { issueMoment } from "./issue-moment.js";
import { cashChange, ZERO } from "./bill-allocation.js";
import { perDatabase } from "./live-in-process.js";
import { refuseBillWithPayments } from "./bill-payments.js";
import { readIssuedSales } from "./sale-due.js";
import { VENUE_SERVICE } from "./modules.js";
import { readReceiptOrder } from "./receipt-order.js";
import { receiptLines } from "./receipt-adjustments.js";
import type { DeviceRequestConfig, OriginConfig, TillConfig } from "./till-config.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";
import { storedDeviceOrigin } from "./request-config.js";
import {
  enqueueSaleDrawer,
  enqueueOriginalReceipt,
  enqueueReceiptReprint,
  enqueueSaleReceipt,
} from "./receipt-print.js";

/**
 * A `cash` or manual `card` tender. `externalRef` is the optional hand-keyed acquirer / terminal
 * operation number, meaningful only for `card`.
 */
export interface TillTender {
  method: "cash" | "card";
  amount: string;
  externalRef?: string;
}

/**
 * A walk-up sale as the counter till captures it. Deliberately carries NO price — the server prices
 * from the zone's menu offers, so a browser cannot influence the filed total.
 *
 * `workingOrderId` is the pay-idempotency key: held stable across a lost-response retry, a re-sent pay
 * REPLAYS rather than filing a second chained record. Absent, `recordTillSale` mints a fresh one. To
 * pay a parked order, the till sends that order's own id.
 */
export interface TillSaleRequest {
  /** A line MAY carry `options`, `extras` and per-line `LineExtras` (NON-FISCAL, never threaded into
   *  a sale/fiscal projection). The server validates them against the dish's own definitions. */
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  /**
   * `cash` — `amount` is the money tendered; the sale settles at the total and the change is
   * `amount − total`. `card` — a MANUAL card tender charged on a separate terminal: `amount` is
   * ignored, the card charges the exact total, and a captured `payments` row is filed beside the
   * tender. Any other method is refused `sale.unsupported_tender`.
   */
  tender: TillTender;
  invoiceType?: unknown;
  recipient?: unknown;
  workingOrderId?: string;
  /** The selected service zone for a new counter order. Existing orders use their stored context. */
  zoneId?: string;
  /**
   * Deliver this counter sale to a dining table (`working_orders.delivery_table_id`). Only the
   * WALK-UP create path writes it; a retrieved order ignores it. An unknown id is refused
   * `table.not_found`.
   */
  deliveryTableId?: string;
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
  /** The GROSS (VAT-inclusive) line total the line was filed at, as a decimal string. */
  gross: string;
  /**
   * The line's total at its price before a comp or a discount lowered it, present only when that
   * differs from `gross`. F1 replay reads it from the saved sale line.
   */
  listGross?: string;
  /** The comps and discounts printed beneath this row's dish; absent when there are none. */
  adjustments?: ReceiptAdjustment[];
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line, else `null`/absent.
   *  Presentation only: it groups already-filed lines and is no fiscal figure. */
  parentLineNo?: number | null;
  /** The diner's answers to this dish's OPTIONS lists, copied by value so a later catalogue edit
   *  cannot rewrite what a completed sale says was ordered. An extras pick is a child line instead. */
  optionSnapshots?: OptionSnapshot[];
}

/** An amount taken off, printed as its own line: presentation only, nothing is filed from it. */
export interface ReceiptAdjustment {
  kind: "comp" | "discount";
  /** Basis points, for a percentage discount only. */
  percentBp?: number;
  /** The positive amount taken off, as a decimal string. */
  amount: string;
}

/** Persisted tender amounts and optional manual terminal reference. Card identity belongs on the slip. */
export type TenderBlock =
  | { method: "unpaid" }
  | { method: "cash"; change: string }
  | {
      method: "card";
      charged: string;
      tip: string;
      reference: string | null;
    };

/**
 * One payment of a bill paid in parts before its invoice, as the ticket lists it. `change` is what
 * the bill payment handed back when it was taken, never derived from the tender, whose amount a
 * refund lowers.
 */
export type BillTenderLine = (
  | { method: "cash"; amount: string; tip: string; tendered: string; change: string }
  | { method: "card"; amount: string; tip: string; reference: string | null }
) & { refunds: BillTenderRefund[] };

/** Money given back from a bill payment before the invoice: a `completed` refund, oldest first. */
export interface BillTenderRefund {
  amount: string;
  tip: string;
}

export interface TillSaleResult {
  issuedOffsetMinutes?: number;
  operationDate?: string;
  invoiceType?: "F1" | "F2";
  issuer?: { venueName: string; nif: string; domicile?: string };
  recipient?: { taxId: string; legalName: string; countryCode: string; address: string };
  receiptHeader?: { tradingName: string; printTradingName: boolean };
  /** The language the sale was filed in (`sales.locale`). */
  locale: string;
  orderLabel: string | null;
  orderNumber: number;
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
  /** Every payment, when the bill was paid in parts before its invoice; absent otherwise. */
  payments?: BillTenderLine[];
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

/** Read the persisted amounts and manual terminal reference; card identity belongs on the slip. */
export async function readTenderBlock(
  tx: Transaction,
  cfg: TillConfig,
  saleId: SaleId,
  workingOrderId: string,
): Promise<TenderBlock> {
  void cfg;
  const [row] = await tx
    .select({
      method: tenders.method,
      amount: tenders.amount,
      tip: tenders.tipAmount,
      cashTendered: tenders.cashTendered,
    })
    .from(tenders)
    .where(eq(tenders.saleId, saleId))
    // Two tenders can share a millisecond; a tie falls back to `rowid`, the order the rows were
    // written in.
    .orderBy(tenders.settledAt, sql`${tenders}.rowid`)
    .limit(1);
  // Invoice-first issuance legitimately precedes the tender.
  if (row === undefined) return { method: "unpaid" };
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
    .select({ externalRef: payments.externalRef })
    .from(payments)
    .where(
      and(
        eq(payments.saleId, saleId),
        eq(payments.workingOrderId, workingOrderId),
        eq(payments.provider, "manual"),
      ),
    )
    .limit(1);
  return {
    method: "card",
    charged: tender.amount,
    tip: tender.tip,
    reference: payment?.externalRef ?? null,
  };
}

/** The payments of a sale whose tenders were taken as bill payments, in the order they were taken. */
export async function readBillTenderLines(
  tx: Transaction,
  saleId: SaleId,
): Promise<BillTenderLine[]> {
  const rows = await tx
    .select({
      billPaymentId: billPayments.id,
      method: tenders.method,
      amount: tenders.amount,
      tip: tenders.tipAmount,
      applied: billPayments.applied,
      paymentTip: billPayments.tip,
      tendered: billPayments.tendered,
      reference: payments.externalRef,
    })
    .from(tenders)
    .innerJoin(billPayments, eq(billPayments.id, tenders.billPaymentId))
    .leftJoin(
      payments,
      and(eq(payments.billPaymentId, billPayments.id), eq(payments.provider, "manual")),
    )
    .where(eq(tenders.saleId, saleId))
    // Two payments can share a millisecond; a tie falls back to `rowid`, the order the rows were
    // written in.
    .orderBy(tenders.settledAt, sql`${billPayments}.rowid`);
  const refundRows =
    rows.length === 0
      ? []
      : await tx
          .select({
            billPaymentId: billPaymentRefunds.billPaymentId,
            amount: billPaymentRefunds.appliedAmount,
            tip: billPaymentRefunds.tipAmount,
          })
          .from(billPaymentRefunds)
          .where(
            and(
              inArray(
                billPaymentRefunds.billPaymentId,
                rows.map((row) => row.billPaymentId),
              ),
              eq(billPaymentRefunds.state, "completed"),
            ),
          )
          .orderBy(billPaymentRefunds.completedAt, sql`${billPaymentRefunds}.rowid`);
  return rows.map((row) => {
    const amount = centsToDecimal(row.amount);
    const tip = centsToDecimal(row.tip);
    const refunds = refundRows
      .filter((refund) => refund.billPaymentId === row.billPaymentId)
      .map((refund) => ({
        amount: centsToDecimal(refund.amount),
        tip: centsToDecimal(refund.tip),
      }));
    if (row.method === "cash") {
      const tendered = centsToDecimal(row.tendered!);
      return {
        method: "cash",
        amount,
        tip,
        tendered,
        change: cashChange(row.tendered!, row.applied, row.paymentTip),
        refunds,
      };
    }
    return { method: "card", amount, tip, reference: row.reference ?? null, refunds };
  });
}

/**
 * A pay-and-settle over a PERSISTED working order, keyed by its client-minted id. `id` is the
 * idempotency key: `sales_working_order_id_key` makes at most one sale per working order.
 *
 * How `lines` is used depends on the shape:
 *  - WALK-UP (no `working_orders` row for `id`): `lines` is the unpriced basket; the server prices it
 *    (`createOpenOrder`), creates the order OPEN with those lines, and files that price.
 *  - RETRIEVED order (the row exists): `lines` is IGNORED. The order files its STORED
 *    `working_order_lines`, whose gross was locked at add-time, so a catalogue price change between
 *    park and pay never moves the filed total.
 */
export interface PayWorkingOrderRequest {
  id: string;
  /** The walk-up basket; IGNORED for a retrieved order. Carries the same per-line fields as
   *  `TillSaleRequest.lines`. */
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  /** Same shape and rules as `TillSaleRequest.tender`. */
  tender: TillTender;
  invoiceType?: unknown;
  recipient?: unknown;
  /** Deliver a WALK-UP sale to a dining table; ignored for a retrieved order. An unknown id is
   *  refused `table.not_found`. */
  deliveryTableId?: string;
  /** The selected service zone for a new counter order. Existing orders use their stored context. */
  zoneId?: string;
}

function refuseUnavailableInvoiceRequest(invoiceType: unknown, recipient: unknown): void {
  if (invoiceType !== undefined && invoiceType !== "F1" && invoiceType !== "F2") {
    throw new AppError("management.request_invalid", { field: "invoiceType" });
  }
  if (invoiceType === "F1") throw new AppError("sale.full_invoice_unavailable", {});
  if (recipient !== undefined && recipient !== null) {
    throw new AppError("management.request_invalid", { field: "recipient" });
  }
}

/**
 * A pay over an INTEGRATED card terminal, keyed like {@link PayWorkingOrderRequest} by the
 * working-order id. It carries NO tender — the provider drives the card. Same basket semantics:
 *  - WALK-UP (no `working_orders` row for `id`): `lines` is the basket to price and file.
 *  - RETRIEVED / PLACED order (the row exists): `lines` is IGNORED — the order files its own STORED
 *    locked lines (`priceStoredOrderForIssuance`).
 */
export interface IntegratedPayRequest {
  id: string;
  invoiceType?: unknown;
  recipient?: unknown;
  /** The walk-up basket; IGNORED for a retrieved/placed order. Carries the same per-line fields as
   *  `TillSaleRequest.lines`. */
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  /** The selected service zone for a new counter order. Existing orders use their stored context. */
  zoneId?: string;
  /** The card reader to charge on, overriding the paying device's default. Resolved and validated in
   *  `/api/pay`, never trusted here; the RESOLVED reader rides on {@link IntegratedPayDeps}. */
  readerId?: string;
  /** The till-entered gross tip. CLAMPED to "0.00" when `TillConfig.tipsEnabled` is false, so a
   *  client cannot add a tip the venue does not take. */
  tip?: string;
  /** Per-transaction staff consent to accept the card offline; meaningful only to a provider with a
   *  device-local offline queue. */
  allowOffline?: boolean;
  /** Test result selected by the practice UI. Only a server-mounted simulator may receive it. */
  simulationOutcome?: "captured" | "declined";
  /** One pretend-reader attempt, shared with its cancellation request. */
  demoAttemptId?: string;
}

/**
 * The outcome of an integrated pay, as DATA — a decline, stall or offline refusal is never an
 * exception (CLAUDE.md §5). Only `captured` carries a ticket; the other arms filed nothing, so the
 * till simply retries.
 */
export type IntegratedPayOutcome =
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "declined" }
  | { outcome: "timeout" }
  | { outcome: "network_unavailable" };

/** {@link payWorkingOrderIntegrated}'s deps: the fiscal {@link TillSaleDeps} plus the card `provider`. */
export type IntegratedPayDeps = TillSaleDeps & {
  provider: PaymentProvider;
  /** The chosen reader's VENDOR reference, passed to `provider.collect` for THIS sale.
   * `undefined` for a provider that uses no server-side reader. Distinct from `readerId`. */
  readerRef?: string;
  /** The `card_readers.id` the pay routed to, stamped onto the payment when it is associated with
   * the sale; `undefined` leaves `payments.reader_id` NULL. */
  readerId?: string;
};

/**
 * Pay and settle a working order idempotently, so a lost-response retry never files a SECOND chained
 * fiscal record (CLAUDE.md §5). The order's settle, the sale, its tender/settlement and its chained
 * fiscal record commit in ONE transaction.
 *
 * Keyed on `req.id`:
 *  1. Read the order's status. A concurrent pay cannot interleave: one write transaction runs on the
 *     venue file at a time, so the second pay's whole transaction starts only after the first has
 *     committed, and reads the row `settled` (`assertExtraListForWrite`,
 *     `packages/catalogue/src/extras.ts`).
 *  2. Already `settled` → IDEMPOTENT REPLAY: return the existing sale's ticket, file NOTHING.
 *  3. Any other non-`open` status → `working_order.not_open`.
 *  4. Absent → WALK-UP: create it `open` with freshly-priced lines (`createOpenOrder`) and file that
 *     price.
 *  5. `open` (RETRIEVED) → file the STORED locked lines (`priceStoredOrderForIssuance`), never a
 *     re-price of `req.lines`.
 *  Steps 4 and 5 give the kitchen the dishes it has not been given, a later course's dish held for
 *  its course, in the same transaction, for the orders `fireDishesAtPayment` names; a zoned
 *  order's dish no station can take is not sent and is named in a `route.dish_not_sent` alert
 *  instead, or logged under that code if the alert is refused.
 *  6. A unique violation is replayed in a FRESH transaction, filing nothing. Step 1 already
 *     serialises pays in this process; the backstop stays because `sales_working_order_id_key`
 *     refuses a second sale for one working order whatever wrote it.
 *
 * `operatorId` is the person who rang the sale, for attribution.
 */
export async function payWorkingOrder(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  req: PayWorkingOrderRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  try {
    return await withTransaction(deps.db, async (tx) => {
      // Step 1; the doc comment says what serialises a concurrent pay against this read.
      const [locked] = await tx
        .select({ status: workingOrders.status, partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id));

      if (locked?.status === "settled") {
        return readSettledTicket(deps.backend, tx, cfg, req.id);
      }

      refuseUnavailableInvoiceRequest(req.invoiceType, req.recipient);

      // The domain code, rather than the raw `working_orders_enforce_transition` trigger error the
      // settle UPDATE would otherwise raise.
      if (locked !== undefined && locked.status !== "open") {
        throw new AppError("working_order.not_open", { workingOrderId: req.id });
      }
      if (locked !== undefined) {
        // Before the in-flight check, so the answer names the money already on the bill.
        await refuseBillWithPayments(tx, req.id);
        // A card payment of this order would file its own sale after this one (plan D22).
        await refusePaymentInFlight(tx, [req.id]);
        await refuseUnavailableFullInvoice(tx, req.id);
      }

      // The till is a network boundary. AFTER the replay check, so a retry of an already-settled
      // order is never refused for the shape of its retry body.
      if (req.tender.method !== "cash" && req.tender.method !== "card") {
        throw new AppError("sale.unsupported_tender", { method: req.tender.method });
      }

      let order: GrossOrder;
      if (locked === undefined) {
        // Walk-up only, because a retrieved order ignores `req.lines`.
        if (req.lines.length === 0) {
          throw new AppError("sale.empty_basket", {});
        }
        order = await createOpenOrder(tx, cfg, req.id, req.lines, null, {
          deliveryTableId: req.deliveryTableId,
          zoneId: req.zoneId,
          creditedTo: operatorId,
          invalidMakeAt: "ignore",
          invoiceChoice: {
            invoiceType: req.invoiceType,
            recipient: req.recipient,
            recipientNameMaxLength: deps.backend.recipientNameMaxLength,
          },
        });
      } else {
        order = await priceStoredOrderForIssuance(tx, req.id);
      }

      // A walk-up is created with no party.
      return fireAndFileSale(
        tx,
        deps,
        cfg,
        req.id,
        req.tender,
        order,
        locked?.partyId ?? null,
        operatorId,
      );
    });
  } catch (error) {
    // Step 6. Anything but a unique violation is a real failure and surfaces unchanged.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return withTransaction(deps.db, async (tx) => {
      const [row] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id));
      /* v8 ignore start */
      if (row?.status !== "settled") {
        // No settled winner: not the idempotency case. Surface the original error rather than report
        // a success with no sale behind it.
        throw error;
      }
      /* v8 ignore stop */
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    });
  }
}

/**
 * Give the kitchen the dishes paying sends ({@link fireDishesAtPayment}), file the sale
 * ({@link fileImmediateSale}), and once the sale exists raise the alert naming any dish no station
 * could take. `partyId` is the order's party as the caller read it, or `null` for an order the
 * caller has just created.
 */
async function fireAndFileSale(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  tender: TillTender | null,
  order: GrossOrder,
  partyId: string | null,
  operatorId?: string,
): Promise<TillSaleResult> {
  const notSent = await fireDishesAtPayment(tx, cfg, workingOrderId, partyId);

  const ticket = await fileImmediateSale(tx, deps, cfg, workingOrderId, tender, order, operatorId);
  if (notSent !== null) {
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    await raiseDishesNotSent(
      tx,
      cfg,
      sale!.id,
      workingOrderId,
      notSent,
      deps.clock.now().instant,
      deps.log,
    );
  }
  return ticket;
}

/** Reconstruct the filed invoice and persisted payment facts for original, duplicate or pay replay. */
export async function readSettledTicket(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TillConfig,
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
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.workingOrderId, workingOrderId));

  /* v8 ignore start */
  if (issued === undefined) {
    // The settle UPDATE and the sale INSERT commit in one transaction, so this is corruption.
    throw new Error(`payWorkingOrder: settled working order ${workingOrderId} has no sale`);
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
  /* v8 ignore start */
  if (filed === undefined) {
    // Corruption, as above. Fail rather than reprint a legal receipt with an invented breakdown (§5).
    throw new Error(
      `payWorkingOrder: settled working order ${workingOrderId} has no filed fiscal record`,
    );
  }
  /* v8 ignore stop */

  const tender = await readTenderBlock(tx, cfg, brandSaleId(issued.saleId), workingOrderId);
  const billTenders = await readBillTenderLines(tx, brandSaleId(issued.saleId));

  return {
    ...(await readReceiptOrder(tx, cfg, workingOrderId)),
    receiptHeader: (await VENUE_SERVICE.readSaleReceiptHeader(tx, issued.saleId)) ?? undefined,
    locale: issued.locale,
    invoiceNumber: formatInvoiceNumber(issued.code, issued.number),
    // So a replay's `issuedAt` reads identically to the original's `fiscal.issuedAt.toISOString()`.
    issuedAt: new Date(issued.issuedAt).toISOString(),
    total: centsToDecimal(issued.total),
    vatBreakdown: toVatBreakdown(filed.vatBreakdown),
    ...ticketLines,
    tender,
    ...(billTenders.length === 0 ? {} : { payments: billTenders }),
    ...receiptQr(backend, filed.verificationUrl),
    ...(await readReceiptIssuer(backend, tx, brandSaleId(issued.saleId))),
  };
}

/** The action determines original versus duplicate; both only enqueue paper for an existing sale. */
export async function printSaleReceipt(
  deps: { db: Database; backend: FiscalBackend },
  cfg: OriginConfig,
  workingOrderId: string,
  duplicate: boolean,
  language?: string,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    if (language !== undefined) {
      // Any of the pack's languages, even where the region fixes one (`fixed`), is a product
      // choice (docs/backlog.md, C114); it includes Spanish, which a customer there may ask for
      // (TC 88/2017).
      const { choices } = await readVenueReceiptLanguageRules(tx, { locationId: cfg.locationId });
      if (!choices.includes(language)) {
        throw new AppError("management.request_invalid", { field: "language" });
      }
    }
    // No filed sale → nothing to print. This keeps `readSettledTicket`'s "no sale" throw unreachable.
    const [existing] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    if (existing === undefined) return;
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    if (duplicate) await enqueueReceiptReprint(tx, cfg, ticket, existing.id, language);
    else await enqueueOriginalReceipt(tx, cfg, ticket, existing.id);
  });
}

/** Cash covers the settled total; short cash is passed through so settlement rejects it atomically. */
function settlementFor(tender: TillTender, total: string): { settledAmount: string } {
  return {
    settledAmount:
      tender.method === "card" || compareDecimal(decimal(tender.amount), decimal(total)) >= 0
        ? total
        : tender.amount,
  };
}

/**
 * File an IMMEDIATE cash/card sale from an order's gross lines and settle it on the caller's `tx`,
 * so the sale, its tender/settlement, its chained fiscal record and the → `settled` transition commit
 * as one unit. It does NOT read or guard the order status: the caller resolved it, and one write
 * transaction runs on the venue file at a time, so nothing has moved the row in between.
 *
 * A sale whose total is zero (every line given away, or free) is settled with no tender, no
 * `payments` row and no drawer opening, as {@link settleOwingNothing} settles an invoice that owes
 * nothing. `tender` is `null` only where nothing can be owed; a `null` tender on a sale that owes
 * something is refused `sale.tender_shortfall`.
 */
async function fileImmediateSale(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  tender: TillTender | null,
  order: GrossOrder,
  operatorId?: string,
): Promise<TillSaleResult> {
  const { priced, clock } = issueMoment(
    deps.clock,
    await issuancePass(tx, cfg, workingOrderId, order),
  );
  // Before the owes-nothing check, so a malformed cash amount is refused whatever is owed.
  const settled = tender === null ? null : { ...tender, ...settlementFor(tender, priced.total) };
  const taken = compareDecimal(decimal(priced.total), ZERO) > 0 ? settled : null;

  // The issue reading, shared by the invoice, the tender and the order's `settled_at`.
  const settledAt = clock.now().instant;

  const selected = await selectOrderInvoice(tx, deps.backend, cfg, workingOrderId, priced.total);
  const language = await readReceiptLanguage(tx, cfg.locationId);
  const { saleId, fiscal } = await recordSale(tx, deps.backend, {
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    ...selected.sale,
    // The sale-idempotency key (`sales_working_order_id_key`).
    workingOrderId: brandWorkingOrderId(workingOrderId),
    ...language,
    total: priced.total,
    lines: withReceiptListPrices(priced.lines, order.identities),
    vatBreakdown: priced.vatBreakdown,
    clock,
    operatorId,
    settlement: {
      kind: "immediate",
      tenders:
        taken === null
          ? []
          : [
              {
                method: taken.method,
                amount: taken.settledAmount,
                tipAmount: "0.00",
                cashTendered: taken.method === "cash" ? taken.amount : null,
                settledAt,
              },
            ],
    },
  });
  const receiptContext = await VENUE_SERVICE.findOrderContext(tx, cfg, workingOrderId);
  await VENUE_SERVICE.recordSaleReceiptHeader(tx, cfg, saleId, receiptContext?.zoneId ?? null);

  // A manual card also gets a captured `payments` row, linked to the sale in this transaction.
  // `recordManualCardPayment` makes no network call, so it commits inline with the sale.
  if (taken?.method === "card") {
    const { provider, paymentRef } = await recordManualCardPayment(tx, {
      origin: cfg.origin,
      workingOrderId,
      amount: decimal(priced.total),
      settledAt,
      externalRef: taken.externalRef,
    });
    await associatePaymentWithSale(tx, { provider, paymentRef, saleId });
  }

  await tx
    .update(workingOrders)
    .set({
      label: (await readReceiptOrder(tx, cfg, workingOrderId, { atIssuance: true })).orderLabel,
      status: "settled",
      settledAt: settledAt.toISOString(),
    })
    .where(eq(workingOrders.id, workingOrderId));
  await clearBillRequestIfPaid(tx, workingOrderId, deps.log);

  // After both writes above, so a manual acquirer reference is visible.
  const tenderBlock = await readTenderBlock(tx, cfg, saleId, workingOrderId);

  // `FiscalRecordRef` is regime-opaque, so the "A/1" is read back from the sale row and its series.
  const ticket: TillSaleResult = {
    ...(await readReceiptIssuer(deps.backend, tx, saleId)),
    receiptHeader: (await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId)) ?? undefined,
    ...(await readReceiptOrder(tx, cfg, workingOrderId)),
    locale: language.locale,
    invoiceNumber: await readInvoiceNumber(tx, saleId),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    ...(await receiptLines(tx, workingOrderId, priced, order.identities, saleId)),
    tender: tenderBlock,
    ...receiptQr(deps.backend, fiscal.verificationUrl),
  };

  await enqueueSaleReceipt(tx, cfg, ticket, saleId);
  if (taken !== null) await enqueueSaleDrawer(tx, cfg, saleId, taken.method, operatorId);
  return ticket;
}

async function readOutstandingSaleForOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ saleId: SaleId; amountDue: Decimal } | undefined> {
  return (await readIssuedSales(tx, [workingOrderId])).get(workingOrderId);
}

/**
 * Pay and settle a working order over an INTEGRATED card terminal. The network `collect` runs OUTSIDE
 * any database transaction, because an open write transaction holds the whole venue file against
 * every other writer, so this is three phases:
 *
 *  - P1 (tx A). Resolve the order and decide what to do; a bill whose amount due is exactly zero is
 *    settled here, or filed and settled here when it has no sale yet, and one below zero is refused.
 *    A WALK-UP is created `open` and COMMITTED here, because the provider's payment row carries a
 *    foreign key to `working_orders` (`payments_working_order_fk`).
 *  - P2 (no tx). Drive the reader for the amount plus tip. A non-captured result files NOTHING and is
 *    returned as data (CLAUDE.md §5).
 *  - P3 (tx B). File or settle the sale, associate the captured payment and settle the order,
 *    atomically.
 *
 * P1's serialisation ends at its own commit, so two pays for one id can both pass P1 with the order
 * unsettled and both reach P3 — which is why `finalizeCapture` and `finalizeSettle` each keep a
 * duplicate backstop, while `finalizeRecovery`, `finalizeSettleRecovery`, the `owes-nothing`
 * settlement in P1 and `collectOrder` (one transaction end to end) need none.
 *
 * P1's result:
 *  - `replay` — already `settled`; return the stored ticket, file nothing.
 *  - `recover` / `recover-settle` — a captured payment with no sale (P2 committed, P3 never ran).
 *    Finish it WITHOUT charging again: file a sale, or settle the already-issued invoice when there is
 *    one, since a second `recordSale` would collide with it.
 *  - `owes-nothing` — a sale was already issued and its corrections leave nothing owed, or there is
 *    no sale and the order's total is zero: settled here, with the sale filed first when there is
 *    none, without asking the reader, as {@link collectOrder} does; below zero it is refused.
 *  - `settle` — a sale was already issued for the order: collect the amount due and SETTLE it.
 *  - `collect` — no sale yet: collect the priced total and file the sale.
 */
export async function payWorkingOrderIntegrated(
  deps: IntegratedPayDeps,
  cfg: DeviceRequestConfig,
  req: IntegratedPayRequest,
  operatorId?: string,
): Promise<IntegratedPayOutcome> {
  const live = liveAttemptsOf(deps.db);
  // The mark this call wrote, once P1 has written it; unregistered however the call ends.
  let marked: string | null = null;
  let heldPlaced = false;
  try {
    return await payIntegrated(
      deps,
      cfg,
      req,
      operatorId,
      live,
      (attemptAt) => {
        marked = attemptAt;
        live.set(req.id, attemptAt);
      },
      () => {
        heldPlaced = true;
        holdPlacedAttempt(deps.db, req.id);
      },
    );
  } finally {
    if (marked !== null && live.get(req.id) === marked) live.delete(req.id);
    if (heldPlaced) releasePlacedAttempt(deps.db, req.id);
  }
}

async function payIntegrated(
  deps: IntegratedPayDeps,
  cfg: DeviceRequestConfig,
  req: IntegratedPayRequest,
  operatorId: string | undefined,
  live: ReadonlyMap<string, string>,
  onMarked: (attemptAt: string) => void,
  onPlacedCollect: () => void,
): Promise<IntegratedPayOutcome> {
  // ---- P1 (tx A) ----
  const prepared = await withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({
        status: workingOrders.status,
        attemptAt: workingOrders.paymentAttemptAt,
        partyId: workingOrders.partyId,
      })
      .from(workingOrders)
      .where(eq(workingOrders.id, req.id));

    if (locked?.status === "settled") {
      return {
        kind: "replay" as const,
        ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
      };
    }

    if (locked !== undefined && locked.status !== "open" && locked.status !== "placed") {
      throw new AppError("working_order.not_open", { workingOrderId: req.id });
    }

    if (locked !== undefined) {
      await refuseUnavailableFullInvoice(tx, req.id);
    }
    refuseUnavailableInvoiceRequest(req.invoiceType, req.recipient);

    // Walk-up only, because a retrieved or placed order ignores `req.lines`.
    if (req.lines.length === 0 && locked === undefined) {
      throw new AppError("sale.empty_basket", {});
    }

    // A walk-up has no prior sale, and no payment row either: that row's foreign key needs the
    // order row, which P1 is about to create.
    if (locked !== undefined) {
      // Before the recovery below, which would take a card bill payment's capture for this pay's
      // own and invoice the whole order from it.
      await refuseBillWithPayments(tx, req.id);
      const outstanding = await readOutstandingSaleForOrder(tx, req.id);

      // A captured payment with no sale: P2 committed but P3 never ran. Driving `collect` again
      // would charge the card a SECOND time.
      const captured = await findCapturedPaymentForWorkingOrder(tx, {
        provider: deps.provider.provider,
        workingOrderId: req.id,
      });
      if (captured !== undefined && captured.saleId === null) {
        return outstanding !== undefined
          ? { kind: "recover-settle" as const, captured, outstanding }
          : { kind: "recover" as const, captured };
      }

      if (outstanding !== undefined) {
        if (compareDecimal(outstanding.amountDue, ZERO) <= 0) {
          // Called only to refuse a malformed tip when tips are on; none is charged on a bill that
          // owes nothing.
          tipOf(cfg, req);
          return {
            kind: "owes-nothing" as const,
            ticket: await settleOwingNothing(tx, deps, cfg, req.id, outstanding.saleId),
          };
        }
        if (locked.status === "placed") onPlacedCollect();
        return { kind: "settle" as const, outstanding };
      }

      // After the recovery above, so a till pressing Pay again to file a captured payment is never
      // refused. A mark no live attempt and no unfiled payment stands behind is overwritten below.
      if (
        locked.status === "open" &&
        locked.attemptAt !== null &&
        (live.has(req.id) || (await ordersWithUnfiledPayment(tx, [req.id])).has(req.id))
      ) {
        throw new AppError("order.payment_in_flight", { workingOrderId: req.id });
      }
    }

    const order: GrossOrder =
      locked === undefined
        ? await createOpenOrder(tx, cfg, req.id, req.lines, null, {
            zoneId: req.zoneId,
            creditedTo: operatorId,
            invalidMakeAt: "ignore",
            invoiceChoice: {
              invoiceType: req.invoiceType,
              recipient: req.recipient,
              recipientNameMaxLength: deps.backend.recipientNameMaxLength,
            },
          })
        : await priceStoredOrderForIssuance(tx, req.id);
    // Before the reader is asked: P3 could never file this sale.
    await selectOrderInvoice(tx, deps.backend, cfg, req.id, order.gross.total);
    const wasPlaced = locked?.status === "placed";
    if (compareDecimal(order.gross.total, ZERO) === 0) {
      // Nothing to charge, so the reader is not asked and no tip is taken; called only to refuse a
      // malformed tip when tips are on. A placed order's dishes were sent when it was placed, and a
      // walk-up is created with no party.
      tipOf(cfg, req);
      return {
        kind: "owes-nothing" as const,
        ticket: wasPlaced
          ? await fileImmediateSale(tx, deps, cfg, req.id, null, order, operatorId)
          : await fireAndFileSale(
              tx,
              deps,
              cfg,
              req.id,
              null,
              order,
              locked?.partyId ?? null,
              operatorId,
            ),
      };
    }
    // P3 files THESE gross lines, whatever changes while the reader runs, at the rates of the day it
    // issues the invoice.
    const gross = await issuancePass(tx, cfg, req.id, order);
    // An open order's lines could still change under the reader, so it is marked in flight (plan
    // D22). A placed order's priced columns are already frozen, and
    // `working_orders_enforce_transition` refuses its `payment_attempt_at` being set.
    const attemptAt = wasPlaced ? null : nowIso();
    if (attemptAt !== null) {
      await tx
        .update(workingOrders)
        .set({ paymentAttemptAt: attemptAt })
        .where(eq(workingOrders.id, req.id));
      // Inside the transaction, so no release pass runs between the mark and its registration.
      onMarked(attemptAt);
    } else {
      // Inside the transaction, so a cancel either runs first, and this P1 reads it `abandoned`, or
      // runs after and sees the attempt live.
      onPlacedCollect();
    }
    return {
      kind: "collect" as const,
      gross,
      identities: order.identities,
      wasPlaced,
      attemptAt,
    };
  });

  if (prepared.kind === "replay" || prepared.kind === "owes-nothing") {
    return { outcome: "captured", ticket: prepared.ticket };
  }
  // P2 is skipped entirely: the card was already charged.
  if (prepared.kind === "recover") {
    return finalizeRecovery(deps, cfg, req, prepared.captured, operatorId);
  }
  if (prepared.kind === "recover-settle") {
    return finalizeSettleRecovery(deps, cfg, req, prepared.captured, prepared.outstanding);
  }

  // ---- P2 (no tx) ----
  const tip = tipOf(cfg, req);
  const baseAmount =
    prepared.kind === "settle" ? prepared.outstanding.amountDue : prepared.gross.total;
  // Only a collect of an open order marked it; a settle is of a placed order.
  const attemptAt = prepared.kind === "collect" ? prepared.attemptAt : null;
  let result: PaymentResult;
  try {
    result = await deps.provider.collect({
      origin: cfg.origin,
      workingOrderId: brandWorkingOrderId(req.id),
      amount: addDecimal(baseAmount, tip),
      ...(deps.readerRef === undefined ? {} : { readerRef: deps.readerRef }),
      allowOffline: req.allowOffline,
      simulationOutcome: req.simulationOutcome,
      demoAttemptId: req.demoAttemptId,
    });
  } catch (error) {
    await releasePaymentAttempt(deps, req.id, attemptAt);
    throw error;
  }
  if (result.state !== "captured" && result.state !== "accepted_offline") {
    // A timed-out reader leaves its payment `attempting`, which keeps the mark: the provider's
    // sweep may still capture it.
    await releasePaymentAttempt(deps, req.id, attemptAt);
    return toPayOutcome(result, null);
  }

  // ---- P3 (tx B) ----
  if (prepared.kind === "settle") {
    return {
      outcome: "captured",
      ticket: await finalizeSettle(deps, cfg, req, prepared.outstanding, tip, result),
    };
  }
  const ticket = await finalizeCapture(
    deps,
    cfg,
    req,
    prepared.gross,
    prepared.identities,
    tip,
    result,
    operatorId,
    prepared.wasPlaced,
  );
  return { outcome: "captured", ticket };
}

function tipOf(cfg: TillConfig, req: IntegratedPayRequest): Decimal {
  // The default sits outside the ternary so a tips-off call exercises it too.
  const tipInput = req.tip ?? "0.00";
  return cfg.tipsEnabled ? decimal(tipInput) : decimal("0.00");
}

/** The integrated card attempts running in this process: order id to the mark its P1 wrote (plan
 * D22), or {@link PLACED_ATTEMPT} for a placed order, which has none. */
const liveAttemptsOf = perDatabase(() => new Map<string, string>());

/** Whether an integrated card attempt on this order is running in this process. */
export function paymentAttemptIsLive(db: Database, workingOrderId: string): boolean {
  return liveAttemptsOf(db).has(workingOrderId);
}

/** A placed order writes no mark, so its entry in the live map carries this instead of one. */
const PLACED_ATTEMPT = "placed";

/** How many integrated attempts on each placed order are running: two pays of one placed order may
 * both reach the reader, and the entry must outlive the first to finish. */
const placedAttemptsOf = perDatabase(() => new Map<string, number>());

function holdPlacedAttempt(db: Database, workingOrderId: string): void {
  const held = placedAttemptsOf(db);
  held.set(workingOrderId, (held.get(workingOrderId) ?? 0) + 1);
  liveAttemptsOf(db).set(workingOrderId, PLACED_ATTEMPT);
}

function releasePlacedAttempt(db: Database, workingOrderId: string): void {
  const held = placedAttemptsOf(db);
  const left = held.get(workingOrderId)! - 1;
  if (left > 0) {
    held.set(workingOrderId, left);
    return;
  }
  held.delete(workingOrderId);
  const live = liveAttemptsOf(db);
  if (live.get(workingOrderId) === PLACED_ATTEMPT) live.delete(workingOrderId);
}

/**
 * Which of these orders has a payment that is, or could still become, a capture no sale records:
 * an attempt its provider has not resolved, or a capture not yet filed. This decides whether a
 * mark may be RELEASED, whether Pay may go ahead over one, and whether a placed order's invoice
 * may be credited (`cancelPlacedOrder`); the check of the mark itself (`refuseOrderPaymentMarked`)
 * reads only the mark.
 */
export async function ordersWithUnfiledPayment(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ id: payments.workingOrderId })
    .from(payments)
    .where(
      and(
        inArray(payments.workingOrderId, [...orderIds]),
        or(
          eq(payments.state, "attempting"),
          and(inArray(payments.state, ["captured", "accepted_offline"]), isNull(payments.saleId)),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * Clear the in-flight mark `attemptAt` wrote on an OPEN order (plan D22), after an attempt that
 * filed nothing, unless a payment of the order could still be captured or waits to be filed. `null`
 * is an attempt that wrote none. A failure is logged and never replaces the attempt's own outcome;
 * the loop's next release pass clears what this could not.
 */
async function releasePaymentAttempt(
  deps: IntegratedPayDeps,
  workingOrderId: string,
  attemptAt: string | null,
): Promise<void> {
  if (attemptAt === null) return;
  try {
    await withTransaction(deps.db, (tx) => clearPaymentAttemptMark(tx, workingOrderId, attemptAt));
  } catch (error) {
    deps.log?.("warn", "payment_attempt.release_failed", {
      workingOrderId,
      error: String(error),
    });
  }
}

/**
 * Clear the in-flight mark `attemptAt` on an OPEN order, unless a payment of the order could still
 * be captured or waits to be filed, or the mark has since been replaced.
 */
export async function clearPaymentAttemptMark(
  tx: Transaction,
  workingOrderId: string,
  attemptAt: string,
): Promise<void> {
  if ((await ordersWithUnfiledPayment(tx, [workingOrderId])).has(workingOrderId)) return;
  await tx
    .update(workingOrders)
    .set({ paymentAttemptAt: null })
    .where(
      and(
        eq(workingOrders.id, workingOrderId),
        eq(workingOrders.status, "open"),
        eq(workingOrders.paymentAttemptAt, attemptAt),
      ),
    );
}

/**
 * Clear the in-flight mark (plan D22) on every OPEN order whose attempt is not running in this
 * process and which has no payment that is, or could still become, a capture not yet filed.
 * Returns how many it cleared.
 */
export async function releaseStalePaymentAttempts(db: Database): Promise<number> {
  return withTransaction(db, async (tx) => {
    const marked = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.status, "open"), isNotNull(workingOrders.paymentAttemptAt)));
    // Read inside the transaction: a P1 registers its attempt in its own, which this one excludes.
    const live = liveAttemptsOf(db);
    const candidates = marked.map((row) => row.id).filter((id) => !live.has(id));
    if (candidates.length === 0) return 0;
    const held = await ordersWithUnfiledPayment(tx, candidates);
    const releasable = candidates.filter((id) => !held.has(id));
    if (releasable.length === 0) return 0;
    await tx
      .update(workingOrders)
      .set({ paymentAttemptAt: null })
      .where(inArray(workingOrders.id, releasable));
    return releasable.length;
  });
}

/**
 * P3 of {@link payWorkingOrderIntegrated}: file the immediate card sale, link the captured payment and
 * settle the order in ONE transaction.
 *
 * Two pays can both commit a P1 that saw the order unsettled and both arrive here. The loser's P3 runs
 * after the winner's committed, its `recordSale` is refused by `sales_working_order_id_key`, and it
 * replays the winner's ticket instead of filing a second record. The replay prints nothing.
 *
 * The tender records the WHOLE card charge (`total + tip`) with the tip on it; the fiscal `total`
 * stays ex-tip, a tip being on no invoice.
 */
async function finalizeCapture(
  deps: IntegratedPayDeps,
  cfg: DeviceRequestConfig,
  req: IntegratedPayRequest,
  grossInP1: GrossLines,
  identities: readonly OrderLineIdentity[],
  tip: Decimal,
  result: PaymentResult,
  operatorId?: string,
  // True when the order was `placed` at P1.
  wasPlaced = false,
): Promise<TillSaleResult> {
  const settledAt = result.settledAt;
  /* v8 ignore start -- unreachable: finalizeCapture is only called on a `captured`/`accepted_offline`
     result, whose `settledAt` is always set (provider.ts:66-83). The guard mirrors `readSettledTicket`'s
     own "impossible" throws — a defended contract, not a claim reasoned away (CLAUDE.md §1). */
  if (settledAt === null) {
    throw new Error(`finalizeCapture: a ${result.state} result carried no settledAt`);
  }
  /* v8 ignore stop */
  try {
    return await withTransaction(deps.db, async (tx) => {
      const { priced, clock } = issueMoment(deps.clock, grossInP1);
      const selected = await selectOrderInvoice(tx, deps.backend, cfg, req.id, priced.total);
      const language = await readReceiptLanguage(tx, cfg.locationId);
      const { saleId, fiscal } = await recordSale(tx, deps.backend, {
        origin: cfg.origin,
        nodeId: cfg.nodeId,
        ...selected.sale,
        // The sale-idempotency key (`sales_working_order_id_key`) the backstop below relies on.
        workingOrderId: brandWorkingOrderId(req.id),
        ...language,
        total: priced.total,
        lines: withReceiptListPrices(priced.lines, identities),
        vatBreakdown: priced.vatBreakdown,
        clock,
        operatorId,
        settlement: {
          kind: "immediate",
          tenders: [
            { method: "card", amount: addDecimal(priced.total, tip), tipAmount: tip, settledAt },
          ],
        },
      });
      const receiptContext = await VENUE_SERVICE.findOrderContext(tx, cfg, req.id);
      await VENUE_SERVICE.recordSaleReceiptHeader(tx, cfg, saleId, receiptContext?.zoneId ?? null);

      // The provider already recorded the payment row; this only points its `sale_id` at the sale.
      await associatePaymentWithSale(tx, {
        provider: result.provider,
        paymentRef: result.paymentRef,
        saleId,
        ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
      });

      // After `recordSale`, so a concurrent loser, refused there, never reaches the fire. A placed
      // order was fired when it was placed and must not be fired again.
      const notSent = wasPlaced ? null : await fireDishesAtPayment(tx, cfg, req.id);

      await tx
        .update(workingOrders)
        .set({
          label: (await readReceiptOrder(tx, cfg, req.id, { atIssuance: true })).orderLabel,
          status: "settled",
          settledAt: settledAt.toISOString(),
          ...(wasPlaced ? {} : { paymentAttemptAt: null }),
        })
        .where(eq(workingOrders.id, req.id));
      await clearBillRequestIfPaid(tx, req.id, deps.log);
      if (notSent !== null) {
        await raiseDishesNotSent(
          tx,
          cfg,
          saleId,
          req.id,
          notSent,
          deps.clock.now().instant,
          deps.log,
        );
      }

      const tenderBlock = await readTenderBlock(tx, cfg, saleId, req.id);

      const ticket: TillSaleResult = {
        ...(await readReceiptIssuer(deps.backend, tx, saleId)),
        receiptHeader: (await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId)) ?? undefined,
        ...(await readReceiptOrder(tx, cfg, req.id)),
        locale: language.locale,
        invoiceNumber: await readInvoiceNumber(tx, saleId),
        issuedAt: fiscal.issuedAt.toISOString(),
        total: priced.total,
        vatBreakdown: toVatBreakdown(priced.vatBreakdown),
        ...(await receiptLines(tx, req.id, priced, identities, saleId)),
        tender: tenderBlock,
        ...receiptQr(deps.backend, fiscal.verificationUrl),
      };
      // A card on a connected machine: a receipt and no drawer. A throw here would roll back a sale
      // whose card P2 already charged.
      await enqueueSaleReceipt(tx, cfg, ticket, saleId);
      return ticket;
    });
  } catch (error) {
    // Anything but a unique violation is a real failure and surfaces unchanged.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return withTransaction(deps.db, async (tx) => {
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    });
  }
}

/**
 * File the sale for a captured payment that has none (P2 committed, P3 never ran) WITHOUT charging
 * again: file from the order's STORED locked lines and associate THIS captured row, in ONE
 * transaction. A concurrent recovery needs no backstop: its whole transaction runs after the winner
 * committed, reads the order `settled`, and replays.
 *
 * The charge was `total + tip`, so the tip is reconstructed as `captured.amount − priced.total`; the
 * fiscal `total` stays ex-tip. A charge below the locked total means there is no honest figure to
 * file: file NOTHING and throw a plain `Error`, leaving the captured payment unassociated for
 * reconciliation (§5).
 */
async function finalizeRecovery(
  deps: IntegratedPayDeps,
  cfg: DeviceRequestConfig,
  req: IntegratedPayRequest,
  captured: CapturedPaymentForOrder,
  operatorId?: string,
): Promise<IntegratedPayOutcome> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status, partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, req.id));

    // A concurrent winner filed the sale and settled the order before this transaction started:
    // replay, filing and associating nothing.
    if (locked?.status === "settled") {
      return {
        outcome: "captured",
        ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
      };
    }

    const order = await priceStoredOrderForIssuance(tx, req.id, { refuseUnsentUnavailable: false });
    const { priced, clock } = issueMoment(deps.clock, await issuancePass(tx, cfg, req.id, order));
    const capturedAmount = decimal(captured.amount);

    if (compareDecimal(capturedAmount, priced.total) < 0) {
      throw new Error(
        `finalizeRecovery: captured ${captured.amount} is below the locked total ${priced.total} for working order ${req.id}`,
      );
    }

    const tip = subtractDecimal(capturedAmount, priced.total);

    /* v8 ignore start -- a captured/accepted_offline row always carries settled_at (store.ts's
       insertCapturedPayment/captureAttempting set it); the null-typed column is DEFENDED here, not
       reasoned away (CLAUDE.md §1), mirroring finalizeCapture's own settledAt guard. */
    if (captured.settledAt === null) {
      throw new Error(
        `finalizeRecovery: captured payment for working order ${req.id} carried no settledAt`,
      );
    }
    /* v8 ignore stop */
    const settledAt = new Date(captured.settledAt);

    // Filed under the device that took the card, as the stuck resolve and a bill payment are.
    const [startedOn] = await tx
      .select({ source: payments.source, deviceId: payments.deviceId })
      .from(payments)
      .where(eq(payments.id, captured.id));
    const origin = storedDeviceOrigin(startedOn!);
    const selected = await selectOrderInvoice(tx, deps.backend, cfg, req.id, priced.total);
    const language = await readReceiptLanguage(tx, cfg.locationId);
    const { saleId, fiscal } = await recordSale(tx, deps.backend, {
      origin,
      nodeId: cfg.nodeId,
      ...selected.sale,
      workingOrderId: brandWorkingOrderId(req.id),
      ...language,
      total: priced.total,
      lines: withReceiptListPrices(priced.lines, order.identities),
      vatBreakdown: priced.vatBreakdown,
      clock,
      operatorId,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "card", amount: capturedAmount, tipAmount: tip, settledAt }],
      },
    });
    const receiptContext = await VENUE_SERVICE.findOrderContext(tx, cfg, req.id);
    await VENUE_SERVICE.recordSaleReceiptHeader(tx, cfg, saleId, receiptContext?.zoneId ?? null);

    await associatePaymentWithSale(tx, {
      provider: deps.provider.provider,
      paymentRef: captured.paymentRef,
      saleId,
      ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
    });

    // A placed order was fired when it was placed; an open one's unsent dishes go now, for the
    // orders `fireDishesAtPayment` names, except a zoned order's dish no station can take.
    const notSent =
      locked?.status === "open" ? await fireDishesAtPayment(tx, cfg, req.id, locked.partyId) : null;

    // Settled at the ORIGINAL capture instant.
    await tx
      .update(workingOrders)
      .set({
        label: (await readReceiptOrder(tx, cfg, req.id, { atIssuance: true })).orderLabel,
        status: "settled",
        settledAt: settledAt.toISOString(),
        ...(locked?.status === "placed" ? {} : { paymentAttemptAt: null }),
      })
      .where(eq(workingOrders.id, req.id));
    await clearBillRequestIfPaid(tx, req.id, deps.log);
    if (notSent !== null) {
      await raiseDishesNotSent(
        tx,
        cfg,
        saleId,
        req.id,
        notSent,
        deps.clock.now().instant,
        deps.log,
      );
    }

    const tenderBlock = await readTenderBlock(tx, cfg, saleId, req.id);

    const ticket: TillSaleResult = {
      ...(await readReceiptIssuer(deps.backend, tx, saleId)),
      receiptHeader: (await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId)) ?? undefined,
      ...(await readReceiptOrder(tx, cfg, req.id)),
      locale: language.locale,
      invoiceNumber: await readInvoiceNumber(tx, saleId),
      issuedAt: fiscal.issuedAt.toISOString(),
      total: priced.total,
      vatBreakdown: toVatBreakdown(priced.vatBreakdown),
      ...(await receiptLines(tx, req.id, priced, order.identities, saleId)),
      tender: tenderBlock,
      ...receiptQr(deps.backend, fiscal.verificationUrl),
    };
    // A card on a connected machine: a receipt and no drawer. The replay above returns before this,
    // so nothing prints twice.
    await enqueueSaleReceipt(tx, cfg, ticket, saleId);
    return { outcome: "captured", ticket };
  });
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
  cfg: TillConfig,
  workingOrderId: string,
  // The order's party as the caller already read it in `tx`; omitted, it is read here.
  partyId?: string | null,
): Promise<DishesNotSent | null> {
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, workingOrderId);
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
  const unrouted = await fireLines(
    tx,
    cfg,
    workingOrderId,
    await unsentDishLines(tx, workingOrderId),
    { unroutable: "skip" },
  );
  await storePrepayMadeHere(tx, workingOrderId, [...(cfg.madeHereSink ?? [])]);
  return unrouted.length === 0 ? null : { productIds: unrouted.map((line) => line.productId!) };
}

/**
 * P3 of {@link payWorkingOrderIntegrated}'s branch for an order whose sale was already issued:
 * SETTLE that sale, link the captured payment and settle the order in ONE transaction. It files NO
 * second fiscal record.
 *
 * The card was charged `amountDue + tip`, and the tender records that whole charge with the tip on
 * it, outside the fiscal total.
 *
 * A concurrent collect or recovery can settle the invoice between P1 and here (the
 * three-transaction split, see {@link finalizeCapture}); `settleSale` then refuses with
 * `sale.already_settled`, and this replays the settled ticket in a fresh transaction, settling
 * nothing.
 */
async function finalizeSettle(
  deps: IntegratedPayDeps,
  cfg: OriginConfig,
  req: IntegratedPayRequest,
  outstanding: { saleId: SaleId; amountDue: Decimal },
  tip: Decimal,
  result: PaymentResult,
): Promise<TillSaleResult> {
  const settledAt = result.settledAt;
  /* v8 ignore start -- unreachable: finalizeSettle is only called on a `captured`/`accepted_offline`
     result, whose `settledAt` is always set (provider.ts:66-83). The guard mirrors finalizeCapture's
     own "impossible" throw — a defended contract, not a claim reasoned away (CLAUDE.md §1). */
  if (settledAt === null) {
    throw new Error(`finalizeSettle: a ${result.state} result carried no settledAt`);
  }
  /* v8 ignore stop */
  try {
    return await withTransaction(deps.db, async (tx) => {
      await settleSale(tx, {
        saleId: outstanding.saleId,
        tenders: [
          {
            method: "card",
            amount: addDecimal(outstanding.amountDue, tip),
            tipAmount: tip,
            settledAt,
          },
        ],
      });

      await associatePaymentWithSale(tx, {
        provider: result.provider,
        paymentRef: result.paymentRef,
        saleId: outstanding.saleId,
        ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
      });

      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: settledAt.toISOString() })
        .where(eq(workingOrders.id, req.id));
      await clearBillRequestIfPaid(tx, req.id, deps.log);

      const ticket = await readSettledTicket(deps.backend, tx, cfg, req.id);
      return ticket;
    });
  } catch (error) {
    // Anything but `sale.already_settled` is a real failure and surfaces unchanged.
    if (!(error instanceof AppError) || error.code !== "sale.already_settled") {
      throw error;
    }
    return withTransaction(deps.db, async (tx) => {
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    });
  }
}

/**
 * The counterpart of {@link finalizeRecovery} for an order whose sale was already issued: SETTLE that
 * sale for a captured payment that has no sale link, WITHOUT charging again and never with
 * `recordSale`, which would collide with it. One transaction, so a concurrent recovery replays as in
 * `finalizeRecovery`.
 *
 * The tip is reconstructed as `captured.amount − amountDue`. A charge below the amount due settles
 * NOTHING and throws a plain `Error`, leaving the captured payment unassociated for reconciliation
 * (§5).
 */
async function finalizeSettleRecovery(
  deps: IntegratedPayDeps,
  cfg: OriginConfig,
  req: IntegratedPayRequest,
  captured: CapturedPaymentForOrder,
  outstanding: { saleId: SaleId; amountDue: Decimal },
): Promise<IntegratedPayOutcome> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, req.id));

    // A concurrent winner settled the invoice and moved the order before this transaction started:
    // replay, settling and associating nothing.
    if (locked?.status === "settled") {
      return {
        outcome: "captured",
        ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
      };
    }

    const capturedAmount = decimal(captured.amount);

    if (compareDecimal(capturedAmount, outstanding.amountDue) < 0) {
      throw new Error(
        `finalizeSettleRecovery: captured ${captured.amount} is below the amount due ${outstanding.amountDue} for working order ${req.id}`,
      );
    }

    const tip = subtractDecimal(capturedAmount, outstanding.amountDue);

    /* v8 ignore start -- a captured/accepted_offline row always carries settled_at (store.ts's
       insertCapturedPayment/captureAttempting set it); the null-typed column is DEFENDED here, not
       reasoned away (CLAUDE.md §1), mirroring finalizeRecovery's own settledAt guard. */
    if (captured.settledAt === null) {
      throw new Error(
        `finalizeSettleRecovery: captured payment for working order ${req.id} carried no settledAt`,
      );
    }
    /* v8 ignore stop */
    const settledAt = new Date(captured.settledAt);

    await settleSale(tx, {
      saleId: outstanding.saleId,
      tenders: [{ method: "card", amount: capturedAmount, tipAmount: tip, settledAt }],
    });

    await associatePaymentWithSale(tx, {
      provider: deps.provider.provider,
      paymentRef: captured.paymentRef,
      saleId: outstanding.saleId,
      ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
    });

    // Settled at the ORIGINAL capture instant.
    await tx
      .update(workingOrders)
      .set({ status: "settled", settledAt: settledAt.toISOString() })
      .where(eq(workingOrders.id, req.id));
    await clearBillRequestIfPaid(tx, req.id, deps.log);

    const ticket = await readSettledTicket(deps.backend, tx, cfg, req.id);
    return { outcome: "captured", ticket };
  });
}

/**
 * Map a provider result onto an {@link IntegratedPayOutcome}. `attempting` (a stall) maps to
 * `timeout`, so a stall is not mislabelled a hard decline; any other non-captured state but
 * `network_unavailable` maps to `declined`.
 */
export function toPayOutcome(
  result: PaymentResult,
  ticket: TillSaleResult | null,
): IntegratedPayOutcome {
  if (result.state === "captured" || result.state === "accepted_offline") {
    return { outcome: "captured", ticket: ticket! };
  }
  if (result.state === "network_unavailable") {
    return { outcome: "network_unavailable" };
  }
  if (result.state === "attempting") {
    return { outcome: "timeout" };
  }
  return { outcome: "declined" };
}

/**
 * Collect and settle a PLACED order, in one transaction, by whether a sale already names it, not by
 * its zone's service mode:
 *  - a sale exists: collect SETTLES it and files NO second fiscal record. When something is owed,
 *    a `card` tender also writes the manual-card `payments` row, so reconciliation sees it. A bill
 *    whose amount due is exactly zero settles with no tender, no `payments` row and no drawer
 *    opening; one below zero is refused with `sale.tender_shortfall` and stays placed
 *    (`recordCorrection` refuses a correction that would make one: `sale.correction_exceeds_total`).
 *  - no sale: collect files one from the order's stored locked lines (`fileImmediateSale`).
 *
 * No duplicate backstop is needed: a concurrent collect's whole transaction runs after the winner
 * committed, reads the order `settled`, and replays. `sales_working_order_id_key` and
 * `sale_settlements_sale_key` still refuse a duplicate from any writer.
 *
 * `req.lines` is IGNORED. `operatorId` is the collecting operator.
 */
export async function collectOrder(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  req: PayWorkingOrderRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, req.id));

    if (locked?.status === "settled") {
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    }

    if (locked === undefined || locked.status !== "placed") {
      throw new AppError("working_order.not_placed", { workingOrderId: req.id });
    }
    await refuseBillWithPayments(tx, req.id);

    // AFTER the replay check, so a retry is never refused for its body shape.
    if (req.tender.method !== "cash" && req.tender.method !== "card") {
      throw new AppError("sale.unsupported_tender", { method: req.tender.method });
    }
    const outstanding = await readOutstandingSaleForOrder(tx, req.id);

    if (outstanding !== undefined) {
      // Before the owes-nothing return, so a malformed cash amount is refused whatever is owed.
      const { settledAmount } = settlementFor(req.tender, outstanding.amountDue);
      if (compareDecimal(outstanding.amountDue, ZERO) <= 0) {
        return settleOwingNothing(tx, deps, cfg, req.id, outstanding.saleId);
      }
      const settledAt = deps.clock.now().instant;

      await settleSale(tx, {
        saleId: outstanding.saleId,
        tenders: [
          {
            method: req.tender.method,
            amount: settledAmount,
            tipAmount: "0.00",
            cashTendered: req.tender.method === "cash" ? req.tender.amount : null,
            settledAt,
          },
        ],
      });

      if (req.tender.method === "card") {
        const { provider, paymentRef } = await recordManualCardPayment(tx, {
          origin: cfg.origin,
          workingOrderId: req.id,
          amount: outstanding.amountDue,
          settledAt,
          externalRef: req.tender.externalRef,
        });
        await associatePaymentWithSale(tx, {
          provider,
          paymentRef,
          saleId: outstanding.saleId,
        });
      }

      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: settledAt.toISOString() })
        .where(eq(workingOrders.id, req.id));
      await clearBillRequestIfPaid(tx, req.id, deps.log);

      const ticket = await readSettledTicket(deps.backend, tx, cfg, req.id);
      await enqueueSaleDrawer(tx, cfg, outstanding.saleId, req.tender.method, operatorId);
      return ticket;
    }

    const order = await priceStoredOrderForIssuance(tx, req.id);
    return fileImmediateSale(tx, deps, cfg, req.id, req.tender, order, operatorId);
  });
}

/**
 * Close an order whose issued sale's corrections leave nothing owed: no money changes hands, so no
 * tender, no `payments` row and no drawer opening (`tenders_amount_ck` refuses a tender of zero or
 * less). Below zero, `settleSale` refuses the empty tender list with `sale.tender_shortfall` and
 * the order is left as it was.
 */
async function settleOwingNothing(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: OriginConfig,
  workingOrderId: string,
  saleId: SaleId,
): Promise<TillSaleResult> {
  await settleIssuedOwingNothing(tx, deps, workingOrderId, saleId);
  return readSettledTicket(deps.backend, tx, cfg, workingOrderId);
}

/** {@link settleOwingNothing} without the ticket: an unpaid departure settles its bills owing nothing. */
export async function settleIssuedOwingNothing(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "clock" | "log">,
  workingOrderId: string,
  saleId: SaleId,
): Promise<void> {
  const settledAt = deps.clock.now().instant.toISOString();
  await settleSale(tx, { saleId, tenders: [] });
  await tx
    .update(workingOrders)
    .set({ status: "settled", settledAt })
    .where(eq(workingOrders.id, workingOrderId));
  await clearBillRequestIfPaid(tx, workingOrderId, deps.log);
}

/**
 * Ring one sale through `payWorkingOrder`, under `req.workingOrderId` or a freshly minted id. A till
 * that re-sends the same id after a lost response REPLAYS rather than filing a second record; sending
 * a parked order's id pays that order.
 */
export async function recordTillSale(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  req: TillSaleRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  // There is deliberately NO empty-basket guard here: a retrieved order is paid with `lines: []`,
  // and only `payWorkingOrder` knows whether the id names an existing order.
  if (req.tender.method !== "cash" && req.tender.method !== "card") {
    throw new AppError("sale.unsupported_tender", { method: req.tender.method });
  }

  return payWorkingOrder(
    deps,
    cfg,
    {
      id: req.workingOrderId ?? randomUUID(),
      lines: req.lines,
      tender: req.tender,
      invoiceType: req.invoiceType,
      recipient: req.recipient,
      deliveryTableId: req.deliveryTableId,
      zoneId: req.zoneId,
    },
    operatorId,
  );
}

export async function reprintSale(
  deps: { db: Database; backend: FiscalBackend },
  cfg: OriginConfig,
  workingOrderId: string,
  language?: string,
): Promise<void> {
  await printSaleReceipt(deps, cfg, workingOrderId, true, language);
}
