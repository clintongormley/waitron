import { and, eq } from "drizzle-orm";
import { timeEntries } from "./schema/time-entries.js";
import type { Transaction } from "@waitron/db";
import { AppError, SOURCES, type JobOrigin, type Origin } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { recordInstant } from "./corrections.js";
import { readRecordedEntries } from "./record-reads.js";
import { compareEvents, liveClockEntries, effectiveClockEntries } from "./effective-entries.js";
import { projectWorkSessions } from "./projection.js";
import { readClosures } from "./pay-period-reads.js";
import { appendClosureMarker } from "./pay-period-close.js";
import "./errors.js";

export interface AutomaticCloseInput {
  nodeId: string;
  personId: string;
  locationId: string;
  openEntryId: string;
  at: string;
  offsetMinutes: number;
  origin: JobOrigin;
}
export interface AutomaticConfirmationInput {
  nodeId: string;
  entryId: string;
  workerPersonId: string;
  origin: Origin;
}
export async function recordAutomaticClose(
  tx: Transaction,
  input: AutomaticCloseInput,
): Promise<string> {
  const eventAt = recordInstant(input.at, input.offsetMinutes, "attendance");
  if (
    input.origin === null ||
    typeof input.origin !== "object" ||
    (input.origin as Origin).source === "device" ||
    input.origin.deviceId !== null ||
    !SOURCES.includes(input.origin.source)
  )
    throw new AppError("attendance.invalid", { reason: "automatic_origin" });
  const entries = await readRecordedEntries(tx, { personId: input.personId });
  const live = liveClockEntries(entries).sort(compareEvents);
  const open = live.find((e) => e.entryId === input.openEntryId);
  const after = open === undefined ? [] : live.slice(live.indexOf(open) + 1);
  if (
    open === undefined ||
    open.entryKind !== "in" ||
    open.locationId !== input.locationId ||
    after.some((e) => e.entryKind === "in" || e.entryKind === "out") ||
    live.at(-1)!.locationId !== input.locationId
  )
    throw new AppError("attendance.not_pending", { entryId: input.openEntryId });
  const effectiveLatest = effectiveClockEntries(entries)
    .filter((e) => e.locationId === input.locationId)
    .sort(compareEvents)
    .at(-1)!;
  if (
    eventAt <= open.eventAt ||
    (effectiveLatest.entryKind === "in"
      ? eventAt <= effectiveLatest.eventAt
      : eventAt < effectiveLatest.eventAt) ||
    eventAt < live.at(-1)!.eventAt
  )
    throw new AppError("attendance.invalid", { reason: "no_later_activity" });
  const { id } = await appendToChain(
    tx,
    { nodeId: input.nodeId, locationId: input.locationId },
    {
      personId: input.personId,
      entryKind: "out",
      eventAt,
      eventOffsetMinutes: input.offsetMinutes,
      recordedByPersonId: null,
      origin: input.origin,
      extension: {
        authorKind: "automatic",
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    },
  );
  const afterEntries = await readRecordedEntries(tx, {
    personId: input.personId,
    locationId: input.locationId,
  });
  const end = afterEntries.find((e) => e.entryId === id)!;
  const session = projectWorkSessions(afterEntries).find((s) => s.endedAt === eventAt);
  if (session !== undefined) {
    const next = new Date(`${session.workDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const [closure] = await readClosures(tx, {
      locationId: input.locationId,
      period: { start: session.workDate, end: next.toISOString().slice(0, 10) },
    });
    if (closure !== undefined)
      await appendClosureMarker(tx, input.nodeId, end, closure.id, input.origin);
  }
  return id;
}
export async function confirmAutomaticEntry(
  tx: Transaction,
  input: AutomaticConfirmationInput,
): Promise<string> {
  const [target] = await readRecordedEntries(tx, { entryId: input.entryId });
  if (target === undefined)
    throw new AppError("attendance.not_pending", { entryId: input.entryId });
  if (target.personId !== input.workerPersonId)
    throw new AppError("attendance.not_permitted", { personId: input.workerPersonId });
  const [answer] = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.personId, input.workerPersonId),
        eq(timeEntries.entryKind, "confirmation"),
        eq(timeEntries.authorKind, "worker"),
        eq(timeEntries.respondsToEntryId, input.entryId),
      ),
    )
    .limit(1);
  if (
    target.entryKind !== "out" ||
    target.extension?.authorKind !== "automatic" ||
    answer !== undefined
  )
    throw new AppError("attendance.not_pending", { entryId: input.entryId });
  const { id } = await appendToChain(
    tx,
    { nodeId: input.nodeId, locationId: target.locationId },
    {
      personId: target.personId,
      entryKind: "confirmation",
      eventAt: target.eventAt,
      eventOffsetMinutes: target.offsetMinutes,
      recordedByPersonId: input.workerPersonId,
      origin: input.origin,
      extension: {
        authorKind: "worker",
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: target.entryId,
        payPeriodClosureId: null,
      },
    },
  );
  return id;
}
