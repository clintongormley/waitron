import { and, inArray } from "drizzle-orm";
import { floorPlans, floorTodayZones, type Transaction } from "@waitron/db";
import type { FloorPlanSetSummary, PreparedServiceDay } from "@waitron/module";
import { VENUE_SERVICE } from "./modules.js";
import { todayBusinessDay } from "./floor-today-store.js";
import type { TillConfig } from "./till-config.js";

/** The zones that have a plan on the till: those whose department has a set. */
export function plannedZones(sets: readonly FloorPlanSetSummary[]): Set<string> {
  return new Set(sets.flatMap((set) => set.zoneIds));
}

export interface LayoutRecord {
  setId: string | null;
  revision: number;
  occurrence: string | null;
}

export interface ZoneLayoutState {
  zoneId: string;
  /** Null when today's record is missing or from an earlier business day. */
  recorded: LayoutRecord | null;
  /** Whether the zone's department has a set. */
  planned: boolean;
  /** The recorded set's name; null with no record, or when that set is gone. */
  recordedSetName: string | null;
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
  prepared?: PreparedServiceDay,
): Promise<Map<string, ZoneLayoutState>> {
  if (zoneIds.length === 0) return new Map();
  const day = prepared === undefined ? await todayBusinessDay(tx, cfg, now) : prepared.businessDay;
  return (await zoneLayoutsOn(tx, cfg, zoneIds, now, day, prepared)).states;
}

export type LayoutRow = { id: string; revision: number };

/**
 * `zoneLayouts` on business day `day`, with each zone's saved row of its due set's layout. A zone
 * with no due set, or whose due set has no row of it, is absent from `rows`.
 */
export async function zoneLayoutsOn(
  tx: Transaction,
  cfg: TillConfig,
  zoneIds: readonly string[],
  now: Date,
  day: string | null,
  prepared?: PreparedServiceDay,
): Promise<{ states: Map<string, ZoneLayoutState>; rows: Map<string, LayoutRow> }> {
  const states = new Map<string, ZoneLayoutState>();
  const rows = new Map<string, LayoutRow>();
  if (zoneIds.length === 0) return { states, rows };
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
      recordedSetId: recordOf.get(zoneId)?.setId ?? null,
    })),
    now,
    prepared,
  );
  const dueSets = [
    ...new Set(
      [...due.values()].flatMap(({ due: layout }) => (layout.setId === null ? [] : [layout.setId])),
    ),
  ];
  const plans =
    dueSets.length === 0
      ? []
      : await tx
          .select({
            id: floorPlans.id,
            setId: floorPlans.setId,
            zoneId: floorPlans.zoneId,
            revision: floorPlans.revision,
          })
          .from(floorPlans)
          .where(and(inArray(floorPlans.zoneId, [...zoneIds]), inArray(floorPlans.setId, dueSets)));
  const planOf = new Map(plans.map((row) => [`${row.setId}/${row.zoneId}`, row]));
  for (const zoneId of zoneIds) {
    const zone = due.get(zoneId);
    const layout = zone?.due;
    const setId = layout?.setId ?? null;
    const plan = setId === null ? undefined : planOf.get(`${setId}/${zoneId}`);
    if (plan !== undefined) rows.set(zoneId, { id: plan.id, revision: plan.revision });
    states.set(zoneId, {
      zoneId,
      recorded: recordOf.get(zoneId) ?? null,
      planned: zone?.planned ?? false,
      recordedSetName: zone?.recordedSetName ?? null,
      due:
        layout === undefined || setId === null
          ? null
          : {
              setId,
              setName: layout.setName!,
              revision: plan?.revision ?? 0,
              occurrence: layout.occurrence,
              periodName: layout.periodName,
            },
    });
  }
  return { states, rows };
}

/** The banner's facts, or null when the recorded layout is the due one. */
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
