/**
 * The work-session projection — the derived, exportable view of the immutable `time_entries`
 * stream, computed rather than stored (design §5: "recomputed over events, latest-correction-wins,
 * full history retained"). Slice 2 has no corrections yet, so this is a plain fold; Slice 3 layers
 * reprojection on top of the SAME functions.
 *
 * Pure and DB-free on purpose: overtime is projection LOGIC over `time_entries`, and CLAUDE.md §4
 * says pick the lighter target when the heavier one's justification does not apply — there are no
 * privileges, no RLS and no concurrency here, so this is unit-tested on PGlite/directly, never
 * against a real-role Postgres.
 *
 * Overtime has TWO lawful readings under Spanish labour law, and the code returns BOTH rather than
 * choosing (which one binds is convenio/contract-dependent — an asesor-laboral decision, not a code
 * decision; see `summarisePeriod` and the plan's advisor items):
 *
 *   - **Daily-accrual** (the reasoning attributed to ET art. 35): a day worked over its ordinary
 *     target is an *hora extraordinaria* THAT DAY, and a shorter later day does not cancel it. So
 *     overtime is `Σ over days of max(0, worked(day) − dailyTarget(day))`.
 *   - **Period-net** (the reasoning attributed to ET art. 34.2, *distribución irregular de la
 *     jornada*): hours may net out across days within a reference period — lawful only under a
 *     convenio or the default annual-jornada allowance. Overtime is `max(0, totalWorked −
 *     totalContracted)` over the period.
 *
 * These are legal-reasoning attributions to guide the model, NOT a legal opinion; the binding rule
 * for a given employment is convenio-driven (D2 / employment terms).
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
  /** Append/ingest order (`ingest_seq`) — the meaningful creation order of the stream (design §5:
   * "project by timestamp, chain by ingest"). NOT the correction tie-break: `ingest_seq` is a
   * `GENERATED ALWAYS AS IDENTITY` column that the tamper-evidence hash does NOT cover (chain-hash.ts
   * `canonicalString` hashes `sequence_no`, never `ingest_seq`), so a party past the immutability
   * floor could swap two rows' `ingest_seq` and flip which correction is effective while
   * `verifyChain` still returns ok. Correction precedence therefore keys off `sequenceNo` (below). */
  ingestSeq: number;
  /** The 1-based tamper-evident chain position (`sequence_no`) within this (tenant, location) chain.
   * Monotonic in append order — the SAME order `ingestSeq` encodes — but, unlike `ingest_seq`, it is
   * hashed (chain-hash.ts) AND contiguity-checked by `verifyChain`, so it cannot be reordered
   * undetected. `applyCorrections` breaks ties between two approved corrections of one target on this
   * field specifically, closing the gap where `ingest_seq` could be reordered to flip the effective
   * corrected time. */
  sequenceNo: number;
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
  /** The shift start as the raw UTC instant (`event_at`). The local render is derived via
   * `localWallClock(startedAt, startOffsetMinutes)`, never stored here. */
  startedAt: string;
  /** The wall-clock offset in minutes at the shift start (`event_offset_minutes`). May differ from
   * `endOffsetMinutes` across a DST boundary, so both ends are carried. */
  startOffsetMinutes: number;
  /** The shift end as the raw UTC instant (`event_at`); local render via
   * `localWallClock(endedAt, endOffsetMinutes)`. */
  endedAt: string;
  /** The wall-clock offset in minutes at the shift end (`event_offset_minutes`). */
  endOffsetMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
}

/** One day's worked-vs-contracted line, exposed so any overtime rule — including future
 * convenio-specific ones — is DERIVABLE from the data rather than baked into this module. */
