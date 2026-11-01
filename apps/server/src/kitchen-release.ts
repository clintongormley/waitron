import { kitchenStations, type Transaction } from "@waitron/db";
import { and, eq, inArray } from "drizzle-orm";

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
