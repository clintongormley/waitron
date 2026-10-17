import { and, asc, eq, gte, lte, inArray, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { readLocationClock } from "@waitron/reporting";
import { AppError, cutoverForBusinessDay, locationId } from "@waitron/shared";
import {
  addDays,
  isLocalDate,
  localTimeOccurrences,
  offsetMinutes,
  readDayPlan,
  readSeasons,
  resolveDepartmentsDays,
} from "@waitron/venue-service";
import { WorkforceBackend, absences, employments, shifts, shiftSwaps } from "@waitron/workforce";
import { listStaffingAreas, resolveStaffing } from "./paint.js";
import { parseArea } from "./paint-rules.js";
import { mondayOf, readRotaRows } from "./rota-data.js";
import {
  areaKey,
  blockSpan,
  matchAreaDay,
  placeShift,
  slotsForDay,
  type AreaRef,
} from "./slots.js";
import { listStaffRoles } from "./staff-roles.js";
import { shiftAssignments, staffRoles } from "./schema/staffing.js";
import type { RotaWeek, RotaShiftInput, RotaShiftPatch } from "./staffing-types.js";
import "./errors.js";

type Cfg = { locationId: string };
const backend = new WorkforceBackend();
const invalid = (field: string) => new AppError("staffing.invalid", { field });
export function isRotaWeek(value: unknown): value is string {
  return typeof value === "string" && isLocalDate(value) && mondayOf(value) === value;
}
export async function readRotaWeek(tx: Transaction, cfg: Cfg, week: string): Promise<RotaWeek> {
  if (!isRotaWeek(week)) throw invalid("week");
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const clock = await readLocationClock(tx, cfg.locationId);
  const cutover = (day: string) => cutoverForBusinessDay(clock, day);
  const scope = { locationId: locationId(cfg.locationId) };
  const venueSeasons = await readSeasons(tx, scope);
  const plan = await readDayPlan(tx, scope, days, venueSeasons);
  const areas = await listStaffingAreas(tx, cfg);
  const opening = await resolveDepartmentsDays(
    tx,
    scope,
    areas.flatMap(({ area }) => (area.kind === "department" ? [area.id] : [])),
    days,
    clock,
    plan,
  );
  const weekSeasonIds = new Set(days.map((day) => plan.seasonIdOn.get(day)));
  const paint = await resolveStaffing(tx, cfg, days, { plan, areas, cutover: clock.dayCutover });
  const roles = await listStaffRoles(tx, cfg);
  const data = await readRotaRows(tx, cfg, week, week);
  const version = data.selected.get(week);
  const placed = (data.byWeek.get(week) ?? []).map((s) => placeShift(s, cutover));
  const people = await tx
    .select({ personId: persons.id, name: persons.displayName })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(asc(persons.displayName), asc(persons.id));
  const contracts = await tx
    .select()
    .from(employments)
    .where(and(lte(employments.startDate, addDays(week, 6))))
    .orderBy(asc(employments.startDate), asc(employments.id));
  const leave = await tx
    .select({ personId: absences.personId, startsOn: absences.startsOn, endsOn: absences.endsOn })
    .from(absences)
    .where(
      and(
        eq(absences.status, "approved"),
        lte(absences.startsOn, addDays(week, 6)),
        gte(absences.endsOn, week),
      ),
    )
    .orderBy(asc(absences.startsOn), asc(absences.personId));
  const holds = (personId: string, staffRoleId: string) =>
    roles.some((r) => r.id === staffRoleId && r.holderIds.includes(personId));
  return {
    locationId: cfg.locationId,
    timeZone: clock.timeZone,
    week,
    version: version
      ? {
          id: version.id,
          status: version.status as "draft" | "published",
          changedSincePublished:
            version.status === "draft" && data.versions.some((v) => v.status === "published"),
        }
      : null,
    seasons: [...weekSeasonIds].flatMap((id) =>
      venueSeasons.filter((season) => season.id === id).map(({ id, name }) => ({ id, name })),
    ),
    days: days.map((businessDay, index) => {
      const special = plan.special.get(businessDay) ?? null;
      return {
        businessDay,
        cutover: cutover(businessDay),
        closedAllDay: special?.closedAllDay ?? false,
        hasHours: [...opening.values()].some((d) => d.get(businessDay)!.ranges.length > 0),
        seasonId: plan.seasonIdOn.get(businessDay) ?? null,
        specialDay: special && { id: special.specialDayId, name: special.name },
        areas: areas.map(({ area }) => ({
          area,
          match: matchAreaDay(
            slotsForDay(
              businessDay,
              area,
              paint.get(businessDay)!.get(areaKey(area)) ?? [],
              cutover(businessDay),
            ),
            placed.filter(
              (s) =>
                s.businessDay === businessDay &&
                s.area !== null &&
                areaKey(s.area) === areaKey(area),
            ),
            holds,
          ),
        })),
        notInSlot: placed
          .filter(
            (s) =>
              (s.businessDay < week
                ? index === 0
                : s.businessDay > days[6]!
                  ? index === 6
                  : s.businessDay === businessDay) &&
              (s.businessDay < week ||
                s.businessDay > days[6]! ||
                s.area === null ||
                !areas.some((a) => areaKey(a.area) === areaKey(s.area!))),
          )
          .map((s) => ({
            shiftId: s.shiftId,
            outsideWeek: s.businessDay < week || s.businessDay > days[6]!,
          })),
      };
    }),
    shifts: placed,
    openSwaps: placed.length
      ? await tx
          .select({
            swapId: shiftSwaps.id,
            fromShiftId: shiftSwaps.fromShiftId,
            toShiftId: shiftSwaps.toShiftId,
          })
          .from(shiftSwaps)
          .where(
            and(
              inArray(shiftSwaps.status, ["requested", "accepted"]),
              or(
                inArray(
                  shiftSwaps.fromShiftId,
                  placed.map((s) => s.shiftId),
                ),
                inArray(
                  shiftSwaps.toShiftId,
                  placed.map((s) => s.shiftId),
                ),
              ),
            ),
          )
          .orderBy(asc(shiftSwaps.id))
      : [],
    people: people.map((p) => ({
      ...p,
      staffRoleIds: roles.filter((r) => r.holderIds.includes(p.personId)).map((r) => r.id),
      contractedMinutes:
        contracts
          .filter((c) => c.personId === p.personId && (c.endDate === null || c.endDate >= week))
          .at(-1)?.contractedMinutesPerWeek ?? null,
      plannedMinutes: placed
        .filter((s) => s.personId === p.personId)
        .reduce((n, s) => n + (Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000, 0),
    })),
    absences: leave,
    areas: areas.map((a) => ({ ...a, active: true })),
    staffRoles: roles,
  };
}
async function assignmentTargets(tx: Transaction, cfg: Cfg, area: AreaRef, staffRoleId: string) {
  parseArea(area, "area");
  if (!(await listStaffingAreas(tx, cfg)).some((a) => areaKey(a.area) === areaKey(area)))
    throw new AppError("staffing_area.not_found", { area: areaKey(area) });
  const [role] = await tx
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(eq(staffRoles.id, staffRoleId), eq(staffRoles.locationId, cfg.locationId)));
  if (!role) throw new AppError("staff_role.not_found", { staffRoleId });
}
async function times(
  tx: Transaction,
  cfg: Cfg,
  businessDay: string,
  startsAt: string,
  endsAt: string,
) {
  for (const [field, value] of [
    ["startsAt", startsAt],
    ["endsAt", endsAt],
  ])
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(value))
      throw invalid(field!);
  const clock = await readLocationClock(tx, cfg.locationId);
  const cutover = cutoverForBusinessDay(clock, businessDay);
  const span = blockSpan({ startsAt, endsAt }, cutover);
  if (span.end <= span.start) throw invalid("endsAt");
  const instant = (time: string, field: string, end = false) => {
    const date =
      time < cutover || (end && time === cutover) ? addDays(businessDay, 1) : businessDay;
    const at = localTimeOccurrences(date, time, clock.timeZone)[0];
    if (!at) throw invalid(field);
    return { at: at.toISOString(), offset: offsetMinutes(at.getTime(), clock.timeZone) };
  };
  const start = instant(startsAt, "startsAt"),
    end = instant(endsAt, "endsAt", true);
  if (end.at <= start.at) throw invalid("endsAt");
  return {
    startsAt: start.at,
    startsOffsetMinutes: start.offset,
    endsAt: end.at,
    endsOffsetMinutes: end.offset,
  };
}
function assignment(area: AreaRef, staffRoleId: string) {
  return {
    departmentId: area.kind === "department" ? area.id : null,
    stationId: area.kind === "station" ? area.id : null,
    staffRoleId,
  };
}
export async function addRotaShift(
  tx: Transaction,
  cfg: Cfg,
  input: RotaShiftInput,
): Promise<string> {
  if (!isRotaWeek(input.week)) throw invalid("week");
  if (
    !isLocalDate(input.businessDay) ||
    input.businessDay < input.week ||
    input.businessDay > addDays(input.week, 6)
  )
    throw invalid("businessDay");
  await assignmentTargets(tx, cfg, input.area, input.staffRoleId);
  const interval = await times(tx, cfg, input.businessDay, input.startsAt, input.endsAt);
  const { version } = await backend.getRoster(tx, { ...cfg, period: input.week });
  if (version && version.status !== "draft")
    throw new AppError("roster.not_draft", { rosterVersionId: version.id });
  const versionId =
    version?.id ?? (await backend.createRosterVersion(tx, { ...cfg, period: input.week }));
  const shiftId = await backend.addShift(tx, {
    ...cfg,
    ...interval,
    versionId,
    personId: input.personId,
  });
  await tx
    .insert(shiftAssignments)
    .values({ shiftId, ...assignment(input.area, input.staffRoleId) });
  return shiftId;
}
async function writableShift(tx: Transaction, cfg: Cfg, shiftId: string) {
  const [row] = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.locationId, cfg.locationId)));
  if (!row) throw new AppError("shift.not_found", { shiftId });
  if (row.rosterVersionId !== null) {
    const v = await backend.getRosterVersion(tx, { versionId: row.rosterVersionId });
    if (v.status !== "draft") throw new AppError("roster.not_draft", { rosterVersionId: v.id });
  }
  return row;
}
async function unattachedWeek(
  tx: Transaction,
  cfg: Cfg,
  row: Pick<typeof shifts.$inferSelect, "startsAt" | "startsOffsetMinutes">,
) {
  const localDate = new Date(Date.parse(row.startsAt) + row.startsOffsetMinutes * 60000)
    .toISOString()
    .slice(0, 10);
  const week = mondayOf(localDate);
  const { version } = await backend.getRoster(tx, { ...cfg, period: week });
  if (version?.status === "published")
    throw new AppError("roster.not_draft", { rosterVersionId: version.id });
  return { week, version };
}
export async function updateRotaShift(
  tx: Transaction,
  cfg: Cfg,
  shiftId: string,
  patch: RotaShiftPatch,
): Promise<void> {
  const row = await writableShift(tx, cfg, shiftId);
  if (Object.keys(patch).length === 0) return;
  if (row.rosterVersionId === null) {
    const { week, version } = await unattachedWeek(tx, cfg, row);
    const versionId =
      version?.id ?? (await backend.createRosterVersion(tx, { ...cfg, period: week }));
    await tx.update(shifts).set({ rosterVersionId: versionId }).where(eq(shifts.id, shiftId));
  }
  const [prior] = await tx
    .select()
    .from(shiftAssignments)
    .where(eq(shiftAssignments.shiftId, shiftId));
  if (patch.area !== undefined || patch.staffRoleId !== undefined) {
    const area =
      patch.area ??
      (prior?.departmentId
        ? { kind: "department" as const, id: prior.departmentId }
        : prior?.stationId
          ? { kind: "station" as const, id: prior.stationId }
          : null);
    const staffRoleId = patch.staffRoleId ?? prior?.staffRoleId;
    if (!area) throw invalid("area");
    if (!staffRoleId) throw invalid("staffRoleId");
    await assignmentTargets(tx, cfg, area, staffRoleId);
    await tx
      .insert(shiftAssignments)
      .values({ shiftId, ...assignment(area, staffRoleId) })
      .onConflictDoUpdate({ target: shiftAssignments.shiftId, set: assignment(area, staffRoleId) });
  }
  if (patch.personId !== undefined || patch.startsAt !== undefined || patch.endsAt !== undefined) {
    const clock = await readLocationClock(tx, cfg.locationId);
    const placed = placeShift({ shiftId, area: null, staffRoleId: null, ...row }, (d) =>
      cutoverForBusinessDay(clock, d),
    );
    const wall = (at: string, offset: number) =>
      new Date(Date.parse(at) + offset * 60000).toISOString().slice(11, 16);
    const interval =
      patch.startsAt !== undefined || patch.endsAt !== undefined
        ? await times(
            tx,
            cfg,
            placed.businessDay,
            patch.startsAt ?? wall(row.startsAt, row.startsOffsetMinutes),
            patch.endsAt ?? wall(row.endsAt, row.endsOffsetMinutes),
          )
        : {};
    await backend.updateShift(tx, {
      shiftId,
      ...interval,
      ...(patch.personId !== undefined ? { personId: patch.personId } : {}),
    });
  }
}
export async function removeRotaShift(tx: Transaction, cfg: Cfg, shiftId: string): Promise<void> {
  const row = await writableShift(tx, cfg, shiftId);
  if (row.rosterVersionId === null) await unattachedWeek(tx, cfg, row);
  await backend.removeShift(tx, { shiftId });
}

export async function changeRotaWeek(tx: Transaction, cfg: Cfg, week: string) {
  if (!isRotaWeek(week)) throw invalid("week");
  const { version } = await backend.getRoster(tx, { ...cfg, period: week });
  if (!version) throw invalid("week");
  if (version.status === "draft")
    throw new AppError("roster.draft_exists", { locationId: cfg.locationId });
  const copied = await backend.copyPublishedToDraft(tx, { versionId: version.id });
  for (const [original, shiftId] of copied.shiftIds) {
    const [row] = await tx
      .select()
      .from(shiftAssignments)
      .where(eq(shiftAssignments.shiftId, original));
    if (row) await tx.insert(shiftAssignments).values({ ...row, shiftId });
  }
  return { versionId: copied.versionId, openSwaps: copied.openSwaps };
}
