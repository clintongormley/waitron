import { eq, inArray } from "drizzle-orm";
import { floorZones, products, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordIncident } from "@waitron/core";
import { AppError, saleId as brandSaleId } from "@waitron/shared";
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
 * code and sale. Called after the order is settled, so it reads the label the sale froze.
 */
export async function raiseDishesNotSent(
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
  await recordIncident(tx, {
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
