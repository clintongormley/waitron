import type { AttendanceResponseReceipt, CorrectionItem } from "./attendance-contract.js";
import { groupByPerson, type TimeEntryRecord } from "./projection.js";
import {
  compareEvents,
  compareRecording,
  effectiveClockEntries,
  sameSubject,
} from "./effective-entries.js";
import { entryDate } from "./record-period.js";
import { recordRoot } from "./record-projection.js";
import { correctionGroupCanApply } from "./corrections.js";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { readBusinessDayRevision, readVenueClock, type Transaction } from "@waitron/db";
import { readRecordedEntries } from "./record-reads.js";
import { attendanceQuestions } from "./schema/attendance.js";
import { attendanceAnswers } from "./schema/attendance-responses.js";

export async function readAttendanceRevision(tx: Transaction, personId: string): Promise<string> {
  const entries = (await readRecordedEntries(tx, { personId }))
    .filter((entry) => entry.entryKind !== "day_approval")
    .sort(compareRecording);
  const questions = await tx
    .select()
    .from(attendanceQuestions)
    .where(eq(attendanceQuestions.personId, personId))
    .orderBy(attendanceQuestions.id);
  const commands = await tx
    .select()
    .from(attendanceAnswers)
    .where(eq(attendanceAnswers.personId, personId))
    .orderBy(attendanceAnswers.id);
  const clock = await readVenueClock(tx);
  const settings = await readBusinessDayRevision(tx);
  return createHash("sha256")
    .update(JSON.stringify({ personId, entries, questions, commands, clock, settings }))
    .digest("hex");
}

function responses(
  entries: readonly TimeEntryRecord[],
  request: TimeEntryRecord,
): TimeEntryRecord[] {
  return entries
    .filter(
      (e) =>
        sameSubject(e, request) &&
        e.entryKind === "correction" &&
        e.correctionStatus !== "requested" &&
        e.extension?.respondsToEntryId === request.entryId,
    )
    .sort(compareRecording);
}

function isWorkerTime(time: TimeEntryRecord): boolean {
  return (
    time.recordedByPersonId === time.personId || time.extension?.direction === "worker_request"
  );
}

