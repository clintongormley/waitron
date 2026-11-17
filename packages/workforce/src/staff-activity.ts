import { and, asc, eq, gt, gte, lt, or, sql } from "drizzle-orm";
import { readVenueClock, type Transaction } from "@waitron/db";
import { AppError, businessDayAt, businessDayBounds, timeZoneOffsetMinutes } from "@waitron/shared";
import { attendanceDays, staffActivity } from "./schema/attendance.js";
import { shifts } from "./schema/shifts.js";
import { rosterVersions } from "./schema/roster-versions.js";
import { timeEntries } from "./schema/time-entries.js";
import { readRecordedEntries } from "./record-reads.js";
import {
  effectiveClockEntries,
  compareEvents,
  automaticEntryIdsWithoutMarker,
} from "./effective-entries.js";
import { enqueueAttendanceDay } from "./attendance-state.js";
import type { AttendanceDay, AttendanceFact } from "./attendance-types.js";
import "./errors.js";

export async function markAttendanceEntry(
  tx: Transaction,
  entry: Pick<
    typeof timeEntries.$inferSelect,
    "id" | "eventAt" | "correctsEntryId" | "respondsToEntryId"
  >,
): Promise<void> {
  const clock = await readVenueClock(tx);
  const pending = [entry.correctsEntryId, entry.respondsToEntryId].filter((id) => id !== null),
    visited = new Set([entry.id]),
    days = new Set([businessDayAt(clock, new Date(entry.eventAt))]);
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const [entry] = await tx.select().from(timeEntries).where(eq(timeEntries.id, id));
    if (!entry) continue;
    days.add(businessDayAt(clock, new Date(entry.eventAt)));
    if (entry.correctsEntryId) pending.push(entry.correctsEntryId);
    if (entry.respondsToEntryId) pending.push(entry.respondsToEntryId);
  }
  for (const businessDay of days) {
    const [saved] = await tx
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.businessDay, businessDay));
    await enqueueAttendanceDay(
      tx,
      saved ?? { businessDay, ...businessDayBounds(clock, businessDay) },
    );
  }
}

