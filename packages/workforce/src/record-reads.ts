import type { PaidBreakPolicy } from "./ruleset.js";
import { and, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { nodes, type Database, type Transaction } from "@waitron/db";
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
}
export async function readTimeRecord(
  tx: Database | Transaction,
  query: TimeRecordQuery,
  policy: PaidBreakPolicy | null = null,
): Promise<TimeRecord> {
  if (
    (query.personId !== undefined && (typeof query.personId !== "string" || !query.personId)) ||
    query.period === null ||
    typeof query.period !== "object" ||
    !isRecordDate(query.period.start) ||
    !isRecordDate(query.period.end) ||
    query.period.start >= query.period.end
  )
    throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
  const closures = await readClosures(tx, { period: query.period });
  const personId = query.personId;
  const period = { ...query.period };
  for (const closure of closures) {
    if (closure.period.start < period.start) period.start = closure.period.start;
    if (closure.period.end > period.end) period.end = closure.period.end;
  }
  const entries = await readPeriodEntries(tx, { period, personId });
  return recordInPeriod(
    projectTimeRecord(
      entries,
      personId === undefined
        ? closures
        : closures.map((c) => ({ ...c, snapshot: snapshotOf(c.snapshot, personId) })),
      policy,
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
  scope: { personId?: string; entryId?: string },
): Promise<TimeEntryRecord[]> {
  const rows = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        scope.entryId === undefined ? undefined : eq(timeEntries.id, scope.entryId),
        scope.personId === undefined ? undefined : eq(timeEntries.personId, scope.personId),
      ),
    );
  return rows.map(recordFromRow);
}

const OFFSET_MARGIN_MS = 14 * 60 * 60 * 1000;
const FIRST_EVENT_AT = "0000-01-01T00:00:00.000Z";
const LAST_EVENT_AT = "9999-12-31T23:59:59.000Z";

const unretimedAnchor = sql`not exists (
  select 1 from time_entries corrected indexed by time_entries_corrects_entry_idx
  where corrected.corrects_entry_id = anchor.id and corrected.person_id = anchor.person_id
    and corrected.entry_kind = 'correction' and corrected.correction_status = 'approved'
)`;
const seedColumns = sql`seed.id, seed.person_id, seed.event_at, seed.corrects_entry_id, seed.responds_to_entry_id`;

function entryFamily(seed: SQL): SQL {
  return sql`family(id, person_id, event_at, corrects_entry_id, responds_to_entry_id) as (
  ${seed}
  union
  select parent.id, parent.person_id, parent.event_at, parent.corrects_entry_id, parent.responds_to_entry_id
  from family join time_entries parent
    on parent.id in (family.corrects_entry_id, family.responds_to_entry_id)
    and parent.person_id = family.person_id
  union
  select correction.id, correction.person_id, correction.event_at,
    correction.corrects_entry_id, correction.responds_to_entry_id
  from family join time_entries correction indexed by time_entries_corrects_entry_idx
    on correction.corrects_entry_id = family.id and correction.person_id = family.person_id
  union
  select response.id, response.person_id, response.event_at,
    response.corrects_entry_id, response.responds_to_entry_id
  from family join time_entries response indexed by time_entries_person_event_idx
    on response.person_id = family.person_id and response.event_at = family.event_at
    and response.responds_to_entry_id = family.id
)`;
}

async function readSelectedEntries(
  tx: Database | Transaction,
  selected: SQL,
): Promise<TimeEntryRecord[]> {
  const rows = await tx
    .select()
    .from(timeEntries)
    .where(sql`${timeEntries.id} in (${selected})`)
    .orderBy(sql`time_entries.rowid`);
  return rows.map(recordFromRow);
}

