// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import { randomUUID } from "node:crypto";
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import {
  addDecimal,
  AppError,
  compareDecimal,
  decimal,
  saleId as brandSaleId,
  subtractDecimal,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import {
  asAppUser,
  invoiceSeries,
  isUniqueViolation,
  sales,
  withTenant,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { Decimal, SaleId, TenantId } from "@waitron/shared";
import type { PricedLines } from "@waitron/catalogue";
import {
  associatePaymentWithSale,
  findCapturedPaymentForWorkingOrder,
  recordManualCardPayment,
} from "@waitron/payments";
import type { CapturedPaymentForOrder, PaymentProvider, PaymentResult } from "@waitron/payments";
import { formatInvoiceNumber, recordSale, settleSale } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  createOpenOrder,
  priceStoredOrder,
  readInvoiceNumber,
  toVatBreakdown,
} from "./working-order.js";
import type { TillSaleDeps } from "./working-order.js";
import type { TillConfig } from "./till-config.js";

/**
 * A `cash` or manual `card` tender, shared by `TillSaleRequest` and `PayWorkingOrderRequest` (which
 * both carried the identical inline shape until this was extracted). `externalRef` is the optional
 * hand-keyed acquirer / terminal operation number, meaningful only for `card` — see each of those
 * interfaces' own doc comment for the per-method rules (which field is authoritative, what a mismatch
 * means).
 */
export interface TillTender {
  method: "cash" | "card";
  amount: string;
  externalRef?: string;
}

/**
 * A walk-up sale as the counter till captures it: a basket of `{ productId, quantity }` and one
 * tender (cash or card). Deliberately carries NO price of any kind — the server re-reads the
 * catalogue and prices authoritatively (`priceBasket`), so a browser cannot influence the filed
 * total. `quantity` is a count for an `each` product and a measured kg weight (e.g. "0.320") for a
 * `weight` product.
 *
 * `workingOrderId` is the pay-idempotency key (park & retrieve, sub-project 7b). The till mints it and
 * holds it stable across a lost-response retry, so a re-sent pay REPLAYS against the same
 * `working_orders`/`sales` row rather than filing a second chained record. It is optional: absent (a
 * till that has not adopted it), `recordTillSale` mints a fresh one per call, which still keys the
 * same guard — a call that never retries simply never collides. To PAY a parked order, the till sends
 * that order's own id here, so the settle lands on the retrieved order rather than a fresh walk-up one.
 */
export interface TillSaleRequest {
  lines: { productId: string; quantity: string }[];
  /**
   * How the customer paid. `cash` (7a) and `card` (this slice) are the two supported methods:
   *  - `cash` — `amount` is the money tendered; the sale settles at the total and `change` is the
   *    drawer cash handed back (`amount − total`).
   *  - `card` — a MANUAL / unintegrated card tender (the "datáfono"): the operator charged the card
   *    on a SEPARATE bank terminal, so `amount` is ignored — the card charges the EXACT total, there
   *    is no change, and a captured `payments` row is filed beside the tender. `externalRef` is the
   *    optional hand-keyed acquirer / terminal operation number, a human reconciliation hook.
   * Any other `tender_method` (`voucher`/`transfer`/`other`) is refused with `sale.unsupported_tender`.
   */
  tender: TillTender;
  workingOrderId?: string;
  /**
   * Deliver this counter sale to a dining table (design §3c) — written to
   * `working_orders.delivery_table_id`. Optional: a plain walk-up omits it. A counter delivery is a
   * normal immediate sale that simply records WHERE to carry it; it is NOT a tab (a tab is the reverse
   * link, `dining_tables.tab_id`). Only the WALK-UP create path writes it — a retrieved order ignores it
   * (you do not "deliver" a parked order). An id that names no table is refused `table.not_found`.
   */
  deliveryTableId?: string;
}

/**
 * One line of the FILED composition, for the receipt's goods-identification list (RD 1619/2012
 * art. 7.1.e). It comes from the priced/locked lines the server FILED — never a client basket — so the
 * printed line list can never diverge from the invoice (the whole point of Finding 2's fix). For an
 * UNEDITED retrieved/placed order a catalogue price change between park/place and pay moves neither
 * this nor the filed total: both derive from the ADD-TIME lock (`priceLockedLines`), or, for a walk-up,
 * the single price the sale was filed at. (Editing a retrieved order before pay explicitly re-locks it
 * at edit time via `updateWorkingOrder` — the till only re-syncs when the basket actually changed — so
 * an edit is the operator's own change, not silent price drift.)
 */
export interface TillSaleLine {
  /** locale → text: the line's goods descriptions, snapshotted at add-time and filed verbatim. The
   *  receipt resolves the invoice locale from this map (art. 7.1.e). */
  descriptions: Record<string, string>;
  /** The filed quantity, trailing-zero-trimmed for display so a walk-up ("2") and a retrieved order
   *  (stored "2.000") read alike ("2"); a weighed "0.320" reads "0.32". */
  quantity: string;
  /** The GROSS (VAT-inclusive) line total the line was filed at, as a decimal string. Σ over the
   *  lines equals `total` exactly (both sum the same per-line gross), so the receipt's line list adds
   *  up to the printed total. */
  gross: string;
}

export interface TillSaleResult {
  /** `NumSerieFactura`-shaped "A/1", read back from the sale row + its series after filing. */
  invoiceNumber: string;
  /** The fiscal record's issuance instant, ISO-8601. */
  issuedAt: string;
  /** Taxable base + VAT, the authoritative figure the fiscal record carries. */
  total: string;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  /** The FILED line list (goods identification, art. 7.1.e) — the priced/locked composition, so the
   *  receipt prints what was invoiced rather than the mutable client basket (Finding 2). */
  lines: TillSaleLine[];
  /** Cash to hand back. `cash`: `tendered − total`, ≥ 0 (an under-tender is refused before this is
   * read). `card`: always "0.00" — a card is charged the exact total, so there is nothing to hand
   * back. */
  change: string;
  /** Where a customer can verify the record, or "" when the regime offers none. */
  qr: string;
}

/**
 * Trim a filed quantity to a display string: drop trailing zeros (and a bare trailing dot) so a
 * walk-up's "2" and a retrieved order's stored "2.000" both read "2", and a weighed "0.320" reads
 * "0.32". Same normalisation the till's `displayQuantity` applies on retrieve, done here for EVERY
 * path so the receipt's line list is uniform regardless of which path filed it. Display only — the
 * fiscal figures (`total`, `vatBreakdown`) are untouched.
 */
function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/**
 * Project the FILED priced lines onto the receipt's line list (`TillSaleResult.lines`) — the goods
 * identification (art. 7.1.e). `priced` is exactly what was filed (a walk-up/collect `priceBasket`, or
 * a stored-lock `priceLockedLines`), so the receipt prints the invoiced composition, never the mutable
 * client basket (Finding 2). `grossLineTotals[i]` is parallel to `lines[i]` (see `PricedLines`), so the
 * per-line gross is the exact figure filed, not a recompute that could drift by a cent.
 */
function ticketLinesFrom(priced: PricedLines): TillSaleLine[] {
  return priced.lines.map((line, i) => ({
    descriptions: line.descriptions,
    quantity: trimQuantityForDisplay(line.quantity),
    gross: priced.grossLineTotals[i]!,
  }));
}

/**
 * A pay-and-settle over a PERSISTED working order, keyed by its client-minted id — the idempotent
 * pay path shared by a walk-up (`recordTillSale`, which mints a fresh id) and a parked order (the
 * retrieve-and-pay route, Task 8). `id` is the idempotency key: the till holds it stable across a
 * lost-response retry, and `sales_working_order_id_key` makes at most one sale per working order.
 *
 * `lines` is the basket to price and file, and how it is used depends ENTIRELY on the shape (line-add
 * snapshot, 7c):
 *  - WALK-UP (no `working_orders` row exists for `id`): `lines` is the basket the till captured. Like
 *    `TillSaleRequest` it carries NO price — the server re-reads the catalogue, prices authoritatively
 *    (`priceBasket`), creates the order OPEN with those priced lines, and files from that fresh price.
 *  - RETRIEVED order (the row already exists, parked earlier): `lines` is IGNORED. A retrieved order is
 *    filed from its own STORED `working_order_lines`, whose gross unit was LOCKED at add-time, via
 *    `priceLockedLines` — so a catalogue price change between park and pay never moves the filed total.
 *    The till sends no basket for this shape (the persisted lines are the authoritative composition).
 */
export interface PayWorkingOrderRequest {
  id: string;
  /** The walk-up basket to price and file; IGNORED for a retrieved order, which files its stored
   *  locked lines (see this interface's doc comment). */
  lines: { productId: string; quantity: string }[];
  /** The tender, same shape and rules as `TillSaleRequest.tender` (see there): `cash` or a manual
   *  `card`, with `externalRef` the optional acquirer / terminal operation number for a card. */
  tender: TillTender;
  /** Deliver a WALK-UP sale to a dining table (design §3c) — passed to `createOpenOrder` as the order's
   *  `delivery_table_id`. Ignored for a retrieved order (a delivery is always a fresh walk-up). An id
   *  that names no table is refused `table.not_found`. */
  deliveryTableId?: string;
}

/**
 * A pay over an INTEGRATED card terminal (Stripe reader), keyed like {@link PayWorkingOrderRequest} by
 * the working-order id. It carries NO tender — the tender IS the card, driven by the provider, so this
 * request only names the basket to file and the (optional) tip. Same basket semantics as the pay path:
 *  - WALK-UP (no `working_orders` row for `id`): `lines` is the basket to price and file.
 *  - RETRIEVED / PLACED order (the row exists): `lines` is IGNORED — the order files its own STORED
 *    locked lines (`priceStoredOrder`), so a catalogue price change between add and pay never moves the
 *    filed total (line-add snapshot, 7c).
 */
export interface IntegratedPayRequest {
  id: string;
  /** The walk-up basket to price and file; IGNORED for a retrieved/placed order (files its stored lock). */
  lines: { productId: string; quantity: string }[];
  /** The till-entered gross tip. CLAMPED to "0.00" when the till has tips disabled
   *  (`TillConfig.tipsEnabled === false`), so a client cannot add a tip the venue does not take. */
  tip?: string;
  /** Per-transaction staff consent to accept the card offline if the network is down — meaningful only
   *  for a device-local offline queue (`StripeOnDeviceProvider`); a fixed-counter reader ignores it. */
  allowOffline?: boolean;
}

/**
 * The outcome of an integrated pay, as DATA — a decline / stall / offline-refusal is never an
 * exception (nothing may block a sale on anything but the sale itself, CLAUDE.md §5). `captured`
 * carries the filed/replayed ticket; the three non-captured arms carry no ticket (nothing was filed
 * and the order stays `open`, so the till simply retries). `timeout` is reserved — the provider
 * currently collapses a poll-window stall into `failed`/`declined` (see {@link toPayOutcome}).
 */
export type IntegratedPayOutcome =
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "declined" }
  | { outcome: "timeout" }
  | { outcome: "network_unavailable" };

