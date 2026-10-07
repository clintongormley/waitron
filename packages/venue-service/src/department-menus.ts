import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { catalogues, floorZones, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { MenuUse } from "./errors.js";
import type { VenueScope } from "./operations.js";
import { departmentAllDayMenus, departmentMenus, zoneAllDayMenus } from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import "./errors.js";

export interface DepartmentMenuList {
  departmentId: string;
  menuIds: string[];
  allDayMenuId: string | null;
}

/** Every department of the venue, inactive ones included, with its ordered list and default. */
export async function listDepartmentMenus(
  tx: Transaction,
  cfg: VenueScope,
): Promise<DepartmentMenuList[]> {
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const members = await tx
    .select({ departmentId: departmentMenus.departmentId, menuId: departmentMenus.menuId })
    .from(departmentMenus)
    .innerJoin(departments, eq(departments.id, departmentMenus.departmentId))
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(asc(departmentMenus.displayOrder), asc(departmentMenus.menuId));
  const defaults = await tx
    .select({
      departmentId: departmentAllDayMenus.departmentId,
      menuId: departmentAllDayMenus.menuId,
    })
    .from(departmentAllDayMenus)
    .innerJoin(departments, eq(departments.id, departmentAllDayMenus.departmentId))
    .where(eq(departments.locationId, cfg.locationId));
  const allDay = new Map(defaults.map((row) => [row.departmentId, row.menuId]));
  return rows.map(({ id }) => ({
    departmentId: id,
    menuIds: members.filter((row) => row.departmentId === id).map((row) => row.menuId),
    allDayMenuId: allDay.get(id) ?? null,
  }));
}

async function assertDepartment(tx: Transaction, cfg: VenueScope, departmentId: string) {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

async function assertMenus(tx: Transaction, menuIds: readonly string[]) {
  if (menuIds.length === 0) return;
  const found = new Set(
    (
      await tx
        .select({ id: catalogues.id })
        .from(catalogues)
        .where(inArray(catalogues.id, [...menuIds]))
    ).map((row) => row.id),
  );
  const missing = menuIds.find((menuId) => !found.has(menuId));
  if (missing !== undefined) throw new AppError("catalogue.not_found", { catalogueId: missing });
}

async function assertMember(tx: Transaction, departmentId: string, menuId: string): Promise<void> {
  const [row] = await tx
    .select({ menuId: departmentMenus.menuId })
    .from(departmentMenus)
    .where(and(eq(departmentMenus.departmentId, departmentId), eq(departmentMenus.menuId, menuId)));
  if (row === undefined) throw new AppError("department_menu.not_found", { departmentId, menuId });
}

/** What still names each of `menuIds` in the department, in the order of `menuIds`. */
async function menuUses(
  tx: Transaction,
  departmentId: string,
  menuIds: readonly string[],
): Promise<Map<string, MenuUse[]>> {
  const uses = new Map<string, MenuUse[]>(menuIds.map((menuId) => [menuId, []]));
  for (const row of await tx
    .select({ menuId: departmentAllDayMenus.menuId })
    .from(departmentAllDayMenus)
    .where(
      and(
        eq(departmentAllDayMenus.departmentId, departmentId),
        inArray(departmentAllDayMenus.menuId, [...menuIds]),
      ),
    ))
    uses.get(row.menuId)!.push({ kind: "department_all_day" });
  for (const row of await tx
    .select({ zoneId: zoneAllDayMenus.zoneId, menuId: zoneAllDayMenus.menuId })
    .from(zoneAllDayMenus)
    .innerJoin(floorZones, eq(floorZones.id, zoneAllDayMenus.zoneId))
    .where(
      and(
        eq(zoneAllDayMenus.departmentId, departmentId),
        inArray(zoneAllDayMenus.menuId, [...menuIds]),
      ),
    )
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id)))
    uses.get(row.menuId)!.push({ kind: "zone_all_day", zoneId: row.zoneId });
  return uses;
}

