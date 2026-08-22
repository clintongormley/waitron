// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-sale.ts`/`till-config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  AppError,
  compareDecimal,
  decimal,
  MONEY_SCALE,
  multiplyDecimal,
  type SaleId,
  subtractDecimal,
  toScale,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import {
  allocateOrderNumber,
  appendOrderAmendment,
  asAppUser,
  categories,
  diningTables,
  invoiceSeries,
  isUniqueViolation,
  kitchenStations,
  products,
  sales,
  ticketItems,
  ticketState,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { listAvailableProducts, priceBasket, priceLockedLines } from "@waitron/catalogue";
import type { LockedLine, PricedLines } from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { FloorTableShape } from "./tables.js";
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
 * Refuses a LINELESS order with `sale.empty_basket` (a domain 4xx → 400), never a raw Error. A
 * lineless persisted order IS a reachable state: `openTab` opens an EMPTY tab — a lineless `open`
 * working order (design §3a; tabs.test.ts "opens a tab with NO initial round") — so paying it
 * (`payWorkingOrder`), placing it (Mode-I `placeOrder`), or card-paying it
 * (`payWorkingOrderIntegrated`) all reach here through `priceStoredOrder`. A sale needs ≥1 line to
 * price and file, so an empty one is refused BEFORE any fiscal write (and before any card charge) —
 * the SAME `sale.empty_basket` guard the walk-up/park/round paths make at their own layer, surfaced
 * here as the actionable domain code the error boundary maps to 400, rather than the opaque
 * `server.internal` 500 a raw Error would become through `run`. This is the last line for the
 * empty-tab pay/place flow, which those earlier per-layer guards do not cover.
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
  if (stored.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  return stored;
}

/**
 * Price a persisted order's STORED locked composition — `priceLockedLines` over {@link readLockedLines},
 * the one-liner every persisted-order file repeats (retrieved-order pay, Mode-I place, Mode-T collect,
 * and the settled-ticket read-back). `priceLockedLines` runs the SAME difference-method arithmetic over
 * the ADD-TIME locked gross (`unit_price_gross`) that `priceBasket` runs over a live catalogue, so a
 * catalogue price change after add never moves the filed total (line-add snapshot, 7c). Pure over
 * `readLockedLines`'s read; refuses a lineless order with `sale.empty_basket` (see there).
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
 * That id is what makes park IDEMPOTENT — a re-sent park (a lost-response retry) PK-collides on
 * `working_orders.id`, and `parkOrder` catches that 23505 and REPLAYS the existing OPEN order's
 * `{ id, orderNumber }` rather than surfacing the collision, so at most one order is ever parked for the
 * id and the retry sees the original result. This mirrors PAY's own replay (`payWorkingOrder`, which
 * re-returns an already-settled order's ticket rather than filing a second chained record). The ONE
 * exception is a colliding id whose committed row is no longer `open` (abandoned/settled/placed) — a
 * pathological id reuse, not a held-order retry — which is re-thrown as the raw 23505 unchanged.
 * `quantity` is a count for an `each` product and a measured kg weight for a `weight` product.
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
  // 500. The FK stays the DB backstop; this is the actionable app check, mirroring `openTab`'s own
  // existence check (the same `table.not_found` code). It is EXISTENCE-ONLY, though — no `active` gate
  // and no `FOR UPDATE`, unlike `openTab` — so a counter delivery MAY name a DEACTIVATED table (whether
  // to block that is the owner's product call, deferred); the parity is the code, not the full guard. A
  // walk-up/park/tab passes no `deliveryTableId`, so this never fires for them. Tables are deactivated,
  // never deleted (`deactivateTable`), so this cannot race a delete between the check and the insert below.
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

  try {
    return await withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        // Park needs only the allocated number; `priced` is `payWorkingOrder`'s walk-up shortcut, unused here.
        const { orderNumber } = await createOpenOrder(
          tx,
          cfg,
          req.id,
          req.lines,
          req.label ?? null,
        );
        return { id: req.id, orderNumber };
      },
      { nodeId: cfg.nodeId },
    );
  } catch (error) {
    // Anything but a unique violation is a real failure and surfaces unchanged — the transaction above
    // already rolled back, so nothing half-parked persists.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A 23505 on `working_orders_pkey`: a re-sent park (see `ParkOrderRequest` for the stable client id)
    // collides on the id an EARLIER park already committed. That row is READABLE now in a fresh
    // transaction — the unique violation fires only against a COMMITTED conflicting row (an UNCOMMITTED
    // concurrent insert of the same key would BLOCK on the index until its writer commits or aborts, not
    // error), which is exactly why `payWorkingOrder`'s 23505 backstop (`till-sale.ts`) replays in a fresh
    // tx too. Replay the committed OPEN order's number, filing and inserting nothing.
    return withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        const [existing] = await tx
          .select({ orderNumber: workingOrders.orderNumber })
          .from(workingOrders)
          .where(and(eq(workingOrders.id, req.id), eq(workingOrders.status, "open")));
        // Not `open` (abandoned/settled/placed) — a pathological id reuse, not a replayable held order —
        // so re-throw the raw 23505 unchanged per the docstring's exception, never fabricating a result.
        if (existing === undefined) {
          throw error;
        }
        return { id: req.id, orderNumber: existing.orderNumber };
      },
      { nodeId: cfg.nodeId },
    );
  }
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
  // TS-1 sets the back-pointer; TS-2 also clears any stale manual status as the new tab opens (§3b(2)).
  await tx
    .update(diningTables)
    .set({ tabId, statusId: null })
    .where(eq(diningTables.id, req.tableId));
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
 * Fire an order's (or a tab round's) lines to the kitchen (KDS-1 §3b): insert one `ticket_items` row
 * per line, its station RESOLVED and SNAPSHOTTED at fire time. The shared primitive the three fire
 * points funnel through — `placeOrder` (placing = firing for Modes I/T), `sendToPrep` (Mode P's
 * pickup) and a tab's round-send ({@link addTabRound}) — so routing and the snapshot rule live in ONE
 * place, replacing #63's single `order_prep` row per order with a per-line/per-station model.
 *
 * Each line resolves `product.station_id ?? category.station_id ?? the location's default station`
 * (§2b): a per-product override wins over the product's category default, which wins over the venue's
 * single `is_default` kitchen station. The resolved id is WRITTEN onto the ticket item, so re-pointing
 * the product's or category's station later never moves an already-fired item — the load-bearing
 * snapshot (`ticket_items.station_id`'s own schema comment). If a line resolves NEITHER a product- nor
 * category-level route AND the venue has no default station, firing FAILS LOUD with
 * `station.no_default` (§2b: a misconfiguration must not silently drop food from the kitchen), naming
 * the venue so the operator can fix it.
 *
 * `node_id = cfg.nodeId` (node-scoped, as `order_prep` was); `working_order_id = orderId` is the
 * denormalised grouping key; `working_order_line_id` is the fired line, whose `(tenant_id,
 * working_order_line_id)` unique makes a double-fire collide (23505) rather than duplicate. The two
 * catalogue reads (the venue default once, then all lines' product/category routes in one batched
 * `inArray`) and the insert all run on the CALLER's transaction under its tenant/app_user scope. An
 * empty `lines` inserts nothing — the `values([])` guard `createOpenOrder` uses.
 */
export async function fireLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  lines: { id: string; productId: string }[],
): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  // The venue's single fallback station (its `is_default` row, if any) — read ONCE; each line falls to
  // it when neither the product nor its category names a route.
  const [fallback] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
  const defaultStationId = fallback?.id ?? null;

  // Every fired product's own override AND its category's default, in ONE batched read (no per-line
  // round trip). Both `station_id`s are nullable; the LEFT JOIN yields a null category route for a
  // product with no category. RLS confines both tables to the caller's tenant.
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const routes = await tx
    .select({
      productId: products.id,
      productStationId: products.stationId,
      categoryStationId: categories.stationId,
    })
    .from(products)
    .leftJoin(
      categories,
      and(eq(categories.tenantId, products.tenantId), eq(categories.id, products.categoryId)),
    )
    .where(inArray(products.id, productIds));
  const routeByProduct = new Map(routes.map((route) => [route.productId, route]));

  // Resolve + snapshot each line's station, refusing the whole fire if any line has nowhere to go.
  const values: (typeof ticketItems.$inferInsert)[] = lines.map((line) => {
    const route = routeByProduct.get(line.productId);
    const stationId = route?.productStationId ?? route?.categoryStationId ?? defaultStationId;
    if (stationId === null || stationId === undefined) {
      throw new AppError("station.no_default", { locationId: cfg.locationId });
    }
    return {
      tenantId: cfg.tenantId,
      nodeId: cfg.nodeId,
      workingOrderId: orderId,
      workingOrderLineId: line.id,
      stationId,
      state: "queued",
    };
  });
  try {
    await tx.insert(ticketItems).values(values);
  } catch (error) {
    // A line already fired collides on `ticket_items`' per-line `(tenant_id, working_order_line_id)`
    // unique — a re-fire (the reachable case is a double `sendToPrep`). Map that 23505 to the domain
    // code naming the order, so the route surfaces a clean 409 instead of the raw constraint error
    // becoming an opaque `server.internal` 500. Caught HERE, the shared fire choke point, so every fire
    // path (placeOrder / sendToPrep / addTabRound) is covered by construction. Any other error re-throws.
    if (isUniqueViolation(error)) {
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
    throw error;
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
 * naïve `max(line_no)+1` without the lock races and collides on the `working_order_lines`
 * `(working_order_id, line_no)` unique — a real-PG concurrent test proves it by deletion of the lock.
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
  // TS-1 appends the round; KDS-1 fires it (design §3b, the tab round-send fire point) — insert the new
  // lines and send each to the kitchen as a ticket item. `returning` gives the minted line ids
  // (`defaultRandom`) that `fireLines` snapshots the resolved station onto.
  const appendedLines = await tx
    .insert(workingOrderLines)
    .values(appended)
    .returning({ id: workingOrderLines.id, productId: workingOrderLines.productId });
  await fireLines(tx, cfg, tabId, appendedLines);
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

/**
 * Set (or clear) ONE line's `served_at` on an OPEN tab — the shared body of {@link markLineServed} and
 * {@link unmarkLineServed}. {@link lockOpenTab} locks the tab row `FOR UPDATE` and confirms it is an
 * open tab a `dining_tables.tab_id` points at (else `tab.not_open`), then a single conditional UPDATE
 * writes the line: `served ? now() : null`. `now()` is the DATABASE clock (the venue's server time),
 * not a JS instant — the served marker is a floor-UI signal, so the write is stamped where every other
 * timestamp on this row is. A 0-row UPDATE (no such `line_no` on the tab) throws `tab.line_not_found`,
 * exactly as {@link voidTabLine}'s delete does.
 *
 * PRE-FISCAL (design H2, ruling R4): `served_at` is written only while the parent order is `open` and
 * is NEVER read into a filed record — the pay path rebuilds `sale_lines` from the locked price snapshot
 * (`priceLockedLines`), never this column, so this touches nothing filed. The
 * `working_order_lines_require_open_parent` trigger is the DB backstop that a served write cannot reach
 * a non-open parent even if this app guard were bypassed.
 */
async function setLineServed(
  tx: Transaction,
  tabId: string,
  lineNo: number,
  served: boolean,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  const updated = await tx
    .update(workingOrderLines)
    .set({ servedAt: served ? sql`now()` : null })
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)))
    .returning({ lineNo: workingOrderLines.lineNo });
  if (updated.length === 0) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
}

