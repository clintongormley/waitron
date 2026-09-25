import type { ExtraSelection, OptionSelection, OptionSnapshot } from "@waitron/shared";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { randomUUID } from "node:crypto";
// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import {
  addDecimal,
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  rawCentsToDecimal,
  saleId as brandSaleId,
  subtractDecimal,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import {
  invoiceSeries,
  isUniqueViolation,
  sales,
  tenders,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { Decimal, SaleId } from "@waitron/shared";
import type { PricedLines } from "@waitron/catalogue";
import {
  payments,
  associatePaymentWithSale,
  findCapturedPaymentForWorkingOrder,
  recordManualCardPayment,
} from "@waitron/payments";
import type { CapturedPaymentForOrder, PaymentProvider, PaymentResult } from "@waitron/payments";
import { formatInvoiceNumber, recordSale, settleSale } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  createOpenOrder,
  fireLines,
  priceStoredOrder,
  priceStoredOrderForIssuance,
  readInvoiceNumber,
  toVatBreakdown,
} from "./working-order.js";
import type { LineExtras, PricedOrder, TillSaleDeps } from "./working-order.js";
import { issuancePass } from "./issuance-pass.js";
import { VENUE_SERVICE } from "./modules.js";
import { readReceiptOrder } from "./receipt-order.js";
import { ticketLinesFrom } from "./receipt-lines.js";
import type { TillConfig } from "./till-config.js";
import {
  enqueueCashSaleDrawer,
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
 * from the zone's menu offers (`priceBasket`), so a browser cannot influence the filed total.
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
  /** locale → text: the line's goods descriptions, snapshotted at add-time and filed verbatim. */
  descriptions: Record<string, string>;
  /** Unit label frozen with the filed line; null for a modifier child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** The filed quantity, trailing-zero-trimmed for display ("2.000" reads "2"). */
  quantity: string;
  /** The GROSS (VAT-inclusive) line total the line was filed at, as a decimal string. */
  gross: string;
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line, else `null`/absent.
   *  Presentation only: it groups already-filed lines and is no fiscal figure. */
  parentLineNo?: number | null;
  /** The diner's answers to this dish's OPTIONS lists, copied by value so a later catalogue edit
   *  cannot rewrite what a completed sale says was ordered. An extras pick is a child line instead. */
  optionSnapshots?: OptionSnapshot[];
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

export interface TillSaleResult {
  issuer?: { venueName: string; nif: string };
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
  /** How the sale was paid, read back from the committed tender and payment rows. */
  tender: TenderBlock;
  /** Where a customer can verify the record, or "" when the regime offers none. */
  qr: string;
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
    .where(eq(tenders.saleId, saleId));
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

/**
 * A pay-and-settle over a PERSISTED working order, keyed by its client-minted id. `id` is the
 * idempotency key: `sales_working_order_id_key` makes at most one sale per working order.
 *
 * How `lines` is used depends on the shape:
 *  - WALK-UP (no `working_orders` row for `id`): `lines` is the unpriced basket; the server prices it
 *    (`priceBasket`), creates the order OPEN with those lines, and files that price.
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
  /** Deliver a WALK-UP sale to a dining table; ignored for a retrieved order. An unknown id is
   *  refused `table.not_found`. */
  deliveryTableId?: string;
  /** The selected service zone for a new counter order. Existing orders use their stored context. */
  zoneId?: string;
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
 *  6. A unique violation is replayed in a FRESH transaction, filing nothing. Step 1 already
 *     serialises pays in this process; the backstop stays because `sales_working_order_id_key`
 *     refuses a second sale for one working order whatever wrote it.
 *
 * `operatorId` is the person who rang the sale, for attribution.
 */
export async function payWorkingOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  req: PayWorkingOrderRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  try {
    return await withTransaction(deps.db, async (tx) => {
      // Step 1; the doc comment says what serialises a concurrent pay against this read.
      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id));

      if (locked?.status === "settled") {
        return readSettledTicket(deps.backend, tx, cfg, req.id);
      }

      // The domain code, rather than the raw `working_orders_enforce_transition` trigger error the
      // settle UPDATE would otherwise raise.
      if (locked !== undefined && locked.status !== "open") {
        throw new AppError("working_order.not_open", { workingOrderId: req.id });
      }

      // The till is a network boundary. AFTER the replay check, so a retry of an already-settled
      // order is never refused for the shape of its retry body.
      if (req.tender.method !== "cash" && req.tender.method !== "card") {
        throw new AppError("sale.unsupported_tender", { method: req.tender.method });
      }

      // A walk-up reuses the price `createOpenOrder` derived to build its line rows; a retrieved
      // order ignores `req.lines` and files its stored locked lines.
      let order: PricedOrder;
      let newlyCreatedLines: Awaited<ReturnType<typeof createOpenOrder>>["lineRows"] = [];
      if (locked === undefined) {
        // Walk-up only, because a retrieved order ignores `req.lines`.
        if (req.lines.length === 0) {
          throw new AppError("sale.empty_basket", {});
        }
        const created = await createOpenOrder(tx, cfg, req.id, req.lines, null, {
          deliveryTableId: req.deliveryTableId,
          zoneId: req.zoneId,
        });
        order = created;
        newlyCreatedLines = created.lineRows;
      } else {
        order = await priceStoredOrderForIssuance(tx, req.id);
      }

      const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, req.id);
      if (locked === undefined && (serviceContext?.serviceMode ?? cfg.orderFlow) === "prepay") {
        await fireLines(
          tx,
          cfg,
          req.id,
          newlyCreatedLines.map((line) => ({
            id: line.id!,
            productId: line.productId ?? null,
            courseId: line.courseId ?? null,
            parentLineId: line.parentLineId ?? null,
            note: line.note ?? null,
          })),
        );
      }

      return fileImmediateSale(tx, deps, cfg, req.id, req.tender, order, operatorId);
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

/** Reconstruct the filed invoice and persisted payment facts for original, duplicate or pay replay. */
async function readSettledTicket(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
): Promise<TillSaleResult> {
  // `sales_working_order_id_key` allows at most one.
  const [issued] = await tx
    .select({
      saleId: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      total: sales.total,
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

  // Rebuilt from the stored lock rather than `sale_lines`, which stores the NET base, so recovering
  // the gross could drift by a cent.
  const ticketLines = ticketLinesFrom(await priceStoredOrder(tx, workingOrderId));

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

  return {
    ...(await readReceiptOrder(tx, cfg, workingOrderId)),
    invoiceNumber: formatInvoiceNumber(issued.code, issued.number),
    // So a replay's `issuedAt` reads identically to the original's `fiscal.issuedAt.toISOString()`.
    issuedAt: new Date(issued.issuedAt).toISOString(),
    total: centsToDecimal(issued.total),
    vatBreakdown: toVatBreakdown(filed.vatBreakdown),
    lines: ticketLines,
    tender,
    qr: filed.verificationUrl,
    ...(filed.issuer
      ? { issuer: { venueName: filed.issuer.legalName, nif: filed.issuer.taxId } }
      : {}),
  };
}

/** The action determines original versus duplicate; both only enqueue paper for an existing sale. */
export async function printSaleReceipt(
  deps: { db: Database; backend: FiscalBackend },
  cfg: TillConfig,
  workingOrderId: string,
  duplicate: boolean,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    // No filed sale → nothing to print. This keeps `readSettledTicket`'s "no sale" throw unreachable.
    const [existing] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    if (existing === undefined) return;
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    if (duplicate) await enqueueReceiptReprint(tx, cfg, ticket);
    else await enqueueOriginalReceipt(tx, cfg, ticket);
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
 * File an IMMEDIATE cash/card sale from an already-priced basket and settle it on the caller's `tx`,
 * so the sale, its tender/settlement, its chained fiscal record and the → `settled` transition commit
 * as one unit. It does NOT read or guard the order status: the caller resolved it, and one write
 * transaction runs on the venue file at a time, so nothing has moved the row in between.
 *
 * `markCollected` stamps the order-level `collected_at` handover marker in the same settle UPDATE, so
 * a counter collect leaves its station queue. NON-FISCAL.
 */
async function fileImmediateSale(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
  workingOrderId: string,
  tender: TillTender,
  order: PricedOrder,
  operatorId?: string,
  markCollected = false,
): Promise<TillSaleResult> {
  const priced = await issuancePass(tx, cfg, workingOrderId, order);
  const isCard = tender.method === "card";
  const { settledAmount } = settlementFor(tender, priced.total);

  // One reading, shared by the tender and the order's `settled_at`.
  const settledAt = deps.clock.now().instant;

  const { saleId, fiscal } = await recordSale(tx, deps.backend, {
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    seriesId: cfg.seriesId,
    // The sale-idempotency key (`sales_working_order_id_key`).
    workingOrderId: brandWorkingOrderId(workingOrderId),
    locale: cfg.locale,
    invoiceLocales: cfg.invoiceLocales,
    total: priced.total,
    lines: priced.lines,
    vatBreakdown: priced.vatBreakdown,
    clock: deps.clock,
    operatorId,
    settlement: {
      kind: "immediate",
      tenders: [
        {
          method: tender.method,
          amount: settledAmount,
          tipAmount: "0.00",
          cashTendered: tender.method === "cash" ? tender.amount : null,
          settledAt,
        },
      ],
    },
  });

  // A manual card also gets a captured `payments` row, linked to the sale in this transaction.
  // `recordManualCardPayment` makes no network call, so it commits inline with the sale.
  if (isCard) {
    const { provider, paymentRef } = await recordManualCardPayment(tx, {
      workingOrderId,
      amount: decimal(priced.total),
      settledAt,
      externalRef: tender.externalRef,
    });
    await associatePaymentWithSale(tx, { provider, paymentRef, saleId });
  }

  await tx
    .update(workingOrders)
    .set({
      label: (await readReceiptOrder(tx, cfg, workingOrderId, { atIssuance: true })).orderLabel,
      status: "settled",
      settledAt: settledAt.toISOString(),
      ...(markCollected ? { collectedAt: settledAt.toISOString() } : {}),
    })
    .where(eq(workingOrders.id, workingOrderId));

  // After both writes above, so a manual acquirer reference is visible.
  const tenderBlock = await readTenderBlock(tx, cfg, saleId, workingOrderId);

  // `FiscalRecordRef` is regime-opaque, so the "A/1" is read back from the sale row and its series.
  const ticket: TillSaleResult = {
    ...(await readReceiptIssuer(deps.backend, tx, saleId)),
    ...(await readReceiptOrder(tx, cfg, workingOrderId)),
    invoiceNumber: await readInvoiceNumber(tx, saleId),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    lines: ticketLinesFrom(priced),
    tender: tenderBlock,
    qr: fiscal.verificationUrl ?? "",
  };

  await enqueueSaleReceipt(tx, cfg, ticket);
  if (tender.method === "cash") await enqueueCashSaleDrawer(tx, cfg, saleId, operatorId);
  return ticket;
}

/**
 * The already-issued, unsettled sale for a working order, if any. Under `invoice_first` the invoice
 * is filed at placing, so a `placed` order already carries one; every other flow files at pay. The
 * presence of the row, not `cfg.orderFlow`, is the discriminator.
 *
 * `amountDue` is `total + corrections`, the same `due` `settleSale` re-derives, so a card charged
 * `amountDue + tip` settles the sale exactly. `${sales}.id` (not `${sales.id}`) renders the column
 * table-qualified so the `sales c` subquery cannot capture a bare `"id"`.
 */
async function readOutstandingSaleForOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ saleId: SaleId; amountDue: Decimal } | undefined> {
  const [row] = await tx
    .select({
      id: sales.id,
      total: sales.total,
      // Cast to text for `rawCentsToDecimal`, which refuses a number.
      corrections: sql<string>`cast(coalesce((select sum(c.total) from sales c where c.corrects_sale_id = ${sales}.id), 0) as text)`,
    })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  if (row === undefined) {
    return undefined;
  }
  return {
    saleId: brandSaleId(row.id),
    amountDue: addDecimal(centsToDecimal(row.total), rawCentsToDecimal(row.corrections)),
  };
}

/**
 * Pay and settle a working order over an INTEGRATED card terminal. The network `collect` runs OUTSIDE
 * any database transaction, because an open write transaction holds the whole venue file against
 * every other writer, so this is three phases:
 *
 *  - P1 (tx A). Resolve the order and decide what to do. A WALK-UP is created `open` and COMMITTED
 *    here, because the provider's payment row carries a foreign key to `working_orders`
 *    (`payments_working_order_fk`).
 *  - P2 (no tx). Drive the reader for the amount plus tip. A non-captured result files NOTHING and is
 *    returned as data (CLAUDE.md §5).
 *  - P3 (tx B). File or settle the sale, associate the captured payment and settle the order,
 *    atomically.
 *
 * P1's serialisation ends at its own commit, so two pays for one id can both pass P1 with the order
 * unsettled and both reach P3 — which is why `finalizeCapture` and `finalizeSettle` each keep a
 * duplicate backstop, while `finalizeRecovery`, `finalizeSettleRecovery` and `collectOrder` (one
 * transaction end to end) need none.
 *
 * P1's result:
 *  - `replay` — already `settled`; return the stored ticket, file nothing.
 *  - `recover` / `recover-settle` — a captured payment with no sale (P2 committed, P3 never ran).
 *    Finish it WITHOUT charging again: file a sale, or settle the already-issued invoice when there is
 *    one, since a second `recordSale` would collide with it.
 *  - `settle` — invoice-first: collect the amount due and SETTLE the issued invoice.
 *  - `collect` — walk-up or issue-at-pay: collect the priced total and file the sale.
 */
export async function payWorkingOrderIntegrated(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  operatorId?: string,
): Promise<IntegratedPayOutcome> {
  // ---- P1 (tx A) ----
  const prepared = await withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
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

    // Walk-up only, because a retrieved or placed order ignores `req.lines`.
    if (req.lines.length === 0 && locked === undefined) {
      throw new AppError("sale.empty_basket", {});
    }

    // A walk-up has no prior sale, and no payment row either: that row's foreign key needs the
    // order row, which P1 is about to create.
    if (locked !== undefined) {
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
        return { kind: "settle" as const, outstanding };
      }
    }

    const order: PricedOrder =
      locked === undefined
        ? await createOpenOrder(tx, cfg, req.id, req.lines, null, { zoneId: req.zoneId })
        : await priceStoredOrderForIssuance(tx, req.id);
    // The record is issued from THIS pricing, in P3, whatever changes while the reader runs.
    const priced = await issuancePass(tx, cfg, req.id, order);
    // A `placed` order here is a counter collect, so `finalizeCapture` stamps `collected_at`.
    return { kind: "collect" as const, priced, wasPlaced: locked?.status === "placed" };
  });

  if (prepared.kind === "replay") {
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
  // The default sits outside the ternary so a tips-off call exercises it too.
  const tipInput = req.tip ?? "0.00";
  const tip = cfg.tipsEnabled ? decimal(tipInput) : decimal("0.00");
  const baseAmount =
    prepared.kind === "settle" ? prepared.outstanding.amountDue : prepared.priced.total;
  const result = await deps.provider.collect({
    tillId: cfg.tillId,
    workingOrderId: brandWorkingOrderId(req.id),
    amount: addDecimal(baseAmount, tip),
    ...(deps.readerRef === undefined ? {} : { readerRef: deps.readerRef }),
    allowOffline: req.allowOffline,
    simulationOutcome: req.simulationOutcome,
  });
  if (result.state !== "captured" && result.state !== "accepted_offline") {
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
    prepared.priced,
    tip,
    result,
    operatorId,
    prepared.wasPlaced,
  );
  return { outcome: "captured", ticket };
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
  cfg: TillConfig,
  req: IntegratedPayRequest,
  priced: PricedLines,
  tip: Decimal,
  result: PaymentResult,
  operatorId?: string,
  // True when the order was `placed` at P1: a counter collect.
  markCollected = false,
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
      const { saleId, fiscal } = await recordSale(tx, deps.backend, {
        tillId: cfg.tillId,
        nodeId: cfg.nodeId,
        seriesId: cfg.seriesId,
        // The sale-idempotency key (`sales_working_order_id_key`) the backstop below relies on.
        workingOrderId: brandWorkingOrderId(req.id),
        locale: cfg.locale,
        invoiceLocales: cfg.invoiceLocales,
        total: priced.total,
        lines: priced.lines,
        vatBreakdown: priced.vatBreakdown,
        clock: deps.clock,
        operatorId,
        settlement: {
          kind: "immediate",
          tenders: [
            { method: "card", amount: addDecimal(priced.total, tip), tipAmount: tip, settledAt },
          ],
        },
      });

      // The provider already recorded the payment row; this only points its `sale_id` at the sale.
      await associatePaymentWithSale(tx, {
        provider: result.provider,
        paymentRef: result.paymentRef,
        saleId,
        ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
      });

      // After `recordSale`, so a concurrent loser, refused there, never reaches the fire. A placed
      // order was fired when it was placed and must not be fired again.
      if (!markCollected) {
        await firePrepayOrder(tx, cfg, req.id);
      }

      await tx
        .update(workingOrders)
        .set({
          label: (await readReceiptOrder(tx, cfg, req.id, { atIssuance: true })).orderLabel,
          status: "settled",
          settledAt: settledAt.toISOString(),
          ...(markCollected ? { collectedAt: settledAt.toISOString() } : {}),
        })
        .where(eq(workingOrders.id, req.id));

      const tenderBlock = await readTenderBlock(tx, cfg, saleId, req.id);

      const ticket: TillSaleResult = {
        ...(await readReceiptIssuer(deps.backend, tx, saleId)),
        ...(await readReceiptOrder(tx, cfg, req.id)),
        invoiceNumber: await readInvoiceNumber(tx, saleId),
        issuedAt: fiscal.issuedAt.toISOString(),
        total: priced.total,
        vatBreakdown: toVatBreakdown(priced.vatBreakdown),
        lines: ticketLinesFrom(priced),
        tender: tenderBlock,
        qr: fiscal.verificationUrl ?? "",
      };
      // Card: a receipt and no drawer. A throw here would roll back a sale whose card P2 already
      // charged.
      await enqueueSaleReceipt(tx, cfg, ticket);
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
 * reconciliation (§5). The issuance pass refusing with `sale_classification.invalid` likewise files
 * nothing and leaves the payment unassociated.
 */
async function finalizeRecovery(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  captured: CapturedPaymentForOrder,
  operatorId?: string,
): Promise<IntegratedPayOutcome> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
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

    const priced = await issuancePass(
      tx,
      cfg,
      req.id,
      await priceStoredOrderForIssuance(tx, req.id),
    );
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

    const { saleId, fiscal } = await recordSale(tx, deps.backend, {
      tillId: cfg.tillId,
      nodeId: cfg.nodeId,
      seriesId: cfg.seriesId,
      workingOrderId: brandWorkingOrderId(req.id),
      locale: cfg.locale,
      invoiceLocales: cfg.invoiceLocales,
      total: priced.total,
      lines: priced.lines,
      vatBreakdown: priced.vatBreakdown,
      clock: deps.clock,
      operatorId,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "card", amount: capturedAmount, tipAmount: tip, settledAt }],
      },
    });

    await associatePaymentWithSale(tx, {
      provider: deps.provider.provider,
      paymentRef: captured.paymentRef,
      saleId,
      ...(deps.readerId === undefined ? {} : { readerId: deps.readerId }),
    });

    // A placed order was fired when it was placed; an open one has not entered preparation yet.
    if (locked?.status === "open") {
      await firePrepayOrder(tx, cfg, req.id);
    }

    // Settled at the ORIGINAL capture instant. A recovered `placed` order was a counter collect, so
    // it is stamped collected too.
    await tx
      .update(workingOrders)
      .set({
        label: (await readReceiptOrder(tx, cfg, req.id, { atIssuance: true })).orderLabel,
        status: "settled",
        settledAt: settledAt.toISOString(),
        ...(locked?.status === "placed" ? { collectedAt: settledAt.toISOString() } : {}),
      })
      .where(eq(workingOrders.id, req.id));

    const tenderBlock = await readTenderBlock(tx, cfg, saleId, req.id);

    const ticket: TillSaleResult = {
      ...(await readReceiptIssuer(deps.backend, tx, saleId)),
      ...(await readReceiptOrder(tx, cfg, req.id)),
      invoiceNumber: await readInvoiceNumber(tx, saleId),
      issuedAt: fiscal.issuedAt.toISOString(),
      total: priced.total,
      vatBreakdown: toVatBreakdown(priced.vatBreakdown),
      lines: ticketLinesFrom(priced),
      tender: tenderBlock,
      qr: fiscal.verificationUrl ?? "",
    };
    // Card: a receipt and no drawer. The replay above returns before this, so nothing prints twice.
    await enqueueSaleReceipt(tx, cfg, ticket);
    return { outcome: "captured", ticket };
  });
}

