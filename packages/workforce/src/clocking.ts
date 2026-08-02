import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import {
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

/** The three states a worker's shift can be in, derived from the most recent clock event. */
type ShiftState = "out" | "working" | "on_break";

const MS_PER_DAY = 86_400_000;

/** The state each entry kind LEAVES the worker in. */
const STATE_AFTER: Record<WorkforceEntryKind, ShiftState> = {
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
   * Worked minutes and overtime for a person over a pay period (art. 35.5), computed from the
   * `time_entries` stream against the employment's contracted week. Overtime is actual − contracted,
   * with the weekly baseline scaled to the period's length.
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
    const contractedMinutes = Math.round((contractedPerWeek * periodDays) / 7);
    return summarisePeriod(sessions, query.period, contractedMinutes);
  }

  /** The state the worker's most recent event left them in — `out` when they have no events yet. */
  private async currentState(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<ShiftState> {
    const { rows } = await tx.execute<{ entry_kind: WorkforceEntryKind }>(sql`
      select entry_kind from time_entries
      where tenant_id = ${tenantId} and person_id = ${personId}
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
    const rows = await tx
      .select({
        personId: timeEntries.personId,
        locationId: timeEntries.locationId,
        entryKind: timeEntries.entryKind,
        eventAt: sql<string>`to_char(${timeEntries.eventAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
        offsetMinutes: timeEntries.eventOffsetMinutes,
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