/**
 * {@link payWorkingOrderIntegrated}'s deps: the fiscal {@link TillSaleDeps} plus the card `provider`
 * driving the reader. Tips are read off `cfg.tipsEnabled` (the sibling `TillConfig` parameter every
 * caller already passes) rather than carried here too — `boot.ts` set both from the SAME `till`
 * object, so a second copy on the deps could never diverge from it and was dead weight.
 */
export type IntegratedPayDeps = TillSaleDeps & {
  provider: PaymentProvider;
};

/**
 * Pay and settle a working order idempotently — the CRUX of park & retrieve (spec §3). It stops a
 * lost-response pay retry from filing a SECOND chained fiscal record (an unrepairable defect: invoice
 * numbers are never reused, `CLAUDE.md` §5). All in ONE `withTenant`/`asAppUser` transaction, so the
 * working order's settle, the sale, its tender/settlement and its chained fiscal record commit as one
 * unit — or roll back together.
 *
 * The flow, keyed on `req.id` (spec §3):
 *  1. `SELECT … FOR UPDATE` the order. On a PARKED order this serialises a concurrent pay: the second
 *     connection blocks here until the first commits, then re-reads the row as `settled` (step 2).
 *  2. Already `settled` → IDEMPOTENT REPLAY: return the existing sale's ticket, file NOTHING.
 *  3. `abandoned` → refuse (`working_order.not_open`), the domain code the settle UPDATE's trigger
 *     would otherwise raise raw.
 *  4. Does not exist → WALK-UP: create it `open` with its freshly-priced lines (`createOpenOrder`, the
 *     same helper `parkOrder` uses) and file from that price, then settle below.
 *  5. Already `open` (RETRIEVED) → file from the order's STORED locked lines (`priceLockedLines` over
 *     `working_order_lines`, whose gross unit was locked at add-time), NOT a re-price of `req.lines` —
 *     a catalogue price change between park and pay never moves the filed total (line-add snapshot,
 *     7c). Either way file with `recordSale`'s immediate cash settlement tagged with
 *     `working_order_id = req.id`, then UPDATE the order `open → settled`.
 *  6. On a `23505` unique violation (a concurrent pay won the race — its `working_orders` row on a
 *     walk-up, or its sale on a parked order — committed first, aborting this transaction), CATCH it
 *     and replay in a FRESH transaction: read the winner's settled sale and return its ticket. Never
 *     a second filing. This is the concurrent backstop the `FOR UPDATE` lock cannot cover for a
 *     walk-up (there is no pre-existing row to lock).
 *
 * `operatorId` is the person who rang the sale, for attribution — supplied by the session (Task 5).
 */
export async function payWorkingOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  req: PayWorkingOrderRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  try {
    return await withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);

        // Step 1. Lock/resolve the order by its (RLS-tenant-scoped) id. FOR UPDATE serialises a
        // concurrent pay on a PARKED order; on a walk-up there is no row yet, so it locks nothing and
        // the 23505 catch below is that shape's backstop.
        const [locked] = await tx
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, req.id))
          .for("update");

        // Step 2. Already settled → idempotent replay. A retry whose first response was lost, or the
        // loser of a parked-order race that blocked on the lock above and now sees it settled.
        if (locked?.status === "settled") {
          return readSettledTicket(deps.backend, tx, cfg, req.id);
        }

        // Step 3. Abandoned (or any non-open, non-settled) order cannot be paid — the same refusal
        // `updateHeldOrder`/`abandonHeldOrder` make, surfaced as the domain code rather than the raw
        // `working_orders_enforce_transition` trigger error the settle UPDATE would otherwise raise.
        if (locked !== undefined && locked.status !== "open") {
          throw new AppError("working_order.not_open", { workingOrderId: req.id });
        }

        // Tender guard, before anything is filed — a network boundary (the till is untrusted): the only
        // supported tenders are cash (7a) and a manual card (this slice); `voucher`/`transfer`/`other`
        // are refused. AFTER the replay check, so a retry of an already-settled order is never refused
        // for the shape of its retry body. The EMPTY-BASKET guard is NOT here: it belongs to the walk-up
        // shape only (below), because a retrieved order ignores `req.lines` and files its stored lines.
        if (req.tender.method !== "cash" && req.tender.method !== "card") {
          throw new AppError("sale.unsupported_tender", { method: req.tender.method });
        }

        // Steps 4-5. Obtain the authoritative price to file, one way per shape (line-add snapshot, 7c),
        // so it is computed exactly ONCE either way:
        //  - WALK-UP (order does not exist yet): create it OPEN with its freshly-priced lines (the same
        //    `createOpenOrder` `parkOrder` uses, so a walk-up order is identical in shape to a parked
        //    one) and REUSE the price that creation already derived — `createOpenOrder` read the
        //    catalogue and ran `priceBasket` to build the line rows, so re-reading and re-pricing the
        //    identical `req.lines` here would just double the catalogue join on the till's hottest path.
        //    A walk-up carries no label. An empty basket is refused here (nothing to price), a guard the
        //    retrieved shape does not need.
        //  - RETRIEVED order (already exists): file from the STORED locked lines, NOT a re-price of a
        //    client basket. `req.lines` is IGNORED — the browser sends none; the persisted
        //    `working_order_lines` are the authoritative composition, and their `unit_price_gross` was
        //    LOCKED at add-time. `priceLockedLines` runs the SAME difference-method arithmetic over that
        //    locked gross that `priceBasket` runs over a live catalogue, so the filed record is
        //    byte-identical to what the line was priced to at add — and a catalogue price change between
        //    park and pay never moves the filed total (the whole point of the snapshot model).
        // The result is then filed with recordSale's immediate cash settlement, tagged with this order's
        // id (`sales_working_order_id_key` = the idempotency key).
        let priced: PricedLines;
        if (locked === undefined) {
          if (req.lines.length === 0) {
            throw new AppError("sale.empty_basket", {});
          }
          // A WALK-UP may be a counter delivery: thread `deliveryTableId` to the create path (a bad id
          // is refused `table.not_found` there). A retrieved order takes the `else` branch and ignores
          // it — you do not "deliver" a parked order.
          ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null, {
            deliveryTableId: req.deliveryTableId,
          }));
        } else {
          // Retrieved order: file from the STORED locked lines via the shared `priceStoredOrder` reader,
          // never a re-price of a client basket (`req.lines` is IGNORED). It runs the SAME
          // difference-method arithmetic over the locked gross that `priceBasket` runs over a live
          // catalogue, so a catalogue price change between park and pay never moves the filed total.
          priced = await priceStoredOrder(tx, req.id);
        }

        // File the immediate cash/card sale and settle it (open → settled), tagged with this order's id
        // — the shared filing path Mode-T collect reuses (`fileImmediateSale`).
        return fileImmediateSale(tx, deps, cfg, req.id, req.tender, priced, operatorId);
      },
      { nodeId: cfg.nodeId },
    );
  } catch (error) {
    // Step 6. The CONCURRENT backstop. Anything but a unique violation is a real failure (a shortfall,
    // an unknown product, a chain error) and surfaces unchanged.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A 23505 means a concurrent pay for this same id won the race and this transaction aborted. Roll
    // back (already done by the failed `withTenant`) and REPLAY in a fresh transaction: the winner
    // has committed (a unique violation fires only against a COMMITTED conflicting row), so its
    // settled sale is now readable.
    return withTenant(deps.db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const [row] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id));
      /* v8 ignore start */
      if (row?.status !== "settled") {
        // A unique violation with no settled winner is not our idempotency case (e.g. a pay racing a
        // PARK on the same id, which is not a real till flow). Surface the original error rather than
        // report a bogus success with no sale behind it.
        throw error;
      }
      /* v8 ignore stop */
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    });
  }
}

