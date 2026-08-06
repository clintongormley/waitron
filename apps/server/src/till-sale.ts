// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import { randomUUID } from "node:crypto";
import "./errors.js";
import { and, eq } from "drizzle-orm";
import {
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
import type { Database, Transaction } from "@waitron/db";
import { priceLockedLines } from "@waitron/catalogue";
import type { PricedLines } from "@waitron/catalogue";
import { associatePaymentWithSale, recordManualCardPayment } from "@waitron/payments";
import { formatInvoiceNumber, recordSale, settleSale } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { createOpenOrder, readLockedLines } from "./working-order.js";
import type { TillConfig } from "./till-config.js";

export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
}

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
}

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
    return await withTenant(deps.db, cfg.tenantId, async (tx) => {
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
        ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null));
      } else {
        // Retrieved order: file from the STORED locked lines via the shared `readLockedLines` reader,
        // never a re-price of a client basket (`req.lines` is IGNORED). `priceLockedLines` runs the
        // SAME difference-method arithmetic over the locked gross that `priceBasket` runs over a live
        // catalogue, so a catalogue price change between park and pay never moves the filed total.
        priced = priceLockedLines(await readLockedLines(tx, req.id));
      }

      // File the immediate cash/card sale and settle it (open → settled), tagged with this order's id
      // — the shared filing path Mode-T collect reuses (`fileImmediateSale`).
      return fileImmediateSale(tx, deps, cfg, req.id, req.tender, priced, operatorId);
    });
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
  // via the SAME `priceLockedLines` the file used — byte-identical to what was filed for both a
  // walk-up (`createOpenOrder` stored the priced lock) and a retrieved/placed order. Read straight
  // back rather than recomputed from `sale_lines` (which stores the NET base, so recovering the gross
  // would drift by a cent), so the replayed receipt's line list matches the invoice exactly.
  const ticketLines = ticketLinesFrom(priceLockedLines(await readLockedLines(tx, workingOrderId)));

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
    vatBreakdown: filed.vatBreakdown.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax })),
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
 */
async function fileImmediateSale(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TillConfig,
  workingOrderId: string,
  tender: TillTender,
  priced: PricedLines,
  operatorId?: string,
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
  // the SAME instant the tender carries.
  await tx
    .update(workingOrders)
    .set({ status: "settled", settledAt: settledAt.toISOString() })
    .where(eq(workingOrders.id, workingOrderId));

  // `FiscalRecordRef` exposes no series code or invoice number (it is regime-opaque), so the
  // human-facing "A/1" is read back from the sale row and its series, in this same transaction.
  const [issued] = await tx
    .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));

  return {
    invoiceNumber: formatInvoiceNumber(issued!.code, issued!.number),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: priced.vatBreakdown.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax })),
    // The FILED line list (art. 7.1.e) straight from the price just filed, so the receipt's line list
    // is the invoiced composition rather than the client basket (Finding 2).
    lines: ticketLinesFrom(priced),
    change,
    qr: fiscal.verificationUrl ?? "",
  };
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
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
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
        .set({ status: "settled", settledAt: settledAt.toISOString() })
        .where(eq(workingOrders.id, req.id));

      // Read the ticket back from the just-settled invoice, carrying the real cash-back (a FRESH
      // collect, not a replay, so not the "0.00" default).
      return readSettledTicket(deps.backend, tx, cfg, req.id, change);
    }

    // Mode T (ticket_then_pay): no fiscal doc yet — file `recordSale` IMMEDIATE at collect from the
    // order's stored locked lines and move placed → settled (the shared filing path).
    const priced = priceLockedLines(await readLockedLines(tx, req.id));
    return fileImmediateSale(tx, deps, cfg, req.id, req.tender, priced, operatorId);
  });
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
    { id: req.workingOrderId ?? randomUUID(), lines: req.lines, tender: req.tender },
    operatorId,
  );
}