export async function recordStaffActivity(
  tx: Transaction,
  personId: string,
  instant: Date,
): Promise<void> {
  if (!personId || !Number.isFinite(instant.getTime()))
    throw new AppError("attendance.invalid", { reason: "invalid staff activity" });
  const at = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const stamp = at.toISOString();
  const clock = await readVenueClock(tx);
  const currentDay = businessDayAt(clock, at);
  const bounds = businessDayBounds(clock, currentDay);
  const planned = await tx
    .select({ id: shifts.id, startsAt: shifts.startsAt, endsAt: shifts.endsAt })
    .from(shifts)
    .innerJoin(rosterVersions, eq(rosterVersions.id, shifts.rosterVersionId))
    .where(
      and(
        eq(shifts.personId, personId),
        eq(rosterVersions.status, "published"),
        lt(shifts.startsAt, bounds.endAt.replace(".000Z", "Z")),
        gt(shifts.endsAt, bounds.startAt.replace(".000Z", "Z")),
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(shifts.endsAt), asc(shifts.id));
  const own = planned.find(
    (p) => Date.parse(p.startsAt) <= at.getTime() && at.getTime() < Date.parse(p.endsAt),
  );
  const previous = planned.filter((p) => Date.parse(p.endsAt) <= at.getTime()).at(-1);
  const next = planned.find((p) => Date.parse(p.startsAt) > at.getTime());
  const businessDay = own ? businessDayAt(clock, new Date(own.startsAt)) : currentDay;
  const shiftKey = own
    ? `rota:${own.id}:${own.startsAt}:${own.endsAt}`
    : `gap:${businessDay}:${previous?.id ?? "start"}`;
  const changed = await tx
    .insert(staffActivity)
    .values({
      personId,
      businessDay,
      shiftKey,
      shiftStartAt: own?.startsAt ?? previous?.endsAt ?? null,
      shiftEndAt: own?.endsAt ?? next?.startsAt ?? null,
      firstAt: stamp,
      lastAt: stamp,
    })
    .onConflictDoUpdate({
      target: [staffActivity.personId, staffActivity.shiftKey],
      set: {
        firstAt: sql`min(${staffActivity.firstAt}, ${stamp})`,
        lastAt: sql`max(${staffActivity.lastAt}, ${stamp})`,
      },
      setWhere: sql`${staffActivity.firstAt} > ${stamp} or ${staffActivity.lastAt} < ${stamp}`,
    })
    .returning({ id: staffActivity.id });
  if (changed.length) {
    const days = new Set([businessDay]);
    if (!own && previous) days.add(businessDayAt(clock, new Date(previous.startsAt)));
    for (const businessDay of days) {
      const [saved] = await tx
        .select()
        .from(attendanceDays)
        .where(eq(attendanceDays.businessDay, businessDay));
      await enqueueAttendanceDay(
        tx,
        saved ?? { businessDay, ...businessDayBounds(clock, businessDay) },
      );
    }
  }
}

export async function readStaffActivityFacts(
  tx: Transaction,
  day: AttendanceDay,
): Promise<AttendanceFact[]> {
  const clock = await readVenueClock(tx);
  const start = Date.parse(day.startAt),
    end = Date.parse(day.endAt);
  const followingEnd = businessDayBounds(clock, businessDayAt(clock, new Date(day.endAt))).endAt;
  const planned = await tx
    .select({
      id: shifts.id,
      personId: shifts.personId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
    })
    .from(shifts)
    .innerJoin(rosterVersions, eq(rosterVersions.id, shifts.rosterVersionId))
    .where(
      and(
        eq(rosterVersions.status, "published"),
        lt(shifts.startsAt, followingEnd.replace(".000Z", "Z")),
        gt(shifts.endsAt, day.startAt.replace(".000Z", "Z")),
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(shifts.endsAt), asc(shifts.id));
  const hasOvernight = planned.some(
    (p) =>
      Date.parse(p.startsAt) >= start && Date.parse(p.startsAt) < end && Date.parse(p.endsAt) > end,
  );
  const rangeEnd = hasOvernight ? followingEnd : day.endAt;
  const rows = await tx
    .select()
    .from(staffActivity)
    .where(
      or(
        eq(staffActivity.businessDay, day.businessDay),
        and(lt(staffActivity.firstAt, rangeEnd), gte(staffActivity.lastAt, day.startAt)),
      ),
    );
  const clocks = new Map<
    string,
    { events: ReturnType<typeof effectiveClockEntries>; unmarked: Set<string> }
  >();
  for (const personId of new Set(rows.map((row) => row.personId))) {
    const entries = await readRecordedEntries(tx, { personId });
    clocks.set(personId, {
      events: effectiveClockEntries(entries)
        .filter((e) => e.entryKind === "in" || e.entryKind === "out")
        .sort(compareEvents),
      unmarked: automaticEntryIdsWithoutMarker(entries),
    });
  }
  return rows
    .flatMap((row) =>
      [
        { side: "first", at: row.firstAt },
        ...(row.lastAt === row.firstAt ? [] : [{ side: "latest", at: row.lastAt }]),
      ]
        .filter(({ at }) => {
          const time = Date.parse(at);
          const own = planned.find(
            (p) =>
              p.personId === row.personId &&
              Date.parse(p.startsAt) <= time &&
              time < Date.parse(p.endsAt),
          );
          const previous = planned
            .filter((p) => p.personId === row.personId && Date.parse(p.endsAt) <= time)
            .at(-1);
          const context = clocks.get(row.personId)!;
          const preceding = context.events.filter((e) => Date.parse(e.eventAt) <= time);
          const latest = preceding.at(-1),
            latestIn = preceding.filter((e) => e.entryKind === "in").at(-1);
          const open = !latest || latest.entryKind === "in" || context.unmarked.has(latest.entryId);
          const assigned =
            own ??
            (previous &&
            open &&
            (!latestIn || Date.parse(latestIn.eventAt) < Date.parse(previous.endsAt)) &&
            businessDayAt(clock, new Date(previous.startsAt)) !==
              businessDayAt(clock, new Date(previous.endsAt))
              ? previous
              : undefined);
          const capturedNight =
            row.shiftStartAt &&
            row.shiftEndAt &&
            businessDayAt(clock, new Date(row.shiftStartAt)) !==
              businessDayAt(clock, new Date(row.shiftEndAt));
          const anchor = assigned
            ? Date.parse(assigned.startsAt)
            : capturedNight &&
                open &&
                latestIn &&
                businessDayAt(clock, new Date(latestIn.eventAt)) === row.businessDay
              ? Date.parse(latestIn.eventAt)
              : time;
          return anchor >= start && anchor < end;
        })
        .map(({ side, at }): AttendanceFact => ({
          personId: row.personId,
          source: "order",
          kind: "order",
          at,
          key: `staff:${row.id}:${side}:${at}`,
          offsetMinutes: timeZoneOffsetMinutes(clock.timeZone, new Date(at)),
        })),
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}
