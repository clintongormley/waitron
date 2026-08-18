// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-sale.ts`/`till-config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { AppError, type SaleId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import {
  allocateOrderNumber,
  appendOrderAmendment,
  asAppUser,
  diningTables,
  invoiceSeries,
  isUniqueViolation,
  orderPrep,
  prepState,
  sales,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { listAvailableProducts, priceBasket, priceLockedLines } from "@waitron/catalogue";
import type { LockedLine, PricedLines } from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TillConfig } from "./till-config.js";

export interface WorkingOrderDeps {
  db: Database;
}

/**
 * The fuller till dependency bundle — `db` plus the `backend`/`clock` a FISCAL FILE needs. `placeOrder`
 * (Mode-I deferred invoice) and `cancelPlacedOrder` (the amendment's trusted clock) take it here, and
 * every `till-sale.ts` filing path (`payWorkingOrder`, `collectOrder`, `fileImmediateSale`,
 * `recordTillSale`) takes it too. It lives in this lower-level module — beside {@link WorkingOrderDeps},
 * the `db`-only subset for the non-filing operations (park, list, retrieve, update, abandon, advance) —
 * so `till-sale.ts` imports it from here, keeping the module dependency ONE-directional (no import cycle).
 */
export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
}

/** The rows a park or an update writes into `working_order_lines`, as Drizzle types the insert. */
type WorkingOrderLineInsert = typeof workingOrderLines.$inferInsert;

/** `priceBasket`'s authoritative result (`{ lines, total, vatBreakdown }`) — threaded out of
 * `priceOrderLines`/`createOpenOrder` so a caller that both persists the order AND files its sale in
 * the same transaction (a walk-up, `payWorkingOrder`) reuses this price rather than re-reading the
 * catalogue and re-pricing the identical basket a second time. */
type PricedBasket = ReturnType<typeof priceBasket>;

/**
 * Re-read THIS location's sellable catalogue, resolve every requested line against it, and price the
 * basket authoritatively with `priceBasket` — returning BOTH the ready-to-insert `working_order_lines`
 * rows for `workingOrderId` AND the raw `priceBasket` result (`{ lines, total, vatBreakdown }`) they
 * were derived from. The second half is what lets a caller that will also FILE the sale from the same
 * basket (a walk-up, via `createOpenOrder` → `payWorkingOrder`) reuse this one price rather than
 * re-reading the catalogue and re-pricing the identical `lines` a second time. Shared by `parkOrder`
 * (a fresh order) and `updateHeldOrder` (a repriced one), which use only `lineRows`: the server never
 * trusts a browser-computed price, so the caller's `lines` carry none, and a product not sellable here
 * (deactivated, unassigned, or another tenant's, which RLS hides) is refused with the same
 * `sale.unknown_product` `recordTillSale` uses — a fact about the order, not the process. Runs on the
 * CALLER's transaction under its tenant/app_user scope.
 *
 * The empty-basket refusal and the order row itself stay with each caller: park mints and inserts an
 * OPEN order (allocating its number), update rewrites an existing one's lines and label — this helper
 * owns only the lines, which are identical between the two. `priced.lines` is in `lines` order
 * (priceBasket iterates in order and stamps `lineNo = i + 1`), so row `i` takes its `product_id` from
 * `lines[i]`; the display columns (`descriptions`, `unit_price`, `category`) are the snapshot
 * priceBasket produced, while `unit_price_gross` is the AUTHORITATIVE gross unit LOCKED at add-time —
 * the input a retrieved order is later filed from without a re-price (see that column's comment below).
 */
async function priceOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  lines: { productId: string; quantity: string }[],
): Promise<{ lineRows: WorkingOrderLineInsert[]; priced: PricedBasket }> {
  const available = await listAvailableProducts(tx, cfg.locationId);
  const byId = new Map(available.map((p) => [p.id, p]));
  const items = lines.map((line) => {
    const product = byId.get(line.productId);
    if (product === undefined) {
      throw new AppError("sale.unknown_product", { productId: line.productId });
    }
    return { product, quantity: line.quantity };
  });

  const priced = priceBasket(items);
  const lineRows = priced.lines.map((line, i) => ({
    tenantId: cfg.tenantId,
    workingOrderId,
    lineNo: line.lineNo,
    productId: lines[i]!.productId,
    descriptions: line.descriptions,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    // The GROSS (VAT-inclusive) UNIT price LOCKED at add-time (line-add snapshot, 7c) — the
    // AUTHORITATIVE input a retrieved order is FILED from without a re-price (`priceLockedLines`,
    // @waitron/catalogue reads this straight back as its `grossUnitPrice`). `unit_price` above is the
    // NET unit, informational only; this is the gross the line was priced from, so a later catalogue
    // price change never moves the filed total. Stored from `priceBasket`'s `grossUnitPrices` — the
    // per-UNIT gross at MONEY_SCALE, the exact figure `priceLockedLines` recomputes from — never
    // `line_total ÷ quantity`, which is exact for `each` but DRIFTS for a weighed line. This is a
    // durable lock, not a display cache.
    unitPriceGross: priced.grossUnitPrices[i]!,
    vatRate: line.vatRate,
    // The DRAFT line stores the GROSS (VAT-inclusive) line total, not `line.lineTotal`'s net base:
    // `working_order_lines` is the counter's mutable display, and every other total the operator/
    // customer sees is gross (the basket grand total, the per-line gross, the filed ticket), so the
    // held-orders list `sum(line_total)` must be gross too. This deliberately DIVERGES from the FILED
    // `sale_lines.line_total`, which keeps `line.lineTotal`'s net base for the fiscal record. The
    // FILED line of a retrieved order now derives from the locked `unit_price_gross` unit above via
    // `priceLockedLines`, NOT from `priced.lines`; a freshly-created walk-up still files from
    // `priced.lines`. See `working_order_lines.line_total`'s schema comment and `priceBasket`'s
    // `grossLineTotals`/`grossUnitPrices`.
    lineTotal: priced.grossLineTotals[i]!,
    category: line.category ?? null,
  }));
  return { lineRows, priced };
}