/**
 * Mark ONE line of an OPEN tab as delivered — `served_at = now()` (design §3b, FP-1). An OPERATIONAL
 * verb a logged-in runner uses like ringing a sale, so it is gated by the operator SESSION at the route
 * (`requireSession`, Task 6), NOT by a permission. `tab.not_open` if the order is not an open tab a
 * table points at (settled/abandoned, a walk-up, or absent/foreign — RLS-hidden); `tab.line_not_found`
 * if the `line_no` matches nothing on it. See {@link setLineServed} for the shared body and the H2
 * pre-fiscal note. `_cfg` is unused (the write is by tab id + line no, RLS-scoped) but kept for the
 * uniform `(tx, cfg, …)` tab-verb signature the route calls, underscore-prefixed the way
 * {@link voidTabLine} keeps it.
 */
export async function markLineServed(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await setLineServed(tx, tabId, lineNo, true);
}

/**
 * Clear ONE line's delivered marker on an OPEN tab — `served_at = NULL` (the inverse of
 * {@link markLineServed}, for a mis-tap). Same session gating, same `tab.not_open`/`tab.line_not_found`
 * guards, same shared body and H2 pre-fiscal note (see {@link setLineServed}).
 */
export async function unmarkLineServed(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await setLineServed(tx, tabId, lineNo, false);
}

/**
 * Move working-order lines from one OPEN tab to another (design §3) — the shared primitive `mergeTabs`
 * calls with ALL lines and TS-4 (transfer) will call with a subset, so it is written general now to
 * avoid a TS-4 refactor. Reads the named lines (default all), APPENDS them onto `toTab` at the next
 * `line_no`s with every locked price column carried across UNCHANGED (a move NEVER re-prices — the
 * add-time `working_order_lines.unit_price_gross` column is what the filed sale is later rebuilt from),
 * then deletes them from `fromTab`.
 *
 * Refuses a self-transfer (`fromTabId === toTabId`) with `tab.merge_self` BEFORE any read or write. In
 * the "move all" shape (no `lineNos`) a self-transfer would append every line as a duplicate and then
 * the trailing delete — keyed on `workingOrderId = fromTabId`, which is now ALSO `toTabId` — would match
 * BOTH the originals and the just-inserted duplicates, emptying the tab. `mergeTabs` already guards this
 * at its own top, but `moveTabLines` is the exported primitive TS-4 (transfer) calls directly, so the
 * guard lives here too, reusing the `tab.merge_self` code (one tab named as both ends — the same concept).
 *
 * Both tabs are locked `FOR UPDATE` in ASCENDING `id` order — a DEFENSIVE, plan-independent lock-order
 * discipline, NOT a deadlock-safety property any concurrent test at THIS level exercises: this primitive's
 * only caller today (`mergeTabs`) has already taken both `working_orders` row locks (in this same
 * ascending-id order) before `moveTabLines` runs, so the re-lock here is a deliberate no-op and no
 * `moveTabLines`-level race reaches this ordering. (mergeTabs's OWN lock order — `working_orders` before
 * `dining_tables` — is what carries the merge-vs-pay deadlock safety; see there.) These locks are on
 * `working_orders`, whose `id` is its PRIMARY KEY, so `mergeTabs`'s unindexed-`tab_id` seq-scan argument
 * does not apply to this leg. Their status is read off the locked copies: a non-`open` parent is refused
 * `tab.not_open` (moving lines under a settled/abandoned order would violate
 * `working_order_lines_require_open_parent` anyway). The lock on `toTab` also serialises `line_no`
 * allocation the way `addTabRound`'s per-tab lock does, so a concurrent append/move cannot collide on the
 * `working_order_lines` `(working_order_id, line_no)` unique. Runs on the CALLER's transaction under its
 * tenant/app_user scope.
 */
