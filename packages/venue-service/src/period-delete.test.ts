import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { readRoutingUses, replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment } from "./operations.js";
import { periodDeleteImpact, readPaintedIn } from "./period-delete.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { saveSpecialDay } from "./special-days.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const ZONE = "Europe/Madrid";
/** Wednesday 7 October 2026, 12:00 in Madrid: the writers' "now". */
const WRITE_AT = new Date("2026-10-07T10:00:00Z");
/** 00:30 on Thursday 8 October by the clock, still business day Wednesday 7 October (changeover
 *  06:00). */
const AT = localTimeOccurrences("2026-10-08", "00:30", ZONE)[0]!;
const TODAY = "2026-10-07";
const CLOCK_DATE = "2026-10-08";

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});

async function venue() {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: ZONE,
      dayCutover: "06:00:00",
    })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  const cfg = { locationId };
  const [station] = await db
    .insert(kitchenStations)
    .values({ locationId, name: "Cocina", isDefault: true })
    .returning({ id: kitchenStations.id });
  return scoped(async (tx) => {
    const seasons = await ensureDefaultSeasons(tx, cfg);
    const season = (name: string) => seasons.find((entry) => entry.name === name)!.id;
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", orderStart: "counter" })).id;
    const menu = (await createCatalogue(tx, { name: "Carta" })).id;
    const { document } = await buildMenuDocument(tx, menu);
    await publishMenu(tx, menu, menuDocumentHash(document), "person-1");
    const period = async (departmentId: string, name: string) =>
      (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId: menu, staffMenuIds: [] }, 0)).id;
    const dinner = await period(restaurant, "Dinner");
    const lunch = await period(restaurant, "Lunch");
    const afternoon = await period(restaurant, "Afternoon");
    const deliLunch = await period(deli, "Deli lunch");
    const week = (fill: MenuSlot[]) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: weekday === 3 ? fill : [] }));
    for (const name of ["Summer", "Autumn"])
      await replaceMenuWeek(
        tx,
        cfg,
        restaurant,
        week([slot(lunch, "12:00", "16:00"), slot(dinner, "20:00", "23:00")]),
        WRITE_AT,
        0,
        { seasonId: season(name) },
      );
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant,
      week([slot(dinner, "20:00", "23:00")]),
      WRITE_AT,
      0,
      { seasonId: season("Winter") },
    );
    return {
      cfg,
      locationId,
      stationId: station!.id,
      restaurant,
      deli,
      lunch,
      dinner,
      afternoon,
      deliLunch,
      seasons: { summer: season("Summer"), autumn: season("Autumn"), winter: season("Winter") },
    };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;

/** Saves a special day painting the restaurant on each of `dates` with `paint`. */
const specialDay = (
  v: Venue,
  name: string,
  dates: string[],
  paint: MenuSlot[],
  repeatsYearly = false,
) =>
  scoped(
    async (tx) =>
      (
        await saveSpecialDay(
          tx,
          v.cfg,
          null,
          {
            name,
            repeatsYearly,
            dates: dates.map((date) => ({ date, closedAllDay: false })),
            paint: dates.map((date) => ({ departmentId: v.restaurant, date, ranges: paint })),
          },
          WRITE_AT,
          0,
        )
      ).id,
  );

describe("where a period is painted", () => {
  it("lists seasons by when they start, and special days with a date today or later or repeating, by name", async () => {
    const v = await venue();
    const lunch = [slot(v.lunch, "13:00", "16:00")];
    await specialDay(v, "Fiesta pasada", ["2026-09-01"], lunch);
    const verbena = await specialDay(v, "Verbena", [TODAY], lunch);
    const navidad = await specialDay(v, "Navidad", ["2025-12-25"], lunch, true);
    const aniversario = await specialDay(v, "Aniversario", ["2026-10-20"], lunch);

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));

    expect(painted.get(v.lunch)).toEqual({
      seasons: [
        { id: v.seasons.summer, name: "Summer" },
        { id: v.seasons.autumn, name: "Autumn" },
      ],
      specialDays: [
        { id: aniversario, name: "Aniversario" },
        { id: navidad, name: "Navidad" },
        { id: verbena, name: "Verbena" },
      ],
    });
  });

  it("does not list a period's past one-off special day", async () => {
    const v = await venue();
    await specialDay(v, "Cena pasada", ["2026-09-01"], [slot(v.dinner, "20:00", "23:00")]);

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));

    expect(painted.get(v.dinner)).toEqual({
      seasons: [
        { id: v.seasons.summer, name: "Summer" },
        { id: v.seasons.autumn, name: "Autumn" },
        { id: v.seasons.winter, name: "Winter" },
      ],
      specialDays: [],
    });
  });

  it("does not take the clock's date for today: a special day ended by the clock at 00:30 is still today's", async () => {
    const v = await venue();
    const today = await specialDay(v, "Verbena", [TODAY], [slot(v.afternoon, "16:00", "19:00")]);

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));
    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.afternoon, AT));

    expect(painted.get(v.afternoon)!.specialDays).toEqual([{ id: today, name: "Verbena" }]);
    expect(impact.specialDays).toBe(1);
  });

  it("lists a special day once when several of its dates paint the period, and when only a later one is still to come", async () => {
    const v = await venue();
    const feria = await specialDay(
      v,
      "Feria",
      ["2026-09-01", "2026-10-21", "2026-10-22"],
      [slot(v.afternoon, "16:00", "19:00")],
    );

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));
    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.afternoon, AT));

    expect(painted.get(v.afternoon)!.specialDays).toEqual([{ id: feria, name: "Feria" }]);
    expect(impact.specialDays).toBe(1);
  });

  it("gives a period painted nowhere empty lists", async () => {
    const v = await venue();

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));

    expect(painted.get(v.afternoon)).toEqual({ seasons: [], specialDays: [] });
    expect(painted.get(v.deliLunch)).toEqual({ seasons: [], specialDays: [] });
  });

  it("holds this venue's periods only", async () => {
    const v = await venue();
    const other = await venue();
    await specialDay(other, "Verbena", [TODAY], [slot(other.afternoon, "16:00", "19:00")]);

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));

    expect([...painted.keys()].sort()).toEqual(
      [v.lunch, v.dinner, v.afternoon, v.deliLunch].sort(),
    );
    expect(painted.get(v.afternoon)).toEqual({ seasons: [], specialDays: [] });
  });

  it("lists every special day that paints the period when the clock cannot be read", async () => {
    const v = await venue();
    const pasada = await specialDay(
      v,
      "Fiesta pasada",
      ["2026-09-01"],
      [slot(v.afternoon, "16:00", "19:00")],
    );
    await db.update(locations).set({ timeZone: "Not/AZone" }).where(eq(locations.id, v.locationId));

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));
    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.afternoon, AT));

    expect(painted.get(v.afternoon)!.specialDays).toEqual([{ id: pasada, name: "Fiesta pasada" }]);
    expect(impact.specialDays).toBe(1);
  });
});