/**
 * Read a persisted order's STORED lines in `line_no` order — exactly the columns `priceLockedLines`
 * needs (gross unit, quantity, rate, descriptions, category), each snapshotted at add-time. THE ONE
 * reader shared by `payWorkingOrder` (a retrieved order), `placeOrder` (Mode-I's deferred file at
 * placing) and `collectOrder` (Mode-T's immediate file at collect), so all three file a persisted
 * order from the SAME locked composition and a catalogue price change after add never moves the filed
 * total (line-add snapshot, 7c).
 *
 * Throws on a lineless order: a persisted `open`/`placed` order always has ≥1 line (park refuses an
 * empty basket, `updateHeldOrder` never leaves it lineless, and placing freezes the composition), so
 * an empty result is corruption rather than a reachable flow — the same guard `payWorkingOrder` used
 * inline before this was extracted.
 */
export async function readLockedLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<LockedLine[]> {
  const stored = await tx
    .select({
      grossUnitPrice: workingOrderLines.unitPriceGross,
      quantity: workingOrderLines.quantity,
      vatRate: workingOrderLines.vatRate,
      descriptions: workingOrderLines.descriptions,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  /* v8 ignore start */
  if (stored.length === 0) {
    throw new Error(`readLockedLines: working order ${workingOrderId} has no lines to file`);
  }
  /* v8 ignore stop */
  return stored;
}

/**
 * Price a persisted order's STORED locked composition — `priceLockedLines` over {@link readLockedLines},
 * the one-liner every persisted-order file repeats (retrieved-order pay, Mode-I place, Mode-T collect,
 * and the settled-ticket read-back). `priceLockedLines` runs the SAME difference-method arithmetic over
 * the ADD-TIME locked gross (`unit_price_gross`) that `priceBasket` runs over a live catalogue, so a
 * catalogue price change after add never moves the filed total (line-add snapshot, 7c). Pure over
 * `readLockedLines`'s read; throws on a lineless order (see there).
 */
export async function priceStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<PricedLines> {
  return priceLockedLines(await readLockedLines(tx, workingOrderId));
}

/**
 * Read a filed sale's human-facing `NumSerieFactura` ("A/1") back from its `sales` row and series, in
 * the caller's transaction — the `FiscalRecordRef` is regime-opaque and carries neither, so both the
 * immediate-file (`fileImmediateSale`) and the Mode-I deferred place (`placeOrder`) read it back the
 * same way. `recordSale` guarantees exactly one `sales` row for the id, so the single-row read always
 * resolves (the non-null assertion holds for the same reason both call sites' did).
 */
export async function readInvoiceNumber(tx: Transaction, saleId: SaleId): Promise<string> {
  const [issued] = await tx
    .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  return formatInvoiceNumber(issued!.code, issued!.number);
}

/**
 * Project a VAT desglose onto the ticket's `{ rate, base, tax }` shape — the one place the three result
 * builders express it: `placeOrder` here (Mode-I place), and `till-sale.ts`'s `readSettledTicket` (over a
 * FILED record's bands) and `fileImmediateSale` (over a freshly-`priced` basket). A pure per-band field
 * copy; the surcharge fields a `VatBreakdownLine` may also carry are deliberately dropped, exactly as
 * each inline `.map` did — the counter ticket carries base/tax only. Lives here (not in `till-sale.ts`)
 * so `till-sale.ts` imports it one-directionally, no cycle.
 */
export function toVatBreakdown(
  bands: readonly { rate: string; base: string; tax: string }[],
): { rate: string; base: string; tax: string }[] {
  return bands.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax }));
}

/**
 * A working order the counter parks to retrieve and pay later (park & retrieve, sub-project 7b). Like
 * `TillSaleRequest`, it carries NO price of any kind — the server re-reads the catalogue and prices
 * authoritatively (`priceBasket`), so a browser cannot influence the snapshot the draft carries.
 *
 * `id` is client-supplied: the till mints the working-order uuid and holds it stable across a retry.
 * That prevents a SECOND parked order — a re-sent park PK-COLLIDES on `working_orders.id` and the
 * whole transaction rolls back (a raw 23505 that `till-api.ts`'s `run` catch turns into an opaque
 * 500, since park adds no `onConflict`), so at most one order is ever parked for the id. It is NOT an
 * idempotent replay: park does not recognise the existing row and return it, it simply fails on the
 * collision. Idempotent REPLAY belongs to PAY (`payWorkingOrder`), which recognises an already-settled
 * order and re-returns its result rather than filing a second chained record. `quantity` is a count
 * for an `each` product and a measured kg weight for a `weight` product.
 *
 * `operatorId` is the person who parked the order, for later attribution. It is accepted here for the
 * caller's convenience and forward-compatibility with the session wiring (Task 5) but is NOT persisted
 * in this slice: `working_orders` carries no operator column yet, so there is nowhere to write it.
 */
export interface ParkOrderRequest {
  id: string;
  lines: { productId: string; quantity: string }[];
  label?: string;
  operatorId?: string;
}

export interface ParkOrderResult {
  id: string;
  orderNumber: number;
}

/**
 * Persist an OPEN working order plus its priced lines on the CALLER's transaction: re-read the
 * catalogue, re-price `lines` with `priceBasket`, allocate the next per-node order number, and INSERT
 * the `working_orders` row (status `open`) and its `working_order_lines`. Returns the allocated order
 * number AND the authoritative `priceBasket` result its lines were priced from — so `payWorkingOrder`'s
 * walk-up path files the sale from the SAME price this creation computed, never a second catalogue
 * read of the identical basket. The server never trusts a browser-computed price; `lines` carry none.
 *
 * Shared by `parkOrder` (a counter parks an order to pay later, which uses only `orderNumber`) and
 * `payWorkingOrder` (a WALK-UP, which creates the order `open` and settles it in the same transaction,
 * reusing `priced`) — extracted so a walk-up order is IDENTICAL in shape to a parked one: same
 * allocated number, same priced lines, same triggers (`require_open_parent`/`check_locales` fire on
 * the inserted lines because their parent was inserted just above). The empty-basket refusal stays
 * with each caller (it is checked before any database work), as does the surrounding
 * `withTenant`/`asAppUser` scope; this helper owns only the two inserts.
 */
