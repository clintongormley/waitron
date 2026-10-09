import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import type { VenueServiceContribution } from "@waitron/module";
import { businessDayStart, readLocationClock } from "@waitron/reporting";
import { thousandthsToDecimal } from "@waitron/shared";
import { kitchenNotices } from "@waitron/venue-service";

export type StationNotice = Awaited<
  ReturnType<VenueServiceContribution["listStationNotices"]>
>[number];

const NOTICE_LIMIT = 50;

/**
 * Each station's notices exactly as `VENUE_SERVICE.listStationNotices` answers them for that
 * station — the newest fifty unacknowledged ones of the business day, oldest first — for several
 * stations in one statement, the clock read once. Every station asked for has an entry.
 */
export async function listStationsNotices(
  tx: Transaction,
  cfg: { locationId: string },
  stationIds: readonly string[],
): Promise<Map<string, StationNotice[]>> {
  const byStation = new Map<string, StationNotice[]>(stationIds.map((id) => [id, []]));
  if (stationIds.length === 0) return byStation;
  const since = businessDayStart(new Date(), await readLocationClock(tx, cfg.locationId));
  const ranked = tx
    .select({
      id: kitchenNotices.id,
      stationId: kitchenNotices.stationId,
      workingOrderId: kitchenNotices.workingOrderId,
      orderLabel: kitchenNotices.orderLabel,
      kind: kitchenNotices.kind,
      lineName: kitchenNotices.lineName,
      unitName: kitchenNotices.unitName,
      soldInEach: kitchenNotices.soldInEach,
      quantity: kitchenNotices.quantity,
      note: kitchenNotices.note,
      wasStarted: kitchenNotices.wasStarted,
      movedTo: kitchenNotices.movedTo,
      direction: kitchenNotices.direction,
      cancelledExtra: kitchenNotices.cancelledExtra,
      reroutedTo: kitchenNotices.reroutedTo,
      createdAt: kitchenNotices.createdAt,
      newest:
        sql<number>`row_number() over (partition by ${kitchenNotices.stationId} order by ${kitchenNotices.createdAt} desc, "kitchen_notices"."rowid" desc)`.as(
          "newest",
        ),
    })
    .from(kitchenNotices)
    .innerJoin(kitchenStations, eq(kitchenStations.id, kitchenNotices.stationId))
    .where(
      and(
        inArray(kitchenNotices.stationId, [...stationIds]),
        eq(kitchenStations.locationId, cfg.locationId),
        isNull(kitchenNotices.acknowledgedAt),
        gte(kitchenNotices.createdAt, since),
      ),
    )
    .as("ranked");
  const rows = await tx
    .select()
    .from(ranked)
    .where(lte(ranked.newest, NOTICE_LIMIT))
    .orderBy(asc(ranked.stationId), desc(ranked.newest));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the rank is not part of a notice
  for (const { newest, ...row } of rows) {
    byStation.get(row.stationId)!.push({ ...row, quantity: thousandthsToDecimal(row.quantity) });
  }
  return byStation;
}
