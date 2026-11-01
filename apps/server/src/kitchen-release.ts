import { kitchenStations, ticketItems, type Transaction } from "@waitron/db";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { heldItem } from "./kitchen-phase.js";

/** The named stations that wait for the pass, inactive ones included. */
export async function passWaitingStations(
  tx: Transaction,
  stationIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (stationIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        inArray(kitchenStations.id, [...new Set(stationIds)]),
        eq(kitchenStations.waitsForPass, true),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** The stamps for one item a waiter's write places. Made here wins: such an item is released and
 *  ready at `at` whatever `initiated` and `waits` say. Otherwise: not initiated → held; initiated
 *  at a waiting station → Requested; initiated elsewhere → released. */
export function requestStamps(input: {
  at: string;
  initiated: boolean;
  madeHere: boolean;
  waits: boolean;
}): { requestedAt: string | null; firedAt: string | null; passControlled: boolean } {
  if (input.madeHere) return { requestedAt: input.at, firedAt: input.at, passControlled: false };
  if (!input.initiated) return { requestedAt: null, firedAt: null, passControlled: false };
  if (input.waits) return { requestedAt: input.at, firedAt: null, passControlled: true };
  return { requestedAt: input.at, firedAt: input.at, passControlled: false };
}

export interface StampedItem {
  workingOrderLineId: string;
  stationId: string;
  courseId: string | null;
  quantity: number | null;
}

/** Stamp the held items in `scope`: those at a waiting station Requested, the rest released. */
export async function requestHeldItems(
  tx: Transaction,
  orderId: string,
  scope: SQL,
  at: string,
): Promise<{ released: StampedItem[]; requested: StampedItem[] }> {
  const inScope = and(eq(ticketItems.workingOrderId, orderId), scope);
  const held = and(inScope, heldItem());
  const returned = {
    workingOrderLineId: ticketItems.workingOrderLineId,
    stationId: ticketItems.stationId,
    courseId: ticketItems.courseId,
    quantity: ticketItems.quantity,
  };
  const stations = await tx
    .selectDistinct({ stationId: ticketItems.stationId })
    .from(ticketItems)
    .where(held);
  const waiting = await passWaitingStations(
    tx,
    stations.map((row) => row.stationId),
  );
  const requested =
    waiting.size === 0
      ? []
      : await tx
          .update(ticketItems)
          .set({ requestedAt: at, passControlled: true })
          .where(and(held, inArray(ticketItems.stationId, [...waiting])))
          .returning(returned);
  const released = await tx
    .update(ticketItems)
    .set({ requestedAt: at, firedAt: at, queuedAt: at })
    .where(held)
    .returning(returned);
  return { released, requested };
}
