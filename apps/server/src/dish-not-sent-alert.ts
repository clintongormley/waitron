import { eq, inArray } from "drizzle-orm";
import {
  isRefusal,
  NOT_NULL_VIOLATION,
  products,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { AppError, saleId as brandSaleId } from "@waitron/shared";
import type { Logger } from "./logger.js";
import type { OriginConfig } from "./till-config.js";
import "./errors.js";

/** The dishes of a paid order that no prep station could take. */
export interface DishesNotSent {
  /** In line order; a product may appear more than once. */
  productIds: readonly string[];
}

/**
 * Record one alert for a paid sale whose dishes were not sent to the kitchen, naming each dish once
 * by its staff name and naming the device that took the payment. Keyed by the sale, since the
 * incidents table keeps one open incident per source, device, code and sale. Called after the order
 * is settled, so it reads the label the sale froze. An alert the database refuses is logged under
 * its code instead.
 */
export async function raiseDishesNotSent(
  tx: Transaction,
  cfg: Pick<OriginConfig, "origin">,
  saleId: string,
  workingOrderId: string,
  notSent: DishesNotSent,
  now: Date,
  log: Logger | undefined,
): Promise<void> {
  try {
    await recordDishesNotSent(tx, cfg, saleId, workingOrderId, notSent, now);
  } catch (error) {
    // A refusal backs out the statement alone, so the sale still commits; why that holds is at
    // `clearBillRequestIfPaid` (`./bill-request.ts`). Anything else fails the sale.
    if (!isRefusal(error, ALERT_REFUSALS)) throw error;
    // The alert's code: scripts/alert-codes.test.ts reads any dotted name here as an alert code.
    log?.("error", "route.dish_not_sent", {
      saleId,
      workingOrderId,
      productIds: [...new Set(notSent.productIds)],
      error: String(error),
    });
  }
}

const ALERT_REFUSALS = [...TRIGGER_ABORT, ...UNIQUE_VIOLATION, ...NOT_NULL_VIOLATION];

async function recordDishesNotSent(
  tx: Transaction,
  cfg: Pick<OriginConfig, "origin">,
  saleId: string,
  workingOrderId: string,
  notSent: DishesNotSent,
  now: Date,
): Promise<void> {
  const ids = [...new Set(notSent.productIds)];
  const rows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.id, ids));
  const nameOf = new Map(rows.map((row) => [row.id, row.name]));
  const [order] = await tx
    .select({ orderNumber: workingOrders.orderNumber, label: workingOrders.label })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  await recordIncidentOnce(tx, {
    origin: cfg.origin,
    saleId: brandSaleId(saleId),
    error: new AppError("route.dish_not_sent", {
      // `products.name` is not null but may be blank.
      dishes: ids.map((id) => nameOf.get(id) || id).join(", "),
      workingOrderId,
      orderNumber: order!.orderNumber,
      orderLabel: order!.label,
    }),
    severity: "error",
    detectedAt: now,
  });
}
