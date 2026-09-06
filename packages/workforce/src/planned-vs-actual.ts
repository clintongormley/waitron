import type { WorkSession } from "./projection.js";
import { localDate, minutesBetween, type PlannedShift } from "./roster-validation.js";

/**
 * The planned-vs-actual read model (plan §6 Slice D2.3.3, design §4 "the planned-vs-actual seam"):
 * joins `shifts` (PLANNED working time) to `work_sessions` (the ACTUAL projection over the immutable
 * `time_entries`) by person + LOCAL date, so a manager can see who was late, who no-showed, and
 * planned-vs-worked minutes. NOT an FK join — a worked session may have no planned shift and a planned
 * shift may be a no-show — so it is a read model over two independent streams (design §2.1).
 *
 * Pure logic over the two inputs, DB-free for the same reason the projection is (CLAUDE.md §4): no
 * privileges, no concurrency, so it is unit-tested directly. `WorkSession.startedAt` and
 * `PlannedShift.startsAt` are both ABSOLUTE instants, so lateness is their difference; the JOIN key is
 * the LOCAL day (`WorkSession.workDate` is already local; a shift's is its start shifted by its wall
 * offset), so a shift and the session that fulfilled it meet on the day the worker experienced.
 */
export type { PlannedShift };

/** One (person, local day) line: planned vs worked minutes, lateness, and the two mismatch flags. */
export interface PlannedVsActual {
  personId: string;
  /** The worker's LOCAL calendar day. */
  workDate: string;
  /** Sum of the day's planned shift durations; 0 when the day was worked unplanned. */
  plannedMinutes: number;
  /** Sum of the day's worked-session minutes; 0 on a no-show. */
  workedMinutes: number;
  /** `max(0, actualStart − plannedStart)` in minutes when both exist; 0 otherwise (a no-show, an
   * unplanned day, or an early/on-time start — lateness never goes negative). */
  lateMinutes: number;
  /** A planned shift with no worked session that local day. */
  noShow: boolean;
  /** A worked session with no planned shift that local day. */
  unplanned: boolean;
}

// A space cannot occur in a uuid or an ISO date, so it is a collision-free (person, day) key separator.
const KEY_SEP = " ";

interface Side {
  minutes: number;
  earliestStart: string;
}

/** Folds items into a (person, local day) map, summing minutes and keeping the earliest start. */
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
 * Joins planned shifts to actual work sessions by person + local day, one row per matched or
 * unmatched (person, day). Rows are ordered by person then date for a stable result.
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
