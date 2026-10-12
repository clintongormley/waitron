import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  deviceProfiles,
  devices,
  floorZones,
  locations,
  kitchenStations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import {
  readServiceDeleteSettings,
  clearServiceDeleteSettings,
} from "./service-delete-settings.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  departments,
  departmentSalePolicies,
  zoneServicePolicies,
  zoneSalePolicies,
  deviceProfileServiceAccess,
  deviceProfileZones,
} from "./schema/service.js";
import { routingCells, routingCellPeriods } from "./schema/routing.js";
import { menuPeriods, menuPeriodStaffMenus } from "./schema/menus.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import { periodExtensions } from "./schema/period-extensions.js";
import {
  departmentTransferDesks,
  departmentTransferDestinations,
} from "./schema/department-transfers.js";
import {
  deviceKitchenScreenStations,
  deviceProfileKitchenScreenStations,
  deviceKitchenScreenZones,
  deviceProfileKitchenScreenZones,
  deviceKitchenScreenRemovals,
  deviceKitchenScreens,
  deviceProfileKitchenScreens,
} from "./schema/kitchen-screens.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import { departmentReceipts } from "./schema/department-receipts.js";
import {
  readProfileZones,
  readProfileServiceScopes,
  setProfileServiceScope,
} from "./profile-access.js";
import { readDeviceKitchenScreens, readProfileKitchenScreens } from "./kitchen-screens.js";
import { resolveNewOrderZone } from "./operations.js";
import { replaceMenuWeek } from "./menu-timetable.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";
import { ensureDefaultSeasons } from "./seasons.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function fixture(tx: Transaction, suffix = "") {
  const [venue] = await tx
    .insert(locations)
    .values({ name: randomUUID(), invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const cfg = { locationId: locationId(venue!.id) };
  const ds = await tx
    .insert(departments)
    .values([
      { ...cfg, name: "Deleted", tradingName: "Deleted", isDefault: true },
      { ...cfg, name: "Beta", tradingName: "Beta" },
      { ...cfg, name: "Alpha", tradingName: "Alpha" },
    ])
    .returning();
  const zs = await tx
    .insert(floorZones)
    .values([
      { ...cfg, name: "Deleted", displayOrder: 0 },
      { ...cfg, name: "Unpermitted", displayOrder: 1 },
      { ...cfg, name: "Permitted", displayOrder: 2 },
      { ...cfg, name: "Elsewhere", displayOrder: 0 },
    ])
    .returning();
  const [gone, forbidden, allowed, elsewhere] = zs.map((row) => row.id) as [
    string,
    string,
    string,
    string,
  ];
  const [department, beta, alpha] = ds.map((row) => row.id) as [string, string, string];
  await tx.insert(zoneServicePolicies).values(
    zs.map((row, i) => ({
      ...cfg,
      zoneId: row.id,
      departmentId: i === 3 ? alpha : department,
      isCounterDefault: i === 0,
    })),
  );
  await tx.insert(departmentSalePolicies).values(ds.map((row) => ({ departmentId: row.id })));
  const ps = await tx
    .insert(deviceProfiles)
    .values([
      { name: "Explicit" + suffix, formFactor: "till" },
      { name: "Every" + suffix, formFactor: "till" },
      { name: "Retired" + suffix, formFactor: "till", retiredAt: "2026-10-11T00:00:00Z" },
      { name: "Kitchen" + suffix, formFactor: "kds" },
    ])
    .returning();
  const [explicit, every, retired, kitchen] = ps.map((row) => row.id) as [
    string,
    string,
    string,
    string,
  ];
  await tx.insert(deviceProfileServiceAccess).values(
    ps.map((row) => ({
      deviceProfileId: row.id,
      departmentId: department,
      everyZone: row.id === every,
      startingZoneId: gone,
    })),
  );
  await tx.insert(deviceProfileZones).values([
    { deviceProfileId: explicit, zoneId: gone },
    { deviceProfileId: explicit, zoneId: allowed },
    { deviceProfileId: retired, zoneId: gone },
    { deviceProfileId: kitchen, zoneId: gone },
  ]);
  return {
    cfg,
    department,
    beta,
    alpha,
    gone,
    forbidden,
    allowed,
    elsewhere,
    explicit,
    every,
    retired,
    kitchen,
  };
}

it("delete starting zone advances only within allowed surviving zones and Every remains Every", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    expect(await readServiceDeleteSettings(tx, f.cfg, [f.gone], null)).toEqual([
      { key: "profile_zones", count: 3, targets: [{ id: f.explicit, name: "Explicit" }] },
      {
        key: "profile_starting_zones",
        count: 2,
        targets: [
          { id: f.every, name: "Every" },
          { id: f.explicit, name: "Explicit" },
        ],
      },
      { key: "zone_policies", count: 1, targets: [] },
      { key: "counter_default", count: 1, targets: [{ id: f.forbidden, name: "Unpermitted" }] },
    ]);
    await clearServiceDeleteSettings(tx, f.cfg, [f.gone], null);
    await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.gone));
    expect(await readProfileZones(tx, f.cfg, f.explicit)).toEqual({
      departmentId: f.department,
      allowedZoneIds: [f.allowed],
      startingZoneId: f.allowed,
    });
    expect(await readProfileZones(tx, f.cfg, f.every)).toEqual({
      departmentId: f.department,
      allowedZoneIds: [f.forbidden, f.allowed],
      startingZoneId: f.forbidden,
    });
    expect(await readProfileServiceScopes(tx, [f.explicit, f.every])).toEqual([
      {
        profileId: f.explicit,
        departmentId: f.department,
        allowedZoneIds: [f.allowed],
        startingZoneId: f.allowed,
      },
      {
        profileId: f.every,
        departmentId: f.department,
        allowedZoneIds: null,
        startingZoneId: f.forbidden,
      },
    ]);
    const [stored] = await readProfileServiceScopes(tx, [f.explicit]);
    await setProfileServiceScope(tx, f.cfg, f.explicit, stored!);
    expect((await readProfileServiceScopes(tx, [f.explicit]))[0]).toEqual(stored);
    expect(
      await tx
        .select()
        .from(deviceProfileServiceAccess)
        .where(inArray(deviceProfileServiceAccess.deviceProfileId, [f.retired, f.kitchen])),
    ).toEqual([]);
    expect((await resolveNewOrderZone(tx, f.cfg, { profileId: f.explicit })).zoneId).toBe(
      f.allowed,
    );
    expect((await resolveNewOrderZone(tx, f.cfg, {})).zoneId).toBe(f.forbidden);
  });
});

