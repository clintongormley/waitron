import { and, asc, eq } from "drizzle-orm";
import { catalogues, locations, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { replaceMenuWeek, saveMenuPeriod, updateMenuPeriod } from "../menu-timetable.js";
import { menuPeriods, menuPeriodStaffMenus } from "../schema/menus.js";
import type { VenueScope } from "../operations.js";
import { zoneServicePolicies } from "../schema/service.js";
import "../errors.js";

export async function offerMenuThroughZone(
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
  const [stored] = await tx
    .select({ id: menuPeriods.id, menuId: menuPeriods.menuId })
    .from(menuPeriods)
    .where(and(eq(menuPeriods.departmentId, policy.departmentId), eq(menuPeriods.name, "Always")));
  const period =
    stored ??
    (await saveMenuPeriod(tx, cfg, policy.departmentId, {
      name: "Always",
      menuId,
      staffMenuIds: [],
    }));
  if (stored !== undefined) {
    const staff = await tx
      .select({
        menuId: menuPeriodStaffMenus.menuId,
        displayOrder: menuPeriodStaffMenus.displayOrder,
      })
      .from(menuPeriodStaffMenus)
      .where(eq(menuPeriodStaffMenus.periodId, period.id))
      .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId));
    const customer =
      options.makeDefault === true || stored.menuId === null ? menuId : stored.menuId;
    const entries = staff.filter((entry) => entry.menuId !== customer && entry.menuId !== menuId);
    if (stored.menuId !== null && stored.menuId !== customer)
      entries.push({ menuId: stored.menuId, displayOrder: 0 });
    if (menuId !== customer) entries.push({ menuId, displayOrder: options.displayOrder ?? 0 });
    entries.sort((a, b) => a.displayOrder - b.displayOrder || a.menuId.localeCompare(b.menuId));
    await updateMenuPeriod(tx, cfg, period.id, {
      menuId: customer,
      staffMenuIds: entries.map((entry) => entry.menuId),
    });
    for (const entry of entries)
      await tx
        .update(menuPeriodStaffMenus)
        .set({ displayOrder: entry.displayOrder })
        .where(
          and(
            eq(menuPeriodStaffMenus.periodId, period.id),
            eq(menuPeriodStaffMenus.menuId, entry.menuId),
          ),
        );
  }
  const [location] = await tx
    .select({ dayCutover: locations.dayCutover })
    .from(locations)
    .where(eq(locations.id, cfg.locationId));
  const start = location!.dayCutover.slice(0, 5);
  const middle = `${String((Number(start.slice(0, 2)) + 12) % 24).padStart(2, "0")}:${start.slice(3, 5)}`;
  await replaceMenuWeek(
    tx,
    cfg,
    policy.departmentId,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots: [
        { periodId: period.id, startsAt: start, endsAt: middle },
        { periodId: period.id, startsAt: middle, endsAt: start },
      ],
    })),
    new Date(),
  );
}
