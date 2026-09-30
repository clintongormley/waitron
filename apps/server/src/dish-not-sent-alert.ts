import { eq, inArray } from "drizzle-orm";
import {
  floorZones,
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
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/** The dishes of a paid order that no kitchen station could take, and the zone it was sold in. */
export interface DishesNotSent {
  zoneId: string;
  /** In line order; a product may appear more than once. */
  productIds: readonly string[];
}

/**
 * Record one alert for a paid sale whose dishes were not sent to the kitchen, naming each dish once
 * by its staff name. Keyed by the sale, since the incidents table keeps one open incident per till,
 * code and sale. Called after the order is settled, so it reads the label the sale froze. An alert
 * the database refuses is logged under its code instead.
 */
export async function raiseDishesNotSent(
  tx: Transaction,
  cfg: Pick<TillConfig, "tillId">,
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
      zoneId: notSent.zoneId,
      productIds: [...new Set(notSent.productIds)],
      error: String(error),
    });
  }
}

const ALERT_REFUSALS = [...TRIGGER_ABORT, ...UNIQUE_VIOLATION, ...NOT_NULL_VIOLATION];

async function recordDishesNotSent(
  tx: Transaction,
  cfg: Pick<TillConfig, "tillId">,
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
  const [zone] = await tx
    .select({ name: floorZones.name })
    .from(floorZones)
    .where(eq(floorZones.id, notSent.zoneId));
  const [order] = await tx
    .select({ orderNumber: workingOrders.orderNumber, label: workingOrders.label })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  await recordIncidentOnce(tx, {
    tillId: cfg.tillId,
    saleId: brandSaleId(saleId),
    error: new AppError("route.dish_not_sent", {
      zoneId: notSent.zoneId,
      zoneName: zone!.name,
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
