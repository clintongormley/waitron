import { and, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { readOrigin } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";
import { workforceChains } from "./schema/workforce-chains.js";
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
 * The entry that decides a person's clock state. Within a node a later position is a later write,
 * whatever the box's clock said, so each node's latest direct entry is taken by `sequence_no`. Event
 * times are compared only across nodes, and against an approved missing-entry correction, whose time
 * the person requesting it chose; such a correction written before a later direct entry of the kind
 * asked for on its node no longer decides. Retimes are left out, as the hours projection applies
 * those.
 */
export async function readLatestLiveEntry(
  tx: Transaction,
  personId: string,
  options: { kind?: "in" } = {},
): Promise<TimeEntryRecord | undefined> {
  const directKind = (column: SQL) =>
    options.kind === undefined
      ? sql`${column} in ('in','out','break_start','break_end')`
      : sql`${column} = ${options.kind}`;
  const missingKind = (column: SQL) =>
    options.kind === undefined ? sql`${column} is not null` : sql`${column} = ${options.kind}`;
  const followedByDirect = (node: SQLWrapper, sequence: SQLWrapper) =>
    sql`exists (select 1 from time_entries later where later.person_id = ${personId}
      and later.node_id = ${node} and later.sequence_no > ${sequence}
      and ${directKind(sql`later.entry_kind`)})`;
  const heads = await tx
    .select({ entry: timeEntries })
    .from(workforceChains)
    .innerJoin(
      timeEntries,
      eq(
        timeEntries.id,
        sql`(select head.id from time_entries head where head.person_id = ${personId}
          and head.node_id = ${workforceChains.nodeId}
          and ${directKind(sql`head.entry_kind`)} order by head.sequence_no desc limit 1)`,
      ),
    );
  const direct = heads
    .map((r) => recordFromRow(r.entry))
    .sort(compareEvents)
    .at(-1);
  // A correction decides only if it sorts after `direct`, so none dated before it is read. Keep the
  // full latest instant: the recording tuple resolves simultaneous corrections.
  const since = direct === undefined ? sql`` : sql`and recent.event_at >= ${direct.eventAt}`;
  const corrections = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.personId, personId),
        sql`${timeEntries.entryKind} = 'correction' and ${timeEntries.correctionStatus} = 'approved' and ${timeEntries.correctsEntryId} is null and ${missingKind(sql`${timeEntries.missingEntryKind}`)}`,
        sql`not ${followedByDirect(timeEntries.nodeId, timeEntries.sequenceNo)}`,
        sql`${timeEntries.eventAt} = (select max(recent.event_at) from time_entries recent where recent.person_id = ${personId} ${since}
      and recent.entry_kind = 'correction' and recent.correction_status = 'approved' and recent.corrects_entry_id is null and ${missingKind(sql`recent.missing_entry_kind`)}
      and not ${followedByDirect(sql`recent.node_id`, sql`recent.sequence_no`)})`,
      ),
    );
  return liveClockEntries([...(direct ? [direct] : []), ...corrections.map(recordFromRow)])
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
