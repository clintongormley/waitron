import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addProductToMenu,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  locationDayCutoverChanges,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { replaceMenuWeek, resolveDepartmentService, saveMenuPeriod } from "./menu-timetable.js";
import { clearRoutingCell, setRoutingCell } from "./routing-store.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";
import { closeStationForToday } from "./station-times.js";
import { stationServiceTimes } from "./station-service-times.js";
import { readSeasons } from "./seasons.js";
import { menuPeriods } from "./schema/menus.js";
import * as service from "./index.js";
import { readLocationClock } from "@waitron/reporting";
import { saveSpecialDay, type SpecialDayInput } from "./special-days.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const day = "2026-10-12";
const at = new Date("2026-10-10T10:00:00Z");
const tx = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const week = <T>(field: "slots" | "ranges", monday: readonly T[]) =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, [field]: weekday === 1 ? monday : [] }));
async function fixture(db: Transaction) {
  const [venue] = await db
    .insert(locations)
    .values({
      name: randomUUID(),
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant",
    })
    .returning();
  const cfg = { locationId: locationId(venue!.id) };
  const department = (await createDepartment(db, cfg, { name: "Dining", orderStart: "table" })).id;
  const [terrace] = await db
    .insert(floorZones)
    .values({ ...cfg, name: "Terrace" })
    .returning();
  await configureZone(db, cfg, { zoneId: terrace!.id, departmentId: department });
  const stations = await db
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Bar", isDefault: true },
      { ...cfg, name: "Cocktails" },
      { ...cfg, name: "Unused" },
      { ...cfg, name: "Off", active: false },
    ])
    .returning();
  const menu = (await createCatalogue(db, { name: randomUUID() })).id;
  const category = (await createCategory(db, { name: randomUUID() })).id;
  const product = (
    await createProduct(db, {
      catalogueId: menu,
      name: randomUUID(),
      categoryId: category,
      unitPrice: "3",
      pricingUnit: "each",
      vatClass: "general",
    })
  ).id;
  await addProductToMenu(db, { menuId: menu, productId: product });
  const lunch = (
    await saveMenuPeriod(
      db,
      cfg,
      department,
      {
        name: "Lunch",
        menuId: menu,
        staffMenuIds: [],
        colour: "blue",
      },
      0,
    )
  ).id;
  const afternoon = (
    await saveMenuPeriod(
      db,
      cfg,
      department,
      {
        name: "Afternoon",
        menuId: menu,
        staffMenuIds: [],
        colour: "green",
      },
      0,
    )
  ).id;
  const lunchRange = { periodId: lunch, startsAt: "12:00", endsAt: "16:00" };
  await replaceMenuWeek(
    db,
    cfg,
    department,
    week("slots", [lunchRange, { periodId: afternoon, startsAt: "16:00", endsAt: "18:00" }]),
    at,
    0,
  );
  const station = stations[1]!.id;
  await setRoutingCell(
    db,
    cfg,
    { row: { kind: "category", categoryId: category }, zoneId: terrace!.id },
    { kind: "no_preparation" },
    [{ periodId: lunch, target: { kind: "station", stationId: station } }],
  );
  return {
    cfg,
    department,
    terrace: terrace!.id,
    station,
    defaultStation: stations[0]!.id,
    unused: stations[2]!.id,
    off: stations[3]!.id,
    menu,
    product,
    category,
    lunch,
    afternoon,
    lunchRange,
  };
}
const planned = (f: Awaited<ReturnType<typeof fixture>>, ranges = [f.lunchRange]) => ({
  always: null,
  days: [{ date: day, departments: [{ departmentId: f.department, ranges }] }],
});
const specialDay = (
  db: Transaction,
  f: Awaited<ReturnType<typeof fixture>>,
  input: SpecialDayInput,
) => saveSpecialDay(db, f.cfg, null, input, at, 0);
/** A second department whose Monday 15:00-17:00 service reaches the station through its own zone. */
async function paintableTakeaway(db: Transaction, f: Awaited<ReturnType<typeof fixture>>) {
  const takeaway = (await createDepartment(db, f.cfg, { name: "Takeaway", orderStart: "table" }))
    .id;
  const [counter] = await db
    .insert(floorZones)
    .values({ ...f.cfg, name: "Counter" })
    .returning();
  await configureZone(db, f.cfg, { zoneId: counter!.id, departmentId: takeaway });
  const period = (
    await saveMenuPeriod(
      db,
      f.cfg,
      takeaway,
      { name: "Lunch", menuId: f.menu, staffMenuIds: [], colour: "blue" },
      0,
    )
  ).id;
  await replaceMenuWeek(
    db,
    f.cfg,
    takeaway,
    week("slots", [{ periodId: period, startsAt: "15:00", endsAt: "17:00" }]),
    at,
    0,
  );
  await setRoutingCell(
    db,
    f.cfg,
    { row: { kind: "category", categoryId: f.category }, zoneId: counter!.id },
    { kind: "station", stationId: f.station },
  );
  return takeaway;
}
it("shows a special date's painted Dinner 19:00-01:00 for a station routed only during Dinner", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const dinner = (
      await saveMenuPeriod(
        db,
        f.cfg,
        f.department,
        { name: "Dinner", menuId: f.menu, staffMenuIds: [], colour: "red" },
        0,
      )
    ).id;
    await setRoutingCell(
      db,
      f.cfg,
      { row: { kind: "category", categoryId: f.category }, zoneId: f.terrace },
      { kind: "no_preparation" },
      [{ periodId: dinner, target: { kind: "station", stationId: f.station } }],
    );
    await specialDay(db, f, {
      name: "Late opening",
      repeatsYearly: false,
      dates: [{ date: day, closedAllDay: false }],
      paint: [
        {
          departmentId: f.department,
          date: day,
          ranges: [{ periodId: dinner, startsAt: "19:00", endsAt: "01:00" }],
        },
      ],
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ periodId: dinner, startsAt: "19:00", endsAt: "01:00" }]),
    );
  }));
