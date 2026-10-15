import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { assertAttendanceDay } from "./attendance-state.js";
import type { AttendanceQuestion } from "./attendance-types.js";
import { attendanceMail, attendanceQuestions } from "./schema/attendance.js";
import "./errors.js";

type QuestionRow = typeof attendanceQuestions.$inferSelect;
type QuestionInput = Omit<AttendanceQuestion, "id" | "createdAt">;
const union = <T extends string>(a: readonly T[], b: readonly T[]): T[] =>
  [...new Set([...a, ...b])].sort();
const invalid = (reason: string) => new AppError("attendance.invalid", { reason });

function validate(input: QuestionInput, at: Date) {
  assertAttendanceDay(input.day);
  if (
    !input.personId ||
    !input.shiftKey ||
    !Number.isFinite(at.getTime()) ||
    input.evidenceKeys.some((key) => !key) ||
    input.missingKinds.some((kind) => kind !== "in" && kind !== "out") ||
    (input.kind === "automatic-out"
      ? !input.openEntryId || !input.automaticEntryId || input.missingKinds.length !== 0
      : input.kind !== "missing-times" ||
        input.automaticEntryId !== null ||
        input.missingKinds.length === 0)
  ) {
    throw invalid("invalid attendance question");
  }
}

function asQuestion(row: QuestionRow): AttendanceQuestion {
  return {
    id: row.id,
    personId: row.personId,
    day: {
      locationId: row.locationId,
      businessDay: row.businessDay,
      startAt: row.startAt,
      endAt: row.endAt,
    },
    shiftKey: row.shiftKey,
    kind: row.kind,
    missingKinds: row.missingKinds,
    openEntryId: row.openEntryId,
    automaticEntryId: row.automaticEntryId,
    evidenceKeys: row.evidenceKeys,
    createdAt: row.createdAt,
  };
}

async function canonicalQuestion(tx: Transaction, id: string): Promise<QuestionRow> {
  const seen = new Set<string>();
  let next = id;
  for (;;) {
    if (seen.has(next)) throw invalid("attendance question cycle");
    seen.add(next);
    const [row] = await tx
      .select()
      .from(attendanceQuestions)
      .where(eq(attendanceQuestions.id, next));
    if (!row) throw invalid("attendance question missing");
    if (row.canonicalQuestionId === null) return row;
    next = row.canonicalQuestionId;
  }
}

async function cancelUnclaimed(tx: Transaction, questionId: string): Promise<void> {
  await tx
    .update(attendanceMail)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(attendanceMail.questionId, questionId),
        inArray(attendanceMail.status, ["pending", "rejected"]),
      ),
    );
}

async function ensureReminder(tx: Transaction, row: QuestionRow, at: Date): Promise<void> {
  if (row.kind === "automatic-out" || !row.active || row.resolvedByEntryId !== null) {
    await cancelUnclaimed(tx, row.id);
    return;
  }
  await tx
    .insert(attendanceMail)
    .values({ questionId: row.id, nextAttemptAt: at.toISOString() })
    .onConflictDoNothing({ target: attendanceMail.questionId });
}

function mergedFields(row: QuestionRow, input: QuestionInput) {
  if (
    (row.automaticEntryId !== null &&
      input.automaticEntryId !== null &&
      row.automaticEntryId !== input.automaticEntryId) ||
    (row.openEntryId !== null &&
      input.openEntryId !== null &&
      row.openEntryId !== input.openEntryId)
  ) {
    throw invalid("attendance target changed");
  }
  const automaticEntryId = row.automaticEntryId ?? input.automaticEntryId;
  return {
    kind: automaticEntryId === null ? ("missing-times" as const) : ("automatic-out" as const),
    openEntryId: row.openEntryId ?? input.openEntryId,
    automaticEntryId,
    missingKinds: automaticEntryId === null ? union(row.missingKinds, input.missingKinds) : [],
    evidenceKeys: union(row.evidenceKeys, input.evidenceKeys),
  };
}