export async function moveTabLines(
  tx: Transaction,
  fromTabId: string,
  toTabId: string,
  lineNos?: number[],
): Promise<void> {
  // Refuse a self-transfer before any read/write (see the docstring): the "move all" shape would append
  // every line as a duplicate and then delete BOTH copies, emptying the tab. mergeTabs guards this too,
  // but this primitive is called directly by TS-4. Reuses tab.merge_self — one tab named as both ends.
  if (fromTabId === toTabId) {
    throw new AppError("tab.merge_self", { tabId: fromTabId });
  }
  const locked = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, fromTabId), eq(workingOrders.id, toTabId)))
    .orderBy(workingOrders.id)
    .for("update");
  const from = locked.find((r) => r.id === fromTabId);
  const to = locked.find((r) => r.id === toTabId);
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  if (to === undefined || to.status !== "open") {
    throw new AppError("tab.not_open", { tabId: toTabId });
  }

  const sourceWhere =
    lineNos === undefined
      ? eq(workingOrderLines.workingOrderId, fromTabId)
      : and(
          eq(workingOrderLines.workingOrderId, fromTabId),
          inArray(workingOrderLines.lineNo, lineNos),
        );

  // Read the lines to move (locked price columns kept verbatim), in line_no order.
  const source = await tx
    .select({
      tenantId: workingOrderLines.tenantId,
      productId: workingOrderLines.productId,
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      lineTotal: workingOrderLines.lineTotal,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(sourceWhere)
    .orderBy(workingOrderLines.lineNo);

  // The next free line_no on the destination, allocated under the toTab lock above (no race).
  const [agg] = await tx
    .select({ next: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toTabId));
  const base = agg!.next;

  // Append onto the destination, then delete from the source. Guarded: an EMPTY source (or empty subset)
  // has nothing to insert and `tx.insert(...).values([])` errors — the same guard createOpenOrder uses.
  if (source.length > 0) {
    await tx.insert(workingOrderLines).values(
      source.map((line, i) => ({
        tenantId: line.tenantId,
        workingOrderId: toTabId,
        lineNo: base + i + 1,
        productId: line.productId,
        descriptions: line.descriptions,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitPriceGross: line.unitPriceGross,
        vatRate: line.vatRate,
        lineTotal: line.lineTotal,
        category: line.category,
      })),
    );
  }
  await tx.delete(workingOrderLines).where(sourceWhere);
}

/**
 * Assert a working order is an OPEN tab, else throw `tab.not_open` (design §3) — the one definition of
 * "this tab is open" that `moveTab`/`joinTable` both gate on, so the check cannot drift between them. A
 * single UNLOCKED status read: deliberately NOT `lockOpenTab`, which takes `FOR UPDATE` and checks a
 * `dining_tables` back-pointer both verbs intentionally avoid (see their docstrings).
 */
async function assertTabOpen(tx: Transaction, tabId: string): Promise<void> {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
}

/** One line of an OPEN tab, for the table-order screen (FP-1, design §3b). `unitPriceGross` is the gross
 *  unit price LOCKED at add-time (`working_order_lines.unit_price_gross`), NOT a re-price; `servedAt` is
 *  the pre-fiscal served marker (`null` ⇒ "Pendiente de servir", a timestamp ⇒ "Servido"). Carries the
 *  `productId` only — no product name, mirroring `HeldOrder`: the screen resolves names from its own
 *  catalogue prop. `quantity` is numeric(_,3) text, `unitPriceGross` numeric(_,2) text. */
export interface TabLine {
  lineNo: number;
  productId: string;
  quantity: string;
  unitPriceGross: string;
  servedAt: string | null;
}

/**
 * Read one OPEN tab's lines for the table-order screen (FP-1, design §3b), in `line_no` order — each
 * line's `line_no`, `product_id`, `quantity`, its LOCKED gross unit price (`unit_price_gross`) and its
 * `served_at` marker. A dedicated read, distinct from `getHeldOrder`/`HeldOrder` (which returns
 * `product_id` + `quantity` only, for a basket rebuild that RE-prices): a tab does NOT re-price, so this
 * MUST return the STORED `unit_price_gross` the line locked at add-time (`addTabRound`/`openTab` via
 * `priceOrderLines`), never a catalogue recompute — a re-price would misreport a locked tab. Names no
 * product (the screen resolves names from its own catalogue prop), mirroring `HeldOrder`'s productId-only
 * philosophy.
 *
 * Gated by {@link assertTabOpen} (an absent or non-`open` order → `tab.not_open`), the SAME unlocked
 * status read `moveTab`/`joinTable` use — deliberately NOT `lockOpenTab`: this is a READ, so it takes no
 * `FOR UPDATE` write lock and needs no `dining_tables` back-pointer check. RLS confines the tenant (the
 * read runs as `app_user` under `withTenant`); `_cfg` is unused — the read is by tab id, RLS-scoped —
 * but kept for the uniform `(tx, cfg, …)` tab-verb signature the route calls, underscore-prefixed the way
 * {@link voidTabLine}/{@link markLineServed} keep it. PRE-FISCAL (design H2, ruling R4): `served_at` is an
 * operational floor field never read into a filed record; this touches nothing fiscal.
 */
export async function readTabLines(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
): Promise<TabLine[]> {
  await assertTabOpen(tx, tabId);
  return tx
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      servedAt: workingOrderLines.servedAt,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

/**
 * Assert a move/join TARGET table exists, is `active`, and is FREE — the one occupancy predicate the
 * whole table-service feature rests on (design §3), shared by `moveTab`/`joinTable` so the three-way
 * check cannot drift between them. `table` is the caller's already-fetched-and-`FOR UPDATE`-locked row
 * (or undefined). "Free" = `tab_id` null OR pointing at a settled/abandoned order (a stale pointer,
 * TS-1 §2b); a still-`open` pointed order throws `table.occupied` ("use merge"). Throws
 * `table.not_found`/`table.inactive`/`table.occupied`, each naming the caller-supplied `tableId`.
 */
async function assertTableAvailable(
  tx: Transaction,
  table: { tabId: string | null; active: boolean } | undefined,
  tableId: string,
): Promise<void> {
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId });
  }
  if (table.tabId !== null) {
    const [pointed] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (pointed !== undefined) {
      throw new AppError("table.occupied", { tableId });
    }
  }
}

/**
 * Free every table currently covered by `tabId` — `tab_id` + `status_id → NULL` in one tenant-scoped
 * statement. A turnover: the freed table's TS-2 manual status must not linger onto the next party
 * (design §4). Shared by `moveTab` (freeing the source) and `mergeTabs`'s consolidate branch.
 */
async function freeTablesCoveredBy(tx: Transaction, cfg: TillConfig, tabId: string): Promise<void> {
  await tx
    .update(diningTables)
    .set({ tabId: null, statusId: null })
    .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, tabId)));
}

/**
 * Relocate a party to a free table (design §3). Validates `tabId` is an `open` working order
 * (`tab.not_open`) and `toTableId` is `active` (`table.not_found`/`table.inactive`) and FREE — its
 * `tab_id` is null or points at a settled/abandoned order (a stale pointer, TS-1 §2b), else
 * `table.occupied` ("use merge"). Then frees the tab's current source table(s) and points the target at
 * the tab. NO line-move, no fiscal effect.
 *
 * Locks the involved `dining_tables` rows (target + the tab's current source table(s)) `FOR UPDATE` in
 * ASCENDING `id` order — a DEFENSIVE, plan-independent lock-order discipline shared across the
 * table-service verbs, NOT a deadlock-safety property any concurrent test exercises (this verb's race
 * test proves the single TARGET-row lock below, not the multi-row ordering). Locking the target
 * is the concurrency guard: a second concurrent move onto the same free table blocks, then re-reads its
 * now-set `tab_id` and is refused `table.occupied` (proven by deletion of this lock — §7). The tab's own
 * `working_orders` row is NOT locked (a move neither settles nor abandons it — unlike merge); a race
 * with a concurrent pay leaves at worst a harmless stale pointer, which the occupancy read ignores.
 *
 * The freed source table(s) get `tab_id → NULL` AND `status_id → NULL` in one statement — a move is a
 * turnover for the source, so its TS-2 manual status must not linger onto the next party (design §4).
 * The TARGET table is turned over too: pointing the tab at it also clears its `status_id → NULL`, so a
 * stale status left from the target's PREVIOUS party does not linger onto the moved-in one — exactly as
 * `openTab` clears status when a fresh tab opens on a table (design §4). The TS-2 settle-trigger does
 * not fire on a move (the tab stays open), so both clears are EXPLICIT here.
 */
export async function moveTab(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  toTableId: string,
): Promise<void> {
  await assertTabOpen(tx, tabId);

  const involved = await tx
    .select({ id: diningTables.id, tabId: diningTables.tabId, active: diningTables.active })
    .from(diningTables)
    .where(or(eq(diningTables.id, toTableId), eq(diningTables.tabId, tabId)))
    .orderBy(diningTables.id)
    .for("update");
  await assertTableAvailable(
    tx,
    involved.find((t) => t.id === toTableId),
    toTableId,
  );

  // Free the source table(s) the tab currently covers, then point the target — clearing ITS status_id
  // too, since the moved-in party turns the target over (openTab parity, design §4).
  await freeTablesCoveredBy(tx, cfg, tabId);
  await tx
    .update(diningTables)
    .set({ tabId, statusId: null })
    .where(eq(diningTables.id, toTableId));
}

/**
 * Extend a tab's coverage to a free table (design §3): validates `tabId` is an `open` working order
 * (`tab.not_open`) and `tableId` is `active` and FREE (`table.not_found`/`table.inactive`/`table.occupied`),
 * then points the free table's `tab_id` at the tab too — now BOTH the tab's original table(s) and this
 * one point at it, a join. NO line-move (the free table had no tab) and NO status clear (nothing is
 * freed — the table joins, it does not turn over; design §4). On pay the one tab files one sale; on
 * settle the TS-2 trigger clears status on ALL its tables (keyed on `tab_id`).
 *
 * The target table is locked `FOR UPDATE` — the concurrency guard, exactly as `moveTab`'s: a second
 * concurrent join onto the same free table blocks, then reads its set `tab_id` and is refused
 * `table.occupied`. `_cfg` is unused (the row is addressed by id and RLS confines it to the tenant) but
 * kept for signature symmetry with `moveTab`/`mergeTabs` — underscore-prefixed so `noUnusedParameters`
 * leaves it, the repo convention `voidTabLine`/`deactivateTable` follow for an interface-shape parameter.
 */
