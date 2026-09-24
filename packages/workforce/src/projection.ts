/**
 * Overtime has TWO lawful readings, and the code returns BOTH rather than choosing: which one binds
 * for an employment is a collective-agreement decision, not a code decision. The article
 * attributions below guide the model; they are NOT a legal opinion.
 */

/** `correction` supersedes an earlier entry's timestamp rather than mutating it. */
export type WorkforceEntryKind = "in" | "out" | "break_start" | "break_end" | "correction";

/** Only `approved` corrections affect the projection. */
export type CorrectionStatus = "requested" | "approved";

export interface TimeEntryRecord {
  entryId: string;
  personId: string;
  locationId: string;
  nodeId: string;
  entryKind: WorkforceEntryKind;
  /** On a `correction`, the CORRECTED clock time, not a recording time — that is `recordedAt`. */
  eventAt: string;
  recordedAt: string;
  offsetMinutes: number;
  sequenceNo: number;
  correctsEntryId?: string | null;
  correctionStatus?: CorrectionStatus | null;
}

/** One projected workday: an `in`→`out` shift with its breaks netted out. */
export interface WorkSession {
  personId: string;
  locationId: string;
  /** The worker's LOCAL calendar day. */
  workDate: string;
  /** The raw UTC instant; render it with `localWallClock(startedAt, startOffsetMinutes)`. */
  startedAt: string;
  /** May differ from `endOffsetMinutes` across a DST boundary, so both ends are carried. */
  startOffsetMinutes: number;
  endedAt: string;
  endOffsetMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
}

/** Exposed so any overtime rule is DERIVABLE from the data rather than baked into this module. */
export interface DailyWorkTotal {
  workDate: string;
  /** All the day's sessions summed, so the daily target is compared against the whole day. */
  workedMinutes: number;
  contractedTargetMinutes: number;
  overtimeMinutes: number;
}

export type OvertimeModel = "daily-accrual" | "period-net";

/** The two baselines come from different aggregations, so they are supplied separately and may not
 * be mutually derivable. */
export interface ContractedTerms {
  /** The period-net baseline: ordinary working time scaled across the whole pay period. */
  periodMinutes: number;
  /** The daily-accrual baseline. */
  dailyTargetMinutes: number;
}

export interface PeriodSummary {
  workedMinutes: number;
  contractedMinutes: number;
  /** `Σ over days of max(0, worked(day) − dailyTarget(day))` — the daily-accrual model (art. 35). */
  dailyAccrualOvertimeMinutes: number;
  /** `max(0, workedMinutes − contractedMinutes)` — the period-net model (art. 34.2). */
  periodNetOvertimeMinutes: number;
  /** The headline selected by `headlineModel`. NOT authoritative. */
  overtimeMinutes: number;
  /** Ascending by `workDate`. */
  days: DailyWorkTotal[];
}

/** A half-open local-date window `[start, end)` — `end` exclusive so adjacent periods never
 * double-count the boundary day. */
export interface Period {
  start: string;
  end: string;
}

const MS_PER_MINUTE = 60_000;