/** Fire an open order at payment when its frozen service context uses the prepay flow. */
async function firePrepayOrder(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
): Promise<void> {
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, workingOrderId);
  if ((serviceContext?.serviceMode ?? cfg.orderFlow) !== "prepay") {
    return;
  }

  const lines = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);

  await fireLines(tx, cfg, workingOrderId, lines);
}

/**
 * P3 of {@link payWorkingOrderIntegrated}'s invoice-first branch: SETTLE the invoice issued at
 * placing, link the captured payment and settle the order in ONE transaction. It files NO second
 * fiscal record.
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
  cfg: TillConfig,
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

      // An invoice-first settle is always a counter collect of a placed order.
      await tx
        .update(workingOrders)
        .set({
          status: "settled",
          settledAt: settledAt.toISOString(),
          collectedAt: settledAt.toISOString(),
        })
        .where(eq(workingOrders.id, req.id));

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
 * The invoice-first counterpart of {@link finalizeRecovery}: SETTLE the already-issued invoice for a
 * captured payment that has no sale, WITHOUT charging again and never with `recordSale`, which would
 * collide with the issued invoice. One transaction, so a concurrent recovery replays as in
 * `finalizeRecovery`.
 *
 * The tip is reconstructed as `captured.amount − amountDue`. A charge below the amount due settles
 * NOTHING and throws a plain `Error`, leaving the captured payment unassociated for reconciliation
 * (§5).
 */
