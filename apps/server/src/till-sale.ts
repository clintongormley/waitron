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
import { listAvailableProducts, priceBasket } from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { createOpenOrder } from "./working-order.js";
import type { TillConfig } from "./till-config.js";

export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
}

/**
 * A walk-up sale as the counter till captures it: a basket of `{ productId, quantity }` and one cash
 * tender. Deliberately carries NO price of any kind — the server re-reads the catalogue and prices
 * authoritatively (`priceBasket`), so a browser cannot influence the filed total. `quantity` is a
 * count for an `each` product and a measured kg weight (e.g. "0.320") for a `weight` product.
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
  tender: { method: "cash"; amount: string };
  workingOrderId?: string;
}

export interface TillSaleResult {
  /** `NumSerieFactura`-shaped "A/1", read back from the sale row + its series after filing. */
  invoiceNumber: string;
  /** The fiscal record's issuance instant, ISO-8601. */
  issuedAt: string;
  /** Taxable base + VAT, the authoritative figure the fiscal record carries. */
  total: string;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  /** Cash to hand back: `tendered − total`, ≥ 0 (an under-tender is refused before this is read). */
  change: string;
  /** Where a customer can verify the record, or "" when the regime offers none. */
  qr: string;
}

/**
 * A pay-and-settle over a PERSISTED working order, keyed by its client-minted id — the idempotent
 * pay path shared by a walk-up (`recordTillSale`, which mints a fresh id) and a parked order (the
 * retrieve-and-pay route, Task 8). `id` is the idempotency key: the till holds it stable across a
 * lost-response retry, and `sales_working_order_id_key` makes at most one sale per working order.
 * Like `TillSaleRequest` it carries NO price of any kind — the server re-reads the catalogue and
 * re-prices the SENT basket authoritatively at pay time (never the browser's price, never the stored
 * draft snapshot).
 */
export interface PayWorkingOrderRequest {
  id: string;
  lines: { productId: string; quantity: string }[];
  tender: { method: "cash"; amount: string };
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
 *  4. Does not exist → WALK-UP: create it `open` with its priced lines (`createOpenOrder`, the same
 *     helper `parkOrder` uses), then settle below.
 *  5. `open` (or just created) → re-price the sent basket, file with `recordSale`'s immediate cash
 *     settlement tagged with `working_order_id = req.id`, then UPDATE the order `open → settled`.
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

      // Guards, before anything is filed — a network boundary (the till is untrusted): an empty
      // basket has nothing to price, and this slice is cash-only. AFTER the replay check, so a retry
      // of an already-settled order is never refused for the shape of its retry body.
      if (req.lines.length === 0) {
        throw new AppError("sale.empty_basket", {});
      }
      if (req.tender.method !== "cash") {
        throw new AppError("sale.unsupported_tender", { method: req.tender.method });
      }