it("shows only Lunch when the period line sends Cocktails there only during Lunch", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(planned(f));
  }));
it("applies a special day's painted ranges and zone closures", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await specialDay(db, f, {
      name: "Celebration",
      repeatsYearly: false,
      dates: [{ date: day, closedAllDay: false }],
      paint: [
        {
          departmentId: f.department,
          date: day,
          ranges: [
            { periodId: null, startsAt: "12:00", endsAt: "13:00" },
            { periodId: f.lunch, startsAt: "13:00", endsAt: "17:00" },
            { periodId: null, startsAt: "17:00", endsAt: "18:00" },
          ],
        },
      ],
      zonePaint: [
        {
          zoneId: f.terrace,
          date: day,
          ranges: [{ kind: "closed", startsAt: "15:00", endsAt: "06:00" }],
        },
      ],
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ periodId: f.lunch, startsAt: "13:00", endsAt: "15:00" }]),
    );
  }));
it("cuts Lunch at 15:00 when its only routing zone closes then", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "15:00", endsAt: "06:00" }]),
      0,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ ...f.lunchRange, endsAt: "15:00" }]),
    );
  }));
it("unions overlapping zone shares without duplicate ranges", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const [inside] = await db
      .insert(floorZones)
      .values({ ...f.cfg, name: "Inside" })
      .returning();
    await configureZone(db, f.cfg, { zoneId: inside!.id, departmentId: f.department });
    await setRoutingCell(
      db,
      f.cfg,
      { row: { kind: "category", categoryId: f.category }, zoneId: inside!.id },
      { kind: "station", stationId: f.station },
    );
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "14:00", endsAt: "06:00" }]),
      0,
    );
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      inside!.id,
      week("ranges", [
        { startsAt: "06:00", endsAt: "13:00" },
        { startsAt: "15:00", endsAt: "06:00" },
      ]),
      0,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ ...f.lunchRange, endsAt: "15:00" }]),
    );
  }));
