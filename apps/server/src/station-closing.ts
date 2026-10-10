import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { ticketItems, workingOrderLines, workingOrders, type Transaction } from "@waitron/db";
import { invalid } from "./bill-allocation.js";
import { moveDishesToStation, stillMovable, type StationMover } from "./station-move.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";

export async function openDishCount(
  tx: Transaction,
  locationId: string,
  stationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(unfinishedAtStation(locationId, stationId));
  return row!.count;
}

function unfinishedAtStation(locationId: string, stationId: string) {
  return and(
    eq(workingOrders.locationId, locationId),
    eq(ticketItems.stationId, stationId),
    eq(ticketItems.madeHere, false),
    isNull(ticketItems.awayAt),
    gt(workingOrderLines.quantity, workingOrderLines.servedQuantity),
    ne(workingOrders.status, "abandoned"),
    isNull(workingOrders.collectedAt),
  );
}

export type OpenDishesChoice = "send" | "leave";

export function openDishesChoice(value: unknown): OpenDishesChoice | undefined {
  if (value === undefined) return undefined;
  if (value !== "send" && value !== "leave") throw invalid("openDishes");
  return value;
}

export async function withStationDishes(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  destination: string | undefined,
  choice: OpenDishesChoice | undefined,
  close: (at: Date) => Promise<void>,
  mover: StationMover,
): Promise<void> {
  const at = new Date();
  const dishes = await tx
    .select({
      id: ticketItems.id,
      orderId: ticketItems.workingOrderId,
      lineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      awayAt: ticketItems.awayAt,
      madeHere: ticketItems.madeHere,
      servedAt: workingOrderLines.servedAt,
      servedQuantity: workingOrderLines.servedQuantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(unfinishedAtStation(cfg.locationId, id));
  if (dishes.length > 0 && choice === undefined) throw invalid("openDishes");
  await close(at);
  if (choice === "send") {
    const byOrder = new Map<string, string[]>();
    for (const dish of dishes) {
      if (!stillMovable(dish, dish)) continue;
      const lines = byOrder.get(dish.orderId) ?? [];
      lines.push(dish.lineId);
      byOrder.set(dish.orderId, lines);
    }
    for (const [orderId, lineIds] of byOrder)
      await moveDishesToStation(
        tx,
        cfg,
        orderId,
        {
          submissionId: randomUUID(),
          stationId: destination!,
          lineIds,
        },
        mover,
      );
  } else if (choice === "leave" && dishes.length > 0) {
    await tx
      .update(ticketItems)
      .set({ stationChosenAt: at.toISOString(), stationRetainedAtRelease: true })
      .where(
        inArray(
          ticketItems.id,
          dishes.map((dish) => dish.id),
        ),
      );
  }
}

export async function disableWithDishes(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  body: Record<string, unknown>,
  disable: () => Promise<void>,
  mover: StationMover,
): Promise<void> {
  const choice = openDishesChoice(body.openDishes);
  const destination = body.sendsToStationId;
  const destinations = await VENUE_SERVICE.stationDestinations(tx, cfg, id, new Date());
  if (
    choice === "send" &&
    (typeof destination !== "string" || !destinations.some((row) => row.id === destination))
  )
    throw invalid("sendsToStationId");
  await withStationDishes(
    tx,
    cfg,
    id,
    typeof destination === "string" ? destination : undefined,
    choice,
    disable,
    mover,
  );
}
