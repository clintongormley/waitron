import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { kitchenStations, products, readVenueClock, type Transaction } from "@waitron/db";
import { effectiveProductColumns, parentJoin, parentProducts } from "@waitron/menu";
import { readSpecialDayPlan, resolveDepartmentsDays } from "./day-resolver.js";
import { LAST_ORDER_MINUTES } from "./menu-timetable-rules.js";
import type { LastOrderChoice, LastOrderDraftMenus } from "./menu-timetable-types.js";
import { serviceRuns } from "./menu-timetable.js";
import { periodProductIds } from "./routing-periods.js";
import { loadRoutingRules } from "./routing-store.js";
import { selectRoutingCell, targetKey } from "./routing.js";
import { readDepartmentSeasonWeeks } from "./season-weeks.js";
import { serviceDayWallContext } from "./service-day-context.js";
import { rangeSpan, type ServiceRange } from "./service-day.js";
import { listSpecialDays } from "./special-days.js";
import { readServiceZones } from "./zone-closed-times.js";

type PeriodMenus = Omit<LastOrderDraftMenus, "periodId"> & { id: string };
type Zone = Awaited<ReturnType<typeof readServiceZones>>[number];

export async function readLastOrderRouting(
  tx: Transaction,
  periods: readonly PeriodMenus[],
  zones: readonly Zone[],
) {
  const offered = await periodProductIds(tx, periods);
  const offeredIds = [...new Set([...offered.values()].flat())];
  const routedId = sql<string>`coalesce(${products.parentId}, ${products.id})`;
  const productRows = await tx
    .selectDistinct({ routedId, categoryId: effectiveProductColumns.categoryId })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(and(eq(products.active, true), inArray(routedId, offeredIds)));
  const rules = {
    ...(await loadRoutingRules(tx, null)),
    zoneDepartment: new Map(zones.map(({ id, departmentId }) => [id, departmentId])),
  };
  return new Map(
    periods.map((period) => {
      const ids = new Set(offered.get(period.id)!);
      const dishes = productRows.filter((product) => ids.has(product.routedId));
      const servedZones = zones.filter((zone) => zone.departmentId === period.departmentId);
      const cached = new Map<string | null, ReadonlyMap<string, Set<string>>>();
      return [
        period.id,
        (routePeriodId: string | null) => {
          const found = cached.get(routePeriodId);
          if (found) return found;
          const result = new Map<string, Set<string>>();
          const running =
            routePeriodId === null ? undefined : new Map([[period.departmentId, routePeriodId]]);
          for (const zone of servedZones) {
            for (const dish of dishes) {
              const { target } = selectRoutingCell(
                rules,
                { kind: "product", productId: dish.routedId },
                zone.id,
                dish.categoryId,
                { periods: running },
              );
              if (
                !target ||
                (target.kind === "station" && !rules.activeStationIds.has(target.stationId))
              )
                continue;
              const key = targetKey(target);
              const reachedZones = result.get(key) ?? new Set<string>();
              reachedZones.add(zone.id);
              result.set(key, reachedZones);
            }
          }
          cached.set(routePeriodId, result);
          return result;
        },
      ] as const;
    }),
  );
}

export function lastOrderRuns(ranges: readonly ServiceRange[], cutover: string) {
  return serviceRuns(ranges).map((run) => ({ periodId: run.periodId, ...rangeSpan(run, cutover) }));
}

export function* afterPeriod(runs: ReturnType<typeof lastOrderRuns>, start: number, end: number) {
  for (const run of runs) {
    if (run.end <= start) continue;
    if (run.start >= end) break;
    if (run.start > start) yield { start, end: run.start, periodId: null };
    yield {
      start: Math.max(start, run.start),
      end: Math.min(end, run.end),
      periodId: run.periodId,
    };
    start = run.end;
  }
  if (start < end) yield { start, end, periodId: null };
}

export async function readLastOrderChoices(
  tx: Transaction,
  draft: LastOrderDraftMenus,
): Promise<LastOrderChoice[]> {
  const { departmentId, periodId } = draft;
  const id = periodId ?? "";
  const zones = (await readServiceZones(tx)).filter((zone) => zone.departmentId === departmentId);
  const route = (await readLastOrderRouting(tx, [{ ...draft, id }], zones)).get(id)!;
  const running = new Set<string | null>([periodId ?? null]);
  if (periodId !== undefined) {
    const clock = await readVenueClock(tx);
    let painted = false;
    const addSuccessors = (ranges: readonly ServiceRange[], cutover: string, endMinute: number) => {
      const runs = lastOrderRuns(ranges, cutover);
      for (const run of runs) {
        if (run.periodId !== periodId || run.start >= endMinute) continue;
        painted = true;
        for (const later of afterPeriod(
          runs,
          run.end,
          Math.min(endMinute, run.end + LAST_ORDER_MINUTES.at(-1)!),
        ))
          running.add(later.periodId);
      }
    };
    const weeks = await readDepartmentSeasonWeeks(tx, [departmentId], clock.dayCutover);
    for (const week of weeks.get(departmentId)?.values() ?? [])
      for (const ranges of week) addSuccessors(ranges, clock.dayCutover, 1440);
    for (const special of await listSpecialDays(tx)) {
      const day = await readSpecialDayPlan(tx, special.id);
      if (!day) continue;
      const dates = day.dates.map(({ storedDate }) => storedDate);
      const resolved = await resolveDepartmentsDays(tx, [departmentId], dates, clock, day.plan);
      for (const [date, { ranges }] of resolved.get(departmentId) ?? []) {
        const context = serviceDayWallContext(clock, date);
        addSuccessors(ranges, context.dayCutover, context.endMinute);
      }
    }
    if (!painted) running.add(null);
  }
  const reached = new Set([...running].flatMap((period) => [...route(period).keys()]));
  const stations = await tx
    .select({ stationId: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(eq(kitchenStations.active, true))
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  const choices: LastOrderChoice[] = stations.flatMap((station) =>
    reached.has(targetKey({ kind: "station", stationId: station.stationId }))
      ? [{ kind: "station", ...station }]
      : [],
  );
  if (reached.has("no_preparation")) choices.push({ kind: "no_preparation", name: null });
  return choices;
}
