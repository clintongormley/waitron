import { readBusinessDayScheduleRevision } from "@waitron/venue-service";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { categories, diningTables, kitchenStations, type Transaction } from "@waitron/db";
import {
  addStarterServiceSteps,
  createServiceZone,
  departmentSalePolicies,
  departments,
  createFloorPlanSet,
  menuPeriods,
  saveMenuPeriod,
  updateMenuPeriod,
  replaceMenuWeek,
  setRoutingCell,
  zoneSalePolicies,
} from "@waitron/venue-service";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { CountryDemoIdentity } from "@waitron/country";
import { saveLayout } from "../../src/floor-plan.js";
import { floorPlanSetsFor } from "../../src/floor-plan-sets.js";
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

function toTableCfg(locationId: string, locale: SeedLocale): TillConfig {
  return {
    nodeId: brandNodeId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: SEED_INVOICE_LOCALE[locale],
    invoiceLocales: [SEED_INVOICE_LOCALE[locale]],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

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
    set name = ${restaurantName}, trading_name = ${departmentTradingNames.restaurant}
    where id = ${defaultPolicy.department_id}`);
  await tx
    .update(departmentSalePolicies)
    .set({ orderStart: "table" })
    .where(eq(departmentSalePolicies.departmentId, defaultPolicy.department_id));
  const [deliRow] = await tx
    .insert(departments)
    .values({
      locationId,
      name: floor.departmentNames.deli[locale],
      tradingName: departmentTradingNames.deli,
      active: true,
    })
    .returning({ id: departments.id });
  const deliDepartmentId = deliRow?.id;
  if (deliDepartmentId === undefined)
    throw new Error("seedFloor: failed to create deli department");
  await tx
    .insert(departmentSalePolicies)
    .values({ departmentId: deliDepartmentId, orderStart: "counter" });
  await addStarterServiceSteps(tx, cfg, deliDepartmentId);

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
    }
    if (zone.key === "bar") {
      await tx
        .update(zoneSalePolicies)
        .set({ orderStart: "counter" })
        .where(eq(zoneSalePolicies.zoneId, zoneId));
    }
    zoneIds.set(zone.key, zoneId);
  }

  const upstairsBarZone = await createServiceZone(tx, cfg, {
    departmentId: defaultPolicy.department_id,
    name: floor.upstairsBarZone[locale],
    displayOrder: 3,
  });
  await tx
    .update(zoneSalePolicies)
    .set({ orderStart: "counter" })
    .where(eq(zoneSalePolicies.zoneId, upstairsBarZone.id));

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
        { kind: "station", stationId: downstairsStationId },
      );
    }
  }

  const deliCounterZone = await createServiceZone(tx, cfg, {
    departmentId: deliDepartmentId,
    name: floor.deliCounterZone[locale],
    displayOrder: 4,
  });
  if (menuIds !== undefined) {
    const restaurantId = defaultPolicy.department_id;
    const [existing] = await tx
      .select({ id: menuPeriods.id })
      .from(menuPeriods)
      .where(and(eq(menuPeriods.departmentId, restaurantId), eq(menuPeriods.name, "Open")));
    const restaurant =
      existing ??
      (await saveMenuPeriod(
        tx,
        cfg,
        restaurantId,
        {
          name: "Open",
          menuId: menuIds.restaurant,
          staffMenuIds: [menuIds.lunch],
        },
        await readBusinessDayScheduleRevision(tx, cfg),
      ));
    if (existing !== undefined)
      await updateMenuPeriod(
        tx,
        cfg,
        existing.id,
        {
          menuId: menuIds.restaurant,
          staffMenuIds: [menuIds.lunch],
        },
        await readBusinessDayScheduleRevision(tx, cfg),
      );
    const deli = await saveMenuPeriod(
      tx,
      cfg,
      deliDepartmentId,
      {
        name: "Open",
        menuId: menuIds.deli,
        staffMenuIds: [],
      },
      await readBusinessDayScheduleRevision(tx, cfg),
    );
    await replaceMenuWeek(
      tx,
      cfg,
      restaurantId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: restaurant.id, startsAt: "09:00", endsAt: "00:00" }],
      })),
      new Date(),
      await readBusinessDayScheduleRevision(tx, cfg),
    );
    await replaceMenuWeek(
      tx,
      cfg,
      deliDepartmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekday === 0 ? [] : [{ periodId: deli.id, startsAt: "09:00", endsAt: "18:00" }],
      })),
      new Date(),
      await readBusinessDayScheduleRevision(tx, cfg),
    );
  }

  for (const table of floor.tables) {
    if (!zoneIds.has(table.zoneKey)) {
      throw new Error(`seedFloor: no zone seeded for key "${table.zoneKey}"`);
    }
  }
  for (const zoneId of [...zoneIds.values(), upstairsBarZone.id, deliCounterZone.id]) {
    const [existing] = await tx
      .select({ label: diningTables.label })
      .from(diningTables)
      .where(and(eq(diningTables.locationId, locationId), eq(diningTables.zoneId, zoneId)))
      .orderBy(diningTables.label)
      .limit(1);
    if (existing !== undefined) {
      throw new Error(
        `seedFloor: zone ${zoneId} holds table "${existing.label}", which the seed did not create`,
      );
    }
  }
  const setName = locale === "es" ? "Estándar" : "Standard";
  const setOf = new Map<string, string>();
  for (const departmentId of [defaultPolicy.department_id, deliDepartmentId]) {
    setOf.set(
      departmentId,
      await createFloorPlanSet(tx, cfg, floorPlanSetsFor(cfg), { departmentId, name: setName }),
    );
  }
  for (const [zoneKey, zoneId] of zoneIds) {
    const layout = { setId: setOf.get(defaultPolicy.department_id)!, zoneId };
    const tables = floor.tables.filter((table) => table.zoneKey === zoneKey);
    if (tables.length === 0) continue;
    await saveLayout(tx, cfg, [], layout, {
      revision: 0,
      tables: tables.map((table) => ({
        key: table.label,
        label: table.label,
        seats: table.capacity,
        fixed: table.fixed,
        placement: table.placement,
        partKeys: [],
      })),
    });
  }
}
