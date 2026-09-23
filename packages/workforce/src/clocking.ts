import { and, eq, gte, lt, sql } from "drizzle-orm";
import { isUniqueViolation, newId, nowIso, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { timeEntries } from "./schema/time-entries.js";
import {
  dailyContractedTargetMinutes,
  projectWorkSessions,
  summarisePeriod,
  type OvertimeModel,
  type Period,
  type PeriodSummary,
  type TimeEntryRecord,
  type WorkforceEntryKind,
} from "./projection.js";
import {
  validateRoster,
  weekStartOf,
  type PlannedShift,
  type RosterBreach,
} from "./roster-validation.js";
import { comparePlannedVsActual, type PlannedVsActual } from "./planned-vs-actual.js";
import { shiftLocalDate } from "./shift-local-date.js";
import type { WorkTimeRuleset } from "./ruleset.js";
// Side-effect: registers this package's attendance.*/employment.* codes so `new AppError(...)`
// below type-checks against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** One clock event's inputs. `at`/`offsetMinutes` are the trusted event timestamp and its wall
 * offset, supplied by the caller (as `recordSale` is handed `issuedAt`), never read here. */
export interface ClockEventInput {
  /** The node recording the event — its chain the entry is appended to (spec §2.1). Supplied per
   * call the way `recordSale` takes `input.nodeId`. */
  nodeId: string;
  personId: string;
  locationId: string;
  at: string;
  offsetMinutes: number;
  /** The till that captured the event, if any. */
  tillId?: string | null;
  /** Who recorded it; defaults to the subject (self-service clock-in). */
  recordedByPersonId?: string;
}

export interface WorkSummaryQuery {
  personId: string;
  /** The pay period, as a half-open local-date window `[start, end)`. */
  period: Period;
}

/**
 * The collective-agreement-driven inputs `workSummary` reads — resolved from a `convenio_config` row by
 * `packages/workforce-es` and passed in (a full `WorkTimeRuleset` satisfies this subset). The single
 * source of their defaults is the `convenio_config` column defaults: a DEFAULT row resolves to
 * `working_days_per_week = 5` / `overtime_model = daily_accrual` / `daily_target_minutes = NULL`, and
 * that this reproduces today's numbers is pinned as a checked invariant by `packages/workforce-es`'s
 * `work-summary.test.ts` (a default row resolved through `resolveWorkTimeRuleset`), not asserted by a
 * comment the code does not enforce. `dailyTargetMinutes` is the one field with a code-side fallback
 * — a null column means "derive the per-day target from the weekly working time ÷ `workingDaysPerWeek`"
 * rather than a duplicated numeric default.
 */
export interface WorkSummaryRuleset {
  /** Ordinary working days per week — the daily-target denominator when `dailyTargetMinutes` is null
   * (`convenio_config.working_days_per_week`). */
  workingDaysPerWeek: number;
  /** Which overtime reading is the headline (`convenio_config.overtime_model`). Changing it moves
   * only the headline, never the two underlying figures. */
  overtimeModel: OvertimeModel;
  /** An explicit per-day target (`convenio_config.daily_target_minutes`). When non-null it IS the
   * daily-accrual target and the weekly ÷ `workingDaysPerWeek` derivation is bypassed; null falls
   * back to that derivation. A DEFAULT `convenio_config` row leaves it null, so the derivation — and
   * today's numbers — are unchanged. */
  dailyTargetMinutes: number | null;
}

/** A request to correct an entry's timestamp — an append, never an edit of the target. */
export interface CorrectionRequestInput {
  /** The node recording the correction — its chain the correction is appended to (spec §3.3). A
   * correction rides its RECORDING node's chain, which need not be the target's node. */
  nodeId: string;
  /** The entry whose timestamp is wrong (a base clock event, or an earlier correction). */
  correctsEntryId: string;
  /** The corrected event instant and its wall offset — what the entry SHOULD have been. */
  at: string;
  offsetMinutes: number;
  /** Why the correction is needed (art. 34.9's attributable, contestable requirement). */
  reason: string;
  /** Who is asking — the worker contesting, or a supervisor. Recorded as the correction actor. */
  actorPersonId: string;
  /** The till the request came from, if any. */
  tillId?: string | null;
}

/** A supervisor's approval of a requested correction — the second append that gives it effect. */
export interface CorrectionApprovalInput {
  /** The node recording the approval — its chain the approval is appended to (spec §3.3). */
  nodeId: string;
  /** The `requested` correction to approve. */
  correctionId: string;
  /** Who is approving — must hold a supervisor/manager/admin role. */
  approverPersonId: string;
}

/** A request to publish a draft roster version — flip it to `published`, stamp it, and attach its
 * planned shifts. Publishing is a plain mutation over PLANNING data, not an append to the immutable
 * record (design §2.1): `roster_versions`/`shifts` take UPDATE, unlike `time_entries`. */
export interface PublishRosterInput {
  /** The `roster_versions` row to publish. Must be a `draft`, or `roster.already_published`. */
  versionId: string;
  /** Who published it — recorded on the version; null when the caller does not attribute it. */
  publishedByPersonId?: string | null;
  /** The resolved work-time ruleset the roster is checked against (D2.3). Supplied by the caller —
   * `packages/workforce-es` resolves a `convenio_config` row into it (the Spain→generic boundary,
   * plan §3.3); the generic `publishRoster` never touches `convenio_config`. When present, the
   * published shifts are validated and any breaches are RETURNED (advisory — publish proceeds
   * regardless, OWNER DECISION 2026-08-02). When omitted, guardrails are not evaluated and the
   * return is empty. */
  ruleset?: WorkTimeRuleset;
}

/** A request to open a DRAFT roster version for one location's week (design §3a). */
export interface CreateRosterVersionInput {
  locationId: string;
  /** ANY day (YYYY-MM-DD) of the week to author. The engine NORMALIZES it to that week's Monday, which
   * becomes period_start (period_end is then derived as +6 days), so a non-Monday caller (a date
   * picker) can never open a mid-week roster and any two days in one calendar week collide on the
   * same draft. */
  period: string;
}

/** One `roster_versions` row, mapped to the camelCase shape the API/screen read (dates as
 * 'YYYY-MM-DD' strings, `published_at` as a UTC ISO instant). */
export interface RosterVersionRow {
  id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  publishedByPersonId: string | null;
}

/** One `shifts` row, mapped to camelCase with UTC ISO instants for the grid. */
export interface ShiftRow {
  id: string;
  personId: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

/** The week's roster snapshot for the authoring grid — the current draft (or, if none, the published
 * version) and its attached shifts, or `{ version: null, shifts: [] }` for an unrostered week. */
export interface RosterSnapshot {
  version: RosterVersionRow | null;
  shifts: ShiftRow[];
}

/** A request to add one planned shift to a DRAFT roster version (design §3a). */
export interface AddShiftInput {
  versionId: string;
  personId: string;
  /** The workplace — should match the version's location (the screen uses the roster's). */
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

/** A partial edit of a shift on a DRAFT roster version (design §3a) — only the supplied fields change. */
export interface UpdateShiftInput {
  shiftId: string;
  personId?: string;
  startsAt?: string;
  startsOffsetMinutes?: number;
  endsAt?: string;
  endsOffsetMinutes?: number;
  role?: string | null;
}

/** The three states a worker's shift can be in, derived from the most recent clock event. */
type ShiftState = "out" | "working" | "on_break";

/** The clock kinds that drive live shift state — every kind except `correction`, which never does. */
type LiveEntryKind = Exclude<WorkforceEntryKind, "correction">;

/** The roles permitted to APPROVE a correction (design §5, supervisor-gated). */
const SUPERVISOR_ROLES = new Set(["supervisor", "manager", "admin"]);

const MS_PER_DAY = 86_400_000;

/** The state each live entry kind LEAVES the worker in. */
const STATE_AFTER: Record<LiveEntryKind, ShiftState> = {
  in: "working",
  break_end: "working",
  break_start: "on_break",
  out: "out",
};

/**
 * The clock-in/out/break write path over the immutable `time_entries` stream — the seam a till
 * calls (design §6). Stateless in Slice 2: the trusted timestamp arrives on the input, and the
 * hash-chain dependencies that will give this a constructor are Slice 4.
 *
 * Every method reads the worker's current shift state and refuses an illegal transition
 * (`attendance.*`) BEFORE appending — the state machine is `out →in→ working →break_start→ on_break
 * →break_end→ working →out→ out`, which keeps the live stream well-formed for the projection.
 *
 * Each of the four clock methods used to open with a `lockPerson` call — `select id from persons
 * … for no key update` — so that the state read and the append could not be interleaved by a
 * second operation for the same person, which would let both observe the same state and both
 * append (a double-`in`, which the projection then undercounts). One write transaction runs on the
 * venue file at a time, so nothing can land between this read and this append, for any person;
 * `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`) carries the mechanism, the
 * measurement and the control. The lock MODE that note argued for — `for no key update` rather
 * than `for update`, to avoid an ABBA cycle against the `for key share` locks a `time_entries`
 * insert took on its referenced `persons` rows — has no counterpart here at all: SQLite takes no
 * row locks of either kind, and there is only one writer.
 */
export class WorkforceBackend {
  /** out → working. */
  async clockIn(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state !== "out") throw this.alreadyOpen(input);
    await this.append(tx, input, "in");
  }

  /** working → out. */
  async clockOut(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "out");
  }

  /** working → on_break. */
  async breakStart(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state === "on_break") throw this.alreadyOpen(input);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_start");
  }

  /** on_break → working. */
  async breakEnd(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state !== "on_break") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_end");
  }

  /**
   * Worked minutes and overtime for a person over a pay period, computed from the `time_entries`
   * stream against the employment's contracted week. Returns BOTH overtime models (daily-accrual and
   * period-net) side by side plus the per-day breakdown, and selects the headline model from the
   * supplied `ruleset.overtimeModel` (`convenio_config`-sourced) — which model BINDS for a given
   * employment is still a collective-agreement/asesor-laboral decision, carried on that row, not hard-coded here
   * (see `summarisePeriod`). The period-net baseline scales the weekly working time to the period length.
   * The daily-accrual target is `ruleset.dailyTargetMinutes` when the collective agreement sets one, else the
   * weekly working time ÷ `ruleset.workingDaysPerWeek` derivation (`dailyContractedTargetMinutes`); a
   * DEFAULT `convenio_config` row leaves `dailyTargetMinutes` null, so today's per-day figure stands.
   */
  async workSummary(
    tx: Transaction,
    query: WorkSummaryQuery,
    ruleset: WorkSummaryRuleset,
  ): Promise<PeriodSummary> {
    const { workingDaysPerWeek, overtimeModel, dailyTargetMinutes } = ruleset;
    const contractedPerWeek = await this.contractedMinutesPerWeek(tx, query.personId);
    const entries = await this.entriesInPeriod(tx, query);
    const sessions = projectWorkSessions(entries);
    const periodDays = (Date.parse(query.period.end) - Date.parse(query.period.start)) / MS_PER_DAY;
    return summarisePeriod(
      sessions,
      query.period,
      {
        periodMinutes: Math.round((contractedPerWeek * periodDays) / 7),
        // An explicit collective-agreement per-day target wins; a null column falls back to the weekly derivation
        // (`??` treats only null/undefined as "unset", so a 0 override — a CHECK would reject it — is
        // still honoured rather than silently re-derived).
        dailyTargetMinutes:
          dailyTargetMinutes ?? dailyContractedTargetMinutes(contractedPerWeek, workingDaysPerWeek),
      },
      overtimeModel,
    );
  }

  /**
   * The planned-vs-actual read model for one location over a half-open local-date window (design §3c):
   * assembles the PLANNED shifts (the currently-PUBLISHED roster version) and the ACTUAL projected work
   * sessions for the location, both scoped to the same location, and hands them to the pure
   * `comparePlannedVsActual`. One row per matched or unmatched (person, local day) — planned vs worked
   * minutes, lateness, and the no-show/unplanned flags. A window with no shifts and no sessions is an
   * empty array, not an error.
   */
  async getPlannedVsActual(
    tx: Transaction,
    query: { locationId: string; period: Period },
  ): Promise<PlannedVsActual[]> {
    const plannedShifts = await this.plannedShiftsInPeriod(tx, query.locationId, query.period);
    const entries = await this.entriesForLocationInPeriod(tx, query.locationId, query.period);
    // The ±1-day widened fetch can return a session one local day outside the window; keep only the
    // sessions whose LOCAL day is in [start, end) (the planned side is already exact — its SQL filters
    // by local date directly).
    const sessions = projectWorkSessions(entries).filter(
      (s) => s.workDate >= query.period.start && s.workDate < query.period.end,
    );
    return comparePlannedVsActual(plannedShifts, sessions);
  }

  /** The location's shifts on the currently-PUBLISHED roster version whose LOCAL wall date falls in
   * `[period.start, period.end)`, as neutral `PlannedShift`s. Mirrors `attachedShifts` but keyed on
   * `location_id` + a local-date window + `roster_versions.status = 'published'` (an INNER JOIN on
   * `shifts.roster_version_id`) instead of a single `roster_version_id`. Published-only is the owner
   * decision (2026-08-15): an in-progress DRAFT (`shifts.roster_version_id` null → dropped by the INNER
   * JOIN, `schema/shifts.ts:49-50`) and a SUPERSEDED version (`status <> 'published'` → dropped by the
   * filter, `schema/roster-versions.ts:32-36`) must not manufacture phantom no-shows. The
   * `roster_versions_published_period_uq` partial unique index (`schema/roster-versions.ts:108-110`)
   * keeps at most one published version per (location, period), so the join yields a single
   * coherent plan.
   *
   * The published-only predicate lives in the JOIN's ON clause, not in WHERE, so BOTH exclusions are
   * independently provable by deletion (CLAUDE.md §4). With the INNER JOIN it is exactly equivalent to
   * a WHERE placement (an inner join drops unmatched rows either way); the two negative-control
   * mutations, however, are NOT symmetric, because the WHERE references only `s.*`. Turning the join
   * OUTER re-admits BOTH the null-version DRAFT (no `rv.id` match) AND the SUPERSEDED version's shift
   * (its `rv.status` fails the ON term): each keeps its shift row with NULL rv columns, and the s-only
   * WHERE cannot drop either — so that mutation reddens, driven by the DRAFT (the row the drop-`status`
   * mutation below leaves correctly excluded). Dropping the `status = 'published'` term instead
   * re-admits ONLY the SUPERSEDED row (its `rv.id` still matches); the DRAFT stays out for want of any
   * `rv.id`. Each guard is therefore necessary — one catches the DRAFT exclusion, the other the
   * SUPERSEDED — even though the OUTER mutation happens to re-admit both. The
   * The local-date expression is `shiftLocalDate` (shift-local-date.ts), offset-aware (offset 0 in
   * this slice, so local = UTC) and shared with publishRoster's shift-attach; the instants are read
   * back as the stored text, which is what the pure comparator's `Date.parse` takes. */
  private async plannedShiftsInPeriod(
    tx: Transaction,
    locationId: string,
    period: Period,
  ): Promise<PlannedShift[]> {
    const { rows } = await tx.execute<{
      id: string;
      person_id: string;
      starts_at: string;
      starts_offset_minutes: number;
      ends_at: string;
      ends_offset_minutes: number;
    }>(sql`
      select shifts.id, shifts.person_id, shifts.starts_at, shifts.starts_offset_minutes,
        shifts.ends_at, shifts.ends_offset_minutes
      from shifts
      join roster_versions rv
        on rv.id = shifts.roster_version_id and rv.status = 'published'
      where shifts.location_id = ${locationId}
        and ${shiftLocalDate} >= ${period.start}
        and ${shiftLocalDate} < ${period.end}`);
    return rows.map((r) => ({
      shiftId: r.id,
      personId: r.person_id,
      startsAt: r.starts_at,
      startsOffsetMinutes: r.starts_offset_minutes,
      endsAt: r.ends_at,
      endsOffsetMinutes: r.ends_offset_minutes,
    }));
  }

  /** The location's `time_entries` over a ±1-day-widened UTC window, for ALL persons. Mirrors
   * `entriesInPeriod` but filters on `location_id` (not one person — which is why this is a new helper,
   * not a reuse) and applies the same ±1-day widening so a session whose LOCAL day is inside is not
   * missed. Corrections are fetched alongside base events (no `entry_kind` filter) so
   * `projectWorkSessions` can fold them in. */
  private async entriesForLocationInPeriod(
    tx: Transaction,
    locationId: string,
    period: Period,
  ): Promise<TimeEntryRecord[]> {
    const windowStart = shiftDay(period.start, -1);
    const windowEnd = shiftDay(period.end, 1);
    const rows = await tx
      .select({
        entryId: timeEntries.id,
        personId: timeEntries.personId,
        locationId: timeEntries.locationId,
        nodeId: timeEntries.nodeId,
        entryKind: timeEntries.entryKind,
        eventAt: timeEntries.eventAt,
        recordedAt: timeEntries.recordedAt,
        offsetMinutes: timeEntries.eventOffsetMinutes,
        sequenceNo: timeEntries.sequenceNo,
        correctsEntryId: timeEntries.correctsEntryId,
        correctionStatus: timeEntries.correctionStatus,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.locationId, locationId),
          gte(timeEntries.eventAt, windowStart),
          lt(timeEntries.eventAt, windowEnd),
        ),
      );
    return rows;
  }

  /**
   * Records a REQUEST to correct an entry's timestamp (art. 34.9's right to see and contest).
   *
   * An append of a `correction` row pointing at `correctsEntryId`, status `requested` — it has NO
   * effect on the projection until a supervisor approves it (`approveCorrection`). The row copies its
   * person and location from the entry it corrects, so a correction is always attributed to the same
   * worker and workplace as its target. Returns the new correction's id, which `approveCorrection`
   * names. Throws `correction.target_not_found` if the target does not exist.
   */
  async requestCorrection(tx: Transaction, input: CorrectionRequestInput): Promise<string> {
    const target = await this.entryById(tx, input.correctsEntryId);
    return this.appendCorrection(tx, {
      nodeId: input.nodeId,
      personId: target.personId,
      locationId: target.locationId,
      correctsEntryId: input.correctsEntryId,
      at: input.at,
      offsetMinutes: input.offsetMinutes,
      reason: input.reason,
      actorPersonId: input.actorPersonId,
      status: "requested",
      tillId: input.tillId ?? null,
    });
  }

  /**
   * Approves a requested correction so it takes effect — supervisor-gated (design §5).
   *
   * The immutability floor forbids UPDATE-ing the request's status, so approval is a SECOND append:
   * an `approved` correction targeting the SAME entry the request did, carrying the same corrected
   * value. The request row stays in history beside it. Only `approved` corrections are followed by
   * the projection, so the approval — targeting the original entry — is what the reprojection sees.
   *
   * Throws `correction.not_permitted` if the approver's role is not supervisor/manager/admin,
   * `correction.target_not_found` if no such correction row exists, and
   * `correction.not_pending` if that correction's target already carries an approved correction —
   * a second approval of the same request, or an approval naming an already-`approved` row, both of
   * which would append a duplicate `approved` row (the request→approve-once invariant).
   */
  async approveCorrection(tx: Transaction, input: CorrectionApprovalInput): Promise<string> {
    const role = await this.roleOf(tx, input.approverPersonId);
    if (role === undefined || !SUPERVISOR_ROLES.has(role)) {
      throw new AppError("correction.not_permitted", {
        personId: input.approverPersonId,
      });
    }
    const request = await this.correctionById(tx, input.correctionId);
    // Refuse a second approval BEFORE appending (the immutability floor forbids mutating the request
    // row, so its status stays `requested` and cannot itself signal "already approved"; the signal is
    // an existing approved correction against the SAME target). This is a guard on the append, not a
    // mutation — the request and any prior approval stay in history untouched (design §5).
    if (await this.hasApprovedCorrection(tx, request.correctsEntryId)) {
      throw new AppError("correction.not_pending", {
        correctionId: input.correctionId,
      });
    }
    return this.appendCorrection(tx, {
      nodeId: input.nodeId,
      personId: request.personId,
      locationId: request.locationId,
      // The ORIGINAL entry, not the request row: the projection walks approved corrections from base
      // events, so an approval that pointed at the (unapproved) request would be orphaned and never
      // applied.
      correctsEntryId: request.correctsEntryId,
      at: request.eventAt,
      offsetMinutes: request.offsetMinutes,
      reason: request.reason,
      actorPersonId: input.approverPersonId,
      status: "approved",
      tillId: null,
    });
  }

  /**
   * Opens a DRAFT roster version for one location's week (design §3a) — planning data (mutable),
   * inserted with status 'draft' and a null publish stamp. `input.period` is NORMALIZED to its week
   * Monday first (`weekStartOf`, the same helper the guardrail buckets use), so a non-Monday caller
   * cannot open a mid-week roster and two different days of one calendar week map to the same
   * period_start — closing the mid-week + duplicate-draft hole structurally. `period_end` is derived
   * in SQL as the inclusive Sunday (`date(period, '+6 days')`), so no date value round-trips through
   * TypeScript.
   * Throws `roster.draft_exists` when a draft for this (location, week) already exists — the
   * published-uniqueness index does not cover drafts, so this check-then-insert is the guard.
   * Slice-1 single-author screen: a concurrent double-create could still fork two drafts (no draft
   * unique index — that would be a migration); acceptable and documented here.
   */
  async createRosterVersion(tx: Transaction, input: CreateRosterVersionInput): Promise<string> {
    const period = weekStartOf(input.period);
    const existing = await tx.execute<{ id: string }>(sql`
      select id from roster_versions
      where location_id = ${input.locationId}
        and period_start = ${period} and status = 'draft'
      limit 1`);
    if (existing.rows.length > 0) {
      throw new AppError("roster.draft_exists", {
        locationId: input.locationId,
      });
    }
    // `id` and `created_at` are supplied by hand: both are `$defaultFn` generators declared on the
    // column (`schema/roster-versions.ts`), which drizzle runs for a builder insert and not for raw
    // SQL, and the generated DDL carries no SQL default for either — without them the statement is
    // refused `NOT NULL constraint failed: roster_versions.id`.
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into roster_versions (id, location_id, period_start, period_end, created_at)
      values (${newId()}, ${input.locationId}, ${period}, date(${period}, '+6 days'), ${nowIso()})
      returning id`);
    return rows[0]!.id;
  }

  /**
   * Reads the roster snapshot for one location's week (design §3a) — the current DRAFT (what is being
   * edited) or, when there is none, the current PUBLISHED version, plus its attached shifts. Returns
   * `{ version: null, shifts: [] }` for a week with no roster. `input.period` is NORMALIZED to its
   * week Monday first, the SAME snap `createRosterVersion` applies, so a non-Monday query (from a date
   * picker) still finds the week's roster rather than missing it.
   */
  async getRoster(
    tx: Transaction,
    input: { locationId: string; period: string },
  ): Promise<RosterSnapshot> {
    const period = weekStartOf(input.period);
    // Prefer the DRAFT (what is being edited); fall back to the current PUBLISHED version for the week.
    // Every column here is text on this engine, so the row (and its JSON to the browser) carries the
    // stored strings — 'YYYY-MM-DD' for the two period bounds, a UTC ISO instant for `published_at`.
    const { rows } = await tx.execute<RosterVersionDbRow>(sql`
      select id, location_id, period_start, period_end, status, published_at,
        published_by_person_id
      from roster_versions
      where location_id = ${input.locationId}
        and period_start = ${period} and status in ('draft', 'published')
      order by case when status = 'draft' then 0 else 1 end
      limit 1`);
    const row = rows[0];
    if (row === undefined) return { version: null, shifts: [] };
    const version = mapRosterVersion(row);
    return { version, shifts: await this.shiftsForVersion(tx, version.id) };
  }

  /**
   * Reads one `roster_versions` row by id, or throws `roster.not_found`. The publish route reads a
   * version's `locationId` off this before resolving its collective-agreement ruleset.
   */
  async getRosterVersion(tx: Transaction, input: { versionId: string }): Promise<RosterVersionRow> {
    const { rows } = await tx.execute<RosterVersionDbRow>(sql`
      select id, location_id, period_start, period_end, status, published_at,
        published_by_person_id
      from roster_versions
      where id = ${input.versionId}
      limit 1`);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError("roster.not_found", {
        rosterVersionId: input.versionId,
      });
    }
    return mapRosterVersion(row);
  }

  /** The shifts attached to a version, mapped to `ShiftRow`s ordered by start instant. */
  private async shiftsForVersion(tx: Transaction, versionId: string): Promise<ShiftRow[]> {
    const { rows } = await tx.execute<ShiftDbRow>(sql`
      select id, person_id, location_id, starts_at, starts_offset_minutes, ends_at,
        ends_offset_minutes, role, roster_version_id
      from shifts
      where roster_version_id = ${versionId}
      order by starts_at`);
    return rows.map(mapShift);
  }

  /**
   * Adds a planned shift to a DRAFT roster version (design §3a), attaching it directly
   * (`roster_version_id = versionId`). Refuses a malformed interval up front (`shift.invalid`, not the
   * `shifts_interval_ck` 500 or a `timestamptz` 22007), a missing version (`roster.not_found`, via
   * `rosterVersionStatus`) and a non-draft version (`roster.not_draft`). Planning data — a plain
   * INSERT, no chain.
   */
  async addShift(tx: Transaction, input: AddShiftInput): Promise<string> {
    assertShiftInterval(input.startsAt, input.endsAt);
    const status = await this.rosterVersionStatus(tx, input.versionId); // throws roster.not_found
    if (status !== "draft") {
      throw new AppError("roster.not_draft", {
        rosterVersionId: input.versionId,
      });
    }
    // `id` and `created_at` are supplied by hand: both are `$defaultFn` generators declared on the
    // column (`schema/shifts.ts`), which drizzle runs for a builder insert and not for raw SQL, and
    // the generated DDL carries no SQL default for either — without them the statement is refused
    // `NOT NULL constraint failed: shifts.id`.
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into shifts (id, person_id, location_id, starts_at, starts_offset_minutes,
        ends_at, ends_offset_minutes, role, roster_version_id, created_at)
      values (${newId()}, ${input.personId}, ${input.locationId},
        ${input.startsAt}, ${input.startsOffsetMinutes}, ${input.endsAt}, ${input.endsOffsetMinutes},
        ${input.role}, ${input.versionId}, ${nowIso()})
      returning id`);
    return rows[0]!.id;
  }

  /** Edits a shift on a DRAFT version. Reads the shift + its version status (`shift.not_found` if the
   * shift is gone, `roster.not_draft` if its version is published). Validates the EFFECTIVE interval
   * (patch value ?? current) so a partial edit cannot land a malformed interval as a 500 —
   * `shift.invalid`. The stored value is always a parseable UTC ISO instant, so a NaN in the effective
   * interval can only come from the patch, i.e. `assertShiftInterval` screens exactly the field(s) the
   * patch supplies. */
  async updateShift(tx: Transaction, input: UpdateShiftInput): Promise<void> {
    const shift = await this.shiftForWrite(tx, input.shiftId);
    const startsAt = input.startsAt ?? shift.startsAt;
    const endsAt = input.endsAt ?? shift.endsAt;
    assertShiftInterval(startsAt, endsAt);
    await tx.execute(sql`
      update shifts set
        person_id = ${input.personId ?? shift.personId},
        starts_at = ${startsAt},
        starts_offset_minutes = ${input.startsOffsetMinutes ?? shift.startsOffsetMinutes},
        ends_at = ${endsAt},
        ends_offset_minutes = ${input.endsOffsetMinutes ?? shift.endsOffsetMinutes},
        role = ${input.role === undefined ? shift.role : input.role}
      where id = ${input.shiftId}`);
  }

  /** Deletes a shift on a DRAFT version. Same guards as `updateShift`. */
  async removeShift(tx: Transaction, input: { shiftId: string }): Promise<void> {
    await this.shiftForWrite(tx, input.shiftId);
    await tx.execute(sql`delete from shifts where id = ${input.shiftId}`);
  }

  /** Reads a shift + its version's status, throwing `shift.not_found` (no such shift) or
   * `roster.not_draft` (the shift's non-null version is not a draft). A null `roster_version_id`
   * (an unattached draft shift) is editable — there is no published version to protect. */
  private async shiftForWrite(tx: Transaction, shiftId: string): Promise<ShiftRow> {
    const { rows } = await tx.execute<ShiftDbRow & { version_status: string | null }>(sql`
      select s.id, s.person_id, s.location_id, s.starts_at, s.starts_offset_minutes, s.ends_at,
        s.ends_offset_minutes, s.role, s.roster_version_id, rv.status as version_status
      from shifts s
      left join roster_versions rv on rv.id = s.roster_version_id
      where s.id = ${shiftId}
      limit 1`);
    const row = rows[0];
    if (row === undefined) throw new AppError("shift.not_found", { shiftId });
    if (row.version_status !== null && row.version_status !== "draft") {
      throw new AppError("roster.not_draft", { rosterVersionId: row.roster_version_id! });
    }
    return mapShift(row);
  }

  /**
   * Publishes a draft roster version (design §2.1) — the ONLY scheduling write that touches the
   * legal-vs-planning seam, and it lands squarely on the planning side. Unlike a clock event
   * (`append`, an immutable-ledger INSERT), this UPDATEs mutable planning rows:
   *
   * 1. supersedes any incumbent published version for the SAME (location, exact period), then flips
   *    THIS version `draft → published` and stamps `published_at` (and `published_by_person_id` when
   *    supplied) — the `roster_versions_publish_shape_ck` invariant pairs the two. The supersede runs
   *    FIRST so the incumbent is out of the `roster_versions_published_period_uq` partial index before
   *    this one enters it (§`supersedePriorPublished`);
   * 2. attaches every still-unattached (`roster_version_id is null`) draft shift AT THE VERSION'S
   *    LOCATION whose LOCAL wall date falls within the version's inclusive period, by setting its
   *    `roster_version_id`. The local date is `starts_at` shifted by its wall offset — the same
   *    offset semantics `time_entries` uses — so a shift whose UTC instant sits just outside the
   *    period still attaches when its local date is inside.
   *
   * Throws `roster.not_found` if no such version exists, `roster.already_published`
   * if THIS version is no longer a `draft` (a version is published exactly once — republishing it is
   * refused, never a silent re-stamp), and `roster.period_already_published` if a DIFFERENT version
   * won a concurrent race to publish the same period (the unique-index backstop firing — see
   * `supersedePriorPublished`).
   *
   * Returns the guardrail breaches of the published roster (D2.3) when `input.ruleset` is supplied,
   * an empty array otherwise. Breaches are ADVISORY (OWNER DECISION 2026-08-02): a breaching roster
   * still publishes and the breaches are surfaced here, never thrown — see `validateRoster`.
   */
  async publishRoster(tx: Transaction, input: PublishRosterInput): Promise<RosterBreach[]> {
    const status = await this.rosterVersionStatus(tx, input.versionId);
    if (status !== "draft") {
      throw new AppError("roster.already_published", {
        rosterVersionId: input.versionId,
      });
    }
    await this.supersedePriorPublished(tx, input.versionId);
    try {
      // `published_at` is bound from this process's clock. The PostgreSQL `now()` it replaced read
      // the DATABASE's clock, once per transaction; this engine has no such function and the
      // statement failed outright with `no such function: now`.
      await tx.execute(sql`
        update roster_versions
        set status = 'published', published_at = ${nowIso()},
            published_by_person_id = ${input.publishedByPersonId ?? null}
        where id = ${input.versionId}`);
    } catch (error) {
      // The partial-index backstop firing: a concurrent publish of a DIFFERENT draft for this same
      // (location, period) committed after `supersedePriorPublished` took its lock snapshot, so its
      // published row was invisible to the supersede yet collides here (23505). A translation, not a
      // recovery — Postgres has already aborted the transaction; catching only hands the caller a
      // structured code instead of a raw driver string.
      if (isUniqueViolation(error)) {
        throw new AppError("roster.period_already_published", {
          rosterVersionId: input.versionId,
        });
      }
      throw error;
    }
    // UPDATE ... FROM reads location_id/period_start/period_end straight off the version row, so no
    // date value round-trips through TypeScript. The shift's local wall date is `shiftLocalDate`
    // (shift-local-date.ts), the one home of that expression. The update target is named `shifts`
    // rather than aliased: SQLite refuses a bare alias here (`update shifts s set …` is
    // `near "s": syntax error`, measured on SQLite 3.53.4), and `shiftLocalDate` renders its columns
    // table-qualified.
    await tx.execute(sql`
      update shifts
      set roster_version_id = rv.id
      from roster_versions rv
      where rv.id = ${input.versionId}
        and shifts.location_id = rv.location_id
        and shifts.roster_version_id is null
        and ${shiftLocalDate} between rv.period_start and rv.period_end`);
    // Advisory guardrails: only when the caller supplied a ruleset (the workforce-es resolver's
    // output). Validate exactly the shifts now attached to this version, then return the breaches —
    // publishing has already committed above, so a breach never blocks it.
    if (input.ruleset === undefined) return [];
    return validateRoster(await this.attachedShifts(tx, input.versionId), input.ruleset);
  }

  /** The shifts attached to a published version, as neutral `PlannedShift`s for `validateRoster`.
   * The instants are the stored text, which is what the pure engine's `Date.parse` takes. */
  private async attachedShifts(tx: Transaction, versionId: string): Promise<PlannedShift[]> {
    const { rows } = await tx.execute<{
      id: string;
      person_id: string;
      starts_at: string;
      starts_offset_minutes: number;
      ends_at: string;
      ends_offset_minutes: number;
    }>(sql`
      select id, person_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes
      from shifts
      where roster_version_id = ${versionId}`);
    return rows.map((r) => ({
      shiftId: r.id,
      personId: r.person_id,
      startsAt: r.starts_at,
      startsOffsetMinutes: r.starts_offset_minutes,
      endsAt: r.ends_at,
      endsOffsetMinutes: r.ends_offset_minutes,
    }));
  }

  /**
   * A roster version's `status`, or `roster.not_found` if there is no such version. `publishRoster`
   * reads the publish guard off this.
   *
   * The read took `for update`, so that a second publish of the same draft could not observe
   * `draft` between this statement and the UPDATE that follows it (the guard is a separate
   * statement, so a bare read could not serialise them). One write transaction runs on the venue
   * file at a time, so there is no second publish to interleave with — the pattern is stated once,
   * with its measurement and its control, on `assertExtraListForWrite`
   * (`packages/catalogue/src/extras.ts`).
   */
  private async rosterVersionStatus(tx: Transaction, versionId: string): Promise<string> {
    const { rows } = await tx.execute<{ status: string }>(sql`
      select status from roster_versions
      where id = ${versionId}
      limit 1`);
    const version = rows[0];
    if (version === undefined) {
      throw new AppError("roster.not_found", { rosterVersionId: versionId });
    }
    return version.status;
  }

  /**
   * Demotes any incumbent `published` version for the SAME (location, exact period) as the version
   * about to be published, so at most one published version survives per period (design §2.1, the
   * mutable + supersede model — OWNER DECISION).
   *
   * The incumbent rows were read `for update of prior`, which made the common supersede orderly.
   * That was never what guaranteed the invariant, and the note it replaced said so: the
   * `roster_versions_published_period_uq` partial unique index is, and it still is. The index
   * refuses any publish that would leave a second published row for the period, which
   * `publishRoster` translates to `roster.period_already_published`. The lock is gone because one
   * write transaction runs on the venue file at a time (`assertExtraListForWrite`,
   * `packages/catalogue/src/extras.ts`); the index is untouched.
   *
   * The self-join reads the target's location/period straight off its row (no value round-trips
   * through TypeScript), the same pattern the shift-attach UPDATE in `publishRoster` uses. `prior.id
   * <> versionId` is belt-and-suspenders: the version being published is still `draft` here, so it
   * cannot match `status = 'published'` anyway.
   */
  private async supersedePriorPublished(tx: Transaction, versionId: string): Promise<void> {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select prior.id
      from roster_versions prior
      join roster_versions target on target.id = ${versionId}
      where prior.location_id = target.location_id
        and prior.period_start = target.period_start
        and prior.period_end = target.period_end
        and prior.status = 'published'
        and prior.id <> ${versionId}`);
    if (rows.length === 0) return;
    // `as prior`, not a bare `prior`: SQLite refuses the alias without the keyword
    // (`near "prior": syntax error`, measured on SQLite 3.53.4).
    await tx.execute(sql`
      update roster_versions as prior
      set status = 'superseded'
      from roster_versions target
      where target.id = ${versionId}
        and prior.location_id = target.location_id
        and prior.period_start = target.period_start
        and prior.period_end = target.period_end
        and prior.status = 'published'
        and prior.id <> ${versionId}`);
  }

  /** The state the worker's most recent event left them in — `out` when they have no events yet.
   * Corrections are excluded: a correction of a past shift is not a live clock event and must not
   * drive today's open/closed state (and `correction` has no `STATE_AFTER` entry). */
  private async currentState(tx: Transaction, personId: string): Promise<ShiftState> {
    const { rows } = await tx.execute<{ entry_kind: LiveEntryKind }>(sql`
      select entry_kind from time_entries
      where person_id = ${personId} and entry_kind <> 'correction'
      order by event_at desc, recorded_at desc, node_id desc, sequence_no desc
      limit 1`);
    const last = rows[0];
    return last === undefined ? "out" : STATE_AFTER[last.entry_kind];
  }

  private async append(
    tx: Transaction,
    input: ClockEventInput,
    entryKind: WorkforceEntryKind,
  ): Promise<void> {
    // Every clock event is appended to its (node, location) tamper-evidence chain (Slice 4) — the
    // single-writer path (design §5). The hash, chain position and recorded_at are computed there,
    // never supplied here; `selectHead` (../chain.ts) says what keeps one append out of another's
    // way now that the head row is not locked.
    await appendToChain(
      tx,
      { nodeId: input.nodeId, locationId: input.locationId },
      {
        personId: input.personId,
        entryKind,
        eventAt: input.at,
        eventOffsetMinutes: input.offsetMinutes,
        recordedByPersonId: input.recordedByPersonId ?? input.personId,
        capturedByTillId: input.tillId ?? null,
      },
    );
  }

  /** The person and location of an entry, or `correction.target_not_found` if it does not exist. */
  private async entryById(
    tx: Transaction,
    entryId: string,
  ): Promise<{ personId: string; locationId: string }> {
    const { rows } = await tx.execute<{ person_id: string; location_id: string }>(sql`
      select person_id, location_id from time_entries
      where id = ${entryId}
      limit 1`);
    const entry = rows[0];
    if (entry === undefined) {
      throw new AppError("correction.target_not_found", { entryId });
    }
    return { personId: entry.person_id, locationId: entry.location_id };
  }

  /** A correction row's fields (whatever its `correction_status`), or `correction.target_not_found`
   * if there is no such `correction` row — `approveCorrection` reads the status guard off the target,
   * so it must be handed an already-`approved` row rather than told it does not exist. */
  private async correctionById(
    tx: Transaction,
    correctionId: string,
  ): Promise<{
    personId: string;
    locationId: string;
    correctsEntryId: string;
    eventAt: string;
    offsetMinutes: number;
    reason: string;
  }> {
    const { rows } = await tx.execute<{
      person_id: string;
      location_id: string;
      corrects_entry_id: string;
      event_at: string;
      event_offset_minutes: number;
      correction_reason: string;
    }>(sql`
      select person_id, location_id, corrects_entry_id, event_at,
        event_offset_minutes, correction_reason
      from time_entries
      where id = ${correctionId} and entry_kind = 'correction'
      limit 1`);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError("correction.target_not_found", { entryId: correctionId });
    }
    return {
      personId: row.person_id,
      locationId: row.location_id,
      correctsEntryId: row.corrects_entry_id,
      eventAt: row.event_at,
      offsetMinutes: row.event_offset_minutes,
      reason: row.correction_reason,
    };
  }

  /** Whether an `approved` correction already targets `targetEntryId` — the signal
   * that a request has already been approved (approval targets the ORIGINAL entry, not the request
   * row). One approved correction per target is the invariant `approveCorrection` enforces; a further
   * correction of an already-corrected value chains off the approval instead (a distinct target). */
  private async hasApprovedCorrection(tx: Transaction, targetEntryId: string): Promise<boolean> {
    const { rows } = await tx.execute<{ one: number }>(sql`
      select 1 as one from time_entries
      where corrects_entry_id = ${targetEntryId}
        and entry_kind = 'correction' and correction_status = 'approved'
      limit 1`);
    return rows.length > 0;
  }

  /** A person's `role`, or `undefined` when no such person exists. */
  private async roleOf(tx: Transaction, personId: string): Promise<string | undefined> {
    const { rows } = await tx.execute<{ role: string }>(sql`
      select role from persons where id = ${personId} limit 1`);
    return rows[0]?.role;
  }

  /** Appends one `correction` row. Shared by request and approve — the only difference is `status`
   * and the actor. */
  private async appendCorrection(
    tx: Transaction,
    params: {
      nodeId: string;
      personId: string;
      locationId: string;
      correctsEntryId: string;
      at: string;
      offsetMinutes: number;
      reason: string;
      actorPersonId: string;
      status: "requested" | "approved";
      tillId: string | null;
    },
  ): Promise<string> {
    // A correction is an append like any other — it rides the SAME location chain as the clock
    // events it supersedes, so it cannot dodge the tamper-evidence (design §5). The chain hash
    // commits the correction's OWN content too — its reason, its accountable actor and any capturing
    // till (chain-hash.ts's `canonicalString`) — so a party past the immutability floor (the REVOKE +
    // reject_mutation trigger) that rewrites the reason or the actor breaks `verifyChain`, not just
    // one that reorders or deletes rows. The actor is written to BOTH `recorded_by_person_id` (the
    // operator) and `correction_actor_id` (the accountable actor), and both are hashed, so the actor
    // no longer rides only on the coincidence that the two are the same person here.
    const { id } = await appendToChain(
      tx,
      { nodeId: params.nodeId, locationId: params.locationId },
      {
        personId: params.personId,
        entryKind: "correction",
        eventAt: params.at,
        eventOffsetMinutes: params.offsetMinutes,
        recordedByPersonId: params.actorPersonId,
        capturedByTillId: params.tillId,
        correctsEntryId: params.correctsEntryId,
        correctionReason: params.reason,
        correctionStatus: params.status,
        correctionActorId: params.actorPersonId,
      },
    );
    return id;
  }

  private async contractedMinutesPerWeek(tx: Transaction, personId: string): Promise<number> {
    const { rows } = await tx.execute<{ contracted: number }>(sql`
      select contracted_minutes_per_week as contracted from employments
      where person_id = ${personId}
      order by start_date desc
      limit 1`);
    const employment = rows[0];
    if (employment === undefined) {
      throw new AppError("employment.not_found", { personId });
    }
    return employment.contracted;
  }

  private async entriesInPeriod(
    tx: Transaction,
    query: WorkSummaryQuery,
  ): Promise<TimeEntryRecord[]> {
    // Widen the query window by a day on each side so a session whose LOCAL date falls in the period
    // is fetched even when its UTC instant sits just outside it (max wall offset ±14h < 1 day); the
    // precise local-date filter is `summarisePeriod`'s. `event_at` is a `tsString` column
    // (`packages/db/src/schema/columns.ts`), which this engine stores and returns as the exact
    // string that was written — no `Date` is ever constructed on the way out, so the projection's
    // `Date.parse` always gets a string. Measured 2026-09-23 by printing the value from this
    // method while `src/index.test.ts` ran: `typeof` was `string` and the value
    // `2026-01-05T09:00:00.000Z`. What keeps the string parseable is the write side plus
    // `time_entries_event_at_second_ck` (`./schema/time-entries.ts`), the CHECK that pins the
    // whole-second UTC ISO spelling now that a text column refuses nothing on its own.
    const windowStart = shiftDay(query.period.start, -1);
    const windowEnd = shiftDay(query.period.end, 1);
    // Corrections are fetched alongside base events (no `entry_kind` filter) so `projectWorkSessions`
    // can fold them in. A correction's `event_at` is the CORRECTED clock time — near the original, so
    // the ±1-day window catches it; a correction whose value lands outside the window is out of scope
    // for the floor.
    const rows = await tx
      .select({
        entryId: timeEntries.id,
        personId: timeEntries.personId,
        locationId: timeEntries.locationId,
        nodeId: timeEntries.nodeId,
        entryKind: timeEntries.entryKind,
        eventAt: timeEntries.eventAt,
        recordedAt: timeEntries.recordedAt,
        offsetMinutes: timeEntries.eventOffsetMinutes,
        sequenceNo: timeEntries.sequenceNo,
        correctsEntryId: timeEntries.correctsEntryId,
        correctionStatus: timeEntries.correctionStatus,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.personId, query.personId),
          gte(timeEntries.eventAt, windowStart),
          lt(timeEntries.eventAt, windowEnd),
        ),
      );
    return rows;
  }

  private alreadyOpen(input: ClockEventInput): AppError {
    return new AppError("attendance.already_open", {
      personId: input.personId,
    });
  }

  private noOpenEntry(input: ClockEventInput): AppError {
    return new AppError("attendance.no_open_entry", {
      personId: input.personId,
    });
  }
}

/** The UTC ISO instant `deltaDays` from a local date's midnight — bounds the fetch window. */
function shiftDay(date: string, deltaDays: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + deltaDays * MS_PER_DAY).toISOString();
}

/**
 * Screens a shift's interval before the row reaches the `timestamptz` column, throwing `shift.invalid`
 * (never a driver error) in two cases — shared by `addShift` and `updateShift`:
 *   - either endpoint UNPARSEABLE — `Date.parse` is `NaN`, and because `NaN >= NaN` is `false` a bare
 *     ordering guard would let it through to a 22007 at the DB (`reason: "unparseable_timestamp"`);
 *   - ends not strictly after starts (`reason: "ends_not_after_starts"`) — exactly equal is invalid too.
 * The engine verb is a public `@waitron/workforce` API and must honour this contract itself, even
 * though the HTTP route also screens the inputs (`requireTimestamp`).
 *
 * THIS GUARD IS NOW THE ONLY REAL INTERVAL CHECK, and the loss is worth stating rather than
 * discovering. `starts_at`/`ends_at` are TEXT columns, so `shifts_interval_ck` (`ends_at >
 * starts_at`) compares SPELLINGS, and nothing normalises the spelling on the way in: `addShift`
 * stores the caller's string verbatim, and `requireTimestamp`
 * (`apps/server/src/workforce-api.ts`) accepts anything `Date.parse` accepts — a `+02:00` offset
 * included. Measured on SQLite 3.53.4 (Node v26.7.0), four inserts against this exact constraint,
 * with a control in each direction: a pair spelled `10:00:00.000Z` → `11:00:00.000+02:00` is an
 * interval that ENDS BEFORE it starts and the constraint ACCEPTS it, while `10:00:00.000+02:00` →
 * `09:00:00.000Z` is a valid one-hour shift and the constraint REFUSES it; the same two instant
 * pairs written in one spelling are refused and accepted correctly. `Date.parse` here compares
 * INSTANTS, so the first case never reaches the database — but the second reaches it and comes
 * back as a raw `CHECK constraint failed`, not a structured `shift.invalid`. The same
 * mixed-spelling exposure applies to `order by starts_at` and to `shifts_person_starts_idx`.
 * Normalising both endpoints at this choke point, the way `attemptAppend` (./chain.ts) does for
 * `event_at`, is the fix; it is a behaviour change to a public read (a caller's `+02:00` would come
 * back as `Z`) and is left for the decision that takes it.
 */
function assertShiftInterval(startsAt: string, endsAt: string): void {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new AppError("shift.invalid", { reason: "unparseable_timestamp" });
  }
  if (startMs >= endMs) {
    throw new AppError("shift.invalid", { reason: "ends_not_after_starts" });
  }
}

/** The raw `roster_versions` shape `getRoster`/`getRosterVersion` read — snake_case, dates cast to
 * 'YYYY-MM-DD' text and `published_at` to a UTC ISO instant, so no driver divergence reaches the map. */
type RosterVersionDbRow = {
  id: string;
  location_id: string;
  period_start: string;
  period_end: string;
  status: string;
  published_at: string | null;
  published_by_person_id: string | null;
};

/** The raw `shifts` shape the read verbs return — the instants are the stored text. A
 * `type` object literal (not an `interface`) so it satisfies `tx.execute`'s `Record<string, unknown>`
 * constraint via TypeScript's implicit index signature, matching this file's inline row types. */
type ShiftDbRow = {
  id: string;
  person_id: string;
  location_id: string;
  starts_at: string;
  starts_offset_minutes: number;
  ends_at: string;
  ends_offset_minutes: number;
  role: string | null;
  roster_version_id: string | null;
};

function mapRosterVersion(r: RosterVersionDbRow): RosterVersionRow {
  return {
    id: r.id,
    locationId: r.location_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status as RosterVersionRow["status"],
    publishedAt: r.published_at,
    publishedByPersonId: r.published_by_person_id,
  };
}

function mapShift(r: ShiftDbRow): ShiftRow {
  return {
    id: r.id,
    personId: r.person_id,
    locationId: r.location_id,
    startsAt: r.starts_at,
    startsOffsetMinutes: r.starts_offset_minutes,
    endsAt: r.ends_at,
    endsOffsetMinutes: r.ends_offset_minutes,
    role: r.role,
    rosterVersionId: r.roster_version_id,
  };
}
