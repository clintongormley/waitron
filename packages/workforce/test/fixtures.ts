import { sql } from "drizzle-orm";
import { locations } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { hashPin } from "@waitron/identity";
import { appendToChain } from "../src/chain.js";
import type { WorkforceEntryKind } from "../src/projection.js";
import type { WorkTimeRuleset } from "../src/ruleset.js";

/**
 * A `WorkTimeRuleset` with every field at its ET-statutory / today's-default value — what a DEFAULT
 * `convenio_config` row resolves to (see packages/workforce-es/src/convenio.ts). A suite overrides
 * exactly the one limit it is exercising, so the guardrail thresholds are the TEST's, never the
 * engine's (the engine hard-codes none — roster-validation.no-hardcoded-limits.test.ts proves it).
 * Under `test/`, so its explicit numbers are out of the english-only scan and the src coverage glob.
 */
export function makeRuleset(overrides: Partial<WorkTimeRuleset> = {}): WorkTimeRuleset {
  return {
    workingDaysPerWeek: 5,
    overtimeModel: "daily-accrual",
    referencePeriodDays: null,
    compensationWindowDays: null,
    dailyTargetMinutes: null,
    maxWeeklyMinutes: 2400,
    minInterShiftRestMinutes: 720,
    maxOrdinaryDailyMinutes: 540,
    breakThresholdMinutes: 360,
    minBreakMinutes: 15,
    weeklyRestMinutes: 2160,
    annualOvertimeCapHours: 80,
    nightWindowStartMinute: 1320,
    nightWindowEndMinute: 360,
    nightPremiumPct: null,
    splitShiftPremium: null,
    breaksCountAsWorked: false,
    ...overrides,
  };
}

/**
 * Seed helpers for the workforce suites, using the fixture connection directly. English strings
 * throughout: this file is under `test/`, out of the English-only guard's `src` scan, but the
 * package's vocabulary is English regardless.
 */

/** A location (centro de trabajo) for the tenant. Returns its id.
 *
 * Inserted through the `locations` table definition rather than as raw SQL: `id` is a JavaScript
 * generator (`$defaultFn(newId)`), not a database DEFAULT, so a raw INSERT that omits the column
 * writes nothing there; and `invoice_locales` is a JSON array in a text column, which the
 * `labelList` helper serialises from the plain array passed here. */
export async function seedLocation(db: Database): Promise<string> {
  const [row] = await db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return row!.id;
}