it("delete last screen zone leaves an explicit empty parent on disabled devices and profiles", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const [d] = await tx
      .insert(devices)
      .values({
        ...f.cfg,
        deviceProfileId: f.explicit,
        label: "Off screen",
        tokenHash: "hash",
        active: false,
      })
      .returning();
    await tx.insert(deviceProfileKitchenScreens).values({
      deviceProfileId: f.explicit,
      screen: "pass",
      everyStation: true,
      everyZone: false,
    });
    await tx
      .insert(deviceProfileKitchenScreenZones)
      .values({ deviceProfileId: f.explicit, screen: "pass", zoneId: f.gone });
    await tx
      .insert(deviceKitchenScreens)
      .values({ deviceId: d!.id, screen: "pass", everyStation: true, everyZone: false });
    await tx
      .insert(deviceKitchenScreenZones)
      .values({ deviceId: d!.id, screen: "pass", zoneId: f.gone });
    await tx
      .insert(deviceKitchenScreenRemovals)
      .values({ deviceId: d!.id, screen: "pass", zoneId: f.gone });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ ...f.cfg, name: "Surviving station" })
      .returning();
    await tx.insert(deviceProfileKitchenScreens).values({
      deviceProfileId: f.kitchen,
      screen: "pass_monitor",
      everyStation: true,
      everyZone: false,
    });
    await tx
      .update(deviceProfileKitchenScreens)
      .set({ everyStation: false })
      .where(eq(deviceProfileKitchenScreens.deviceProfileId, f.explicit));
    await tx
      .update(deviceKitchenScreens)
      .set({ everyStation: false })
      .where(eq(deviceKitchenScreens.deviceId, d!.id));
    await tx
      .insert(deviceProfileKitchenScreenStations)
      .values({ deviceProfileId: f.explicit, screen: "pass", stationId: station!.id });
    await tx
      .insert(deviceKitchenScreenStations)
      .values({ deviceId: d!.id, screen: "pass", stationId: station!.id });
    const stationBounds = {
      profiles: await tx.select().from(deviceProfileKitchenScreenStations),
      devices: await tx.select().from(deviceKitchenScreenStations),
    };
    const parents = {
      profiles: await tx.select().from(deviceProfileKitchenScreens),
      devices: await tx.select().from(deviceKitchenScreens),
    };
    const impact = await readServiceDeleteSettings(tx, f.cfg, [f.gone], null);
    expect(impact.filter((row) => row.key.startsWith("screen_"))).toEqual([
      {
        key: "screen_zones",
        count: 2,
        targets: [
          { id: f.explicit, name: "Explicit" },
          { id: d!.id, name: "Off screen" },
        ],
      },
      { key: "screen_notices", count: 1, targets: [{ id: d!.id, name: "Off screen" }] },
    ]);
    await clearServiceDeleteSettings(tx, f.cfg, [f.gone], null);
    expect(await tx.select().from(deviceProfileKitchenScreens)).toEqual(parents.profiles);
    expect(await tx.select().from(deviceKitchenScreens)).toEqual(parents.devices);
    expect(await tx.select().from(deviceProfileKitchenScreenStations)).toEqual(
      stationBounds.profiles,
    );
    expect(await tx.select().from(deviceKitchenScreenStations)).toEqual(stationBounds.devices);
    expect(
      (await readProfileKitchenScreens(tx, f.cfg)).find((row) => row.profileId === f.explicit)
        ?.screens,
    ).toEqual({ pass: { stationIds: [station!.id], zoneIds: [] } });
    expect(await readDeviceKitchenScreens(tx, f.cfg, d!.id)).toEqual([]);
    expect(
      await tx
        .select()
        .from(deviceKitchenScreenRemovals)
        .where(eq(deviceKitchenScreenRemovals.deviceId, d!.id)),
    ).toEqual([]);
  });
});

