import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { readOrigin } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import type { TimeEntryRecord } from "./projection.js";
import type { Period } from "./projection.js";
import { AppError } from "@waitron/shared";
import type { PayPeriodSnapshot, TimeRecord } from "./record-types.js";
import { projectTimeRecord } from "./record-projection.js";
import { recordInPeriod } from "./record-period.js";
import { readClosures } from "./pay-period-reads.js";
import "./errors.js";
import { isRecordDate } from "./record-dates.js";
import { compareEvents, liveClockEntries } from "./effective-entries.js";

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
  const closures = await readClosures(tx, { locationId: query.locationId, period: query.period });
  const personId = query.personId;
  return recordInPeriod(
    projectTimeRecord(
      entries,
      personId === undefined
        ? closures
        : closures.map((c) => ({ ...c, snapshot: snapshotOf(c.snapshot, personId) })),
    ),
    query.period,
  );
}

// Correct only while projecting one person's record reads no other person's rows of a closure's
// snapshot: the cut runs before the projection.
function snapshotOf(snapshot: PayPeriodSnapshot, personId: string): PayPeriodSnapshot {
  const ownEntries = snapshot.entries.filter((e) => e.entry.personId === personId);
  const ownIds = new Set(ownEntries.map((e) => e.entry.entryId));
  return {
    sessions: snapshot.sessions.filter((s) => s.personId === personId),
    entries: ownEntries,
    summaries: snapshot.summaries.filter((s) => s.personId === personId),
    markedAutomaticEntryIds: snapshot.markedAutomaticEntryIds.filter((id) => ownIds.has(id)),
  };
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

/**
 * The entry that decides a person's clock state. A chain is one node and one location, and within
 * it a later position is a later write whatever the box's clock said, so each chain's latest direct
 * entry is taken by `sequence_no`; event times are compared only across chains, and against an
 * approved missing-entry correction, which a manager dates rather than the clock. While the clock
 * only moves forward this is the latest entry by `compareEvents`; after a backward step it is still
 * the last one written. Retimes are left out, as the hours projection applies those.
 */
export async function readLatestLiveEntry(
  tx: Transaction,
  personId: string,
  options: { kind?: "in" } = {},
): Promise<TimeEntryRecord | undefined> {
  const directKinds =
    options.kind === undefined
      ? sql`${timeEntries.entryKind} in ('in','out','break_start','break_end')`
      : sql`${timeEntries.entryKind} = ${options.kind}`;
  const missingKind = (column: SQL) =>
    options.kind === undefined ? sql`${column} is not null` : sql`${column} = ${options.kind}`;
  const heads = tx
    .select({
      nodeId: timeEntries.nodeId,
      locationId: timeEntries.locationId,
      sequenceNo: sql<number>`max(${timeEntries.sequenceNo})`.as("head_sequence_no"),
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, personId), directKinds))
    .groupBy(timeEntries.nodeId, timeEntries.locationId)
    .as("heads");
  const direct = await tx
    .select({ entry: timeEntries })
    .from(timeEntries)
    .innerJoin(
      heads,
      and(
        eq(timeEntries.nodeId, heads.nodeId),
        eq(timeEntries.locationId, heads.locationId),
        eq(timeEntries.sequenceNo, heads.sequenceNo),
      ),
    );
  // Keep the full latest instant: the recording tuple resolves simultaneous corrections.
  const corrections = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.personId, personId),
        sql`${timeEntries.entryKind} = 'correction' and ${timeEntries.correctionStatus} = 'approved' and ${timeEntries.correctsEntryId} is null and ${missingKind(sql`${timeEntries.missingEntryKind}`)}`,
        sql`${timeEntries.eventAt} = (select max(recent.event_at) from time_entries recent where recent.person_id = ${personId}
      and recent.entry_kind = 'correction' and recent.correction_status = 'approved' and recent.corrects_entry_id is null and ${missingKind(sql`recent.missing_entry_kind`)})`,
      ),
    );
  return liveClockEntries([...direct.map((r) => r.entry), ...corrections].map(recordFromRow))
    .sort(compareEvents)
    .at(-1);
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