/**
 * Reconstruct a settled working order's ticket by reading back its ALREADY-FILED record — filing
 * NOTHING. `invoiceNumber`, `issuedAt` and `total` are exact (the immutable `sales` row + its series);
 * `qr` and `vatBreakdown` are read back from the fiscal record via `backend.filedReceiptFor`, so the
 * ticket carries the regime's mandatory verification QR and the EXACT filed difference-method desglose
 * (Task 14) rather than a QR-less, recomputed breakdown that could diverge by a cent from what was
 * filed. Two callers:
 *  - an idempotent REPLAY (a payWorkingOrder/collectOrder retry, or a race loser that saw the order
 *    already `settled`): `change` defaults to "0.00" — the cash actually tendered is not persisted
 *    (only the settled amount, which equals the total), and the drawer change was handed over at the
 *    ORIGINAL sale, so a replay re-prints the ticket and hands over nothing;
 *  - Mode-I's FRESH collect, which settled the deferred invoice just now and passes the real cash-back
 *    (`tendered − total`) so THIS ticket reports the change the operator actually gives.
 */
async function readSettledTicket(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  change = "0.00",
): Promise<TillSaleResult> {
  // The single sale filed from this working order — `sales_working_order_id_key` guarantees at most
  // one, and a settled order always has exactly one (filed in the same transaction that settled it).
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
    .where(and(eq(sales.tenantId, cfg.tenantId), eq(sales.workingOrderId, workingOrderId)));

  /* v8 ignore start */
  if (issued === undefined) {
    // Impossible: the settle UPDATE and the sale INSERT commit in one transaction, so a settled order
    // without its sale would be corruption, not a flow this can legitimately reach.
    throw new Error(`payWorkingOrder: settled working order ${workingOrderId} has no sale`);
  }
  /* v8 ignore stop */

  // The FILED line list (art. 7.1.e goods identification), reconstructed from the order's stored lock
  // via the SAME `priceStoredOrder` the file used — byte-identical to what was filed for both a
  // walk-up (`createOpenOrder` stored the priced lock) and a retrieved/placed order. Read straight
  // back rather than recomputed from `sale_lines` (which stores the NET base, so recovering the gross
  // would drift by a cent), so the replayed receipt's line list matches the invoice exactly.
  const ticketLines = ticketLinesFrom(await priceStoredOrder(tx, workingOrderId));

  // Read the QR + the exact filed desglose back from the immutable fiscal record, in this same
  // transaction. This reads nothing but the already-filed alta — never re-files, never re-hashes.
  const filed = await backend.filedReceiptFor(tx, brandSaleId(issued.saleId));
  /* v8 ignore start */
  if (filed === undefined) {
    // Structurally unreachable, for the same reason the `issued === undefined` guard above is: a
    // settled order always has exactly one sale, filed with an `alta` fiscal record in the SAME
    // transaction that settled it, so the read-back always finds it. A missing record here is that
    // same corruption — fail rather than reprint a legal receipt with a fabricated breakdown and no
    // QR (§5: never present invented fiscal figures as filed).
    throw new Error(
      `payWorkingOrder: settled working order ${workingOrderId} has no filed fiscal record`,
    );
  }
  /* v8 ignore stop */

  return {
    invoiceNumber: formatInvoiceNumber(issued.code, issued.number),
    // Normalise the stored `timestamptz` text back to a canonical ISO-8601 instant, so the replayed
    // ticket's `issuedAt` reads identically to the original's `fiscal.issuedAt.toISOString()`.
    issuedAt: new Date(issued.issuedAt).toISOString(),
    total: issued.total,
    vatBreakdown: toVatBreakdown(filed.vatBreakdown),
    lines: ticketLines,
    change,
    qr: filed.verificationUrl,
  };
}

/**
 * The amount to SETTLE a sale at and the CHANGE to hand back, per tender method — the one place both
 * the immediate file (`fileImmediateSale`) and the invoice-first collect (`collectOrder`) derive
 * these, so the coverage branches live and are proven in a single spot:
 *  - CASH may exceed the total (change is handed back); a tender BELOW the total is a shortfall.
 *    `settleSale` demands EXACT coverage (`sum(amount) = total`), so a covered tender settles the sale
 *    at the TOTAL, never at the cash handed over (change is drawer cash, not a settled amount). When
 *    the cash falls short we hand the RAW amount straight through so `settleSale` itself raises
 *    `sale.tender_shortfall` and the whole transaction rolls back — the caller never has to pre-check.
 *  - CARD is a manual/unintegrated tender: the operator charged the EXACT total on a separate bank
 *    terminal, so the settled amount IS the total and there is no change — `tender.amount` is not
 *    consulted (a client over/under-send cannot move the filed figure).
 * `change` for the short-cash case is "0.00" (never used — the shortfall aborts first), so a caller
 * that reaches the return value always has a non-negative change.
 */
function settlementFor(
  tender: TillTender,
  total: string,
): { settledAmount: string; change: string } {
  if (tender.method === "card") {
    return { settledAmount: total, change: "0.00" };
  }
  const covered = compareDecimal(decimal(tender.amount), decimal(total)) >= 0;
  return {
    settledAmount: covered ? total : tender.amount,
    change: covered ? subtractDecimal(decimal(tender.amount), decimal(total)) : "0.00",
  };
}

/**
 * File an IMMEDIATE cash/card sale from an already-priced basket and settle it in ONE transaction —
 * the shared filing tail of `payWorkingOrder` (walk-up + retrieved) and `collectOrder`'s Mode-T branch
 * (ticket-then-pay). It takes the caller's `tx`, so the sale, its tender/settlement, its chained
 * fiscal record and the `open`/`placed` → `settled` transition all commit as one unit (or roll back
 * together). It does NOT lock or read the order status — the caller has already locked it `for update`
 * and is responsible for the guard — it only files, settles and transitions.
 *
 * `workingOrderId` tags the sale (`sales_working_order_id_key` = the idempotency key); `priced` is the
 * authoritative price (walk-up `priceBasket`, or a stored-lock `priceLockedLines`).
 *
 * `markCollected` stamps the ORDER-level `collected_at` handover marker (KDS-1 §3e) in the SAME settle
 * UPDATE — passed `true` ONLY by `collectOrder`'s Mode-T branch (a counter collect hands the order to
 * the customer, so it must leave its station queue). A walk-up/retrieved pay (`payWorkingOrder`) and a
 * Mode-P prepay (which settles BEFORE `sendToPrep` fires) leave it `false`, so `collected_at` stays
 * NULL and the order — once fired — stays on the station queue until it is actually collected. Stamping
 * it here rather than in a later UPDATE is required: a settled → settled edit is rejected by
 * `working_orders_enforce_transition`. NON-FISCAL — the alta path never reads it (H2 huella-identity).
 */
