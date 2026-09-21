import { locations } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { hashPin, persons } from "@waitron/identity";
import { appendToChain } from "../src/chain.js";
import type { WorkforceEntryKind } from "../src/projection.js";
import type { WorkTimeRuleset } from "../src/ruleset.js";
import { absences } from "../src/schema/absences.js";
import type { AbsenceKind, AbsenceStatus } from "../src/schema/absences.js";
import { availability } from "../src/schema/availability.js";
import { employments } from "../src/schema/employments.js";
import { rosterVersions } from "../src/schema/roster-versions.js";
import { shiftSwaps } from "../src/schema/shift-swaps.js";
import type { ShiftSwapStatus } from "../src/schema/shift-swaps.js";
import { shiftTemplates } from "../src/schema/shift-templates.js";
import { shifts } from "../src/schema/shifts.js";

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

/** A person, PIN '1234'. Returns its id.
 *
 * Through the `persons` table definition for the same reason as {@link seedLocation}: `persons.id`
 * and `persons.created_at` are `$defaultFn` generators, which only the insert BUILDER runs. */
export async function seedPerson(db: Database, name = "Ana"): Promise<string> {
  const [row] = await db
    .insert(persons)
    .values({ displayName: name, pinHash: hashPin("1234") })
    .returning({ id: persons.id });
  return row!.id;
}

/** An employment for the person, defaulting to a 40h (2400-minute) contracted week. Returns its id. */
export async function seedEmployment(
  db: Database | Transaction,
  params: { personId: string; contractedMinutesPerWeek?: number },
): Promise<string> {
  const [row] = await db
    .insert(employments)
    .values({
      personId: params.personId,
      contractedMinutesPerWeek: params.contractedMinutesPerWeek ?? 2400,
      contractType: "full_time",
      startDate: "2026-01-01",
      payRate: 1500,
    })
    .returning({ id: employments.id });
  return row!.id;
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
  const [row] = await db
    .insert(rosterVersions)
    .values({
      locationId: params.locationId,
      periodStart: params.periodStart ?? "2026-01-05",
      periodEnd: params.periodEnd ?? "2026-01-11",
    })
    .returning({ id: rosterVersions.id });
  return row!.id;
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
  const [row] = await db
    .insert(shifts)
    .values({
      personId: params.personId,
      locationId: params.locationId,
      startsAt: params.startsAt ?? "2026-01-05T09:00:00Z",
      startsOffsetMinutes: params.startsOffsetMinutes ?? 0,
      endsAt: params.endsAt ?? "2026-01-05T17:00:00Z",
      endsOffsetMinutes: params.endsOffsetMinutes ?? 0,
      role: params.role ?? null,
      rosterVersionId: params.rosterVersionId ?? null,
    })
    .returning({ id: shifts.id });
  return row!.id;
}

/** An `absences` row for the person. Defaults to a 5–8 Jan holiday, status `requested`, no
 * note. Pass `createdAt` to control ordering (the listPending suites seed OUT-OF-INSERT-ORDER
 * timestamps to prove `order by created_at`); OMITTING it leaves the column to
 * `absences.created_at`'s own `$defaultFn(nowIso)` generator
 * (`packages/workforce/src/schema/absences.ts:59`), which is why the insert goes through the table
 * definition — the generated DDL declares the column `text NOT NULL` with no DEFAULT, so neither a
 * raw INSERT omitting it nor the `default` keyword can reach it (node:sqlite refuses that keyword
 * inside a VALUES list: `near "default": syntax error`, measured on Node v26.7.0).
 *
 * `kind` and `status` stay plain `string` rather than the column's union, and the cast below is
 * what keeps them so: `migrations.test.ts`'s `rejects an absence_kind outside the enum` seeds
 * `"sabbatical"` on purpose, and a union-typed parameter would refuse to compile it.
 * Planning data (mutable). Returns its id. */
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
  const [row] = await db
    .insert(absences)
    .values({
      personId: params.personId,
      kind: (params.kind ?? "holiday") as AbsenceKind,
      startsOn: params.startsOn ?? "2026-01-05",
      endsOn: params.endsOn ?? "2026-01-08",
      status: (params.status ?? "requested") as AbsenceStatus,
      note: params.note ?? null,
      ...(params.createdAt === undefined ? {} : { createdAt: params.createdAt }),
    })
    .returning({ id: absences.id });
  return row!.id;
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
  const [row] = await db
    .insert(availability)
    .values({
      personId: params.personId,
      weekday: params.weekday ?? 0,
      availableFromMinute: params.availableFromMinute ?? 540,
      availableToMinute: params.availableToMinute ?? 1020,
      effectiveFrom: params.effectiveFrom ?? "2026-01-01",
      effectiveTo: params.effectiveTo ?? null,
    })
    .returning({ id: availability.id });
  return row!.id;
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
  const [row] = await db
    .insert(shiftTemplates)
    .values({
      locationId: params.locationId,
      label: params.label ?? "Evening bar",
      weekday: params.weekday ?? 0,
      startsMinute: params.startsMinute ?? 1080,
      endsMinute: params.endsMinute ?? 1440,
      role: params.role ?? null,
    })
    .returning({ id: shiftTemplates.id });
  return row!.id;
}

/** A `shift_swaps` row. Status defaults to `requested`, `to_shift_id` null. `createdAt` behaves
 * exactly as on {@link insertAbsence}: `shift_swaps.created_at` is `tsString(...).$defaultFn(nowIso)`
 * (`packages/workforce/src/schema/shift-swaps.ts:49`) with no DEFAULT in the generated DDL, so
 * omitting it here leaves the generator to run. Pass it to control ordering (the listPending suites
 * seed OUT-OF-INSERT-ORDER timestamps to prove `order by created_at`). Planning data (mutable).
 * Returns its id. */
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
  const [row] = await db
    .insert(shiftSwaps)
    .values({
      requestedByPersonId: params.requestedByPersonId,
      fromShiftId: params.fromShiftId,
      toPersonId: params.toPersonId,
      toShiftId: params.toShiftId ?? null,
      status: (params.status ?? "requested") as ShiftSwapStatus,
      ...(params.createdAt === undefined ? {} : { createdAt: params.createdAt }),
    })
    .returning({ id: shiftSwaps.id });
  return row!.id;
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