export interface DailyWorkTotal {
  /** The worker's LOCAL calendar day. */
  workDate: string;
  /** All the day's sessions summed (a turno partido has more than one), so the daily target is
   * compared against the whole day, not each session. */
  workedMinutes: number;
  /** The day's ordinary target — a floor-scope default today (`dailyContractedTargetMinutes`). */
  contractedTargetMinutes: number;
  /** `max(0, workedMinutes − contractedTargetMinutes)` — this day's daily-accrual overtime. */
  overtimeMinutes: number;
}

/** Which of the two overtime models a caller wants as the single headline figure. */
export type OvertimeModel = "daily-accrual" | "period-net";

/** The contracted baseline the two overtime models measure against. The two figures come from
 * DIFFERENT aggregations (the period baseline is scaled across the whole period; the daily target is
 * a per-day floor-scope default), so they are supplied separately and may not be mutually
 * derivable. */
export interface ContractedTerms {
  /** The period-net baseline: ordinary jornada scaled across the whole pay period. */
  periodMinutes: number;
  /** One ordinary day's target — the daily-accrual baseline. A documented default via
   * `dailyContractedTargetMinutes`; D2 scheduling/convenio_config refines it per employment. */
  dailyTargetMinutes: number;
}

/**
 * A pay-period summary that reports BOTH overtime models side by side plus the per-day breakdown, so
 * no legal reading is hard-coded away. `overtimeMinutes` is a single headline for callers that need
 * one — a conservative default, never the authoritative figure (see `summarisePeriod`).
 */
