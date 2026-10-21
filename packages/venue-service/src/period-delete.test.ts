import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
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
  categories,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readLocationClock } from "@waitron/reporting";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { resolveDepartmentDays } from "./day-resolver.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { keepPeriodOpen, readKeepOpen } from "./keep-open.js";
import {
  readRoutingUses,
  replaceMenuWeek,
  resolveDepartmentService,
  saveMenuPeriod,
} from "./menu-timetable.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { deletePeriod, periodDeleteImpact, readPaintedIn } from "./period-delete.js";
import { menuPeriods } from "./schema/menus.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons as seasonsTable,
  specialDayDates,
} from "./schema/seasons.js";
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
      (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId: menu, staffMenuIds: [] })).id;
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

  it("lists a special day with a date still to come even when only its past date paints the period", async () => {
    const v = await venue();
    const twoDates = await scoped(
      async (tx) =>
        (
          await saveSpecialDay(
            tx,
            v.cfg,
            null,
            {
              name: "Two dates",
              repeatsYearly: false,
              dates: [
                { date: "2026-09-01", closedAllDay: false },
                { date: "2026-10-20", closedAllDay: false },
              ],
              paint: [
                {
                  departmentId: v.restaurant,
                  date: "2026-09-01",
                  ranges: [slot(v.afternoon, "16:00", "19:00")],
                },
                {
                  departmentId: v.restaurant,
                  date: "2026-10-20",
                  ranges: [slot(v.dinner, "20:00", "23:00")],
                },
              ],
            },
            WRITE_AT,
            0,
          )
        ).id,
    );

    const painted = await scoped((tx) => readPaintedIn(tx, v.cfg, AT));
    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.afternoon, AT));

    expect(painted.get(v.afternoon)!.specialDays).toEqual([{ id: twoDates, name: "Two dates" }]);
    expect(painted.get(v.dinner)!.specialDays).toEqual([{ id: twoDates, name: "Two dates" }]);
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
    await db.insert(routingCellPeriods).values({
      cellId: cell!.id,
      periodId: v.dinner,
      departmentId: v.restaurant,
      stationId: v.stationId,
    });

    const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.lunch, AT));
    const routing = await scoped((tx) => readRoutingUses(tx, v.cfg));
    const lunchRouting = await scoped((tx) => readRoutingUses(tx, v.cfg, v.lunch));

    expect([...routing.keys()].sort()).toEqual([v.lunch, v.dinner].sort());
    expect(lunchRouting).toEqual(new Map([[v.lunch, routing.get(v.lunch)]]));

    expect(impact).toEqual({
      seasons: 2,
      specialDays: 2,
      routingUses: [{ rowKind: "no_category", rowLabel: null, zoneName: null }],
      keptOpenToday: false,
      replacements: [
        { id: v.afternoon, name: "Afternoon" },
        { id: v.dinner, name: "Dinner" },
      ],
      clockRevision: 0,
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
      clockRevision: 0,
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

describe("deleting a period", () => {
  const hhmm = (time: string) => time.slice(0, 5);

  /** A venue whose No category cell names Lunch alone (Barra), and whose Cocktails cell names
   *  Lunch (Barra), Afternoon (Cocina) and Dinner (Cocina); Lunch is kept open today. */
  async function deleteVenue() {
    const v = await venue();
    const [barra] = await db
      .insert(kitchenStations)
      .values({ locationId: v.locationId, name: "Barra" })
      .returning({ id: kitchenStations.id });
    const [cocktails] = await db
      .insert(categories)
      .values({ name: `Cocktails ${randomUUID()}` })
      .returning({ id: categories.id });
    const cell = async (values: Partial<typeof routingCells.$inferInsert>) =>
      (
        await db
          .insert(routingCells)
          .values({ locationId: v.locationId, stationId: v.stationId, ...values })
          .returning({ id: routingCells.id })
      )[0]!.id;
    const noCategory = await cell({ noCategory: true });
    const cocktailsCell = await cell({ categoryId: cocktails!.id });
    const line = (cellId: string, periodId: string, stationId: string) =>
      db
        .insert(routingCellPeriods)
        .values({ cellId, periodId, departmentId: v.restaurant, stationId });
    await line(noCategory, v.lunch, barra!.id);
    await line(cocktailsCell, v.lunch, barra!.id);
    await line(cocktailsCell, v.afternoon, v.stationId);
    await line(cocktailsCell, v.dinner, v.stationId);
    await db.insert(periodExtensions).values({
      departmentId: v.restaurant,
      businessDay: TODAY,
      periodId: v.lunch,
      startsAt: "16:00:00",
      endsAt: "17:00:00",
    });
    return {
      ...v,
      cellNames: new Map([
        [noCategory, "No category"],
        [cocktailsCell, "Cocktails"],
      ]),
      stationNames: new Map([
        [v.stationId, "Cocina"],
        [barra!.id, "Barra"],
      ]),
    };
  }
  type DeleteVenue = Awaited<ReturnType<typeof deleteVenue>>;

  /** The four places that name a period, and the restaurant's periods, read by value. */
  async function stored(v: DeleteVenue) {
    const seasonRanges = await db
      .select({
        season: seasonsTable.name,
        weekday: departmentDays.weekday,
        period: menuPeriods.name,
        startsAt: departmentDayRanges.startsAt,
        endsAt: departmentDayRanges.endsAt,
      })
      .from(departmentDayRanges)
      .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
      .innerJoin(seasonsTable, eq(seasonsTable.id, departmentDays.seasonId))
      .innerJoin(menuPeriods, eq(menuPeriods.id, departmentDayRanges.periodId))
      .where(eq(departmentDays.departmentId, v.restaurant))
      .orderBy(
        asc(seasonsTable.startsOn),
        asc(departmentDays.weekday),
        asc(departmentDayRanges.startsAt),
      );
    const specialDayRanges = await db
      .select({
        date: specialDayDates.date,
        period: menuPeriods.name,
        startsAt: departmentDayRanges.startsAt,
        endsAt: departmentDayRanges.endsAt,
      })
      .from(departmentDayRanges)
      .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
      .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDays.specialDayDateId))
      .leftJoin(menuPeriods, eq(menuPeriods.id, departmentDayRanges.periodId))
      .where(eq(departmentDays.departmentId, v.restaurant))
      .orderBy(asc(specialDayDates.date), asc(departmentDayRanges.startsAt));
    const routing = await db
      .select({
        cellId: routingCellPeriods.cellId,
        period: menuPeriods.name,
        stationId: routingCellPeriods.stationId,
      })
      .from(routingCellPeriods)
      .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
      .innerJoin(menuPeriods, eq(menuPeriods.id, routingCellPeriods.periodId))
      .where(eq(routingCells.locationId, v.locationId));
    const extensions = await db
      .select({
        businessDay: periodExtensions.businessDay,
        period: menuPeriods.name,
        startsAt: periodExtensions.startsAt,
        endsAt: periodExtensions.endsAt,
      })
      .from(periodExtensions)
      .innerJoin(menuPeriods, eq(menuPeriods.id, periodExtensions.periodId))
      .where(eq(periodExtensions.departmentId, v.restaurant))
      .orderBy(asc(periodExtensions.businessDay));
    const periods = await db
      .select({ name: menuPeriods.name })
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, v.restaurant))
      .orderBy(asc(menuPeriods.name));
    return {
      seasons: seasonRanges.map(
        (row) =>
          `${row.season} ${row.weekday} ${row.period} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
      ),
      specialDays: specialDayRanges.map(
        (row) => `${row.date} ${row.period ?? "Closed"} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
      ),
      routing: routing
        .map(
          (row) =>
            `${v.cellNames.get(row.cellId)} ${row.period} ${v.stationNames.get(row.stationId!)}`,
        )
        .sort(),
      extensions: extensions.map(
        (row) => `${row.businessDay} ${row.period} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
      ),
      periods: periods.map((row) => row.name),
    };
  }

  const remove = (v: Venue, periodId: string, replacementId: string | null, revision = 0) =>
    scoped((tx) => deletePeriod(tx, v.cfg, periodId, replacementId, AT, revision));

  /** The refusal of `write`'s whole transaction. */
  async function refusal(write: () => Promise<unknown>): Promise<AppError> {
    try {
      await write();
    } catch (error) {
      return error as AppError;
    }
    throw new Error("the write was not refused");
  }

  describe("with a replacement", () => {
    it("paints the replacement over every season range of the period, joining a stretch it touches", async () => {
      const v = await deleteVenue();
      await scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            slots:
              weekday === 3
                ? [
                    slot(v.lunch, "13:00", "15:00"),
                    slot(v.afternoon, "15:00", "20:00"),
                    slot(v.dinner, "20:00", "23:00"),
                  ]
                : [],
          })),
          WRITE_AT,
          0,
          { seasonId: v.seasons.autumn },
        ),
      );

      await remove(v, v.lunch, v.afternoon);

      const after = await stored(v);
      expect(after.seasons).toEqual([
        "Summer 3 Afternoon 12:00-16:00",
        "Summer 3 Dinner 20:00-23:00",
        "Autumn 3 Afternoon 13:00-20:00",
        "Autumn 3 Dinner 20:00-23:00",
        "Winter 3 Dinner 20:00-23:00",
      ]);
      expect(after.periods).toEqual(["Afternoon", "Dinner"]);
    });

    it("paints the replacement over special days' paint of the period, a past one-off's too, joining touching paint", async () => {
      const v = await deleteVenue();
      await specialDay(v, "Fiesta pasada", ["2026-09-01"], [slot(v.lunch, "13:00", "16:00")]);
      await specialDay(
        v,
        "Aniversario",
        ["2026-10-20"],
        [slot(v.lunch, "13:00", "15:00"), slot(v.afternoon, "15:00", "16:00")],
      );

      await remove(v, v.lunch, v.afternoon);

      expect((await stored(v)).specialDays).toEqual([
        "2026-09-01 Afternoon 13:00-16:00",
        "2026-10-20 Afternoon 13:00-16:00",
      ]);
    });

    it("drops the routing lines naming the period, as without a replacement, and keeps the rest", async () => {
      const v = await deleteVenue();

      await remove(v, v.lunch, v.afternoon);

      expect((await stored(v)).routing).toEqual(
        ["Cocktails Afternoon Cocina", "Cocktails Dinner Cocina"].sort(),
      );
    });

    it("deletes as many routing lines, of the same row kinds, as the impact read listed before the delete", async () => {
      const v = await deleteVenue();
      const before = (await stored(v)).routing;
      const impact = await scoped((tx) => periodDeleteImpact(tx, v.cfg, v.lunch, AT));
      const afternoonUses = async () =>
        (await scoped((tx) => readRoutingUses(tx, v.cfg, v.afternoon))).get(v.afternoon);
      const afternoonBefore = await afternoonUses();

      await remove(v, v.lunch, v.afternoon);

      const lunchLines = before.filter((line) => line.includes(" Lunch "));
      expect(lunchLines).toHaveLength(2);
      expect(impact.routingUses.map((use) => use.rowKind).sort()).toEqual([
        "category",
        "no_category",
      ]);
      expect(impact.routingUses).toHaveLength(lunchLines.length);
      expect((await stored(v)).routing).toEqual(
        before.filter((line) => !lunchLines.includes(line)),
      );
      expect(await afternoonUses()).toEqual(afternoonBefore);
    });

    it("moves today's extension of the period, and an older day's, to the replacement", async () => {
      const v = await deleteVenue();
      await db.insert(periodExtensions).values({
        departmentId: v.restaurant,
        businessDay: "2026-10-01",
        periodId: v.lunch,
        startsAt: "16:00:00",
        endsAt: "16:30:00",
      });

      await remove(v, v.lunch, v.afternoon);

      expect((await stored(v)).extensions).toEqual([
        "2026-10-01 Afternoon 16:00-16:30",
        `${TODAY} Afternoon 16:00-17:00`,
      ]);
    });

    describe("when the period was kept open today into the replacement's time", () => {
      const local = (time: string) => localTimeOccurrences(TODAY, time, ZONE)[0]!;

      /** Wednesday: Lunch 12:00-16:00, Afternoon 16:00-20:00, Dinner 20:00-23:00; Lunch kept
       *  open at 15:00 until `until`, then deleted with Afternoon in its place. */
      async function keptOpenThenReplaced(until: string) {
        const v = await venue();
        const zoneId = await scoped(async (tx) => {
          const [zone] = await tx
            .insert(floorZones)
            .values({ locationId: v.locationId, name: "Dining" })
            .returning({ id: floorZones.id });
          await configureZone(tx, v.cfg, { zoneId: zone!.id, departmentId: v.restaurant });
          await replaceMenuWeek(
            tx,
            v.cfg,
            v.restaurant,
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
              weekday,
              slots:
                weekday === 3
                  ? [
                      slot(v.lunch, "12:00", "16:00"),
                      slot(v.afternoon, "16:00", "20:00"),
                      slot(v.dinner, "20:00", "23:00"),
                    ]
                  : [],
            })),
            WRITE_AT,
            0,
            { seasonId: v.seasons.autumn },
          );
          return zone!.id;
        });
        await scoped((tx) =>
          keepPeriodOpen(tx, v.cfg, zoneId, { periodId: v.lunch, until }, local("15:00")),
        );
        await scoped((tx) => deletePeriod(tx, v.cfg, v.lunch, v.afternoon, local("15:00"), 0));
        const till = (time: string) =>
          scoped(async (tx) => ({
            service: await resolveDepartmentService(tx, v.cfg, v.restaurant, local(time)),
            keepOpen: (await readKeepOpen(tx, v.cfg, zoneId, local(time))).period,
          }));
        const extensions = async () =>
          (
            await db
              .select({
                businessDay: periodExtensions.businessDay,
                periodId: periodExtensions.periodId,
                startsAt: periodExtensions.startsAt,
                endsAt: periodExtensions.endsAt,
              })
              .from(periodExtensions)
              .where(eq(periodExtensions.departmentId, v.restaurant))
          ).map(
            (row) =>
              `${row.businessDay} ${row.periodId === v.afternoon ? "Afternoon" : row.periodId} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
          );
        return { v, till, extensions };
      }

      it("shows Afternoon running to its own 20:00 end when Lunch was kept open to 17:00", async () => {
        const { v, till, extensions } = await keptOpenThenReplaced("17:00");

        expect(await extensions()).toEqual([]);

        for (const [time, firstChoice] of [
          ["16:30", "20:15"],
          ["18:00", "20:15"],
        ] as const) {
          const { service, keepOpen } = await till(time);
          expect({ time, open: service.open, periodId: service.periodId }).toEqual({
            time,
            open: true,
            periodId: v.afternoon,
          });
          expect(service.keepOpen).toEqual({
            periodId: v.afternoon,
            periodName: "Afternoon",
            endsAt: "20:00",
            running: true,
            extendedUntil: null,
          });
          expect({ time, ...keepOpen, choices: keepOpen!.choices[0] }).toMatchObject({
            time,
            id: v.afternoon,
            endsAt: "20:00",
            running: true,
            extendedUntil: null,
            choices: firstChoice,
          });
        }
      });

      it("drops the extension when Afternoon's own time ends exactly where Lunch was kept open to", async () => {
        const { extensions } = await keptOpenThenReplaced("20:00");

        expect(await extensions()).toEqual([]);
      });

      it("shows Afternoon kept open to 21:00 when Lunch was kept open past Afternoon's end", async () => {
        const { v, till, extensions } = await keptOpenThenReplaced("21:00");

        expect(await extensions()).toEqual([`${TODAY} Afternoon 20:00-21:00`]);

        for (const [time, firstChoice] of [
          ["16:30", "20:15"],
          ["20:30", "20:45"],
        ] as const) {
          const { service, keepOpen } = await till(time);
          expect({ time, open: service.open, periodId: service.periodId }).toEqual({
            time,
            open: true,
            periodId: v.afternoon,
          });
          expect(service.keepOpen).toEqual({
            periodId: v.afternoon,
            periodName: "Afternoon",
            endsAt: "21:00",
            running: true,
            extendedUntil: "21:00",
          });
          expect({ time, ...keepOpen, choices: keepOpen!.choices[0] }).toMatchObject({
            time,
            id: v.afternoon,
            endsAt: "21:00",
            running: true,
            extendedUntil: "21:00",
            choices: firstChoice,
          });
        }
      });
    });
  });

  describe("without a replacement", () => {
    it("closes the time the period held in the seasons", async () => {
      const v = await deleteVenue();

      await remove(v, v.lunch, null);

      const after = await stored(v);
      expect(after.seasons).toEqual([
        "Summer 3 Dinner 20:00-23:00",
        "Autumn 3 Dinner 20:00-23:00",
        "Winter 3 Dinner 20:00-23:00",
      ]);
      expect(after.periods).toEqual(["Afternoon", "Dinner"]);
    });

    it("takes the period's paint off a special day, so the season shows through on that date", async () => {
      const v = await deleteVenue();
      const date = "2026-10-14";
      await specialDay(
        v,
        "Verbena",
        [date],
        [slot(v.afternoon, "12:00", "14:00"), slot(v.lunch, "18:00", "23:00")],
      );

      await remove(v, v.lunch, null);

      const resolved = await scoped(async (tx) =>
        resolveDepartmentDays(
          tx,
          v.cfg,
          v.restaurant,
          [date],
          await readLocationClock(tx, v.locationId),
        ),
      );
      expect(resolved.get(date)).toEqual({
        businessDay: date,
        seasonId: v.seasons.autumn,
        ranges: [slot(v.afternoon, "12:00", "14:00"), slot(v.dinner, "20:00", "23:00")],
      });
      expect((await stored(v)).specialDays).toEqual([`${date} Afternoon 12:00-14:00`]);
    });

    it("drops the routing lines naming the period and keeps the rest", async () => {
      const v = await deleteVenue();

      await remove(v, v.lunch, null);

      expect((await stored(v)).routing).toEqual(
        ["Cocktails Afternoon Cocina", "Cocktails Dinner Cocina"].sort(),
      );
    });

    it("ends the period's extension and keeps another period's", async () => {
      const v = await deleteVenue();
      await db.insert(periodExtensions).values({
        departmentId: v.restaurant,
        businessDay: "2026-10-01",
        periodId: v.dinner,
        startsAt: "23:00:00",
        endsAt: "23:30:00",
      });

      await remove(v, v.lunch, null);

      expect((await stored(v)).extensions).toEqual(["2026-10-01 Dinner 23:00-23:30"]);
    });

    it("leaves no day row on a special day whose only paint was the period, so the day reads as its season's", async () => {
      const v = await deleteVenue();
      const date = "2026-10-14";
      const plainWednesday = "2026-10-21";
      await specialDay(v, "Verbena", [date], [slot(v.lunch, "18:00", "23:00")]);

      await remove(v, v.lunch, null);

      const dayRows = await db
        .select({ id: departmentDays.id })
        .from(departmentDays)
        .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDays.specialDayDateId))
        .where(eq(departmentDays.departmentId, v.restaurant));
      expect(dayRows).toEqual([]);
      const resolved = await scoped(async (tx) =>
        resolveDepartmentDays(
          tx,
          v.cfg,
          v.restaurant,
          [date, plainWednesday],
          await readLocationClock(tx, v.locationId),
        ),
      );
      expect(resolved.get(date)!.ranges).toEqual([slot(v.dinner, "20:00", "23:00")]);
      expect(resolved.get(date)!.ranges).toEqual(resolved.get(plainWednesday)!.ranges);
    });

    it("takes the period's paint off a past one-off special day too", async () => {
      const v = await deleteVenue();
      await specialDay(
        v,
        "Fiesta pasada",
        ["2026-09-01"],
        [slot(v.lunch, "13:00", "16:00"), slot(v.afternoon, "16:00", "17:00")],
      );

      await remove(v, v.lunch, null);

      expect((await stored(v)).specialDays).toEqual(["2026-09-01 Afternoon 16:00-17:00"]);
    });
  });

  describe("refusals", () => {
    it("refuses a replacement of another department, the period itself, an unknown one or another venue's, changing nothing", async () => {
      const v = await deleteVenue();
      const other = await venue();
      await specialDay(v, "Aniversario", ["2026-10-20"], [slot(v.lunch, "13:00", "15:00")]);
      const before = await stored(v);

      for (const replacementId of [v.deliLunch, v.lunch, randomUUID(), other.afternoon]) {
        const error = await refusal(() => remove(v, v.lunch, replacementId));
        expect(error.code).toBe("menu_period.invalid");
        expect(error.params).toEqual({ field: "replacementPeriodId" });
      }
      expect(await stored(v)).toEqual(before);
    });

    it("refuses a period that does not exist, or is another venue's, as not found", async () => {
      const v = await venue();
      const other = await venue();
      for (const periodId of [randomUUID(), other.lunch]) {
        const error = await refusal(() => remove(v, periodId, null));
        expect(error.code).toBe("menu_period.not_found");
        expect(error.params).toEqual({ periodId });
      }
    });

    it("refuses a stale clock revision, changing nothing", async () => {
      const v = await deleteVenue();
      const before = await stored(v);

      const error = await refusal(() => remove(v, v.lunch, v.afternoon, 1));

      expect(error.code).toBe("hours.clock_changed");
      expect(await stored(v)).toEqual(before);
    });
  });
});