/** Filter projected sessions by the requested work dates. Rows outside the period supply context. */
export async function readPeriodEntries(
  tx: Database | Transaction,
  { period, personId }: TimeRecordQuery,
): Promise<TimeEntryRecord[]> {
  if (!isRecordDate(period.start) || !isRecordDate(period.end))
    return readRecordedEntries(tx, { personId });
  const from = new Date(
    Math.max(Date.parse(FIRST_EVENT_AT), Date.parse(period.start) - OFFSET_MARGIN_MS),
  ).toISOString();
  const until = new Date(Date.parse(period.end) + OFFSET_MARGIN_MS).toISOString();
  const people = personId === undefined ? sql`select id from persons` : sql`select ${personId}`;

  // A shift belongs to its start's local date, so it cannot start before the offset margin.
  // A later unretimed clock-in resets the projection. Keep every event at that instant.
  const later = sql`(
    select anchor.event_at from time_entries anchor indexed by time_entries_person_event_idx
    where anchor.person_id = people.person_id and anchor.entry_kind = 'in' and anchor.event_at >= ${until}
      and ${unretimedAnchor}
    order by anchor.event_at limit 1
  )`;

  // A retime may move either endpoint out of the seed window. Decisions and confirmations
  // copy the entry they answer's event time, so their inverse lookup can use person and time.
  const selected = sql`
    with recursive
    people(person_id) as (${people}),
    bounds as materialized (
      select person_id, coalesce(${later}, ${LAST_EVENT_AT}) as last_at
      from people
    ),
    ${entryFamily(sql`
      select ${seedColumns}
      from bounds cross join time_entries seed indexed by time_entries_person_event_idx
      where seed.person_id = bounds.person_id and seed.event_at between ${from} and bounds.last_at
    `)}
    select id from family
  `;
  return readSelectedEntries(tx, selected);
}

export async function readOutstandingHoursEntries(
  tx: Transaction,
  {
    personId,
    questionWindows,
    questionEntryIds,
  }: {
    personId: string;
    questionWindows: readonly (readonly [string, string])[];
    questionEntryIds: readonly string[];
  },
): Promise<TimeEntryRecord[]> {
  // Checking whether an undecided correction is ready still needs the full sequence.
  const undecided = tx.execute(sql`
    select 1 from time_entries request indexed by time_entries_person_event_idx
    where request.person_id = ${personId} and request.entry_kind = 'correction'
      and request.correction_status = 'requested'
      and request.correction_direction in ('worker_request', 'manager_proposal')
      and not exists (
        select 1 from time_entries decision indexed by time_entries_person_event_idx
        where decision.person_id = request.person_id and decision.event_at = request.event_at
          and decision.entry_kind = 'correction' and decision.correction_status <> 'requested'
          and decision.responds_to_entry_id = request.id
      )
    limit 1
  `).rows;
  if (undecided.length > 0) return readRecordedEntries(tx, { personId });

  // An unretimed direct in or out resets open shifts. Keep every event at its instant.
  const latest = sql`(
    select anchor.event_at from time_entries anchor indexed by time_entries_person_event_idx
    where anchor.person_id = ${personId} and anchor.entry_kind in ('in', 'out')
      and ${unretimedAnchor}
    order by anchor.event_at desc limit 1
  )`;
  const seeds = sql`
    select ${seedColumns}
    from time_entries seed indexed by time_entries_person_event_idx
    where seed.person_id = ${personId} and seed.event_at >= coalesce(${latest}, ${FIRST_EVENT_AT})
    union
    select ${seedColumns}
    from time_entries seed indexed by time_entries_person_event_idx
    where seed.person_id = ${personId}
      and (
        (seed.entry_kind = 'out' and seed.author_kind = 'automatic' and not exists (
          select 1 from time_entries confirmation indexed by time_entries_person_event_idx
          where confirmation.person_id = seed.person_id and confirmation.event_at = seed.event_at
            and confirmation.entry_kind = 'confirmation' and confirmation.author_kind = 'worker'
            and confirmation.responds_to_entry_id = seed.id
        ))
        or (seed.entry_kind = 'correction' and seed.correction_status = 'disputed'
          and seed.responds_to_entry_id is not null)
      )
    union
    select ${seedColumns}
    from json_each(${JSON.stringify(questionWindows)}) question
    cross join time_entries seed indexed by time_entries_person_event_idx
    where seed.person_id = ${personId}
      and seed.event_at >= json_extract(question.value, '$[0]')
      and seed.event_at < json_extract(question.value, '$[1]')
    union
    select ${seedColumns}
    from json_each(${JSON.stringify(questionEntryIds)}) reference
    cross join time_entries seed
    where seed.id = reference.value and seed.person_id = ${personId}
  `;
  return readSelectedEntries(tx, sql`with recursive ${entryFamily(seeds)} select id from family`);
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
    .from(nodes)
    .innerJoin(
      timeEntries,
      eq(
        timeEntries.id,
        sql`(select head.id from time_entries head where head.person_id = ${personId}
          and head.node_id = ${nodes.id}
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