/** A person, PIN '1234'. Returns its id. */
export async function seedPerson(db: Database, name = "Ana"): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into persons (display_name, pin_hash)
    values (${name}, ${hashPin("1234")})
    returning id`);
  return result.rows[0]!.id;
}

/** An employment for the person, defaulting to a 40h (2400-minute) contracted week. Returns its id. */
export async function seedEmployment(
  db: Database | Transaction,
  params: { personId: string; contractedMinutesPerWeek?: number },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into employments (
      person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate
    ) values (${params.personId},
      ${params.contractedMinutesPerWeek ?? 2400}, 'full_time', '2026-01-01', 1500
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A draft roster_versions row for the location. Defaults to a one-week period. Returns its
 * id. Planning data (mutable) — inserted as `draft` with no `published_at`. */
export async function insertRosterVersion(
  db: Database | Transaction,
  params: {
    locationId: string;
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into roster_versions (location_id, period_start, period_end)
    values (${params.locationId},
      ${params.periodStart ?? "2026-01-05"}, ${params.periodEnd ?? "2026-01-11"}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A draft `shifts` row (planning data, `roster_version_id` null until publish). Defaults to a
 * 09:00–17:00 shift on 2026-01-05, wall offset 0. Returns its id. */
export async function insertDraftShift(
  db: Database | Transaction,
  params: {
    personId: string;
    locationId: string;
    startsAt?: string;
    startsOffsetMinutes?: number;
    endsAt?: string;
    endsOffsetMinutes?: number;
    role?: string | null;
    rosterVersionId?: string | null;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into shifts (
      person_id, location_id, starts_at, starts_offset_minutes,
      ends_at, ends_offset_minutes, role, roster_version_id
    ) values (${params.personId}, ${params.locationId},
      ${params.startsAt ?? "2026-01-05T09:00:00Z"}, ${params.startsOffsetMinutes ?? 0},
      ${params.endsAt ?? "2026-01-05T17:00:00Z"}, ${params.endsOffsetMinutes ?? 0},
      ${params.role ?? null}, ${params.rosterVersionId ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** An `absences` row for the person. Defaults to a 5–8 Jan holiday, status `requested`, no
 * note. `createdAt` has NO database default: `absences.created_at` is `tsString(...).$defaultFn(nowIso)`,
 * a JavaScript generator drizzle runs per insert, and `drizzle/0000_baseline.sql` declares the column
 * `text NOT NULL` with no DEFAULT — so the raw insert below cannot reach it (node:sqlite refuses the
 * `default` keyword inside a VALUES list: `near "default": syntax error`, measured on Node v26.7.0).
 * Pass `createdAt` to control ordering (the listPending suites seed OUT-OF-INSERT-ORDER timestamps to
 * prove `order by created_at`). Planning data (mutable). Returns its id. */
export async function insertAbsence(
  db: Database | Transaction,
  params: {
    personId: string;
    kind?: string;
    startsOn?: string;
    endsOn?: string;
    status?: string;
    note?: string | null;
    createdAt?: string;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into absences (person_id, absence_kind, starts_on, ends_on, status, note, created_at)
    values (${params.personId}, ${params.kind ?? "holiday"},
      ${params.startsOn ?? "2026-01-05"}, ${params.endsOn ?? "2026-01-08"},
      ${params.status ?? "requested"}, ${params.note ?? null},
      ${params.createdAt === undefined ? sql`default` : params.createdAt}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** An `availability` row for the person. Defaults to weekday 0, 09:00–17:00, from 1 Jan,
 * open-ended. Planning data (mutable). Returns its id. */
export async function insertAvailability(
  db: Database | Transaction,
  params: {
    personId: string;
    weekday?: number;
    availableFromMinute?: number;
    availableToMinute?: number;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into availability (
      person_id, weekday, available_from_minute, available_to_minute,
      effective_from, effective_to
    ) values (${params.personId}, ${params.weekday ?? 0},
      ${params.availableFromMinute ?? 540}, ${params.availableToMinute ?? 1020},
      ${params.effectiveFrom ?? "2026-01-01"}, ${params.effectiveTo ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A `shift_templates` row for the location. Defaults to "Evening bar", weekday 0,
 * 18:00–24:00, role null. Planning data (mutable). Returns its id. */
export async function insertShiftTemplate(
  db: Database | Transaction,
  params: {
    locationId: string;
    label?: string;
    weekday?: number;
    startsMinute?: number;
    endsMinute?: number;
    role?: string | null;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into shift_templates (
      location_id, label, weekday, starts_minute, ends_minute, role
    ) values (${params.locationId}, ${params.label ?? "Evening bar"},
      ${params.weekday ?? 0}, ${params.startsMinute ?? 1080}, ${params.endsMinute ?? 1440},
      ${params.role ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A `shift_swaps` row. Status defaults to `requested`, `to_shift_id` null. `createdAt` has NO
 * database default, exactly as on {@link insertAbsence}: `shift_swaps.created_at` is
 * `tsString(...).$defaultFn(nowIso)`, a JavaScript generator, and the generated DDL declares the
 * column `text NOT NULL` with no DEFAULT. Pass it to control ordering (the listPending suites seed
 * OUT-OF-INSERT-ORDER timestamps to prove `order by created_at`). Planning data (mutable). Returns
 * its id. */
export async function insertShiftSwap(
  db: Database | Transaction,
  params: {
    requestedByPersonId: string;
    fromShiftId: string;
    toPersonId: string;
    toShiftId?: string | null;
    status?: string;
    createdAt?: string;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into shift_swaps (
      requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status, created_at
    ) values (${params.requestedByPersonId}, ${params.fromShiftId},
      ${params.toPersonId}, ${params.toShiftId ?? null}, ${params.status ?? "requested"},
      ${params.createdAt === undefined ? sql`default` : params.createdAt}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** Appends one clock event THROUGH the Slice-4 chain, so seeded rows are chained exactly as the
 * write path produces them (`recorded_by_person_id` defaults to the subject — self-service).
 *
 * Wrapped in `.transaction()` because `appendToChain` needs a Transaction for its savepoint retry
 * and its `FOR UPDATE` head lock; both a `Database` (BEGIN) and a `Transaction` (SAVEPOINT) expose
 * `.transaction()`, so this fixture works whether a suite hands it a pool or a live tx. */
export async function insertTimeEntry(
  tx: Database | Transaction,
  params: {
    nodeId: string;
    personId: string;
    locationId: string;
    entryKind?: WorkforceEntryKind;
    eventAt?: string;
    offsetMinutes?: number;
  },
): Promise<void> {
  await tx.transaction((inner) =>
    appendToChain(
      inner,
      { nodeId: params.nodeId, locationId: params.locationId },
      {
        personId: params.personId,
        entryKind: params.entryKind ?? "in",
        eventAt: params.eventAt ?? "2026-01-05T09:00:00Z",
        eventOffsetMinutes: params.offsetMinutes ?? 0,
        recordedByPersonId: params.personId,
      },
    ),
  );
}
