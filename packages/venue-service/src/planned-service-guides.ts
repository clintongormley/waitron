import type { Transaction } from "@waitron/db";
import type { BusinessDayClock } from "@waitron/shared";
import type { CalendarColour, LocalDate } from "./hours-types.js";
import {
  readDayPlan,
  resolveDepartmentsDays,
  resolveZoneClosedDays,
  type DayPlan,
} from "./day-resolver.js";
import { readActiveDepartments, readActivePeriods } from "./menu-timetable.js";
import { readDepartmentSeasonWeeks, readZoneSeasonWeeks } from "./season-weeks.js";
import { readServiceZones } from "./zone-closed-times.js";
import { afterPeriod, lastOrderRuns, readLastOrderRouting } from "./last-order-routing.js";
import { targetKey } from "./routing.js";
import { rangeSpan, rangeSpanInDay, type ServiceRange, type ClosedRange } from "./service-day.js";
import { serviceDayWallContext, type ServiceDayContext } from "./service-day-context.js";

export type ServiceGuideRequest =
  | { kind: "season"; seasonId: string; cutover: string }
  | { kind: "dates"; dates: readonly LocalDate[]; clock: BusinessDayClock; plan?: DayPlan };
export type GuideDepartmentRanges = readonly {
  departmentId: string;
  ranges: readonly ServiceRange[];
}[];
export interface PlannedServiceGuides {
  departments: readonly { id: string; name: string }[];
  periods: readonly { id: string; departmentId: string; name: string; colour: CalendarColour }[];
  departmentRanges: ReadonlyMap<string, ReadonlyMap<string, readonly ServiceRange[]>>;
  stationRanges: ReadonlyMap<string, ReadonlyMap<string, GuideDepartmentRanges>>;
}

type Context = Pick<ServiceDayContext, "dayCutover" | "endMinute">;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

type Span = { start: number; end: number };
function plannedSpan(
  range: ClosedRange,
  context: Pick<ServiceDayContext, "dayCutover" | "endMinute">,
): Span {
  const span = rangeSpanInDay(range, context);
  return { ...span, end: Math.min(span.end, context.endMinute) };
}
function subtract(range: Span, blocked: readonly Span[]): Span[] {
  let shares = [range];
  for (const { start, end } of blocked) {
    shares = shares.flatMap((share) => {
      if (end <= share.start || start >= share.end) return [share];
      return [
        ...(start > share.start ? [{ start: share.start, end: start }] : []),
        ...(end < share.end ? [{ start: end, end: share.end }] : []),
      ];
    });
  }
  return shares;
}
function union(shares: Span[]): Span[] {
  const joined: Span[] = [];
  for (const share of shares.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = joined[joined.length - 1];
    if (last && share.start <= last.end) last.end = Math.max(last.end, share.end);
    else joined.push({ ...share });
  }
  return joined;
}
function timeAt(minute: number, cutover: string): string {
  const [hour, minuteOfHour] = cutover.split(":").map(Number);
  const clock = (hour! * 60 + minuteOfHour! + minute) % 1440;
  return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}