it("keeps separate surviving segments around a zone closure", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "13:00", endsAt: "14:00" }]),
      0,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [
        { ...f.lunchRange, endsAt: "13:00" },
        { ...f.lunchRange, startsAt: "14:00" },
      ]),
    );
  }));
it("answers default without a grid", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    expect(await stationServiceTimes(db, f.cfg, f.defaultStation, day, day)).toEqual({
      always: "default",
      days: [],
    });
  }));
it("refuses a deleted station instead of showing a switched-off grid", async () => {
  const f = await tx(fixture);
  await expect(tx((db) => stationServiceTimes(db, f.cfg, f.off, day, day))).rejects.toMatchObject({
    code: "station.not_found",
  });
});
it.each([
  "unrouted",
  "inactive zone",
  "inactive department",
  "inactive product",
  "no menu product",
  "whole venue closed",
  "whole zone closed",
] as const)("has no ranges for %s", async (kind) =>
  tx(async (db) => {
    const f = await fixture(db);
    if (kind === "inactive zone")
      await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.terrace));
    if (kind === "inactive department") {
      const { departments } = await import("./schema/service.js");
      await db.update(departments).set({ active: false }).where(eq(departments.id, f.department));
    }
    if (kind === "inactive product")
      await db.update(products).set({ active: false }).where(eq(products.id, f.product));
    if (kind === "no menu product") {
      const { sectionMembers } = await import("@waitron/catalogue");
      await db.delete(sectionMembers).where(eq(sectionMembers.productId, f.product));
    }
    if (kind === "whole venue closed")
      await specialDay(db, f, {
        name: "Closed",
        repeatsYearly: false,
        dates: [{ date: day, closedAllDay: true }],
      });
    if (kind === "whole zone closed")
      await replaceZoneClosedWeek(
        db,
        f.cfg,
        f.terrace,
        week("ranges", [{ startsAt: "06:00", endsAt: "06:00" }]),
        0,
      );
    expect(
      await stationServiceTimes(db, f.cfg, kind === "unrouted" ? f.unused : f.station, day, day),
    ).toEqual({ always: null, days: [{ date: day, departments: [] }] });
  }),
);
it("planning ignores a station's daily closure", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await closeStationForToday(
      db,
      f.cfg,
      f.station,
      f.defaultStation,
      new Date("2026-10-12T11:00:00Z"),
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(planned(f));
  }));
it.each([
  ["2026-10-12", "2026-11-23", "to"],
  ["bad", day, "from"],
  [day, "2026-02-30", "to"],
  [day, "2026-10-11", "to"],
])("refuses a bad or oversized range %s..%s", async (from, to, field) => {
  const f = await tx(fixture);
  await expect(
    tx((db) => stationServiceTimes(db, f.cfg, f.station, from!, to!)),
  ).rejects.toMatchObject({ code: "management.request_invalid", params: { field } });
});
it("allows exactly 42 days, keeping closed dates in order", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const result = await stationServiceTimes(db, f.cfg, f.unused, day, "2026-11-22");
    expect(result.always).toBeNull();
    expect(result.days).toHaveLength(42);
    expect(result.days[0]).toEqual({ date: day, departments: [] });
    expect(result.days[41]).toEqual({ date: "2026-11-22", departments: [] });
  }));
it("refuses unknown and another venue's stations", async () => {
  const f = await tx(fixture),
    other = await tx(fixture);
  for (const stationId of [randomUUID(), other.station])
    await expect(
      tx((db) => stationServiceTimes(db, f.cfg, stationId, day, day)),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId } });
});

