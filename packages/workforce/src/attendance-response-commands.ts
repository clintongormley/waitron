import { and, eq } from "drizzle-orm";
import { type Transaction } from "@waitron/db";
import { persons, holds, readPersonAuthority } from "@waitron/identity";
import { AppError, type Origin } from "@waitron/shared";
import type {
  AttendanceCommand,
  AttendanceCommandPayload,
  AttendanceCommandResult,
  CorrectionItem,
} from "./attendance-contract.js";
import { attendanceAnswers } from "./schema/attendance-responses.js";
import { attendanceQuestions } from "./schema/attendance.js";
import { confirmAutomaticEntry } from "./automatic-entries.js";
import {
  decideCorrectionGroup,
  maySelfApproveAttendance,
  recordEntryById,
  recordInstant,
  requestCorrectionGroup,
} from "./corrections.js";
import { projectCorrectionItems, readAttendanceRevision } from "./attendance-responses.js";
import { readRecordedEntries } from "./record-reads.js";
import { approvalsForPerson, writeAttendanceDayApproval } from "./day-approvals.js";
import { isRecordDate } from "./record-dates.js";
import { recordInPeriod } from "./record-period.js";
import { projectTimeRecord } from "./record-projection.js";
import {
  answerForQuestion,
  reconcileAttendanceResponses,
} from "./attendance-question-responses.js";
import "./errors.js";