it("delete removes only owned configuration and keeps every unaffected row", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    // The live service profiles would refuse department deletion; this helper runs after that check.
    await tx
      .delete(deviceProfileServiceAccess)
      .where(inArray(deviceProfileServiceAccess.deviceProfileId, [f.explicit, f.every]));
    const [menu] = await tx.insert(catalogues).values({ name: "Published menu" }).returning();
    const periods = await tx
      .insert(menuPeriods)
      .values([
        { departmentId: f.department, name: "Lunch", menuId: menu!.id },
        { departmentId: f.department, name: "Dinner", menuId: menu!.id },
        { departmentId: f.alpha, name: "Other", menuId: menu!.id },
      ])
      .returning();
    const [p1, p2, p3] = periods.map((row) => row.id) as [string, string, string];
    const cells = await tx
      .insert(routingCells)
      .values([
        { ...f.cfg, zoneId: f.gone, noPreparation: true },
        { ...f.cfg, noCategory: true, noPreparation: true },
        { ...f.cfg, zoneId: f.elsewhere, noPreparation: true },
      ])
      .returning();
    const children = await tx
      .insert(routingCellPeriods)
      .values([
        { cellId: cells[0]!.id, periodId: p1, departmentId: f.department, noPreparation: true },
        { cellId: cells[0]!.id, periodId: p2, departmentId: f.department, noPreparation: true },
        { cellId: cells[1]!.id, periodId: p1, departmentId: f.department, noPreparation: true },
        { cellId: cells[1]!.id, periodId: p3, departmentId: f.alpha, noPreparation: true },
      ])
      .returning();
    await tx.insert(menuPeriodStaffMenus).values(
      periods.map((row) => ({
        periodId: row.id,
        departmentId: row.departmentId,
        menuId: menu!.id,
      })),
    );
    await tx.insert(periodExtensions).values([
      {
        departmentId: f.department,
        periodId: p1,
        businessDay: "2026-10-12",
        startsAt: "17:00:00",
        endsAt: "18:00:00",
      },
      {
        departmentId: f.alpha,
        periodId: p3,
        businessDay: "2026-10-12",
        startsAt: "17:00:00",
        endsAt: "18:00:00",
      },
    ]);
    await tx.insert(zoneSalePolicies).values([{ zoneId: f.gone }, { zoneId: f.elsewhere }]);
    await tx.insert(zoneExtensions).values(
      [f.gone, f.elsewhere].map((zoneId) => ({
        zoneId,
        businessDay: "2026-10-12",
        startsAt: "17:00:00",
        endsAt: "18:00:00",
      })),
    );
    await tx.insert(departmentTransferDesks).values([
      { departmentId: f.department, receivingProfileId: f.explicit },
      { departmentId: f.alpha, receivingProfileId: f.explicit },
    ]);
    await tx.insert(departmentTransferDestinations).values([
      { sourceDepartmentId: f.department, destinationDepartmentId: f.alpha },
      { sourceDepartmentId: f.beta, destinationDepartmentId: f.department },
      { sourceDepartmentId: f.alpha, destinationDepartmentId: f.beta },
    ]);
    await tx
      .insert(departmentReceipts)
      .values({ departmentId: f.department, receipt: { email: "receipt@example.com" } });
    const tables = {
      cells: routingCells,
      children: routingCellPeriods,
      periods: menuPeriods,
      staff: menuPeriodStaffMenus,
      extensions: periodExtensions,
      policies: zoneServicePolicies,
      overrides: zoneSalePolicies,
      zoneExtensions,
      sales: departmentSalePolicies,
      desks: departmentTransferDesks,
      routes: departmentTransferDestinations,
      receipts: departmentReceipts,
      menus: catalogues,
    };
    const before: Record<string, Record<string, unknown>[]> = {};
    for (const [key, table] of Object.entries(tables)) before[key] = await tx.select().from(table);
    expect(
      await readServiceDeleteSettings(tx, f.cfg, [f.gone, f.forbidden, f.allowed], f.department),
    ).toEqual([
      { key: "routing_rules", count: 1, targets: [] },
      { key: "routing_periods", count: 3, targets: [] },
      { key: "profile_zones", count: 2, targets: [] },
      { key: "zone_policies", count: 4, targets: [] },
      { key: "zone_extensions", count: 1, targets: [] },
      { key: "department_periods", count: 2, targets: [] },
      { key: "staff_menus", count: 2, targets: [] },
      { key: "period_extensions", count: 1, targets: [] },
      { key: "department_policy", count: 1, targets: [] },
      { key: "transfer_desks", count: 1, targets: [{ id: f.explicit, name: "Explicit" }] },
      {
        key: "transfer_routes",
        count: 2,
        targets: [
          { id: f.alpha, name: "Alpha" },
          { id: f.beta, name: "Beta" },
        ],
      },
      { key: "default_department", count: 1, targets: [{ id: f.alpha, name: "Alpha" }] },
      { key: "counter_default", count: 1, targets: [{ id: f.elsewhere, name: "Elsewhere" }] },
    ]);
    await clearServiceDeleteSettings(tx, f.cfg, [f.gone, f.forbidden, f.allowed], f.department);
    expect(await tx.select().from(routingCells)).toEqual(
      before.cells!.filter((row) => row.id !== cells[0]!.id),
    );
    expect(await tx.select().from(routingCellPeriods)).toEqual(
      before.children!.filter((row) => row.id === children[3]!.id),
    );
    for (const [key, table] of Object.entries(tables)) {
      if (["cells", "children", "routes", "policies"].includes(key)) continue;
      const removedIds = [f.gone, f.department];
      expect(await tx.select().from(table), key).toEqual(
        before[key]!.filter(
          (row) =>
            !removedIds.includes(
              "zoneId" in row
                ? (row.zoneId as string)
                : "departmentId" in row && key !== "receipts"
                  ? (row.departmentId as string)
                  : "",
            ),
        ),
      );
    }
    expect(await tx.select().from(departmentTransferDestinations)).toEqual(
      before.routes!.filter((row) => row.sourceDepartmentId === f.alpha),
    );
    expect(await tx.select().from(zoneServicePolicies)).toEqual(
      before
        .policies!.filter((row) => ![f.gone, f.forbidden, f.allowed].includes(row.zoneId as string))
        .map((row) => (row.zoneId === f.elsewhere ? { ...row, isCounterDefault: true } : row)),
    );
    expect(
      await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.isDefault, true)),
    ).toEqual([{ id: f.alpha }]);
    expect((await resolveNewOrderZone(tx, f.cfg, {})).zoneId).toBe(f.elsewhere);
  });
});

