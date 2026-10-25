import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { locationId as brandLocationId } from "@waitron/shared";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend } from "./clocking.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WORKFORCE_PERSONAL_DATA } from "./personal-data.js";
import { attendanceResponseCommands } from "./schema/attendance-responses.js";
import {
  attendanceMail,
  attendanceOperationFacts,
  attendanceQuestions,
} from "./schema/attendance.js";
import { absences } from "./schema/absences.js";
import { availability } from "./schema/availability.js";
import { employments } from "./schema/employments.js";
import { rosterVersions } from "./schema/roster-versions.js";
import { shiftSwaps } from "./schema/shift-swaps.js";
import { shifts } from "./schema/shifts.js";
import { timeEntries } from "./schema/time-entries.js";
import {
  insertRosterVersion,
  insertTimeEntry,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

const subject = (personId: string) => ({
  personId,
  language: "en" as const,
  at: new Date("2026-10-24T10:00:00.000Z"),
  timeZone: "UTC",
  locationId: null,
});

async function download(personId: string): Promise<{ name: string; text: string }[]> {
  const build = await withTransaction(suite.db, (tx) =>
    WORKFORCE_PERSONAL_DATA.prepare(tx, subject(personId)),
  );
  const files = await build();
  return files.map((f) => {
    if (typeof f.content !== "string") throw new Error(`${f.name} is not text`);
    return { name: f.name, text: f.content };
  });
}

async function seedManager(db: Database): Promise<{ id: string; email: string }> {
  const email = "luis.manager@example.test";
  const [row] = await db
    .insert(persons)
    .values({ displayName: "Luis Manager", email })
    .returning({ id: persons.id });
  return { id: row!.id, email };
}

/** Marta, a colleague and a manager, each value distinct to its owner. */
async function seedAll(db: Database) {
  const manager = await seedManager(db);
  const marta = await seedPerson(db, "Marta Lopez");
  const colleague = await seedPerson(db, "Colleague Ruiz");

  // Inserted out of list order, and one row in each list recorded after a row that starts later,
  // so dropping either list's start-date sort reorders its expected list.
  await db.insert(employments).values([
    {
      personId: marta,
      contractedMinutesPerWeek: 1200,
      contractType: "part_time",
      startDate: "2025-03-01",
      endDate: null,
      payRate: 1234,
      createdAt: "2025-02-20T09:15:00.000Z",
    },
    {
      personId: marta,
      contractedMinutesPerWeek: 2400,
      contractType: "fixed_term",
      startDate: "2024-01-15",
      endDate: "2025-02-28",
      payRate: 1100,
      createdAt: "2025-04-01T08:00:00.000Z",
    },
    {
      personId: colleague,
      contractedMinutesPerWeek: 1800,
      contractType: "seasonal",
      startDate: "2023-06-01",
      endDate: null,
      payRate: 1999,
      createdAt: "2023-05-25T07:30:00.000Z",
    },
  ]);

  await db.insert(absences).values([
    {
      personId: marta,
      kind: "unpaid",
      startsOn: "2026-08-10",
      endsOn: "2026-08-12",
      status: "requested",
      note: null,
      createdAt: "2026-07-01T10:00:00.000Z",
    },
    {
      personId: marta,
      kind: "sick_leave",
      startsOn: "2026-02-03",
      endsOn: "2026-02-05",
      status: "requested",
      note: "Flu, doctor's note given",
      createdAt: "2026-04-10T07:45:00.000Z",
    },
    {
      personId: marta,
      kind: "holiday",
      startsOn: "2026-05-18",
      endsOn: "2026-05-22",
      status: "approved",
      note: "Family wedding",
      decidedByPersonId: manager.id,
      decidedAt: "2026-04-02T16:20:00.000Z",
      createdAt: "2026-04-01T11:05:00.000Z",
    },
    {
      personId: colleague,
      kind: "leave",
      startsOn: "2025-11-11",
      endsOn: "2025-11-13",
      status: "rejected",
      note: "Colleague moving house",
      decidedByPersonId: manager.id,
      decidedAt: "2025-10-30T12:00:00.000Z",
      createdAt: "2025-10-29T13:40:00.000Z",
    },
  ]);

  return { manager, marta, colleague };
}

/**
 * Marta's three shifts, two availability windows and three swaps, beside a colleague's own.
 * Shift times are stored in the writer's whole-second `Z` spelling (`shiftInterval`, clocking.ts).
 */
async function seedRota(db: Database, people: Awaited<ReturnType<typeof seedAll>>) {
  const { manager, marta, colleague } = people;
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Harbour Terrace",
      invoiceLocales: ["en"],
      operationDescription: "Sale on premises",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const publishedVersion = await insertRosterVersion(db, { locationId });
  await db
    .update(rosterVersions)
    .set({ status: "published", publishedAt: "2026-06-20T10:00:00.000Z" })
    .where(eq(rosterVersions.id, publishedVersion));
  const draftVersion = await insertRosterVersion(db, {
    locationId,
    periodStart: "2026-02-09",
    periodEnd: "2026-02-15",
  });

  const shift = async (
    personId: string,
    values: {
      startsAt: string;
      startsOffsetMinutes: number;
      endsAt: string;
      endsOffsetMinutes: number;
      rosterVersionId: string | null;
      createdAt: string;
    },
  ) => {
    const [row] = await db
      .insert(shifts)
      .values({ personId, locationId, ...values })
      .returning({ id: shifts.id });
    return row!.id;
  };

  // Inserted, and recorded (created_at), in the opposite order to their starts.
  const summer = await shift(marta, {
    startsAt: "2026-07-10T16:00:00Z",
    startsOffsetMinutes: 120,
    endsAt: "2026-07-10T22:00:00Z",
    endsOffsetMinutes: 120,
    rosterVersionId: publishedVersion,
    createdAt: "2025-12-01T08:10:00.000Z",
  });
  const draft = await shift(marta, {
    startsAt: "2026-02-14T03:41:00Z",
    startsOffsetMinutes: 60,
    endsAt: "2026-02-14T11:41:00Z",
    endsOffsetMinutes: 60,
    rosterVersionId: draftVersion,
    createdAt: "2025-12-15T08:20:00.000Z",
  });
  await shift(marta, {
    startsAt: "2026-01-02T00:30:00Z",
    startsOffsetMinutes: -120,
    endsAt: "2026-01-02T08:30:00Z",
    endsOffsetMinutes: -120,
    rosterVersionId: null,
    createdAt: "2026-01-01T08:40:00.000Z",
  });

  const colleagueEarly = await shift(colleague, {
    startsAt: "2026-03-05T02:17:00Z",
    startsOffsetMinutes: 60,
    endsAt: "2026-03-05T09:17:00Z",
    endsOffsetMinutes: 60,
    rosterVersionId: null,
    createdAt: "2026-02-20T06:59:00.000Z",
  });
  const colleagueLate = await shift(colleague, {
    startsAt: "2026-04-11T21:53:00Z",
    startsOffsetMinutes: 120,
    endsAt: "2026-04-12T05:53:00Z",
    endsOffsetMinutes: 120,
    rosterVersionId: null,
    createdAt: "2026-03-21T06:58:00.000Z",
  });
  const colleagueGiveAway = await shift(colleague, {
    startsAt: "2026-05-16T15:23:00Z",
    startsOffsetMinutes: 120,
    endsAt: "2026-05-16T23:23:00Z",
    endsOffsetMinutes: 120,
    rosterVersionId: publishedVersion,
    createdAt: "2026-04-22T06:57:00.000Z",
  });

  // Recorded, and starting in the day, in the opposite order to their weekdays.
  await db.insert(availability).values([
    {
      personId: marta,
      weekday: 5,
      availableFromMinute: 555,
      availableToMinute: 1440,
      effectiveFrom: "2025-11-01",
      effectiveTo: null,
      createdAt: "2025-10-20T09:05:00.000Z",
    },
    {
      personId: marta,
      weekday: 2,
      availableFromMinute: 1050,
      availableToMinute: 1305,
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-06-30",
      createdAt: "2026-01-25T09:35:00.000Z",
    },
    {
      personId: colleague,
      weekday: 3,
      availableFromMinute: 370,
      availableToMinute: 710,
      effectiveFrom: "2026-03-03",
      effectiveTo: "2026-09-09",
      createdAt: "2026-02-27T06:56:00.000Z",
    },
  ]);

  // Explicit ids in the reverse of their recorded order, so the id tie-break cannot stand in for
  // the created_at sort.
  const swap = async (values: typeof shiftSwaps.$inferInsert) => {
    await db.insert(shiftSwaps).values(values);
  };
  await swap({
    id: "00000000-0000-4000-8000-0000000005a1",
    requestedByPersonId: colleague,
    fromShiftId: colleagueGiveAway,
    toPersonId: marta,
    status: "approved",
    decidedByPersonId: manager.id,
    decidedAt: "2026-05-02T14:00:00.000Z",
    createdAt: "2026-05-01T09:00:00.000Z",
  });
  await swap({
    id: "00000000-0000-4000-8000-0000000005a3",
    requestedByPersonId: marta,
    fromShiftId: draft,
    toPersonId: colleague,
    toShiftId: colleagueLate,
    status: "accepted",
    createdAt: "2026-02-01T10:00:00.000Z",
  });
  await swap({
    id: "00000000-0000-4000-8000-0000000005a2",
    requestedByPersonId: colleague,
    fromShiftId: colleagueEarly,
    toPersonId: marta,
    toShiftId: summer,
    status: "requested",
    createdAt: "2026-03-01T08:00:00.000Z",
  });

  return { draft };
}

const MARTA_ROTA = {
  shifts: [
    {
      location: "Harbour Terrace",
      startsAt: "2026-01-01T22:30:00-02:00",
      endsAt: "2026-01-02T06:30:00-02:00",
      rota: null,
      createdAt: "2026-01-01T08:40:00.000Z",
    },
    {
      location: "Harbour Terrace",
      startsAt: "2026-02-14T04:41:00+01:00",
      endsAt: "2026-02-14T12:41:00+01:00",
      rota: "draft",
      createdAt: "2025-12-15T08:20:00.000Z",
    },
    {
      location: "Harbour Terrace",
      startsAt: "2026-07-10T18:00:00+02:00",
      endsAt: "2026-07-11T00:00:00+02:00",
      rota: "published",
      createdAt: "2025-12-01T08:10:00.000Z",
    },
  ],
  availability: [
    {
      weekday: 2,
      from: "17:30",
      to: "21:45",
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-06-30",
      createdAt: "2026-01-25T09:35:00.000Z",
    },
    {
      weekday: 5,
      from: "09:15",
      to: "24:00",
      effectiveFrom: "2025-11-01",
      effectiveTo: null,
      createdAt: "2025-10-20T09:05:00.000Z",
    },
  ],
  swaps: [
    {
      direction: "requested_by_me",
      otherPerson: "Colleague Ruiz",
      status: "accepted",
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-02-01T10:00:00.000Z",
    },
    {
      direction: "offered_to_me",
      otherPerson: "Colleague Ruiz",
      status: "requested",
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-03-01T08:00:00.000Z",
    },
    {
      direction: "offered_to_me",
      otherPerson: "Colleague Ruiz",
      status: "approved",
      decidedBy: "Luis Manager",
      decidedAt: "2026-05-02T14:00:00.000Z",
      createdAt: "2026-05-01T09:00:00.000Z",
    },
  ],
};

/** The colleague's shift and availability values as their own rota writes them. */
const COLLEAGUE_ROTA_VALUES = [
  "2026-03-05T03:17",
  "2026-03-05T10:17",
  "2026-04-11T23:53",
  "2026-04-12T07:53",
  "2026-05-16T17:23",
  "2026-05-17T01:23",
  "2026-02-20T06:59",
  "2026-03-21T06:58",
  "2026-04-22T06:57",
  "06:10",
  "11:50",
  "2026-03-03",
  "2026-09-09",
  "2026-02-27T06:56",
];

/** The same shifts' stored UTC times, which no rota writes. */
const COLLEAGUE_SHIFT_UTC = ["02:17", "09:17", "21:53", "05:53", "15:23", "23:23"];

/** Marta's draft shift, moved to a fourth person in one case, in every form a leak could take. */
const DRAFT_SHIFT_VALUES = ["2026-02-14", "04:41", "03:41", "12:41", "11:41", "2025-12-15T08:20"];

/** The exact text the part writes for a value, so key order is pinned as well as content. */
const asFile = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const rotaOf = (files: { name: string; text: string }[]) => {
  const rota = files.find((f) => f.name === "rota.json");
  if (rota === undefined) throw new Error("no rota.json");
  return rota.text;
};

const COLLEAGUE_VALUES = [
  "seasonal",
  "2023-06-01",
  "19.99",
  "2023-05-25T07:30:00.000Z",
  "Colleague moving house",
  "2025-11-11",
  "2025-11-13",
  "rejected",
  "2025-10-30T12:00:00.000Z",
  "2025-10-29T13:40:00.000Z",
];

/**
 * Marta's three attendance questions (two with their reminder email), two answers and two activity
 * facts, beside a colleague's one of each. Times are in the writers' spelling: `toISOString()`,
 * whole seconds for an activity's and a change's `at`. Each list's rows carry ids (or, for the
 * facts, sequence numbers) in the reverse of its sort order, and its created_at order differs
 * from its first sort key's, so neither tie-break can stand in for the sort.
 */
async function seedAttendance(db: Database, people: Awaited<ReturnType<typeof seedAll>>) {
  const { manager, marta, colleague } = people;
  await seedTenant(db);
  const locationId = await seedLocation(db);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  await insertTimeEntry(db, {
    nodeId,
    personId: marta,
    locationId,
    entryKind: "in",
    eventAt: "2026-03-07T08:00:00Z",
  });
  await insertTimeEntry(db, {
    nodeId,
    personId: marta,
    locationId,
    entryKind: "out",
    eventAt: "2026-03-08T04:00:00Z",
  });
  const entries = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(eq(timeEntries.personId, marta))
    .orderBy(asc(timeEntries.eventAt));
  const [openEntry, automaticEntry] = entries.map((e) => e.id) as [string, string];

  const missingTimes = "00000000-0000-4000-8000-0000000000a1";
  await db.insert(attendanceQuestions).values({
    id: missingTimes,
    personId: marta,
    locationId,
    businessDay: "2026-04-18",
    startAt: "2026-04-18T04:00:00.000Z",
    endAt: "2026-04-19T04:00:00.000Z",
    shiftKey: "shift:marta-0418",
    kind: "missing-times",
    missingKinds: ["in", "out"],
    evidenceKeys: ["order:evidence-marta-1"],
    createdAt: "2026-04-19T04:00:00.000Z",
  });
  // A second shift on the same day, asked later, with an id that sorts before the first's, so
  // only the created_at sort puts it second. Its reminder is as the writer inserts it.
  const sameDayLater = "00000000-0000-4000-8000-0000000000a0";
  await db.insert(attendanceQuestions).values({
    id: sameDayLater,
    personId: marta,
    locationId,
    businessDay: "2026-04-18",
    startAt: "2026-04-18T04:00:00.000Z",
    endAt: "2026-04-19T04:00:00.000Z",
    shiftKey: "shift:marta-0418-late",
    kind: "missing-times",
    missingKinds: ["out"],
    evidenceKeys: ["order:evidence-marta-3"],
    createdAt: "2026-04-19T09:45:00.000Z",
  });
  await db.insert(attendanceMail).values({
    questionId: sameDayLater,
    nextAttemptAt: "2026-04-19T09:45:00.000Z",
  });
  // Re-asked late, so recorded after a question about a later day.
  await db.insert(attendanceQuestions).values({
    id: "00000000-0000-4000-8000-0000000000a2",
    personId: marta,
    locationId,
    businessDay: "2026-03-07",
    startAt: "2026-03-07T05:00:00.000Z",
    endAt: "2026-03-08T05:00:00.000Z",
    shiftKey: "shift:marta-0307",
    kind: "automatic-out",
    missingKinds: [],
    openEntryId: openEntry,
    automaticEntryId: automaticEntry,
    evidenceKeys: ["clock:evidence-marta-2"],
    createdAt: "2026-05-01T06:12:00.000Z",
    active: false,
    inactiveReason: "rota_superseded",
  });
  await db.insert(attendanceMail).values({
    questionId: missingTimes,
    status: "sent",
    claimToken: MARTA_CLAIM_TOKEN,
    claimedAt: "2026-04-19T04:01:00.000Z",
    nextAttemptAt: "2026-04-19T04:00:00.000Z",
    recipient: "marta.reminders@example.test",
    outcome: "sent",
  });

  // The manager's proposal is inserted first and carries the lower id, but was recorded later.
  await db.insert(attendanceResponseCommands).values({
    id: "00000000-0000-4000-8000-0000000000b1",
    requestedByPersonId: manager.id,
    authorizedByPersonId: manager.id,
    personId: marta,
    locationId,
    questionId: null,
    action: "propose",
    input: {
      action: "propose",
      personId: marta,
      locationId,
      changes: [
        { target: { entryId: openEntry }, at: "2026-04-18T23:25:00.000Z", offsetMinutes: 120 },
        { target: { missingKind: "out" }, at: "2026-04-19T00:10:00.000Z", offsetMinutes: 120 },
      ],
      reason: "Till log shows a later finish",
    },
    entryIds: [automaticEntry],
    createdAt: "2026-04-20T10:05:00.000Z",
  });
  await db.insert(attendanceResponseCommands).values({
    id: "00000000-0000-4000-8000-0000000000b2",
    requestedByPersonId: marta,
    authorizedByPersonId: marta,
    personId: marta,
    locationId,
    questionId: missingTimes,
    action: "request",
    input: {
      action: "request",
      questionId: missingTimes,
      locationId,
      changes: [
        { target: { missingKind: "in" }, at: "2026-04-18T15:58:00.000Z", offsetMinutes: 120 },
      ],
      reason: "Forgot to clock in after the delivery",
    },
    entryIds: [openEntry],
    createdAt: "2026-04-19T08:30:00.000Z",
  });

  // Inserted, so numbered, in the reverse of their times.
  await db.insert(attendanceOperationFacts).values({
    source: "whole-payment",
    key: "payment:marta-1",
    personId: marta,
    locationId,
    kind: "payment",
    at: "2026-04-18T22:58:00.000Z",
    offsetMinutes: 120,
    businessDay: "2026-04-18",
    outcome: "qualifying",
  });
  await db.insert(attendanceOperationFacts).values({
    source: "clock",
    key: "clock:marta-2",
    personId: marta,
    locationId,
    kind: "break",
    at: "2026-03-07T21:30:00.000Z",
    offsetMinutes: 60,
    businessDay: "2026-03-07",
    outcome: "pending",
  });

  const colleagueQuestion = "00000000-0000-4000-8000-0000000000c1";
  await db.insert(attendanceQuestions).values({
    id: colleagueQuestion,
    personId: colleague,
    locationId,
    businessDay: "2026-04-25",
    startAt: "2026-04-25T04:00:00.000Z",
    endAt: "2026-04-26T04:00:00.000Z",
    shiftKey: "shift:colleague-0425",
    kind: "missing-times",
    missingKinds: ["out"],
    evidenceKeys: ["order:evidence-colleague"],
    createdAt: "2026-04-26T04:02:00.000Z",
  });
  await db.insert(attendanceMail).values({
    questionId: colleagueQuestion,
    status: "rejected",
    claimToken: "holder-9:colleague-claim-token",
    claimedAt: "2026-04-26T04:03:00.000Z",
    nextAttemptAt: "2026-04-26T04:18:00.000Z",
    recipient: "ruiz.mail@example.test",
    outcome: "rejected",
  });
  await db.insert(attendanceResponseCommands).values({
    id: "00000000-0000-4000-8000-0000000000c2",
    requestedByPersonId: colleague,
    authorizedByPersonId: colleague,
    personId: colleague,
    locationId,
    questionId: null,
    action: "disagree",
    input: {
      action: "disagree",
      itemId: "00000000-0000-4000-8000-0000000000c9",
      reason: "Colleague was on a delivery run",
    },
    entryIds: [automaticEntry],
    createdAt: "2026-04-27T09:11:00.000Z",
  });
  await db.insert(attendanceOperationFacts).values({
    source: "order",
    key: "order:colleague-1",
    personId: colleague,
    locationId,
    kind: "order",
    at: "2026-04-25T20:47:00.000Z",
    offsetMinutes: 180,
    businessDay: "2026-04-25",
    outcome: "refused",
  });

  return { locationId, nodeId };
}

const MARTA_CLAIM_TOKEN = "holder-7:3f9c2b1e-claim-token";

const MARTA_ATTENDANCE = {
  questions: [
    {
      businessDay: "2026-03-07",
      kind: "automatic-out",
      missingKinds: [],
      startAt: "2026-03-07T05:00:00.000Z",
      endAt: "2026-03-08T05:00:00.000Z",
      createdAt: "2026-05-01T06:12:00.000Z",
      active: false,
      inactiveReason: "rota_superseded",
      reminderEmail: null,
    },
    {
      businessDay: "2026-04-18",
      kind: "missing-times",
      missingKinds: ["in", "out"],
      startAt: "2026-04-18T04:00:00.000Z",
      endAt: "2026-04-19T04:00:00.000Z",
      createdAt: "2026-04-19T04:00:00.000Z",
      active: true,
      inactiveReason: null,
      reminderEmail: {
        recipient: "marta.reminders@example.test",
        status: "sent",
        outcome: "sent",
        claimedAt: "2026-04-19T04:01:00.000Z",
        nextAttemptAt: "2026-04-19T04:00:00.000Z",
      },
    },
    {
      businessDay: "2026-04-18",
      kind: "missing-times",
      missingKinds: ["out"],
      startAt: "2026-04-18T04:00:00.000Z",
      endAt: "2026-04-19T04:00:00.000Z",
      createdAt: "2026-04-19T09:45:00.000Z",
      active: true,
      inactiveReason: null,
      reminderEmail: {
        recipient: null,
        status: "pending",
        outcome: null,
        claimedAt: null,
        nextAttemptAt: "2026-04-19T09:45:00.000Z",
      },
    },
  ],
  responses: [
    {
      action: "request",
      byYou: true,
      authorizedBy: "Marta Lopez",
      reason: "Forgot to clock in after the delivery",
      changes: [{ at: "2026-04-18T17:58:00+02:00", missingKind: "in" }],
      createdAt: "2026-04-19T08:30:00.000Z",
    },
    {
      action: "propose",
      byYou: false,
      authorizedBy: "Luis Manager",
      reason: "Till log shows a later finish",
      changes: [
        { at: "2026-04-19T01:25:00+02:00", missingKind: null },
        { at: "2026-04-19T02:10:00+02:00", missingKind: "out" },
      ],
      createdAt: "2026-04-20T10:05:00.000Z",
    },
  ],
  activity: [
    {
      source: "clock",
      kind: "break",
      at: "2026-03-07T22:30:00+01:00",
      businessDay: "2026-03-07",
      outcome: "pending",
    },
    {
      source: "whole-payment",
      kind: "payment",
      at: "2026-04-19T00:58:00+02:00",
      businessDay: "2026-04-18",
      outcome: "qualifying",
    },
  ],
};

/** The colleague's attendance values as their own file writes them. */
const COLLEAGUE_ATTENDANCE_VALUES = [
  "2026-04-25",
  "2026-04-26T04:02:00.000Z",
  "ruiz.mail@example.test",
  "rejected",
  "2026-04-26T04:03:00.000Z",
  "2026-04-26T04:18:00.000Z",
  "disagree",
  "Colleague was on a delivery run",
  "2026-04-27T09:11:00.000Z",
  "2026-04-25T23:47:00+03:00",
  "refused",
];

const attendanceOf = (files: { name: string; text: string }[]) => {
  const file = files.find((f) => f.name === "attendance.json");
  if (file === undefined) throw new Error("no attendance.json");
  return file.text;
};

describe("WORKFORCE_PERSONAL_DATA", () => {
  it("declares its four files", () => {
    expect(WORKFORCE_PERSONAL_DATA.files).toEqual([
      "employment.json",
      "rota.json",
      "absences.json",
      "attendance.json",
    ]);
  });

  it("builds exactly her employment and absences files", async () => {
    const { marta } = await seedAll(suite.db);
    const files = await download(marta);
    expect(files.map((f) => f.name)).toEqual(["employment.json", "absences.json"]);
    expect(files[0]!.text).toBe(
      asFile({
        employments: [
          {
            contractType: "fixed_term",
            contractedMinutesPerWeek: 2400,
            startDate: "2024-01-15",
            endDate: "2025-02-28",
            payRate: "11.00",
            createdAt: "2025-04-01T08:00:00.000Z",
          },
          {
            contractType: "part_time",
            contractedMinutesPerWeek: 1200,
            startDate: "2025-03-01",
            endDate: null,
            payRate: "12.34",
            createdAt: "2025-02-20T09:15:00.000Z",
          },
        ],
      }),
    );
    expect(files[1]!.text).toBe(
      asFile({
        absences: [
          {
            kind: "sick_leave",
            startsOn: "2026-02-03",
            endsOn: "2026-02-05",
            status: "requested",
            note: "Flu, doctor's note given",
            decidedBy: null,
            decidedAt: null,
            createdAt: "2026-04-10T07:45:00.000Z",
          },
          {
            kind: "holiday",
            startsOn: "2026-05-18",
            endsOn: "2026-05-22",
            status: "approved",
            note: "Family wedding",
            decidedBy: "Luis Manager",
            decidedAt: "2026-04-02T16:20:00.000Z",
            createdAt: "2026-04-01T11:05:00.000Z",
          },
          {
            kind: "unpaid",
            startsOn: "2026-08-10",
            endsOn: "2026-08-12",
            status: "requested",
            note: null,
            decidedBy: null,
            decidedAt: null,
            createdAt: "2026-07-01T10:00:00.000Z",
          },
        ],
      }),
    );
  });

  it("holds none of a colleague's values", async () => {
    const { marta, colleague } = await seedAll(suite.db);
    const text = (await download(marta)).map((f) => f.text).join("\n");
    for (const value of COLLEAGUE_VALUES) expect(text).not.toContain(value);
    // Positive control: the colleague's own download carries every one of them.
    const theirs = (await download(colleague)).map((f) => f.text).join("\n");
    for (const value of COLLEAGUE_VALUES) expect(theirs).toContain(value);
  });

  it("names the decider by display name only", async () => {
    const { marta, manager } = await seedAll(suite.db);
    const files = await download(marta);
    const all = files.map((f) => f.text).join("\n");
    expect(all).not.toContain(manager.id);
    expect(all).not.toContain(manager.email);
    expect(files.find((f) => f.name === "employment.json")!.text).not.toContain("Luis Manager");
    const absencesText = files.find((f) => f.name === "absences.json")!.text;
    expect(absencesText.split("Luis Manager").length - 1).toBe(1);
    expect(absencesText).toContain('"decidedBy": "Luis Manager"');
  });

  it("builds no file for a person with no employment and no absence", async () => {
    await seedAll(suite.db);
    const nobody = await seedPerson(suite.db, "New Starter");
    expect(await download(nobody)).toEqual([]);
  });

  it("builds only absences.json for a person with an absence and no employment", async () => {
    await seedAll(suite.db);
    const person = await seedPerson(suite.db, "Absent Only");
    await suite.db.insert(absences).values({
      personId: person,
      kind: "holiday",
      startsOn: "2026-09-01",
      endsOn: "2026-09-02",
      createdAt: "2026-08-01T09:00:00.000Z",
    });
    const files = await download(person);
    expect(files.map((f) => f.name)).toEqual(["absences.json"]);
  });

  it("builds exactly her rota file, times local from each stored offset", async () => {
    const people = await seedAll(suite.db);
    await seedRota(suite.db, people);
    const files = await download(people.marta);
    expect(files.map((f) => f.name)).toEqual(["employment.json", "rota.json", "absences.json"]);
    const text = rotaOf(files);
    expect(text).toBe(asFile(MARTA_ROTA));
  });

  it("holds none of the colleague's rota and names others only where decided", async () => {
    const people = await seedAll(suite.db);
    await seedRota(suite.db, people);
    const text = rotaOf(await download(people.marta));
    for (const value of [...COLLEAGUE_ROTA_VALUES, ...COLLEAGUE_SHIFT_UTC]) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toContain(people.colleague);
    expect(text).not.toContain(people.manager.id);
    expect(text.split("Colleague Ruiz").length - 1).toBe(3);
    expect(text.split('"otherPerson": "Colleague Ruiz"').length - 1).toBe(3);
    expect(text.split("Luis Manager").length - 1).toBe(1);
    expect(text).toContain('"decidedBy": "Luis Manager"');
    // Positive control: the colleague's own rota carries every one of them.
    const theirs = rotaOf(await download(people.colleague));
    for (const value of COLLEAGUE_ROTA_VALUES) expect(theirs).toContain(value);
  });

  it("keeps a shift moved to someone else after her swap out of her rota", async () => {
    const people = await seedAll(suite.db);
    const { draft } = await seedRota(suite.db, people);
    const fourth = await seedPerson(suite.db, "Fourth Waiter");
    await withTransaction(suite.db, (tx) =>
      new WorkforceBackend().updateShift(tx, { shiftId: draft, personId: fourth }),
    );
    const rota = JSON.parse(rotaOf(await download(people.marta)));
    const text = JSON.stringify(rota);
    for (const value of DRAFT_SHIFT_VALUES) expect(text).not.toContain(value);
    expect(rota.shifts).toEqual([MARTA_ROTA.shifts[0], MARTA_ROTA.shifts[2]]);
    expect(rota.swaps).toEqual(MARTA_ROTA.swaps);
    // Positive control: the fourth person's rota now holds the moved shift.
    const theirs = rotaOf(await download(fourth));
    expect(theirs).toContain("2026-02-14T04:41:00+01:00");
  });

  it("builds rota.json for availability alone, with the other two lists empty", async () => {
    const person = await seedPerson(suite.db, "Available Only");
    await suite.db.insert(availability).values({
      personId: person,
      weekday: 0,
      availableFromMinute: 0,
      availableToMinute: 600,
      effectiveFrom: "2026-09-01",
      createdAt: "2026-08-20T09:00:00.000Z",
    });
    const files = await download(person);
    expect(files.map((f) => f.name)).toEqual(["rota.json"]);
    expect(JSON.parse(files[0]!.text)).toEqual({
      shifts: [],
      availability: [
        {
          weekday: 0,
          from: "00:00",
          to: "10:00",
          effectiveFrom: "2026-09-01",
          effectiveTo: null,
          createdAt: "2026-08-20T09:00:00.000Z",
        },
      ],
      swaps: [],
    });
  });

  it("builds no rota.json for a person with no shift, availability or swap", async () => {
    const people = await seedAll(suite.db);
    await seedRota(suite.db, people);
    const nobody = await seedPerson(suite.db, "No Rota");
    await suite.db.insert(employments).values({
      personId: nobody,
      contractedMinutesPerWeek: 600,
      contractType: "part_time",
      startDate: "2026-09-01",
      payRate: 1000,
    });
    const files = await download(nobody);
    expect(files.map((f) => f.name)).toEqual(["employment.json"]);
  });
  it("builds exactly her attendance file, times local from each stored offset", async () => {
    const people = await seedAll(suite.db);
    await seedAttendance(suite.db, people);
    const files = await download(people.marta);
    expect(files.map((f) => f.name)).toEqual([
      "employment.json",
      "absences.json",
      "attendance.json",
    ]);
    const text = attendanceOf(files);
    expect(text).toBe(asFile(MARTA_ATTENDANCE));
  });

  it("holds none of the colleague's attendance and no manager's id or email", async () => {
    const people = await seedAll(suite.db);
    await seedAttendance(suite.db, people);
    const all = (await download(people.marta)).map((f) => f.text).join("\n");
    for (const value of COLLEAGUE_ATTENDANCE_VALUES) expect(all).not.toContain(value);
    expect(all).not.toContain(people.colleague);
    expect(all).not.toContain(people.manager.id);
    expect(all).not.toContain(people.manager.email);
    // Positive control: the colleague's own file carries every one of them.
    const theirs = attendanceOf(await download(people.colleague));
    for (const value of COLLEAGUE_ATTENDANCE_VALUES) expect(theirs).toContain(value);
  });

  it("writes the reminder email's recipient but never its claim token", async () => {
    const people = await seedAll(suite.db);
    await seedAttendance(suite.db, people);
    const all = (await download(people.marta)).map((f) => f.text).join("\n");
    expect(all).not.toContain(MARTA_CLAIM_TOKEN);
    expect(all).not.toContain("claim-token");
    expect(all).toContain("marta.reminders@example.test");
  });

  it("builds no attendance.json for a person with no attendance record", async () => {
    const people = await seedAll(suite.db);
    await seedAttendance(suite.db, people);
    const nobody = await seedPerson(suite.db, "No Attendance");
    expect(await download(nobody)).toEqual([]);
  });

  it("writes a null reason and no changes for an answer that has neither", async () => {
    const people = await seedAll(suite.db);
    const { locationId, nodeId } = await seedAttendance(suite.db, people);
    const person = await seedPerson(suite.db, "Confirms Only");
    await insertTimeEntry(suite.db, {
      nodeId,
      personId: person,
      locationId,
      entryKind: "in",
      eventAt: "2026-06-02T08:00:00Z",
    });
    await insertTimeEntry(suite.db, {
      nodeId,
      personId: person,
      locationId,
      entryKind: "out",
      eventAt: "2026-06-03T04:00:00Z",
    });
    const entries = await suite.db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(eq(timeEntries.personId, person))
      .orderBy(asc(timeEntries.eventAt));
    const [openEntry, automaticEntry] = entries.map((e) => e.id) as [string, string];
    // Only an automatic clock-out can be confirmed, and such a question gets no reminder.
    const questionId = "00000000-0000-4000-8000-0000000000d1";
    await suite.db.insert(attendanceQuestions).values({
      id: questionId,
      personId: person,
      locationId,
      businessDay: "2026-06-02",
      startAt: "2026-06-02T04:00:00.000Z",
      endAt: "2026-06-03T04:00:00.000Z",
      shiftKey: "shift:confirms-0602",
      kind: "automatic-out",
      missingKinds: [],
      openEntryId: openEntry,
      automaticEntryId: automaticEntry,
      evidenceKeys: [],
      createdAt: "2026-06-03T04:00:00.000Z",
    });
    await suite.db.insert(attendanceResponseCommands).values({
      id: "00000000-0000-4000-8000-0000000000d2",
      requestedByPersonId: person,
      authorizedByPersonId: person,
      personId: person,
      locationId,
      questionId,
      action: "confirm",
      input: { action: "confirm", questionId },
      entryIds: [automaticEntry],
      createdAt: "2026-06-03T07:00:00.000Z",
    });
    const files = await download(person);
    expect(files.map((f) => f.name)).toEqual(["attendance.json"]);
    expect(files[0]!.text).toBe(
      asFile({
        questions: [
          {
            businessDay: "2026-06-02",
            kind: "automatic-out",
            missingKinds: [],
            startAt: "2026-06-02T04:00:00.000Z",
            endAt: "2026-06-03T04:00:00.000Z",
            createdAt: "2026-06-03T04:00:00.000Z",
            active: true,
            inactiveReason: null,
            reminderEmail: null,
          },
        ],
        responses: [
          {
            action: "confirm",
            byYou: true,
            authorizedBy: "Confirms Only",
            reason: null,
            changes: [],
            createdAt: "2026-06-03T07:00:00.000Z",
          },
        ],
        activity: [],
      }),
    );
  });
});
