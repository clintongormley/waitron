import { locations } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import type { ModulePersonalData, PersonalDataFile } from "@waitron/module";
import { centsToDecimal } from "@waitron/shared";
import { asc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { localWallClock } from "./projection.js";
import { absences } from "./schema/absences.js";
import { attendanceResponseCommands } from "./schema/attendance-responses.js";
import {
  attendanceMail,
  attendanceOperationFacts,
  attendanceQuestions,
} from "./schema/attendance.js";
import { availability } from "./schema/availability.js";
import { employments } from "./schema/employments.js";
import { rosterVersions } from "./schema/roster-versions.js";
import { shiftSwaps } from "./schema/shift-swaps.js";
import { shifts } from "./schema/shifts.js";

const jsonFile = (name: string, value: unknown): PersonalDataFile => ({
  name,
  content: `${JSON.stringify(value, null, 2)}\n`,
});

/** Minutes past local midnight as `HH:MM`; 1440 reads `24:00`. */
const clockOfMinute = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const requester = alias(persons, "requester");
const offeredTo = alias(persons, "offered_to");
const decider = alias(persons, "decider");
const authorizer = alias(persons, "authorizer");

/** A file is built only when the person has a row for it. */
export const WORKFORCE_PERSONAL_DATA: ModulePersonalData = {
  files: ["employment.json", "rota.json", "absences.json", "attendance.json"],

  async prepare(tx: Transaction, { personId }) {
    const employmentRows = await tx
      .select({
        contractType: employments.contractType,
        contractedMinutesPerWeek: employments.contractedMinutesPerWeek,
        startDate: employments.startDate,
        endDate: employments.endDate,
        payRate: employments.payRate,
        createdAt: employments.createdAt,
      })
      .from(employments)
      .where(eq(employments.personId, personId))
      .orderBy(asc(employments.startDate), asc(employments.createdAt), asc(employments.id));

    const absenceRows = await tx
      .select({
        kind: absences.kind,
        startsOn: absences.startsOn,
        endsOn: absences.endsOn,
        status: absences.status,
        note: absences.note,
        decidedBy: persons.displayName,
        decidedAt: absences.decidedAt,
        createdAt: absences.createdAt,
      })
      .from(absences)
      .leftJoin(persons, eq(persons.id, absences.decidedByPersonId))
      .where(eq(absences.personId, personId))
      .orderBy(asc(absences.startsOn), asc(absences.createdAt), asc(absences.id));

    const shiftRows = await tx
      .select({
        location: locations.name,
        startsAt: shifts.startsAt,
        startsOffsetMinutes: shifts.startsOffsetMinutes,
        endsAt: shifts.endsAt,
        endsOffsetMinutes: shifts.endsOffsetMinutes,
        rota: rosterVersions.status,
        createdAt: shifts.createdAt,
      })
      .from(shifts)
      .innerJoin(locations, eq(locations.id, shifts.locationId))
      .leftJoin(rosterVersions, eq(rosterVersions.id, shifts.rosterVersionId))
      .where(eq(shifts.personId, personId))
      .orderBy(asc(shifts.startsAt), asc(shifts.createdAt), asc(shifts.id));

    const availabilityRows = await tx
      .select({
        weekday: availability.weekday,
        from: availability.availableFromMinute,
        to: availability.availableToMinute,
        effectiveFrom: availability.effectiveFrom,
        effectiveTo: availability.effectiveTo,
        createdAt: availability.createdAt,
      })
      .from(availability)
      .where(eq(availability.personId, personId))
      .orderBy(
        asc(availability.weekday),
        asc(availability.availableFromMinute),
        asc(availability.effectiveFrom),
        asc(availability.id),
      );

    const swapRows = await tx
      .select({
        requestedByPersonId: shiftSwaps.requestedByPersonId,
        requester: requester.displayName,
        offeredTo: offeredTo.displayName,
        status: shiftSwaps.status,
        decidedBy: decider.displayName,
        decidedAt: shiftSwaps.decidedAt,
        createdAt: shiftSwaps.createdAt,
      })
      .from(shiftSwaps)
      .innerJoin(requester, eq(requester.id, shiftSwaps.requestedByPersonId))
      .innerJoin(offeredTo, eq(offeredTo.id, shiftSwaps.toPersonId))
      .leftJoin(decider, eq(decider.id, shiftSwaps.decidedByPersonId))
      .where(or(eq(shiftSwaps.requestedByPersonId, personId), eq(shiftSwaps.toPersonId, personId)))
      .orderBy(asc(shiftSwaps.createdAt), asc(shiftSwaps.id));

    const hasRota = shiftRows.length + availabilityRows.length + swapRows.length > 0;

    const questionRows = await tx
      .select({
        businessDay: attendanceQuestions.businessDay,
        kind: attendanceQuestions.kind,
        missingKinds: attendanceQuestions.missingKinds,
        startAt: attendanceQuestions.startAt,
        endAt: attendanceQuestions.endAt,
        createdAt: attendanceQuestions.createdAt,
        active: attendanceQuestions.active,
        inactiveReason: attendanceQuestions.inactiveReason,
        mailId: attendanceMail.id,
        recipient: attendanceMail.recipient,
        status: attendanceMail.status,
        outcome: attendanceMail.outcome,
        claimedAt: attendanceMail.claimedAt,
        nextAttemptAt: attendanceMail.nextAttemptAt,
      })
      .from(attendanceQuestions)
      .leftJoin(attendanceMail, eq(attendanceMail.questionId, attendanceQuestions.id))
      .where(eq(attendanceQuestions.personId, personId))
      .orderBy(
        asc(attendanceQuestions.businessDay),
        asc(attendanceQuestions.createdAt),
        asc(attendanceQuestions.id),
      );

    const responseRows = await tx
      .select({
        action: attendanceResponseCommands.action,
        requestedByPersonId: attendanceResponseCommands.requestedByPersonId,
        authorizedBy: authorizer.displayName,
        input: attendanceResponseCommands.input,
        createdAt: attendanceResponseCommands.createdAt,
      })
      .from(attendanceResponseCommands)
      .innerJoin(authorizer, eq(authorizer.id, attendanceResponseCommands.authorizedByPersonId))
      .where(eq(attendanceResponseCommands.personId, personId))
      .orderBy(asc(attendanceResponseCommands.createdAt), asc(attendanceResponseCommands.id));

    const activityRows = await tx
      .select({
        source: attendanceOperationFacts.source,
        kind: attendanceOperationFacts.kind,
        at: attendanceOperationFacts.at,
        offsetMinutes: attendanceOperationFacts.offsetMinutes,
        businessDay: attendanceOperationFacts.businessDay,
        outcome: attendanceOperationFacts.outcome,
      })
      .from(attendanceOperationFacts)
      .where(eq(attendanceOperationFacts.personId, personId))
      .orderBy(asc(attendanceOperationFacts.at), asc(attendanceOperationFacts.sequence));

    const hasAttendance = questionRows.length + responseRows.length + activityRows.length > 0;

    return async () => [
      ...(employmentRows.length === 0
        ? []
        : [
            jsonFile("employment.json", {
              employments: employmentRows.map((row) => ({
                ...row,
                payRate: centsToDecimal(row.payRate),
              })),
            }),
          ]),
      ...(hasRota
        ? [
            jsonFile("rota.json", {
              shifts: shiftRows.map((row) => ({
                location: row.location,
                startsAt: localWallClock(row.startsAt, row.startsOffsetMinutes),
                endsAt: localWallClock(row.endsAt, row.endsOffsetMinutes),
                rota: row.rota,
                createdAt: row.createdAt,
              })),
              availability: availabilityRows.map((row) => ({
                ...row,
                from: clockOfMinute(row.from),
                to: clockOfMinute(row.to),
              })),
              swaps: swapRows.map((row) => {
                const mine = row.requestedByPersonId === personId;
                return {
                  direction: mine ? "requested_by_me" : "offered_to_me",
                  otherPerson: mine ? row.offeredTo : row.requester,
                  status: row.status,
                  decidedBy: row.decidedBy,
                  decidedAt: row.decidedAt,
                  createdAt: row.createdAt,
                };
              }),
            }),
          ]
        : []),
      ...(absenceRows.length === 0 ? [] : [jsonFile("absences.json", { absences: absenceRows })]),
      ...(hasAttendance
        ? [
            jsonFile("attendance.json", {
              questions: questionRows.map((row) => ({
                businessDay: row.businessDay,
                kind: row.kind,
                missingKinds: row.missingKinds,
                startAt: row.startAt,
                endAt: row.endAt,
                createdAt: row.createdAt,
                active: row.active,
                inactiveReason: row.inactiveReason,
                reminderEmail:
                  row.mailId === null
                    ? null
                    : {
                        recipient: row.recipient,
                        status: row.status,
                        outcome: row.outcome,
                        claimedAt: row.claimedAt,
                        nextAttemptAt: row.nextAttemptAt,
                      },
              })),
              responses: responseRows.map((row) => {
                const input = row.input;
                const reason: string | null = "reason" in input ? input.reason : null;
                return {
                  action: row.action,
                  byYou: row.requestedByPersonId === personId,
                  authorizedBy: row.authorizedBy,
                  reason,
                  changes: ("changes" in input ? input.changes : []).map((change) => ({
                    at: localWallClock(change.at, change.offsetMinutes),
                    missingKind: "missingKind" in change.target ? change.target.missingKind : null,
                  })),
                  createdAt: row.createdAt,
                };
              }),
              activity: activityRows.map((row) => ({
                source: row.source,
                kind: row.kind,
                at: localWallClock(row.at, row.offsetMinutes),
                businessDay: row.businessDay,
                outcome: row.outcome,
              })),
            }),
          ]
        : []),
    ];
  },
};