it("delete takes the department's season days and their ranges before its periods, and keeps another department's", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    await tx
      .delete(deviceProfileServiceAccess)
      .where(inArray(deviceProfileServiceAccess.deviceProfileId, [f.explicit, f.every]));
    const [menu] = await tx.insert(catalogues).values({ name: "Published menu" }).returning();
    const [lunch, other] = await tx
      .insert(menuPeriods)
      .values([
        { departmentId: f.department, name: "Lunch", menuId: menu!.id },
        { departmentId: f.alpha, name: "Other", menuId: menu!.id },
      ])
      .returning();
    const [winter] = await tx
      .insert(seasons)
      .values({ ...f.cfg, name: "Winter", startsOn: "12-01" })
      .returning();
    const days = await tx
      .insert(departmentDays)
      .values([
        { departmentId: f.department, seasonId: winter!.id, weekday: 2 },
        { departmentId: f.alpha, seasonId: winter!.id, weekday: 2 },
      ])
      .returning();
    await tx.insert(departmentDayRanges).values(
      days.map((day, i) => ({
        dayId: day.id,
        departmentId: day.departmentId,
        periodId: (i === 0 ? lunch : other)!.id,
        startsAt: "13:00:00",
        endsAt: "16:00:00",
      })),
    );
    const zoneDaysWritten = await tx
      .insert(zoneDays)
      .values([
        { zoneId: f.gone, seasonId: winter!.id, weekday: 2 },
        { zoneId: f.elsewhere, seasonId: winter!.id, weekday: 2 },
      ])
      .returning();
    await tx
      .insert(zoneDayRanges)
      .values(
        zoneDaysWritten.map((day) => ({ dayId: day.id, startsAt: "17:00:00", endsAt: "19:00:00" })),
      );

    await clearServiceDeleteSettings(tx, f.cfg, [f.gone, f.forbidden, f.allowed], f.department);

    expect(
      await tx
        .select({ id: menuPeriods.id })
        .from(menuPeriods)
        .where(inArray(menuPeriods.departmentId, [f.department, f.alpha])),
    ).toEqual([{ id: other!.id }]);
    expect(
      await tx
        .select({ departmentId: departmentDays.departmentId })
        .from(departmentDays)
        .where(eq(departmentDays.seasonId, winter!.id)),
    ).toEqual([{ departmentId: f.alpha }]);
    expect(
      await tx
        .select({ periodId: departmentDayRanges.periodId })
        .from(departmentDayRanges)
        .where(
          inArray(
            departmentDayRanges.dayId,
            days.map((day) => day.id),
          ),
        ),
    ).toEqual([{ periodId: other!.id }]);
    expect(
      await tx
        .select({ zoneId: zoneDays.zoneId })
        .from(zoneDays)
        .where(eq(zoneDays.seasonId, winter!.id)),
    ).toEqual([{ zoneId: f.elsewhere }]);
  });
});