export async function joinTable(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  tableId: string,
): Promise<void> {
  await assertTabOpen(tx, tabId);

  const [table] = await tx
    .select({ id: diningTables.id, tabId: diningTables.tabId, active: diningTables.active })
    .from(diningTables)
    .where(eq(diningTables.id, tableId))
    .for("update");
  await assertTableAvailable(tx, table, tableId);

  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, tableId));
}

/**
 * Combine two tabs onto one bill (design §3). Validates both are DISTINCT (`tab.merge_self`) `open`
 * working orders (`tab.not_open`), then moves ALL of `fromTab`'s lines onto `intoTab`, re-points
 * `fromTab`'s table(s), and abandons the now-empty `fromTab`. The merged `intoTab` (holding every line)
 * files ONE sale on pay; `fromTab`, abandoned and empty, files nothing — no double-file (H2, §5).
 *
 * `freeSourceTable = true` frees the source table (`tab_id` + `status_id → NULL` — the 2+2 CONSOLIDATE
 * case, the source turns over); `false` re-points it at `intoTab` (both tables now covered by the one
 * bill — the 4+4 JOIN case, and the joined table KEEPS its status, design §4).
 *
 * Lock order — both `working_orders` rows `FOR UPDATE` ASCENDING id FIRST, THEN the involved
 * `dining_tables` rows (those covered by either tab) `FOR UPDATE` ASCENDING id. This MATCHES the
 * sale/settle/abandon path: `payWorkingOrder` (till-sale.ts) locks the `working_orders` row `FOR UPDATE`,
 * then its settle UPDATE fires the 0050 `working_orders_clear_table_status` trigger, which UPDATEs
 * `dining_tables WHERE tab_id = NEW.id` — i.e. `working_orders` then `dining_tables`; `collectOrder`
 * (settle, which locks its `working_orders` row with an explicit `SELECT … FOR UPDATE`) and
 * `abandonHeldOrder` (abandon, via its conditional `UPDATE working_orders`) each lock the
 * `working_orders` row BEFORE the same trigger touches `dining_tables` — the identical two-class order.
 * Acquiring in that identical order is what PREVENTS a mergeTabs-vs-pay/settle/abandon DEADLOCK:
 * a concurrent merge and pay both take `working_orders` before `dining_tables`, so they cannot
 * cross-lock and trip a 40P01. THIS leg's order is load-bearing and proven — the concurrent merge/pay
 * race test (move-merge.rls.test.ts) asserts no 40P01, and by deletion the previous
 * `dining_tables`-first order reproduces the 40P01 against the real trigger.
 *
 * The `dining_tables` leg's OWN ascending-id order is, by contrast, DEFENSIVE not proven load-bearing:
 * for a merge-vs-merge (same-verb) race the `dining_tables` lock is on the UNINDEXED `tab_id`, so both
 * backends seq-scan the two rows in identical heap order and serialise on the first regardless of the
 * `.orderBy`. The ascending-id discipline on that leg only future-proofs against a schema/plan change
 * that lets scan orders diverge; a same-verb race cannot prove it load-bearing (a §1 "both answers look
 * alike" measurement). The deterministic hazard control (move-merge.rls.test.ts) proves the general
 * inconsistent-order 40P01 hazard is real.
 *
 * ORDER MATTERS (Plan note 2): the re-point (step 2) precedes the abandon (step 3). The TS-2
 * `working_orders_clear_table_status` trigger fires on the `open → abandoned` transition and clears
 * `status_id` WHERE `tab_id = fromTabId`; because step 2 has already re-pointed every such table away
 * from `fromTabId`, that trigger matches nothing. Were the abandon first, it would clear the status on a
 * table that stays JOINED (`freeSourceTable:false`) — contradicting design §4.
 */
export async function mergeTabs(
  tx: Transaction,
  cfg: TillConfig,
  intoTabId: string,
  fromTabId: string,
  options: { freeSourceTable: boolean },
): Promise<void> {
  if (intoTabId === fromTabId) {
    throw new AppError("tab.merge_self", { tabId: intoTabId });
  }

  // Lock order (see the docstring): both working_orders rows FIRST (ascending id), THEN the involved
  // dining_tables rows (ascending id) — the SAME order the sale/settle/abandon path acquires them in
  // (payWorkingOrder locks working_orders, then the 0050 settle trigger updates dining_tables), so a
  // concurrent merge and pay cannot cross-lock into a 40P01. The status check throws before the
  // dining_tables lock, so a non-open (or RLS-hidden foreign) tab is refused holding only working_orders.
  const tabs = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, intoTabId), eq(workingOrders.id, fromTabId)))
    .orderBy(workingOrders.id)
    .for("update");
  const into = tabs.find((t) => t.id === intoTabId);
  const from = tabs.find((t) => t.id === fromTabId);
  if (into === undefined || into.status !== "open") {
    throw new AppError("tab.not_open", { tabId: intoTabId });
  }
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(or(eq(diningTables.tabId, intoTabId), eq(diningTables.tabId, fromTabId)))
    .orderBy(diningTables.id)
    .for("update");

  // 1. Move ALL of fromTab's lines onto intoTab (locked prices preserved), both still open.
  //    moveTabLines re-locks + re-validates these two rows as open — a deliberate no-op re-lock here
  //    (we already hold and checked them), because moveTabLines is a standalone primitive TS-4 calls
  //    directly and must self-validate; the extra round trip is accepted rather than couple the two.
  await moveTabLines(tx, fromTabId, intoTabId);

  // 2. Re-point fromTab's table(s) BEFORE the abandon (Plan note 2).
  if (options.freeSourceTable) {
    await freeTablesCoveredBy(tx, cfg, fromTabId);
  } else {
    await tx
      .update(diningTables)
      .set({ tabId: intoTabId })
      .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, fromTabId)));
  }

  // 3. Abandon the now-empty fromTab (open → abandoned; the working_orders_enforce_transition state
  //    machine permits it).
  await tx
    .update(workingOrders)
    .set({ status: "abandoned" })
    .where(eq(workingOrders.id, fromTabId));
}

/**
 * The GROSS (VAT-inclusive) line total for `quantity` units at a LOCKED gross unit price, at
 * {@link MONEY_SCALE}, half away from zero — the SAME composition `@waitron/catalogue`'s `priceRows`
 * uses for a line's gross total (`toScale(multiplyDecimal(grossUnit, decimal(quantity)), MONEY_SCALE)`),
 * which is what `priceBasket` writes at add-time and `priceLockedLines` recomputes at file-time. Used by
 * {@link transferLines}' split path so a split line's `working_order_lines.line_total` is byte-identical
 * to an add-time line's — the identical helper composition, over the line's OWN locked
 * `working_order_lines.unit_price_gross`, never a catalogue re-read. Both arguments arrive as
 * `numeric`-as-text (a stored `unit_price_gross`, a transfer or remainder quantity); `decimal()`
 * validates each into the branded-`Decimal` helpers, and accepts an already-branded `Decimal` unchanged.
 */
function grossLineTotal(grossUnit: string, quantity: string): string {
  return toScale(multiplyDecimal(decimal(grossUnit), decimal(quantity)), MONEY_SCALE);
}