export async function createOpenOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  lines: { productId: string; quantity: string }[],
  label: string | null,
  // A counter delivery sets `deliveryTableId` (design §2b/§3c). Defaults to {}, so parkOrder, openTab
  // and payWorkingOrder's walk-up path are unchanged (they omit it → a plain walk-up, column NULL). A
  // TAB does NOT flow through here — its link is the `dining_tables.tab_id` back-pointer openTab sets,
  // not an order column, so openTab passes no placement and this never stamps a delivery table on it.
  placement: { deliveryTableId?: string | null } = {},
): Promise<{ orderNumber: number; priced: PricedBasket }> {
  // A counter delivery names the dining table it is carried to. Verify it exists FIRST — the SELECT
  // runs as `app_user` under the caller's tenant scope, so an absent id AND another tenant's table (RLS
  // hides it) both read as absent — so a bad id surfaces the domain `table.not_found` (a 4xx) rather
  // than the raw `working_orders_delivery_table_fk` violation (23503) the insert would otherwise raise,
  // which `payWorkingOrder`'s `isUniqueViolation`-only catch re-throws to an opaque `server.internal`
  // 500. The FK stays the DB backstop; this is the actionable app check, exactly as `openTab` guards
  // its own tableId with the same code. A walk-up/park/tab passes no `deliveryTableId`, so this never
  // fires for them. Tables are deactivated, never deleted (`deactivateTable`), so this cannot race a
  // delete between the check and the insert below.
  const deliveryTableId = placement.deliveryTableId ?? null;
  if (deliveryTableId !== null) {
    const [table] = await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(eq(diningTables.id, deliveryTableId));
    if (table === undefined) {
      throw new AppError("table.not_found", { tableId: deliveryTableId });
    }
  }

  // Resolve + price the basket authoritatively (refusing an unknown product) into the line rows,
  // keeping the raw price so the caller need not re-derive it — `priceOrderLines`'s own doc-comment
  // explains the zip and why `priced` is threaded back out.
  const { lineRows, priced } = await priceOrderLines(tx, cfg, id, lines);
  const orderNumber = await allocateOrderNumber(tx, cfg.tenantId, cfg.nodeId);

  await tx.insert(workingOrders).values({
    id,
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    orderNumber,
    label,
    status: "open",
    // Set ⇒ this counter order is DELIVERED to that table (metadata on the commercial row, NOT a
    // fiscal field — the alta path never reads it, proven by the H2 huella-identity test). NULL for a
    // walk-up/park/tab. The FK is enforced above by the app pre-check and by the DB as the backstop.
    deliveryTableId,
  });

  // The parent order was inserted just above, so the composite FK and the
  // `require_open_parent`/`check_locales` triggers all resolve it. Guarded: an EMPTY tab (openTab with
  // no initial round) has no lines to insert, and `tx.insert(...).values([])` errors. Existing callers
  // always pass ≥1 line (they guard empty baskets before calling), so this never changes their path.
  if (lineRows.length > 0) {
    await tx.insert(workingOrderLines).values(lineRows);
  }

  return { orderNumber, priced };
}

/**
 * Park a working order: re-read the catalogue, re-price with `priceBasket`, allocate the next per-node
 * order number, and persist an OPEN `working_orders` row plus its priced `working_order_lines` — all
 * inside ONE `withTenant`/`asAppUser` transaction, so the order and every line commit as a single unit
 * (or roll back together, leaving nothing parked). The server never trusts a browser-computed price;
 * `req` carries none. The persisted line keeps `product_id` (a pricing INPUT a later repricing
 * re-resolves) alongside the frozen display snapshot (`descriptions`, `unit_price`, `vat_rate`,
 * `category`) from `priceBasket`, plus its GROSS `line_total` (`priceBasket`'s `grossLineTotals`, not
 * the net base the fiscal line carries — see `priceOrderLines`). The persist itself is
 * `createOpenOrder`, shared verbatim with `payWorkingOrder`'s walk-up path.
 */
export async function parkOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  req: ParkOrderRequest,
): Promise<ParkOrderResult> {
  // Refused before any database work: an empty basket has nothing to price and no order to open. The
  // same guard `recordTillSale` makes, and the `lines` array is a network boundary, so it is real.
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }

  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);
      // Park needs only the allocated number; `priced` is `payWorkingOrder`'s walk-up shortcut, unused here.
      const { orderNumber } = await createOpenOrder(tx, cfg, req.id, req.lines, req.label ?? null);
      return { id: req.id, orderNumber };
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Open the running tab on a table (design §3a). Takes the `dining_tables` row `FOR UPDATE` — THIS
 * per-table lock is the one-open-tab-per-table concurrency guard: there is NO partial-unique now (a
 * single nullable `tab_id` gives one-tab-per-table structurally), so the lock is what serialises the
 * check-then-set. A second concurrent openTab on the same table blocks on this lock until the first
 * commits, then reads the now-set `tab_id`, finds it points at an OPEN order, and is refused
 * `tab.already_open` (proven by deletion of the lock — §7). A STALE `tab_id` (pointing at a
 * settled/abandoned order) reads as free and is OVERWRITTEN, so the fiscal pay path needs no settle-time
 * write (design §2b).
 *
 * Then creates an `open` working order (reusing `createOpenOrder`, incl. the per-node order-number
 * allocation) and points the table's `tab_id` at it. The order carries NO tab column — the link is this
 * back-pointer. `lines?` opens the tab with an initial round; absent, the tab opens empty. Runs on the
 * CALLER's transaction under its tenant/app_user scope. `table.not_found`/`table.inactive` guard the
 * table itself.
 */
export async function openTab(
  tx: Transaction,
  cfg: TillConfig,
  req: { tableId: string; lines?: { productId: string; quantity: string }[] },
): Promise<{ tabId: string; orderNumber: number }> {
  const [table] = await tx
    .select({ active: diningTables.active, tabId: diningTables.tabId })
    .from(diningTables)
    .where(eq(diningTables.id, req.tableId))
    .for("update");
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId: req.tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId: req.tableId });
  }

  // A set tab_id blocks a second tab ONLY while it points at a STILL-OPEN order; the WHERE clause does
  // the filtering, so a stale pointer (at a settled order) simply returns no row and is overwritten below.
  if (table.tabId !== null) {
    const [openTabRow] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (openTabRow !== undefined) {
      throw new AppError("tab.already_open", { tableId: req.tableId });
    }
  }

  const tabId = randomUUID();
  const { orderNumber } = await createOpenOrder(tx, cfg, tabId, req.lines ?? [], null);
  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, req.tableId));
  return { tabId, orderNumber };
}

/**
 * Lock an OPEN tab's working-order row `FOR UPDATE` and confirm a dining table points at it — the shared
 * guard `addTabRound` and `voidTabLine` open with. The lock is held on the caller's `tx` until commit,
 * so a `line_no` allocation or a line delete that follows is serialised against a concurrent round/void
 * (load-bearing for QR ordering — several guests appending to one tab at once). A tab is an OPEN working
 * order some `dining_tables.tab_id` points at (design §2b): a non-open order, one no table points at (a
 * walk-up / counter delivery), or an absent id (or another tenant's, RLS-hidden) all throw
 * `tab.not_open` — the fail-closed shape `working_order.not_open` uses for the modify side.
 */
