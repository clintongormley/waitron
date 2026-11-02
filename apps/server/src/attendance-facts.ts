import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { readVenueClock, type Transaction } from "@waitron/db";
import { offsetMinutes } from "@waitron/venue-service";
import { rosterVersions, shifts } from "@waitron/workforce";
import type { AttendanceDay, AttendanceFact, PlannedAttendanceShift } from "@waitron/workforce";

type SourceFact = Omit<AttendanceFact, "offsetMinutes">;

export async function readAttendanceFacts(
  tx: Transaction,
  day: AttendanceDay,
): Promise<AttendanceFact[]> {
  const clock = await readVenueClock(tx);
  const { rows } = await tx.execute<SourceFact>(sql`
    with retained(source, key, personId, kind, at) as (
      select 'session', s.id, s.person_id, 'sign-in', s.opened_at
      from sessions s join devices d on d.id = s.device_id
      union all
      select 'order', a.id, a.actor_id, 'order', a.event_at
      from order_amendments a join working_orders o on o.id = a.working_order_id
      union all
      select 'draft', 'event:' || e.id, e.actor_id, 'order', e.created_at
      from order_draft_events e join order_drafts d on d.id = e.draft_id
      join working_orders o on o.party_id = d.party_id
      group by e.id
      union all
      select 'draft', 'group:' || e.id, e.actor_id, 'order', e.created_at
      from order_group_events e join working_orders o on o.party_id = e.party_id
      where e.actor_id is not null
      group by e.id
      union all
      select 'bill-payment', p.id, p.requested_by, 'payment', p.created_at
      from bill_payments p join working_orders o on o.id = p.working_order_id
      where p.received_at is not null
      union all
      select 'clock', e.id, e.person_id, 'break', e.event_at
      from time_entries e
      where (e.entry_kind in ('break_start', 'break_end') or (
        e.entry_kind = 'correction' and e.correction_status = 'approved'
        and e.corrects_entry_id is null and e.missing_entry_kind in ('break_start', 'break_end')))
    )
    select r.* from retained r
    where julianday(r.at) >= julianday(${day.startAt}) and julianday(r.at) < julianday(${day.endAt})
    and not exists (select 1 from attendance_operation_facts f where f.source = r.source and f.key = r.key)
    union all
    select source, key, person_id, kind, at from attendance_operation_facts
    where at >= ${day.startAt} and at < ${day.endAt}
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
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      rosterVersionId: rosterVersions.id,
    })
    .from(shifts)
    .innerJoin(rosterVersions, eq(shifts.rosterVersionId, rosterVersions.id))
    .where(
      and(
        eq(rosterVersions.status, "published"),
        gte(shifts.startsAt, day.startAt),
        lt(shifts.startsAt, day.endAt),
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(shifts.endsAt), asc(shifts.id));
}
