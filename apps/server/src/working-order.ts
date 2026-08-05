// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-sale.ts`/`till-config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  allocateOrderNumber,
  asAppUser,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { listAvailableProducts, priceBasket } from "@waitron/catalogue";
import type { TillConfig } from "./till-config.js";

export interface WorkingOrderDeps {
  db: Database;
}

/** The rows a park or an update writes into `working_order_lines`, as Drizzle types the insert. */
type WorkingOrderLineInsert = typeof workingOrderLines.$inferInsert;

/**
 * Re-read THIS location's sellable catalogue, resolve every requested line against it, and price the
 * basket authoritatively with `priceBasket` — returning the ready-to-insert `working_order_lines`
 * rows for `workingOrderId`. Shared by `parkOrder` (a fresh order) and `updateHeldOrder` (a repriced
 * one): the server never trusts a browser-computed price, so the caller's `lines` carry none, and a
 * product not sellable here (deactivated, unassigned, or another tenant's, which RLS hides) is
 * refused with the same `sale.unknown_product` `recordTillSale` uses — a fact about the order, not
 * the process. Runs on the CALLER's transaction under its tenant/app_user scope.
 *
 * The empty-basket refusal and the order row itself stay with each caller: park mints and inserts an
 * OPEN order (allocating its number), update rewrites an existing one's lines and label — this helper
 * owns only the lines, which are identical between the two. `priced.lines` is in `lines` order
 * (priceBasket iterates in order and stamps `lineNo = i + 1`), so row `i` takes its `product_id` from
 * `lines[i]`; everything else is the display snapshot priceBasket produced.
 */
async function priceOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  lines: { productId: string; quantity: string }[],
): Promise<WorkingOrderLineInsert[]> {
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
  return priced.lines.map((line, i) => ({
    tenantId: cfg.tenantId,
    workingOrderId,
    lineNo: line.lineNo,
    productId: lines[i]!.productId,
    descriptions: line.descriptions,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    vatRate: line.vatRate,
    lineTotal: line.lineTotal,
    category: line.category ?? null,
  }));
}

/**
 * A working order the counter parks to retrieve and pay later (park & retrieve, sub-project 7b). Like
 * `TillSaleRequest`, it carries NO price of any kind — the server re-reads the catalogue and prices
 * authoritatively (`priceBasket`), so a browser cannot influence the snapshot the draft carries.
 *
 * `id` is client-supplied: the till mints the working-order uuid so the same request can be retried
 * idempotently against `working_orders.id`'s primary key without minting a second order. `quantity`
 * is a count for an `each` product and a measured kg weight for a `weight` product.
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
 * Park a working order: re-read the catalogue, re-price with `priceBasket`, allocate the next per-node
 * order number, and persist an OPEN `working_orders` row plus its priced `working_order_lines` — all
 * inside ONE `withTenant`/`asAppUser` transaction, so the order and every line commit as a single unit
 * (or roll back together, leaving nothing parked). The server never trusts a browser-computed price;
 * `req` carries none. The persisted line keeps `product_id` (a pricing INPUT a later repricing
 * re-resolves) alongside the frozen display snapshot (`descriptions`, `unit_price`, `vat_rate`,
 * `line_total`, `category`) that came straight from `priceBasket`.
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

    // Resolve + price the basket authoritatively (refusing an unknown product) into the line rows —
    // the block `updateHeldOrder` shares. `priceOrderLines`'s own doc-comment explains the zip.
    const lineRows = await priceOrderLines(tx, cfg, req.id, req.lines);
    const orderNumber = await allocateOrderNumber(tx, cfg.tenantId, cfg.nodeId);

    await tx.insert(workingOrders).values({
      id: req.id,
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      nodeId: cfg.nodeId,
      orderNumber,
      label: req.label ?? null,
      status: "open",
    });

    // The parent order was inserted just above, so the composite FK and the
    // `require_open_parent`/`check_locales` triggers all resolve it.
    await tx.insert(workingOrderLines).values(lineRows);

    return { id: req.id, orderNumber };
  });
}

/** One row of the held-orders list the counter shows to retrieve a parked order. */
export interface HeldOrderSummary {
  id: string;
  orderNumber: number;
  /** The operator-supplied label ("Mesa 4"), or null when the order was parked without one. */
  label: string | null;
  /** Number of lines on the order (`count(*)`), a whole number. */
  itemCount: number;
  /** Sum of the lines' `line_total` (net base), a numeric(12,2) as text — the codebase's money shape. */
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
 * cross-till held list any register on the node shows. `total` is the summed `line_total` and
 * `itemCount` the line count, from a LEFT JOIN aggregate so an order with no lines would still list
 * (`total` coalesced to 0); ordered by the human `order_number` the counter types back in.
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
    const lineRows = await priceOrderLines(tx, cfg, id, req.lines);
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