async function lockOpenTab(tx: Transaction, tabId: string): Promise<void> {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId))
    .for("update");
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
  const [pointer] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(eq(diningTables.tabId, tabId));
  if (pointer === undefined) {
    throw new AppError("tab.not_open", { tabId });
  }
}

/**
 * APPEND a priced round to an OPEN tab (design §3b) — the one genuinely new order primitive. It locks
 * each new line's `unit_price_gross` at add-time (via `priceOrderLines`) and assigns the NEXT `line_no`,
 * WITHOUT deleting or re-pricing existing lines. Contrast `updateHeldOrder`, which deletes and re-inserts
 * the whole basket (`:633-634`), re-locking every line at the current catalogue price — wrong for an
 * incremental tab.
 *
 * Concurrency (load-bearing for QR ordering — multiple guests append to one shared tab at once): the tab
 * row is taken `FOR UPDATE` by {@link lockOpenTab}, which serialises concurrent writers to this tab on
 * the `working_orders` row lock, so the `max(line_no)+1` read-then-insert below cannot interleave. A
 * naïve `max(line_no)+1` without the lock races and collides on the `(working_order_id, line_no)` unique
 * (`orders.ts:192`) — a real-PG concurrent test proves it by deletion of the lock.
 */
export async function addTabRound(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lines: { productId: string; quantity: string }[],
): Promise<void> {
  await lockOpenTab(tx, tabId);
  if (lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // The next line_no, allocated under the per-tab row lock — concurrent rounds serialise on it, so no two
  // reads see the same max.
  const [{ maxLineNo }] = await tx
    .select({ maxLineNo: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  // Price the round (locks each new gross unit at add-time), then APPEND: renumber from maxLineNo+1,
  // never touching existing lines. `priceOrderLines` numbers its rows 1..n in `lines` order, so row i
  // maps to maxLineNo + i + 1.
  const { lineRows } = await priceOrderLines(tx, cfg, tabId, lines);
  const appended = lineRows.map((row, i) => ({ ...row, lineNo: maxLineNo + i + 1 }));
  await tx.insert(workingOrderLines).values(appended);
}

/**
 * Void ONE not-yet-paid line from an OPEN tab (design §3b) — pre-fiscal, so nothing is filed and there
 * is no fiscal record or amendment involved; it is a plain delete under the open parent (the
 * `require_open_parent` trigger is the DB backstop). {@link lockOpenTab} locks the tab row `FOR UPDATE`
 * so a concurrent round/pay cannot race the delete, and confirms it is an open tab. `tab.not_open` if the
 * order is not an open tab; `tab.line_not_found` if the `line_no` matches nothing on it. `_cfg` is unused
 * (the delete is by tab id + line no, RLS-scoped) but kept for the tab-verb signature shape the route
 * layer calls uniformly — underscore-prefixed so `noUnusedParameters` leaves it, the repo's convention
 * for an interface-shape parameter (`report-source.ts`'s `_tenantId`, `provider.ts`'s `_now`).
 */
export async function voidTabLine(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  const deleted = await tx
    .delete(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)))
    .returning({ lineNo: workingOrderLines.lineNo });
  if (deleted.length === 0) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
}

/** One row of the held-orders list the counter shows to retrieve a parked order. */
export interface HeldOrderSummary {
  id: string;
  orderNumber: number;
  /** The operator-supplied label ("Mesa 4"), or null when the order was parked without one. */
  label: string | null;
  /** Number of lines on the order (`count(lines)`, so 0 for a lineless order), a whole number. */
  itemCount: number;
  /**
   * Sum of the lines' `line_total`, which for a working-order DRAFT is the GROSS (VAT-inclusive)
   * customer-facing total — EQUAL to the basket grand total the operator saw (`priceBasket(...).total`).
   * A numeric(12,2) as text, the codebase's money shape. (The FILED `sale_lines.line_total` is net;
   * the draft deliberately diverges — see `working_order_lines.line_total`'s schema comment.)
   */
  total: string;
  openedAt: string;
}

/** A retrieved order: enough to name it in the UI plus the inputs to rebuild its basket. */
export interface HeldOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  /** `product_id` + `quantity` per line, in `line_no` order — the till re-adds each to the basket. */
  lines: { productId: string; quantity: string }[];
}

/**
 * The open working orders parked on THIS server's node (park & retrieve, sub-project 7b) — the
 * cross-till held list any register on the node shows. `total` is the summed `line_total` — the GROSS
 * (VAT-inclusive) draft total, equal to the basket total the operator saw — and `itemCount` the line
 * count, from a LEFT JOIN aggregate so an order with no lines would still list (`total` coalesced to
 * 0); ordered by the human `order_number` the counter types back in.
 *
 * Scoped by `status = 'open'` and `node_id = cfg.nodeId`; RLS already confines it to the tenant
 * (the read runs as `app_user` under `withTenant`, exactly as `parkOrder` writes). PGlite is enough
 * for THIS behaviour — the aggregate, the status/node filter and the ordering are plain SQL that a
 * single backend proves; the RLS cross-tenant isolation is Task 7's real-Postgres suite.
 */
export async function listHeldOrders(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
): Promise<HeldOrderSummary[]> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return (
      tx
        .select({
          id: workingOrders.id,
          orderNumber: workingOrders.orderNumber,
          label: workingOrders.label,
          itemCount: sql<number>`count(${workingOrderLines.id})::int`,
          total: sql<string>`coalesce(sum(${workingOrderLines.lineTotal}), 0)::numeric(12, 2)::text`,
          openedAt: workingOrders.openedAt,
        })
        .from(workingOrders)
        // Composite join predicate (tenant_id too, not order id alone): the same tenant-consistency the
        // schema's composite FKs enforce, so a line only aggregates onto an order of its own tenant.
        .leftJoin(
          workingOrderLines,
          and(
            eq(workingOrderLines.workingOrderId, workingOrders.id),
            eq(workingOrderLines.tenantId, workingOrders.tenantId),
          ),
        )
        .where(and(eq(workingOrders.status, "open"), eq(workingOrders.nodeId, cfg.nodeId)))
        .groupBy(
          workingOrders.id,
          workingOrders.orderNumber,
          workingOrders.label,
          workingOrders.openedAt,
        )
        .orderBy(workingOrders.orderNumber)
    );
  });
}

