import { and, eq, inArray, sql } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { effectiveProductColumns, parentJoin, parentProducts } from "@waitron/catalogue";
import type { BusinessDayClock } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import type { CalendarColour, LocalDate } from "./hours-types.js";
import { addDays } from "./hours-rules.js";
import {
  readDayPlan,
  resolveDepartmentsDays,
  resolveZoneClosedDays,
  type DayPlan,
} from "./day-resolver.js";
import { readActiveDepartments, readActivePeriods, serviceRuns } from "./menu-timetable.js";
import { readDepartmentSeasonWeeks, readZoneSeasonWeeks } from "./season-weeks.js";
import { readServiceZones } from "./zone-closed-times.js";
import { periodProductIds } from "./routing-periods.js";
import { loadRoutingRules } from "./routing-store.js";
import { selectRoutingCell } from "./routing.js";
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
const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

type Span = { start: number; end: number };
function plannedSpan(
  range: ClosedRange,
  context: Pick<ServiceDayContext, "dayCutover" | "endMinute">,
): Span {
  const span = rangeSpanInDay(range, context);
  return { ...span, end: Math.min(span.end, context.endMinute) };
}
function subtract(
  range: Span,
  closed: readonly ClosedRange[],
  context: Pick<ServiceDayContext, "dayCutover" | "endMinute">,
): Span[] {
  let shares = [range];
  for (const closure of closed) {
    const { start, end } = plannedSpan(closure, context);
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
  cfg: VenueScope,
  stationIds: readonly string[],
  request: ServiceGuideRequest,
): Promise<PlannedServiceGuides> {
  const departments = await readActiveDepartments(tx, cfg);
  const periods = await readActivePeriods(tx, cfg);
  const departmentIds = departments.map(({ id }) => id);
  const columns = request.kind === "season" ? WEEKDAYS.map(String) : [...new Set(request.dates)];
  const previous = (column: string) =>
    request.kind === "season" ? String((Number(column) + 6) % 7) : addDays(column, -1);
  const context = (column: string): Context =>
    request.kind === "season"
      ? { dayCutover: request.cutover, endMinute: 1440 }
      : serviceDayWallContext(request.clock, column);
  const needed = [
    ...new Set(
      columns.flatMap((column) => (stationIds.length ? [column, previous(column)] : [column])),
    ),
  ];
  const zones = stationIds.length ? await readServiceZones(tx, cfg) : [];
  const departmentRanges = new Map<string, Map<string, readonly ServiceRange[]>>();
  let closures: ReadonlyMap<string, ReadonlyMap<string, readonly ClosedRange[]>>;
  if (request.kind === "season") {
    const only = { seasonIds: [request.seasonId], weekdays: WEEKDAYS };
    const weeks = await readDepartmentSeasonWeeks(tx, cfg, departmentIds, request.cutover, only);
    const zoneWeeks = await readZoneSeasonWeeks(
      tx,
      cfg,
      zones.map(({ id }) => id),
      request.cutover,
      only,
    );
    for (const id of departmentIds)
      departmentRanges.set(
        id,
        new Map(
          needed.map((column) => [
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
    const missing = needed.filter(
      (day) => !request.plan?.seasonIdOn.has(day) || !request.plan.special.has(day),
    );
    const extra = missing.length
      ? await readDayPlan(tx, cfg, missing)
      : { seasonIdOn: new Map(), special: new Map() };
    const plan: DayPlan = {
      seasonIdOn: new Map([...extra.seasonIdOn, ...(request.plan?.seasonIdOn ?? [])]),
      special: new Map([...extra.special, ...(request.plan?.special ?? [])]),
    };
    const days = await resolveDepartmentsDays(tx, cfg, departmentIds, needed, request.clock, plan);
    for (const id of departmentIds)
      departmentRanges.set(
        id,
        new Map(needed.map((column) => [column, days.get(id)?.get(column)?.ranges ?? []])),
      );
    closures = await resolveZoneClosedDays(
      tx,
      cfg,
      zones.map(({ id }) => id),
      needed,
      request.clock,
      plan,
    );
  }
  const stationRanges = new Map<string, Map<string, GuideDepartmentRanges>>();
  for (const id of stationIds)
    stationRanges.set(id, new Map(columns.map((column) => [column, []])));
  if (stationIds.length) {
    // Planning uses untimed routes: today's station closures and kept-open extensions do not author demand.
    const offered = await periodProductIds(tx, periods);
    const offeredIds = [...new Set([...offered.values()].flat())];
    const routedId = sql<string>`coalesce(${products.parentId}, ${products.id})`;
    const productRows = await tx
      .select({ routedId, categoryId: effectiveProductColumns.categoryId })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(and(eq(products.active, true), inArray(routedId, offeredIds)));
    const base = await loadRoutingRules(tx, cfg, null);
    const rules = {
      ...base,
      zoneDepartment: new Map(zones.map(({ id, departmentId }) => [id, departmentId])),
    };
    const requested = new Set(stationIds.filter((id) => rules.activeStationIds.has(id)));
    const reaches = new Map<string, Map<string, Set<string>>>();
    for (const period of periods) {
      const ids = new Set(offered.get(period.id)!);
      const facts = productRows.filter((product) => ids.has(product.routedId));
      const targets = new Map<string, Set<string>>();
      for (const zone of zones.filter((zone) => zone.departmentId === period.departmentId)) {
        for (const product of facts) {
          const target = selectRoutingCell(
            rules,
            { kind: "product", productId: product.routedId },
            zone.id,
            product.categoryId,
            { periods: new Map([[period.departmentId, period.id]]) },
          ).target;
          if (target?.kind !== "station" || !requested.has(target.stationId)) continue;
          const zoneIds = targets.get(target.stationId) ?? new Set<string>();
          zoneIds.add(zone.id);
          targets.set(target.stationId, zoneIds);
        }
      }
      reaches.set(period.id, targets);
    }
    const offsets = new Map(periods.map((period) => [period.id, period.endOffsetMinutes]));
    for (const stationId of requested) {
      for (const column of columns) {
        const current = context(column);
        const priorKey = previous(column);
        const prior = context(priorKey);
        const distance = 1440 + clockMinutes(current.dayCutover) - clockMinutes(prior.dayCutover);
        const results: { departmentId: string; ranges: ServiceRange[] }[] = [];
        for (const departmentId of departmentIds) {
          const byPeriod = new Map<string, Span[]>();
          for (const [key, origin, shift] of [
            [column, current, 0],
            [priorKey, prior, distance],
          ] as const) {
            for (const slot of serviceRuns(departmentRanges.get(departmentId)?.get(key) ?? [])) {
              const raw = rangeSpan(slot, origin.dayCutover);
              const offset = offsets.get(slot.periodId) ?? 0;
              if (shift && offset <= 0) continue;
              const sendingEnd = shift ? Math.min(raw.end, origin.endMinute) : raw.end;
              const end = sendingEnd + offset - shift;
              const sending = {
                start: Math.max(0, raw.start - shift),
                end: Math.min(end, current.endMinute),
              };
              if (sending.end <= sending.start) continue;
              const shares = byPeriod.get(slot.periodId) ?? [];
              for (const zoneId of reaches.get(slot.periodId)?.get(stationId) ?? [])
                shares.push(...subtract(sending, closures.get(zoneId)?.get(column) ?? [], current));
              byPeriod.set(slot.periodId, shares);
            }
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
    periods,
    departmentRanges: new Map(
      [...departmentRanges].map(([id, days]) => [
        id,
        new Map(columns.map((column) => [column, days.get(column) ?? []])),
      ]),
    ),
    stationRanges,
  };
}
