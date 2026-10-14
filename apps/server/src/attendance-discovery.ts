import "./errors.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { billPayments, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, businessDayAt, businessDayBounds } from "@waitron/shared";
import {
  attendanceDayWork,
  attendanceSourceState,
  attendanceOperationFacts,
  enqueueAttendanceDay,
  retireObsoleteRotaQuestions,
  processAttendanceDay,
  timeEntries,
  type AttendanceDay,
} from "@waitron/workforce";

import { recordAttendanceFact } from "./attendance-capture.js";
import { discoverIntegratedAttendance } from "./attendance-integrated.js";
import { readAttendanceFacts, readPlannedAttendanceShifts } from "./attendance-facts.js";
import { readTillClockState } from "./till-clock-state.js";

export async function reconcileAttendanceBeforeClock(
  tx: Transaction,
  scope: { nodeId: string; locationId: string; personId: string },
  at: Date,
): Promise<void> {
  const state = await readTillClockState(tx, scope, at);
  if (state.state === "out" || state.activeLocationId !== scope.locationId) return;
  const [start] = await tx
    .select({ eventAt: timeEntries.eventAt })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.personId, scope.personId),
        sql`(${timeEntries.entryKind} = 'in' or (${timeEntries.entryKind} = 'correction'
        and ${timeEntries.correctionStatus} = 'approved' and ${timeEntries.correctsEntryId} is null
        and ${timeEntries.missingEntryKind} = 'in'))`,
      ),
    )
    .orderBy(
      desc(timeEntries.eventAt),
      desc(timeEntries.recordedAt),
      desc(timeEntries.nodeId),
      desc(timeEntries.sequenceNo),
      desc(timeEntries.id),
    )
    .limit(1);
  if (!start) return;
  const clock = await readLocationClock(tx, scope.locationId);
  const businessDay = businessDayAt(clock, new Date(start.eventAt));
  const day = {
    locationId: scope.locationId,
    businessDay,
    ...businessDayBounds(clock, businessDay),
  };
  if (Date.parse(day.endAt) > at.getTime()) return;
  const [saved] = await tx
    .select()
    .from(attendanceDayWork)
    .where(
      and(
        eq(attendanceDayWork.locationId, scope.locationId),
        eq(attendanceDayWork.businessDay, businessDay),
      ),
    );
  if (!saved) await enqueueAttendanceDay(tx, day);
  const pending = await tx
    .select()
    .from(attendanceOperationFacts)
    .where(
      and(
        eq(attendanceOperationFacts.personId, scope.personId),
        eq(attendanceOperationFacts.locationId, scope.locationId),
        eq(attendanceOperationFacts.businessDay, businessDay),
        eq(attendanceOperationFacts.outcome, "pending"),
      ),
    );
  for (const fact of pending) {
    if (fact.source === "bill-payment") {
      const [payment] = await tx
        .select({ receivedAt: billPayments.receivedAt })
        .from(billPayments)
        .where(eq(billPayments.id, fact.key));
      if (payment?.receivedAt !== null && payment?.receivedAt !== undefined)
        await recordAttendanceFact(tx, { ...fact, outcome: "qualified" });
    } else if (fact.source === "whole-payment") {
      const [watch] = await tx
        .select()
        .from(attendanceSourceState)
        .where(
          and(
            eq(attendanceSourceState.locationId, scope.locationId),
            eq(attendanceSourceState.source, "whole-payment"),
            eq(attendanceSourceState.recordKind, "watch"),
            eq(attendanceSourceState.key, fact.key),
          ),
        );
      if (watch) await discoverIntegratedAttendance(tx, watch, at);
    }
  }
  await processAttendanceDay(tx, {
    day,
    nodeId: scope.nodeId,
    personId: scope.personId,
    now: at,
    facts: await readAttendanceFacts(tx, day),
    planned: await readPlannedAttendanceShifts(tx, day),
  });
}