/**
 * One parked order's lines, to rebuild the basket on retrieve. Returns only each line's `product_id`
 * and `quantity` (the pricing INPUTS) in `line_no` order — the till re-reads the catalogue and
 * re-prices, never trusting a stored price, so the snapshot columns are deliberately not returned.
 *
 * Scoped to `status = 'open'` (RLS confines it to the tenant): an absent id, a `settled`/`abandoned`
 * order, or another tenant's order all surface the one `working_order.not_found` — see that code's
 * note. Deliberately NOT node-scoped, unlike `listHeldOrders`: a retrieve follows the node-scoped
 * list and addresses the order by its primary key, and RLS still holds it within the tenant.
 */
export async function getHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<HeldOrder> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    const [order] = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
      })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")));

    if (order === undefined) {
      throw new AppError("working_order.not_found", { workingOrderId: id });
    }

    const lines = await tx
      .select({
        productId: workingOrderLines.productId,
        quantity: workingOrderLines.quantity,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    return { id: order.id, orderNumber: order.orderNumber, label: order.label, lines };
  });
}

/**
 * An edit to a parked order: the whole new basket (`lines`) plus an optional new `label`. Like
 * `ParkOrderRequest` it carries NO price — the server re-reads the catalogue and re-prices with
 * `priceBasket`, so a browser cannot influence the snapshot. It carries no `id` (that addresses the
 * order, a separate argument) and no `order_number`/`node_id` (those are fixed at park and never move).
 * The basket is a full REPLACEMENT, not a delta: whatever the till sends becomes the order's lines.
 */
export interface UpdateHeldOrderRequest {
  lines: { productId: string; quantity: string }[];
  label?: string;
}

/**
 * Edit a parked order (park & retrieve, sub-project 7b): re-price `req.lines` authoritatively, REPLACE
 * the order's `working_order_lines` with the result, and update its `label` — all in ONE
 * `withTenant`/`asAppUser` transaction, so the delete + re-insert commit as a unit (or roll back
 * together, leaving the parked order exactly as it was). Only an `open` order may change; a
 * `settled`/`abandoned` order, an absent id, or another tenant's order (RLS hides it) all throw
 * `working_order.not_open`.
 *
 * The row is taken `for update` so a concurrent update/abandon/pay cannot race this read-modify-write
 * of its lines; the `status` is read off THAT locked row rather than added to the `WHERE`, so an
 * order that exists but is closed is told apart from one that never existed only inside the tx — both
 * still surface the one `working_order.not_open`, the fail-closed shape that code's note describes.
 * `order_number` and `node_id` are deliberately untouched.
 *
 * NOT node-scoped (`where id` alone), consistent with `getHeldOrder`: an edit follows a retrieve
 * which follows the node-scoped `listHeldOrders`, and RLS still confines the row to the tenant. If a
 * foreign-node id should ever fail closed, add `node_id = cfg.nodeId` here AND in `getHeldOrder`
 * together — the whole by-id family moves as one.
 *
 * PGlite is enough for THIS behaviour — the state machine (open-only), the FK/`require_open_parent`/
 * `check_locales` triggers on the replaced lines, and the `enforce_transition` trigger the label
 * update runs over — all hold on a single backend. RLS cross-tenant isolation and the `for update`
 * concurrency are Task 7's real-Postgres suite; the lock is still issued here exactly as production.
 */
export async function updateHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  req: UpdateHeldOrderRequest,
): Promise<void> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Lock the order row for the life of the tx, then read its status off the locked copy. Absent or
      // not-open → `working_order.not_open`; the DB triggers (enforce_transition on the label update,
      // require_open_parent on the line delete/insert) are the backstop if this app check is ever wrong.
      const [order] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id))
        .for("update");

      if (order === undefined || order.status !== "open") {
        throw new AppError("working_order.not_open", { workingOrderId: id });
      }

      // Refused before any line is touched: an empty basket has nothing to price, and rewriting an
      // order to zero lines is a discard, which is `abandonHeldOrder`'s job, not this one's. The same
      // guard `parkOrder`/`recordTillSale` make.
      if (req.lines.length === 0) {
        throw new AppError("sale.empty_basket", {});
      }

      // Price the new basket (refusing an unknown product) BEFORE deleting anything, so a bad line
      // aborts the tx with the parked order still intact. Then swap the lines wholesale: the parent is
      // open (checked above, held under the lock), so the line delete and the re-insert both satisfy
      // `require_open_parent`, and the re-numbered `line_no`s start from 1.
      // An edit only rewrites the persisted lines; `priced` is `payWorkingOrder`'s walk-up shortcut, unused here.
      const { lineRows } = await priceOrderLines(tx, cfg, id, req.lines);
      await tx.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id));
      await tx.insert(workingOrderLines).values(lineRows);

      // Runs over the `enforce_transition` trigger (OLD.status = 'open', so it passes). `req.label`
      // absent clears any prior label to NULL — the whole request is the new state, labels included.
      await tx
        .update(workingOrders)
        .set({ label: req.label ?? null })
        .where(eq(workingOrders.id, id));
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Discard a parked order (park & retrieve, sub-project 7b): `open → abandoned`, a terminal transition
 * the `working_orders_enforce_transition` trigger (0004) validates. A single conditional UPDATE —
 * `set status = 'abandoned' where id = … and status = 'open'` — so the open-only guard IS the write:
 * a `settled`/`abandoned` order, an absent id, or another tenant's order (RLS hides it) match no row,
 * and the empty `returning` throws `working_order.not_open`. No `settled_at` is set — abandoned is not
 * settled, and the `settled_at` biconditional (0004) requires it stay NULL.
 *
 * NOT node-scoped, for the reason `updateHeldOrder`/`getHeldOrder` give. PGlite proves this state
 * machine (the conditional update and the trigger); RLS isolation is Task 7's real-Postgres suite.
 */
export async function abandonHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      const updated = await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")))
        .returning({ id: workingOrders.id });

      if (updated.length === 0) {
        throw new AppError("working_order.not_open", { workingOrderId: id });
      }
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * The result of placing an order. In Task 7 (Mode T / generic placing) an order goes `open → placed`
 * and NO fiscal document is filed, so only `id` and `status: "placed"` are returned. The optional
 * fiscal fields are the shape Task 8's mode dispatch fills for the modes that DO file at placing:
 * Mode P (prepay) pays + issues → `settled`, and Mode I (invoice-first) issues the deferred invoice.
 * Kept on this interface now so the placing surface does not change shape when those modes land.
 */
