import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { offsetMinutes } from "@waitron/venue-service";
import { rosterVersions, shifts } from "@waitron/workforce";
import type { AttendanceDay, AttendanceFact, PlannedAttendanceShift } from "@waitron/workforce";

type SourceFact = Omit<AttendanceFact, "offsetMinutes">;

export async function readAttendanceFacts(
  tx: Transaction,
  day: AttendanceDay,
): Promise<AttendanceFact[]> {
  const clock = await readLocationClock(tx, day.locationId);
  // Captured operations retain their location across later device and party changes.
  const { rows } = await tx.execute<SourceFact>(sql`
    with retained(source, key, personId, locationId, kind, at) as (
      select 'session', s.id, s.person_id, d.location_id, 'sign-in', s.opened_at
      from sessions s join devices d on d.id = s.device_id
      where d.location_id = ${day.locationId}
      union all
      select 'order', a.id, a.actor_id, o.location_id, 'order', a.event_at
      from order_amendments a join working_orders o on o.id = a.working_order_id
      where o.location_id = ${day.locationId}
      union all
      select 'draft', 'event:' || e.id, e.actor_id, min(o.location_id), 'order', e.created_at
      from order_draft_events e join order_drafts d on d.id = e.draft_id
      join working_orders o on o.party_id = d.party_id
      group by e.id having count(distinct o.location_id) = 1 and min(o.location_id) = ${day.locationId}
      union all
      select 'draft', 'group:' || e.id, e.actor_id, min(o.location_id), 'order', e.created_at
      from order_group_events e join working_orders o on o.party_id = e.party_id
      where e.actor_id is not null
      group by e.id having count(distinct o.location_id) = 1 and min(o.location_id) = ${day.locationId}
      union all
      select 'bill-payment', p.id, p.requested_by, o.location_id, 'payment', p.created_at
      from bill_payments p join working_orders o on o.id = p.working_order_id
      where o.location_id = ${day.locationId} and p.received_at is not null
      union all
      select 'clock', e.id, e.person_id, e.location_id, 'break', e.event_at
      from time_entries e where e.location_id = ${day.locationId}
      and (e.entry_kind in ('break_start', 'break_end') or (
        e.entry_kind = 'correction' and e.correction_status = 'approved'
        and e.corrects_entry_id is null and e.missing_entry_kind in ('break_start', 'break_end')))
    )
    select r.* from retained r
    where julianday(r.at) >= julianday(${day.startAt}) and julianday(r.at) < julianday(${day.endAt})
    and not exists (select 1 from attendance_operation_facts f where f.source = r.source and f.key = r.key)
    union all
    select source, key, person_id, location_id, kind, at from attendance_operation_facts
    where location_id = ${day.locationId} and at >= ${day.startAt} and at < ${day.endAt}
    and outcome = 'qualifying'
  `);
  return rows
    .map((row) => {
      const instant = Math.floor(Date.parse(row.at) / 1000) * 1000;
      return {
        ...row,
        at: new Date(instant).toISOString(),
        offsetMinutes: offsetMinutes(instant, clock.timeZone),
      };
    })
    .sort(
      (a, b) =>
        a.at.localeCompare(b.at) || a.source.localeCompare(b.source) || a.key.localeCompare(b.key),
    );
}

export async function readPlannedAttendanceShifts(
  tx: Transaction,
  day: AttendanceDay,
): Promise<PlannedAttendanceShift[]> {
  return tx
    .select({
      id: shifts.id,
      personId: shifts.personId,
      locationId: shifts.locationId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      rosterVersionId: rosterVersions.id,
    })
    .from(shifts)
    .innerJoin(
      rosterVersions,
      and(
        eq(shifts.rosterVersionId, rosterVersions.id),
        eq(shifts.locationId, rosterVersions.locationId),
      ),
    )
    .where(
      and(
        eq(shifts.locationId, day.locationId),
        eq(rosterVersions.status, "published"),
        gte(shifts.startsAt, day.startAt),
        lt(shifts.startsAt, day.endAt),
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(shifts.endsAt), asc(shifts.id));
}