type Source = typeof attendanceSourceState.$inferInsert.source;
type Scan = typeof attendanceSourceState.$inferSelect;
type SourceRow = {
  position: number;
  key: string;
  personId: string | null;
  locationId: string | null;
  at: string | null;
  outcome: string | null;
  relatedId?: string | null;
  instants?: string[];
  detail?: string;
};
type RowSource = { source: Source; key: string; table: SQL; fields: SQL; joins?: SQL };
const rowSources: readonly RowSource[] = [
  {
    source: "session",
    key: "rows",
    table: sql`sessions`,
    fields: sql`e.id as key, e.person_id as personId, d.location_id as locationId, e.opened_at as at, 'qualifying' as outcome`,
    joins: sql`join devices d on d.id = e.device_id`,
  },
  {
    source: "order",
    key: "rows",
    table: sql`order_amendments`,
    fields: sql`e.id as key, e.actor_id as personId, o.location_id as locationId, e.event_at as at, 'qualifying' as outcome`,
    joins: sql`join working_orders o on o.id = e.working_order_id`,
  },
  {
    source: "draft",
    key: "rows",
    table: sql`order_draft_events`,
    fields: sql`'event:' || e.id as key, e.actor_id as personId, (select min(o.location_id) from working_orders o where o.party_id = d.party_id having count(distinct o.location_id) = 1) as locationId, e.created_at as at, 'qualifying' as outcome`,
    joins: sql`join order_drafts d on d.id = e.draft_id`,
  },
  {
    source: "group",
    key: "rows",
    table: sql`order_group_events`,
    fields: sql`'group:' || e.id as key, e.actor_id as personId, (select min(o.location_id) from working_orders o where o.party_id = e.party_id having count(distinct o.location_id) = 1) as locationId, e.created_at as at, 'qualifying' as outcome`,
  },
  {
    source: "bill-payment",
    key: "rows",
    table: sql`bill_payments`,
    fields: sql`e.id as key, e.requested_by as personId, o.location_id as locationId, e.created_at as at, case when e.received_at is not null then 'qualifying' else e.state end as outcome`,
    joins: sql`join working_orders o on o.id = e.working_order_id`,
  },
  {
    source: "rota",
    key: "shifts",
    table: sql`shifts`,
    fields: sql`'shift:' || e.id as key, e.person_id as personId, case when v.location_id = e.location_id then e.location_id end as locationId, e.starts_at as at, v.status as outcome`,
    joins: sql`left join roster_versions v on v.id = e.roster_version_id`,
  },
  {
    source: "rota",
    key: "versions",
    table: sql`roster_versions`,
    fields: sql`'version:' || e.id as key, null as personId, e.location_id as locationId, null as at, e.status as outcome`,
  },
  {
    source: "operation",
    key: "rows",
    table: sql`attendance_operation_facts`,
    fields: sql`e.source || ':' || e.key as key, e.person_id as personId, e.location_id as locationId, e.at as at, e.outcome as outcome`,
  },
];

function scanScope(locationId: string) {
  return and(
    eq(attendanceSourceState.locationId, locationId),
    eq(attendanceSourceState.recordKind, "scan"),
  );
}
async function endpoints(tx: Transaction, locationId: string) {
  const result: { source: Source; key: string; endpoint: number }[] = [];
  for (const source of rowSources) {
    const { rows } = await tx.execute<{ endpoint: number }>(
      sql`select coalesce(max(rowid), 0) as endpoint from ${source.table}`,
    );
    result.push({ source: source.source, key: source.key, endpoint: rows[0]!.endpoint });
  }
  const { rows } = await tx.execute<{ key: string; endpoint: number }>(
    sql`select node_id as key, max(sequence_no) as endpoint from time_entries where location_id = ${locationId} group by node_id`,
  );
  for (const row of rows) result.push({ source: "clock", ...row });
  return result;
}

/** Call once for each open-store generation; retained SQLite rowids are not restore identities. */
export async function beginAttendanceDiscovery(
  tx: Transaction,
  scope: { locationId: string; generation: string },
): Promise<void> {
  if (!scope.generation)
    throw new AppError("attendance.invalid", { reason: "empty discovery generation" });
  const clock = await readLocationClock(tx, scope.locationId);
  await tx.delete(attendanceSourceState).where(scanScope(scope.locationId));
  for (const endpoint of await endpoints(tx, scope.locationId)) {
    await tx.insert(attendanceSourceState).values({
      locationId: scope.locationId,
      ...endpoint,
      recordKind: "scan",
      generation: scope.generation,
      cursor: 0,
      completed: endpoint.endpoint === 0,
      fingerprint:
        endpoint.source === "rota" && endpoint.key === "shifts" ? JSON.stringify({ clock }) : null,
    });
  }
}

async function dirtyDay(tx: Transaction, locationId: string, businessDay: string): Promise<void> {
  const [saved] = await tx
    .select()
    .from(attendanceDayWork)
    .where(
      and(
        eq(attendanceDayWork.locationId, locationId),
        eq(attendanceDayWork.businessDay, businessDay),
      ),
    );
  if (saved) {
    await tx
      .update(attendanceDayWork)
      .set({ dirtyRevision: sql`${attendanceDayWork.dirtyRevision} + 1` })
      .where(eq(attendanceDayWork.id, saved.id));
  } else {
    const clock = await readLocationClock(tx, locationId);
    await enqueueAttendanceDay(tx, {
      locationId,
      businessDay,
      ...businessDayBounds(clock, businessDay),
    });
  }
}