export interface PlaceOrderResult {
  id: string;
  status: "placed" | "settled";
  invoiceNumber?: string;
  issuedAt?: string;
  total?: string;
  qr?: string;
  vatBreakdown?: { rate: string; base: string; tax: string }[];
}

/**
 * Place a working order (spec §3): `open → placed`, which FREEZES its composition and OPENS the
 * art. 29.2.j amendment log with an `order_placed` genesis entry — all in ONE `withTenant`/`asAppUser`
 * transaction, so the transition, the genesis amendment and the prep enqueue commit as one unit (or
 * roll back together, leaving the order open and un-logged).
 *
 * The freeze is FREE: once the row is `placed`, `working_orders_enforce_transition` rejects a
 * non-status update of it and `working_order_lines_require_open_parent` rejects any line write under
 * it, so the stored composition can no longer be silently rewritten — a further edit must become a
 * logged amendment (the future correction slice), not a line rewrite. `updateHeldOrder` also refuses
 * a placed order at the app layer with `working_order.not_open`.
 *
 * The mode dispatch (Task 8, design §3's state-machine table) keys on the location's `order_flow`:
 *  - `invoice_first` (Mode I): file `recordSale` DEFERRED here — an unpaid, chained invoice issued at
 *    placing — from the order's stored locked lines, and return its invoice number. `collectOrder`
 *    settles it later.
 *  - `ticket_then_pay` (Mode T) and `prepay` (Mode P): file NO fiscal document here. Mode T pays at
 *    collect (`collectOrder`); Mode P never reaches placing at all — a walk-up/prepay order pays and
 *    issues at ORDER via `payWorkingOrder` (open → settled, no placed state). So `placeOrder` under
 *    `prepay` is a bare place with no fiscal doc, the same as Mode T.
 * `deps` is the fuller `TillSaleDeps` because Mode I needs `backend`/`clock` to file.
 *
 * The order is locked `for update` and its status read off the locked row: a non-`open` order (already
 * placed/settled/abandoned, or absent / another tenant's, RLS-hidden) fails closed with
 * `working_order.not_open`, the same shape `payWorkingOrder`/`updateHeldOrder` use for the modify side.
 * That FOR UPDATE lock is ALSO the Mode-I double-place idempotency: a concurrent second place blocks
 * on the lock, then re-reads the row as `placed` and is refused `working_order.not_open` BEFORE it
 * files — so the `sales_working_order_id_key` guard is never even reached, and at most one deferred
 * invoice is ever filed per order (the order row always exists here, unlike a walk-up, so the lock
 * fully serialises; there is no create-race backstop to add).
 *
 * `operatorId` is REQUIRED: `order_amendments.actor_id` is NOT NULL and the genesis entry's
 * accountability rests on a real operator (the session's `personId`, wired by the till), so there is
 * no system sentinel to fall back to. The amendment's local wall-clock is `deps.clock.now()` — the
 * venue's trusted clock, the same source `recordSale` reads for a sale's `issued_at`/offset.
 */
