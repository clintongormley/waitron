import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import {
  dailyContractedTargetMinutes,
  projectWorkSessions,
  summarisePeriod,
  type Period,
  type PeriodSummary,
  type TimeEntryRecord,
  type WorkforceEntryKind,
} from "./projection.js";
// Side-effect: registers this package's attendance.*/employment.* codes so `new AppError(...)`
// below type-checks against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** One clock event's inputs. `at`/`offsetMinutes` are the trusted event timestamp and its wall
 * offset, supplied by the caller (as `recordSale` is handed `issuedAt`), never read here. */
export interface ClockEventInput {
  tenantId: string;
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
  tenantId: string;
  personId: string;
  /** The pay period, as a half-open local-date window `[start, end)`. */
  period: Period;
}

/** A request to correct an entry's timestamp — an append, never an edit of the target. */
export interface CorrectionRequestInput {
  tenantId: string;
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
  tenantId: string;
  /** The `requested` correction to approve. */
  correctionId: string;
  /** Who is approving — must hold a supervisor/manager/admin role. */
  approverPersonId: string;
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
 */
export class WorkforceBackend {
  /** out → working. */
  async clockIn(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state !== "out") throw this.alreadyOpen(input);
    await this.append(tx, input, "in");
  }

  /** working → out. */
  async clockOut(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "out");
  }

  /** working → on_break. */
  async breakStart(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state === "on_break") throw this.alreadyOpen(input);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_start");
  }

  /** on_break → working. */
  async breakEnd(tx: Transaction, input: ClockEventInput): Promise<void> {
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state !== "on_break") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_end");
  }

  /**
   * Worked minutes and overtime for a person over a pay period, computed from the `time_entries`
   * stream against the employment's contracted week. Returns BOTH overtime models (daily-accrual and
   * period-net) side by side plus the per-day breakdown — the binding model is convenio/contract
   * driven, not decided here (see `summarisePeriod`). The period-net baseline scales the weekly
   * jornada to the period length; the daily target is a floor-scope default until D2's
   * schedule/convenio_config supplies a true per-day figure (`dailyContractedTargetMinutes`).
   */
  async workSummary(tx: Transaction, query: WorkSummaryQuery): Promise<PeriodSummary> {
    const contractedPerWeek = await this.contractedMinutesPerWeek(
      tx,
      query.tenantId,
      query.personId,
    );
    const entries = await this.entriesInPeriod(tx, query);
    const sessions = projectWorkSessions(entries);
    const periodDays = (Date.parse(query.period.end) - Date.parse(query.period.start)) / MS_PER_DAY;
    return summarisePeriod(sessions, query.period, {
      periodMinutes: Math.round((contractedPerWeek * periodDays) / 7),
      dailyTargetMinutes: dailyContractedTargetMinutes(contractedPerWeek),
    });
  }

  /**
   * Records a REQUEST to correct an entry's timestamp (art. 34.9's right to see and contest).
   *
   * An append of a `correction` row pointing at `correctsEntryId`, status `requested` — it has NO
   * effect on the projection until a supervisor approves it (`approveCorrection`). The row copies its
   * person and location from the entry it corrects, so a correction is always attributed to the same
   * worker and workplace as its target. Returns the new correction's id, which `approveCorrection`
   * names. Throws `correction.target_not_found` if the target does not exist under this tenant.
   */
  async requestCorrection(tx: Transaction, input: CorrectionRequestInput): Promise<string> {
    const target = await this.entryById(tx, input.tenantId, input.correctsEntryId);
    return this.appendCorrection(tx, {
      tenantId: input.tenantId,
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
   * Throws `correction.not_permitted` if the approver's role is not supervisor/manager/admin, and
   * `correction.target_not_found` if no such requested correction exists under this tenant.
   */
  async approveCorrection(tx: Transaction, input: CorrectionApprovalInput): Promise<string> {
    const role = await this.roleOf(tx, input.tenantId, input.approverPersonId);
    if (role === undefined || !SUPERVISOR_ROLES.has(role)) {
      throw new AppError("correction.not_permitted", {
        tenantId: input.tenantId,
        personId: input.approverPersonId,
      });
    }
    const request = await this.correctionById(tx, input.tenantId, input.correctionId);
    return this.appendCorrection(tx, {
      tenantId: input.tenantId,
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

  /** The state the worker's most recent event left them in — `out` when they have no events yet.
   * Corrections are excluded: a correction of a past shift is not a live clock event and must not
   * drive today's open/closed state (and `correction` has no `STATE_AFTER` entry). */
  private async currentState(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<ShiftState> {
    const { rows } = await tx.execute<{ entry_kind: LiveEntryKind }>(sql`
      select entry_kind from time_entries
      where tenant_id = ${tenantId} and person_id = ${personId} and entry_kind <> 'correction'
      order by event_at desc, ingest_seq desc
      limit 1`);
    const last = rows[0];
    return last === undefined ? "out" : STATE_AFTER[last.entry_kind];
  }

  private async append(
    tx: Transaction,
    input: ClockEventInput,
    entryKind: WorkforceEntryKind,
  ): Promise<void> {
    await tx.insert(timeEntries).values({
      tenantId: input.tenantId,
      personId: input.personId,
      locationId: input.locationId,
      entryKind,
      eventAt: input.at,
      eventOffsetMinutes: input.offsetMinutes,
      capturedByTillId: input.tillId ?? null,
      recordedByPersonId: input.recordedByPersonId ?? input.personId,
    });
  }

  /** The person and location of an entry, or `correction.target_not_found` if it does not exist. */
  private async entryById(
    tx: Transaction,
    tenantId: string,
    entryId: string,
  ): Promise<{ personId: string; locationId: string }> {
    const { rows } = await tx.execute<{ person_id: string; location_id: string }>(sql`
      select person_id, location_id from time_entries
      where tenant_id = ${tenantId} and id = ${entryId}
      limit 1`);
    const entry = rows[0];
    if (entry === undefined) {
      throw new AppError("correction.target_not_found", { tenantId, entryId });
    }
    return { personId: entry.person_id, locationId: entry.location_id };
  }

  /** A requested correction's fields, or `correction.target_not_found` if there is no such row. */
  private async correctionById(
    tx: Transaction,
    tenantId: string,
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
      select person_id, location_id, corrects_entry_id,
        to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_at,
        event_offset_minutes, correction_reason
      from time_entries
      where tenant_id = ${tenantId} and id = ${correctionId} and entry_kind = 'correction'
      limit 1`);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError("correction.target_not_found", { tenantId, entryId: correctionId });
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

  /** A person's `role`, or `undefined` when no such person exists under the tenant. */
  private async roleOf(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<string | undefined> {
    const { rows } = await tx.execute<{ role: string }>(sql`
      select role from persons where tenant_id = ${tenantId} and id = ${personId} limit 1`);
    return rows[0]?.role;
  }

  /** Appends one `correction` row. Shared by request and approve — the only difference is `status`
   * and the actor. */
  private async appendCorrection(
    tx: Transaction,
    params: {
      tenantId: string;
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
    const [inserted] = await tx
      .insert(timeEntries)
      .values({
        tenantId: params.tenantId,
        personId: params.personId,
        locationId: params.locationId,
        entryKind: "correction",
        eventAt: params.at,
        eventOffsetMinutes: params.offsetMinutes,
        capturedByTillId: params.tillId,
        recordedByPersonId: params.actorPersonId,
        correctsEntryId: params.correctsEntryId,
        correctionReason: params.reason,
        correctionStatus: params.status,
        correctionActorId: params.actorPersonId,
      })
      .returning({ id: timeEntries.id });
    return inserted!.id;
  }

  private async contractedMinutesPerWeek(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<number> {
    const { rows } = await tx.execute<{ contracted: number }>(sql`
      select contracted_minutes_per_week as contracted from employments
      where tenant_id = ${tenantId} and person_id = ${personId}
      order by start_date desc
      limit 1`);
    const employment = rows[0];
    if (employment === undefined) {
      throw new AppError("employment.not_found", { tenantId, personId });
    }
    return employment.contracted;
  }

  private async entriesInPeriod(
    tx: Transaction,
    query: WorkSummaryQuery,
  ): Promise<TimeEntryRecord[]> {
    // Widen the query window by a day on each side so a session whose LOCAL date falls in the period
    // is fetched even when its UTC instant sits just outside it (max wall offset ±14h < 1 day); the
    // precise local-date filter is `summarisePeriod`'s. `event_at` is read through the timestamptz
    // column's mode:"string", normalised to a UTC ISO instant so the projection's `Date.parse` sees
    // a string under either driver (node-postgres returns a Date, PGlite a string — registro-row.ts).
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
        entryKind: timeEntries.entryKind,
        eventAt: sql<string>`to_char(${timeEntries.eventAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
        offsetMinutes: timeEntries.eventOffsetMinutes,
        ingestSeq: timeEntries.ingestSeq,
        correctsEntryId: timeEntries.correctsEntryId,
        correctionStatus: timeEntries.correctionStatus,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, query.tenantId),
          eq(timeEntries.personId, query.personId),
          gte(timeEntries.eventAt, windowStart),
          lt(timeEntries.eventAt, windowEnd),
        ),
      );
    return rows;
  }

  private alreadyOpen(input: ClockEventInput): AppError {
    return new AppError("attendance.already_open", {
      tenantId: input.tenantId,
      personId: input.personId,
    });
  }

  private noOpenEntry(input: ClockEventInput): AppError {
    return new AppError("attendance.no_open_entry", {
      tenantId: input.tenantId,
      personId: input.personId,
    });
  }
}

/** The UTC ISO instant `deltaDays` from a local date's midnight — bounds the fetch window. */
function shiftDay(date: string, deltaDays: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + deltaDays * MS_PER_DAY).toISOString();
}