async function remember(tx: Transaction, scan: Scan, row: SourceRow, now: Date): Promise<void> {
  const clock = await readLocationClock(tx, scan.locationId);
  const instants = [...(row.instants ?? []), ...(row.at === null ? [] : [row.at])];
  if (scan.source === "clock" && row.relatedId) {
    const { rows } = await tx.execute<{ at: string; relatedId: string | null }>(sql`
      with recursive roots(id, at, parent) as (
        select id, event_at, coalesce(corrects_entry_id, responds_to_entry_id) from time_entries where id = ${row.relatedId}
        union all
        select e.id, e.event_at, coalesce(e.corrects_entry_id, e.responds_to_entry_id) from time_entries e join roots r on e.id = r.parent
      ) select at, parent as relatedId from roots`);
    instants.push(...rows.map((r) => r.at));
  }
  const qualifies =
    scan.source === "clock" ||
    row.outcome === "qualifying" ||
    (scan.source === "rota" && row.outcome === "published");
  const days =
    row.locationId === scan.locationId &&
    (row.personId !== null || (scan.source === "rota" && row.key.startsWith("version:"))) &&
    qualifies
      ? [...new Set(instants.map((at) => businessDayAt(clock, new Date(at))))].sort()
      : [];
  const fingerprint = JSON.stringify([
    row.personId,
    row.locationId,
    row.at,
    row.outcome,
    row.relatedId ?? null,
    row.detail ?? null,
    days,
  ]);
  const predicate = and(
    eq(attendanceSourceState.locationId, scan.locationId),
    eq(attendanceSourceState.source, scan.source),
    eq(attendanceSourceState.recordKind, "watch"),
    eq(attendanceSourceState.key, row.key),
  );
  const [previous] = await tx.select().from(attendanceSourceState).where(predicate);
  const nextDueAt =
    (scan.source === "bill-payment" && row.outcome === "pending") ||
    (scan.source === "rota" && row.outcome === "draft")
      ? new Date(now.getTime() + 30_000).toISOString()
      : null;
  if (previous?.fingerprint === fingerprint) {
    await tx
      .update(attendanceSourceState)
      .set({ nextDueAt })
      .where(eq(attendanceSourceState.id, previous.id));
    return;
  }
  for (const day of new Set([...(previous?.previousDays ?? []), ...days]))
    await dirtyDay(tx, scan.locationId, day);
  await tx
    .insert(attendanceSourceState)
    .values({
      locationId: scan.locationId,
      source: scan.source,
      key: row.key,
      recordKind: "watch",
      fingerprint,
      previousDays: days,
      nextDueAt,
    })
    .onConflictDoUpdate({
      target: [
        attendanceSourceState.locationId,
        attendanceSourceState.source,
        attendanceSourceState.recordKind,
        attendanceSourceState.key,
      ],
      set: { fingerprint, previousDays: days, nextDueAt },
    });
}

async function capturedRow(tx: Transaction, source: Source, row: SourceRow): Promise<void> {
  if (!["session", "order", "draft", "group", "bill-payment"].includes(source)) return;
  const capturedSource = source === "group" ? "draft" : source;
  const [fact] = await tx
    .select()
    .from(attendanceOperationFacts)
    .where(
      and(
        sql`${attendanceOperationFacts.source} = ${capturedSource}`,
        eq(attendanceOperationFacts.key, row.key),
      ),
    );
  if (!fact) return;
  let outcome = fact.outcome;
  if (source === "bill-payment" && row.outcome === "qualifying" && outcome !== "qualifying") {
    await recordAttendanceFact(tx, { ...fact, outcome: "qualified" });
    outcome = "qualifying";
  }
  Object.assign(row, {
    personId: fact.personId,
    locationId: fact.locationId,
    at: fact.at,
    outcome,
  });
}