async function fileImmediateSale(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
  workingOrderId: string,
  tender: TillTender,
  priced: PricedLines,
  operatorId?: string,
  markCollected = false,
): Promise<TillSaleResult> {
  const isCard = tender.method === "card";
  const { settledAmount, change } = settlementFor(tender, priced.total);

  // One clock reading for the settlement instant, shared by the tender and the order's `settled_at`
  // so both name the same moment. recordSale reads its own clock for the sale's `issued_at`.
  const settledAt = deps.clock.now().instant;

  const { saleId, fiscal } = await recordSale(tx, deps.backend, {
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    seriesId: cfg.seriesId,
    // The persisted working order this sale is filed from. It is the sale-idempotency key: a second
    // pay for the same id collides on `sales_working_order_id_key` (23505) and replays.
    workingOrderId: brandWorkingOrderId(workingOrderId),
    locale: cfg.locale,
    invoiceLocales: cfg.invoiceLocales,
    total: priced.total,
    lines: priced.lines,
    vatBreakdown: priced.vatBreakdown,
    fiscalBackend: "verifactu",
    clock: deps.clock,
    operatorId,
    settlement: {
      kind: "immediate",
      tenders: [{ method: tender.method, amount: settledAmount, tipAmount: "0.00", settledAt }],
    },
  });

  // Card ONLY: the manual card tender adds a captured `payments` ledger row beside the tender and
  // links it to the just-filed sale, in THIS same transaction. `recordManualCardPayment` makes NO
  // network call, so it commits inline with the sale — no orphan window, and 7b's
  // `sales_working_order_id_key` idempotency covers a lost-response retry (a replay never reaches
  // here). Cash gets no payments row. `settledAt` is the SAME reading the tender carries.
  if (isCard) {
    const { provider, paymentRef } = await recordManualCardPayment(tx, {
      tenantId: cfg.tenantId,
      workingOrderId,
      amount: decimal(priced.total),
      settledAt,
      externalRef: tender.externalRef,
    });
    await associatePaymentWithSale(tx, { provider, paymentRef, saleId, tenantId: cfg.tenantId });
  }

  // → settled. `working_orders_enforce_transition` permits both open → settled (walk-up/pay) and
  // placed → settled (Mode-T collect); the `settled_at` biconditional requires the timestamp be set —
  // the SAME instant the tender carries. A Mode-T collect (`markCollected`) ALSO stamps the order-level
  // `collected_at` handover marker in this same transition (see the doc-comment) — same instant as
  // `settled_at`; walk-up/prepay leave it NULL.
  await tx
    .update(workingOrders)
    .set({
      status: "settled",
      settledAt: settledAt.toISOString(),
      ...(markCollected ? { collectedAt: settledAt.toISOString() } : {}),
    })
    .where(eq(workingOrders.id, workingOrderId));

  // `FiscalRecordRef` exposes no series code or invoice number (it is regime-opaque), so the
  // human-facing "A/1" is read back from the sale row and its series (the shared `readInvoiceNumber`
  // reader), in this same transaction.
  return {
    invoiceNumber: await readInvoiceNumber(tx, saleId),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    // The FILED line list (art. 7.1.e) straight from the price just filed, so the receipt's line list
    // is the invoiced composition rather than the client basket (Finding 2).
    lines: ticketLinesFrom(priced),
    change,
    qr: fiscal.verificationUrl ?? "",
  };
}

/**
 * Resolve an ALREADY-ISSUED (invoice-first) outstanding sale for a working order — the ORDERING-1
 * discriminator for {@link payWorkingOrderIntegrated}. Under `invoice_first` the deferred invoice is
 * filed AT PLACING (`placeOrder`), so a `placed` invoice-first order already carries a chained,
 * unsettled `sales` row; every other flow files its sale at pay, so a non-settled order has none and
 * this returns `undefined`. The presence of that row — not `cfg.orderFlow` — is the discriminator (the
 * DB is the truth). `sales_working_order_id_key` (UNIQUE on `(tenant_id, working_order_id)`) makes the
 * lookup return at most one row.
 *
 * `amountDue` is `total + correctionTotal` — the printed total netted against every rectificativa
 * correcting it — computed with the SAME correlated corrections subquery `settleSale` and
 * `listOutstandingSales` use (`list-outstanding-sales.ts:51`, `settle-sale.ts:41`). It therefore equals
 * the `due` `settleSale` re-derives in-transaction, so a card charged `amountDue + tip` settles the
 * sale exactly (coverage identity `charged = total + corrections + Σtip`, the tip carried on the
 * tender). `${sales}.id` (not `${sales.id}`) renders the column table-qualified so the `sales c`
 * subquery cannot capture a bare `"id"` — the note `settleSale` carries for the identical template.
 */
async function readOutstandingSaleForOrder(
  tx: Transaction,
  tenantId: TenantId,
  workingOrderId: string,
): Promise<{ saleId: SaleId; amountDue: Decimal } | undefined> {
  const [row] = await tx
    .select({
      id: sales.id,
      total: sales.total,
      corrections: sql<string>`coalesce((select sum(c.total) from sales c where c.corrects_sale_id = ${sales}.id and c.tenant_id = ${tenantId}), 0)::numeric(12, 2)::text`,
    })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.workingOrderId, workingOrderId)));
  if (row === undefined) {
    return undefined;
  }
  return {
    saleId: brandSaleId(row.id),
    amountDue: addDecimal(decimal(row.total), decimal(row.corrections)),
  };
}

/**
 * Pay and settle a working order over an INTEGRATED card terminal — the SPLIT-transaction path
 * (design "ordering 2", issue-at-pay), built BESIDE {@link payWorkingOrder} (cash / manual card,
 * which stays behaviourally identical). The network `collect` MUST run OUTSIDE any database transaction
 * (T1/T2 — a lock is never held across a reader round-trip), so this is three phases in three separate
 * transactions:
 *
 *  - P1 (tx A). Lock/resolve the order, decide the price, and — for a WALK-UP — create it `open` and
 *    COMMIT, so the `working_orders` row exists before P2: the provider's `insertAttempting` carries a
 *    composite FK to `working_orders` (`payments_working_order_fk`, `packages/payments`), which an
 *    uncommitted row would violate. An already-`settled` order REPLAYS its ticket here (files nothing);
 *    an `abandoned` (or any other non-`open`/`placed`) order is refused `working_order.not_open`; an
 *    empty WALK-UP basket is refused `sale.empty_basket`. A retrieved/placed order files its STORED
 *    locked lines (`priceStoredOrder`), never a re-price of `req.lines` (line-add snapshot, 7c).
 *  - P2 (no tx). Drive the reader with `provider.collect` for `total + tip` (the tip clamped to 0 when
 *    the till has tips disabled, so a client cannot add a gratuity the venue does not take). A
 *    `failed`/`network_unavailable` result files NOTHING, leaves the order `open` (retryable), and
 *    returns the mapped non-captured outcome — a decline is DATA, never a throw (nothing may block a
 *    sale on anything but the sale itself, CLAUDE.md §5).
 *  - P3 (tx B). On `captured`/`accepted_offline`, `finalizeCapture` files the immediate card sale,
 *    associates the just-captured payment, and settles the order — atomically.
 *
 * P1's `prepared` result is a small discriminated union covering every state the locked order can be
 * in, dispatched into five arms:
 *  - `replay` — the order is already `settled` (a retry whose first response was lost); returns the
 *    stored ticket and files nothing.
 *  - `recover` / `recover-settle` — the §4 capture-idempotency pre-check
 *    (`findCapturedPaymentForWorkingOrder`) found a captured-but-unassociated payment on an
 *    `open`/`placed` order (a lost-T2: `collect` committed its capture but P3 never ran). `recover`
 *    files a fresh sale from the stored lock (ordering 2, via `finalizeRecovery`); `recover-settle`
 *    instead SETTLES an already-issued invoice (ordering 1, via `finalizeSettleRecovery`) when one is
 *    outstanding, since a second `recordSale` would 23505 against it. Neither re-drives P2 — the
 *    capture already happened.
 *  - `settle` — ordering 1 (invoice-first): a `placed` order already carries an unsettled issued
 *    invoice (`readOutstandingSaleForOrder`) and no lost capture is pending, so P2 collects the
 *    outstanding amount due and P3 SETTLES that invoice (`finalizeSettle`) rather than filing a new one.
 *  - `collect` — the walk-up or ordering-2 (issue-at-pay) case: prices the lines (fresh for a walk-up,
 *    the stored lock for a retrieved/placed order), P2 drives the reader for that price, and P3 files
 *    the sale at pay (`finalizeCapture`).
 *
 * `operatorId` is the person who rang the sale, for attribution — threaded through to `recordSale`.
 */
