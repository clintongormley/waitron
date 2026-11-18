import { lineContextColumns } from "../operations.js";
import { readBusinessDayScheduleRevision } from "../business-day-schedule.js";
import { and, eq } from "drizzle-orm";
import {
  menus,
  menuPeriods,
  readVenueClock,
  floorZones,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { replaceMenuWeek, saveMenuPeriod, updateMenuPeriod } from "../menu-timetable.js";
import "../errors.js";

export async function offerMenuThroughZone(
  tx: Transaction,
  zoneId: string,
  menuId: string,
  options: { displayOrder?: number; makeDefault?: boolean } = {},
): Promise<void> {
  const [menu] = await tx.select({ id: menus.id }).from(menus).where(eq(menus.id, menuId));
  if (menu === undefined) throw new AppError("menu.not_found", { menuId: menuId });
  const [policy] = await tx
    .select({ departmentId: floorZones.departmentId })
    .from(floorZones)
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.active, true)));
  if (policy === undefined) throw new AppError("service_zone.not_found", { zoneId });
  const [stored] = await tx
    .select({
      id: menuPeriods.id,
      menuId: menuPeriods.menuId,
      staffMenuIds: menuPeriods.staffMenuIds,
    })
    .from(menuPeriods)
    .where(and(eq(menuPeriods.departmentId, policy.departmentId), eq(menuPeriods.name, "Always")));
  const period =
    stored ??
    (await saveMenuPeriod(tx, policy.departmentId, {
      name: "Always",
      menuId,
      staffMenuIds: [],
    }));
  if (stored !== undefined) {
    const staff = stored.staffMenuIds.map((menuId, displayOrder) => ({ menuId, displayOrder }));
    const customer =
      options.makeDefault === true || stored.menuId === null ? menuId : stored.menuId;
    const entries = staff.filter((entry) => entry.menuId !== customer && entry.menuId !== menuId);
    if (stored.menuId !== null && stored.menuId !== customer)
      entries.push({ menuId: stored.menuId, displayOrder: -1 });
    if (menuId !== customer) entries.push({ menuId, displayOrder: options.displayOrder ?? 0 });
    entries.sort((a, b) => a.displayOrder - b.displayOrder || a.menuId.localeCompare(b.menuId));
    await updateMenuPeriod(tx, period.id, {
      menuId: customer,
      staffMenuIds: entries.map((entry) => entry.menuId),
    });
  }
  const start = (await readVenueClock(tx)).dayCutover.slice(0, 5);
  const middle = `${String((Number(start.slice(0, 2)) + 12) % 24).padStart(2, "0")}:${start.slice(3, 5)}`;
  await replaceMenuWeek(
    tx,
    policy.departmentId,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots: [
        { periodId: period.id, startsAt: start, endsAt: middle },
        { periodId: period.id, startsAt: middle, endsAt: start },
      ],
    })),
    new Date(),
    await readBusinessDayScheduleRevision(tx),
  );
}

export async function stampFixtureLineContexts(...args: Parameters<typeof lineContextColumns>) {
  const [tx] = args;
  for (const [lineId, context] of await lineContextColumns(...args))
    await tx.update(workingOrderLines).set(context).where(eq(workingOrderLines.id, lineId));
}