async function sourcePage(tx: Transaction, scan: Scan, limit: number): Promise<SourceRow[]> {
  if (scan.source === "clock") {
    return (
      await tx.execute<SourceRow>(
        sql`select sequence_no as position, id as key, person_id as personId, location_id as locationId, event_at as at, entry_kind as outcome, coalesce(corrects_entry_id, responds_to_entry_id) as relatedId from time_entries where node_id = ${scan.key} and location_id = ${scan.locationId} and sequence_no > ${scan.cursor} and sequence_no <= ${scan.endpoint} order by sequence_no limit ${limit}`,
      )
    ).rows;
  }
  const source = rowSources.find((s) => s.source === scan.source && s.key === scan.key)!;
  const futureFrom =
    scan.source === "rota" && scan.key === "shifts" && scan.fingerprint
      ? (JSON.parse(scan.fingerprint) as { fromAt?: string }).fromAt
      : undefined;
  const { rows } = await tx.execute<SourceRow>(
    sql`select e.rowid as position, ${source.fields} from ${source.table} e ${source.joins ?? sql``} where e.rowid > ${scan.cursor} and e.rowid <= ${scan.endpoint} ${futureFrom === undefined ? sql`` : sql`and e.starts_at >= ${futureFrom}`} order by e.rowid limit ${limit}`,
  );
  for (const row of rows) await capturedRow(tx, scan.source, row);
  return rows;
}

async function watchedRow(tx: Transaction, watch: Scan): Promise<SourceRow | undefined> {
  const key = watch.key.replace(/^(?:shift:|version:|event:|group:)/, "");
  const source = rowSources.find(
    (s) =>
      s.source === watch.source &&
      (s.source !== "rota" || s.key === (watch.key.startsWith("version:") ? "versions" : "shifts")),
  );
  if (!source) return undefined;
  const { rows } = await tx.execute<SourceRow>(
    sql`select e.rowid as position, ${source.fields} from ${source.table} e ${source.joins ?? sql``} where e.id = ${key}`,
  );
  const row = rows[0];
  if (row) await capturedRow(tx, watch.source, row);
  if (row && source.source === "rota" && source.key === "versions") {
    const { rows: planned } = await tx.execute<{
      personId: string;
      at: string;
      end: string;
      id: string;
    }>(
      sql`select person_id as personId, starts_at as at, ends_at as end, id from shifts where roster_version_id = ${key} and location_id = ${watch.locationId} order by starts_at, id`,
    );
    row.instants = planned.map((p) => p.at);
    row.detail = JSON.stringify(planned);
  }
  return row;
}

export async function discoverAttendanceDays(
  tx: Transaction,
  scope: { locationId: string; now: Date; batchSize: number },
): Promise<{ more: boolean }> {
  if (
    !Number.isFinite(scope.now.getTime()) ||
    !Number.isInteger(scope.batchSize) ||
    scope.batchSize < 1 ||
    scope.batchSize > 100
  )
    throw new AppError("attendance.invalid", { reason: "invalid discovery batch" });
  let scans = await tx.select().from(attendanceSourceState).where(scanScope(scope.locationId));
  if (scans.length === 0) {
    await beginAttendanceDiscovery(tx, { locationId: scope.locationId, generation: randomUUID() });
    scans = await tx.select().from(attendanceSourceState).where(scanScope(scope.locationId));
  }
  const generation = scans[0]!.generation!;
  const clock = await readLocationClock(tx, scope.locationId);
  const rotaScan = scans.find((s) => s.source === "rota" && s.key === "shifts");
  if (
    rotaScan &&
    rotaScan.fingerprint &&
    JSON.stringify((JSON.parse(rotaScan.fingerprint) as { clock: unknown }).clock) !==
      JSON.stringify(clock)
  ) {
    const fingerprint = JSON.stringify({ clock, fromAt: scope.now.toISOString() });
    await tx
      .update(attendanceSourceState)
      .set({ cursor: 0, completed: rotaScan.endpoint === 0, fingerprint })
      .where(eq(attendanceSourceState.id, rotaScan.id));
    Object.assign(rotaScan, { cursor: 0, completed: rotaScan.endpoint === 0, fingerprint });
  }

  for (const endpoint of await endpoints(tx, scope.locationId)) {
    const saved = scans.find((s) => s.source === endpoint.source && s.key === endpoint.key);
    if (!saved) {
      const [created] = await tx
        .insert(attendanceSourceState)
        .values({
          locationId: scope.locationId,
          ...endpoint,
          recordKind: "scan",
          generation,
          cursor: 0,
          completed: endpoint.endpoint === 0,
        })
        .returning();
      scans.push(created!);
    } else if (endpoint.endpoint > saved.endpoint!) {
      await tx
        .update(attendanceSourceState)
        .set({ endpoint: endpoint.endpoint, completed: false })
        .where(eq(attendanceSourceState.id, saved.id));
      Object.assign(saved, { endpoint: endpoint.endpoint, completed: false });
    }
  }
  const scan = scans.find((s) => !s.completed);
  if (scan) {
    const page = await sourcePage(tx, scan, scope.batchSize);
    for (const row of page) await remember(tx, scan, row, new Date(scope.now.getTime() - 30_000));
    const cursor = page.length === scope.batchSize ? page.at(-1)!.position : scan.endpoint!;
    const completed = cursor === scan.endpoint;
    const fingerprint =
      completed && scan.source === "rota" && scan.key === "shifts"
        ? JSON.stringify({ clock })
        : scan.fingerprint;
    await tx
      .update(attendanceSourceState)
      .set({ cursor, completed, fingerprint })
      .where(eq(attendanceSourceState.id, scan.id));
    Object.assign(scan, { cursor, completed });
  }
  if (scan) return { more: scans.some((s) => !s.completed) };
  const due = () =>
    and(
      eq(attendanceSourceState.locationId, scope.locationId),
      eq(attendanceSourceState.recordKind, "watch"),
      sql`${attendanceSourceState.nextDueAt} <= ${scope.now.toISOString()}`,
    );
  const watches = await tx
    .select()
    .from(attendanceSourceState)
    .where(due())
    .orderBy(asc(attendanceSourceState.nextDueAt), asc(attendanceSourceState.id))
    .limit(scope.batchSize);
  for (const watch of watches) {
    if (watch.source === "whole-payment") {
      await discoverIntegratedAttendance(tx, watch, scope.now);
      continue;
    }
    const row = await watchedRow(tx, watch);
    if (row) await remember(tx, watch, row, scope.now);
    else {
      for (const day of watch.previousDays) await dirtyDay(tx, scope.locationId, day);
      await tx
        .update(attendanceSourceState)
        .set({ fingerprint: "deleted", previousDays: [], nextDueAt: null })
        .where(eq(attendanceSourceState.id, watch.id));
    }
  }
  const remaining = await tx
    .select({ id: attendanceSourceState.id })
    .from(attendanceSourceState)
    .where(due())
    .limit(1);
  return { more: remaining.length > 0 };
}