async function finalizeSettleRecovery(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
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

    // Settled at the ORIGINAL capture instant; an invoice-first recovery is always a counter collect.
    await tx
      .update(workingOrders)
      .set({
        status: "settled",
        settledAt: settledAt.toISOString(),
        collectedAt: settledAt.toISOString(),
      })
      .where(eq(workingOrders.id, req.id));

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
 * Collect and settle a PLACED order, in one transaction, by its service mode:
 *  - `invoice_first`: the invoice was issued at placing, so collect SETTLES it and files NO second
 *    fiscal record. A `card` tender also writes the manual-card `payments` row, so reconciliation
 *    sees it.
 *  - `ticket_then_pay`: no fiscal document exists yet, so collect files the sale from the order's
 *    stored locked lines (`fileImmediateSale`).
 *
 * No duplicate backstop is needed: a concurrent collect's whole transaction runs after the winner
 * committed, reads the order `settled`, and replays. `sales_working_order_id_key` and
 * `sale_settlements_sale_key` still refuse a duplicate from any writer.
 *
 * `req.lines` is IGNORED. `operatorId` is the collecting operator.
 */
export async function collectOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
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

    // AFTER the replay check, so a retry is never refused for its body shape.
    if (req.tender.method !== "cash" && req.tender.method !== "card") {
      throw new AppError("sale.unsupported_tender", { method: req.tender.method });
    }
    const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, req.id);
    const orderFlow = serviceContext?.serviceMode ?? cfg.orderFlow;

    if (orderFlow === "invoice_first") {
      const [sale] = await tx
        .select({ id: sales.id, total: sales.total })
        .from(sales)
        .where(eq(sales.workingOrderId, req.id));
      /* v8 ignore start */
      if (sale === undefined) {
        // `placeOrder` files the invoice-first sale in the transaction that places the order, so this
        // is corruption.
        throw new Error(`collectOrder: placed invoice-first order ${req.id} has no sale`);
      }
      /* v8 ignore stop */

      const { settledAmount } = settlementFor(req.tender, centsToDecimal(sale.total));
      const settledAt = deps.clock.now().instant;

      await settleSale(tx, {
        saleId: brandSaleId(sale.id),
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
          workingOrderId: req.id,
          amount: centsToDecimal(sale.total),
          settledAt,
          externalRef: req.tender.externalRef,
        });
        await associatePaymentWithSale(tx, {
          provider,
          paymentRef,
          saleId: brandSaleId(sale.id),
        });
      }

      await tx
        .update(workingOrders)
        .set({
          status: "settled",
          settledAt: settledAt.toISOString(),
          collectedAt: settledAt.toISOString(),
        })
        .where(eq(workingOrders.id, req.id));

      const ticket = await readSettledTicket(deps.backend, tx, cfg, req.id);
      if (req.tender.method === "cash") await enqueueCashSaleDrawer(tx, cfg, sale.id, operatorId);
      return ticket;
    }

    const order = await priceStoredOrderForIssuance(tx, req.id);
    return fileImmediateSale(tx, deps, cfg, req.id, req.tender, order, operatorId, true);
  });
}

/**
 * Ring one sale through `payWorkingOrder`, under `req.workingOrderId` or a freshly minted id. A till
 * that re-sends the same id after a lost response REPLAYS rather than filing a second record; sending
 * a parked order's id pays that order.
 */
export async function recordTillSale(
  deps: TillSaleDeps,
  cfg: TillConfig,
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
      deliveryTableId: req.deliveryTableId,
      zoneId: req.zoneId,
    },
    operatorId,
  );
}

export async function reprintSale(
  deps: { db: Database; backend: FiscalBackend },
  cfg: TillConfig,
  workingOrderId: string,
): Promise<void> {
  await printSaleReceipt(deps, cfg, workingOrderId, true);
}