/**
 * Move SELECTED items from one open tab to another (design §3) — the transfer verb. Each entry of
 * `transfers` names a source `line_no` and optionally a `quantity`:
 *
 * - A WHOLE-line move (`quantity` omitted, OR equal to the line's own quantity) is delegated to
 *   {@link moveTabLines}: the line's locked `working_order_lines.unit_price_gross` is carried across
 *   UNCHANGED (a move NEVER re-prices — that add-time locked column is what the filed sale is later
 *   rebuilt from) and it is appended at the destination's next `line_no`. Routing an equal-quantity
 *   transfer here (rather than down the split path below) is deliberate: splitting the full quantity
 *   would reduce the source to zero, which violates `working_order_lines_quantity_ck`
 *   (`quantity <> 0`, orders.ts:194) — so the source line is REMOVED entirely, never left as a
 *   zero-quantity remnant. `compareDecimal` makes the equality value-wise across scales, so an
 *   explicit `"2"` transfer against a `"2.000"` line (and a weighed `"0.320"` against `"0.320"`) both
 *   count as whole-line moves, identically to `quantity` omitted.
 * - A PARTIAL split (`quantity` given and strictly less than the line's own quantity) REDUCES the
 *   named source line's quantity and INSERTS a NEW destination line inheriting every per-unit value
 *   from the source — `product_id`, `descriptions`, `unit_price` (net), `unit_price_gross` (locked
 *   gross), `vat_rate`, `category` — with `quantity = transferred`. Nothing is re-fetched from the
 *   catalogue: both the kept source line's and the new destination line's `line_total` are recomputed
 *   by {@link grossLineTotal} over the SAME locked `unit_price_gross`, so a catalogue price change
 *   after add moves NEITHER (the price-lock test proves this by changing the catalogue between the
 *   ring and the transfer). Quantity is conserved — `source.remaining + dest.transferred = original`
 *   — and a `weight` line splits identically, no special case. `line_total` is a per-line re-compute
 *   (each tab keeps `Σ line_total = its total`); pre-fiscal, so a sub-céntimo split rounding
 *   difference is harmless (design §3).
 *
 * Guarded (Task 5): a batch may name each source `line_no` AT MOST once (`tab.transfer_duplicate_line`,
 * refused up front before any lock or write — a repeat would validate each entry against the STATIC
 * pre-batch quantity snapshot and INVENT quantity, since the split sets the source to `original − q`
 * rather than a cumulative decrement, and a whole-line + partial pair on one line is contradictory);
 * every named `line_no` must exist on `fromTab` (`tab.line_not_found`); and any given `quantity` must
 * be well-formed and satisfy `0 < quantity ≤ line.quantity` (`tab.transfer_quantity_invalid` — zero,
 * negative, over-quantity, or a malformed decimal literal). All are checked for EVERY transfer BEFORE
 * any move or split runs, so one bad entry in a batch leaves the source untouched rather than
 * half-transferred.
 *
 * Both tabs' `working_orders` rows are locked `FOR UPDATE` in ASCENDING id order:
 * `[fromTabId, toTabId].sort()` then a `lockOpenTab` per id, each a SEPARATE `where id = X ... for update`.
 * Two things that buys, at DIFFERENT strengths — kept apart deliberately:
 *
 * - PROVEN: a transfer racing ANOTHER transfer on the same pair serialises without deadlock. Both acquire
 *   their two row locks lowest-id-first (the `.sort()` + `lockOpenTab` loop below), so the
 *   reverse-orientation race — A→B against B→A — cannot form a lock cycle; one backend simply waits on the
 *   lower id until the other commits. `transfer-lines.rls.test.ts` proves this on real Postgres by
 *   DELETION: strip the `.sort()` (each transfer then locks in its own direction) and that race raises
 *   `40P01 deadlock detected` in every looped iteration; restore it and the race goes green.
 * - PROVEN: this verb holds NO `dining_tables` lock. `lockOpenTab` locks the `working_orders` row ONLY —
 *   its `dining_tables` back-pointer read is an UNLOCKED select — so a transfer is NOT in the
 *   `dining_tables`↔`working_orders` cross-lock class and cannot deadlock with pay/settle/abandon (those
 *   lock `working_orders`, then `dining_tables` via the settle trigger; a transfer never holds a
 *   `dining_tables` lock).
 *
 * NOT proven, and stated as such: a transfer racing a MERGE (or a direct `moveTabLines`) on the same pair.
 * Those lock their two `working_orders` rows in a SINGLE statement (`where id = a or id = b order by id for
 * update`), and PostgreSQL takes the row locks in SCAN order, applying the `order by` to the query OUTPUT
 * afterwards — it does NOT promise the locks are ACQUIRED in id order. A two-row primary-key lookup very
 * likely index-scans the key ascending, matching this verb's order, so the interaction is very likely safe
 * and a reviewer could not reproduce a deadlock — but that is a property of the chosen PLAN, not a Postgres
 * guarantee, so this is NOT claimed to be un-cross-lockable. It is also pre-fiscal (nothing is filed), and
 * any 40P01 would surface as a caught, retryable error rather than corruption.
 *
 * That ascending-id discipline is defensive and plan-level, and this PGlite suite cannot itself prove it:
 * `transfer-lines.test.ts` runs on a single backend that serialises every query, so a contention test on
 * it is a false pass — the real-Postgres race is `transfer-lines.rls.test.ts`'s job.
 *
 * `lockOpenTab` requires each tab to be an OPEN working order some `dining_tables.tab_id` points at,
 * else `tab.not_open`; an absent/foreign (RLS-hidden) tab matches no row → the same fail-closed
 * `tab.not_open`. (For a destination that is absent or closed, `moveTabLines` ALSO throws `tab.not_open`
 * from its own status read — so that particular guard is backstopped, and the lock loop's own
 * contribution is the stricter is-a-tab back-pointer check plus the explicit lock ordering.) A
 * self-transfer (`fromTabId === toTabId`) is refused with `tab.transfer_self` BEFORE any lock — moving a
 * tab's items to itself is a no-op the caller did not mean, and would take the same row `FOR UPDATE`
 * twice (mirrors `mergeTabs`' `tab.merge_self` self-guard).
 *
 * A tx-level verb (takes the caller's `tx`, like `moveTabLines`/`mergeTabs`): the HTTP route opens the
 * `withTenant`/`asAppUser` transaction around it. Pre-fiscal — nothing is filed; each tab files its own
 * sale on its own pay (design §4). `cfg` (the till config) supplies the `tenant_id` the split path
 * stamps on each new destination line; `voidTabLine`/`joinTable` keep the same `TillConfig` parameter
 * for the uniform tab-verb signature the route layer calls.
 */