export async function placeOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  operatorId: string,
): Promise<PlaceOrderResult> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Lock the order for the life of the tx and read its status off the locked copy. Absent (nothing
      // to lock) or not-open → `working_order.not_open`; the enforce_transition trigger is the DB
      // backstop if this app check is ever wrong.
      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id))
        .for("update");
      if (locked === undefined || locked.status !== "open") {
        throw new AppError("working_order.not_open", { workingOrderId: id });
      }

      // Mode dispatch (design §3). Mode I files the DEFERRED invoice HERE, before the transition, from
      // the order's stored locked lines (never a re-price — the composition was locked at add-time); the
      // read-back invoice number rides on the result. Modes T and P file nothing at placing. The
      // deferred file tags the sale with `working_order_id = id`, so the FOR UPDATE lock above already
      // guarantees one invoice per order (a second place sees `placed` and is refused before reaching
      // this).
      let placeResult: PlaceOrderResult = { id, status: "placed" };
      if (cfg.orderFlow === "invoice_first") {
        const priced = await priceStoredOrder(tx, id);
        const { saleId, fiscal } = await recordSale(tx, deps.backend, {
          tenantId: cfg.tenantId,
          tillId: cfg.tillId,
          nodeId: cfg.nodeId,
          seriesId: cfg.seriesId,
          workingOrderId: brandWorkingOrderId(id),
          locale: cfg.locale,
          invoiceLocales: cfg.invoiceLocales,
          total: priced.total,
          lines: priced.lines,
          vatBreakdown: priced.vatBreakdown,
          fiscalBackend: "verifactu",
          clock: deps.clock,
          operatorId,
          // A chained invoice with NO tender and NO settlement — the legitimate unsettled steady state
          // an invoice-first sale sits in until `collectOrder` settles it (design §3, Ordering 1).
          settlement: { kind: "deferred" },
        });
        // The human-facing "A/1" is read back from the sale row + its series (the FiscalRecordRef is
        // regime-opaque), in this same transaction — the shared `readInvoiceNumber` reader.
        placeResult = {
          id,
          status: "placed",
          invoiceNumber: await readInvoiceNumber(tx, saleId),
          issuedAt: fiscal.issuedAt.toISOString(),
          total: priced.total,
          qr: fiscal.verificationUrl ?? "",
          vatBreakdown: toVatBreakdown(priced.vatBreakdown),
        };
      }

      // open → placed. `working_orders_enforce_transition` validates OLD.status = 'open'; no `settled_at`
      // (the biconditional requires it stay NULL for a non-settled status).
      await tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id));

      // Open the amendment log with its `order_placed` genesis. `appendOrderAmendment` owns the
      // parent-row-lock serialisation, the per-order sequence and the tamper-evident hash (Task 3); the
      // genesis carries NO contest reason (a placement has none). The venue's trusted-clock instant +
      // wall offset are hashed and stored so the entry reprints in venue time (#52).
      const now = deps.clock.now();
      await appendOrderAmendment(tx, {
        tenantId: cfg.tenantId,
        workingOrderId: id,
        kind: "order_placed",
        actorId: operatorId,
        reason: null,
        capturedByTillId: cfg.tillId,
        capturedByNodeId: cfg.nodeId,
        eventAt: now.instant,
        eventOffsetMinutes: now.offsetMinutes,
      });

      // send-to-prep = placing enqueues the node-scoped prep row at `queued` (design §5); the cook's prep
      // routes (Task 9) advance it queued → preparing → ready → collected. One row per order (the PK is
      // the order), and prep advances even after the order is fiscally frozen, so it lives in its own
      // MUTABLE table rather than a `working_orders` column.
      await tx.insert(orderPrep).values({
        tenantId: cfg.tenantId,
        workingOrderId: id,
        nodeId: cfg.nodeId,
        state: "queued",
      });

      return placeResult;
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Cancel a PLACED working order (spec §4): `placed → abandoned`, appending an `order_cancelled`
 * amendment that carries the operator's reason — both in ONE `withTenant`/`asAppUser` transaction, so
 * the transition and the logged amendment commit as one unit (or roll back together).
 *
 * The reason is REQUIRED and non-empty, enforced HERE by the app: `order_amendments.reason` is
 * nullable (null is the `order_placed` genesis's own legitimate value) and no DB CHECK forces a reason
 * on `order_cancelled`, so this guard is the ONLY thing stopping a reasonless cancel from writing an
 * accountability-empty entry (art. 29.2.j — the reason is the contestable content; 7c carry-forward
 * from Task 3's review). An absent, empty or whitespace-only reason is refused with
 * `working_order.reason_required` — deliberately its OWN code, not `working_order.not_placed`: this
 * guard runs BEFORE the order is locked and its status read, so the order's state is unknown here (it
 * may be open, settled, abandoned or absent). A missing reason is a client/request-shape error
 * independent of that state, so `not_placed` would mislabel it as a state conflict (CLAUDE.md §1).
 * The guard runs BEFORE any database work, so a reasonless cancel neither transitions the order nor
 * touches the log.
 *
 * The order is locked `for update` and its status read off the locked row: a non-`placed` order (still
 * `open` — edit it via `updateHeldOrder` or discard it via `abandonHeldOrder` instead — or already
 * `settled`/`abandoned`, or absent / another tenant's, RLS-hidden) fails closed with
 * `working_order.not_placed`, the fail-closed shape `working_order.not_open` uses for the modify side.
 *
 * `deps` is `TillSaleDeps` so the venue's trusted clock is available for the amendment's local
 * wall-clock (its `backend` is unused), keeping the dep shape consistent with `placeOrder` — cancel is
 * a till operation beside place and pay. `operatorId` is the accountable actor, required for the same
 * reason `placeOrder`'s is.
 */
export async function cancelPlacedOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  reason: string,
  operatorId: string,
): Promise<void> {
  // Refused before any database work: a cancel with no reason is not a loggable amendment (its reason
  // is the accountable content), so an empty/whitespace reason neither transitions the order nor
  // appends a reasonless entry. Its own code — this fires BEFORE the status is read, so a missing
  // reason is a request-shape error, not the state conflict `not_placed` names (§1).
  if (reason.trim() === "") {
    throw new AppError("working_order.reason_required", { workingOrderId: id });
  }

  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id))
        .for("update");
      if (locked === undefined || locked.status !== "placed") {
        throw new AppError("working_order.not_placed", { workingOrderId: id });
      }

      // Terminal transition `placed → abandoned` (enforce_transition permits it; no `settled_at`, which
      // the biconditional requires stay NULL for a non-settled status).
      await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));

      // Append the `order_cancelled` amendment — the cancel is itself a logged amendment (design §4),
      // carrying the operator's reason, linked to the genesis via `appendOrderAmendment`'s per-order hash.
      const now = deps.clock.now();
      await appendOrderAmendment(tx, {
        tenantId: cfg.tenantId,
        workingOrderId: id,
        kind: "order_cancelled",
        actorId: operatorId,
        reason,
        capturedByTillId: cfg.tillId,
        capturedByNodeId: cfg.nodeId,
        eventAt: now.instant,
        eventOffsetMinutes: now.offsetMinutes,
      });
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * The prep lifecycle (design §5), mirrored from `@waitron/db`'s `prepState` pgEnum via its own
 * `enumValues` — the same derive-don't-duplicate shape `till-config.ts`'s `OrderFlow` uses for the
 * identical reason, so the two can never drift. `send-to-prep` (= placing for Modes I/T, or
 * `sendToPrep` for Mode P, which never places) enqueues at `queued`; the cook advances
 * queued → preparing → ready → collected.
 */
export type PrepState = (typeof prepState.enumValues)[number];

/**
 * One row of the node-scoped prep-queue view (design §5): what a cook's screen shows for a single
 * order still ACTIVE in prep (not yet collected). `id` is the working order's own id — the prep
 * queue addresses orders the same way the held list does, so a route can chain straight from one to
 * the other. `queuedAt` is when the order FIRST entered prep (`order_prep.queued_at`, the column the
 * queue is ordered by), not when it reached its CURRENT `state`.
 */
export interface PrepQueueEntry {
  id: string;
  orderNumber: number;
  label: string | null;
  state: PrepState;
  queuedAt: string;
}

/**
 * Enqueue a SETTLED order into prep (design §5) — the Mode-P counterpart to `placeOrder`'s own
 * enqueue. Modes I/T enqueue `order_prep` at `queued` INSIDE `placeOrder` (open → placed), because
 * placing is where their order becomes an order of record. Mode P (prepay) never places at all — it
 * pays and issues at ORDER via `payWorkingOrder` (open → settled, no placed state) — so its order has
 * no `placeOrder` call to pick a prep row up from, and this is that pickup: called once the order is
 * already `settled`.
 *
 * The order's status IS checked first, and enforced: an id naming NO working order (absent, or
 * another tenant's — RLS hides it), or one that is `open` (never paid) or `placed` (Modes I/T's own
 * route, `placeOrder`, already enqueued its prep row at placing — sending it here too would be the
 * wrong path, not a legitimate double-enqueue), all refuse with the domain
 * `working_order.not_settled` (409) BEFORE any write — never a raw `order_prep_order_fk` violation
 * surfacing as an opaque 500 for a well-formed but wrong/absent id (fix round 1, review finding).
 *
 * Only past that guard is it a plain INSERT, not a state-machine transition: `order_prep`'s PK is
 * `(tenant_id, working_order_id)` (one row per order), so a SECOND send-to-prep for an order already
 * sent (this same guard having passed both times) collides on it. Rather than let that surface as a
 * raw `23505`, it is caught and reported as the domain `order_prep.invalid_transition` — the same
 * code `advancePrep` uses for every other illegal prep MOVE (as opposed to the order-level
 * `not_settled` guard above, which is about the order's FISCAL eligibility to enter prep at all),
 * since "this order already has a prep record" is exactly as illegal a move as "the target isn't the
 * next state" (see that code's own note in `errors.ts`).
 */