export async function payWorkingOrderIntegrated(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  operatorId?: string,
): Promise<IntegratedPayOutcome> {
  // ---- P1 (tx A): resolve / replay / price; commit a walk-up order OPEN before the network call. ----
  const prepared = await withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id))
        .for("update");

      // Already settled → idempotent replay (a retry whose first response was lost). Files nothing.
      if (locked?.status === "settled") {
        return {
          kind: "replay" as const,
          ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
        };
      }

      // A `placed` order is payable too — that is issue-at-pay (ordering 2). Only a terminal non-settled
      // state (abandoned) — or any other unexpected status — refuses, the fail-closed shape
      // `payWorkingOrder` uses; the settle UPDATE's `enforce_transition` trigger is the DB backstop.
      if (locked !== undefined && locked.status !== "open" && locked.status !== "placed") {
        throw new AppError("working_order.not_open", { workingOrderId: req.id });
      }

      // Empty-basket guard, WALK-UP shape only: a retrieved/placed order ignores `req.lines` and files its
      // stored lock, so an empty `req.lines` there is normal (the till sends none), not a refusal.
      if (req.lines.length === 0 && locked === undefined) {
        throw new AppError("sale.empty_basket", {});
      }

      // EXISTING orders only: resolve the ordering-1 discriminator and run the §4 capture pre-check. A
      // walk-up (`locked === undefined`) has neither — no prior sale, and no `collect` can have run: the
      // provider's `insertAttempting` FKs `working_orders` (`payments_working_order_fk`,
      // `packages/payments`), so no `payments` row can exist before the order row does — the same FK this
      // body's P1-commit-before-collect ordering is built around.
      if (locked !== undefined) {
        // ORDERING 1 (invoice-first): the deferred invoice was issued at placing, so a `placed`
        // invoice-first order already carries an unsettled `sales` row (ordering 2 files at pay, so its
        // non-settled order has none → `undefined`). Used both to route a live collect to a SETTLE and to
        // decide whether a lost-T2 recovery settles the existing invoice or files a fresh sale.
        const outstanding = await readOutstandingSaleForOrder(tx, cfg.tenantId, req.id);

        // §4 capture-idempotency pre-check. A captured (or offline-accepted) payment whose sale is not yet
        // filed (`sale_id` NULL) is the LOST-T2 RECOVERY WINDOW: `collect`'s T2 committed its capture but
        // P3 never ran, so a naive retry would re-drive `collect` and charge the card a SECOND time — an
        // unrepairable defect (spec §4). A captured row that ALREADY carries a `sale_id` means its sale is
        // filed and the order is therefore `settled`, so the replay above (step 2) has already returned —
        // this only fires on an `open`/`placed` order.
        const captured = await findCapturedPaymentForWorkingOrder(tx, {
          tenantId: cfg.tenantId,
          provider: deps.provider.provider,
          workingOrderId: req.id,
        });
        if (captured !== undefined && captured.saleId === null) {
          // Recover WITHOUT re-charging. When the invoice was ALREADY ISSUED (ordering 1), recover by
          // SETTLING it (`finalizeSettleRecovery`) — a second `recordSale` would 23505 against the issued
          // invoice; otherwise file a fresh sale from the stored lock (ordering 2, `finalizeRecovery`).
          return outstanding !== undefined
            ? { kind: "recover-settle" as const, captured, outstanding }
            : { kind: "recover" as const, captured };
        }

        // No lost capture. An outstanding issued invoice (ordering 1) routes this pay to a SETTLE of the
        // already-issued invoice, ahead of the ordering-2 `collect` pricing below — an invoice-first order
        // never re-files (the real hazard is an orphaned capture beside an unsettled invoice, not a
        // double-file, which the UNIQUE key already blocks).
        if (outstanding !== undefined) {
          return { kind: "settle" as const, outstanding };
        }
      }

      // Price exactly once. A WALK-UP creates the order OPEN with its freshly-priced lines (committing this
      // tx below satisfies the provider's FK), reusing that price; a RETRIEVED/PLACED order files its
      // STORED locked lines — `req.lines` is IGNORED, exactly as `payWorkingOrder`/`collectOrder` do.
      let priced: PricedLines;
      if (locked === undefined) {
        ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null));
      } else {
        priced = await priceStoredOrder(tx, req.id);
      }
      // A `placed` order at this read is a genuine COUNTER COLLECT (the card is being tendered at the
      // collect stage of a prepared order) rather than a walk-up `open` → settle; `finalizeCapture`
      // stamps `collected_at` (dropping it from its station queue) only in that case — the integrated
      // analogue of `fileImmediateSale`'s `markCollected` (KDS-1 §3e).
      return { kind: "collect" as const, priced, wasPlaced: locked?.status === "placed" };
    },
    { nodeId: cfg.nodeId },
  );

  if (prepared.kind === "replay") {
    return { outcome: "captured", ticket: prepared.ticket };
  }
  // Recovery of a lost-T2 capture, WITHOUT a second `collect` (P2 is skipped entirely). Ordering 2
  // files a fresh sale from the stored lock (`finalizeRecovery`); ordering 1 SETTLES the already-issued
  // invoice (`finalizeSettleRecovery`). Each associates the EXISTING captured row, and decides
  // `captured` (files/settles or replays a concurrent winner's ticket) or throws the corruption path
  // (§5), so it returns the whole outcome.
  if (prepared.kind === "recover") {
    return finalizeRecovery(deps, cfg, req, prepared.captured, operatorId);
  }
  if (prepared.kind === "recover-settle") {
    return finalizeSettleRecovery(deps, cfg, req, prepared.captured, prepared.outstanding);
  }

  // ---- P2 (no tx): drive the reader. Decline / stall / offline-refused are DATA, never a throw. ----
  // Resolve the nullish tip default OUTSIDE the ternary so it is exercised on every tips-OFF call (the
  // till's common case), not only on a tips-on call that happens to omit a tip.
  const tipInput = req.tip ?? "0.00";
  const tip = cfg.tipsEnabled ? decimal(tipInput) : decimal("0.00");
  // The card-charge base: ORDERING 1 collects the outstanding invoice's amount due (`total +
  // corrections`); ORDERING 2 collects the freshly-priced total. Both add the tip on top.
  const baseAmount =
    prepared.kind === "settle" ? prepared.outstanding.amountDue : prepared.priced.total;
  const result = await deps.provider.collect({
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    workingOrderId: brandWorkingOrderId(req.id),
    amount: addDecimal(baseAmount, tip),
    allowOffline: req.allowOffline,
  });
  if (result.state !== "captured" && result.state !== "accepted_offline") {
    return toPayOutcome(result, null);
  }

  // ---- P3 (tx B): file/settle + associate + settle atomically; a concurrent winner replays. ----
  // ORDERING 1 SETTLES the already-issued invoice (`finalizeSettle`); ORDERING 2 files it at pay
  // (`finalizeCapture`). Both link the just-captured payment and move the order → settled.
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
 * File the immediate card sale for a captured/offline-accepted integrated payment, LINK that payment,
 * and settle the order — P3 (tx B) of {@link payWorkingOrderIntegrated}, in ONE transaction so the
 * sale, its tender/settlement, its chained fiscal record, the payment association and the
 * `open`/`placed` → `settled` transition commit as one unit (or roll back together — proven by the
 * "association fails → the whole sale rolls back" case).
 *
 * Idempotency for a CONCURRENT winner is the `sales_working_order_id_key` 23505 backstop, mirroring
 * `payWorkingOrder`'s: if another pay for this id filed its sale first (between P1's commit and here),
 * `recordSale` collides on that unique key and this replays the winner's settled ticket rather than
 * filing a second unrepairable record. The SEQUENTIAL retry never reaches here — P1's `for update` read
 * already saw the order `settled` and replayed there. Two concurrent captures are ALSO serialised one
 * level down, inside `recordSale` itself: `checkIntegrity` takes the (tenant, node) chain-head row lock
 * as its first statement and holds it until commit (`packages/core/src/record-sale.ts:181-185`), so the
 * second caller cannot even start its own `checkIntegrity` until the first has fully committed — by
 * which point the first's `sales` row already exists, and the second's own insert (step 4, after the
 * lock) is what hits the unique key. So, unlike `payWorkingOrder` (whose lock+file share one
 * transaction) this needs no internal re-lock of its own, but the 23505 path is real and reachable
 * rather than dead code: it is exercised end to end by "two concurrent pays for one parked order file
 * ONE sale; the loser replays (one sale/settlement)" (`apps/server/src/till-sale-integrated.rls.test.ts`),
 * which drives two real, concurrently-racing app-role connections and asserts `registroCount === 1`.
 * `readSettledTicket`
 * defaults `change` to "0.00": a replay hands back nothing (the winner settled the drawer at its sale).
 *
 * The tender records the WHOLE card charge (`total + tip`) with the tip attributed on it, satisfying
 * `settleSale`'s coverage identity `sum(amount) = total + sum(tip)`; the fiscal `total` stays ex-tip
 * (`priced.total`), a tip being non-taxable and on no invoice (design §9.2).
 */