it("reads products from staff menus and routes a variant by its parent's category", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const empty = (await createCatalogue(db, { name: randomUUID() })).id;
    const [variant] = await db
      .insert(products)
      .values({ catalogueId: f.menu, parentId: f.product, name: randomUUID(), categoryId: null })
      .returning();
    const variantMenu = (await createCatalogue(db, { name: randomUUID() })).id;
    await addProductToMenu(db, { menuId: variantMenu, productId: f.product });
    await db.update(products).set({ active: false }).where(eq(products.id, f.product));
    expect(variant!.parentId).toBe(f.product);
    const { updateMenuPeriod } = await import("./menu-timetable.js");
    await updateMenuPeriod(
      db,
      f.cfg,
      f.lunch,
      {
        name: "Lunch",
        menuId: empty,
        staffMenuIds: [variantMenu],
        colour: "blue",
      },
      0,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(planned(f));
  }));
it("a repeating special day uses its occurrence, with an unpainted department still following the week", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const takeaway = await paintableTakeaway(db, f);
    await specialDay(db, f, {
      name: "Annual day",
      repeatsYearly: true,
      dates: [{ date: day, closedAllDay: false }],
      paint: [
        {
          departmentId: takeaway,
          date: day,
          ranges: [{ periodId: null, startsAt: "15:00", endsAt: "17:00" }],
        },
      ],
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, "2037-10-12", "2037-10-12")).toEqual({
      always: null,
      days: [
        {
          date: "2037-10-12",
          departments: [{ departmentId: f.department, ranges: [f.lunchRange] }],
        },
      ],
    });
  }));
it("keeps cross-midnight service ranges and ignores today's kept-open period", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(
      db,
      f.cfg,
      f.department,
      week("slots", [{ periodId: f.lunch, startsAt: "22:00", endsAt: "02:00" }]),
      at,
      0,
    );
    const { periodExtensions } = await import("./schema/period-extensions.js");
    await db.insert(periodExtensions).values({
      departmentId: f.department,
      businessDay: day,
      periodId: f.lunch,
      startsAt: "22:00:00",
      endsAt: "03:00:00",
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ periodId: f.lunch, startsAt: "22:00", endsAt: "02:00" }]),
    );
  }));
it("keeps each active department's ranges, cut by its own zone", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const second = (await createDepartment(db, f.cfg, { name: "Takeaway", orderStart: "table" }))
      .id;
    const [zone] = await db
      .insert(floorZones)
      .values({ ...f.cfg, name: "Counter" })
      .returning();
    await configureZone(db, f.cfg, { zoneId: zone!.id, departmentId: second });
    const period = (
      await saveMenuPeriod(
        db,
        f.cfg,
        second,
        {
          name: "Lunch",
          menuId: f.menu,
          staffMenuIds: [],
          colour: "blue",
        },
        0,
      )
    ).id;
    await replaceMenuWeek(
      db,
      f.cfg,
      second,
      week("slots", [{ periodId: period, startsAt: "15:00", endsAt: "17:00" }]),
      at,
      0,
    );
    await setRoutingCell(
      db,
      f.cfg,
      { row: { kind: "category", categoryId: f.category }, zoneId: zone!.id },
      { kind: "station", stationId: f.station },
    );
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      zone!.id,
      week("ranges", [{ startsAt: "16:00", endsAt: "06:00" }]),
      0,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual({
      always: null,
      days: [
        {
          date: day,
          departments: [
            { departmentId: f.department, ranges: [f.lunchRange] },
            {
              departmentId: second,
              ranges: [{ periodId: period, startsAt: "15:00", endsAt: "16:00" }],
            },
          ],
        },
      ],
    });
  }));

it("reads the last valid calendar date without stepping beyond its requested range", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    expect(await stationServiceTimes(db, f.cfg, f.unused, "9999-12-31", "9999-12-31")).toEqual({
      always: null,
      days: [{ date: "9999-12-31", departments: [] }],
    });
  }));

it("applies a special day's closure to the date it stands on", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await specialDay(db, f, {
      name: "Closed Monday",
      repeatsYearly: false,
      dates: [{ date: day, closedAllDay: true }],
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual({
      always: null,
      days: [{ date: day, departments: [] }],
    });
  }));

