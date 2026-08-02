/**
 * The work-session projection — the derived, exportable view of the immutable `time_entries`
 * stream, computed rather than stored (design §5: "recomputed over events, latest-correction-wins,
 * full history retained"). Slice 2 has no corrections yet, so this is a plain fold; Slice 3 layers
 * reprojection on top of the SAME functions.
 *
 * Pure and DB-free on purpose: the overtime rule (art. 35.5, actual − contracted per pay period) is
 * logic, and CLAUDE.md §4 says pick the lighter target when the heavier one's justification does not
 * apply — there are no privileges, no RLS and no concurrency here, so this is unit-tested directly.
 */

/** The clock-event kinds a Slice-2 shift is built from. `correction` arrives in Slice 3. */
export type WorkforceEntryKind = "in" | "out" | "break_start" | "break_end";

/** Exactly the `time_entries` columns the projection reads — never the whole row. */
export interface TimeEntryRecord {
  personId: string;
  locationId: string;
  entryKind: WorkforceEntryKind;
  /** The trusted event instant (`event_at`), an ISO-8601 timestamptz string. */
  eventAt: string;
  /** The wall-clock offset in minutes (`event_offset_minutes`), for deriving the local calendar day. */
  offsetMinutes: number;
}

/** One projected workday: an `in`→`out` shift with its breaks netted out. */
export interface WorkSession {
  personId: string;
  locationId: string;
  /** The worker's LOCAL calendar day (art. 34.9 records per worker per day). */
  workDate: string;
  startedAt: string;
  endedAt: string;
  breakMinutes: number;
  workedMinutes: number;
}

/** The art. 35.5 pay-period summary: worked, contracted, and the overtime between them. */
export interface PeriodSummary {
  workedMinutes: number;
  contractedMinutes: number;
  overtimeMinutes: number;
}

/** A half-open local-date window `[start, end)` — `end` exclusive so adjacent periods never
 * double-count the boundary day. */
export interface Period {
  start: string;
  end: string;
}

const MS_PER_MINUTE = 60_000;

/** The wall-clock calendar day for an instant + its offset. `event_at` is stored as a UTC instant
 * alongside `event_offset_minutes` (the `sales.issued_at`/`issued_offset_minutes` pattern), so the
 * local day is the instant shifted by the offset, read back as a UTC date. */
function localDate(eventAt: string, offsetMinutes: number): string {
  return new Date(Date.parse(eventAt) + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

interface OpenShift {
  start: TimeEntryRecord;
  breakMs: number;
  breakStartedAt: string | undefined;
}

function closeShift(personId: string, open: OpenShift, out: TimeEntryRecord): WorkSession {
  const spanMs = Date.parse(out.eventAt) - Date.parse(open.start.eventAt);
  return {
    personId,
    locationId: open.start.locationId,
    workDate: localDate(open.start.eventAt, open.start.offsetMinutes),
    startedAt: open.start.eventAt,
    endedAt: out.eventAt,
    breakMinutes: Math.round(open.breakMs / MS_PER_MINUTE),
    workedMinutes: Math.round((spanMs - open.breakMs) / MS_PER_MINUTE),
  };
}

function groupByPerson(entries: readonly TimeEntryRecord[]): Map<string, TimeEntryRecord[]> {
  const byPerson = new Map<string, TimeEntryRecord[]>();
  for (const e of entries) {
    const list = byPerson.get(e.personId) ?? [];
    list.push(e);
    byPerson.set(e.personId, list);
  }
  return byPerson;
}

/**
 * Folds a flat `time_entries` stream into per-person workday sessions.
 *
 * Sorts each person's events by `event_at` BEFORE pairing — offline capture appends in ingest
 * order, which need not be event-time order (design §5), and the projection commits to event time.
 * A stray event with no matching open shift is dropped rather than throwing: the state-machine in
 * `clocking.ts` keeps the live stream well-formed, and a projection over historical data must stay
 * total.
 */
export function projectWorkSessions(entries: readonly TimeEntryRecord[]): WorkSession[] {
  const sessions: WorkSession[] = [];
  for (const [personId, personEntries] of groupByPerson(entries)) {
    const ordered = [...personEntries].sort(
      (a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt),
    );
    let open: OpenShift | undefined;
    for (const e of ordered) {
      switch (e.entryKind) {
        case "in":
          open = { start: e, breakMs: 0, breakStartedAt: undefined };
          break;
        case "break_start":
          if (open !== undefined) open.breakStartedAt = e.eventAt;
          break;
        case "break_end":
          if (open !== undefined && open.breakStartedAt !== undefined) {
            open.breakMs += Date.parse(e.eventAt) - Date.parse(open.breakStartedAt);
            open.breakStartedAt = undefined;
          }
          break;
        case "out":
          if (open !== undefined) {
            sessions.push(closeShift(personId, open, e));
            open = undefined;
          }
          break;
      }
    }
  }
  return sessions;
}

/**
 * Totalises worked minutes over a pay period and reports overtime as actual − contracted (art.
 * 35.5). Overtime is clamped at zero: undertime is a deficit, not negative overtime.
 */
export function summarisePeriod(
  sessions: readonly WorkSession[],
  period: Period,
  contractedMinutes: number,
): PeriodSummary {
  const workedMinutes = sessions
    .filter((s) => s.workDate >= period.start && s.workDate < period.end)
    .reduce((total, s) => total + s.workedMinutes, 0);
  return {
    workedMinutes,
    contractedMinutes,
    overtimeMinutes: Math.max(0, workedMinutes - contractedMinutes),
  };
}