export async function transferLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  // A tab cannot transfer to itself — refused before any lock (which would take the row twice).
  if (fromTabId === toTabId) {
    throw new AppError("tab.transfer_self", { tabId: fromTabId });
  }

  // A batch may name each source line_no AT MOST once — refused before any lock or write. A repeated
  // line_no does NOT conserve quantity: every entry is validated against the STATIC `byLineNo` snapshot
  // of `line.quantity` below (never updated between entries) and the split write sets the source to
  // `original − q` (a plain set, not a cumulative decrement), so two partial "1"s off a café×3 line
  // both pass and the destination gains 1.000+1.000 while the source only drops to 2.000 — 4 from an
  // original 3. A whole-line + partial pair on one line is worse and contradictory: `moveTabLines`
  // DELETEs the line (moving it whole) and the split's `UPDATE ... WHERE line_no=…` then matches zero
  // rows while its INSERT still fabricates a destination line. Neither shape folds into a cumulative
  // decrement, so a duplicate is simply refused (a 400 request-shape fault), naming the FIRST line_no
  // that repeats. This up-front guard also covers a duplicate WHOLE-line pair — already harmless via
  // `moveTabLines`' `inArray` set semantics — which is fine/stricter.
  const seenLineNos = new Set<number>();
  for (const { lineNo } of transfers) {
    if (seenLineNos.has(lineNo)) {
      throw new AppError("tab.transfer_duplicate_line", { tabId: fromTabId, lineNo });
    }
    seenLineNos.add(lineNo);
  }

  // Lock BOTH tab rows FOR UPDATE in ascending id order. `.sort()` is lexicographic, which for the
  // canonical lowercase uuids `randomUUID()`/`gen_random_uuid()` emit matches PostgreSQL's own byte
  // ordering of `uuid` — so this IS ascending id order as the DB sees it. `lockOpenTab` throws
  // `tab.not_open` for a row that is absent, closed, not a tab (no `dining_tables` back-pointer), or
  // (RLS) another tenant's. The last two are what this loop enforces beyond `moveTabLines`' own open
  // check below, which accepts any open order — see the isolating not-open test in transfer-lines.test.ts.
  for (const tabId of [fromTabId, toTabId].sort()) {
    await lockOpenTab(tx, tabId);
  }

  // Read every named source line ONCE, under the lock, into a map. The per-unit locked values a split
  // INHERITS come from here — never a catalogue re-read.
  const named = transfers.map((t) => t.lineNo);
  const sourceLines = await tx
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, fromTabId),
        inArray(workingOrderLines.lineNo, named),
      ),
    );
  const byLineNo = new Map(sourceLines.map((l) => [l.lineNo, l]));

  // Validate EVERY transfer before moving/splitting anything (Task 5), then partition: a WHOLE-line
  // move (`quantity` omitted, OR equal to the line's full quantity) vs a PARTIAL split (`quantity`
  // given and strictly less). A quantity equal to the line's own quantity is routed to the whole-line
  // path rather than the split path — splitting it would REDUCE the source to zero, which violates
  // `working_order_lines_quantity_ck` (`quantity <> 0`). `compareDecimal` is value-wise across scales,
  // so "2" == "2.000" and a weighed "0.320" == "0.320" both count as whole-line moves.
  const wholeLineNos: number[] = [];
  const partials: { line: (typeof sourceLines)[number]; quantity: string }[] = [];
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: fromTabId, lineNo: t.lineNo });
    }
    if (t.quantity === undefined) {
      wholeLineNos.push(t.lineNo);
      continue;
    }
    // Validate the requested quantity: a well-formed decimal in `0 < quantity ≤ line.quantity`. A
    // malformed literal makes `decimal()` throw `shared.invalid_decimal` — treated as invalid and
    // reported as the SAME domain code as an out-of-range one (one throw site), so a bad quantity
    // never surfaces as that raw code or as a `working_order_lines_quantity_ck`/other DB CHECK violation.
    let inRange: boolean;
    try {
      const q = decimal(t.quantity);
      inRange =
        compareDecimal(q, decimal("0")) > 0 && compareDecimal(q, decimal(line.quantity)) <= 0;
    } catch {
      inRange = false;
    }
    if (!inRange) {
      throw new AppError("tab.transfer_quantity_invalid", {
        tabId: fromTabId,
        lineNo: t.lineNo,
        quantity: t.quantity,
      });
    }
    // Full quantity → a whole-line move (no zero remnant, Task 4); otherwise a split. The quantity is
    // now known valid, so this re-compare's `decimal()` cannot throw.
    if (compareDecimal(decimal(t.quantity), decimal(line.quantity)) === 0) {
      wholeLineNos.push(t.lineNo);
    } else {
      partials.push({ line, quantity: t.quantity });
    }
  }

  // Whole lines first: `moveTabLines` keeps each locked price and appends at the destination's next
  // `line_no`(s).
  if (wholeLineNos.length > 0) {
    await moveTabLines(tx, fromTabId, toTabId, wholeLineNos);
  }

  // Then the splits. Allocate destination `line_no`s AFTER the moves (so they don't collide with moved
  // rows): read the current max under the lock and hand out max+1, max+2, ... in order — the same
  // per-tab allocation `addTabRound`/`moveTabLines` make, safe against the
  // `(working_order_id, line_no)` unique because the destination row is held FOR UPDATE by the lock loop.
  if (partials.length > 0) {
    const [{ maxLineNo }] = await tx
      .select({ maxLineNo: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, toTabId));
    for (let i = 0; i < partials.length; i++) {
      const { line, quantity } = partials[i]!;
      const remaining = subtractDecimal(decimal(line.quantity), decimal(quantity));
      // Source line: quantity drops, `line_total` recomputed from the SAME locked gross (no re-price).
      await tx
        .update(workingOrderLines)
        .set({ quantity: remaining, lineTotal: grossLineTotal(line.unitPriceGross, remaining) })
        .where(
          and(
            eq(workingOrderLines.workingOrderId, fromTabId),
            eq(workingOrderLines.lineNo, line.lineNo),
          ),
        );
      // Destination: a NEW line inheriting every per-unit value, `quantity = transferred`, `line_total`
      // = round(transferred × locked gross). NEVER re-fetched from the catalogue.
      await tx.insert(workingOrderLines).values({
        // cfg.tenantId is the source line's tenant here (moveTabLines stamps `line.tenantId`; same value):
        // the source read above is RLS-filtered to current_tenant_id(), and
        // working_order_lines_tenant_isolation's WITH CHECK rejects any other tenant_id on this INSERT — a
        // cross-tenant value is unwritable, not a silent wrong-tenant row.
        tenantId: cfg.tenantId,
        workingOrderId: toTabId,
        lineNo: maxLineNo! + i + 1,
        productId: line.productId,
        descriptions: line.descriptions,
        quantity,
        unitPrice: line.unitPrice,
        unitPriceGross: line.unitPriceGross,
        vatRate: line.vatRate,
        lineTotal: grossLineTotal(line.unitPriceGross, quantity),
        category: line.category,
      });
    }
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
 * Scoped to `status = 'open'` AND `node_id = cfg.nodeId` (RLS additionally confines it to the tenant):
 * an absent id, a `settled`/`abandoned` order, another tenant's order, or a same-tenant order parked
 * on ANOTHER node all surface the one `working_order.not_found` — see that code's note. Node-scoped to
 * match `listHeldOrders` and the rest of the by-id family (`updateHeldOrder`/`abandonHeldOrder`): a
 * retrieve follows the node-scoped list, so a foreign-node id names nothing this register should
 * reach, and failing it closed here is the fail-closed posture the whole by-id family now shares (7b).
 * RLS is tenant-scoped and would NOT hide a same-tenant order on another node — only this filter does.
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
      .where(
        and(
          eq(workingOrders.id, id),
          eq(workingOrders.status, "open"),
          eq(workingOrders.nodeId, cfg.nodeId),
        ),
      );

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
 * together, leaving the parked order exactly as it was). Only an `open` order on THIS node may
 * change; a `settled`/`abandoned` order, an absent id, another tenant's order (RLS hides it), or a
 * same-tenant order parked on ANOTHER node all throw `working_order.not_open`.
 *
 * The row is taken `for update` so a concurrent update/abandon/pay cannot race this read-modify-write
 * of its lines; the `status` is read off THAT locked row rather than added to the `WHERE`, so an
 * order that exists but is closed is told apart from one that never existed only inside the tx — both
 * still surface the one `working_order.not_open`, the fail-closed shape that code's note describes.
 * The UPDATE writes neither `order_number` nor `node_id` (they are fixed at park); `node_id` is only
 * READ, in the lock predicate below.
 *
 * Node-scoped (`node_id = cfg.nodeId` in the lock predicate), consistent with `getHeldOrder` and
 * `abandonHeldOrder`: an edit follows a retrieve which follows the node-scoped `listHeldOrders`, so a
 * same-tenant order parked on ANOTHER node is refused `working_order.not_open` (fail-closed) rather
 * than found and rewritten. RLS still confines the row to the tenant on top of that. The whole by-id
 * family moved to this fail-closed posture together (7b).
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

      // Lock the order row for the life of the tx, then read its status off the locked copy. Absent,
      // on another node, or not-open → `working_order.not_open`; the DB triggers (enforce_transition on
      // the label update, require_open_parent on the line delete/insert) are the backstop if this app
      // check is ever wrong. `node_id` joins `id` in the lock predicate (node scope, the by-id family);
      // `status` stays off the WHERE so a closed order is told from an absent one only inside the tx.
      const [order] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(and(eq(workingOrders.id, id), eq(workingOrders.nodeId, cfg.nodeId)))
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
 * `set status = 'abandoned' where id = … and status = 'open' and node_id = …` — so the open-and-on-this-
 * node guard IS the write: a `settled`/`abandoned` order, an absent id, another tenant's order (RLS
 * hides it), or a same-tenant order on another node all match no row, and the empty `returning` throws
 * `working_order.not_open`. No `settled_at` is set — abandoned is not settled, and the `settled_at`
 * biconditional (0004) requires it stay NULL.
 *
 * Node-scoped (`node_id = cfg.nodeId`), matching `updateHeldOrder`/`getHeldOrder` — the whole by-id
 * family fails closed on a foreign-node id. PGlite proves this state machine (the conditional update
 * and the trigger); RLS cross-tenant isolation is Task 7's real-Postgres suite.
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
        .where(
          and(
            eq(workingOrders.id, id),
            eq(workingOrders.status, "open"),
            eq(workingOrders.nodeId, cfg.nodeId),
          ),
        )
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
 * transaction, so the transition, the genesis amendment and the kitchen fire commit as one unit (or
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

      // Placing = firing to the kitchen (KDS-1 §3b): one `ticket_items` row per line, each routed to a
      // station (product ?? category ?? default) SNAPSHOTTED at fire time, replacing #63's single
      // `order_prep` row per order. Read the order's lines (id + product, in line order) and fire them;
      // ticket items advance queued → preparing → ready freely even after the order is fiscally frozen,
      // so they live in their own MUTABLE table, as `order_prep` did.
      const firedLines = await tx
        .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      await fireLines(tx, cfg, id, firedLines);

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
 * Fire a SETTLED order's lines to the kitchen (KDS-1 §3b) — the Mode-P counterpart to `placeOrder`'s
 * own fire. Modes I/T fire INSIDE `placeOrder` (open → placed), because placing is where their order
 * becomes an order of record. Mode P (prepay) never places at all — it pays and issues at ORDER via
 * `payWorkingOrder` (open → settled, no placed state) — so its order has no `placeOrder` call to fire
 * from, and this is that pickup: called once the order is already `settled`.
 *
 * The order's status IS checked first, and enforced: an id naming NO working order (absent, or another
 * tenant's — RLS hides it), or one that is `open` (never paid) or `placed` (Modes I/T's own route,
 * `placeOrder`, already fired at placing — sending it here too would be the wrong path), all refuse with
 * the domain `working_order.not_settled` (409) BEFORE any write.
 *
 * Past that guard it fires the order's lines through the shared {@link fireLines} — one `ticket_items`
 * row per line, each routed to a station (product ?? category ?? default) SNAPSHOTTED at fire time
 * (§2b). A double send-to-prep re-fires already-fired lines and collides on `ticket_items`'
 * `(tenant_id, working_order_line_id)` unique — the structural one-item-per-line guard; KDS-1 mints no
 * domain code for that collision (spec §6 removes `order_prep.invalid_transition`'s throw sites with the
 * rework and adds only `station.*` + the `ticket.invalid_transition` advance code), so the route rework
 * (Task 7) owns any re-fire surface.
 */