it("clamps a station forecast to the following dated start", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(
      db,
      f.cfg,
      f.department,
      week("slots", [{ periodId: f.lunch, startsAt: "09:00", endsAt: "06:00" }]),
      at,
      0,
    );
    await db.insert(locationDayCutoverChanges).values({
      locationId: f.cfg.locationId,
      effectiveBusinessDay: "2026-10-13",
      dayCutover: "03:00:00",
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, "2026-10-13")).toEqual({
      always: null,
      days: [
        {
          date: day,
          departments: [
            {
              departmentId: f.department,
              ranges: [{ periodId: f.lunch, startsAt: "09:00", endsAt: "03:00" }],
            },
          ],
        },
        { date: "2026-10-13", departments: [] },
      ],
    });
  }));

const seasonDates = [
  "2030-11-25",
  "2030-11-26",
  "2030-11-27",
  "2030-11-28",
  "2030-11-29",
  "2030-11-30",
  "2030-12-01",
  "2030-12-02",
];
async function seasonIds(db: Transaction, f: Awaited<ReturnType<typeof fixture>>) {
  const seasons = await readSeasons(db, f.cfg);
  return (name: string) => seasons.find((season) => season.name === name)!.id;
}
async function winterLunchOnly(db: Transaction, f: Awaited<ReturnType<typeof fixture>>) {
  const seasonId = await seasonIds(db, f);
  await replaceMenuWeek(db, f.cfg, f.department, week("slots", [f.lunchRange]), at, 0, {
    seasonId: seasonId("Winter"),
  });
  await replaceMenuWeek(db, f.cfg, f.department, week("slots", []), at, 0, {
    seasonId: seasonId("Autumn"),
  });
}
const lunchOn =
  (f: Awaited<ReturnType<typeof fixture>>, dates: readonly string[]) => (date: string) => ({
    date,
    departments: dates.includes(date)
      ? [{ departmentId: f.department, ranges: [f.lunchRange] }]
      : [],
  });

it("shows Winter's Monday Lunch on 2 December only, reading each date's own season", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await winterLunchOnly(db, f);
    expect(await stationServiceTimes(db, f.cfg, f.station, "2030-11-25", "2030-12-02")).toEqual({
      always: null,
      days: seasonDates.map(lunchOn(f, ["2030-12-02"])),
    });
  }));

it("cuts Lunch by the zone's closure in each date's own season", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const seasonId = await seasonIds(db, f);
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "12:00", endsAt: "16:00" }]),
      0,
      at,
      { seasonId: seasonId("Winter") },
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, "2030-11-25", "2030-12-02")).toEqual({
      always: null,
      days: seasonDates.map(lunchOn(f, ["2030-11-25"])),
    });
  }));

it("reads the seasons and each season week once over a 42-day range", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const session = (db as unknown as { session: { prepareQuery: (...args: never[]) => unknown } })
      .session;
    const spy = vi.spyOn(session, "prepareQuery");
    try {
      await stationServiceTimes(db, f.cfg, f.station, "2030-11-01", "2030-12-12");
      const texts = spy.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      for (const table of ["seasons", "department_days", "zone_days"])
        expect(
          texts.filter((text) => text.includes(`from "${table}"`)),
          table,
        ).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  }));

// The authored period end, rather than a closure-created segment, carries the offset.
it.each([
  { startsAt: "22:00", endsAt: "02:00", offset: -30, expectedEnd: "01:30" },
  { startsAt: "12:00", endsAt: "16:00", offset: 15, expectedEnd: "16:15" },
])(
  "A724: station orders $startsAt–$endsAt with offset $offset end at $expectedEnd",
  async ({ startsAt, endsAt, offset, expectedEnd }) =>
    tx(async (db) => {
      const f = await fixture(db);
      await replaceMenuWeek(
        db,
        f.cfg,
        f.department,
        week("slots", [{ periodId: f.lunch, startsAt, endsAt }]),
        at,
        0,
      );
      await db
        .update(menuPeriods)
        .set({ endOffsetMinutes: offset })
        .where(eq(menuPeriods.id, f.lunch));
      expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
        planned(f, [{ periodId: f.lunch, startsAt, endsAt: expectedEnd }]),
      );
    }),
);

