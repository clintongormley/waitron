import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { readOrigin } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import type { TimeEntryRecord } from "./projection.js";
import type { Period } from "./projection.js";
import { AppError } from "@waitron/shared";
import type { TimeRecord } from "./record-types.js";
import { projectTimeRecord } from "./record-projection.js";
import { recordInPeriod } from "./record-period.js";
import { readClosures } from "./pay-period-reads.js";
import "./errors.js";
import { isRecordDate } from "./record-dates.js";

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
  const entries = await readRecordedEntries(tx, {
    locationId: query.locationId,
    personId: query.personId,
  });
  const closures = await readClosures(tx, query);
  const record = recordInPeriod(projectTimeRecord(entries, closures), query.period);
  if (query.personId !== undefined) {
    const personId = query.personId;
    record.sessions = record.sessions.filter((s) => s.personId === personId);
    record.entries = record.entries.filter((e) => e.entry.personId === personId);
    record.closedPeriodImpacts = record.closedPeriodImpacts.filter((i) => i.personId === personId);
    record.closures = record.closures.map((closure) => {
      const snapshot = closure.snapshot;
      const ownEntries = snapshot.entries.filter((e) => e.entry.personId === personId);
      const ownIds = new Set(ownEntries.map((e) => e.entry.entryId));
      return {
        ...closure,
        snapshot: {
          sessions: snapshot.sessions.filter((s) => s.personId === personId),
          entries: ownEntries,
          summaries: snapshot.summaries.filter((s) => s.personId === personId),
          markedAutomaticEntryIds: snapshot.markedAutomaticEntryIds.filter((id) => ownIds.has(id)),
        },
      };
    });
  }
  return record;
}

export async function readRecordedEntries(
  tx: Database | Transaction,
  scope: { personId?: string; locationId?: string; entryId?: string },
): Promise<TimeEntryRecord[]> {
  const rows = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        scope.entryId === undefined ? undefined : eq(timeEntries.id, scope.entryId),
        scope.personId === undefined ? undefined : eq(timeEntries.personId, scope.personId),
        scope.locationId === undefined ? undefined : eq(timeEntries.locationId, scope.locationId),
      ),
    );
  return rows.map(recordFromRow);
}

export async function readLatestLiveEntries(
  tx: Transaction,
  personId: string,
): Promise<TimeEntryRecord[]> {
  // Keep the full latest instant: the recording tuple resolves simultaneous live events.
  const rows = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.personId, personId),
        sql`(${timeEntries.entryKind} in ('in','out','break_start','break_end') or (${timeEntries.entryKind} = 'correction' and ${timeEntries.correctionStatus} = 'approved' and ${timeEntries.correctsEntryId} is null and ${timeEntries.missingEntryKind} is not null))`,
        sql`${timeEntries.eventAt} = (select max(recent.event_at) from time_entries recent where recent.person_id = ${personId}
      and (recent.entry_kind in ('in','out','break_start','break_end') or (recent.entry_kind = 'correction' and recent.correction_status = 'approved' and recent.corrects_entry_id is null and recent.missing_entry_kind is not null)))`,
      ),
    );
  return rows.map(recordFromRow);
}

function recordFromRow(row: typeof timeEntries.$inferSelect): TimeEntryRecord {
  return {
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
    extension:
      !row.selfApproved &&
      [
        row.authorKind,
        row.correctionDirection,
        row.missingEntryKind,
        row.respondsToEntryId,
        row.payPeriodClosureId,
      ].every((v) => v === null)
        ? null
        : {
            selfApproved: row.selfApproved,
            authorKind: row.authorKind,
            direction: row.correctionDirection,
            missingEntryKind: row.missingEntryKind,
            respondsToEntryId: row.respondsToEntryId,
            payPeriodClosureId: row.payPeriodClosureId,
          },
  };
}
