// Statuses are inserted directly because the management helper requires a session.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { categories, kitchenStations, tableServiceStatuses, type Transaction } from "@waitron/db";
import type { WeekCell, WeekDay } from "@waitron/venue-service";
import {
  createServiceZone,
  departmentSalePolicies,
  departments,
  replaceWeekHours,
  addDepartmentMenu,
  setDepartmentAllDayMenu,
  setRoutingCell,
  setStationFallback,
  zoneServicePolicies,
} from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { CountryDemoIdentity } from "@waitron/country";
import { createTable, setTablePlacement } from "../../src/tables.js";
import type { TillConfig } from "../../src/till-config.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import type { DemoDataSet } from "./data-set.js";

export interface SeedFloorInput {
  locationId: string;
  locale: SeedLocale;
  departmentTradingNames: CountryDemoIdentity["departmentTradingNames"];
  dataSet: DemoDataSet;
  menuIds?: { restaurant: string; lunch: string; deli: string };
}

const CLOSED: WeekCell = { mode: "closed", periods: [] };
const opening = (opensAt: string, closesAt: string): WeekCell => ({
  mode: "periods",
  periods: [{ id: randomUUID(), opensAt, closesAt }],
});
/** A whole standard week, Sunday (0) first. */
const weekOf = (cell: (weekday: number) => WeekCell): WeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: cell(weekday) }));

/** `createServiceZone`, `createTable` and `setTablePlacement` read only `locationId`; every other field is
 *  a placeholder that satisfies the type. */