      // Steps 4-5. Obtain the authoritative price of the SENT basket, one way per shape, so it is
      // computed exactly ONCE either way:
      //  - WALK-UP (order does not exist yet): create it OPEN with its priced lines (the same
      //    `createOpenOrder` `parkOrder` uses, so a walk-up order is identical in shape to a parked
      //    one) and REUSE the price that creation already derived — `createOpenOrder` read the
      //    catalogue and ran `priceBasket` to build the line rows, so re-reading and re-pricing the
      //    identical `req.lines` here would just double the catalogue join on the till's hottest path.
      //    A walk-up carries no label.
      //  - RETRIEVED order (already exists): `createOpenOrder` is NOT called, so re-price the SENT
      //    basket from the catalogue here — a parked order is always re-priced at CURRENT prices at pay
      //    time, never from its stored draft snapshot.
      // The result is then filed with recordSale's immediate cash settlement, tagged with this order's
      // id (`sales_working_order_id_key` = the idempotency key).
      let priced: ReturnType<typeof priceBasket>;
      if (locked === undefined) {
        ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null));
      } else {
        const available = await listAvailableProducts(tx, cfg.locationId);
        const byId = new Map(available.map((p) => [p.id, p]));
        const items = req.lines.map((line) => {
          const product = byId.get(line.productId);
          if (product === undefined) {
            throw new AppError("sale.unknown_product", { productId: line.productId });
          }
          return { product, quantity: line.quantity };
        });

        priced = priceBasket(items);
      }

      // Cash may exceed the total (change is handed back); a tender BELOW the total is a shortfall.
      // `settleSale` (which `recordSale`'s immediate mode calls) demands EXACT coverage —
      // `sum(amount) = total` — so the tender it records settles the sale at the total, never at the
      // cash handed over: change is drawer cash, not a settled amount. When the cash falls short we
      // instead hand the raw amount straight through, so that single settlement implementation raises
      // `sale.tender_shortfall` itself — with the real `saleId` its param carries — and the whole
      // transaction rolls back (the just-created walk-up order included).
      const covered = compareDecimal(decimal(req.tender.amount), priced.total) >= 0;
      const settledAmount = covered ? priced.total : req.tender.amount;

      // One clock reading for the settlement instant, shared by the tender and the order's
      // `settled_at` so both name the same moment. recordSale reads its own clock for the sale's
      // `issued_at` (a separate reading, exactly as the 7a path did).
      const settledAt = deps.clock.now().instant;

      const { saleId, fiscal } = await recordSale(tx, deps.backend, {
        tenantId: cfg.tenantId,
        tillId: cfg.tillId,
        nodeId: cfg.nodeId,
        seriesId: cfg.seriesId,
        // The persisted working order this sale is filed from — created just above for a walk-up, or
        // the retrieved parked order. It is the sale-idempotency key: a second pay for the same id
        // collides on `sales_working_order_id_key` (23505) and replays rather than filing again.
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
          tenders: [{ method: "cash", amount: settledAmount, tipAmount: "0.00", settledAt }],
        },
      });

      // Terminal transition `open → settled`. `working_orders_enforce_transition` validates OLD.status
      // = 'open'; the `settled_at` biconditional requires the timestamp be set — the SAME instant the
      // tender carries.
      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: settledAt.toISOString() })
        .where(eq(workingOrders.id, req.id));

      // Only reached once `recordSale` filed the sale — so the tender covered the total and this is ≥ 0.
      const change = subtractDecimal(decimal(req.tender.amount), priced.total);

      // `FiscalRecordRef` exposes no series code or invoice number (it is regime-opaque — see
      // `packages/fiscal/src/backend.ts`), so the human-facing "A/1" is read back from the sale row
      // and its series, in this same transaction. `recordSale` guarantees exactly one such row for
      // `saleId`, so the row is always present.
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
        change,
        qr: fiscal.verificationUrl ?? "",
      };
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
 * Reconstruct a settled working order's ticket for an idempotent replay — filing NOTHING.
 * `invoiceNumber`, `issuedAt` and `total` are exact (the immutable `sales` row + its series); `qr` and
 * `vatBreakdown` are read back from the ALREADY-FILED fiscal record via `backend.filedReceiptFor`, so
 * the reprinted ticket carries the regime's mandatory verification QR and the EXACT filed
 * difference-method desglose (Task 14) rather than a QR-less, recomputed breakdown that could diverge
 * by a cent from what was filed.
 *
 * One field is deliberately NOT the original, a documented limitation of replaying without re-filing:
 *  - `change` is "0.00": the cash actually tendered is not persisted (only the settled amount, which
 *    equals the total, is), and the drawer change was handed over at the ORIGINAL sale — a replay
 *    re-prints the ticket and hands over nothing.
 */
async function readSettledTicket(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
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
    change: "0.00",
    qr: filed.verificationUrl,
  };
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
  // nothing to price, and slice 1 of the counter POS is cash-only. A `tender.method` narrowed to
  // `"cash"` at the type level can still arrive as anything at runtime (the till is a network
  // boundary), so the guard is real. `payWorkingOrder` re-asserts both on its filing path — it is a
  // shared entry point Task 8 also calls directly — so these are a cheap early-out, not the only check.
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  if (req.tender.method !== "cash") {
    throw new AppError("sale.unsupported_tender", { method: req.tender.method });
  }

  return payWorkingOrder(
    deps,
    cfg,
    { id: req.workingOrderId ?? randomUUID(), lines: req.lines, tender: req.tender },
    operatorId,
  );
}
