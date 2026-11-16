import { readBusinessDayScheduleRevision } from "@waitron/venue-service";

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  categories,
  departmentCourses,
  floorZones,
  diningTables,
  kitchenStations,
  type Transaction,
} from "@waitron/db";
import {
  addStarterServiceSteps,
  createServiceZone,
  departments,
  createFloorPlanSet,
  menuPeriods,
  saveMenuPeriod,
  updateMenuPeriod,
  replaceMenuWeek,
  setRoutingCell,
  STARTER_OPEN_PERIOD_NAMES,
} from "@waitron/venue-service";
import type { CountryDemoIdentity, DemoPlainText } from "@waitron/country";
import { saveLayout } from "../../src/floor-plan.js";
import { floorPlanSetsFor } from "../../src/floor-plan-sets.js";
import type { SeedLocale } from "./locale.js";
import { demoPlainText, type DemoDataSet } from "./data-set.js";

export interface SeedFloorInput {
  locale: SeedLocale;
  departmentTradingNames: CountryDemoIdentity["departmentTradingNames"];
  dataSet: DemoDataSet;
  menuIds?: { restaurant: string; lunch: string; deli: string; drinks: string };
}

export async function seedFloor(
  tx: Transaction,
  { locale, departmentTradingNames, dataSet, menuIds }: SeedFloorInput,
): Promise<void> {
  const plain = (text: DemoPlainText) => demoPlainText(text, dataSet, locale);

  const { rows: defaults } = await tx.execute<{ department_id: string; zone_id: string }>(sql`
    select department_id, id as zone_id from floor_zones
    where is_counter_default
    limit 1`);
  const defaultPolicy = defaults[0];
  if (defaultPolicy === undefined) {
    throw new Error("seedFloor: the venue has no default service zone");
  }

  const { floor } = dataSet;
  const restaurantName = plain(floor.departmentNames.restaurant);
  await tx.execute(sql`
    update departments
    set name = ${restaurantName}, trading_name = ${departmentTradingNames.restaurant}
    where id = ${defaultPolicy.department_id}`);
  await tx
    .update(departments)
    .set({ orderStart: "table" })
    .where(eq(departments.id, defaultPolicy.department_id));
  const [deliRow] = await tx
    .insert(departments)
    .values({
      name: plain(floor.departmentNames.deli),
      tradingName: departmentTradingNames.deli,
      active: true,
      dining: "takeaway",
    })
    .returning({ id: departments.id });
  const deliDepartmentId = deliRow?.id;
  if (deliDepartmentId === undefined)
    throw new Error("seedFloor: failed to create deli department");
  const courseDefaults = await tx
    .select({
      courseId: departmentCourses.courseId,
      heldUntilFired: departmentCourses.heldUntilFired,
      reminderMinutes: departmentCourses.reminderMinutes,
    })
    .from(departmentCourses)
    .where(eq(departmentCourses.departmentId, defaultPolicy.department_id));
  if (courseDefaults.length > 0)
    await tx
      .insert(departmentCourses)
      .values(courseDefaults.map((row) => ({ departmentId: deliDepartmentId, ...row })));
  await addStarterServiceSteps(tx, deliDepartmentId, locale);

  const zoneIds = new Map<string, string>();
  for (const zone of floor.zones) {
    const zoneId =
      zone.key === "bar"
        ? defaultPolicy.zone_id
        : (
            await createServiceZone(tx, {
              departmentId: defaultPolicy.department_id,
              name: plain(zone.name),
              displayOrder: zone.displayOrder,
            })
          ).id;
    if (zone.key === "bar") {
      await tx.execute(sql`
        update floor_zones set name = ${plain(zone.name)}, display_order = ${zone.displayOrder}
        where id = ${zoneId}`);
    }
    if (zone.key === "bar") {
      await tx.update(floorZones).set({ orderStart: "counter" }).where(eq(floorZones.id, zoneId));
    }
    zoneIds.set(zone.key, zoneId);
  }

  const upstairsBarZone = await createServiceZone(tx, {
    departmentId: defaultPolicy.department_id,
    name: plain(floor.upstairsBarZone),
    displayOrder: 3,
  });
  await tx
    .update(floorZones)
    .set({ orderStart: "counter" })
    .where(eq(floorZones.id, upstairsBarZone.id));

  if (menuIds !== undefined) {
    const downstairsBarZoneId = zoneIds.get("bar");
    if (downstairsBarZoneId === undefined) throw new Error("seedFloor: no downstairs bar zone");
    const barStations = await tx
      .select({ id: kitchenStations.id, name: kitchenStations.name })
      .from(kitchenStations)
      .where(
        and(
          inArray(kitchenStations.name, [
            plain(dataSet.stations.downstairsBar),
            plain(dataSet.stations.upstairsBar),
          ]),
        ),
      );
    const downstairsStationId = barStations.find(
      (station) => station.name === plain(dataSet.stations.downstairsBar),
    )?.id;
    const upstairsStationId = barStations.find(
      (station) => station.name === plain(dataSet.stations.upstairsBar),
    )?.id;
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
            .map((category) => plain(category.categoryName ?? category.name)),
        ),
      );
    for (const category of barCategories) {
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: category.id }, zoneId: upstairsBarZone.id },
        { kind: "station", stationId: downstairsStationId },
      );
    }
  }

  const deliCounterZone = await createServiceZone(tx, {
    departmentId: deliDepartmentId,
    name: plain(floor.deliCounterZone),
    displayOrder: 4,
  });
  if (menuIds !== undefined) {
    const [deliStation] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, plain(dataSet.stations.deli)));
    if (deliStation === undefined) throw new Error("seedFloor: no deli preparation station");
    const deliOwnCategories = dataSet.menus.deli.categories.map((category) =>
      plain(category.categoryName ?? category.name),
    );
    const { rows: listedCategories } = await tx.execute<{ id: string }>(sql`
      select distinct c.id from menu_items i
      join products p on p.id = i.product_id
      join categories c on c.id = p.category_id
      where i.menu_id = ${menuIds.deli}
        and c.name not in (${sql.join(
          deliOwnCategories.map((name) => sql`${name}`),
          sql`, `,
        )})
      order by c.id`);
    for (const category of listedCategories)
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: category.id }, zoneId: deliCounterZone.id },
        { kind: "station", stationId: deliStation.id },
      );
    const restaurantId = defaultPolicy.department_id;
    const [existing] = await tx
      .select({ id: menuPeriods.id })
      .from(menuPeriods)
      .where(
        and(
          eq(menuPeriods.departmentId, restaurantId),
          inArray(menuPeriods.name, [...STARTER_OPEN_PERIOD_NAMES]),
        ),
      );
    const names = dataSet.restaurantPeriodNames;
    const barPeriod = { name: plain(names.bar), menuId: menuIds.drinks, staffMenuIds: [] };
    const bar = existing ?? (await saveMenuPeriod(tx, restaurantId, barPeriod));
    if (existing !== undefined) await updateMenuPeriod(tx, existing.id, barPeriod);
    const lunch = await saveMenuPeriod(tx, restaurantId, {
      name: plain(names.lunch),
      menuId: menuIds.restaurant,
      staffMenuIds: [menuIds.lunch],
    });
    const dinner = await saveMenuPeriod(tx, restaurantId, {
      name: plain(names.dinner),
      menuId: menuIds.restaurant,
      staffMenuIds: [],
    });
    const deli = await saveMenuPeriod(tx, deliDepartmentId, {
      name: plain(dataSet.deliPeriodName),
      menuId: menuIds.deli,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      restaurantId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [
          { periodId: bar.id, startsAt: "09:00", endsAt: "13:00" },
          { periodId: lunch.id, startsAt: "13:00", endsAt: "16:00" },
          { periodId: bar.id, startsAt: "16:00", endsAt: "20:00" },
          { periodId: dinner.id, startsAt: "20:00", endsAt: "23:00" },
          { periodId: bar.id, startsAt: "23:00", endsAt: "00:00" },
        ],
      })),
      new Date(),
      await readBusinessDayScheduleRevision(tx),
    );
    await replaceMenuWeek(
      tx,
      deliDepartmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekday === 0 ? [] : [{ periodId: deli.id, startsAt: "09:00", endsAt: "18:00" }],
      })),
      new Date(),
      await readBusinessDayScheduleRevision(tx),
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
      .where(eq(diningTables.zoneId, zoneId))
      .orderBy(diningTables.label)
      .limit(1);
    if (existing !== undefined) {
      throw new Error(
        `seedFloor: zone ${zoneId} holds table "${existing.label}", which the seed did not create`,
      );
    }
  }
  const setName = plain(dataSet.floor.setName);
  const setOf = new Map<string, string>();
  for (const departmentId of [defaultPolicy.department_id, deliDepartmentId]) {
    setOf.set(
      departmentId,
      await createFloorPlanSet(tx, floorPlanSetsFor(), { departmentId, name: setName }),
    );
  }
  for (const [zoneKey, zoneId] of zoneIds) {
    const layout = { setId: setOf.get(defaultPolicy.department_id)!, zoneId };
    const tables = floor.tables.filter((table) => table.zoneKey === zoneKey);
    if (tables.length === 0) continue;
    await saveLayout(tx, [], layout, {
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
