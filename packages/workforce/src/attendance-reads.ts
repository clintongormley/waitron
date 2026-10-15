import { and, eq, isNull } from "drizzle-orm";
import { locations, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type {
  AttendanceDayView,
  AttendanceInbox,
  AttendanceManagerQueue,
  AttendancePrompt,
} from "./attendance-contract.js";
import { readRecordedEntries, readTimeRecord } from "./record-reads.js";
import { compareRecording } from "./effective-entries.js";
import { recordRoot } from "./record-projection.js";
import { isRecordDate } from "./record-dates.js";
import { readAttendanceRevision, projectCorrectionItems } from "./attendance-responses.js";
import { answerForQuestion } from "./attendance-question-responses.js";
import { attendanceQuestions } from "./schema/attendance.js";
import { attendanceResponseCommands } from "./schema/attendance-responses.js";
import "./errors.js";

const invalid = () => new AppError("attendance.invalid", { reason: "record_scope_or_period" });
function requireId(id: string) {
  if (typeof id !== "string" || id.length === 0) throw invalid();
}
async function locationInfo(tx: Transaction, locationId: string) {
  requireId(locationId);
  const [location] = await tx
    .select({ id: locations.id, name: locations.name, timeZone: locations.timeZone })
    .from(locations)
    .where(eq(locations.id, locationId));
  if (!location) throw invalid();
  return location;
}
export async function readAttendanceInbox(
  tx: Transaction,
  personId: string,
): Promise<AttendanceInbox> {
  requireId(personId);
  const entries = await readRecordedEntries(tx, { personId });
  const commands = await tx
    .select()
    .from(attendanceResponseCommands)
    .where(eq(attendanceResponseCommands.personId, personId));
  const items = projectCorrectionItems(entries, commands);
  const questions = await tx
    .select()
    .from(attendanceQuestions)
    .where(
      and(
        eq(attendanceQuestions.personId, personId),
        eq(attendanceQuestions.active, true),
        isNull(attendanceQuestions.canonicalQuestionId),
      ),
    );
  const ownLocations = new Set([
    ...entries.map((e) => e.locationId),
    ...questions.map((q) => q.locationId),
  ]);
  const locationRows = (
    await tx
      .select({ id: locations.id, name: locations.name, timeZone: locations.timeZone })
      .from(locations)
  )
    .filter((l) => ownLocations.has(l.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const byLocation = new Map(locationRows.map((l) => [l.id, l]));
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const prompts: { at: string; prompt: AttendancePrompt }[] = [];
  for (const question of questions) {
    const answer = answerForQuestion(question, entries, commands, items);
    if (answer.resolvedByEntryId !== null) continue;
    const location = byLocation.get(question.locationId)!;
    const related = new Set(
      commands.filter((c) => c.questionId === question.id).flatMap((c) => c.entryIds),
    );
    const roots = new Set(
      entries
        .filter(
          (e) =>
            e.locationId === question.locationId &&
            ((e.eventAt >= question.startAt && e.eventAt < question.endAt) ||
              e.entryId === question.openEntryId ||
              e.entryId === question.automaticEntryId ||
              related.has(e.entryId)),
        )
        .map((e) => recordRoot(e, byId).entryId),
    );
    prompts.push({
      at: question.startAt,
      prompt: {
        id: question.id,
        questionId: question.id,
        itemId: null,
        personId,
        locationId: question.locationId,
        locationName: location.name,
        businessDay: question.businessDay,
        day: {
          locationId: question.locationId,
          businessDay: question.businessDay,
          startAt: question.startAt,
          endAt: question.endAt,
        },
        kind: question.kind,
        automaticEntryId: question.automaticEntryId,
        missingKinds: answer.missingKinds,
        timeZone: location.timeZone,
        history: entries
          .filter(
            (e) => e.locationId === question.locationId && roots.has(recordRoot(e, byId).entryId),
          )
          .sort(compareRecording),
      },
    });
  }
  for (const item of items) {
    if (item.status !== "waiting-worker") continue;
    const location = byLocation.get(item.locationId)!;
    prompts.push({
      at: item.history.map((e) => e.eventAt).sort()[0]!,
      prompt: {
        id: item.id,
        questionId: null,
        itemId: item.id,
        personId,
        locationId: item.locationId,
        locationName: location.name,
        businessDay: null,
        day: null,
        kind: "proposal",
        automaticEntryId: null,
        missingKinds: [],
        timeZone: location.timeZone,
        history: item.history,
      },
    });
  }
  prompts.sort((a, b) => a.at.localeCompare(b.at) || a.prompt.id.localeCompare(b.prompt.id));
  return {
    personId,
    revision: await readAttendanceRevision(tx, personId),
    prompts: prompts.map((p) => p.prompt),
    items,
    locations: locationRows,
  };
}
export async function readAttendanceDay(
  tx: Transaction,
  scope: { personId: string; locationId: string; date: string },
): Promise<AttendanceDayView> {
  requireId(scope.personId);
  if (!isRecordDate(scope.date)) throw invalid();
  const next = new Date(`${scope.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10);
  if (!isRecordDate(end)) throw invalid();
  const location = await locationInfo(tx, scope.locationId);
  const entries = await readRecordedEntries(tx, { personId: scope.personId });
  const commands = await tx
    .select()
    .from(attendanceResponseCommands)
    .where(eq(attendanceResponseCommands.personId, scope.personId));
  const record = await readTimeRecord(tx, {
    personId: scope.personId,
    locationId: scope.locationId,
    period: { start: scope.date, end },
  });
  const shown = new Set(record.entries.map((e) => e.entry.entryId));
  const items = projectCorrectionItems(entries, commands).filter(
    (item) =>
      item.locationId === scope.locationId && item.history.some((e) => shown.has(e.entryId)),
  );
  return {
    ...scope,
    timeZone: location.timeZone,
    revision: await readAttendanceRevision(tx, scope.personId),
    record,
    items,
  };
}
export async function readAttendanceManagerQueue(
  tx: Transaction,
  locationId: string,
): Promise<AttendanceManagerQueue> {
  await locationInfo(tx, locationId);
  const entries = await readRecordedEntries(tx, {});
  const commands = await tx.select().from(attendanceResponseCommands);
  const items = projectCorrectionItems(entries, commands).filter(
    (item) =>
      item.locationId === locationId &&
      (item.status === "waiting-manager" ||
        item.status === "waiting-worker" ||
        item.status === "disputed"),
  );
  return { locationId, items };
}