export async function sendToPrep(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    // Only a SETTLED order is eligible — `settled` is terminal, so there is no race between this read
    // and the insert below that could invalidate it. Absent, foreign (RLS-hidden), `open` and
    // `placed` orders all match the SAME `undefined`/non-settled branch, one fail-closed code.
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }

    try {
      await tx.insert(orderPrep).values({
        tenantId: cfg.tenantId,
        workingOrderId: id,
        nodeId: cfg.nodeId,
        state: "queued",
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      throw new AppError("order_prep.invalid_transition", { workingOrderId: id });
    }
  });
}

/**
 * Advance a working order's prep state one step (design §5): `queued → preparing → ready →
 * collected`. Each branch is a single conditional UPDATE — `set state = to, <to>_at = now() where
 * working_order_id = id and state = <the one legal predecessor of to>` — so the legality of the move
 * IS the write: a skip, a repeat, a jump backwards, or an absent/foreign prep row (RLS hides another
 * tenant's) all match no row, and the empty `returning` throws `order_prep.invalid_transition`. The
 * same fail-closed shape `abandonHeldOrder`'s conditional UPDATE uses for `working_orders`.
 *
 * `to = "queued"` is refused immediately, before any query: no prep state legally advances TO queued
 * (only `sendToPrep`'s INSERT reaches it), so that case throws the same domain code the empty-
 * `returning` branch would. The switch (rather than a table keyed by a computed column name) keeps
 * each branch's `.set()` call fully typed against Drizzle's inferred update shape.
 *
 * Advances freely regardless of the order's FISCAL status (open/placed/settled) — `order_prep` is a
 * separate MUTABLE table precisely so prep can progress on an already-`settled` Mode-P order without
 * touching the frozen `working_orders` row (design §5, "where prep state lives"). Node-scoping is not
 * needed here: the id addresses one prep row directly and RLS still confines it to the tenant,
 * mirroring `getHeldOrder`/`updateHeldOrder`'s by-id family.
 */
export async function advancePrep(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  to: PrepState,
): Promise<void> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    let updated: { id: string }[];
    switch (to) {
      case "preparing":
        updated = await tx
          .update(orderPrep)
          .set({ state: to, preparingAt: sql`now()` })
          .where(and(eq(orderPrep.workingOrderId, id), eq(orderPrep.state, "queued")))
          .returning({ id: orderPrep.workingOrderId });
        break;
      case "ready":
        updated = await tx
          .update(orderPrep)
          .set({ state: to, readyAt: sql`now()` })
          .where(and(eq(orderPrep.workingOrderId, id), eq(orderPrep.state, "preparing")))
          .returning({ id: orderPrep.workingOrderId });
        break;
      case "collected":
        updated = await tx
          .update(orderPrep)
          .set({ state: to, collectedAt: sql`now()` })
          .where(and(eq(orderPrep.workingOrderId, id), eq(orderPrep.state, "ready")))
          .returning({ id: orderPrep.workingOrderId });
        break;
      case "queued":
      default:
        // No prep state advances TO queued — reaching it is `sendToPrep`'s job (an INSERT).
        throw new AppError("order_prep.invalid_transition", { workingOrderId: id });
    }

    if (updated.length === 0) {
      throw new AppError("order_prep.invalid_transition", { workingOrderId: id });
    }
  });
}

/**
 * The node-scoped prep-queue view (design §5): every ACTIVE (not yet collected) prep row on THIS
 * node for a working order that is STILL prep-eligible, joined to its working order for the display
 * fields a cook's screen needs — reusing 7b's `listHeldOrders` node-scoping SHAPE (`node_id =
 * cfg.nodeId`, RLS confines the tenant) over a DIFFERENT storage table: prep lives in `order_prep`,
 * not `working_orders`, for the reason that table's own schema comment gives (a Mode-P order is
 * already fiscally frozen `settled` when prep runs, so a `working_orders` column could not advance on
 * it). Ordered by `queued_at` — when the order FIRST entered prep — so the queue reads oldest-first
 * regardless of which state each row has since advanced to.
 *
 * `collected` rows are excluded (`state in ('queued','preparing','ready')`): once collected, an order
 * leaves the ACTIVE queue a cook's screen shows, mirroring `listHeldOrders` dropping a `settled`
 * order from the held list. A SECOND, independent exclusion drops an `abandoned` working order
 * (`ne(workingOrders.status, "abandoned")`) — `cancelPlacedOrder` (`placed → abandoned`) never
 * touches `order_prep` at all (design §4's amendment log and design §5's prep table are deliberately
 * separate concerns), so a cancelled order's `order_prep` row would otherwise sit at whatever state it
 * was in FOREVER, still `state in (queued, preparing, ready)` and so still matching the first filter —
 * this join is what retires it instead (fix round 1, review finding), rather than requiring every
 * removal path (cancel, and any future one) to also know to touch `order_prep`. PGlite is enough for
 * THIS behaviour — the join, the state/status filters and the ordering are plain SQL a single backend
 * proves; the node/tenant SCOPING is real-Postgres's job, the same split `listHeldOrders` uses
 * (CLAUDE.md §4).
 */
export async function listPrepQueue(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
): Promise<PrepQueueEntry[]> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return (
      tx
        .select({
          id: workingOrders.id,
          orderNumber: workingOrders.orderNumber,
          label: workingOrders.label,
          state: orderPrep.state,
          queuedAt: orderPrep.queuedAt,
        })
        .from(orderPrep)
        // Composite join predicate (tenant_id too, not the order id alone) — the same tenant-consistency
        // `listHeldOrders`'s own line join enforces, matching `order_prep_order_fk`'s composite shape.
        .innerJoin(
          workingOrders,
          and(
            eq(orderPrep.workingOrderId, workingOrders.id),
            eq(orderPrep.tenantId, workingOrders.tenantId),
          ),
        )
        .where(
          and(
            eq(orderPrep.nodeId, cfg.nodeId),
            inArray(orderPrep.state, ["queued", "preparing", "ready"]),
            ne(workingOrders.status, "abandoned"),
          ),
        )
        .orderBy(orderPrep.queuedAt)
    );
  });
}
