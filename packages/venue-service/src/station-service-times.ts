import { and, eq, sql } from "drizzle-orm";
import { kitchenStations, products, type Transaction } from "@waitron/db";
import { effectiveProductColumns, parentJoin, parentProducts } from "@waitron/catalogue";
import { AppError } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import type { LocalDate } from "./hours-types.js";
import { addDays, isLocalDate } from "./hours-rules.js";
import {
  readDayPlan,
  resolveDepartmentsDays,
  resolveZoneClosedDays,
  type DayPlan,
} from "./day-resolver.js";
import { seasonOn } from "./season-rules.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { periodProductIds } from "./routing-periods.js";
import { loadRoutingRules } from "./routing-store.js";
import { selectRoutingCell } from "./routing.js";
import { rangeSpan, rangeSpanInDay, type ServiceRange, type ClosedRange } from "./service-day.js";
import { serviceDayWallContext, type ServiceDayContext } from "./service-day-context.js";
import "./errors.js";

export interface StationServiceDay {
  readonly date: LocalDate;
  readonly departments: readonly { departmentId: string; ranges: readonly ServiceRange[] }[];
}
export interface StationServiceTimes {
  readonly always: "default" | "switched_off" | null;
  readonly days: readonly StationServiceDay[];
}

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

export async function stationServiceTimes(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  from: LocalDate,
  to: LocalDate,
  week: "normal" | "dated" = "dated",
): Promise<StationServiceTimes> {
  if (!isLocalDate(from)) throw new AppError("management.request_invalid", { field: "from" });
  if (!isLocalDate(to) || to < from)
    throw new AppError("management.request_invalid", { field: "to" });
  const dayCount =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (dayCount > 42) throw new AppError("management.request_invalid", { field: "to" });
  const [station] = await tx
    .select({ active: kitchenStations.active, isDefault: kitchenStations.isDefault })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, stationId),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (!station) throw new AppError("station.not_found", { stationId });
  if (station.isDefault) return { always: "default", days: [] };

  // Planning excludes daily station overrides and kept-open extensions.
  const model = await readOpeningHoursModel(tx, cfg, new Date(`${from}T00:00:00Z`));
  const departments = model.departments.filter((department) => department.active);
  const offered = await periodProductIds(
    tx,
    departments.flatMap((department) => department.periods),
  );
  const productRows = await tx
    .select({
      routedId: sql<string>`coalesce(${products.parentId}, ${products.id})`,
      categoryId: effectiveProductColumns.categoryId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.active, true));
  const base = await loadRoutingRules(tx, cfg, null);
  const rules = {
    ...base,
    zoneDepartment: new Map(
      departments.flatMap((department) =>
        department.zones.map((zone) => [zone.id, department.id] as const),
      ),
    ),
  };
  const reaches = new Map<string, Set<string>>();
  for (const department of departments) {
    for (const period of department.periods) {
      const productIds = new Set(offered.get(period.id)!);
      const facts = productRows.filter((product) => productIds.has(product.routedId));
      const zones = new Set<string>();
      for (const zone of department.zones) {
        if (
          facts.some((product) => {
            const target = selectRoutingCell(
              rules,
              { kind: "product", productId: product.routedId },
              zone.id,
              product.categoryId,
              { periods: new Map([[department.id, period.id]]) },
            ).target;
            return target?.kind === "station" && target.stationId === stationId;
          })
        )
          zones.add(zone.id);
      }
      reaches.set(period.id, zones);
    }
  }
  const dates = Array.from({ length: dayCount }, (_, index) => addDays(from, index));
  const clock = model.businessDayClock;
  const normalSeasonId = seasonOn(model.seasons, from)?.id ?? null;
  const plan: DayPlan =
    week === "normal"
      ? {
          seasonIdOn: new Map(dates.map((date) => [date, normalSeasonId])),
          special: new Map(dates.map((date) => [date, null])),
        }
      : await readDayPlan(tx, cfg, dates);
  const departmentDays = await resolveDepartmentsDays(
    tx,
    cfg,
    departments.map((department) => department.id),
    dates,
    clock,
    plan,
  );
  const zoneDays = await resolveZoneClosedDays(
    tx,
    cfg,
    departments.flatMap((department) => department.zones.map((zone) => zone.id)),
    dates,
    clock,
    plan,
  );
  const days: StationServiceDay[] = [];
  for (const date of dates) {
    const context = serviceDayWallContext(clock, date);
    const cutover = context.dayCutover;
    const results: StationServiceDay["departments"][number][] = [];
    for (const department of departments) {
      const slots = departmentDays.get(department.id)!.get(date)!.ranges;
      const byPeriod = new Map<string, Span[]>();
      for (const slot of slots) {
        const shares = byPeriod.get(slot.periodId) ?? [];
        for (const zone of department.zones) {
          if (!reaches.get(slot.periodId)?.has(zone.id)) continue;
          const closed = zoneDays.get(zone.id)!.get(date)!;
          shares.push(...subtract(plannedSpan(slot, context), closed, context));
        }
        byPeriod.set(slot.periodId, shares);
      }
      const ranges = [...byPeriod]
        .flatMap(([periodId, shares]) =>
          union(shares).map(({ start, end }) => ({
            periodId,
            startsAt: timeAt(start, cutover),
            endsAt: timeAt(end, cutover),
          })),
        )
        .sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
      if (ranges.length > 0) results.push({ departmentId: department.id, ranges });
    }
    days.push({ date, departments: results });
  }
  return { always: null, days };
}
