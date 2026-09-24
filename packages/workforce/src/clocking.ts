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
// Side-effect: registers this package's codes on the shared AppError registry.
import "./errors.js";

/** `at`/`offsetMinutes` are the trusted event timestamp and its wall offset, supplied by the caller,
 * never read from a clock here. */
export interface ClockEventInput {
  /** The recording node, whose chain the entry is appended to. */
  nodeId: string;
  personId: string;
  locationId: string;
  at: string;
  offsetMinutes: number;
  tillId?: string | null;
  /** Who recorded it; defaults to the subject (self-service clock-in). */
  recordedByPersonId?: string;
}

export interface WorkSummaryQuery {
  personId: string;
  /** The pay period, as a half-open local-date window `[start, end)`. */
  period: Period;
}

/** Resolved from a `convenio_config` row by `packages/workforce-es`; its defaults live in that
 * table's column defaults, not here. */
export interface WorkSummaryRuleset {
  /** The daily-target denominator when `dailyTargetMinutes` is null. */
  workingDaysPerWeek: number;
  /** Which overtime reading is the headline. Changing it moves only the headline, never the two
   * underlying figures. */
  overtimeModel: OvertimeModel;
  /** When non-null it IS the daily-accrual target; null derives it as the weekly working time ÷
   * `workingDaysPerWeek`. */
  dailyTargetMinutes: number | null;
}

/** A request to correct an entry's timestamp — an append, never an edit of the target. */
export interface CorrectionRequestInput {
  /** The RECORDING node, whose chain gets the correction; it need not be the target's node. */
  nodeId: string;
  /** A base clock event, or an earlier correction. */
  correctsEntryId: string;
  at: string;
  offsetMinutes: number;
  reason: string;
  actorPersonId: string;
  tillId?: string | null;
}

/** A supervisor's approval of a requested correction — the second append that gives it effect. */
export interface CorrectionApprovalInput {
  nodeId: string;
  /** The `requested` correction to approve. */
  correctionId: string;
  /** Must hold a supervisor/manager/admin role. */
  approverPersonId: string;
}

export interface PublishRosterInput {
  /** Must be a `draft`, or `roster.already_published`. */
  versionId: string;
  publishedByPersonId?: string | null;
  /** Resolved by the caller (`packages/workforce-es`); `publishRoster` never reads
   * `convenio_config`. When present, breaches are RETURNED and publishing proceeds regardless (owner
   * decision 2026-08-02); when omitted, none are evaluated. */
  ruleset?: WorkTimeRuleset;
}

export interface CreateRosterVersionInput {
  locationId: string;
  /** Any day (YYYY-MM-DD) of the week; normalized to that week's Monday, so any two days of one week
   * open the same draft. */
  period: string;
}

/** Dates as 'YYYY-MM-DD' strings, `published_at` as a UTC ISO instant. */
export interface RosterVersionRow {
  id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  publishedByPersonId: string | null;
}

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

export interface AddShiftInput {
  versionId: string;
  personId: string;
  /** Should match the version's location; nothing here checks it. */
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

/** Only the supplied fields change. */
export interface UpdateShiftInput {
  shiftId: string;
  personId?: string;
  startsAt?: string;
  startsOffsetMinutes?: number;
  endsAt?: string;
  endsOffsetMinutes?: number;
  role?: string | null;
}

type ShiftState = "out" | "working" | "on_break";

type LiveEntryKind = Exclude<WorkforceEntryKind, "correction">;

const SUPERVISOR_ROLES = new Set(["supervisor", "manager", "admin"]);

const MS_PER_DAY = 86_400_000;

const STATE_AFTER: Record<LiveEntryKind, ShiftState> = {
  in: "working",
  break_end: "working",
  break_start: "on_break",
  out: "out",
};

/**
 * Every clock method refuses an illegal transition (`attendance.*`) BEFORE appending: `out →in→
 * working →break_start→ on_break →break_end→ working →out→ out`. Nothing can land between the state
 * read and the append because one write transaction runs on the venue file at a time
 * (`assertExtraListForWrite`, `packages/catalogue/src/extras.ts`).
 */
export class WorkforceBackend {
  async clockIn(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state !== "out") throw this.alreadyOpen(input);
    await this.append(tx, input, "in");
  }

