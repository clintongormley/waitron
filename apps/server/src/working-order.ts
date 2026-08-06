// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-sale.ts`/`till-config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  allocateOrderNumber,
  appendOrderAmendment,
  asAppUser,
  orderPrep,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { listAvailableProducts, priceBasket } from "@waitron/catalogue";
import type { TillConfig } from "./till-config.js";
import type { TillSaleDeps } from "./till-sale.js";

export interface WorkingOrderDeps {
  db: Database;
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
): Promise<{ orderNumber: number; priced: PricedBasket }> {
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
  });

  // The parent order was inserted just above, so the composite FK and the
  // `require_open_parent`/`check_locales` triggers all resolve it.
  await tx.insert(workingOrderLines).values(lineRows);

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

  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    // Park needs only the allocated number; `priced` is `payWorkingOrder`'s walk-up shortcut, unused here.
    const { orderNumber } = await createOpenOrder(tx, cfg, req.id, req.lines, req.label ?? null);
    return { id: req.id, orderNumber };
  });
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
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
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
  });
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
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    const updated = await tx
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")))
      .returning({ id: workingOrders.id });

    if (updated.length === 0) {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }
  });
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
 * This is the Mode-T / generic placing: it files NO fiscal document here (design §3's state-machine
 * table). Task 8 adds the mode dispatch — Mode I files `recordSale` deferred and Mode P files + settles
 * — which is why `deps` is the fuller `TillSaleDeps` (its `backend` is unused in Task 7). The order is
 * locked `for update` and its status read off the locked row: a non-`open` order (already
 * placed/settled/abandoned, or absent / another tenant's, RLS-hidden) fails closed with
 * `working_order.not_open`, the same shape `payWorkingOrder`/`updateHeldOrder` use for the modify side.
 * Placing is NOT idempotent in Task 7 — Mode-I double-place idempotency (via `sales_working_order_id_key`)
 * arrives with the mode dispatch.
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
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
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

    // Mode T / generic placing files no fiscal document here (design §3). Mode I files `recordSale`
    // deferred and Mode P files + settles — both added in Task 8's mode dispatch, in this same spot.
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

    return { id, status: "placed" };
  });
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
 * `working_order.reason_required` — deliberately its OWN code, not `working_order.not_placed`: at this
 * point the order genuinely IS placed, so reporting "not placed" would be a false label (CLAUDE.md §1).
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
  // appends a reasonless entry. Its own code — the order IS placed, so `not_placed` would be false (§1).
  if (reason.trim() === "") {
    throw new AppError("working_order.reason_required", { workingOrderId: id });
  }

  return withTenant(deps.db, cfg.tenantId, async (tx) => {
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
  });
}
