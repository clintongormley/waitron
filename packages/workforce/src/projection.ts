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

/** The clock-event kinds a shift is built from, plus `correction` (Slice 3) — an append row that
 * supersedes an earlier entry's timestamp rather than mutating it. */
export type WorkforceEntryKind = "in" | "out" | "break_start" | "break_end" | "correction";

/** A correction's lifecycle. Only `approved` corrections affect the projection; `requested` ones are
 * retained in history but pending (the worker's art. 34.9 right to contest, not yet actioned). */
export type CorrectionStatus = "requested" | "approved";

/** Exactly the `time_entries` columns the projection reads — never the whole row. */
export interface TimeEntryRecord {
  /** The row's own id (`time_entries.id`) — what a correction targets via `correctsEntryId`. */
  entryId: string;
  personId: string;
  locationId: string;
  entryKind: WorkforceEntryKind;
  /** The trusted event instant (`event_at`), an ISO-8601 timestamptz string. On a `correction` this
   * is the CORRECTED value (the new clock time), not a creation time — creation order is `ingestSeq`. */
  eventAt: string;
  /** The wall-clock offset in minutes (`event_offset_minutes`), for deriving the local calendar day. */
  offsetMinutes: number;
  /** Append/ingest order (`ingest_seq`). Breaks ties between two corrections of the same target:
   * latest-correction-wins is highest `ingestSeq`. */
  ingestSeq: number;
  /** On a `correction`, the entry it supersedes (a base event or an earlier correction). Null/absent
   * on a base event. */
  correctsEntryId?: string | null;
  /** On a `correction`, `requested` or `approved`. Null/absent on a base event. */
  correctionStatus?: CorrectionStatus | null;
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
 * The effective (corrected) timestamp and offset for one base event, and the base events with their
 * corrections applied.
 *
 * A correction never mutates a stored row — it is an append that carries a new timestamp and points
 * at the entry it supersedes (`correctsEntryId`). Reprojection resolves each base event by walking
 * the approved corrections that target it, latest-correction-wins (highest `ingestSeq`), following a
 * chain when a correction is itself corrected (design §5).
 *
 * Only `approved` corrections are followed; a `requested` one is retained in history but pending, so
 * it is invisible here. The walk needs no cycle guard: a correction can only be inserted after the
 * row it targets already exists (the self-FK), so a chain's `ingestSeq` values strictly increase and
 * are bounded — it cannot revisit a node.
 */
function applyCorrections(entries: readonly TimeEntryRecord[]): TimeEntryRecord[] {
  const latestApprovedByTarget = new Map<string, TimeEntryRecord>();
  for (const e of entries) {
    if (e.entryKind !== "correction" || e.correctionStatus !== "approved") continue;
    if (e.correctsEntryId === undefined || e.correctsEntryId === null) continue;
    const current = latestApprovedByTarget.get(e.correctsEntryId);
    if (current === undefined || e.ingestSeq > current.ingestSeq) {
      latestApprovedByTarget.set(e.correctsEntryId, e);
    }
  }

  return entries
    .filter((e) => e.entryKind !== "correction")
    .map((base) => {
      let effective = base;
      for (
        let next = latestApprovedByTarget.get(effective.entryId);
        next !== undefined;
        next = latestApprovedByTarget.get(effective.entryId)
      ) {
        effective = next;
      }
      return effective === base
        ? base
        : { ...base, eventAt: effective.eventAt, offsetMinutes: effective.offsetMinutes };
    });
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
  // Reproject over events + corrections: corrections are folded into the base events they supersede
  // before pairing (design §5, the Slice-2 computed-projection seam), so a recompute always reflects
  // the latest approved value while every prior row stays in the source stream (history retained).
  for (const [personId, personEntries] of groupByPerson(applyCorrections(entries))) {
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