it("A724: zone closure trims positive grace after the authored end is offset", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(db, f.cfg, f.department, week("slots", [f.lunchRange]), at, 0);
    await db.update(menuPeriods).set({ endOffsetMinutes: 15 }).where(eq(menuPeriods.id, f.lunch));
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "16:00", endsAt: "17:00" }]),
      0,
      at,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(planned(f));
  }));

it("A724: a selected season supplies raw department guides and batched station demand", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await winterLunchOnly(db, f);
    const ids = await seasonIds(db, f);
    const result = await service.readPlannedServiceGuides?.(db, f.cfg, [f.station, f.unused], {
      kind: "season",
      seasonId: ids("Winter"),
      cutover: "06:00",
    });
    expect(result?.departmentRanges.get(f.department)?.get("1")).toEqual([f.lunchRange]);
    expect(result?.stationRanges.get(f.station)?.get("1")).toEqual([
      { departmentId: f.department, ranges: [f.lunchRange] },
    ]);
    expect(result?.stationRanges.get(f.unused)?.get("1")).toEqual([]);
    expect(result?.periods.find((p) => p.id === f.lunch)).toMatchObject({
      name: "Lunch",
      colour: "blue",
      departmentId: f.department,
    });
    const autumn = await service.readPlannedServiceGuides?.(db, f.cfg, [f.station], {
      kind: "season",
      seasonId: ids("Autumn"),
      cutover: "06:00",
    });
    expect(autumn?.stationRanges.get(f.station)?.get("1")).toEqual([]);
  }));

it("A724: scheduled default demand stays bounded and no-preparation stays empty", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await clearRoutingCell(db, f.cfg, {
      row: { kind: "category", categoryId: f.category },
      zoneId: f.terrace,
    });
    const ids = await seasonIds(db, f);
    const result = await service.readPlannedServiceGuides?.(db, f.cfg, [f.defaultStation], {
      kind: "season",
      seasonId: ids("Autumn"),
      cutover: "06:00",
    });
    expect(result?.stationRanges.get(f.defaultStation)?.get("1")).toEqual([
      {
        departmentId: f.department,
        ranges: [f.lunchRange, { periodId: f.afternoon, startsAt: "16:00", endsAt: "18:00" }],
      },
    ]);
    await setRoutingCell(
      db,
      f.cfg,
      { row: { kind: "category", categoryId: f.category }, zoneId: f.terrace },
      { kind: "no_preparation" },
    );
    const none = await service.readPlannedServiceGuides?.(db, f.cfg, [f.defaultStation], {
      kind: "season",
      seasonId: ids("Autumn"),
      cutover: "06:00",
    });
    expect(none?.stationRanges.get(f.defaultStation)?.get("1")).toEqual([]);
  }));

it("A724: grace from the previous weekday crosses the changeover in both readers", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(
      db,
      f.cfg,
      f.department,
      Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        slots: weekday === 0 ? [{ periodId: f.lunch, startsAt: "22:00", endsAt: "06:00" }] : [],
      })),
      at,
      0,
    );
    await db.update(menuPeriods).set({ endOffsetMinutes: 15 }).where(eq(menuPeriods.id, f.lunch));
    const ids = await seasonIds(db, f);
    const result = await service.readPlannedServiceGuides?.(db, f.cfg, [f.station], {
      kind: "season",
      seasonId: ids("Autumn"),
      cutover: "06:00",
    });
    expect(result?.stationRanges.get(f.station)?.get("1")).toEqual([
      {
        departmentId: f.department,
        ranges: [{ periodId: f.lunch, startsAt: "06:00", endsAt: "06:15" }],
      },
    ]);
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ periodId: f.lunch, startsAt: "06:00", endsAt: "06:15" }]),
    );
  }));

