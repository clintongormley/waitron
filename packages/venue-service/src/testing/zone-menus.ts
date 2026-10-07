// Test support: the per-zone way of adding a menu that suites written before department menus use.
import { and, eq } from "drizzle-orm";
import { catalogues, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { addDepartmentMenu, setZoneAllDayMenu } from "../department-menus.js";
import type { VenueScope } from "../operations.js";
import { zoneServicePolicies } from "../schema/service.js";
import "../errors.js";

/**
 * Adds the menu to the zone's DEPARTMENT list, so every zone of the department serves it, at
 * `displayOrder` (0 when absent); `makeDefault` makes it the zone's own all-day menu.
 */
export async function allowMenuInZone(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  menuId: string,
  options: { displayOrder?: number; makeDefault?: boolean } = {},
): Promise<void> {
  const [menu] = await tx
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(eq(catalogues.id, menuId));
  if (menu === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const [policy] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.zoneId, zoneId),
      ),
    );
  if (policy === undefined) throw new AppError("service_zone.not_found", { zoneId });
  await addDepartmentMenu(tx, cfg, policy.departmentId, menuId, {
    displayOrder: options.displayOrder ?? 0,
  });
  if (options.makeDefault === true) await setZoneAllDayMenu(tx, cfg, zoneId, menuId);
}
