import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { readOrigin } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import type { TimeEntryRecord } from "./projection.js";

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
