import type { PaidBreakPolicy } from "./ruleset.js";
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { readVenue, type Transaction } from "@waitron/db";
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
import type { TimeEntryRecord } from "./projection.js";
import { readAttendanceRevision, projectCorrectionItems } from "./attendance-responses.js";
import { answerForQuestion } from "./attendance-question-responses.js";
import { attendanceDays, attendanceQuestions } from "./schema/attendance.js";
import { attendanceAnswers } from "./schema/attendance-responses.js";
import { timeEntries } from "./schema/time-entries.js";
import "./errors.js";

const invalid = () => new AppError("attendance.invalid", { reason: "record_scope_or_period" });
function requireId(id: string) {
  if (typeof id !== "string" || id.length === 0) throw invalid();
}
export async function readAttendanceInbox(
  tx: Transaction,
  personId: string,
): Promise<AttendanceInbox> {
  requireId(personId);
  const entries = await readRecordedEntries(tx, { personId });
  const inputs = await readAttendanceInboxInputs(tx, personId);
  const work = projectAttendanceInboxWork(personId, entries, inputs);
  return { ...work, revision: await readAttendanceRevision(tx, personId) };
}

export async function readAttendanceInboxInputs(
  tx: Transaction,
  personId: string,
  scope: "all" | "possible-prompts" = "all",
) {
  const commands = await tx
    .select()
    .from(attendanceAnswers)
    .where(eq(attendanceAnswers.personId, personId));
  const questions = await tx
    .select({
      ...getTableColumns(attendanceQuestions),
      businessDay: attendanceDays.businessDay,
      startAt: attendanceDays.startAt,
      endAt: attendanceDays.endAt,
    })
    .from(attendanceQuestions)
    .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceQuestions.attendanceDayId))
    .where(
      and(
        eq(attendanceQuestions.personId, personId),
        eq(attendanceQuestions.active, true),
        isNull(attendanceQuestions.canonicalQuestionId),
        // With no linked command, answerForQuestion can reopen a saved automatic-out
        // resolution only when its resolving entry is a correction request.
        scope === "all"
          ? undefined
          : sql`(
              ${attendanceQuestions.resolvedByEntryId} is null
              or exists (
                select 1 from ${attendanceAnswers}
                where ${attendanceAnswers.personId} = ${personId}
                  and ${attendanceAnswers.questionId} = ${attendanceQuestions.id}
              )
              or (
                ${attendanceQuestions.kind} = 'automatic-out'
                and exists (
                  select 1 from ${timeEntries}
                  where ${timeEntries.id} = ${attendanceQuestions.resolvedByEntryId}
                    and ${timeEntries.personId} = ${personId}
                    and ${timeEntries.correctionStatus} = 'requested'
                )
              )
            )`,
      ),
    );
  const { timeZone } = await readVenue(tx);
  return { commands, questions, timeZone };
}

export function projectAttendanceInboxWork(
  personId: string,
  entries: TimeEntryRecord[],
  { commands, questions, timeZone }: Awaited<ReturnType<typeof readAttendanceInboxInputs>>,
): Omit<AttendanceInbox, "revision"> {
  const items = projectCorrectionItems(entries, commands);
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const prompts: { at: string; prompt: AttendancePrompt }[] = [];
  for (const question of questions) {
    const answer = answerForQuestion(question, entries, commands, items);
    if (answer.resolvedByEntryId !== null) continue;
    const related = new Set(
      commands.filter((c) => c.questionId === question.id).flatMap((c) => c.entryIds),
    );
    const roots = new Set(
      entries
        .filter(
          (e) =>
            (e.eventAt >= question.startAt && e.eventAt < question.endAt) ||
            e.entryId === question.openEntryId ||
            e.entryId === question.automaticEntryId ||
            related.has(e.entryId),
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
        businessDay: question.businessDay,
        day: {
          businessDay: question.businessDay,
          startAt: question.startAt,
          endAt: question.endAt,
        },
        kind: question.kind,
        automaticEntryId: question.automaticEntryId,
        missingKinds: answer.missingKinds,
        timeZone,
        history: entries
          .filter((e) => roots.has(recordRoot(e, byId).entryId))
          .sort(compareRecording),
      },
    });
  }
  for (const item of items) {
    if (item.status !== "waiting-worker") continue;
    prompts.push({
      at: item.history.map((e) => e.eventAt).sort()[0]!,
      prompt: {
        id: item.id,
        questionId: null,
        itemId: item.id,
        personId,
        businessDay: null,
        day: null,
        kind: "proposal",
        automaticEntryId: null,
        missingKinds: [],
        timeZone,
        history: item.history,
      },
    });
  }
  prompts.sort((a, b) => a.at.localeCompare(b.at) || a.prompt.id.localeCompare(b.prompt.id));
  return {
    personId,
    prompts: prompts.map((p) => p.prompt),
    items,
    timeZone,
  };
}
export async function readAttendanceDay(
  tx: Transaction,
  scope: { personId: string; date: string },
  policy: PaidBreakPolicy | null = null,
): Promise<AttendanceDayView> {
  requireId(scope.personId);
  if (!isRecordDate(scope.date)) throw invalid();
  const next = new Date(`${scope.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10);
  if (!isRecordDate(end)) throw invalid();
  const { timeZone } = await readVenue(tx);
  const entries = await readRecordedEntries(tx, { personId: scope.personId });
  const commands = await tx
    .select()
    .from(attendanceAnswers)
    .where(eq(attendanceAnswers.personId, scope.personId));
  const record = await readTimeRecord(
    tx,
    {
      personId: scope.personId,
      period: { start: scope.date, end },
    },
    policy,
  );
  const shown = new Set(record.entries.map((e) => e.entry.entryId));
  const items = projectCorrectionItems(entries, commands).filter((item) =>
    item.history.some((e) => shown.has(e.entryId)),
  );
  return {
    personId: scope.personId,
    date: scope.date,
    timeZone,
    revision: await readAttendanceRevision(tx, scope.personId),
    record,
    items,
  };
}
export async function readAttendanceManagerQueue(tx: Transaction): Promise<AttendanceManagerQueue> {
  const entries = await readRecordedEntries(tx, {});
  const commands = await tx.select().from(attendanceAnswers);
  const items = projectCorrectionItems(entries, commands).filter(
    (item) =>
      item.status === "waiting-manager" ||
      item.status === "waiting-worker" ||
      item.status === "disputed",
  );
  return { items };
}
