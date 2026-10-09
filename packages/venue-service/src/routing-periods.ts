import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { loadSectionGraph, reachableProducts } from "@waitron/catalogue";
import type { VenueScope } from "./operations.js";
import type { RoutingPeriod } from "./routing-types.js";
import { menuDayTimetables, menuPeriods, menuPeriodStaffMenus, menuSlots } from "./schema/menus.js";
import { departments } from "./schema/service.js";
import { rangeSpan } from "./service-day.js";

type PeriodRow = Omit<RoutingPeriod, "productIds"> & { menuId: string };

/** The venue's periods, or only those of `ids` that are the venue's. */
export async function readPeriods(
  tx: Transaction,
  cfg: VenueScope,
  ids?: readonly string[],
): Promise<PeriodRow[]> {
  if (ids?.length === 0) return [];
  return tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      departmentName: departments.name,
      name: menuPeriods.name,
      colour: menuPeriods.colour,
      menuId: menuPeriods.menuId,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        ids === undefined ? undefined : inArray(menuPeriods.id, [...ids]),
      ),
    );
}

/**
 * The products each period's customer menu and staff-only menus reach, variants by their parent's
 * id, as routing names them.
 */
export async function periodProductIds(
  tx: Transaction,
  periods: readonly { id: string; menuId: string }[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (periods.length === 0) return found;
  const menusOf = new Map(periods.map((period) => [period.id, [period.menuId]]));
  for (const row of await tx
    .select({ periodId: menuPeriodStaffMenus.periodId, menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .where(inArray(menuPeriodStaffMenus.periodId, [...menusOf.keys()]))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId)))
    menusOf.get(row.periodId)!.push(row.menuId);
  const graph = await loadSectionGraph(tx);
  const rootOf = new Map(graph.roots().map((root) => [root.menuId, root.sectionId]));
  const parentOf = new Map(
    (
      await tx
        .select({ id: products.id, parentId: products.parentId })
        .from(products)
        .where(isNotNull(products.parentId))
    ).map((row) => [row.id, row.parentId!]),
  );
  const reached = new Map<string, string[]>();
  for (const [periodId, menuIds] of menusOf) {
    const ids = new Set<string>();
    for (const menuId of menuIds) {
      const root = rootOf.get(menuId);
      if (root === undefined) continue;
      let products = reached.get(root);
      if (products === undefined) reached.set(root, (products = reachableProducts(graph, root)));
      for (const productId of products) ids.add(parentOf.get(productId) ?? productId);
    }
    found.set(periodId, [...ids]);
  }
  return found;
}

/** The venue's periods with their products, in `inPeriodOrder`. */
export async function readRoutingPeriods(
  tx: Transaction,
  cfg: VenueScope,
  dayCutover: string,
): Promise<RoutingPeriod[]> {
  const periods = await readPeriods(tx, cfg);
  const productIds = await periodProductIds(tx, periods);
  return (await inPeriodOrder(tx, cfg, periods, dayCutover)).map(
    ({ id, departmentId, departmentName, name, colour }) => ({
      id,
      departmentId,
      departmentName,
      name,
      colour,
      productIds: productIds.get(id)!,
    }),
  );
}

/**
 * Departments default first, then by name; within one, by each period's earliest start in the
 * normal week, Monday first and each day from the changeover, a period the week never places last,
 * then by name.
 */
export async function inPeriodOrder<T extends { id: string; departmentId: string; name: string }>(
  tx: Transaction,
  cfg: VenueScope,
  periods: readonly T[],
  dayCutover: string,
): Promise<T[]> {
  const departmentRows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const departmentOrder = new Map(departmentRows.map((row, index) => [row.id, index]));
  const slots = await tx
    .select({
      periodId: menuSlots.periodId,
      weekday: menuDayTimetables.weekday,
      startsAt: menuSlots.startsAt,
      endsAt: menuSlots.endsAt,
    })
    .from(menuSlots)
    .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
    .innerJoin(departments, eq(departments.id, menuDayTimetables.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), isNotNull(menuDayTimetables.weekday)));
  const firstStart = new Map<string, number>();
  for (const slot of slots) {
    const span = rangeSpan(
      { startsAt: slot.startsAt.slice(0, 5), endsAt: slot.endsAt.slice(0, 5) },
      dayCutover.slice(0, 5),
    );
    const start = ((slot.weekday! + 6) % 7) * 1440 + span.start;
    firstStart.set(slot.periodId, Math.min(start, firstStart.get(slot.periodId) ?? start));
  }
  const startOf = (id: string) => firstStart.get(id) ?? Number.POSITIVE_INFINITY;
  return [...periods].sort(
    (a, b) =>
      departmentOrder.get(a.departmentId)! - departmentOrder.get(b.departmentId)! ||
      startOf(a.id) - startOf(b.id) ||
      // A department's period names are unique (`menu_periods_department_name_key`).
      a.name.localeCompare(b.name),
  );
}