it("A724: batched dated forecasts retain distinct sending departments", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const takeaway = await paintableTakeaway(db, f);
    const clock = await readLocationClock(db, f.cfg.locationId);
    const result = await service.readPlannedServiceGuides?.(db, f.cfg, [f.station, f.unused], {
      kind: "dates",
      dates: [day],
      clock,
    });
    expect(result?.stationRanges.get(f.station)?.get(day)).toEqual([
      { departmentId: f.department, ranges: [f.lunchRange] },
      {
        departmentId: takeaway,
        ranges: [{ periodId: expect.any(String), startsAt: "15:00", endsAt: "17:00" }],
      },
    ]);
    expect(result?.stationRanges.get(f.unused)?.get(day)).toEqual([]);
  }));

it.each([
  { startsAt: "06:00", endsAt: "06:00", offset: 0, expected: [["06:00", "06:00"]] },
  { startsAt: "12:00", endsAt: "13:00", offset: -60, expected: [] },
])(
  "A724: full-day and empty sending windows $startsAt/$endsAt/$offset",
  async ({ startsAt, endsAt, offset, expected }) =>
    tx(async (db) => {
      const f = await fixture(db);
      await replaceMenuWeek(
        db,
        f.cfg,
        f.department,
        week("slots", [{ periodId: f.lunch, startsAt, endsAt }]),
        at,
        0,
      );
      await db
        .update(menuPeriods)
        .set({ endOffsetMinutes: offset })
        .where(eq(menuPeriods.id, f.lunch));
      const result = await stationServiceTimes(db, f.cfg, f.station, day, day);
      expect(
        result.days[0]!.departments.flatMap((d) => d.ranges.map((r) => [r.startsAt, r.endsAt])),
      ).toEqual(expected);
    }),
);

it("A724: a negative offset uses the authored end before the dated boundary clamps it", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(
      db,
      f.cfg,
      f.department,
      week("slots", [{ periodId: f.lunch, startsAt: "09:00", endsAt: "06:00" }]),
      at,
      0,
    );
    await db.update(menuPeriods).set({ endOffsetMinutes: -30 }).where(eq(menuPeriods.id, f.lunch));
    await db.insert(locationDayCutoverChanges).values({
      locationId: f.cfg.locationId,
      effectiveBusinessDay: "2026-10-13",
      dayCutover: "03:00:00",
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [{ periodId: f.lunch, startsAt: "09:00", endsAt: "03:00" }]),
    );
  }));

it("A724: the destination zone closure removes prior-day grace", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(
      db,
      f.cfg,
      f.department,
      Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        slots: weekday === 0 ? [{ periodId: f.lunch, startsAt: "22:00", endsAt: "06:00" }] : [],
      })),
      at,
      0,
    );
    await db.update(menuPeriods).set({ endOffsetMinutes: 15 }).where(eq(menuPeriods.id, f.lunch));
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "06:00", endsAt: "07:00" }]),
      0,
      at,
    );
    const result = await stationServiceTimes(db, f.cfg, f.station, day, day);
    expect(result.days).toEqual([{ date: day, departments: [] }]);
  }));

it("A724: season forecasting batches stations and never reads calendar dates", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const ids = await seasonIds(db, f);
    const session = (db as unknown as { session: { prepareQuery: (...args: never[]) => unknown } })
      .session;
    const spy = vi.spyOn(session, "prepareQuery");
    try {
      await service.readPlannedServiceGuides(db, f.cfg, [f.station, f.defaultStation, f.unused], {
        kind: "season",
        seasonId: ids("Autumn"),
        cutover: "06:00",
      });
      const texts = spy.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      for (const table of ["department_days", "zone_days", "menu_periods", "routing_cells"])
        expect(
          texts.filter((text) => text.includes(`from "${table}"`)),
          table,
        ).toHaveLength(1);
      expect(texts.filter((text) => text.includes('from "products"'))).toHaveLength(2);
      expect(
        texts.filter((text) => /from "(?:special_days|special_day_dates|seasons)"/.test(text)),
      ).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  }));

