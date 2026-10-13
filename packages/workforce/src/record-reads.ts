import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { readOrigin } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import type { TimeEntryRecord } from "./projection.js";
import type { Period } from "./projection.js";
import { AppError } from "@waitron/shared";
import type { TimeRecord } from "./record-types.js";
import { projectTimeRecord, recordRoot } from "./record-projection.js";
import "./errors.js";
import { isRecordDate } from "./record-dates.js";
import { compareEvents, effectiveClockEntries } from "./effective-entries.js";
import type { WorkSession } from "./projection.js";

export interface TimeRecordQuery {
  period: Period;
  personId?: string;
  locationId?: string;
}
export async function readTimeRecord(
  tx: Database | Transaction,
  query: TimeRecordQuery,
): Promise<TimeRecord> {
  if (
    (!query.personId && !query.locationId) ||
    [query.personId, query.locationId].some(
      (v) => v !== undefined && (typeof v !== "string" || !v),
    ) ||
    query.period === null ||
    typeof query.period !== "object" ||
    !isRecordDate(query.period.start) ||
    !isRecordDate(query.period.end) ||
    query.period.start >= query.period.end
  )
    throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
  const entries = await readRecordedEntries(tx, query);
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const roots = new Set(
    entries
      .filter((e) => {
        const date = new Date(Date.parse(e.eventAt) + e.offsetMinutes * 60000)
          .toISOString()
          .slice(0, 10);
        return date >= query.period.start && date < query.period.end;
      })
      .map((e) => recordRoot(e, byId).entryId),
  );
  const record = projectTimeRecord(entries);
  record.sessions = record.sessions.filter(
    (s) => s.workDate >= query.period.start && s.workDate < query.period.end,
  );
  const sessionsBySubject = new Map<string, { sessions: WorkSession[]; index: number }>();
  for (const session of record.sessions) {
    const key = JSON.stringify([session.personId, session.locationId]);
    const group = sessionsBySubject.get(key) ?? { sessions: [], index: 0 };
    group.sessions.push(session);
    sessionsBySubject.set(key, group);
  }
  for (const clockEntry of effectiveClockEntries(entries).sort(compareEvents)) {
    const group = sessionsBySubject.get(
      JSON.stringify([clockEntry.personId, clockEntry.locationId]),
    );
    if (group === undefined) continue;
    while (
      group.index < group.sessions.length &&
      clockEntry.eventAt > group.sessions[group.index]!.endedAt
    )
      group.index++;
    const session = group.sessions[group.index];
    if (
      session !== undefined &&
      clockEntry.eventAt >= session.startedAt &&
      clockEntry.eventAt <= session.endedAt
    )
      roots.add(recordRoot(clockEntry, byId).entryId);
  }
  record.entries = record.entries.filter((row) => roots.has(recordRoot(row.entry, byId).entryId));
  return record;
}

export async function readRecordedEntries(
  tx: Database | Transaction,
  scope: { personId?: string; locationId?: string },
): Promise<TimeEntryRecord[]> {
  const rows = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        scope.personId === undefined ? undefined : eq(timeEntries.personId, scope.personId),
        scope.locationId === undefined ? undefined : eq(timeEntries.locationId, scope.locationId),
      ),
    );
  return rows.map((row) => ({
    entryId: row.id,
    personId: row.personId,
    locationId: row.locationId,
    nodeId: row.nodeId,
    entryKind: row.entryKind,
    eventAt: row.eventAt,
    offsetMinutes: row.eventOffsetMinutes,
    recordedAt: row.recordedAt,
    sequenceNo: row.sequenceNo,
    recordedByPersonId: row.recordedByPersonId,
    origin: readOrigin(row.capturedBySource, row.capturedByDeviceId),
    correctsEntryId: row.correctsEntryId,
    correctionStatus: row.correctionStatus,
    correctionReason: row.correctionReason,
    correctionActorId: row.correctionActorId,
    extension: [
      row.authorKind,
      row.correctionDirection,
      row.missingEntryKind,
      row.respondsToEntryId,
      row.payPeriodClosureId,
    ].every((v) => v === null)
      ? null
      : {
          authorKind: row.authorKind,
          direction: row.correctionDirection,
          missingEntryKind: row.missingEntryKind,
          respondsToEntryId: row.respondsToEntryId,
          payPeriodClosureId: row.payPeriodClosureId,
        },
  }));
}