export async function readPlannedServiceGuides(
  tx: Transaction,
  stationIds: readonly string[],
  request: ServiceGuideRequest,
): Promise<PlannedServiceGuides> {
  const departments = await readActiveDepartments(tx);
  const periods = await readActivePeriods(tx);
  const departmentIds = departments.map(({ id }) => id);
  const columns = request.kind === "season" ? WEEKDAYS.map(String) : [...new Set(request.dates)];
  const context = (column: string): Context =>
    request.kind === "season"
      ? { dayCutover: request.cutover, endMinute: 1440 }
      : serviceDayWallContext(request.clock, column);
  const zones = stationIds.length ? await readServiceZones(tx) : [];
  const departmentRanges = new Map<string, Map<string, readonly ServiceRange[]>>();
  let closures: ReadonlyMap<string, ReadonlyMap<string, readonly ClosedRange[]>>;
  if (request.kind === "season") {
    const only = { seasonIds: [request.seasonId], weekdays: WEEKDAYS };
    const weeks = await readDepartmentSeasonWeeks(tx, departmentIds, request.cutover, only);
    const zoneWeeks = await readZoneSeasonWeeks(
      tx,
      zones.map(({ id }) => id),
      request.cutover,
      only,
    );
    for (const id of departmentIds)
      departmentRanges.set(
        id,
        new Map(
          columns.map((column) => [
            column,
            weeks.get(id)?.get(request.seasonId)?.[Number(column)] ?? [],
          ]),
        ),
      );
    closures = new Map(
      zones.map(({ id }) => [
        id,
        new Map(
          columns.map((column) => [
            column,
            zoneWeeks.get(id)?.get(request.seasonId)?.[Number(column)] ?? [],
          ]),
        ),
      ]),
    );
  } else {
    const missing = columns.filter(
      (day) => !request.plan?.seasonIdOn.has(day) || !request.plan.special.has(day),
    );
    const extra = missing.length
      ? await readDayPlan(tx, missing)
      : { seasonIdOn: new Map(), special: new Map() };
    const plan: DayPlan = {
      seasonIdOn: new Map([...extra.seasonIdOn, ...(request.plan?.seasonIdOn ?? [])]),
      special: new Map([...extra.special, ...(request.plan?.special ?? [])]),
    };
    const days = await resolveDepartmentsDays(tx, departmentIds, columns, request.clock, plan);
    for (const id of departmentIds)
      departmentRanges.set(
        id,
        new Map(columns.map((column) => [column, days.get(id)?.get(column)?.ranges ?? []])),
      );
    closures = await resolveZoneClosedDays(
      tx,
      zones.map(({ id }) => id),
      columns,
      request.clock,
      plan,
    );
  }
  const stationRanges = new Map<string, Map<string, GuideDepartmentRanges>>();
  for (const id of stationIds)
    stationRanges.set(id, new Map(columns.map((column) => [column, []])));
  if (stationIds.length) {
    const routing = await readLastOrderRouting(tx, periods, zones);
    const adjustments = new Map(
      periods.map(({ id, lastOrders }) => [
        id,
        new Map(lastOrders.map((entry) => [targetKey(entry), entry.minutes])),
      ]),
    );
    for (const stationId of stationIds) {
      const target = targetKey({ kind: "station", stationId });
      for (const column of columns) {
        const current = context(column);
        const results: { departmentId: string; ranges: ServiceRange[] }[] = [];
        const closed = (zoneId: string) =>
          (closures.get(zoneId)?.get(column) ?? []).map((range) => plannedSpan(range, current));
        for (const departmentId of departmentIds) {
          const byPeriod = new Map<string, Span[]>();
          const runs = lastOrderRuns(
            departmentRanges.get(departmentId)?.get(column) ?? [],
            current.dayCutover,
          ).filter(({ start }) => start < current.endMinute);
          const add = (periodId: string, spans: Span[]) => {
            const existing = byPeriod.get(periodId) ?? [];
            existing.push(...spans);
            byPeriod.set(periodId, existing);
          };
          for (const run of runs) {
            const painted = { start: run.start, end: Math.min(run.end, current.endMinute) };
            const zones = routing.get(run.periodId)?.(run.periodId).get(target) ?? [];
            for (const zone of zones) add(run.periodId, subtract(painted, closed(zone)));
          }
          // Painted hours own their span. Of the extensions, the latest period to end owns overlap.
          const occupied = [...byPeriod.values()].flat();
          for (const { periodId, end } of [...runs].reverse()) {
            const minutes = adjustments.get(periodId)?.get(target) ?? 0;
            if (minutes <= 0) continue;
            const route = routing.get(periodId)!;
            const shares: Span[] = [];
            for (const window of afterPeriod(
              runs,
              end,
              Math.min(end + minutes, current.endMinute),
            )) {
              for (const zone of route(window.periodId).get(target) ?? [])
                shares.push(...subtract(window, closed(zone)));
            }
            const unclaimed = union(shares).flatMap((span) => subtract(span, occupied));
            add(periodId, unclaimed);
            occupied.push(...unclaimed);
          }
          const ranges = [...byPeriod]
            .flatMap(([periodId, shares]) =>
              union(shares).map(({ start, end }) => ({
                periodId,
                startsAt: timeAt(start, current.dayCutover),
                endsAt: timeAt(end, current.dayCutover),
              })),
            )
            .sort(
              (a, b) =>
                rangeSpan(a, current.dayCutover).start - rangeSpan(b, current.dayCutover).start,
            );
          if (ranges.length) results.push({ departmentId, ranges });
        }
        stationRanges.get(stationId)!.set(column, results);
      }
    }
  }
  return {
    departments,
    periods: periods.map(({ id, departmentId, name, colour, menuId, floorPlanSetId }) => ({
      id,
      departmentId,
      name,
      colour,
      menuId,
      floorPlanSetId,
    })),
    departmentRanges,
    stationRanges,
  };
}
