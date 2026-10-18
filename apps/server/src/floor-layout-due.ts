import { and, inArray } from "drizzle-orm";
import { floorPlans, floorTodayZones, type Transaction } from "@waitron/db";
import { VENUE_SERVICE } from "./modules.js";
import { todayBusinessDay } from "./floor-today-store.js";
import type { TillConfig } from "./till-config.js";

export interface LayoutRecord {
  setId: string | null;
  revision: number;
  occurrence: string | null;
}

export interface ZoneLayoutState {
  zoneId: string;
  /** Null when today's record is missing or from an earlier business day. */
  recorded: LayoutRecord | null;
  /** Null when the zone's department has no set (or it is in none). */
  due: {
    setId: string;
    setName: string;
    revision: number;
    occurrence: string | null;
    periodName: string | null;
  } | null;
}

/** Each zone's recorded layout and the layout due at `now`; a due layout with no row is at revision 0. */
export async function zoneLayouts(
  tx: Transaction,
  cfg: TillConfig,
  zoneIds: readonly string[],
  now: Date,
): Promise<Map<string, ZoneLayoutState>> {
  const states = new Map<string, ZoneLayoutState>();
  if (zoneIds.length === 0) return states;
  const day = await todayBusinessDay(tx, cfg, now);
  const records = await tx
    .select({
      zoneId: floorTodayZones.zoneId,
      businessDay: floorTodayZones.businessDay,
      setId: floorTodayZones.setId,
      revision: floorTodayZones.layoutRevision,
      occurrence: floorTodayZones.occurrence,
    })
    .from(floorTodayZones)
    .where(inArray(floorTodayZones.zoneId, [...zoneIds]));
  const recordOf = new Map<string, LayoutRecord>();
  for (const row of records) {
    if (day === null || row.businessDay !== day) continue;
    recordOf.set(row.zoneId, {
      setId: row.setId,
      revision: row.revision,
      occurrence: row.occurrence,
    });
  }
  const due = await VENUE_SERVICE.dueFloorLayouts(
    tx,
    cfg,
    zoneIds.map((zoneId) => ({
      zoneId,
      recordedOccurrence: recordOf.get(zoneId)?.occurrence ?? null,
    })),
    now,
  );
  const dueSets = [
    ...new Set(
      [...due.values()].flatMap((layout) => (layout.setId === null ? [] : [layout.setId])),
    ),
  ];
  const revisions =
    dueSets.length === 0
      ? []
      : await tx
          .select({
            setId: floorPlans.setId,
            zoneId: floorPlans.zoneId,
            revision: floorPlans.revision,
          })
          .from(floorPlans)
          .where(and(inArray(floorPlans.setId, dueSets), inArray(floorPlans.zoneId, [...zoneIds])));
  const revisionOf = new Map(revisions.map((row) => [`${row.setId}/${row.zoneId}`, row.revision]));
  for (const zoneId of zoneIds) {
    const layout = due.get(zoneId);
    states.set(zoneId, {
      zoneId,
      recorded: recordOf.get(zoneId) ?? null,
      due:
        layout === undefined || layout.setId === null
          ? null
          : {
              setId: layout.setId,
              setName: layout.setName!,
              revision: revisionOf.get(`${layout.setId}/${zoneId}`) ?? 0,
              occurrence: layout.occurrence,
              periodName: layout.periodName,
            },
    });
  }
  return states;
}

/** The banner's facts, or null when the recorded layout is the due one (spec decision 5; plan decision 12). */
export function layoutOffer(
  state: ZoneLayoutState,
): { setId: string; revision: number; periodName: string | null } | null {
  const { recorded, due } = state;
  if (recorded === null || due === null) return null;
  if (recorded.setId === due.setId && recorded.revision === due.revision) return null;
  const newPeriod =
    recorded.setId !== due.setId &&
    due.occurrence !== null &&
    due.occurrence !== recorded.occurrence;
  return {
    setId: due.setId,
    revision: due.revision,
    periodName: newPeriod ? due.periodName : null,
  };
}
