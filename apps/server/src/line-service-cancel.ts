import { eq } from "drizzle-orm";
import {
  lineServiceCancellations,
  nowIso,
  ticketItems,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { decimal, divideDecimal, multiplyDecimal } from "@waitron/shared";
import type { DishKitchenItem } from "./dish-kitchen.js";
import type { TradingContext } from "./trading-context.js";
import { enqueueCorrectionSlips, isStarted } from "./kitchen-print.js";

type Line = typeof workingOrderLines.$inferSelect;
type Cancellation = typeof lineServiceCancellations.$inferSelect;

export function serviceCancellationFamilies(
  rows: readonly Line[],
  taken: readonly { dish: Line; off: number }[],
  priors: readonly Cancellation[],
) {
  const rowsByDish = new Map<string, Line[]>();
  for (const row of rows) {
    const id = row.parentLineId ?? row.id;
    const family = rowsByDish.get(id) ?? [];
    family.push(row);
    rowsByDish.set(id, family);
  }
  const priorByDish = new Map(priors.map((prior) => [prior.lineId, prior]));
  return taken.map(({ dish, off }) => {
    const prior = priorByDish.get(dish.id);
    const quantity = off + (prior?.quantity ?? 0);
    const shareOf = (row: Line, of: number) =>
      row.id === dish.id
        ? of
        : Number(
            divideDecimal(
              multiplyDecimal(decimal(String(row.quantity)), decimal(String(of))),
              decimal(String(dish.quantity)),
              0,
            ),
          );
    return {
      dish,
      prior,
      quantity,
      family: (rowsByDish.get(dish.id) ?? [dish]).map((row) => ({
        row,
        remaining: row.quantity - shareOf(row, quantity),
        covered: shareOf(row, off),
      })),
    };
  });
}

type Family = ReturnType<typeof serviceCancellationFamilies>[number];

export async function enqueueServiceCancellation(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  families: readonly Family[],
  work: ReadonlyMap<string, readonly DishKitchenItem[]>,
  preparationStarted = false,
) {
  const corrections = families.flatMap(({ dish, family }) =>
    family.flatMap(({ row, remaining }) => {
      const item = (work.get(dish.id) ?? []).find((item) => item.workingOrderLineId === row.id);
      const corrected =
        item === undefined ? 0 : item.firedQuantity - Math.min(item.firedQuantity, remaining);
      return corrected === 0
        ? []
        : [
            {
              dish,
              requested: item!.requestedAt !== null && item!.firedAt === null,
              requestedAt: item!.requestedAt,
              item: {
                workingOrderLineId: row.id,
                stationId: item!.stationId,
                quantity: corrected,
                wasStarted: preparationStarted || isStarted(item!.state),
                fired: item!.firedAt !== null,
              },
            },
          ];
    }),
  );
  await enqueueCorrectionSlips(
    tx,
    cfg,
    billId,
    corrections.filter(({ item }) => item.fired).map(({ item }) => item),
    "VOID",
  );
  return corrections;
}

export async function writeServiceCancellations(
  tx: Transaction,
  families: readonly Family[],
  operatorId: string,
  started: boolean,
): Promise<void> {
  for (const { family } of families) {
    for (const { row, remaining } of family) {
      const servedQuantity = Math.min(row.servedQuantity, remaining);
      const servedAt =
        servedQuantity > 0 && servedQuantity === remaining ? (row.servedAt ?? nowIso()) : null;
      if (servedQuantity !== row.servedQuantity || servedAt !== row.servedAt)
        await tx
          .update(workingOrderLines)
          .set({ servedQuantity, servedAt })
          .where(eq(workingOrderLines.id, row.id));
      if (remaining === 0)
        await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, row.id));
      else
        await tx
          .update(ticketItems)
          .set({ quantity: remaining })
          .where(eq(ticketItems.workingOrderLineId, row.id));
    }
  }
  for (const { dish, prior, quantity } of families) {
    const values = {
      quantity,
      cancelledAt: nowIso(),
      wasStarted: prior?.wasStarted === true || started,
      actorId: operatorId,
    };
    await tx
      .insert(lineServiceCancellations)
      .values({ lineId: dish.id, ...values })
      .onConflictDoUpdate({ target: lineServiceCancellations.lineId, set: values });
  }
}