function toTableCfg(locationId: string, locale: SeedLocale): TillConfig {
  return {
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: SEED_INVOICE_LOCALE[locale],
    invoiceLocales: [SEED_INVOICE_LOCALE[locale]],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

/** Zones are created before any table: `setTablePlacement` refuses a `zoneId` that is not a live
 *  zone of this location. */
export async function seedFloor(
  tx: Transaction,
  { locationId, locale, departmentTradingNames, dataSet, menuIds }: SeedFloorInput,
): Promise<void> {
  const cfg = toTableCfg(locationId, locale);

  const { rows: defaults } = await tx.execute<{ department_id: string; zone_id: string }>(sql`
    select department_id, zone_id from zone_service_policies
    where location_id = ${locationId} and is_counter_default
    limit 1`);
  const defaultPolicy = defaults[0];
  if (defaultPolicy === undefined) {
    throw new Error(`seedFloor: no default service zone for location ${locationId}`);
  }

  const { floor } = dataSet;
  const restaurantName = floor.departmentNames.restaurant[locale];
  await tx.execute(sql`
    update departments
    set name = ${restaurantName}, trading_name = ${departmentTradingNames.restaurant},
        default_service_mode = 'table_tab'
    where id = ${defaultPolicy.department_id}`);
  const [deliRow] = await tx
    .insert(departments)
    .values({
      locationId,
      name: floor.departmentNames.deli[locale],
      tradingName: departmentTradingNames.deli,
      defaultServiceMode: "prepay",
      active: true,
    })
    .returning({ id: departments.id });
  const deliDepartmentId = deliRow?.id;
  if (deliDepartmentId === undefined)
    throw new Error("seedFloor: failed to create deli department");
  await tx.insert(departmentSalePolicies).values({ departmentId: deliDepartmentId });

  const zoneIds = new Map<string, string>();
  for (const zone of floor.zones) {
    const zoneId =
      zone.key === "bar"
        ? defaultPolicy.zone_id
        : (
            await createServiceZone(tx, cfg, {
              departmentId: defaultPolicy.department_id,
              name: zone.name[locale],
              displayOrder: zone.displayOrder,
            })
          ).id;
    if (zone.key === "bar") {
      await tx.execute(sql`
        update floor_zones set name = ${zone.name[locale]}, display_order = ${zone.displayOrder}
        where id = ${zoneId}`);
      await tx.execute(sql`
        update zone_service_policies set service_mode = 'prepay'
        where zone_id = ${zoneId}`);
    }
    zoneIds.set(zone.key, zoneId);
  }

  const upstairsBarZone = await createServiceZone(tx, cfg, {
    departmentId: defaultPolicy.department_id,
    name: floor.upstairsBarZone[locale],
    displayOrder: 3,
  });
  await tx
    .update(zoneServicePolicies)
    .set({ serviceMode: "prepay" })
    .where(eq(zoneServicePolicies.zoneId, upstairsBarZone.id));

  if (menuIds !== undefined) {
    const downstairsBarZoneId = zoneIds.get("bar");
    if (downstairsBarZoneId === undefined) throw new Error("seedFloor: no downstairs bar zone");
    const barStations = await tx
      .select({ id: kitchenStations.id, name: kitchenStations.name })
      .from(kitchenStations)
      .where(
        and(
          eq(kitchenStations.locationId, locationId),
          inArray(kitchenStations.name, ["Downstairs bar", "Upstairs bar"]),
        ),
      );
    const downstairsStationId = barStations.find(
      (station) => station.name === "Downstairs bar",
    )?.id;
    const upstairsStationId = barStations.find((station) => station.name === "Upstairs bar")?.id;
    if (downstairsStationId === undefined || upstairsStationId === undefined) {
      throw new Error("seedFloor: bar preparation stations were not created");
    }
    const stationCfg = { locationId: brandLocationId(locationId) };
    await replaceWeekHours(
      tx,
      stationCfg,
      { kind: "station", id: upstairsStationId },
      weekOf((weekday) => (weekday >= 5 ? opening("19:00", "21:00") : CLOSED)),
      new Date(),
    );
    await setStationFallback(tx, stationCfg, upstairsStationId, downstairsStationId);
    const barCategories = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        inArray(
          categories.name,
          dataSet.menus.restaurant.categories
            .filter((category) => category.station === "bar")
            .map((category) => category.name.en),
        ),
      );
    for (const category of barCategories) {
      await setRoutingCell(
        tx,
        { locationId: brandLocationId(locationId) },
        { row: { kind: "category", categoryId: category.id }, zoneId: upstairsBarZone.id },
        { kind: "station", stationId: upstairsStationId },
      );
    }
  }

  await createServiceZone(tx, cfg, {
    departmentId: deliDepartmentId,
    name: floor.deliCounterZone[locale],
    displayOrder: 4,
  });
  if (menuIds !== undefined) {
    const restaurantId = defaultPolicy.department_id;
    for (const [displayOrder, menuId] of [menuIds.restaurant, menuIds.lunch].entries())
      await addDepartmentMenu(tx, cfg, restaurantId, menuId, { displayOrder });
    await setDepartmentAllDayMenu(tx, cfg, restaurantId, menuIds.restaurant);
    await addDepartmentMenu(tx, cfg, deliDepartmentId, menuIds.deli, { displayOrder: 0 });
    await setDepartmentAllDayMenu(tx, cfg, deliDepartmentId, menuIds.deli);
  }

  const hoursCfg = { locationId: brandLocationId(locationId) };
  await replaceWeekHours(
    tx,
    hoursCfg,
    { kind: "department", id: defaultPolicy.department_id },
    weekOf(() => opening("12:00", "01:00")),
    new Date(),
  );
  await replaceWeekHours(
    tx,
    hoursCfg,
    { kind: "department", id: deliDepartmentId },
    weekOf((weekday) => (weekday === 0 ? CLOSED : opening("09:00", "18:00"))),
    new Date(),
  );

  for (const table of floor.tables) {
    const zoneId = zoneIds.get(table.zoneKey);
    if (zoneId === undefined) {
      throw new Error(`seedFloor: no zone seeded for key "${table.zoneKey}"`);
    }
    const created = await createTable(tx, cfg, {
      label: table.label,
      zoneId,
      capacity: table.capacity,
    });
    await setTablePlacement(tx, cfg, created.id, {
      zoneId,
      posX: table.posX,
      posY: table.posY,
      shape: table.shape,
      rotation: table.rotation,
    });
  }

  for (const [index, status] of floor.statuses.entries()) {
    await tx.insert(tableServiceStatuses).values({
      label: status.label[locale],
      color: status.color,
      displayOrder: index,
    });
  }
}