export function projectCorrectionItems(
  entries: readonly TimeEntryRecord[],
  commands: readonly AttendanceResponseReceipt[],
): CorrectionItem[] {
  const requests = entries
    .filter(
      (e) =>
        e.entryKind === "correction" &&
        e.correctionStatus === "requested" &&
        (e.extension?.direction === "worker_request" ||
          e.extension?.direction === "manager_proposal"),
    )
    .sort(compareRecording);
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const requestById = new Map(requests.map((r) => [r.entryId, r]));
  const effective = new Map(effectiveClockEntries(entries).map((entry) => [entry.entryId, entry]));
  const openDates = new Map<string, string>();
  const workDates = new Map<string, string>();
  const workerDays = new Set<string>();
  const times = [...effective.values()].sort(compareEvents);
  const timesByPerson = groupByPerson(times);
  for (const time of times) {
    if (time.entryKind === "in") openDates.set(time.personId, entryDate(time));
    const date = openDates.get(time.personId) ?? entryDate(time);
    workDates.set(recordRoot(time, byId).entryId, date);
    if (isWorkerTime(time)) workerDays.add(`${time.personId}/${date}`);
    if (time.entryKind === "out") openDates.delete(time.personId);
  }
  const replacements = new Set<string>();
  const approvals = new Set<string>();
  const receipts = new Map(commands.map((command) => [command.id, command.input]));
  for (const { input } of commands) {
    if (input.action === "propose" && input.replaces) replacements.add(input.replaces);
    if (input.action === "approve") approvals.add(input.itemId);
  }
  const assigned = new Set<string>();
  const groups: { id: string; requests: TimeEntryRecord[]; fullDay?: boolean }[] = [];
  for (const command of commands) {
    const fullDay = command.input.action === "propose" && command.input.date !== undefined;
    if (
      (command.action !== "request" && command.action !== "propose") ||
      (!fullDay && command.entryIds.length !== 2) ||
      new Set(command.entryIds).size !== command.entryIds.length
    )
      continue;
    const members = command.entryIds.map((id) => requestById.get(id));
    if (members.some((r) => !r || assigned.has(r.entryId) || r.personId !== command.personId))
      continue;
    const pair = members as TimeEntryRecord[];
    const statuses = pair.map((r) => responses(entries, r).at(-1)?.correctionStatus);
    if (new Set(statuses).size !== 1) continue;
    groups.push({ id: command.id, requests: pair, fullDay });
    pair.forEach((r) => assigned.add(r.entryId));
  }
  for (const request of requests) {
    if (!assigned.has(request.entryId)) groups.push({ id: request.entryId, requests: [request] });
  }
  groups.sort((a, b) => compareRecording(a.requests[0]!, b.requests[0]!));
  const items = groups.map((group): CorrectionItem => {
    const first = group.requests[0]!;
    const answers = group.requests.flatMap((r) => responses(entries, r)).sort(compareRecording);
    const lastAnswer = answers.at(-1);
    const overtaken = group.requests.some(
      (r) => r.correctsEntryId && !effective.has(r.correctsEntryId),
    );
    const replaced = replacements.has(group.id);
    const settled = lastAnswer?.correctionStatus === "disputed" && approvals.has(group.id);
    const status: CorrectionItem["status"] =
      lastAnswer?.correctionStatus === "approved"
        ? "approved"
        : lastAnswer?.correctionStatus === "declined"
          ? "declined"
          : settled
            ? "settled"
            : replaced
              ? "overtaken"
              : lastAnswer?.correctionStatus === "disputed"
                ? "disputed"
                : overtaken
                  ? "overtaken"
                  : first.extension!.direction === "manager_proposal"
                    ? "waiting-worker"
                    : "waiting-manager";
    const roots = new Set(group.requests.map((r) => recordRoot(r, byId).entryId));
    const input = receipts.get(group.id);
    let workDate = workDates.get(recordRoot(first, byId).entryId);
    const missingKind = first.extension?.missingEntryKind;
    if (workDate === undefined && missingKind && missingKind !== "in") {
      const previous = timesByPerson
        .get(first.personId)
        ?.filter((time) => time.eventAt <= first.eventAt)
        .at(-1);
      if (previous && previous.entryKind !== "out")
        workDate = workDates.get(recordRoot(previous, byId).entryId);
    }
    const date =
      input?.action === "propose" && input.date
        ? input.date
        : workDate !== entryDate(first)
          ? workDate
          : undefined;
    return {
      id: group.id,
      requestEntryIds: group.requests.map((r) => r.entryId),
      personId: first.personId,
      direction: first.extension!.direction!,
      status,
      readyToApply:
        !lastAnswer &&
        !overtaken &&
        !replaced &&
        correctionGroupCanApply(entries, group.requests, group.fullDay),
      responseEntryIds: answers.map((e) => e.entryId),
      changes: group.requests.map((r) => ({
        target: r.correctsEntryId
          ? { entryId: r.correctsEntryId }
          : { missingKind: r.extension!.missingEntryKind! },
        at: r.eventAt,
        offsetMinutes: r.offsetMinutes,
      })),
      reason: first.correctionReason!,
      requestedByPersonId: first.recordedByPersonId!,
      ...(date !== undefined && { date }),
      ...(replaced && { replaced: true }),
      selfApproved: answers.some((e) => e.extension?.selfApproved === true),
      history: entries
        .filter((e) => sameSubject(e, first) && roots.has(recordRoot(e, byId).entryId))
        .sort(compareRecording),
    };
  });
  const byItemId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (item.status !== "disputed") continue;
    let previous = receipts.get(item.id);
    while (previous?.action === "propose" && previous.replaces) {
      const request = byItemId.get(previous.replaces);
      if (request?.direction === "worker_request") {
        const requests = request.requestEntryIds.map((id) => requestById.get(id)!);
        if (correctionGroupCanApply(entries, requests))
          item.workerVersion = { itemId: request.id, changes: request.changes };
        break;
      }
      previous = receipts.get(previous.replaces);
    }
    if (item.workerVersion) continue;
    const retimes = item.changes.filter(({ target }) => "entryId" in target);
    const changes = retimes.flatMap(({ target }) => {
      const time = "entryId" in target ? effective.get(target.entryId) : undefined;
      return time && isWorkerTime(time)
        ? [{ target, at: time.eventAt, offsetMinutes: time.offsetMinutes }]
        : [];
    });
    const first = item.changes[0]!;
    const date = item.date ?? entryDate({ eventAt: first.at, offsetMinutes: first.offsetMinutes });
    if (
      changes.length === retimes.length &&
      (changes.length > 0 || workerDays.has(`${item.personId}/${date}`))
    )
      item.workerVersion = { changes };
  }
  return items;
}