/**
 * Replaces the department's ordered list. Removing a menu something still names is refused
 * `department_menu.in_use` with every use. Writes by difference, because the defaults hold keys
 * into the rows a delete-all-then-insert would remove.
 */
export async function setDepartmentMenus(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  menuIds: readonly string[],
): Promise<void> {
  if (new Set(menuIds).size !== menuIds.length)
    throw new AppError("management.request_invalid", { field: "menuIds" });
  await assertDepartment(tx, cfg, departmentId);
  await assertMenus(tx, menuIds);
  const current = await tx
    .select({ menuId: departmentMenus.menuId })
    .from(departmentMenus)
    .where(eq(departmentMenus.departmentId, departmentId))
    .orderBy(asc(departmentMenus.displayOrder), asc(departmentMenus.menuId));
  const kept = new Set(menuIds);
  const removed = current.map((row) => row.menuId).filter((menuId) => !kept.has(menuId));
  if (removed.length > 0) {
    for (const [menuId, uses] of await menuUses(tx, departmentId, removed))
      if (uses.length > 0)
        throw new AppError("department_menu.in_use", { departmentId, menuId, uses });
    await tx
      .delete(departmentMenus)
      .where(
        and(
          eq(departmentMenus.departmentId, departmentId),
          inArray(departmentMenus.menuId, removed),
        ),
      );
  }
  if (menuIds.length === 0) return;
  await tx
    .insert(departmentMenus)
    .values(menuIds.map((menuId, displayOrder) => ({ departmentId, menuId, displayOrder })))
    .onConflictDoUpdate({
      target: [departmentMenus.departmentId, departmentMenus.menuId],
      set: { displayOrder: sql`excluded.display_order` },
    });
}

/**
 * Appends one menu after the department's last, or puts it at `displayOrder` when that is given. A
 * menu already listed stays where it is unless `displayOrder` is given.
 */
export async function addDepartmentMenu(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  menuId: string,
  options: { displayOrder?: number } = {},
): Promise<void> {
  await assertDepartment(tx, cfg, departmentId);
  await assertMenus(tx, [menuId]);
  const target = [departmentMenus.departmentId, departmentMenus.menuId];
  const last = sql`(select coalesce(max(display_order) + 1, 0) from department_menus
    where department_id = ${departmentId})`;
  const insert = tx
    .insert(departmentMenus)
    .values({ departmentId, menuId, displayOrder: options.displayOrder ?? last });
  await (options.displayOrder === undefined
    ? insert.onConflictDoNothing({ target })
    : insert.onConflictDoUpdate({ target, set: { displayOrder: options.displayOrder } }));
}

/** `null` leaves the department with no all-day default. */
export async function setDepartmentAllDayMenu(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  menuId: string | null,
): Promise<void> {
  await assertDepartment(tx, cfg, departmentId);
  if (menuId === null) {
    await tx
      .delete(departmentAllDayMenus)
      .where(eq(departmentAllDayMenus.departmentId, departmentId));
    return;
  }
  await assertMember(tx, departmentId, menuId);
  await tx
    .insert(departmentAllDayMenus)
    .values({ departmentId, menuId })
    .onConflictDoUpdate({ target: departmentAllDayMenus.departmentId, set: { menuId } });
}

/** `null` = inherit the department's. An inactive zone's override may be set and cleared. */
export async function setZoneAllDayMenu(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  menuId: string | null,
): Promise<void> {
  const [policy] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.zoneId, zoneId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
      ),
    );
  if (policy === undefined) throw new AppError("service_zone.not_found", { zoneId });
  if (menuId === null) {
    await tx.delete(zoneAllDayMenus).where(eq(zoneAllDayMenus.zoneId, zoneId));
    return;
  }
  const { departmentId } = policy;
  await assertMember(tx, departmentId, menuId);
  await tx
    .insert(zoneAllDayMenus)
    .values({ zoneId, departmentId, menuId })
    .onConflictDoUpdate({ target: zoneAllDayMenus.zoneId, set: { departmentId, menuId } });
}
