import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
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
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { replaceMenuWeek, saveMenuPeriod, saveSpecialDateMenus } from "./menu-timetable.js";
import { setRoutingCell } from "./routing-store.js";
import { saveSpecialDate } from "./hours.js";
import { replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";
import { closeStationForToday } from "./station-times.js";
import { stationServiceTimes } from "./station-service-times.js";

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
    await saveMenuPeriod(db, cfg, department, {
      name: "Lunch",
      menuId: menu,
      staffMenuIds: [],
      colour: "blue",
    })
  ).id;
  const afternoon = (
    await saveMenuPeriod(db, cfg, department, {
      name: "Afternoon",
      menuId: menu,
      staffMenuIds: [],
      colour: "green",
    })
  ).id;
  const lunchRange = { periodId: lunch, startsAt: "12:00", endsAt: "16:00" };
  await replaceMenuWeek(
    db,
    cfg,
    department,
    week("slots", [lunchRange, { periodId: afternoon, startsAt: "16:00", endsAt: "18:00" }]),
    at,
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
it("shows only Lunch when the period line sends Cocktails there only during Lunch", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(planned(f));
  }));
it("applies named-day own ranges and dated zone closures", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    const named = await saveSpecialDate(
      db,
      f.cfg,
      null,
      { date: day, name: "Celebration", ownHours: true, closeWholeVenue: false },
      at,
    );
    await saveSpecialDateMenus(
      db,
      f.cfg,
      named.id,
      f.department,
      [{ periodId: f.lunch, startsAt: "13:00", endsAt: "17:00" }],
      at,
    );
    await saveZoneClosedDate(db, f.cfg, named.id, f.terrace, [
      { startsAt: "15:00", endsAt: "06:00" },
    ]);
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
    );
    await replaceZoneClosedWeek(
      db,
      f.cfg,
      inside!.id,
      week("ranges", [
        { startsAt: "06:00", endsAt: "13:00" },
        { startsAt: "15:00", endsAt: "06:00" },
      ]),
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
    );
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(
      planned(f, [
        { ...f.lunchRange, endsAt: "13:00" },
        { ...f.lunchRange, startsAt: "14:00" },
      ]),
    );
  }));
it.each(["default", "switched_off"] as const)("answers %s without a grid", async (kind) =>
  tx(async (db) => {
    const f = await fixture(db);
    expect(
      await stationServiceTimes(db, f.cfg, kind === "default" ? f.defaultStation : f.off, day, day),
    ).toEqual({ always: kind, days: [] });
  }),
);
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
      await saveSpecialDate(
        db,
        f.cfg,
        null,
        { date: day, name: "Closed", ownHours: false, closeWholeVenue: true },
        at,
      );
    if (kind === "whole zone closed")
      await replaceZoneClosedWeek(
        db,
        f.cfg,
        f.terrace,
        week("ranges", [{ startsAt: "06:00", endsAt: "06:00" }]),
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
    await updateMenuPeriod(db, f.cfg, f.lunch, {
      name: "Lunch",
      menuId: empty,
      staffMenuIds: [variantMenu],
      colour: "blue",
    });
    expect(await stationServiceTimes(db, f.cfg, f.station, day, day)).toEqual(planned(f));
  }));
it("a repeating own-hours day uses its occurrence, with an unsaved department still following the week", async () =>
  tx(async (db) => {
    const f = await fixture(db);
    await saveSpecialDate(
      db,
      f.cfg,
      null,
      { date: day, name: "Annual day", repeats: true, ownHours: true, closeWholeVenue: false },
      at,
    );
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
      await saveMenuPeriod(db, f.cfg, second, {
        name: "Lunch",
        menuId: f.menu,
        staffMenuIds: [],
        colour: "blue",
      })
    ).id;
    await replaceMenuWeek(
      db,
      f.cfg,
      second,
      week("slots", [{ periodId: period, startsAt: "15:00", endsAt: "17:00" }]),
      at,
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