async function finalizeCapture(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  priced: PricedLines,
  tip: Decimal,
  result: PaymentResult,
  operatorId?: string,
  // True when the order was `placed` at P1 (a counter card collect, not a walk-up `open` → settle) —
  // then `collected_at` is stamped in the settle UPDATE so the order leaves its station queue (§3e).
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
    return await withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);

        const { saleId, fiscal } = await recordSale(tx, deps.backend, {
          tenantId: cfg.tenantId,
          tillId: cfg.tillId,
          nodeId: cfg.nodeId,
          seriesId: cfg.seriesId,
          // The persisted working order this sale is filed from — the sale-idempotency key
          // (`sales_working_order_id_key`), and what the 23505 backstop below keys the replay on.
          workingOrderId: brandWorkingOrderId(req.id),
          locale: cfg.locale,
          invoiceLocales: cfg.invoiceLocales,
          total: priced.total,
          lines: priced.lines,
          vatBreakdown: priced.vatBreakdown,
          fiscalBackend: "verifactu",
          clock: deps.clock,
          operatorId,
          settlement: {
            kind: "immediate",
            tenders: [
              { method: "card", amount: addDecimal(priced.total, tip), tipAmount: tip, settledAt },
            ],
          },
        });

        // Link the ALREADY-CAPTURED integrated payment (written by `provider.collect`'s T2) to the sale,
        // in this same transaction — NOT a second manual `payments` row. `fileImmediateSale`'s #62
        // side-write (`recordManualCardPayment`) is for an UNINTEGRATED card, which has no prior payment;
        // here the reader already took the money and recorded the row, so this only points its `sale_id`.
        await associatePaymentWithSale(tx, {
          provider: result.provider,
          paymentRef: result.paymentRef,
          saleId,
          tenantId: cfg.tenantId,
        });

        // → settled. `working_orders_enforce_transition` permits open → settled (walk-up) and
        // placed → settled (issue-at-pay); the `settled_at` biconditional requires the timestamp be set.
        // A counter collect (`markCollected`, the order was `placed`) ALSO stamps the order-level
        // `collected_at` handover marker in this same transition — a later UPDATE would be settled →
        // settled, which the trigger rejects. Same instant as `settled_at`; NON-FISCAL (the alta path
        // never reads it). A walk-up `open` → settle leaves it NULL.
        await tx
          .update(workingOrders)
          .set({
            status: "settled",
            settledAt: settledAt.toISOString(),
            ...(markCollected ? { collectedAt: settledAt.toISOString() } : {}),
          })
          .where(eq(workingOrders.id, req.id));

        return {
          invoiceNumber: await readInvoiceNumber(tx, saleId),
          issuedAt: fiscal.issuedAt.toISOString(),
          total: priced.total,
          vatBreakdown: toVatBreakdown(priced.vatBreakdown),
          lines: ticketLinesFrom(priced),
          change: "0.00",
          qr: fiscal.verificationUrl ?? "",
        };
      },
      { nodeId: cfg.nodeId },
    );
  } catch (error) {
    // The CONCURRENT backstop. Anything but a unique violation is a real failure (a chain error, or a
    // failed association) and surfaces unchanged — the transaction above already rolled back, so a
    // half-filed sale never persists.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A 23505 on `sales_working_order_id_key`: a concurrent pay for this id won the race and committed
    // its sale first, aborting this one. Replay the winner's settled ticket in a fresh transaction
    // (the unique violation fires only against a COMMITTED conflicting row, so it is readable now),
    // filing nothing.
    return withTenant(deps.db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    });
  }
}

/**
 * Finalise a LOST-T2 captured payment WITHOUT re-charging — the §4 recovery path, dispatched from P1's
 * pre-check (`findCapturedPaymentForWorkingOrder` found a captured/offline-accepted `payments` row for
 * this order whose `sale_id` is still NULL: `collect`'s T2 committed but P3 never filed the sale). It
 * files the sale from the order's STORED locked lines — the SAME lines P1 would have priced, so
 * `priced.total` equals what `collect` charged when no tip was added (line-add snapshot, 7c) — and
 * associates THIS existing captured row, never a second `collect` (design Decision 2). All in ONE
 * `withTenant`/`asAppUser` transaction so the sale, its tender/settlement, its chained fiscal record,
 * the association and the `open`/`placed` → `settled` transition commit as one unit (or roll back
 * together).
 *
 * Idempotency, WITHOUT a 23505 backstop: recovery only fires on an EXISTING order (the pre-check runs
 * for `locked !== undefined`), so — like `collectOrder`, and unlike `payWorkingOrder`'s walk-up shape —
 * the `SELECT … FOR UPDATE` here FULLY serialises a concurrent recovery: a second retry blocks on the
 * lock, re-reads the row `settled`, and REPLAYS the winner's ticket (filing/associating nothing). There
 * is no unlocked walk-up path left for a unique-key race to slip through.
 *
 * The recovery contract (spec Decision 2 — this is fiscal-unrecoverable territory, §5):
 *  - The captured charge was gross `total + tip`, so the tip is RECONSTRUCTED as `captured.amount −
 *    priced.total` (≥ 0 by the guard below). The fiscal `total` stays ex-tip (`priced.total`); the
 *    tender records the whole card charge with the tip attributed on it — the same coverage identity
 *    `sum(amount) = total + sum(tip)` that `finalizeCapture` files under.
 *  - CORRUPTION GUARD: a charge that cannot even cover the locked total (`captured.amount <
 *    priced.total`) means the stored lock and the charge disagree and there is NO honest fiscal figure
 *    to file. File NOTHING and throw a plain `Error` — a non-`AppError`, so `run` maps it to
 *    `server.internal` 500 — leaving the captured payment (`sale_id` NULL) as reconcile's orphan class.
 *    Never invent a divergent total; a wrong fiscal record is unrepairable (§5).
 */
async function finalizeRecovery(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  captured: CapturedPaymentForOrder,
  operatorId?: string,
): Promise<IntegratedPayOutcome> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Re-lock FOR UPDATE (the order always exists here): serialises a concurrent recovery — the loser
      // blocks, then re-reads `settled` and replays below.
      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id))
        .for("update");

      // A concurrent winner (another retry) filed the sale and settled the order while this one waited on
      // the lock → idempotent replay, file and associate NOTHING.
      if (locked?.status === "settled") {
        return {
          outcome: "captured",
          ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
        };
      }

      // File from the STORED locked lines — the SAME `priceStoredOrder` reader P1 priced with, so
      // `priced.total` equals what `collect` charged (ex any tip). NOT a re-price of `req.lines`.
      const priced = await priceStoredOrder(tx, req.id);
      const capturedAmount = decimal(captured.amount);

      // Corruption guard (Decision 2 / §5): the charge cannot cover the locked total → file nothing,
      // leave the captured payment for reconcile's orphan class. A plain `Error` maps to `server.internal`.
      if (compareDecimal(capturedAmount, priced.total) < 0) {
        throw new Error(
          `finalizeRecovery: captured ${captured.amount} is below the locked total ${priced.total} for working order ${req.id}`,
        );
      }

      // Reconstruct the tip from the gross charge (≥ 0 by the guard above).
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
        tenantId: cfg.tenantId,
        tillId: cfg.tillId,
        nodeId: cfg.nodeId,
        seriesId: cfg.seriesId,
        // The persisted working order this sale is filed from — the sale-idempotency key
        // (`sales_working_order_id_key`).
        workingOrderId: brandWorkingOrderId(req.id),
        locale: cfg.locale,
        invoiceLocales: cfg.invoiceLocales,
        total: priced.total,
        lines: priced.lines,
        vatBreakdown: priced.vatBreakdown,
        fiscalBackend: "verifactu",
        clock: deps.clock,
        operatorId,
        settlement: {
          kind: "immediate",
          tenders: [{ method: "card", amount: capturedAmount, tipAmount: tip, settledAt }],
        },
      });

      // Link the EXISTING captured payment (the lost-T2 row) to the just-filed sale — NOT a second
      // `payments` row and NOT a re-charge. `associatePaymentWithSale` is write-once, so a concurrent
      // recovery that reached here first has already claimed it (but the FOR UPDATE above means the loser
      // never gets here — it replayed).
      await associatePaymentWithSale(tx, {
        provider: deps.provider.provider,
        paymentRef: captured.paymentRef,
        saleId,
        tenantId: cfg.tenantId,
      });

      // → settled, at the ORIGINAL capture instant (the same reading the tender carries).
      // `working_orders_enforce_transition` permits open → settled and placed → settled; the `settled_at`
      // biconditional requires the timestamp be set. A recovered order that was `placed` (a genuine
      // counter collect whose P3 was lost) ALSO stamps `collected_at` here so it leaves its station queue
      // (§3e) — read off the FOR-UPDATE status above, the recover-time analogue of `finalizeCapture`'s
      // P1 `markCollected`. A recovered WALK-UP (`open`, never fired) leaves it NULL. NON-FISCAL.
      await tx
        .update(workingOrders)
        .set({
          status: "settled",
          settledAt: settledAt.toISOString(),
          ...(locked?.status === "placed" ? { collectedAt: settledAt.toISOString() } : {}),
        })
        .where(eq(workingOrders.id, req.id));

      return {
        outcome: "captured",
        ticket: {
          invoiceNumber: await readInvoiceNumber(tx, saleId),
          issuedAt: fiscal.issuedAt.toISOString(),
          total: priced.total,
          vatBreakdown: toVatBreakdown(priced.vatBreakdown),
          lines: ticketLinesFrom(priced),
          change: "0.00",
          qr: fiscal.verificationUrl ?? "",
        },
      };
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * SETTLE an ALREADY-ISSUED (invoice-first) invoice for a captured integrated payment, LINK that
 * payment, and move the order → settled — P3 (tx B) of {@link payWorkingOrderIntegrated}'s ORDERING-1
 * branch, the settle analogue of {@link finalizeCapture}. The invoice was filed (chained, filed) at
 * PLACING (`placeOrder`), so this files NO second fiscal record — a double-file would be unrepairable
 * (§5); it only `settleSale`s the existing sale. All in ONE transaction so the settlement, its tender,
 * the payment association and the `placed → settled` transition commit as one unit (or roll back
 * together — proven by the "association fails → settlement rolls back, invoice stays outstanding" case).
 *
 * `outstanding.amountDue` is `total + corrections`, so the card was charged `amountDue + tip` (P2) and
 * the tender records that whole charge with the tip attributed on it — `settleSale`'s coverage identity
 * `charged = total + corrections + Σtip` holds, the tip staying OUTSIDE the fiscal total (design §9.2).
 *
 * Idempotency mirrors `finalizeCapture`'s 23505 backstop, on `sale.already_settled` instead: the
 * SEQUENTIAL retry never reaches here (P1's `for update` saw the order `settled` and replayed at step
 * 2), so this catch fires only when a CONCURRENT collect/recovery settled the invoice between P1 and
 * here — `settleSale`'s own `sale.already_settled` (the `sale_settlements` UNIQUE, or the
 * post-settlement `tenders` trigger WT002). It replays the settled ticket in a FRESH transaction (that
 * trigger may leave the failing transaction aborted, so the read cannot reuse it), settling nothing.
 * `readSettledTicket` reads the invoice back by working-order id; `change` stays "0.00" (a card hands
 * nothing back).
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
    return await withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);

        // Settle the EXISTING issued invoice — files no fiscal record. The tender records the whole card
        // charge (`amountDue + tip`) with the tip attributed on it (coverage identity above); `settleSale`
        // re-derives `due = total + corrections` itself and rejects a mismatch as `sale.tender_shortfall`.
        await settleSale(tx, {
          tenantId: cfg.tenantId,
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

        // Link the ALREADY-CAPTURED integrated payment (written by `collect`'s T2) to the issued sale, in
        // this same transaction — NOT a second `payments` row. Mirrors `finalizeCapture`'s association; an
        // association failure (`payment.not_found`) is a non-`already_settled` error, so the catch below
        // re-raises it and the whole settlement rolls back.
        await associatePaymentWithSale(tx, {
          provider: result.provider,
          paymentRef: result.paymentRef,
          saleId: outstanding.saleId,
          tenantId: cfg.tenantId,
        });

        // placed → settled. `working_orders_enforce_transition` permits it; the `settled_at` biconditional
        // requires the timestamp be set — the same instant the tender carries. An invoice-first settle is
        // ALWAYS a counter collect (the order was `placed` at placing), so `collected_at` is stamped
        // UNCONDITIONALLY in this same transition — dropping it from its station queue (§3e). NON-FISCAL:
        // the settle files nothing new, so the fiscal record is byte-unchanged.
        await tx
          .update(workingOrders)
          .set({
            status: "settled",
            settledAt: settledAt.toISOString(),
            collectedAt: settledAt.toISOString(),
          })
          .where(eq(workingOrders.id, req.id));

        // Read the ticket back from the just-settled (already-issued) invoice — a fresh collect, so
        // `change` stays the "0.00" default.
        return readSettledTicket(deps.backend, tx, cfg, req.id);
      },
      { nodeId: cfg.nodeId },
    );
  } catch (error) {
    // A CONCURRENT collect/recovery settled the invoice first → `sale.already_settled`. Anything else (a
    // failed association, a shortfall) is a real failure and surfaces unchanged, its transaction already
    // rolled back. Replay the settled ticket in a FRESH transaction (the failing tx may be aborted by
    // the post-settlement trigger), settling nothing.
    if (!(error instanceof AppError) || error.code !== "sale.already_settled") {
      throw error;
    }
    return withTenant(deps.db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return readSettledTicket(deps.backend, tx, cfg, req.id);
    });
  }
}