it("A724: two reaching zones union their open shares without filling a shared closure", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const [second] = await db
      .insert(floorZones)
      .values({ ...f.cfg, name: "Inside" })
      .returning();
    await configureZone(db, f.cfg, { zoneId: second!.id, departmentId: f.department });
    await setRoutingCell(
      db,
      f.cfg,
      { row: { kind: "category", categoryId: f.category }, zoneId: second!.id },
      { kind: "station", stationId: f.station },
    );
    await replaceMenuWeek(db, f.cfg, f.department, week("slots", [f.lunchRange]), at, 0);
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      f.terrace,
      week("ranges", [{ startsAt: "13:00", endsAt: "15:00" }]),
      0,
      at,
    );
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      second!.id,
      week("ranges", [{ startsAt: "14:00", endsAt: "16:00" }]),
      0,
      at,
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [
        { periodId: f.lunch, startsAt: "12:00", endsAt: "14:00" },
        { periodId: f.lunch, startsAt: "15:00", endsAt: "16:00" },
      ]),
    );
  }));

it.each([
  { offset: 1, until: "03:01" },
  { offset: 30, until: "03:30" },
])(
  "A724 bounds $offset minutes of carried grace by an earlier dated changeover",
  async ({ offset, until }) =>
    tx(async (db) => {
      const f = await fixture(db);
      await replaceMenuWeek(
        db,
        f.cfg,
        f.department,
        week("slots", [{ periodId: f.lunch, startsAt: "09:00", endsAt: "06:00" }]),
        at,
        0,
      );
      await db
        .update(menuPeriods)
        .set({ endOffsetMinutes: offset })
        .where(eq(menuPeriods.id, f.lunch));
      await db.insert(locationDayCutoverChanges).values({
        locationId: f.cfg.locationId,
        effectiveBusinessDay: "2026-10-13",
        dayCutover: "03:00:00",
      });
      expect(await stationServiceTimes(db, f.cfg, f.station, day, "2026-10-13")).toEqual({
        always: null,
        days: [
          {
            date: day,
            departments: [
              {
                departmentId: f.department,
                ranges: [{ periodId: f.lunch, startsAt: "09:00", endsAt: "03:00" }],
              },
            ],
          },
          {
            date: "2026-10-13",
            departments: [
              {
                departmentId: f.department,
                ranges: [{ periodId: f.lunch, startsAt: "03:00", endsAt: until }],
              },
            ],
          },
        ],
      });
    }),
);

it("A724 all-day negative offsets match sending on consecutive weekdays", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await replaceMenuWeek(
      db,
      f.cfg,
      f.department,
      Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        slots: [{ periodId: f.lunch, startsAt: "06:00", endsAt: "06:00" }],
      })),
      at,
      0,
    );
    await db.update(menuPeriods).set({ endOffsetMinutes: -30 }).where(eq(menuPeriods.id, f.lunch));
    const forecast = await stationServiceTimes(db, f.cfg, f.station, day, "2026-10-13");
    expect(forecast.days).toEqual(
      [day, "2026-10-13"].map((date) => ({
        date,
        departments: [
          {
            departmentId: f.department,
            ranges: [{ periodId: f.lunch, startsAt: "06:00", endsAt: "05:30" }],
          },
        ],
      })),
    );
    const accepts = [];
    for (const at of [
      "2026-10-13T05:20:00+02:00",
      "2026-10-13T05:45:00+02:00",
      "2026-10-13T06:00:00+02:00",
    ]) {
      accepts.push(
        (
          await resolveDepartmentService(db, f.cfg, f.department, new Date(at))
        ).sendableMenuIds.includes(f.menu),
      );
    }
    expect(accepts).toEqual([true, false, true]);
  }));
