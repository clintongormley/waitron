import { and, asc, eq } from "drizzle-orm";
import { attendanceMailKey, attendanceMailOutcome } from "../src/attendance-mail.js";
import {
  locations,
  venueLocationId,
  outgoingMail,
  enqueueMail,
  MAIL_LIFETIME_MS,
  type OutgoingMailStatus,
} from "@waitron/db";
import { jobOrigin } from "@waitron/shared";
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
import { seedVenue, seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";

/**
 * A `WorkTimeRuleset` at what a default `convenio_config` row resolves to
 * (packages/workforce-es/src/convenio.ts). A suite overrides the one limit it exercises, so the
 * guardrail thresholds are the test's, never the engine's.
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

/** Seeds the venue and returns its id. A second call writes a second location, for the
 * cross-location cases A1301's code slices delete; through the table definition, not raw SQL,
 * because `id` is a `$defaultFn` generator that only the insert builder runs. */
export async function seedLocation(db: Database): Promise<string> {
  const venue = { name: "Main", invoiceLocales: ["en"], operationDescription: "Sale on premises" };
  const [existing] = await db.select({ id: locations.id }).from(locations).limit(1);
  if (existing === undefined) {
    await seedVenue(db, venue);
    return venueLocationId(db);
  }
  const [row] = await db.insert(locations).values({}).returning({ id: locations.id });
  await seedVenueSettings(db, {
    invoiceLocales: venue.invoiceLocales,
    operationDescription: venue.operationDescription,
  });
  await seedBusinessDay(db, {});
  return row!.id;
}

/** A person, PIN '1234'. Through the table definition for the same reason as {@link seedLocation}. */
export async function seedPerson(db: Database, name = "Ana"): Promise<string> {
  const [row] = await db
    .insert(persons)
    .values({ displayName: name, pinHash: hashPin("1234") })
    .returning({ id: persons.id });
  return row!.id;
}

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
      periodStart: params.periodStart ?? "2026-01-05",
      periodEnd: params.periodEnd ?? "2026-01-11",
    })
    .returning({ id: rosterVersions.id });
  return row!.id;
}

/** `createdAt` behaves as on {@link insertAbsence}. */
export async function insertDraftShift(
  db: Database | Transaction,
  params: {
    personId: string;
    locationId: string;
    startsAt?: string;
    startsOffsetMinutes?: number;
    endsAt?: string;
    endsOffsetMinutes?: number;
    rosterVersionId?: string | null;
    createdAt?: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(shifts)
    .values({
      personId: params.personId,
      startsAt: params.startsAt ?? "2026-01-05T09:00:00Z",
      startsOffsetMinutes: params.startsOffsetMinutes ?? 0,
      endsAt: params.endsAt ?? "2026-01-05T17:00:00Z",
      endsOffsetMinutes: params.endsOffsetMinutes ?? 0,
      rosterVersionId: params.rosterVersionId ?? null,
      ...(params.createdAt === undefined ? {} : { createdAt: params.createdAt }),
    })
    .returning({ id: shifts.id });
  return row!.id;
}

/** Omitting `createdAt` leaves it to the column's `$defaultFn` generator, which only the insert
 * builder runs. `kind` and `status` are plain `string` so a suite can seed a value outside the enum.
 */
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

export async function insertShiftTemplate(
  db: Database | Transaction,
  params: {
    locationId: string;
    label?: string;
    weekday?: number;
    startsMinute?: number;
    endsMinute?: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(shiftTemplates)
    .values({
      label: params.label ?? "Evening bar",
      weekday: params.weekday ?? 0,
      startsMinute: params.startsMinute ?? 1080,
      endsMinute: params.endsMinute ?? 1440,
    })
    .returning({ id: shiftTemplates.id });
  return row!.id;
}

/** `createdAt` behaves as on {@link insertAbsence}. */
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

/** Appends through the real chain, so seeded rows are chained exactly as the write path does it.
 * `.transaction()` is a savepoint inside a live tx and a real transaction on a bare connection, so
 * this takes either handle. */
export async function insertTimeEntry(
  tx: Database | Transaction,
  params: {
    nodeId: string;
    personId: string;
    entryKind?: WorkforceEntryKind;
    eventAt?: string;
    offsetMinutes?: number;
  },
): Promise<void> {
  await tx.transaction((inner) =>
    appendToChain(
      inner,
      { nodeId: params.nodeId },
      {
        personId: params.personId,
        entryKind: params.entryKind ?? "in",
        eventAt: params.eventAt ?? "2026-01-05T09:00:00Z",
        eventOffsetMinutes: params.offsetMinutes ?? 0,
        recordedByPersonId: params.personId,
        origin: jobOrigin("dashboard"),
      },
    ),
  );
}

type AttendanceMailFields = Partial<{
  status: OutgoingMailStatus;
  claimToken: string | null;
  claimedAt: string | null;
  nextAttemptAt: string;
  recipient: string | null;
  outcome: "sent" | "rejected" | "unknown" | null;
}>;
export async function attendanceMailRows(db: Database | Transaction) {
  const rows = await db
    .select()
    .from(outgoingMail)
    .where(eq(outgoingMail.kind, "attendance_question"))
    .orderBy(asc(outgoingMail.nextAttemptAt), asc(outgoingMail.id));
  return rows.map((row) => ({
    id: row.id,
    questionId: row.subjectId!,
    status: row.status,
    claimToken: row.claimToken,
    claimedAt: row.claimedAt,
    nextAttemptAt: row.nextAttemptAt,
    recipient: row.recipient,
    outcome: attendanceMailOutcome(row),
  }));
}
export async function setAttendanceMail(
  db: Database | Transaction,
  questionId: string,
  fields: AttendanceMailFields,
): Promise<void> {
  const { outcome, ...values } = fields;
  const finished =
    values.status !== undefined &&
    ["sent", "unknown", "cancelled", "expired"].includes(values.status);
  await db
    .update(outgoingMail)
    .set({
      ...values,
      ...(outcome ? { attempts: 1 } : {}),
      ...(finished
        ? { finishedAt: values.claimedAt ?? values.nextAttemptAt ?? new Date().toISOString() }
        : {}),
    })
    .where(
      and(
        eq(outgoingMail.kind, "attendance_question"),
        eq(outgoingMail.dedupeKey, attendanceMailKey(questionId)),
      ),
    );
}
export async function insertAttendanceMail(
  db: Database | Transaction,
  input: { questionId: string; personId: string } & AttendanceMailFields,
): Promise<void> {
  const at = new Date(input.nextAttemptAt!);
  await enqueueMail(db, {
    kind: "attendance_question",
    dedupeKey: attendanceMailKey(input.questionId),
    subjectId: input.questionId,
    personId: input.personId,
    now: at,
    notAfter: new Date(at.getTime() + MAIL_LIFETIME_MS.attendance_question),
  });
  await setAttendanceMail(db, input.questionId, input);
}