/**
 * SETTLE an already-issued (invoice-first) invoice for a LOST-T2 captured payment WITHOUT re-charging —
 * the ORDERING-1 recovery, the settle analogue of {@link finalizeRecovery}. Dispatched from P1's §4
 * pre-check when it finds a captured/offline-accepted `payments` row (`sale_id` NULL) AND an
 * outstanding issued invoice for the order. It `settleSale`s the existing invoice and associates THIS
 * captured row — never a second `collect`, and never `recordSale` (which would 23505 against the issued
 * invoice). All in ONE transaction (settlement + tender + association + `placed → settled`), committed
 * as one unit or rolled back together.
 *
 * Idempotency, WITHOUT a backstop constraint (mirroring `finalizeRecovery`): recovery fires only on an
 * EXISTING order, so the `SELECT … FOR UPDATE` here FULLY serialises a concurrent recovery — a second
 * retry blocks, re-reads the order `settled`, and REPLAYS the winner's ticket (settling/associating
 * nothing). No unlocked path is left for a constraint race to slip through.
 *
 * The recovery contract (spec Decision 2 — fiscal-unrecoverable territory, §5), mirroring
 * `finalizeRecovery`:
 *  - The captured charge was gross `amountDue + tip`, so the tip is RECONSTRUCTED as `captured.amount −
 *    amountDue` (≥ 0 by the guard below). The tender records the whole charge with the tip attributed;
 *    the fiscal figures are untouched (a settle files nothing).
 *  - CORRUPTION GUARD: a charge that cannot even cover the amount due (`captured.amount < amountDue`)
 *    means the issued invoice and the charge disagree, and settling at a smaller-than-due tender would
 *    raise `sale.tender_shortfall` anyway. Settle NOTHING and throw a plain `Error` (→ `server.internal`
 *    500), leaving the captured payment (`sale_id` NULL) as reconcile's orphan class. Never invent a
 *    divergent figure; a wrong fiscal settlement is unrepairable (§5).
 */
async function finalizeSettleRecovery(
  deps: IntegratedPayDeps,
  cfg: TillConfig,
  req: IntegratedPayRequest,
  captured: CapturedPaymentForOrder,
  outstanding: { saleId: SaleId; amountDue: Decimal },
): Promise<IntegratedPayOutcome> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Re-lock FOR UPDATE (the order always exists here): serialises a concurrent recovery — the loser
      // blocks, then re-reads `settled` and replays below.
      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id))
        .for("update");

      // A concurrent winner settled the invoice and moved the order while this one waited on the lock →
      // idempotent replay, settle and associate NOTHING.
      if (locked?.status === "settled") {
        return {
          outcome: "captured",
          ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
        };
      }

      const capturedAmount = decimal(captured.amount);

      // Corruption guard (Decision 2 / §5): the charge cannot cover the amount due → settle nothing, leave
      // the captured payment for reconcile's orphan class. A plain `Error` maps to `server.internal`.
      if (compareDecimal(capturedAmount, outstanding.amountDue) < 0) {
        throw new Error(
          `finalizeSettleRecovery: captured ${captured.amount} is below the amount due ${outstanding.amountDue} for working order ${req.id}`,
        );
      }

      // Reconstruct the tip from the gross charge (≥ 0 by the guard above).
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

      // Settle the EXISTING issued invoice — files no fiscal record. The tender records the whole card
      // charge with the reconstructed tip attributed on it (coverage identity `charged = total +
      // corrections + Σtip`; `settleSale` re-derives `due` and rejects a mismatch).
      await settleSale(tx, {
        tenantId: cfg.tenantId,
        saleId: outstanding.saleId,
        tenders: [{ method: "card", amount: capturedAmount, tipAmount: tip, settledAt }],
      });

      // Link the EXISTING captured payment (the lost-T2 row) to the issued sale — NOT a second `payments`
      // row and NOT a re-charge. The FOR UPDATE above means the loser never reaches here (it replayed).
      await associatePaymentWithSale(tx, {
        provider: deps.provider.provider,
        paymentRef: captured.paymentRef,
        saleId: outstanding.saleId,
        tenantId: cfg.tenantId,
      });

      // placed → settled, at the ORIGINAL capture instant (the same reading the tender carries). An
      // invoice-first recovery is ALWAYS a PLACED counter collect, so `collected_at` is stamped
      // UNCONDITIONALLY in this same transition — the order leaves its station queue (§3e). NON-FISCAL
      // (a settle files nothing).
      await tx
        .update(workingOrders)
        .set({
          status: "settled",
          settledAt: settledAt.toISOString(),
          collectedAt: settledAt.toISOString(),
        })
        .where(eq(workingOrders.id, req.id));

      return {
        outcome: "captured",
        ticket: await readSettledTicket(deps.backend, tx, cfg, req.id),
      };
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Map a provider result onto an {@link IntegratedPayOutcome} — a PURE function (unit-tested in
 * `till-sale-integrated.test.ts`, which needs no container, CLAUDE.md §4). `captured` and
 * `accepted_offline` both chained a sale (their `settledAt` is set), so both map to the `captured` arm
 * carrying the ticket the caller filed; `network_unavailable` maps to its own arm (nothing filed);
 * every other non-terminal state — today just `failed`, which `provider.ts`'s `drive` uses for BOTH a
 * decline and a poll-window stall — maps to `declined`. The `timeout` arm stays reserved for when a
 * provider learns to tell those two apart; the till renders both the same today.
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
  return { outcome: "declined" };
}