export async function sendToPrep(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    // Only a SETTLED order is eligible — `settled` is terminal, so there is no race between this read
    // and the fire below that could invalidate it. Absent, foreign (RLS-hidden), `open` and `placed`
    // orders all match the SAME `undefined`/non-settled branch, one fail-closed code.
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }

    // Fire the settled order's lines to the kitchen: read them (id + product, in line order) and insert
    // one ticket item per line, station resolved + snapshotted — the same fire `placeOrder` runs at
    // placing.
    const firedLines = await tx
      .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, id, firedLines);
  });
}

/** The kitchen state a ticket item advances through (KDS-1 §2d) — `queued → preparing → ready`, from
 *  the `ticket_state` enum (the successor to `order_prep`'s dropped `prep_state`). */
export type TicketState = (typeof ticketState.enumValues)[number];

/**
 * Advance ONE ticket item one kitchen step (KDS-1 §3c): `queued → preparing → ready`. Each branch is a
 * single conditional UPDATE — `set state = to, <to>_at = now() where id = itemId and state = <the one
 * legal predecessor of to>` — so the legality of the move IS the write: a skip (`queued → ready`), a
 * repeat, a jump backwards, or an absent/foreign item (RLS hides another tenant's) all match no row, and
 * the empty `returning` throws `ticket.invalid_transition` naming the offending item. The per-line
 * successor to #63's order-level `advancePrep`, over `ticket_items` — the same fail-closed
 * conditional-UPDATE shape `advancePrep` used over `order_prep`, and the shape `abandonHeldOrder` uses
 * for `working_orders`.
 *
 * `to = "queued"` is refused immediately, before any query: no kitchen state legally advances INTO
 * `queued` (reaching it is a FIRE's job — {@link fireLines}'s insert), so that case throws the same
 * domain code the empty-`returning` branch would. The switch (rather than a table keyed by a computed
 * column name) keeps each `.set()` fully typed against Drizzle's inferred update shape.
 *
 * Runs on the CALLER's transaction under its tenant/app_user scope; RLS confines the update to the
 * tenant and the item id addresses one row, so `_cfg` is unused (the tab-verb signature shape the route
 * calls uniformly) — underscore-prefixed the way {@link voidTabLine}/{@link markLineServed} keep it.
 * Advances freely regardless of the parent order's FISCAL status (a settled Mode-P order's lines still
 * cook), as `ticket_items` is a MUTABLE table separate from the frozen `working_orders` row.
 */
export async function advanceTicketItem(
  tx: Transaction,
  _cfg: TillConfig,
  itemId: string,
  to: TicketState,
): Promise<void> {
  let updated: { id: string }[];
  switch (to) {
    case "preparing":
      updated = await tx
        .update(ticketItems)
        .set({ state: to, preparingAt: sql`now()` })
        .where(and(eq(ticketItems.id, itemId), eq(ticketItems.state, "queued")))
        .returning({ id: ticketItems.id });
      break;
    case "ready":
      updated = await tx
        .update(ticketItems)
        .set({ state: to, readyAt: sql`now()` })
        .where(and(eq(ticketItems.id, itemId), eq(ticketItems.state, "preparing")))
        .returning({ id: ticketItems.id });
      break;
    case "queued":
    default:
      // No kitchen state advances TO queued — reaching it is a FIRE's job (fireLines' insert).
      throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }

  if (updated.length === 0) {
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
}

/**
 * Whole-ticket bump (KDS-1 §3c): advance EVERY not-yet-`to` line of one order at one station together —
 * the convenience the `bump_mode = 'ticket'` venue setting (and a "bump all" affordance) drives, over
 * the per-line {@link advanceTicketItem} truth. A single bulk conditional UPDATE — `set state = to,
 * <to>_at = now() where working_order_id = orderId and station_id = stationId and state = <the legal
 * predecessor of to>` — so it moves exactly the items still AT that predecessor and leaves the rest
 * untouched (a line already `ready` is not at `queued`, so a `to = "preparing"` bump skips it). Unlike
 * the per-line verb it does NOT throw on an empty match: bumping a ticket whose lines have all already
 * advanced is a no-op convenience, not an illegal move (there is no single item to name in
 * `ticket.invalid_transition`).
 *
 * `to` is `"preparing" | "ready"` — the two forward targets; there is no whole-ticket move INTO `queued`
 * (a fire, not a bump, reaches it), so unlike the per-line verb this needs no runtime `queued` guard,
 * and the type forbids it at the call site. Runs on the CALLER's transaction under its tenant/app_user
 * scope; RLS confines the update to the tenant, and the (orderId, stationId) pair addresses one node's
 * items (a working order is node-local), so `_cfg` is unused — the uniform tab-verb signature shape.
 */
export async function advanceTicket(
  tx: Transaction,
  _cfg: TillConfig,
  orderId: string,
  stationId: string,
  to: Exclude<TicketState, "queued">,
): Promise<void> {
  const predecessor: TicketState = to === "preparing" ? "queued" : "preparing";
  const stamp = to === "preparing" ? { preparingAt: sql`now()` } : { readyAt: sql`now()` };
  await tx
    .update(ticketItems)
    .set({ state: to, ...stamp })
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.stationId, stationId),
        eq(ticketItems.state, predecessor),
      ),
    );
}

/** One ticket item on a station's queue — its id (the bump target for {@link advanceTicketItem}), the
 *  line it was fired from, and its current kitchen state. */
export interface StationQueueItem {
  id: string;
  workingOrderLineId: string;
  state: TicketState;
}

/** One order's lines at a station, grouped for the per-station display (KDS-1 §3c) — the order's id and
 *  operator label, the `queued_at` of its OLDEST line at this station (the group's oldest-first ordering
 *  key + elapsed-time anchor), and the lines themselves. */
export interface StationQueueGroup {
  orderId: string;
  orderNumber: number;
  label: string | null;
  queuedAt: string;
  items: StationQueueItem[];
}

/**
 * The per-station kitchen queue (KDS-1 §3c) — this node's ticket items AT `stationId`, joined to their
 * working order for the display fields and GROUPED BY ORDER (each group = one order's lines at this
 * station), oldest order first. The per-line/per-station successor to #63's order-level `listPrepQueue`,
 * over `ticket_items` rather than `order_prep`.
 *
 * Two order-level exclusions, mirroring `listPrepQueue`'s abandoned filter and adding the collect
 * handover: an `abandoned` working order (`ne(status, "abandoned")` — a cancelled placed order's items
 * are cascaded only if the LINE is deleted, so the status join is what retires a still-present item's
 * order, as `listPrepQueue` relied on) and a COLLECTED order (`collected_at IS NULL` — the default-station
 * display drops an order once handed to the customer, §3e) both drop out. Ticket items are NOT filtered
 * by state: a `ready` line stays on the display until its order collects, so the group carries the
 * order's queued/preparing/ready lines alike (the Nuevo/Preparando/Listo columns are a client lens).
 *
 * Ordered by `ticket_items.queued_at` ascending, so within the grouping the oldest line seen for an
 * order fixes that group's position (oldest-first) and its `queuedAt`. Node-scoped
 * (`node_id = cfg.nodeId`) exactly as `listPrepQueue` was — the queue is one node's — so `cfg` is used
 * here (unlike the advance verbs). Runs on the CALLER's transaction under its tenant/app_user scope; RLS
 * confines the tenant. PGlite proves the join, the exclusions, the grouping and the ordering; the
 * node/tenant SCOPING is real-Postgres's job (working-order.rls.test.ts), the same split `listPrepQueue`
 * used (CLAUDE.md §4).
 */