  async clockOut(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "out");
  }

  async breakStart(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state === "on_break") throw this.alreadyOpen(input);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_start");
  }

  async breakEnd(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.personId);
    if (state !== "on_break") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_end");
  }

  /**
   * Returns BOTH overtime models plus the per-day breakdown; `ruleset.overtimeModel` picks the
   * headline. Which model binds for an employment is a collective-agreement decision, not made here.
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
        dailyTargetMinutes:
          dailyTargetMinutes ?? dailyContractedTargetMinutes(contractedPerWeek, workingDaysPerWeek),
      },
      overtimeModel,
    );
  }

  /** Planned = the currently-PUBLISHED roster version's shifts; actual = the projected work sessions. */
  async getPlannedVsActual(
    tx: Transaction,
    query: { locationId: string; period: Period },
  ): Promise<PlannedVsActual[]> {
    const plannedShifts = await this.plannedShiftsInPeriod(tx, query.locationId, query.period);
    const entries = await this.entriesForLocationInPeriod(tx, query.locationId, query.period);
    // The ±1-day widened fetch can return a session one local day outside the window.
    const sessions = projectWorkSessions(entries).filter(
      (s) => s.workDate >= query.period.start && s.workDate < query.period.end,
    );
    return comparePlannedVsActual(plannedShifts, sessions);
  }

  /** Published-only is an owner decision (2026-08-15): a shift on a draft or superseded version, or
   * on none, must not manufacture phantom no-shows. */
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

  /** Every person's entries at the location, over the same ±1-day-widened window as
   * `entriesInPeriod`, corrections included. */
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
   * Has NO effect on the projection until approved (`approveCorrection`). Person and location are
   * copied from the target. Throws `correction.target_not_found` if the target does not exist.
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
   * The request row cannot be updated, so approval is a SECOND append: an `approved` correction of
   * the same entry the request targeted, carrying the same value.
   *
   * Throws `correction.not_permitted` if the approver's role is not supervisor/manager/admin,
   * `correction.target_not_found` if no such correction row exists, and `correction.not_pending` if
   * the target already carries an approved correction.
   */
  async approveCorrection(tx: Transaction, input: CorrectionApprovalInput): Promise<string> {
    const role = await this.roleOf(tx, input.approverPersonId);
    if (role === undefined || !SUPERVISOR_ROLES.has(role)) {
      throw new AppError("correction.not_permitted", {
        personId: input.approverPersonId,
      });
    }
    const request = await this.correctionById(tx, input.correctionId);
    // The request row stays `requested` forever, so an approved correction of the same target is the
    // only "already approved" signal.
    if (await this.hasApprovedCorrection(tx, request.correctsEntryId)) {
      throw new AppError("correction.not_pending", {
        correctionId: input.correctionId,
      });
    }
    return this.appendCorrection(tx, {
      nodeId: input.nodeId,
      personId: request.personId,
      locationId: request.locationId,
      // The ORIGINAL entry, not the request row: an approval of the unapproved request would never
      // be applied by the projection.
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
   * Throws `roster.draft_exists` when a draft for this (location, week) already exists: no unique
   * index covers drafts, so this check-then-insert is the guard.
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
    // `id` and `created_at` by hand: their `$defaultFn`s run for a builder insert, not for raw SQL.
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into roster_versions (id, location_id, period_start, period_end, created_at)
      values (${newId()}, ${input.locationId}, ${period}, date(${period}, '+6 days'), ${nowIso()})
      returning id`);
    return rows[0]!.id;
  }

  /** The week's DRAFT if there is one, else its PUBLISHED version. */
  async getRoster(
    tx: Transaction,
    input: { locationId: string; period: string },
  ): Promise<RosterSnapshot> {
    const period = weekStartOf(input.period);
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

  /** Throws `roster.not_found`. */
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
   * Refuses a malformed interval (`shift.invalid`), a missing version (`roster.not_found`) and a
   * non-draft version (`roster.not_draft`).
   */
  async addShift(tx: Transaction, input: AddShiftInput): Promise<string> {
    assertShiftInterval(input.startsAt, input.endsAt);
    const status = await this.rosterVersionStatus(tx, input.versionId);
    if (status !== "draft") {
      throw new AppError("roster.not_draft", {
        rosterVersionId: input.versionId,
      });
    }
    // `id` and `created_at` by hand: their `$defaultFn`s run for a builder insert, not for raw SQL.
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into shifts (id, person_id, location_id, starts_at, starts_offset_minutes,
        ends_at, ends_offset_minutes, role, roster_version_id, created_at)
      values (${newId()}, ${input.personId}, ${input.locationId},
        ${input.startsAt}, ${input.startsOffsetMinutes}, ${input.endsAt}, ${input.endsOffsetMinutes},
        ${input.role}, ${input.versionId}, ${nowIso()})
      returning id`);
    return rows[0]!.id;
  }

  /** Validates the EFFECTIVE interval (patch value ?? current), so a partial edit cannot land a
   * malformed one. Throws `shift.not_found`, `roster.not_draft` or `shift.invalid`. */
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

  /** A shift with a null `roster_version_id` is editable: there is no published version to protect. */
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
   * Supersedes any incumbent published version for the same (location, exact period) FIRST, so it
   * leaves `roster_versions_published_period_uq` before this one enters it; then publishes this
   * version and attaches every unattached shift at its location whose LOCAL date falls in the period.
   *
   * Throws `roster.not_found`, `roster.already_published` (a version is published once), and
   * `roster.period_already_published` when that unique index fires.
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
      await tx.execute(sql`
        update roster_versions
        set status = 'published', published_at = ${nowIso()},
            published_by_person_id = ${input.publishedByPersonId ?? null}
        where id = ${input.versionId}`);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("roster.period_already_published", {
          rosterVersionId: input.versionId,
        });
      }
      throw error;
    }
    // Not aliased: SQLite refuses `update shifts s set …`, and `shiftLocalDate` qualifies its columns
    // with `shifts`.
    await tx.execute(sql`
      update shifts
      set roster_version_id = rv.id
      from roster_versions rv
      where rv.id = ${input.versionId}
        and shifts.location_id = rv.location_id
        and shifts.roster_version_id is null
        and ${shiftLocalDate} between rv.period_start and rv.period_end`);
    if (input.ruleset === undefined) return [];
    return validateRoster(await this.attachedShifts(tx, input.versionId), input.ruleset);
  }

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

  /** Throws `roster.not_found`. */
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
   * about to be published. `roster_versions_published_period_uq` is what guarantees one published
   * version per period, not this.
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
    // `as prior`: SQLite refuses the alias without the keyword.
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

  /** Corrections are excluded: a correction of a past shift must not drive today's state. */
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

  /** Throws `correction.target_not_found`. */
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

  /** Whatever its `correction_status`, so an already-`approved` row reaches `approveCorrection`'s
   * `not_pending` guard rather than reading as not found. */
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

  /** A further correction of an already-corrected value targets the approval, a distinct entry. */
  private async hasApprovedCorrection(tx: Transaction, targetEntryId: string): Promise<boolean> {
    const { rows } = await tx.execute<{ one: number }>(sql`
      select 1 as one from time_entries
      where corrects_entry_id = ${targetEntryId}
        and entry_kind = 'correction' and correction_status = 'approved'
      limit 1`);
    return rows.length > 0;
  }

  private async roleOf(tx: Transaction, personId: string): Promise<string | undefined> {
    const { rows } = await tx.execute<{ role: string }>(sql`
      select role from persons where id = ${personId} limit 1`);
    return rows[0]?.role;
  }

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
    // Widened a day each side (max wall offset ±14h < 1 day) so a session whose LOCAL date is in the
    // period is fetched; `summarisePeriod` does the exact filter.
    const windowStart = shiftDay(query.period.start, -1);
    const windowEnd = shiftDay(query.period.end, 1);
    // A correction is filtered by its CORRECTED time, so one whose corrected time falls outside the
    // window is not fetched.
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
 * `NaN >= NaN` is false, so an unparseable endpoint needs its own test.
 *
 * The only real interval check: `shifts_interval_ck` compares TEXT spellings and `addShift` stores the
 * caller's spelling verbatim, so a valid pair spelled differently (another offset, or `09:00:00Z`
 * beside `09:00:00.500Z`) can still be refused by that CHECK as a raw error, and
 * `order by starts_at` can misorder shifts spelled differently. Normalising both endpoints, as
 * `attemptAppend` (./chain.ts) does for `event_at`, is the unmade fix: it would change what a
 * caller reads back.
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

type RosterVersionDbRow = {
  id: string;
  location_id: string;
  period_start: string;
  period_end: string;
  status: string;
  published_at: string | null;
  published_by_person_id: string | null;
};

/** A `type`, not an `interface`, so it satisfies `tx.execute`'s `Record<string, unknown>` constraint. */
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
