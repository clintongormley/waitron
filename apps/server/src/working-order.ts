// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-sale.ts`/`till-config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  allocateOrderNumber,
  asAppUser,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { listAvailableProducts, priceBasket } from "@waitron/catalogue";
import type { TillConfig } from "./till-config.js";

export interface ParkOrderDeps {
  db: Database;
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
  deps: ParkOrderDeps,
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

    // Re-read the sellable catalogue for THIS location and resolve every requested line against it;
    // a product not sellable here (deactivated, unassigned, or another tenant's, which RLS hides) is
    // refused with the same `sale.unknown_product` `recordTillSale` uses — a fact about the order,
    // not the process. Resolving here also gives `priceBasket` the authoritative product to price.
    const available = await listAvailableProducts(tx, cfg.locationId);
    const byId = new Map(available.map((p) => [p.id, p]));
    const items = req.lines.map((line) => {
      const product = byId.get(line.productId);
      if (product === undefined) {
        throw new AppError("sale.unknown_product", { productId: line.productId });
      }
      return { product, quantity: line.quantity };
    });

    const priced = priceBasket(items);
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

    // `priced.lines` is in `req.lines` order (priceBasket iterates `items` in order and stamps
    // `lineNo = i + 1`), so line `i` takes its `product_id` from `req.lines[i]`. Everything else is the
    // display snapshot priceBasket produced; the parent order was inserted just above, so the FK and
    // the `require_open_parent`/`check_locales` triggers all resolve it.
    await tx.insert(workingOrderLines).values(
      priced.lines.map((line, i) => ({
        tenantId: cfg.tenantId,
        workingOrderId: req.id,
        lineNo: line.lineNo,
        productId: req.lines[i]!.productId,
        descriptions: line.descriptions,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        lineTotal: line.lineTotal,
        category: line.category ?? null,
      })),
    );

    return { id: req.id, orderNumber };
  });
}
