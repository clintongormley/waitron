import { sql } from "drizzle-orm";
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
 * Seed helpers for the workforce suites, run as the connection OWNER (superuser) so RLS is bypassed
 * — pure setup, exactly as `@waitron/db`'s own `seedTenant` documents. English fixture strings
 * throughout: this file is under `test/`, out of the English-only guard's `src` scan, but the
 * package's vocabulary is English regardless.
 */

/** A location (centro de trabajo) for the tenant. Returns its id. */
export async function seedLocation(db: Database, tenantId: string): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Sale on premises')
    returning id`);
  return result.rows[0]!.id;
}

/** A person for the tenant, PIN '1234'. Returns its id. */
export async function seedPerson(db: Database, tenantId: string, name = "Ana"): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash)
    values (${tenantId}, ${name}, ${hashPin("1234")})
    returning id`);
  return result.rows[0]!.id;
}

/** An employment for the person, defaulting to a 40h (2400-minute) contracted week. Returns its id. */
export async function seedEmployment(
  db: Database | Transaction,
  params: { tenantId: string; personId: string; contractedMinutesPerWeek?: number },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into employments (
      tenant_id, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate
    ) values (
      ${params.tenantId}, ${params.personId},
      ${params.contractedMinutesPerWeek ?? 2400}, 'full_time', '2026-01-01', '15.00'
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A draft roster_versions row for the tenant/location. Defaults to a one-week period. Returns its
 * id. Planning data (mutable) — inserted as `draft` with no `published_at`. */
export async function insertRosterVersion(
  db: Database | Transaction,
  params: {
    tenantId: string;
    locationId: string;
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    insert into roster_versions (tenant_id, location_id, period_start, period_end)
    values (
      ${params.tenantId}, ${params.locationId},
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
    tenantId: string;
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
      tenant_id, person_id, location_id, starts_at, starts_offset_minutes,
      ends_at, ends_offset_minutes, role, roster_version_id
    ) values (
      ${params.tenantId}, ${params.personId}, ${params.locationId},
      ${params.startsAt ?? "2026-01-05T09:00:00Z"}, ${params.startsOffsetMinutes ?? 0},
      ${params.endsAt ?? "2026-01-05T17:00:00Z"}, ${params.endsOffsetMinutes ?? 0},
      ${params.role ?? null}, ${params.rosterVersionId ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** An `absences` row for the tenant/person. Defaults to a 5–8 Jan holiday, status `requested`, no
 * note. `createdAt` defaults to the DB's `now()`; pass it to control ordering (the listPending suites
 * seed OUT-OF-INSERT-ORDER timestamps to prove `order by created_at`). Planning data (mutable).
 * Returns its id. */
export async function insertAbsence(
  db: Database | Transaction,
  params: {
    tenantId: string;
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
    insert into absences (tenant_id, person_id, absence_kind, starts_on, ends_on, status, note, created_at)
    values (
      ${params.tenantId}, ${params.personId}, ${params.kind ?? "holiday"},
      ${params.startsOn ?? "2026-01-05"}, ${params.endsOn ?? "2026-01-08"},
      ${params.status ?? "requested"}, ${params.note ?? null},
      ${params.createdAt === undefined ? sql`default` : params.createdAt}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** An `availability` row for the tenant/person. Defaults to weekday 0, 09:00–17:00, from 1 Jan,
 * open-ended. Planning data (mutable). Returns its id. */
export async function insertAvailability(
  db: Database | Transaction,
  params: {
    tenantId: string;
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
      tenant_id, person_id, weekday, available_from_minute, available_to_minute,
      effective_from, effective_to
    ) values (
      ${params.tenantId}, ${params.personId}, ${params.weekday ?? 0},
      ${params.availableFromMinute ?? 540}, ${params.availableToMinute ?? 1020},
      ${params.effectiveFrom ?? "2026-01-01"}, ${params.effectiveTo ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A `shift_templates` row for the tenant/location. Defaults to "Evening bar", weekday 0,
 * 18:00–24:00, role null. Planning data (mutable). Returns its id. */
export async function insertShiftTemplate(
  db: Database | Transaction,
  params: {
    tenantId: string;
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
      tenant_id, location_id, label, weekday, starts_minute, ends_minute, role
    ) values (
      ${params.tenantId}, ${params.locationId}, ${params.label ?? "Evening bar"},
      ${params.weekday ?? 0}, ${params.startsMinute ?? 1080}, ${params.endsMinute ?? 1440},
      ${params.role ?? null}
    )
    returning id`);
  return result.rows[0]!.id;
}

/** A `shift_swaps` row for the tenant. Status defaults to `requested`, `to_shift_id` null. `createdAt`
 * defaults to the DB's `now()`; pass it to control ordering (the listPending suites seed
 * OUT-OF-INSERT-ORDER timestamps to prove `order by created_at`). Planning data (mutable). Returns its
 * id. */
export async function insertShiftSwap(
  db: Database | Transaction,
  params: {
    tenantId: string;
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
      tenant_id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status, created_at
    ) values (
      ${params.tenantId}, ${params.requestedByPersonId}, ${params.fromShiftId},
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
 * `.transaction()`, so this fixture works whether a suite hands it a pool or a live tenant tx. */
export async function insertTimeEntry(
  tx: Database | Transaction,
  params: {
    tenantId: string;
    personId: string;
    locationId: string;
    entryKind?: WorkforceEntryKind;
    eventAt?: string;
    offsetMinutes?: number;
  },
): Promise<void> {
  await tx.transaction((inner) =>
    appendToChain(inner, params.tenantId, params.locationId, {
      personId: params.personId,
      entryKind: params.entryKind ?? "in",
      eventAt: params.eventAt ?? "2026-01-05T09:00:00Z",
      eventOffsetMinutes: params.offsetMinutes ?? 0,
      recordedByPersonId: params.personId,
    }),
  );
}