export async function nextAttendanceDay(
  tx: Transaction,
  scope: { locationId: string; now: Date },
): Promise<AttendanceDay | null> {
  if (!Number.isFinite(scope.now.getTime()))
    throw new AppError("attendance.invalid", { reason: "invalid attendance instant" });
  const scans = await tx.select().from(attendanceSourceState).where(scanScope(scope.locationId));
  if (scans.length === 0 || scans.some((s) => !s.completed)) return null;
  const clock = await readLocationClock(tx, scope.locationId);
  const future = await tx
    .select()
    .from(attendanceDayWork)
    .where(
      and(
        eq(attendanceDayWork.locationId, scope.locationId),
        eq(attendanceDayWork.evaluatedRevision, 0),
        sql`${attendanceDayWork.endAt} > ${scope.now.toISOString()}`,
      ),
    );
  for (const work of future) {
    const bounds = businessDayBounds(clock, work.businessDay);
    if (work.startAt === bounds.startAt && work.endAt === bounds.endAt) continue;
    await tx
      .update(attendanceDayWork)
      .set({
        ...bounds,
        nextDueAt:
          work.nextDueAt === work.endAt || work.nextDueAt < bounds.endAt
            ? bounds.endAt
            : work.nextDueAt,
      })
      .where(eq(attendanceDayWork.id, work.id));
  }
  const [work] = await tx
    .select()
    .from(attendanceDayWork)
    .where(
      and(
        eq(attendanceDayWork.locationId, scope.locationId),
        sql`${attendanceDayWork.nextDueAt} <= ${scope.now.toISOString()}`,
        sql`${attendanceDayWork.endAt} <= ${scope.now.toISOString()}`,
        sql`(${attendanceDayWork.dirtyRevision} > ${attendanceDayWork.evaluatedRevision} or json_array_length(${attendanceDayWork.deferredShiftIds}) > 0)`,
      ),
    )
    .orderBy(
      asc(attendanceDayWork.businessDay),
      asc(attendanceDayWork.startAt),
      asc(attendanceDayWork.id),
    )
    .limit(1);
  if (work) {
    const bounds = businessDayBounds(clock, work.businessDay);
    if (work.startAt !== bounds.startAt || work.endAt !== bounds.endAt)
      throw new AppError("attendance.invalid", { reason: "saved attendance bounds changed" });
  }
  if (!work) return null;
  const day = {
    locationId: work.locationId,
    businessDay: work.businessDay,
    startAt: work.startAt,
    endAt: work.endAt,
  };
  await retireObsoleteRotaQuestions(tx, day);
  return day;
}