/**
 * Collect and finalise a PLACED order (prepare & collect, sub-project 7c) — the COLLECT half of the
 * mode dispatch, dispatching on the location's `order_flow` (design §3's state-machine table). All in
 * one `withTenant`/`asAppUser` transaction:
 *  - `invoice_first` (Mode I): the invoice was ALREADY issued (deferred) at placing, so collect
 *    SETTLES the existing sale (`settleSale`) and moves `placed → settled`. It files NO second fiscal
 *    record — a double-file would be an unrepairable defect (§5). A `card` tender ALSO writes the
 *    captured manual-card `payments` ledger row (the #62 side-write), so an invoice-first card collect
 *    is symmetric with the immediate card paths and auditable by reconciliation; cash writes none.
 *  - `ticket_then_pay` (Mode T): no fiscal doc exists yet, so collect FILES `recordSale` immediate
 *    from the order's stored locked lines and moves `placed → settled` (the shared `fileImmediateSale`).
 *
 * Idempotency, both modes, WITHOUT a 23505 backstop: unlike `payWorkingOrder`'s walk-up shape (no row
 * to lock), a collected order ALWAYS exists (it was placed), so the `SELECT … FOR UPDATE` fully
 * serialises a concurrent collect — the loser blocks, then re-reads the row as `settled` and REPLAYS
 * the ticket (filing/settling nothing). The `sales_working_order_id_key` and `sale_settlements` UNIQUE
 * constraints are the constraints underneath, but the lock means neither is ever reached concurrently.
 *
 * A non-`placed`, non-`settled` order (still `open`, already `abandoned`, or absent / another tenant's,
 * RLS-hidden) fails closed with `working_order.not_placed` — collect is a placed-order operation. The
 * tender guard mirrors `payWorkingOrder`'s: cash or manual card only.
 *
 * `req.lines` is IGNORED (a placed order files its frozen stored composition); it is on
 * `PayWorkingOrderRequest` only to share the shape. `operatorId` is the collecting operator.
 */
export async function collectOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  req: PayWorkingOrderRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Lock the order for the life of the tx and read its status off the locked copy. A concurrent
      // collect blocks here and re-reads `settled` below (the idempotency serialisation).
      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, req.id))
        .for("update");

      // Already settled → idempotent replay: a retry whose first response was lost, or the loser of a
      // concurrent collect that blocked on the lock above and now sees it settled. Files nothing.
      if (locked?.status === "settled") {
        return readSettledTicket(deps.backend, tx, cfg, req.id);
      }

      // Only a placed order may be collected — an `open` (never placed), `abandoned`, absent or
      // RLS-hidden order fails closed. `not_placed` (not `not_open`): collect is the placed→settled
      // operation, and calling it on an open order is a state error about placing, not opening.
      if (locked === undefined || locked.status !== "placed") {
        throw new AppError("working_order.not_placed", { workingOrderId: req.id });
      }

      // Tender guard — a network boundary, cash (7a) and manual card only, the same guard
      // `payWorkingOrder` makes. AFTER the replay check, so a retry is never refused for its body shape.
      if (req.tender.method !== "cash" && req.tender.method !== "card") {
        throw new AppError("sale.unsupported_tender", { method: req.tender.method });
      }

      if (cfg.orderFlow === "invoice_first") {
        // Mode I: the invoice already issued (deferred) at placing. Settle the EXISTING sale and move
        // placed → settled — file nothing new. `settlementFor` derives the settle amount + change over
        // the already-filed total (a covered cash tender settles at the total and hands back change; a
        // short one is passed through raw so `settleSale` raises `sale.tender_shortfall`).
        const [sale] = await tx
          .select({ id: sales.id, total: sales.total })
          .from(sales)
          .where(and(eq(sales.tenantId, cfg.tenantId), eq(sales.workingOrderId, req.id)));
        /* v8 ignore start */
        if (sale === undefined) {
          // Structurally unreachable: an invoice-first order reaches `placed` only via `placeOrder`,
          // which filed the deferred sale in the same transaction that placed it. A placed invoice-first
          // order with no sale is corruption, not a reachable flow.
          throw new Error(`collectOrder: placed invoice-first order ${req.id} has no sale`);
        }
        /* v8 ignore stop */

        const { settledAmount, change } = settlementFor(req.tender, sale.total);
        const settledAt = deps.clock.now().instant;

        await settleSale(tx, {
          tenantId: cfg.tenantId,
          saleId: brandSaleId(sale.id),
          tenders: [
            { method: req.tender.method, amount: settledAmount, tipAmount: "0.00", settledAt },
          ],
        });

        // Card ONLY: a manual-card tender at collect records the captured `payments` ledger row and links
        // it to the just-settled sale, in THIS same transaction — the identical #62 side-write
        // `fileImmediateSale` makes for an immediate card sale, so an invoice-first card collect is
        // symmetric with every other card path and visible to reconciliation (`reconcile.ts`) rather than
        // an unauditable settlement. The FISCAL settlement stays `settleSale` above (unchanged); this only
        // adds the ledger row alongside. Cash gets none — cash is a tender only. The card charges the
        // EXACT invoice total (`sale.total`, the amount `settlementFor` settled at), and `settledAt` is the
        // SAME reading the tender carries. `recordManualCardPayment` makes no network call, so it commits
        // inline with the settlement.
        if (req.tender.method === "card") {
          const { provider, paymentRef } = await recordManualCardPayment(tx, {
            tenantId: cfg.tenantId,
            workingOrderId: req.id,
            amount: decimal(sale.total),
            settledAt,
            externalRef: req.tender.externalRef,
          });
          await associatePaymentWithSale(tx, {
            provider,
            paymentRef,
            saleId: brandSaleId(sale.id),
            tenantId: cfg.tenantId,
          });
        }

        await tx
          .update(workingOrders)
          // `collected_at` is the ORDER-level customer-handover marker (KDS-1 §3e): a counter order
          // fired to a station leaves that station's queue (`listStationQueue` excludes
          // `collected_at IS NOT NULL`) once collected. It is stamped in THIS same placed → settled
          // UPDATE — a later UPDATE on the settled row would be a settled → settled edit, which
          // `working_orders_enforce_transition` rejects (0030_prepare_collect.sql). Same instant as
          // `settled_at` (the collect's own clock reading). NON-FISCAL: the alta path never reads it,
          // and the H2 huella-identity test pins two records differing only in it hash identically.
          .set({
            status: "settled",
            settledAt: settledAt.toISOString(),
            collectedAt: settledAt.toISOString(),
          })
          .where(eq(workingOrders.id, req.id));

        // Read the ticket back from the just-settled invoice, carrying the real cash-back (a FRESH
        // collect, not a replay, so not the "0.00" default).
        return readSettledTicket(deps.backend, tx, cfg, req.id, change);
      }

      // Mode T (ticket_then_pay): no fiscal doc yet — file `recordSale` IMMEDIATE at collect from the
      // order's stored locked lines and move placed → settled (the shared filing path). `markCollected`
      // = true stamps `collected_at` in that same settle UPDATE (this IS a collect), dropping the order
      // from its station queue; the fiscal filing itself is byte-identical to a walk-up's.
      const priced = await priceStoredOrder(tx, req.id);
      return fileImmediateSale(tx, deps, cfg, req.id, req.tender, priced, operatorId, true);
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Ring one walk-up sale — the 7a entry point, now a thin walk-up special case of `payWorkingOrder`.
 * It keeps 7a's two fail-fast guards and its `TillSaleRequest`/`TillSaleResult` shape, and delegates.
 *
 * The working-order id it pays under is `req.workingOrderId` when the till supplied one, else a fresh
 * `randomUUID()` minted here. Either keys the same idempotency guard: `payWorkingOrder` creates the
 * `working_orders` row OPEN and settles it in one transaction, and a lost-response retry that re-sent
 * this id REPLAYS rather than filing a second chained record. A till holding a stable id across
 * retries gets that protection; a till that sends none simply never retries onto the same id. (This
 * is also how a PARKED order is paid: the till sends the parked order's id, so the settle lands on the
 * retrieved order — created above by `parkOrder` — rather than a fresh walk-up one.)
 *
 * `operatorId` is the person who rang the sale, for attribution — supplied by the session (Task 5);
 * a parameter here, `undefined` until the till wires it in.
 */
export async function recordTillSale(
  deps: TillSaleDeps,
  cfg: TillConfig,
  req: TillSaleRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  // Both refusals are made before any database work (and before minting an id): an empty basket has
  // nothing to price, and the counter POS supports cash (7a) and a manual card tender (this slice)
  // only. A `tender.method` narrowed to `"cash" | "card"` at the type level can still arrive as
  // anything at runtime (the till is a network boundary), so the guard is real. `payWorkingOrder`
  // re-asserts both on its filing path — it is a shared entry point Task 8 also calls directly — so
  // these are a cheap early-out, not the only check.
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
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
      // A counter delivery: threaded to the walk-up create path (design §3c). Absent → a plain walk-up.
      deliveryTableId: req.deliveryTableId,
    },
    operatorId,
  );
}