export interface PeriodSummary {
  workedMinutes: number;
  /** The period-net baseline (`ContractedTerms.periodMinutes`). */
  contractedMinutes: number;
  /** `Σ over days of max(0, worked(day) − dailyTarget(day))` — the daily-accrual model (art. 35). */
  dailyAccrualOvertimeMinutes: number;
  /** `max(0, workedMinutes − contractedMinutes)` — the period-net model (art. 34.2). */
  periodNetOvertimeMinutes: number;
  /** The headline figure selected by `summarisePeriod`'s `headlineModel` parameter. NOT
   * authoritative — the binding model is convenio-driven (asesor-laboral). */
  overtimeMinutes: number;
  /** The per-day worked-vs-contracted lines, ascending by `workDate`. */
  days: DailyWorkTotal[];
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

/**
 * Renders an instant as its LOCAL wall-clock time with an explicit offset, e.g.
 * `2026-01-06T00:30:00+01:00` — the sibling of `localDate` for a full timestamp. The part before the
 * offset is the concrete local time a human reads (art. 34.9 requires "el horario concreto de inicio
 * y finalización"); the `±HH:MM` offset keeps the instant recoverable and disambiguates the DST
 * fall-back hour (the same wall-clock time appears once at +02:00 and once at +01:00).
 *
 * Computed as `instant + offsetMinutes`, read back as UTC — the offset is captured PER EVENT, so a
 * January event carries +60 and a July one +120 with no timezone lookup. Whole seconds only (the
 * stored instants are already whole-second, `time_entries_event_at_second_ck`).
 *
 * Deliberately MIRRORS the fiscal `formatDateTime` (`@waitron/verifactu/src/format.ts`) — same
 * `YYYY-MM-DDThh:mm:ss±hh:mm` shape — without importing it: `@waitron/workforce` must not depend on
 * the fiscal domain (the same not-imported reason `isUniqueViolation` carries in chain.ts). Also
 * mirrors its file-local sibling `localDate`, which renders the date half of the same instant.
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
 * The effective (corrected) timestamp and offset for one base event, and the base events with their
 * corrections applied.
 *
 * A correction never mutates a stored row — it is an append that carries a new timestamp and points
 * at the entry it supersedes (`correctsEntryId`). Reprojection resolves each base event by walking
 * the approved corrections that target it, latest-correction-wins by highest `sequenceNo`, following
 * a chain when a correction is itself corrected (design §5).
 *
 * The tie-break is `sequenceNo`, NOT `ingestSeq`, even though both encode the same append order:
 * `sequence_no` is the position the tamper-evidence hash commits to and `verifyChain` checks for
 * contiguity (chain-hash.ts), whereas `ingest_seq` is a `GENERATED ALWAYS AS IDENTITY` column
 * outside the hash. Keying precedence off the unhashed column would let a party past the immutability
 * floor swap two approved corrections' `ingest_seq` and silently flip which corrected time is
 * effective while the chain still verified; keying off `sequence_no` makes that reorder
 * tamper-evident. All corrections of one target share that target's location (appendCorrection copies
 * `locationId` from the target), so they ride ONE (tenant, location) chain and their `sequence_no`s
 * are comparable.
 *
 * Only `approved` corrections are followed; a `requested` one is retained in history but pending, so
 * it is invisible here. The walk needs no cycle guard: a correction can only be inserted after the
 * row it targets already exists (the self-FK), so a chain's `sequenceNo` values strictly increase and
 * are bounded — it cannot revisit a node.
 */
function applyCorrections(entries: readonly TimeEntryRecord[]): TimeEntryRecord[] {
  const latestApprovedByTarget = new Map<string, TimeEntryRecord>();
  for (const e of entries) {
    if (e.entryKind !== "correction" || e.correctionStatus !== "approved") continue;
    if (e.correctsEntryId === undefined || e.correctsEntryId === null) continue;
    const current = latestApprovedByTarget.get(e.correctsEntryId);
    if (current === undefined || e.sequenceNo > current.sequenceNo) {
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
 * One ordinary day's contracted target, derived as the contracted weekly jornada divided by the
 * number of ordinary working days in the week.
 *
 * `workingDaysPerWeek` is now a PARAMETER, not a module constant: it comes from the resolved
 * `WorkTimeRuleset` (D2 `convenio_config.working_days_per_week`, default 5 — a Mon–Fri week — set on
 * the config row, no longer baked in here). The former `DEFAULT_WORKING_DAYS_PER_WEEK = 5` is now
 * that column's default, so a default config row reproduces the old value exactly; a convenio with a
 * different working week gets a different target without a code change.
 *
 * Deliberately NOT hard-coded convenio numbers (that would misrepresent the law and trip the
 * english-only guard on Spanish labour tokens): only a division by a caller-supplied denominator.
 */
export function dailyContractedTargetMinutes(
  contractedMinutesPerWeek: number,
  workingDaysPerWeek: number,
): number {
  return Math.round(contractedMinutesPerWeek / workingDaysPerWeek);
}

/**
 * Summarises a pay period, reporting BOTH overtime models plus the per-day breakdown.
 *
 * `dailyAccrualOvertimeMinutes` sums each day's `max(0, worked − dailyTarget)` (art. 35: a day's
 * excess is an hora extraordinaria that day, never nettable against a later short day).
 * `periodNetOvertimeMinutes` is `max(0, totalWorked − periodMinutes)` (art. 34.2 distribución
 * irregular: hours may net out across days within a reference period). Both clamp at zero — undertime
 * is a deficit, not negative overtime.
 *
 * `headlineModel` chooses the single `overtimeMinutes` field, defaulting to `daily-accrual`. This is
 * a CONSERVATIVE DEFAULT, not an authoritative choice: `daily-accrual ≥ period-net` whenever both are
 * measured against the same per-day targets — `Σ max(0, x_d) ≥ max(0, Σ x_d)` — so it never nets a
 * day's overtime away. (That inequality can be crossed when `periodMinutes` is scaled independently
 * of the daily targets, e.g. a 5-day-equivalent weekly baseline against a worker who worked 7 days;
 * this is precisely why BOTH figures are returned and neither is stamped "official". Which model
 * binds for a given employment is convenio/contract-driven — an asesor-laboral decision.)
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
    // Ascending by date. `localeCompare` on zero-padded ISO dates orders chronologically; the map's
    // keys are unique days, so no equal-key tie-break arises.
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