async function paintSeasons(tx: Transaction) {
  const f = await fixture(tx);
  const [menu] = await tx.insert(catalogues).values({ name: "Published menu" }).returning();
  const [lunch] = await tx
    .insert(menuPeriods)
    .values({ departmentId: f.department, name: "Lunch", menuId: menu!.id })
    .returning();
  const seasonsByName = new Map(
    (await ensureDefaultSeasons(tx, f.cfg)).map((season) => [season.name, season.id]),
  );
  const at = new Date("2030-01-01T12:00:00Z");
  const week = (seasonId?: string) =>
    replaceMenuWeek(
      tx,
      f.cfg,
      f.department,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots:
          weekday === 2
            ? [
                { periodId: lunch!.id, startsAt: "09:00", endsAt: "11:00" },
                { periodId: lunch!.id, startsAt: "13:00", endsAt: "16:00" },
              ]
            : [],
      })),
      at,
      0,
      seasonId === undefined ? {} : { seasonId },
    );
  const closure = (seasonId: string) =>
    replaceZoneClosedWeek(
      tx,
      f.cfg,
      f.gone,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: weekday === 5 ? [{ startsAt: "22:00", endsAt: "23:30" }] : [],
      })),
      0,
      at,
      { seasonId },
    );
  return { f, season: (name: string) => seasonsByName.get(name)!, week, closure };
}