function localDate(eventAt: string, offsetMinutes: number): string {
  return new Date(Date.parse(eventAt) + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/**
 * E.g. `2026-01-06T00:30:00+01:00`. The explicit offset keeps the instant recoverable and
 * disambiguates the DST fall-back hour. Mirrors the fiscal `formatDateTime` shape without importing
 * it: `@waitron/workforce` must not depend on the fiscal domain.
 */
export function localWallClock(instant: string, offsetMinutes: number): string {
  const local = new Date(Date.parse(instant) + offsetMinutes * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 19);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${hh}:${mm}`;
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
    startOffsetMinutes: open.start.offsetMinutes,
    endedAt: out.eventAt,
    endOffsetMinutes: out.offsetMinutes,
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
 * The total order `(recordedAt, nodeId, sequenceNo)` (spec §4.2). A single tuple compare, NOT a
 * "same-node → sequenceNo, else recordedAt" special case, which is not transitive across three
 * entries spanning two chains.
 */
function laterThan(a: TimeEntryRecord, b: TimeEntryRecord): boolean {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt > b.recordedAt;
  if (a.nodeId !== b.nodeId) return a.nodeId > b.nodeId;
  return a.sequenceNo > b.sequenceNo;
}

/**
 * Latest approved correction wins, following a chain when a correction is itself corrected. A
 * correction is chained under its OWN recording node, so two nodes' corrections of one target can sit
 * in different chains — hence `laterThan`'s cross-chain order rather than `sequenceNo` alone.
 *
 * No cycle guard: each correction has exactly one target, so a walk that starts at a base event
 * cannot return to an entry it has passed.
 */
function applyCorrections(entries: readonly TimeEntryRecord[]): TimeEntryRecord[] {
  const latestApprovedByTarget = new Map<string, TimeEntryRecord>();
  for (const e of entries) {
    if (e.entryKind !== "correction" || e.correctionStatus !== "approved") continue;
    if (e.correctsEntryId === undefined || e.correctsEntryId === null) continue;
    const current = latestApprovedByTarget.get(e.correctsEntryId);
    if (current === undefined || laterThan(e, current)) {
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
 * Sorts each person's events by `event_at` BEFORE pairing: offline capture appends in ingest order,
 * which need not be event-time order. A stray event with no matching open shift is dropped rather
 * than throwing, so a projection over historical data stays total.
 */
export function projectWorkSessions(entries: readonly TimeEntryRecord[]): WorkSession[] {
  const sessions: WorkSession[] = [];
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

export function dailyContractedTargetMinutes(
  contractedMinutesPerWeek: number,
  workingDaysPerWeek: number,
): number {
  // `convenio_config`'s CHECK already pins this to 1..7, but this helper is public. `> 0` also rejects
  // NaN. A plain Error: a programmer error, never a till-facing condition.
  if (!(workingDaysPerWeek > 0)) {
    throw new Error(
      `dailyContractedTargetMinutes: workingDaysPerWeek must be positive, received ${workingDaysPerWeek}`,
    );
  }
  return Math.round(contractedMinutesPerWeek / workingDaysPerWeek);
}

/**
 * Both models clamp at zero: undertime is a deficit, not negative overtime.
 *
 * `headlineModel` defaults to `daily-accrual` as a CONSERVATIVE default, not an authoritative one:
 * `Σ max(0, x_d) ≥ max(0, Σ x_d)` when both are measured against the same per-day targets. That can be
 * crossed when `periodMinutes` is scaled independently of the daily targets, which is why BOTH
 * figures are returned.
 */
export function summarisePeriod(
  sessions: readonly WorkSession[],
  period: Period,
  contracted: ContractedTerms,
  headlineModel: OvertimeModel = "daily-accrual",
): PeriodSummary {
  const inPeriod = sessions.filter((s) => s.workDate >= period.start && s.workDate < period.end);

  const workedByDate = new Map<string, number>();
  for (const s of inPeriod) {
    workedByDate.set(s.workDate, (workedByDate.get(s.workDate) ?? 0) + s.workedMinutes);
  }

  const days: DailyWorkTotal[] = [...workedByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([workDate, workedMinutes]) => ({
      workDate,
      workedMinutes,
      contractedTargetMinutes: contracted.dailyTargetMinutes,
      overtimeMinutes: Math.max(0, workedMinutes - contracted.dailyTargetMinutes),
    }));

  const workedMinutes = inPeriod.reduce((total, s) => total + s.workedMinutes, 0);
  const dailyAccrualOvertimeMinutes = days.reduce((total, d) => total + d.overtimeMinutes, 0);
  const periodNetOvertimeMinutes = Math.max(0, workedMinutes - contracted.periodMinutes);

  return {
    workedMinutes,
    contractedMinutes: contracted.periodMinutes,
    dailyAccrualOvertimeMinutes,
    periodNetOvertimeMinutes,
    overtimeMinutes:
      headlineModel === "period-net" ? periodNetOvertimeMinutes : dailyAccrualOvertimeMinutes,
    days,
  };
}
