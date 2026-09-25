// Statuses are inserted directly because the management helper requires a session.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  categories,
  floorZones,
  kitchenStations,
  tableServiceStatuses,
  type Transaction,
} from "@waitron/db";
import {
  departmentHours,
  departments,
  preparationRoutes,
  zoneMenus,
  zoneServicePolicies,
} from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { createTable, createZone, setTablePlacement } from "../../src/tables.js";
import type { TillConfig } from "../../src/till-config.js";
import { DEMO_STATUSES, DEMO_TABLES, DEMO_ZONES } from "./floor.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

export interface SeedFloorInput {
  locationId: string;
  locale: SeedLocale;
  menuIds?: { restaurant: string; lunch: string; deli: string };
}

/** `createZone`, `createTable` and `setTablePlacement` read only `locationId`; every other field is
 *  a placeholder that satisfies the type. */
function toTableCfg(locationId: string, locale: SeedLocale): TillConfig {
  return {
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: SEED_INVOICE_LOCALE[locale],
    invoiceLocales: [SEED_INVOICE_LOCALE[locale]],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** Zones are created before any table: `setTablePlacement` refuses a `zoneId` that is not a live
 *  zone of this location. */
export async function seedFloor(
  tx: Transaction,
  { locationId, locale, menuIds }: SeedFloorInput,
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

  const restaurantName = locale === "en" ? "Restaurant and bar" : "Restaurante y bar";
  const restaurantTradingName = "Casa Delgado";
  await tx.execute(sql`
    update departments
    set name = ${restaurantName}, trading_name = ${restaurantTradingName},
        default_service_mode = 'table_tab'
    where id = ${defaultPolicy.department_id}`);
  const [deliRow] = await tx
    .insert(departments)
    .values({
      locationId,
      name: locale === "en" ? "Deli" : "Charcutería",
      tradingName: locale === "en" ? "Casa Delgado Deli" : "Charcutería Casa Delgado",
      defaultServiceMode: "prepay",
      active: true,
    })
    .returning({ id: departments.id });
  const deliDepartmentId = deliRow?.id;
  if (deliDepartmentId === undefined)
    throw new Error("seedFloor: failed to create deli department");

  const zoneIds = new Map<string, string>();
  for (const zone of DEMO_ZONES) {
    const zoneId =
      zone.key === "bar"
        ? defaultPolicy.zone_id
        : (
            await createZone(tx, cfg, {
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
    } else {
      await tx.insert(zoneServicePolicies).values({
        locationId,
        zoneId,
        departmentId: defaultPolicy.department_id,
        serviceMode: null,
        isCounterDefault: false,
      });
    }
    const restaurantMenus = menuIds === undefined ? [] : [menuIds.restaurant, menuIds.lunch];
    for (const [index, menuId] of restaurantMenus.entries()) {
      await tx
        .insert(zoneMenus)
        .values({ zoneId, menuId, displayOrder: index })
        .onConflictDoUpdate({
          target: [zoneMenus.zoneId, zoneMenus.menuId],
          set: { displayOrder: index },
        });
      if (index === 0) {
        await tx.execute(sql`
          update zone_service_policies set default_menu_id = ${menuId}
          where zone_id = ${zoneId}`);
      }
    }
    zoneIds.set(zone.key, zoneId);
  }

  const upstairsBarZone = await createZone(tx, cfg, {
    name: locale === "en" ? "Upstairs bar" : "Bar de arriba",
    displayOrder: 3,
  });
  await tx.insert(zoneServicePolicies).values({
    locationId,
    zoneId: upstairsBarZone.id,
    departmentId: defaultPolicy.department_id,
    serviceMode: "prepay",
    isCounterDefault: false,
  });
  if (menuIds !== undefined) {
    for (const [index, menuId] of [menuIds.restaurant, menuIds.lunch].entries()) {
      await tx
        .insert(zoneMenus)
        .values({ zoneId: upstairsBarZone.id, menuId, displayOrder: index });
    }
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${menuIds.restaurant}
      where zone_id = ${upstairsBarZone.id}`);
  }

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
    // Read the categories first and insert a row each, rather than `insert … select`: a route's id
    // is generated by the insert BUILDER, and one statement cannot mint a distinct id per selected
    // row.
    const barCategories = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.stationId, downstairsStationId));
    for (const [zoneId, stationId] of [
      [downstairsBarZoneId, downstairsStationId],
      [upstairsBarZone.id, upstairsStationId],
    ] as const) {
      for (const category of barCategories) {
        await tx.insert(preparationRoutes).values({
          locationId,
          zoneId,
          categoryId: category.id,
          stationId,
          noPreparation: false,
        });
      }
    }
  }

  const [deliZoneRow] = await tx
    .insert(floorZones)
    .values({
      locationId,
      name: locale === "en" ? "Deli counter" : "Mostrador de charcutería",
      displayOrder: 4,
      active: true,
    })
    .returning({ id: floorZones.id });
  const deliZoneId = deliZoneRow?.id;
  if (deliZoneId === undefined) throw new Error("seedFloor: failed to create deli service zone");
  await tx.insert(zoneServicePolicies).values({
    locationId,
    zoneId: deliZoneId,
    departmentId: deliDepartmentId,
    serviceMode: null,
    isCounterDefault: false,
  });
  if (menuIds !== undefined) {
    await tx
      .insert(zoneMenus)
      .values({ zoneId: deliZoneId, menuId: menuIds.deli, displayOrder: 0 });
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${menuIds.deli}
      where zone_id = ${deliZoneId}`);
  }

  for (let weekday = 0; weekday < 7; weekday += 1) {
    await tx.insert(departmentHours).values({
      departmentId: defaultPolicy.department_id,
      weekday,
      opensAt: "12:00",
      closesAt: "01:00",
    });
  }
  for (let weekday = 1; weekday <= 6; weekday += 1) {
    await tx.insert(departmentHours).values({
      departmentId: deliDepartmentId,
      weekday,
      opensAt: "09:00",
      closesAt: "18:00",
    });
  }

  for (const table of DEMO_TABLES) {
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

  for (const [index, status] of DEMO_STATUSES.entries()) {
    await tx.insert(tableServiceStatuses).values({
      label: status.label[locale],
      color: status.color,
      displayOrder: index,
    });
  }
}