const seasonLines = (impact: { key: string }[]) => impact.filter((item) => item.key === "seasons");

it("the delete impact counts a week saved with no season once per season", async () => {
  await run(async (tx) => {
    const { f, week } = await paintSeasons(tx);
    await week();

    const impact = await readServiceDeleteSettings(
      tx,
      f.cfg,
      [f.gone, f.forbidden, f.allowed],
      f.department,
    );
    expect(seasonLines(impact)).toEqual([{ key: "seasons", count: 4, targets: [] }]);
  });
});

it("the delete impact counts one season for a week painted in Winter only, with a Winter closure in its zone", async () => {
  await run(async (tx) => {
    const { f, season, week, closure } = await paintSeasons(tx);
    await week(season("Winter"));
    await closure(season("Winter"));

    expect(
      seasonLines(
        await readServiceDeleteSettings(tx, f.cfg, [f.gone, f.forbidden, f.allowed], f.department),
      ),
    ).toEqual([{ key: "seasons", count: 1, targets: [] }]);
    await clearServiceDeleteSettings(tx, f.cfg, [f.gone, f.forbidden, f.allowed], f.department);
    expect(await tx.select().from(departmentDays)).toEqual([]);
    expect(await tx.select().from(departmentDayRanges)).toEqual([]);
    expect(await tx.select().from(zoneDays)).toEqual([]);
    expect(await tx.select().from(zoneDayRanges)).toEqual([]);
  });
});

it("a zone delete counts the seasons holding its closures and none of its department's hours", async () => {
  await run(async (tx) => {
    const { f, season, week, closure } = await paintSeasons(tx);
    await week();
    await closure(season("Winter"));
    await closure(season("Summer"));

    expect(seasonLines(await readServiceDeleteSettings(tx, f.cfg, [f.gone], null))).toEqual([
      { key: "seasons", count: 2, targets: [] },
    ]);
  });
});

it("delete counter default chooses by display order then name then id within its department", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    await tx
      .update(floorZones)
      .set({ displayOrder: 1, name: "Alpha" })
      .where(eq(floorZones.id, f.allowed));
    await clearServiceDeleteSettings(tx, f.cfg, [f.gone], null);
    expect(
      await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.isCounterDefault, true)),
    ).toEqual([{ zoneId: f.allowed }]);
    expect((await resolveNewOrderZone(tx, f.cfg, {})).zoneId).toBe(f.allowed);
  });
});