export async function upsertAttendanceQuestion(
  tx: Transaction,
  input: QuestionInput,
  at: Date,
): Promise<string> {
  validate(input, at);
  const [existing] = await tx
    .select()
    .from(attendanceQuestions)
    .where(
      and(
        eq(attendanceQuestions.personId, input.personId),
        eq(attendanceQuestions.locationId, input.day.locationId),
        eq(attendanceQuestions.shiftKey, input.shiftKey),
      ),
    );
  let row: QuestionRow;
  if (existing) {
    row = await canonicalQuestion(tx, existing.id);
    if (
      row.businessDay !== input.day.businessDay ||
      row.startAt !== new Date(input.day.startAt).toISOString() ||
      row.endAt !== new Date(input.day.endAt).toISOString()
    ) {
      throw invalid("attendance question bounds changed");
    }
    const fields = mergedFields(row, input);
    await tx.update(attendanceQuestions).set(fields).where(eq(attendanceQuestions.id, row.id));
    row = { ...row, ...fields };
  } else {
    const [created] = await tx
      .insert(attendanceQuestions)
      .values({
        personId: input.personId,
        locationId: input.day.locationId,
        businessDay: input.day.businessDay,
        startAt: new Date(input.day.startAt).toISOString(),
        endAt: new Date(input.day.endAt).toISOString(),
        shiftKey: input.shiftKey,
        kind: input.kind,
        missingKinds: union([], input.missingKinds),
        openEntryId: input.openEntryId,
        automaticEntryId: input.automaticEntryId,
        evidenceKeys: union([], input.evidenceKeys),
        createdAt: at.toISOString(),
      })
      .returning();
    row = created!;
  }
  await ensureReminder(tx, row, at);
  return row.id;
}

export async function listPendingAttendanceQuestions(
  tx: Transaction,
  personId: string,
): Promise<AttendanceQuestion[]> {
  const rows = await tx
    .select()
    .from(attendanceQuestions)
    .where(
      and(
        eq(attendanceQuestions.personId, personId),
        eq(attendanceQuestions.active, true),
        isNull(attendanceQuestions.resolvedByEntryId),
        isNull(attendanceQuestions.canonicalQuestionId),
      ),
    )
    .orderBy(
      asc(attendanceQuestions.businessDay),
      asc(attendanceQuestions.startAt),
      asc(attendanceQuestions.id),
    );
  return rows.map(asQuestion);
}

export async function mergeAttendanceQuestions(
  tx: Transaction,
  canonicalId: string,
  duplicateId: string,
): Promise<void> {
  const canonical = await canonicalQuestion(tx, canonicalId);
  const duplicate = await canonicalQuestion(tx, duplicateId);
  if (canonical.id === duplicate.id) return;
  if (
    canonical.personId !== duplicate.personId ||
    canonical.locationId !== duplicate.locationId ||
    canonical.businessDay !== duplicate.businessDay ||
    canonical.startAt !== duplicate.startAt ||
    canonical.endAt !== duplicate.endAt ||
    !canonical.active ||
    !duplicate.active ||
    canonical.resolvedByEntryId !== null ||
    duplicate.resolvedByEntryId !== null
  ) {
    throw invalid("incompatible attendance questions");
  }
  const fields = mergedFields(canonical, asQuestion(duplicate));
  await tx.update(attendanceQuestions).set(fields).where(eq(attendanceQuestions.id, canonical.id));
  await tx
    .update(attendanceQuestions)
    .set({ canonicalQuestionId: canonical.id, active: false, inactiveReason: "merged" })
    .where(eq(attendanceQuestions.id, duplicate.id));
  const [mail] = await tx
    .select()
    .from(attendanceMail)
    .where(eq(attendanceMail.questionId, duplicate.id));
  await cancelUnclaimed(tx, duplicate.id);
  if (mail && (mail.status === "sending" || mail.status === "sent" || mail.status === "unknown")) {
    await cancelUnclaimed(tx, canonical.id);
  }
  await ensureReminder(tx, { ...canonical, ...fields }, new Date(canonical.createdAt));
}
