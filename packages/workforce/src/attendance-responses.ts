import type { AttendanceResponseReceipt, CorrectionItem } from "./attendance-contract.js";
import type { TimeEntryRecord } from "./projection.js";
import { compareRecording, effectiveClockEntries, sameSubject } from "./effective-entries.js";
import { recordRoot } from "./record-projection.js";
import { correctionGroupCanApply } from "./corrections.js";

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
  const effectiveIds = new Set(effectiveClockEntries(entries).map((e) => e.entryId));
  const assigned = new Set<string>();
  const groups: { id: string; requests: TimeEntryRecord[] }[] = [];
  for (const command of commands) {
    if (
      (command.action !== "request" && command.action !== "propose") ||
      command.entryIds.length !== 2 ||
      new Set(command.entryIds).size !== 2
    )
      continue;
    const members = command.entryIds.map((id) => requestById.get(id));
    if (
      members.some(
        (r) =>
          !r ||
          assigned.has(r.entryId) ||
          r.personId !== command.personId ||
          r.locationId !== command.locationId,
      )
    )
      continue;
    const pair = members as TimeEntryRecord[];
    const statuses = pair.map((r) => responses(entries, r).at(-1)?.correctionStatus);
    if (new Set(statuses).size !== 1) continue;
    groups.push({ id: command.id, requests: pair });
    pair.forEach((r) => assigned.add(r.entryId));
  }
  for (const request of requests) {
    if (!assigned.has(request.entryId)) groups.push({ id: request.entryId, requests: [request] });
  }
  groups.sort((a, b) => compareRecording(a.requests[0]!, b.requests[0]!));
  return groups.map((group) => {
    const first = group.requests[0]!;
    const answers = group.requests.flatMap((r) => responses(entries, r)).sort(compareRecording);
    const lastAnswer = answers.at(-1);
    const overtaken = group.requests.some(
      (r) => r.correctsEntryId && !effectiveIds.has(r.correctsEntryId),
    );
    const status: CorrectionItem["status"] =
      lastAnswer?.correctionStatus === "approved"
        ? "approved"
        : lastAnswer?.correctionStatus === "declined"
          ? "declined"
          : lastAnswer?.correctionStatus === "disputed"
            ? "disputed"
            : overtaken
              ? "overtaken"
              : first.extension!.direction === "manager_proposal"
                ? "waiting-worker"
                : "waiting-manager";
    const roots = new Set(group.requests.map((r) => recordRoot(r, byId).entryId));
    return {
      id: group.id,
      requestEntryIds: group.requests.map((r) => r.entryId),
      personId: first.personId,
      locationId: first.locationId,
      direction: first.extension!.direction!,
      status,
      readyToApply: !lastAnswer && !overtaken && correctionGroupCanApply(entries, group.requests),
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
      selfApproved: answers.some((e) => e.extension?.selfApproved === true),
      history: entries
        .filter((e) => sameSubject(e, first) && roots.has(recordRoot(e, byId).entryId))
        .sort(compareRecording),
    };
  });
}