it("delete without a surviving configured zone leaves default_missing and never widens an empty profile", async () => {
  const f = await run(async (tx) => {
    const f = await fixture(tx);
    await tx.delete(deviceProfileZones).where(eq(deviceProfileZones.deviceProfileId, f.explicit));
    expect(
      (
        await readServiceDeleteSettings(
          tx,
          f.cfg,
          [f.gone, f.forbidden, f.allowed, f.elsewhere],
          null,
        )
      ).filter((row) => row.key === "counter_default"),
    ).toEqual([{ key: "counter_default", count: 1, targets: [] }]);
    await clearServiceDeleteSettings(
      tx,
      f.cfg,
      [f.gone, f.forbidden, f.allowed, f.elsewhere],
      null,
    );
    await tx
      .update(floorZones)
      .set({ active: false })
      .where(inArray(floorZones.id, [f.gone, f.forbidden, f.allowed, f.elsewhere]));
    expect(await readServiceDeleteSettings(tx, f.cfg, [], null)).toEqual([]);
    expect(await readProfileZones(tx, f.cfg, f.explicit)).toEqual({
      departmentId: f.department,
      allowedZoneIds: [],
      startingZoneId: null,
    });
    return f;
  });
  await expect(run((tx) => resolveNewOrderZone(tx, f.cfg, {}))).rejects.toMatchObject({
    code: "service_zone.default_missing",
    params: {},
  });
  await expect(
    run((tx) => resolveNewOrderZone(tx, f.cfg, { profileId: f.explicit })),
  ).rejects.toMatchObject({
    code: "device_profile.no_service_zone",
    params: { profileId: f.explicit },
  });
});

it("delete keeps missing-parent and KDS service access unrestricted while a retained empty parent stays restricted", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const [unbound] = await tx
      .insert(deviceProfiles)
      .values({ name: "Unbound", formFactor: "till" })
      .returning();
    await tx.delete(deviceProfileZones).where(eq(deviceProfileZones.deviceProfileId, f.explicit));
    await clearServiceDeleteSettings(tx, f.cfg, [f.gone], null);
    await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.gone));
    expect(await readProfileZones(tx, f.cfg, f.explicit)).toEqual({
      departmentId: f.department,
      allowedZoneIds: [],
      startingZoneId: null,
    });
    expect(
      await tx
        .select()
        .from(deviceProfileServiceAccess)
        .where(eq(deviceProfileServiceAccess.deviceProfileId, f.explicit)),
    ).toEqual([
      {
        deviceProfileId: f.explicit,
        departmentId: f.department,
        everyZone: false,
        startingZoneId: f.gone,
      },
    ]);
    for (const profileId of [unbound!.id, f.kitchen]) {
      expect(await readProfileZones(tx, f.cfg, profileId)).toEqual({
        departmentId: null,
        allowedZoneIds: null,
        startingZoneId: null,
      });
      expect((await resolveNewOrderZone(tx, f.cfg, { profileId })).zoneId).toBe(f.forbidden);
    }
  });
});

it("delete ignores another location and preserves defaults when the removed zone was not default", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const elsewhere = await fixture(tx, " other location");
    const before = {
      policies: await tx.select().from(zoneServicePolicies),
      departments: await tx.select().from(departments),
      scopes: await tx.select().from(deviceProfileServiceAccess),
    };
    expect(
      await readServiceDeleteSettings(tx, f.cfg, [elsewhere.gone], elsewhere.department),
    ).toEqual([]);
    await clearServiceDeleteSettings(tx, f.cfg, [elsewhere.gone], elsewhere.department);
    expect(await tx.select().from(zoneServicePolicies)).toEqual(before.policies);
    expect(await tx.select().from(departments)).toEqual(before.departments);
    expect(await tx.select().from(deviceProfileServiceAccess)).toEqual(before.scopes);
    expect(await readServiceDeleteSettings(tx, f.cfg, [f.forbidden], null)).toEqual([
      { key: "zone_policies", count: 1, targets: [] },
    ]);
    await clearServiceDeleteSettings(tx, f.cfg, [f.forbidden], null);
    expect((await resolveNewOrderZone(tx, f.cfg, {})).zoneId).toBe(f.gone);
    expect(await tx.select().from(departments)).toEqual(before.departments);
  });
});
