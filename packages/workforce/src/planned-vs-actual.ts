import type { WorkSession } from "./projection.js";
import { localDate, minutesBetween, type PlannedShift } from "./roster-validation.js";

export type { PlannedShift };

export interface PlannedVsActual {
  personId: string;
  workDate: string;
  plannedMinutes: number;
  workedMinutes: number;
  /** Earliest actual start less earliest planned start, floored at 0; 0 unless both exist. */
  lateMinutes: number;
  noShow: boolean;
  unplanned: boolean;
}

// A space cannot occur in a uuid or an ISO date, so it is a collision-free (person, day) key separator.
const KEY_SEP = " ";

interface Side {
  minutes: number;
  earliestStart: string;
}

function foldByPersonDay<T>(
  items: readonly T[],
  keyOf: (item: T) => { personId: string; workDate: string; startedAt: string; minutes: number },
): Map<string, Side> {
  const byKey = new Map<string, Side>();
  for (const item of items) {
    const { personId, workDate, startedAt, minutes } = keyOf(item);
    const key = `${personId}${KEY_SEP}${workDate}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { minutes, earliestStart: startedAt });
    } else {
      existing.minutes += minutes;
      if (Date.parse(startedAt) < Date.parse(existing.earliestStart)) {
        existing.earliestStart = startedAt;
      }
    }
  }
  return byKey;
}

/**
 * One row per (person, local day) on either side. The join is by local day, not by foreign key: a
 * worked session may have no planned shift, and a planned shift may be a no-show.
 */
export function comparePlannedVsActual(
  shifts: readonly PlannedShift[],
  sessions: readonly WorkSession[],
): PlannedVsActual[] {
  const planned = foldByPersonDay(shifts, (s) => ({
    personId: s.personId,
    workDate: localDate(s.startsAt, s.startsOffsetMinutes),
    startedAt: s.startsAt,
    minutes: minutesBetween(s.startsAt, s.endsAt),
  }));
  const actual = foldByPersonDay(sessions, (w) => ({
    personId: w.personId,
    workDate: w.workDate,
    startedAt: w.startedAt,
    minutes: w.workedMinutes,
  }));

  const rows: PlannedVsActual[] = [];
  for (const key of new Set([...planned.keys(), ...actual.keys()])) {
    const [personId, workDate] = key.split(KEY_SEP) as [string, string];
    const p = planned.get(key);
    const a = actual.get(key);
    rows.push({
      personId,
      workDate,
      plannedMinutes: p?.minutes ?? 0,
      workedMinutes: a?.minutes ?? 0,
      lateMinutes:
        p !== undefined && a !== undefined
          ? Math.max(0, minutesBetween(p.earliestStart, a.earliestStart))
          : 0,
      noShow: p !== undefined && a === undefined,
      unplanned: a !== undefined && p === undefined,
    });
  }
  return rows.sort(
    (x, y) => x.personId.localeCompare(y.personId) || x.workDate.localeCompare(y.workDate),
  );
}
