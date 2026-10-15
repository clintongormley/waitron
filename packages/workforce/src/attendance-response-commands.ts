import { and, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, type Origin } from "@waitron/shared";
import type {
  AttendanceCommand,
  AttendanceCommandPayload,
  AttendanceCommandResult,
  CorrectionItem,
} from "./attendance-contract.js";
import { attendanceResponseCommands } from "./schema/attendance-responses.js";
import { attendanceQuestions } from "./schema/attendance.js";
import { confirmAutomaticEntry } from "./automatic-entries.js";
import {
  decideCorrectionGroup,
  MANAGER_ROLES,
  recordInstant,
  requestCorrectionGroup,
} from "./corrections.js";
import { projectCorrectionItems, readAttendanceRevision } from "./attendance-responses.js";
import { readRecordedEntries } from "./record-reads.js";
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
    .from(attendanceResponseCommands)
    .where(
      and(
        eq(attendanceResponseCommands.id, scope.commandId),
        eq(attendanceResponseCommands.requestedByPersonId, scope.requestedByPersonId),
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
    return command.action === "request"
      ? {
          action: "request",
          questionId:
            command.questionId === null
              ? null
              : (await canonicalQuestion(tx, command.questionId)).id,
          locationId: command.locationId,
          changes,
          reason,
        }
      : {
          action: "propose",
          personId: command.personId,
          locationId: command.locationId,
          changes,
          reason,
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
  const [command] = await tx
    .select()
    .from(attendanceResponseCommands)
    .where(eq(attendanceResponseCommands.id, id));
  const [entry] = command ? [] : await readRecordedEntries(tx, { entryId: id });
  const personId = command?.personId ?? entry?.personId;
  if (!personId) throw new AppError("correction.target_not_found", { entryId: id });
  const entries = await readRecordedEntries(tx, { personId });
  const receipts = await tx
    .select()
    .from(attendanceResponseCommands)
    .where(eq(attendanceResponseCommands.personId, personId));
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
    if (!MANAGER_ROLES.has(actor!.role)) refuse();
    if (payload.action === "propose") {
      if (requester !== authorizer || authorizer === personId) refuse();
    } else if (
      !item ||
      (requester !== personId && requester !== authorizer) ||
      item.direction !== "worker_request" ||
      (authorizer === item.requestedByPersonId &&
        !(payload.action === "approve" && actor!.role === "admin" && authorizer === personId))
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
    .from(attendanceResponseCommands)
    .where(eq(attendanceResponseCommands.id, command.commandId));
  if (
    saved &&
    (saved.requestedByPersonId !== requester ||
      saved.authorizedByPersonId !== authorizer ||
      JSON.stringify(saved.input) !== JSON.stringify(payload))
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
  const locationId =
    question?.locationId ??
    item?.locationId ??
    ("locationId" in payload ? payload.locationId : invalid("location_missing"));
  await authority(tx, requester, authorizer, payload, personId, item);
  if (saved) return { commandId: saved.id, entryIds: saved.entryIds, replayed: true };
  if (command.expectedRevision !== (await readAttendanceRevision(tx, personId)))
    throw new AppError("attendance.state_changed", {});
  if (question && (!question.active || question.resolvedByEntryId !== null))
    throw new AppError("attendance.not_pending", { entryId: question.id });
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
    if (payload.locationId !== locationId) invalid("question_location");
    let missingKinds = question?.missingKinds;
    if (question) {
      const entries = await readRecordedEntries(tx, { personId });
      const commands = await tx
        .select()
        .from(attendanceResponseCommands)
        .where(eq(attendanceResponseCommands.personId, personId));
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
        if (!target || target.personId !== personId || target.locationId !== locationId)
          invalid("target_scope");
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
          : { personId, locationId, missingEntryKind: change.target.missingKind }),
        nodeId: input.nodeId,
        actorPersonId: authorizer,
        origin: input.origin,
        at: change.at,
        offsetMinutes: change.offsetMinutes,
        reason: payload.reason,
      })),
      payload.action,
    );
  } else {
    entryIds = await decideCorrectionGroup(
      tx,
      {
        nodeId: input.nodeId,
        correctionIds: item!.requestEntryIds,
        actorPersonId: authorizer,
        origin: input.origin,
        ...(payload.action === "disagree" ? { reason: payload.reason } : {}),
      },
      payload.action,
    );
  }
  await tx.insert(attendanceResponseCommands).values({
    id: command.commandId,
    requestedByPersonId: requester,
    authorizedByPersonId: authorizer,
    personId,
    locationId,
    questionId,
    action: payload.action,
    input: payload,
    entryIds,
    createdAt: input.now.toISOString(),
  });
  await reconcileAttendanceResponses(tx, personId);
  return { commandId: command.commandId, entryIds, replayed: false };
}