export async function listStationQueue(
  tx: Transaction,
  cfg: TillConfig,
  stationId: string,
): Promise<StationQueueGroup[]> {
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
    })
    .from(ticketItems)
    // Composite join predicate (tenant_id too) — the tenant-consistency `listPrepQueue`'s own join
    // enforced, matching the composite shape the ticket_items → working_order_lines FK carries.
    .innerJoin(
      workingOrders,
      and(
        eq(ticketItems.workingOrderId, workingOrders.id),
        eq(ticketItems.tenantId, workingOrders.tenantId),
      ),
    )
    .where(
      and(
        eq(ticketItems.nodeId, cfg.nodeId),
        eq(ticketItems.stationId, stationId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    .orderBy(ticketItems.queuedAt);

  // Group by order, preserving first-seen (= oldest queued_at) order — the Map keeps insertion order,
  // so the returned groups are oldest-order-first and each group's `queuedAt` is its oldest line's.
  const groups = new Map<string, StationQueueGroup>();
  for (const row of rows) {
    let group = groups.get(row.orderId);
    if (group === undefined) {
      group = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        label: row.label,
        queuedAt: row.queuedAt,
        items: [],
      };
      groups.set(row.orderId, group);
    }
    group.items.push({
      id: row.itemId,
      workingOrderLineId: row.workingOrderLineId,
      state: row.state,
    });
  }
  return [...groups.values()];
}

/** One row of the occupancy read-model (design §4). The raw signals (`hasOpenTab`, `pendingDeliveries`)
 *  are exposed alongside the rolled-up `state` so the floor plan can render a richer badge. */
export interface TableState {
  id: string;
  label: string;
  /** The `floor_zones` row this table sits in (FP-1), or null — the successor to the former free-text
   *  `zone` string (a composite FK to `floor_zones`, not an arbitrary label). */
  zoneId: string | null;
  capacity: number | null;
  state: "free" | "open-tab" | "delivery-pending";
  hasOpenTab: boolean;
  tabId?: string;
  tabLineCount?: number;
  /** The open tab's gross draft total (sum of `line_total`), numeric(12,2) as text — present iff a tab. */
  tabTotal?: string;
  pendingDeliveries: number;
  /** Count of the open tab's lines STILL to serve (`working_order_lines` with `served_at IS NULL`), for
   *  the floor screen's "N still to serve" badge (FP-1). `0` for a free table (no open tab) — the
   *  LEFT-join branch. DISTINCT from `pendingDeliveries` (uncollected counter deliveries to this table);
   *  both are kept. */
  pendingToServe: number;
  /** Count of the open tab's lines that are KITCHEN-DONE but NOT yet carried out — the ticket item is
   *  `ready` AND the line's `served_at IS NULL` (KDS-1 §3d, the floor's "N listos"). DISTINCT from
   *  `pendingToServe` (unserved lines regardless of kitchen state) and from `pendingDeliveries` (counter
   *  deliveries): a line is counted here only in the window between the kitchen bumping it `ready` and the
   *  waiter marking it served. `0` for a free table (no open tab — the LEFT-join branch). */
  readyToServe: number;
  /** The table's MANUAL service status (design §4), or null. Independent of occupancy — a `free` table
   *  may carry one. Joined from `table_service_statuses` on `dining_tables.status_id`. */
  status: { id: string; label: string; color: string } | null;
  /** FP-2 spatial placement on the floor-plan canvas — canvas coordinates, rendered shape, and
   *  rotation in degrees, or `null` for an unplaced table. Written by `setTablePlacement` /
   *  `clearPlacement`. Non-optional `| null` (unconditionally present, `null` when unplaced), matching
   *  the `zoneId`/`capacity`/`status` siblings above rather than the conditionally-spread `tab*`
   *  fields below — so the canvas can read a placement field without a presence check. */
  posX: number | null;
  posY: number | null;
  shape: FloorTableShape | null;
  rotation: number | null;
}

/**
 * The venue's ACTIVE tables with their DERIVED occupancy (design §4). ONE location-scoped query: each
 * table LEFT JOINs its at-most-one OPEN tab — the order its own `tab_id` back-pointer names, filtered to
 * `status = 'open'` (a `tab_id` pointing at a settled/abandoned order finds nothing here and reads free,
 * design §2b) — with a line count + gross total, plus a count of pending deliveries (orders with
 * `delivery_table_id` = this table that were FIRED to the kitchen — a `ticket_items` row exists — and are
 * not yet collected (`working_orders.collected_at IS NULL`) nor `abandoned`). This is the KDS-1 successor
 * to the dropped `order_prep` join (§2d/§3e): `EXISTS(ticket_items)` replaces "has a prep row" and
 * `collected_at` replaces `order_prep.state = 'collected'`, so an instant handover that was never fired
 * (no ticket item — e.g. a walk-up counter delivery) leaves no lingering occupancy, exactly as a
 * no-prep-row handover did. Task 6 wires the collect flow to SET `collected_at`; this read only consumes
 * it (nothing sets it yet, so a fired delivery stays pending until Task 6 lands — acceptable pre-production).
 *
 * Precedence for the rolled-up `state`: open-tab dominates delivery-pending dominates free. Runs as the
 * app role under the caller's tenant scope (RLS), so it gathers orders across NODES by construction (a
 * table lives at the venue, not the register). `locationId` defaults to the till's own.
 */
export async function listTablesWithState(
  tx: Transaction,
  cfg: TillConfig,
  locationId?: string,
): Promise<TableState[]> {
  const loc = locationId ?? cfg.locationId;
  const result = await tx.execute<{
    id: string;
    label: string;
    zone_id: string | null;
    capacity: number | null;
    tab_id: string | null;
    tab_line_count: number;
    tab_total: string | null;
    pending_to_serve: number;
    ready_to_serve: number;
    pending_deliveries: number;
    status_id: string | null;
    status_label: string | null;
    status_color: string | null;
    pos_x: number | null;
    pos_y: number | null;
    shape: FloorTableShape | null;
    rotation: number | null;
  }>(sql`
    select
      dt.id, dt.label, dt.zone_id, dt.capacity,
      dt.pos_x, dt.pos_y, dt.shape, dt.rotation,
      tab.id as tab_id,
      coalesce(tab.line_count, 0)::int as tab_line_count,
      tab.tab_total,
      coalesce(tab.pending_to_serve, 0)::int as pending_to_serve,
      coalesce(tab.ready_to_serve, 0)::int as ready_to_serve,
      coalesce(del.pending, 0)::int as pending_deliveries,
      tss.id as status_id, tss.label as status_label, tss.color as status_color
    from dining_tables dt
    left join lateral (
      select wo.id,
             count(wol.id)::int as line_count,
             (count(wol.id) filter (where wol.served_at is null))::int as pending_to_serve,
             -- KDS-1 section 3d "N listos": lines the kitchen has bumped ready but the waiter has not
             -- yet carried out (served_at is null). The ticket item is joined 1:1 on the line -- its
             -- (tenant_id, working_order_line_id) UNIQUE gives at most one ti per wol, so this LEFT JOIN
             -- neither multiplies wol rows (line_count / tab_total stay correct) nor double-counts. An
             -- unfired or not-yet-ready line has ti.state null or != 'ready' and is excluded by the filter.
             (count(*) filter (where ti.state = 'ready' and wol.served_at is null))::int as ready_to_serve,
             coalesce(sum(wol.line_total), 0)::numeric(12, 2)::text as tab_total
      from working_orders wo
      left join working_order_lines wol
        on wol.working_order_id = wo.id and wol.tenant_id = wo.tenant_id
      left join ticket_items ti
        on ti.working_order_line_id = wol.id and ti.tenant_id = wol.tenant_id
      where wo.tenant_id = dt.tenant_id and wo.id = dt.tab_id and wo.status = 'open'
      group by wo.id
    ) tab on true
    left join lateral (
      select count(*)::int as pending
      from working_orders d
      where d.tenant_id = dt.tenant_id and d.delivery_table_id = dt.id
        and d.status <> 'abandoned' and d.collected_at is null
        and exists (
          select 1 from ticket_items ti
          where ti.tenant_id = d.tenant_id and ti.working_order_id = d.id
        )
    ) del on true
    left join table_service_statuses tss
      on tss.tenant_id = dt.tenant_id and tss.id = dt.status_id
    where dt.location_id = ${loc} and dt.active = true
    order by dt.label
  `);

  return result.rows.map((r) => {
    const hasOpenTab = r.tab_id !== null;
    const pendingDeliveries = Number(r.pending_deliveries);
    const state: TableState["state"] = hasOpenTab
      ? "open-tab"
      : pendingDeliveries > 0
        ? "delivery-pending"
        : "free";
    return {
      id: r.id,
      label: r.label,
      zoneId: r.zone_id,
      capacity: r.capacity,
      state,
      hasOpenTab,
      pendingToServe: Number(r.pending_to_serve),
      readyToServe: Number(r.ready_to_serve),
      pendingDeliveries,
      status:
        r.status_id !== null
          ? { id: r.status_id, label: r.status_label!, color: r.status_color! }
          : null,
      // Unconditionally present, null when unplaced (the smallint/enum columns return null directly).
      posX: r.pos_x,
      posY: r.pos_y,
      shape: r.shape,
      rotation: r.rotation,
      ...(hasOpenTab
        ? { tabId: r.tab_id!, tabLineCount: Number(r.tab_line_count), tabTotal: r.tab_total! }
        : {}),
    };
  });
}