describe("what deleting a period touches", () => {
  it("counts what Painted in lists, names the routing that names it and offers the department's other periods by name", async () => {
    const v = await venue();
    const lunch = [slot(v.lunch, "13:00", "16:00")];
    await specialDay(v, "Fiesta pasada", ["2026-09-01"], lunch);
    await specialDay(v, "Navidad", ["2025-12-25"], lunch, true);
    await specialDay(v, "Aniversario", ["2026-10-20"], lunch);
    const [cell] = await db
      .insert(routingCells)
      .values({ locationId: v.locationId, stationId: v.stationId, noCategory: true })
      .returning({ id: routingCells.id });
    await db.insert(routingCellPeriods).values({
      cellId: cell!.id,
      periodId: v.lunch,
      departmentId: v.restaurant,
      stationId: v.stationId,
    });

    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.lunch, AT));
    const routing = await scoped((tx) => readRoutingUses(tx, v.cfg));

    expect(impact).toEqual({
      seasons: 2,
      specialDays: 2,
      routingUses: [{ rowKind: "no_category", rowLabel: null, zoneName: null }],
      keptOpenToday: false,
      replacements: [
        { id: v.afternoon, name: "Afternoon" },
        { id: v.dinner, name: "Dinner" },
      ],
    });
    expect(impact.routingUses).toEqual(routing.get(v.lunch));
  });

  it("names no routing for a period no cell names", async () => {
    const v = await venue();

    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.afternoon, AT));

    expect(impact).toEqual({
      seasons: 0,
      specialDays: 0,
      routingUses: [],
      keptOpenToday: false,
      replacements: [
        { id: v.dinner, name: "Dinner" },
        { id: v.lunch, name: "Lunch" },
      ],
    });
  });

  it("says the period is kept open today when it has an extension on today's business day", async () => {
    const v = await venue();
    await db.insert(periodExtensions).values({
      departmentId: v.restaurant,
      businessDay: TODAY,
      periodId: v.lunch,
      startsAt: "16:00:00",
      endsAt: "17:00:00",
    });

    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.lunch, AT));

    expect(impact.keptOpenToday).toBe(true);
  });

  it("does not say kept open today for an extension on the clock's date or of another period", async () => {
    const v = await venue();
    await db.insert(periodExtensions).values({
      departmentId: v.restaurant,
      businessDay: CLOCK_DATE,
      periodId: v.lunch,
      startsAt: "16:00:00",
      endsAt: "17:00:00",
    });
    await db.insert(periodExtensions).values({
      departmentId: v.restaurant,
      businessDay: TODAY,
      periodId: v.dinner,
      startsAt: "23:00:00",
      endsAt: "23:30:00",
    });

    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.lunch, AT));

    expect(impact.keptOpenToday).toBe(false);
  });

  it("does not say kept open today when the clock cannot be read", async () => {
    const v = await venue();
    await db.insert(periodExtensions).values({
      departmentId: v.restaurant,
      businessDay: TODAY,
      periodId: v.lunch,
      startsAt: "16:00:00",
      endsAt: "17:00:00",
    });
    await db.update(locations).set({ timeZone: "Not/AZone" }).where(eq(locations.id, v.locationId));

    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.lunch, AT));

    expect(impact.keptOpenToday).toBe(false);
  });

  it("refuses a period that does not exist, or is another venue's, as not found", async () => {
    const v = await venue();
    const other = await venue();
    for (const periodId of [randomUUID(), other.lunch])
      await expect(
        scoped((tx) => periodDeleteImpact(tx, v.cfg, periodId, AT)),
      ).rejects.toMatchObject({ code: "menu_period.not_found", params: { periodId } });
  });
});
