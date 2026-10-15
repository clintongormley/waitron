import { eq, isNull, and } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { AttendanceResponseReceipt, CorrectionItem } from "./attendance-contract.js";
import type { TimeEntryRecord } from "./projection.js";
import { compareRecording, effectiveClockEntries } from "./effective-entries.js";
import { recordRoot } from "./record-projection.js";
import { attendanceQuestions } from "./schema/attendance.js";
import { attendanceResponseCommands } from "./schema/attendance-responses.js";
import { readRecordedEntries } from "./record-reads.js";
import { projectCorrectionItems } from "./attendance-responses.js";
import { cancelUnclaimedAttendanceMail } from "./attendance-mail.js";

export function answerForQuestion(
  question: typeof attendanceQuestions.$inferSelect,
  entries: readonly TimeEntryRecord[],
  commands: readonly AttendanceResponseReceipt[],
  items: readonly CorrectionItem[],
): { resolvedByEntryId: string | null; missingKinds: ("in" | "out")[] } {
  const related = commands.filter(
    (c) =>
      c.questionId === question.id &&
      c.personId === question.personId &&
      c.locationId === question.locationId,
  );
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const itemFor = new Map(
    items.flatMap((item) => item.requestEntryIds.map((id) => [id, item] as const)),
  );
  if (question.kind === "automatic-out") {
    const confirmation = entries
      .filter(
        (e) =>
          e.personId === question.personId &&
          e.locationId === question.locationId &&
          e.entryKind === "confirmation" &&
          e.extension?.authorKind === "worker" &&
          e.extension.respondsToEntryId === question.automaticEntryId,
      )
      .sort(compareRecording)
      .at(-1);
    const effective = effectiveClockEntries(entries).find(
      (e) =>
        e.personId === question.personId &&
        e.locationId === question.locationId &&
        e.entryId !== question.automaticEntryId &&
        recordRoot(e, byId).entryId === question.automaticEntryId,
    );
    const request = items.find(
      (item) =>
        item.personId === question.personId &&
        item.locationId === question.locationId &&
        item.direction === "worker_request" &&
        (item.status === "waiting-manager" || item.status === "approved") &&
        item.history.some((e) => e.entryId === question.automaticEntryId),
    );
    return {
      resolvedByEntryId:
        confirmation?.entryId ??
        effective?.entryId ??
        request?.requestEntryIds[0] ??
        (related.length === 0 &&
        byId.get(question.resolvedByEntryId ?? "")?.correctionStatus !== "requested"
          ? question.resolvedByEntryId
          : null),
      missingKinds: [],
    };
  }
  const covered = new Map<string, string>();
  for (const command of related) {
    if (command.action !== "request") continue;
    for (const id of command.entryIds) {
      const entry = byId.get(id);
      const item = itemFor.get(id);
      if (!entry || !item || (item.status !== "waiting-manager" && item.status !== "approved"))
        continue;
      const kind = entry.extension?.missingEntryKind;
      if (kind) covered.set(kind, id);
    }
  }
  const missingKinds = question.missingKinds.filter((kind) => !covered.has(kind));
  return {
    resolvedByEntryId:
      missingKinds.length === 0
        ? [...covered.values()][0]!
        : related.length === 0
          ? question.resolvedByEntryId
          : null,
    missingKinds,
  };
}
export async function reconcileAttendanceResponses(
  tx: Transaction,
  personId: string,
): Promise<void> {
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
        isNull(attendanceQuestions.canonicalQuestionId),
      ),
    );
  for (const question of questions) {
    const answer = answerForQuestion(question, entries, commands, items);
    if (answer.resolvedByEntryId !== question.resolvedByEntryId)
      await tx
        .update(attendanceQuestions)
        .set({ resolvedByEntryId: answer.resolvedByEntryId })
        .where(eq(attendanceQuestions.id, question.id));
    if (!question.active || answer.resolvedByEntryId !== null)
      await cancelUnclaimedAttendanceMail(tx, question.id);
  }
}
