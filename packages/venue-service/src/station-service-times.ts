import { and, eq, sql } from "drizzle-orm";
import { kitchenStations, products, type Transaction } from "@waitron/db";
import { effectiveProductColumns, parentJoin, parentProducts } from "@waitron/catalogue";
import { AppError } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import type { LocalDate } from "./hours-types.js";
import { addDays, isLocalDate, weekdayOf } from "./hours-rules.js";
import { occursOn } from "./named-day-rules.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { periodProductIds } from "./routing-periods.js";
import { loadRoutingRules } from "./routing-store.js";
import { selectRoutingCell } from "./routing.js";
import { rangeSpan, type ServiceRange, type ClosedRange } from "./service-day.js";
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
function subtract(range: Span, closed: readonly ClosedRange[], cutover: string): Span[] {
  let shares = [range];
  for (const closure of closed) {
    const { start, end } = rangeSpan(closure, cutover);
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
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.locationId, cfg.locationId)));
  if (!station) throw new AppError("station.not_found", { stationId });
  if (!station.active) return { always: "switched_off", days: [] };
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
  const days: StationServiceDay[] = [];
  for (let index = 0; index < dayCount; index++) {
    const date = addDays(from, index);
    const named = model.namedDays.find((day) => occursOn(day, date));
    const weekday = weekdayOf(date);
    const results: StationServiceDay["departments"][number][] = [];
    if (!named?.closeWholeVenue)
      for (const department of departments) {
        const own = named?.ownHours
          ? department.dates.find((day) => day.specialDateId === named.id)
          : undefined;
        const slots = own?.slots ?? department.week.find((day) => day.weekday === weekday)!.slots;
        const byPeriod = new Map<string, Span[]>();
        for (const slot of slots) {
          const shares = byPeriod.get(slot.periodId) ?? [];
          for (const zone of department.zones) {
            if (!reaches.get(slot.periodId)?.has(zone.id)) continue;
            const closed = named?.ownHours
              ? (zone.dates.find((day) => day.specialDateId === named.id)?.ranges ?? [])
              : zone.week.find((day) => day.weekday === weekday)!.ranges;
            shares.push(...subtract(rangeSpan(slot, model.dayCutover), closed, model.dayCutover));
          }
          byPeriod.set(slot.periodId, shares);
        }
        const ranges = [...byPeriod]
          .flatMap(([periodId, shares]) =>
            union(shares).map(({ start, end }) => ({
              periodId,
              startsAt: timeAt(start, model.dayCutover),
              endsAt: timeAt(end, model.dayCutover),
            })),
          )
          .sort(
            (a, b) => rangeSpan(a, model.dayCutover).start - rangeSpan(b, model.dayCutover).start,
          );
        if (ranges.length > 0) results.push({ departmentId: department.id, ranges });
      }
    days.push({ date, departments: results });
  }
  return { always: null, days };
}