function invalid(reason: string): never {
  throw new AppError("correction.invalid", { reason });
}
export async function readAttendanceCommand(
  tx: Transaction,
  scope: { commandId: string; requestedByPersonId: string },
): Promise<AttendanceCommandResult | null> {
  const [row] = await tx
    .select()
    .from(attendanceAnswers)
    .where(
      and(
        eq(attendanceAnswers.id, scope.commandId),
        eq(attendanceAnswers.requestedByPersonId, scope.requestedByPersonId),
      ),
    );
  return row ? { commandId: row.id, entryIds: row.entryIds, replayed: true } : null;
}
async function canonicalQuestion(tx: Transaction, id: string) {
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(id)) invalid("question_cycle");
    visited.add(id);
    const [row] = await tx.select().from(attendanceQuestions).where(eq(attendanceQuestions.id, id));
    if (!row) invalid("question_missing");
    if (!row.canonicalQuestionId) return row;
    id = row.canonicalQuestionId;
  }
}
async function normalize(
  tx: Transaction,
  command: AttendanceCommand,
): Promise<AttendanceCommandPayload> {
  if (command.action === "confirm")
    return { action: "confirm", questionId: (await canonicalQuestion(tx, command.questionId)).id };
  if (command.action === "request" || command.action === "propose") {
    const reason = command.reason.trim();
    if (!reason || reason.length > 500) invalid("reason");
    const changes = command.changes.map((c) => ({
      target:
        "entryId" in c.target
          ? { entryId: c.target.entryId }
          : { missingKind: c.target.missingKind },
      at: recordInstant(c.at, c.offsetMinutes, "correction"),
      offsetMinutes: c.offsetMinutes,
    }));
    if (command.action === "propose") {
      if (command.date !== undefined && !isRecordDate(command.date)) invalid("date");
      if (command.replaces !== undefined && command.date === undefined) invalid("date");
    }
    return command.action === "request"
      ? {
          action: "request",
          questionId:
            command.questionId === null
              ? null
              : (await canonicalQuestion(tx, command.questionId)).id,
          changes,
          reason,
        }
      : {
          action: "propose",
          personId: command.personId,
          changes,
          reason,
          ...(command.date !== undefined && { date: command.date }),
          ...(command.replaces !== undefined && { replaces: command.replaces }),
        };
  }
  if (command.action === "disagree") {
    const reason = command.reason.trim();
    if (!reason || reason.length > 500) invalid("reason");
    return { action: "disagree", itemId: command.itemId, reason };
  }
  return { action: command.action, itemId: command.itemId };
}
async function findItem(tx: Transaction, id: string, replay: boolean): Promise<CorrectionItem> {
  const [command] = await tx.select().from(attendanceAnswers).where(eq(attendanceAnswers.id, id));
  const [entry] = command ? [] : await readRecordedEntries(tx, { entryId: id });
  const personId = command?.personId ?? entry?.personId;
  if (!personId) throw new AppError("correction.target_not_found", { entryId: id });
  const entries = await readRecordedEntries(tx, { personId });
  const receipts = await tx
    .select()
    .from(attendanceAnswers)
    .where(eq(attendanceAnswers.personId, personId));
  const item = projectCorrectionItems(entries, receipts).find(
    (i) => i.id === id || (replay && i.requestEntryIds.includes(id)),
  );
  if (!item) throw new AppError("correction.not_pending", { correctionId: id });
  return item;
}
async function authority(
  tx: Transaction,
  requester: string,
  authorizer: string,
  payload: AttendanceCommandPayload,
  personId: string,
  item?: CorrectionItem,
) {
  const [actor] = await tx.select().from(persons).where(eq(persons.id, authorizer));
  const [operator] = await tx.select().from(persons).where(eq(persons.id, requester));
  const refuse = () => {
    throw new AppError("correction.not_permitted", { personId: authorizer });
  };
  if (!actor || !operator || actor.status !== "active" || operator.status !== "active") refuse();
  if (
    payload.action === "propose" ||
    payload.action === "approve" ||
    payload.action === "decline"
  ) {
    if (!holds(await readPersonAuthority(tx, authorizer), "workforce.correct")) refuse();
    if (payload.action === "propose") {
      if (requester !== authorizer || authorizer === personId) refuse();
    } else if (payload.action === "approve" && item?.direction === "manager_proposal") {
      if (requester !== authorizer || authorizer === personId) refuse();
    } else if (
      !item ||
      (requester !== personId && requester !== authorizer) ||
      item.direction !== "worker_request" ||
      (authorizer === item.requestedByPersonId &&
        !(
          payload.action === "approve" &&
          (await maySelfApproveAttendance(tx, authorizer)) &&
          authorizer === personId
        ))
    )
      refuse();
  } else {
    if (requester !== personId || authorizer !== requester) refuse();
    if (
      (payload.action === "accept" || payload.action === "disagree") &&
      (!item || item.direction !== "manager_proposal" || item.requestedByPersonId === authorizer)
    )
      refuse();
  }
}
export async function executeAttendanceCommand(
  tx: Transaction,
  input: {
    nodeId: string;
    requestedByPersonId: string;
    authorizedByPersonId: string;
    origin: Origin;
    command: AttendanceCommand;
    now: Date;
  },
): Promise<AttendanceCommandResult> {
  const { command, requestedByPersonId: requester, authorizedByPersonId: authorizer } = input;
  const payload = await normalize(tx, command);
  const [saved] = await tx
    .select()
    .from(attendanceAnswers)
    .where(eq(attendanceAnswers.id, command.commandId));
  const savedPayload = saved && { ...saved.input };
  if (savedPayload) delete savedPayload.reviewedEntries;
  if (
    saved &&
    (saved.requestedByPersonId !== requester ||
      saved.authorizedByPersonId !== authorizer ||
      JSON.stringify(savedPayload) !== JSON.stringify(payload))
  )
    invalid("command_reused");
  const questionId =
    payload.action === "confirm" || payload.action === "request" ? payload.questionId : null;
  const question = questionId === null ? undefined : await canonicalQuestion(tx, questionId);
  const item =
    "itemId" in payload ? await findItem(tx, payload.itemId, saved !== undefined) : undefined;
  const personId =
    question?.personId ??
    item?.personId ??
    (payload.action === "propose" ? payload.personId : requester);
  await authority(tx, requester, authorizer, payload, personId, item);
  if (saved) return { commandId: saved.id, entryIds: saved.entryIds, replayed: true };
  if (item?.replaced) throw new AppError("correction.not_pending", { correctionId: item.id });
  if (command.expectedRevision !== (await readAttendanceRevision(tx, personId)))
    throw new AppError("attendance.state_changed", {});
  if (question && (!question.active || question.resolvedByEntryId !== null))
    throw new AppError("attendance.not_pending", { entryId: question.id });
  const [proposal] =
    item?.direction === "manager_proposal"
      ? await tx.select().from(attendanceAnswers).where(eq(attendanceAnswers.id, item.id))
      : [];
  const date =
    payload.action === "propose"
      ? payload.date
      : proposal?.input.action === "propose"
        ? proposal.input.date
        : undefined;
  let reviewedEntries: string[] | undefined;
  if (date !== undefined) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const end = next.toISOString().slice(0, 10);
    if (!isRecordDate(end)) invalid("date");
    const rows = recordInPeriod(projectTimeRecord(await readRecordedEntries(tx, { personId })), {
      start: date,
      end,
    }).entries;
    reviewedEntries = rows
      .filter((row) => row.effective)
      .map((row) => row.entry.entryId)
      .sort();
    if (payload.action === "propose" && payload.replaces !== undefined) {
      const replaced = await findItem(tx, payload.replaces, false);
      if (
        replaced.personId !== personId ||
        (replaced.status !== "waiting-manager" && replaced.status !== "disputed") ||
        !replaced.history.some((entry) => rows.some((row) => row.entry.entryId === entry.entryId))
      )
        throw new AppError("correction.not_pending", { correctionId: payload.replaces });
    }
  }
  let entryIds: string[];
  if (payload.action === "confirm") {
    if (!question || question.kind !== "automatic-out") invalid("not_automatic");
    entryIds = [
      await confirmAutomaticEntry(tx, {
        nodeId: input.nodeId,
        entryId: question.automaticEntryId!,
        workerPersonId: requester,
        origin: input.origin,
      }),
    ];
  } else if (payload.action === "request" || payload.action === "propose") {
    let missingKinds = question?.missingKinds;
    if (question) {
      const entries = await readRecordedEntries(tx, { personId });
      const commands = await tx
        .select()
        .from(attendanceAnswers)
        .where(eq(attendanceAnswers.personId, personId));
      missingKinds = answerForQuestion(
        question,
        entries,
        commands,
        projectCorrectionItems(entries, commands),
      ).missingKinds;
    }
    for (const change of payload.changes) {
      if ("entryId" in change.target) {
        const [target] = await readRecordedEntries(tx, { entryId: change.target.entryId });
        if (!target || target.personId !== personId) invalid("target_scope");
        if (reviewedEntries && !reviewedEntries.includes(target.entryId)) invalid("target_scope");
        if (question && question.automaticEntryId !== target.entryId) invalid("question_target");
      } else if (
        question &&
        (question.kind !== "missing-times" ||
          !missingKinds!.includes(change.target.missingKind as "in" | "out"))
      )
        invalid("question_kind");
    }
    entryIds = await requestCorrectionGroup(
      tx,
      payload.changes.map((change) => ({
        ...("entryId" in change.target
          ? { correctsEntryId: change.target.entryId }
          : { personId, missingEntryKind: change.target.missingKind }),
        nodeId: input.nodeId,
        actorPersonId: authorizer,
        origin: input.origin,
        at: change.at,
        offsetMinutes: change.offsetMinutes,
        reason: payload.reason,
      })),
      payload.action,
      date !== undefined,
    );
  } else {
    const takingWorkerTime = payload.action === "approve" && item!.direction === "manager_proposal";
    const workerVersion = takingWorkerTime ? item!.workerVersion : undefined;
    if (takingWorkerTime && !workerVersion)
      throw new AppError("correction.not_pending", { correctionId: item!.id });
    const previous = workerVersion?.itemId
      ? await findItem(tx, workerVersion.itemId, false)
      : undefined;
    const keepRecorded = workerVersion && !previous;
    const actor = { nodeId: input.nodeId, actorPersonId: authorizer, origin: input.origin };
    if (keepRecorded) {
      const marker = await recordEntryById(tx, item!.responseEntryIds.at(-1)!);
      const changes = [];
      for (const { target, at, offsetMinutes } of workerVersion.changes) {
        if (!("entryId" in target)) invalid("target_scope");
        const time = await recordEntryById(tx, target.entryId);
        if (time.eventAt !== at || time.offsetMinutes !== offsetMinutes)
          changes.push({
            ...actor,
            correctsEntryId: target.entryId,
            at,
            offsetMinutes,
            reason: marker.correctionReason!,
          });
      }
      entryIds =
        changes.length === 0
          ? []
          : await requestCorrectionGroup(tx, changes, "propose", true, marker.entryId);
    } else
      entryIds = await decideCorrectionGroup(
        tx,
        {
          ...actor,
          correctionIds: (previous ?? item!).requestEntryIds,
          ...(payload.action === "disagree" ? { reason: payload.reason } : {}),
        },
        payload.action,
        !previous && date !== undefined,
      );
    const reviewedProposal =
      payload.action === "accept" &&
      proposal &&
      reviewedEntries &&
      JSON.stringify(reviewedEntries) === JSON.stringify(proposal.input.reviewedEntries);
    if (payload.action === "approve" || reviewedProposal) {
      const days = approvalsForPerson(await readRecordedEntries(tx, { personId }));
      const timeIds =
        keepRecorded && entryIds.length === 0
          ? workerVersion.changes.flatMap(({ target }) =>
              "entryId" in target ? [target.entryId] : [],
            )
          : entryIds;
      const day = [...days].find(
        ([dayDate, { times }]) =>
          (date === undefined || date === dayDate) &&
          timeIds.every((id) => times.some((time) => time.entryId === id)),
      )?.[1];
      if (day)
        await writeAttendanceDayApproval(
          tx,
          {
            ...input,
            actorPersonId: reviewedProposal ? proposal!.authorizedByPersonId : authorizer,
          },
          day,
        );
    }
    if (keepRecorded && entryIds.length === 0) entryIds = item!.responseEntryIds;
  }
  await tx.insert(attendanceAnswers).values({
    id: command.commandId,
    requestedByPersonId: requester,
    authorizedByPersonId: authorizer,
    personId,
    questionId,
    action: payload.action,
    input:
      payload.action === "propose" && reviewedEntries ? { ...payload, reviewedEntries } : payload,
    entryIds,
    createdAt: input.now.toISOString(),
  });
  await reconcileAttendanceResponses(tx, personId);
  return { commandId: command.commandId, entryIds, replayed: false };
}
