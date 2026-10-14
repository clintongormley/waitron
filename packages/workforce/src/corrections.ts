import { eq, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, jobOrigin, type Origin } from "@waitron/shared";
import { assertLocationExists, assertPersonExists } from "./body-ids.js";
import { appendToChain } from "./chain.js";
import { readRecordedEntries } from "./record-reads.js";
import { compareEvents, effectiveClockEntries, isClockEntry } from "./effective-entries.js";
import type { ClockEntryKind, RecordExtension } from "./record-types.js";
import type { CorrectionStatus, TimeEntryRecord } from "./projection.js";
import { timeEntries } from "./schema/time-entries.js";
import "./errors.js";

export type CorrectionTarget =
  | { correctsEntryId: string }
  | { personId: string; locationId: string; missingEntryKind: ClockEntryKind };
export type CorrectionRequestInput = CorrectionTarget & {
  nodeId: string;
  at: string;
  offsetMinutes: number;
  reason: string;
  actorPersonId: string;
  origin: Origin;
};
export interface CorrectionApprovalInput {
  nodeId: string;
  correctionId: string;
  approverPersonId: string;
}
export interface CorrectionDecisionInput {
  nodeId: string;
  correctionId: string;
  actorPersonId: string;
  origin: Origin;
  reason?: string;
}
export const MANAGER_ROLES = new Set(["supervisor", "manager", "admin"]);
export async function roleOf(tx: Transaction, personId: string): Promise<string | undefined> {
  const { rows } = await tx.execute<{ role: string }>(
    sql`select role from persons where id=${personId}`,
  );
  return rows[0]?.role;
}
export async function authorKindFor(
  tx: Transaction,
  recorder: string,
  subject: string,
): Promise<"worker" | "manager"> {
  await assertPersonExists(tx, recorder, "recordedByPersonId");
  return recorder === subject
    ? "worker"
    : MANAGER_ROLES.has((await roleOf(tx, recorder))!)
      ? "manager"
      : "worker";
}
export function recordInstant(
  at: string,
  offsetMinutes: number,
  domain: "correction" | "attendance",
): string {
  const refuse = () => {
    throw new AppError(domain === "correction" ? "correction.invalid" : "attendance.invalid", {
      reason: "invalid_time",
    });
  };
  if (
    typeof at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(at) ||
    !Number.isInteger(offsetMinutes) ||
    Math.abs(offsetMinutes) > 840
  )
    refuse();
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) refuse();
  const date = at.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date)
    refuse();
  const instant = new Date(Math.floor(ms / 1000) * 1000).toISOString();
  if (!/^\d{4}-/.test(instant)) refuse();
  return instant;
}
function reasonFor(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim())
    throw new AppError("correction.invalid", { reason: "blank_reason" });
  return reason.trim();
}
export async function recordEntryById(tx: Transaction, id: string): Promise<TimeEntryRecord> {
  const [row] = await tx
    .select({ personId: timeEntries.personId })
    .from(timeEntries)
    .where(eq(timeEntries.id, id));
  if (row === undefined) throw new AppError("correction.target_not_found", { entryId: id });
  return (await readRecordedEntries(tx, { personId: row.personId })).find((e) => e.entryId === id)!;
}
function correctionInvalid(reason: string): never {
  throw new AppError("correction.invalid", { reason });
}
function validateSequence(entries: readonly TimeEntryRecord[]): void {
  let state: "out" | "working" | "on_break" = "out";
  for (const e of [...entries].sort(compareEvents)) {
    if (e.entryKind === "in") {
      if (state !== "out") correctionInvalid("duplicate_in");
      state = "working";
    }
    if (e.entryKind === "out") {
      if (state === "out") correctionInvalid("unmatched_out");
      state = "out";
    }
    if (e.entryKind === "break_start") {
      if (state !== "working") correctionInvalid("unmatched_break_start");
      state = "on_break";
    }
    if (e.entryKind === "break_end") {
      if (state !== "on_break") correctionInvalid("unmatched_break_end");
      state = "working";
    }
  }
}
function validateChange(
  entries: readonly TimeEntryRecord[],
  change: TimeEntryRecord,
  settling: boolean,
): void {
  const effective = effectiveClockEntries(entries).filter((e) => e.personId === change.personId);
  if (change.correctsEntryId) {
    const target = effective.find((e) => e.entryId === change.correctsEntryId);
    if (target === undefined)
      throw new AppError("correction.not_pending", { correctionId: change.entryId });
    validateSequence(
      effective.map((e) =>
        e === target ? { ...e, eventAt: change.eventAt, offsetMinutes: change.offsetMinutes } : e,
      ),
    );
  } else {
    if (!settling && effective.length === 0 && change.extension?.missingEntryKind !== "in") return;
    const candidate = { ...change, entryKind: change.extension!.missingEntryKind! };
    try {
      validateSequence([...effective, candidate]);
    } catch (error) {
      if (settling) throw error;
      const counterpart =
        candidate.entryKind === "break_end"
          ? "break_start"
          : candidate.entryKind === "out" || candidate.entryKind === "break_start"
            ? "in"
            : null;
      const pending = entries
        .filter(
          (e) =>
            e.entryKind === "correction" &&
            e.correctionStatus === "requested" &&
            e.personId === change.personId &&
            e.locationId === change.locationId &&
            !e.correctsEntryId &&
            e.extension?.missingEntryKind === counterpart &&
            e.eventAt < change.eventAt,
        )
        .sort(compareEvents)
        .at(-1);
      if (pending === undefined) throw error;
      validateSequence([...effective, { ...pending, entryKind: counterpart! }, candidate]);
    }
  }
}
export async function requestCorrection(
  tx: Transaction,
  input: CorrectionRequestInput,
  explicitProposal = false,
): Promise<string> {
  const eventAt = recordInstant(input.at, input.offsetMinutes, "correction");
  const reason = reasonFor(input.reason);
  await assertPersonExists(tx, input.actorPersonId, "actorPersonId");
  const isManager = MANAGER_ROLES.has((await roleOf(tx, input.actorPersonId))!);
  if (explicitProposal && !isManager)
    throw new AppError("correction.not_permitted", { personId: input.actorPersonId });
  let personId: string,
    locationId: string,
    correctsEntryId: string | null,
    missingEntryKind: ClockEntryKind | null;
  if ("correctsEntryId" in input) {
    if (
      "personId" in input ||
      "locationId" in input ||
      "missingEntryKind" in input ||
      typeof input.correctsEntryId !== "string"
    )
      correctionInvalid("mixed_target");
    const target = await recordEntryById(tx, input.correctsEntryId);
    if (
      !isClockEntry(target) &&
      !(target.entryKind === "correction" && target.correctionStatus === "approved")
    )
      correctionInvalid("invalid_target_kind");
    ({ personId, locationId } = target);
    correctsEntryId = target.entryId;
    missingEntryKind = null;
  } else {
    if (
      typeof input.personId !== "string" ||
      typeof input.locationId !== "string" ||
      !["in", "out", "break_start", "break_end"].includes(input.missingEntryKind)
    )
      correctionInvalid("missing_target_shape");
    ({ personId, locationId, missingEntryKind } = input);
    correctsEntryId = null;
    await assertPersonExists(tx, personId, "personId");
    await assertLocationExists(tx, locationId);
  }
  if (
    (!isManager && input.actorPersonId !== personId) ||
    (explicitProposal && input.actorPersonId === personId)
  )
    throw new AppError("correction.not_permitted", { personId: input.actorPersonId });
  const managerProposal = isManager && input.actorPersonId !== personId;
  const extension: RecordExtension = {
    authorKind: managerProposal ? "manager" : "worker",
    direction: managerProposal ? "manager_proposal" : "worker_request",
    missingEntryKind,
    respondsToEntryId: null,
    payPeriodClosureId: null,
  };
  const change: TimeEntryRecord = {
    entryId: "pending",
    personId,
    locationId,
    nodeId: input.nodeId,
    entryKind: "correction",
    eventAt,
    offsetMinutes: input.offsetMinutes,
    recordedAt: eventAt,
    sequenceNo: 0,
    correctsEntryId,
    extension,
  };
  validateChange(await readRecordedEntries(tx, { personId }), change, false);
  const { id } = await appendToChain(
    tx,
    { nodeId: input.nodeId, locationId },
    {
      personId,
      entryKind: "correction",
      eventAt,
      eventOffsetMinutes: input.offsetMinutes,
      recordedByPersonId: input.actorPersonId,
      origin: input.origin,
      correctsEntryId,
      correctionReason: reason,
      correctionStatus: "requested",
      correctionActorId: input.actorPersonId,
      extension,
    },
  );
  return id;
}
export async function decideCorrection(
  tx: Transaction,
  input: CorrectionDecisionInput,
  action: "approve" | "accept" | "disagree" | "decline",
): Promise<string> {
  const request = await recordEntryById(tx, input.correctionId);
  const entries = await readRecordedEntries(tx, { personId: request.personId });
  if (
    request.entryKind !== "correction" ||
    request.correctionStatus !== "requested" ||
    entries.some((e) => e.extension?.respondsToEntryId === request.entryId) ||
    (request.correctsEntryId &&
      entries.some(
        (e) => e.correctsEntryId === request.correctsEntryId && e.correctionStatus === "approved",
      ))
  )
    throw new AppError("correction.not_pending", { correctionId: input.correctionId });
  const managerAction = action === "approve" || action === "decline";
  const role = managerAction ? await roleOf(tx, input.actorPersonId) : undefined;
  const selfApproved =
    action === "approve" &&
    role === "admin" &&
    input.actorPersonId === request.personId &&
    input.actorPersonId === request.recordedByPersonId;
  const permitted = managerAction
    ? request.extension?.direction === "worker_request" &&
      MANAGER_ROLES.has(role!) &&
      (input.actorPersonId !== request.recordedByPersonId || selfApproved)
    : request.extension?.direction === "manager_proposal" &&
      input.actorPersonId === request.personId &&
      input.actorPersonId !== request.recordedByPersonId;
  if (!permitted) throw new AppError("correction.not_permitted", { personId: input.actorPersonId });
  const reason = action === "disagree" ? reasonFor(input.reason) : request.correctionReason!;
  const status: CorrectionStatus =
    action === "disagree" ? "disputed" : action === "decline" ? "declined" : "approved";
  if (status === "approved") validateChange(entries, request, true);
  const { id } = await appendToChain(
    tx,
    { nodeId: input.nodeId, locationId: request.locationId },
    {
      personId: request.personId,
      entryKind: "correction",
      eventAt: request.eventAt,
      eventOffsetMinutes: request.offsetMinutes,
      recordedByPersonId: input.actorPersonId,
      origin: input.origin,
      correctsEntryId: request.correctsEntryId ?? null,
      correctionReason: reason,
      correctionStatus: status,
      correctionActorId: input.actorPersonId,
      extension: {
        ...request.extension!,
        selfApproved,
        authorKind: managerAction ? "manager" : "worker",
        respondsToEntryId: request.entryId,
      },
    },
  );
  return id;
}
export function approveCorrection(
  tx: Transaction,
  input: CorrectionApprovalInput,
): Promise<string> {
  return decideCorrection(
    tx,
    {
      nodeId: input.nodeId,
      correctionId: input.correctionId,
      actorPersonId: input.approverPersonId,
      origin: jobOrigin("dashboard"),
    },
    "approve",
  );
}
