import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  locations,
  tenants,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { eq } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { CALENDAR_MONTH_PLAN_READS } from "./dashboard/live-queries.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  readCalendarMonthPlan,
  readOpeningHoursMonth,
  readOpeningHoursYear,
  readSeasonDays,
} from "./opening-hours-calendar.js";
import { configureZone, createDepartment, type VenueScope } from "./operations.js";
import { specialDayDates } from "./schema/seasons.js";
import { ensureDefaultSeasons, readSeasons } from "./seasons.js";
import { missingHolidaysIn, saveSpecialDay } from "./special-days.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const AT = new Date("2026-10-09T10:00:00Z");

/** A Sevilla venue with a department per entry of `closedOn`, each serving lunch every day but
 *  the weekdays its entry lists. */
async function venue(closedOn: readonly (readonly number[])[] = [[1]]) {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Casa SL" })
    .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      province: "Sevilla",
      city: "Sevilla",
    })
    .returning({ id: locations.id });
  const cfg: VenueScope = { locationId: locationId(location!.id) };
  return run(async (tx) => {
    const menuId = (await createCatalogue(tx, { name: `Carta ${randomUUID()}` })).id;
    const { document } = await buildMenuDocument(tx, menuId);
    await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
    for (const [index, closed] of closedOn.entries()) {
      const department = (
        await createDepartment(tx, cfg, { name: `Sala ${index}`, orderStart: "table" })
      ).id;
      const lunch = (
        await saveMenuPeriod(tx, cfg, department, { name: "Lunch", menuId, staffMenuIds: [] })
      ).id;
      await replaceMenuWeek(
        tx,
        cfg,
        department,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: closed.includes(weekday)
            ? []
            : [{ periodId: lunch, startsAt: "12:00", endsAt: "16:00" }],
        })),
        AT,
        0,
      );
    }
    const seasons = Object.fromEntries(
      (await readSeasons(tx, cfg)).map((season) => [season.name, season.id]),
    );
    return { cfg, seasons };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;

const read = (v: Venue, year: number) => run((tx) => readOpeningHoursYear(tx, v.cfg, year, AT));
const special = (v: Venue, input: unknown) =>
  run((tx) => saveSpecialDay(tx, v.cfg, null, input, AT, 0));
const dayOf = (year: Awaited<ReturnType<typeof read>>, date: string) =>
  year.days.find((day) => day.date === date);

describe("the Opening hours year read", () => {
  it("gives 2030's days by value: a Winter day, a closed Monday and a special day's Closed tick", async () => {
    const v = await venue();
    const cierre = await special(v, {
      name: "Cierre",
      repeatsYearly: false,
      dates: [{ date: "2030-07-10", closedAllDay: true }],
    });
    const year = await read(v, 2030);
    expect(year.year).toBe(2030);
    expect(year.timeZone).toBe("Europe/Madrid");
    expect(year.today).toBe("2026-10-09");
    expect(year.clockRevision).toBe(0);
    expect(year.days).toHaveLength(365);
    expect(year.days[0]!.date).toBe("2030-01-01");
    expect(year.days.at(-1)!.date).toBe("2030-12-31");
    expect(dayOf(year, "2030-01-15")).toEqual({
      date: "2030-01-15",
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [],
      tone: "standard",
      closed: false,
    });
    expect(dayOf(year, "2030-01-14")).toEqual({
      date: "2030-01-14",
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [],
      tone: "closed",
      closed: true,
    });
    expect(dayOf(year, "2030-07-10")).toEqual({
      date: "2030-07-10",
      seasonId: v.seasons.Summer,
      specialDay: { id: cierre.id, name: "Cierre" },
      holidays: [],
      tone: "special_day",
      closed: true,
    });
    expect(year.seasons).toEqual([
      {
        id: v.seasons.Spring,
        name: "Spring",
        startsOn: "03-01",
        lastDay: "05-31",
        colour: "green",
      },
      {
        id: v.seasons.Summer,
        name: "Summer",
        startsOn: "06-01",
        lastDay: "08-31",
        colour: "amber",
      },
      {
        id: v.seasons.Autumn,
        name: "Autumn",
        startsOn: "09-01",
        lastDay: "11-30",
        colour: "orange",
      },
      { id: v.seasons.Winter, name: "Winter", startsOn: "12-01", lastDay: "02-28", colour: "blue" },
    ]);
  });

  it("gives a public holiday from the pack's 2026 list in a 2026 read, with its coverage", async () => {
    const v = await venue();
    const year = await read(v, 2026);
    expect(year.publicHolidaysAvailable).toBe(true);
    expect(
      year.holidayCoverage.map(({ year, nationalRegional }) => ({ year, nationalRegional })),
    ).toEqual([{ year: 2026, nationalRegional: "complete" }]);
    expect(dayOf(year, "2026-01-06")).toEqual({
      date: "2026-01-06",
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [
        {
          id: "shipped:BOE-A-2025-21667:0601",
          date: "2026-01-06",
          name: "Epifanía del Señor",
          scope: "national",
          sourceId: "BOE-A-2025-21667",
        },
      ],
      tone: "public_holiday",
      closed: false,
    });
    expect(year.area.readiness).toBe("ready");
  });

  it("says 2027's public holidays are not available yet, and names the repeating date with no holiday of its name", async () => {
    const v = await venue();
    const semanaSanta = await special(v, {
      name: "Semana Santa",
      repeatsYearly: true,
      dates: [{ date: "2026-04-03", closedAllDay: true }],
    });
    const now = await read(v, 2026);
    expect(now.missingHolidays).toEqual([]);
    const next = await read(v, 2027);
    expect(next.publicHolidaysAvailable).toBe(false);
    expect(next.holidayCoverage.map(({ nationalRegional }) => nationalRegional)).toEqual([
      "missing_year",
    ]);
    expect(next.missingHolidays).toEqual([
      { specialDayId: semanaSanta.id, name: "Semana Santa", holidayName: "Viernes Santo" },
    ]);
    const known = new Map([[2027, new Map([["Viernes Santo", "2027-03-26"]])]]);
    expect(await run((tx) => missingHolidaysIn(tx, v.cfg, [2027], known))).toEqual([]);
  });

  it("closes a date only when every active department is closed all day", async () => {
    const v = await venue([
      [1, 2],
      [1, 3],
    ]);
    const year = await read(v, 2030);
    expect(
      ["2030-01-14", "2030-01-15", "2030-01-16", "2030-01-17"].map((date) => ({
        date,
        closed: dayOf(year, date)!.closed,
      })),
    ).toEqual([
      { date: "2030-01-14", closed: true },
      { date: "2030-01-15", closed: false },
      { date: "2030-01-16", closed: false },
      { date: "2030-01-17", closed: false },
    ]);
  });

  it("puts no date in a season for a venue that has none yet", async () => {
    const v = await venue([]);
    expect(v.seasons).toEqual({});
    const year = await read(v, 2030);
    expect(year.seasons).toEqual([]);
    expect(year.days).toHaveLength(365);
    expect(year.days.filter((day) => day.seasonId !== null)).toEqual([]);
  });

  it("ends each season on its true last day in the shown year, 29 February in a leap year", async () => {
    const v = await venue();
    const lastDays = async (year: number) =>
      (await read(v, year)).seasons.map(({ name, lastDay }) => ({ name, lastDay }));
    expect(await lastDays(2028)).toEqual([
      { name: "Spring", lastDay: "05-31" },
      { name: "Summer", lastDay: "08-31" },
      { name: "Autumn", lastDay: "11-30" },
      { name: "Winter", lastDay: "02-29" },
    ]);
    expect((await lastDays(2027)).at(-1)).toEqual({ name: "Winter", lastDay: "02-28" });
    expect(dayOf(await read(v, 2028), "2028-02-29")!.seasonId).toBe(v.seasons.Winter);
  });

  it("sends the same statements for one department as for three, not one per day", async () => {
    const statementsFor = async (v: Venue) =>
      run(async (tx) => {
        const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
          .session;
        const prepared = vi.spyOn(session, "prepareQuery");
        try {
          await readOpeningHoursYear(tx, v.cfg, 2030, AT);
          return prepared.mock.calls.length;
        } finally {
          prepared.mockRestore();
        }
      });
    const one = await statementsFor(await venue([[1]]));
    expect(await statementsFor(await venue([[1], [1], [1]]))).toBe(one);
    expect(one).toBeLessThan(40);
  });
});

/** A Sevilla venue: Sala serves lunch 12:00–16:00 in Autumn and dinner 20:00–23:30 in Winter, every
 *  day, with a Terrace closed 20:00–22:00 on Winter Sundays and a Bar; Barra serves lunch 13:00–15:00
 *  every day of every season, with its own Counter zone. */
async function monthVenue() {
  const { cfg } = await venue([]);
  return run(async (tx) => {
    const menuId = (await createCatalogue(tx, { name: `Carta ${randomUUID()}` })).id;
    const { document } = await buildMenuDocument(tx, menuId);
    await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
    const department = async (name: string) =>
      (await createDepartment(tx, cfg, { name, orderStart: "table" })).id;
    const period = async (departmentId: string, name: string) =>
      (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId, staffMenuIds: [] })).id;
    const everyDay = (periodId: string, startsAt: string, endsAt: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId, startsAt, endsAt }],
      }));
    const zone = async (name: string, displayOrder: number, departmentId: string) => {
      const [row] = await tx
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name, displayOrder })
        .returning({ id: floorZones.id });
      await configureZone(tx, cfg, { zoneId: row!.id, departmentId });
      return row!.id;
    };
    const sala = await department("Sala");
    const barra = await department("Barra");
    await ensureDefaultSeasons(tx, cfg);
    const seasons = Object.fromEntries(
      (await readSeasons(tx, cfg)).map((season) => [season.name, season.id]),
    );
    const lunch = await period(sala, "Lunch");
    const dinner = await period(sala, "Dinner");
    const barLunch = await period(barra, "Lunch");
    await replaceMenuWeek(tx, cfg, sala, everyDay(lunch, "12:00", "16:00"), AT, 0, {
      seasonId: seasons.Autumn,
    });
    await replaceMenuWeek(tx, cfg, sala, everyDay(dinner, "20:00", "23:30"), AT, 0, {
      seasonId: seasons.Winter,
    });
    await replaceMenuWeek(tx, cfg, barra, everyDay(barLunch, "13:00", "15:00"), AT, 0);
    const terrace = await zone("Terrace", 1, sala);
    const bar = await zone("Bar", 2, sala);
    const counter = await zone("Counter", 3, barra);
    await replaceZoneClosedWeek(
      tx,
      cfg,
      terrace,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: weekday === 0 ? [{ startsAt: "20:00", endsAt: "22:00" }] : [],
      })),
      0,
      AT,
      { seasonId: seasons.Winter },
    );
    return { cfg, seasons, sala, barra, lunch, dinner, barLunch, terrace, bar, counter };
  });
}

const readMonth = (v: { cfg: VenueScope }, month: string) =>
  run((tx) => readOpeningHoursMonth(tx, v.cfg, month, AT));

describe("the Opening hours month read", () => {
  it("gives December 2030 by value: Autumn's last Saturday, Winter's first Sunday and a painted special day", async () => {
    const v = await monthVenue();
    const nochebuena = await special(v, {
      name: "Nochebuena",
      repeatsYearly: false,
      dates: [{ date: "2030-12-24", closedAllDay: false }],
      paint: [
        {
          departmentId: v.sala,
          date: "2030-12-24",
          ranges: [{ periodId: v.lunch, startsAt: "19:00", endsAt: "20:30" }],
        },
      ],
      zonePaint: [
        {
          zoneId: v.bar,
          date: "2030-12-24",
          ranges: [{ kind: "closed", startsAt: "19:00", endsAt: "20:00" }],
        },
      ],
    });
    const month = await readMonth(v, "2030-12");
    expect(month.month).toBe("2030-12");
    expect(month.today).toBe("2026-10-09");
    expect(month.seasons).toEqual([
      {
        id: v.seasons.Autumn,
        name: "Autumn",
        startsOn: "09-01",
        lastDay: "11-30",
        colour: "orange",
      },
      { id: v.seasons.Winter, name: "Winter", startsOn: "12-01", lastDay: "02-28", colour: "blue" },
    ]);
    const dayOn = (date: string) => month.days.find((day) => day.date === date);
    expect(dayOn("2030-11-30")).toEqual({
      date: "2030-11-30",
      inMonth: false,
      dayCutover: "06:00",
      endMinute: 1440,
      seasonId: v.seasons.Autumn,
      specialDay: null,
      holidays: [],
      closedAllDay: false,
      departments: [
        {
          departmentId: v.barra,
          ranges: [{ periodId: v.barLunch, startsAt: "13:00", endsAt: "15:00" }],
          zones: [{ zoneId: v.counter, closed: [] }],
        },
        {
          departmentId: v.sala,
          ranges: [{ periodId: v.lunch, startsAt: "12:00", endsAt: "16:00" }],
          zones: [
            { zoneId: v.terrace, closed: [] },
            { zoneId: v.bar, closed: [] },
          ],
        },
      ],
    });
    expect(dayOn("2030-12-01")).toEqual({
      date: "2030-12-01",
      inMonth: true,
      dayCutover: "06:00",
      endMinute: 1440,
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [],
      closedAllDay: false,
      departments: [
        {
          departmentId: v.barra,
          ranges: [{ periodId: v.barLunch, startsAt: "13:00", endsAt: "15:00" }],
          zones: [{ zoneId: v.counter, closed: [] }],
        },
        {
          departmentId: v.sala,
          ranges: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
          zones: [
            { zoneId: v.terrace, closed: [{ startsAt: "20:00", endsAt: "22:00" }] },
            { zoneId: v.bar, closed: [] },
          ],
        },
      ],
    });
    expect(dayOn("2030-12-24")).toEqual({
      date: "2030-12-24",
      inMonth: true,
      dayCutover: "06:00",
      endMinute: 1440,
      seasonId: v.seasons.Winter,
      specialDay: { id: nochebuena.id, name: "Nochebuena" },
      holidays: [],
      closedAllDay: false,
      departments: [
        {
          departmentId: v.barra,
          ranges: [{ periodId: v.barLunch, startsAt: "13:00", endsAt: "15:00" }],
          zones: [{ zoneId: v.counter, closed: [] }],
        },
        {
          departmentId: v.sala,
          ranges: [
            { periodId: v.lunch, startsAt: "19:00", endsAt: "20:30" },
            { periodId: v.dinner, startsAt: "20:30", endsAt: "23:30" },
          ],
          zones: [
            { zoneId: v.terrace, closed: [] },
            { zoneId: v.bar, closed: [{ startsAt: "19:00", endsAt: "20:00" }] },
          ],
        },
      ],
    });
  });

  it("covers the month with whole Monday-to-Sunday weeks, its neighbours' dates marked outside it", async () => {
    const v = await monthVenue();
    const month = await readMonth(v, "2030-12");
    expect(month.days).toHaveLength(42);
    expect(month.days.slice(0, 7).map(({ date, inMonth }) => ({ date, inMonth }))).toEqual([
      { date: "2030-11-25", inMonth: false },
      { date: "2030-11-26", inMonth: false },
      { date: "2030-11-27", inMonth: false },
      { date: "2030-11-28", inMonth: false },
      { date: "2030-11-29", inMonth: false },
      { date: "2030-11-30", inMonth: false },
      { date: "2030-12-01", inMonth: true },
    ]);
    expect(month.days.slice(-6).map(({ date, inMonth }) => ({ date, inMonth }))).toEqual([
      { date: "2030-12-31", inMonth: true },
      { date: "2031-01-01", inMonth: false },
      { date: "2031-01-02", inMonth: false },
      { date: "2031-01-03", inMonth: false },
      { date: "2031-01-04", inMonth: false },
      { date: "2031-01-05", inMonth: false },
    ]);
    expect(month.days.filter(({ inMonth }) => inMonth)).toHaveLength(31);
    const june = await readMonth(v, "2026-06");
    expect([june.days[0]!.date, june.days.at(-1)!.date, june.days.length]).toEqual([
      "2026-06-01",
      "2026-07-05",
      35,
    ]);
  });

  it("ends a touched season where the occurrence holding the month ends, 29 February into a leap year", async () => {
    const v = await monthVenue();
    const lastDays = async (month: string) =>
      (await readMonth(v, month)).seasons.map(({ name, lastDay }) => ({ name, lastDay }));
    expect(await lastDays("2027-12")).toEqual([
      { name: "Autumn", lastDay: "11-30" },
      { name: "Winter", lastDay: "02-29" },
    ]);
    expect(await lastDays("2028-03")).toEqual([
      { name: "Winter", lastDay: "02-29" },
      { name: "Spring", lastDay: "05-31" },
    ]);
  });

  it("gives the next year's public holidays on December's trailing dates, and the Closed tick", async () => {
    const v = await monthVenue();
    await special(v, {
      name: "Cierre",
      repeatsYearly: false,
      dates: [{ date: "2025-12-29", closedAllDay: true }],
    });
    const month = await readMonth(v, "2025-12");
    const dayOn = (date: string) => month.days.find((day) => day.date === date)!;
    expect(dayOn("2026-01-01")).toMatchObject({
      inMonth: false,
      holidays: [{ date: "2026-01-01", scope: "national" }],
    });
    expect(dayOn("2025-12-29")).toMatchObject({
      closedAllDay: true,
      departments: [
        { departmentId: v.barra, ranges: [], zones: [{ zoneId: v.counter, closed: [] }] },
        {
          departmentId: v.sala,
          ranges: [],
          zones: [
            { zoneId: v.terrace, closed: [] },
            { zoneId: v.bar, closed: [] },
          ],
        },
      ],
    });
    expect(dayOn("2025-12-30").closedAllDay).toBe(false);
  });

  it("plans the month as the month read does, with each special date's id, reading no hours, zones or holidays", async () => {
    const v = await monthVenue();
    const cierre = await special(v, {
      name: "Cierre",
      repeatsYearly: false,
      dates: [{ date: "2025-12-29", closedAllDay: true }],
    });
    const month = await readMonth(v, "2025-12");
    const { frame, tables } = await run(async (tx) => {
      const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
        .session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        return {
          frame: await readCalendarMonthPlan(tx, v.cfg, "2025-12", AT),
          tables: prepared.mock.calls.map(
            (call) => /\bfrom "(\w+)"/.exec((call[0] as { sql: string }).sql)?.[1],
          ),
        };
      } finally {
        prepared.mockRestore();
      }
    });
    expect(frame.month).toBe("2025-12");
    expect(frame.today).toBe(month.today);
    expect(frame.seasons).toEqual(month.seasons);
    expect(frame.days).toEqual(
      month.days.map(
        ({ date, inMonth, dayCutover, endMinute, seasonId, specialDay, closedAllDay }) => ({
          date,
          inMonth,
          dayCutover,
          endMinute,
          seasonId,
          specialDay,
          closedAllDay,
        }),
      ),
    );
    expect(frame.clock).toEqual(month.businessDayClock);
    const [date] = await suite.db
      .select({ id: specialDayDates.id })
      .from(specialDayDates)
      .where(eq(specialDayDates.specialDayId, cierre.id));
    expect(frame.plan.special.get("2025-12-29")).toMatchObject({
      specialDayId: cierre.id,
      dateId: date!.id,
      closedAllDay: true,
    });
    expect(frame.plan.seasonIdOn.get("2025-12-29")).toBe(v.seasons.Winter);
    for (const unread of ["floor_zones", "holiday_geographies", "location_business_day_settings"])
      expect(tables).not.toContain(unread);
  });

  it("gives each day its own changeover and length across a pending changeover change, with the clock's status", async () => {
    const v = await venue();
    await suite.db.insert(locationDayCutoverChanges).values({
      locationId: v.cfg.locationId,
      effectiveBusinessDay: "2030-12-10",
      dayCutover: "07:00:00",
    });
    const month = await readMonth(v, "2030-12");
    const day = (date: string) => month.days.find((d) => d.date === date)!;
    expect([day("2030-12-08"), day("2030-12-09"), day("2030-12-10")]).toMatchObject([
      { dayCutover: "06:00", endMinute: 1440 },
      { dayCutover: "06:00", endMinute: 1500 },
      { dayCutover: "07:00", endMinute: 1440 },
    ]);
    expect(month.clockRevision).toEqual(expect.any(Number));
    expect(month.businessDayClock).toEqual({
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      cutoverChanges: [{ effectiveBusinessDay: "2030-12-10", dayCutover: "07:00" }],
    });
    expect(month.currentBusinessDay).toBe("2026-10-09");
    expect(month.pending).toMatchObject({
      effectiveBusinessDay: "2030-12-10",
      dayCutover: "07:00",
    });
  });

  it("still gives the hours, with no today, when the venue's stored time zone cannot be read", async () => {
    const v = await venue();
    await suite.db
      .update(locations)
      .set({ timeZone: "Not/AZone" })
      .where(eq(locations.id, v.cfg.locationId));
    const month = await readMonth(v, "2030-12");
    expect(month.today).toBeNull();
    expect(month.days).toHaveLength(42);
    expect(month.days.find((day) => day.date === "2030-12-10")).toMatchObject({
      dayCutover: "06:00",
      endMinute: 1440,
      seasonId: v.seasons.Winter,
      departments: [{ ranges: [{ startsAt: "12:00", endsAt: "16:00" }] }],
    });
    expect(month.days.find((day) => day.date === "2030-12-09")!.departments[0]!.ranges).toEqual([]);
    expect((await read(v, 2030)).today).toBeNull();
  });

  it("gives a venue with no seasons yet every date with no season and no chips", async () => {
    const [location] = await suite.db
      .insert(locations)
      .values({
        name: `Casa ${randomUUID()}`,
        invoiceLocales: ["es-ES"],
        operationDescription: "Hostelería",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
        province: "Sevilla",
        city: "Sevilla",
      })
      .returning({ id: locations.id });
    const month = await readMonth({ cfg: { locationId: locationId(location!.id) } }, "2030-12");
    expect(month.seasons).toEqual([]);
    expect(month.days).toHaveLength(42);
    expect(month.days.map(({ seasonId, departments }) => ({ seasonId, departments }))).toEqual(
      Array(42).fill({ seasonId: null, departments: [] }),
    );
  });

  it("plans the month from the tables it declares, holidays and special-day paint included", async () => {
    const v = await venue();
    const semanaSanta = await special(v, {
      name: "Semana Santa",
      repeatsYearly: true,
      dates: [{ date: "2025-04-18", closedAllDay: false }],
    });
    await suite.db
      .update(specialDayDates)
      .set({ holidayName: "Viernes Santo" })
      .where(eq(specialDayDates.specialDayId, semanaSanta.id));
    const tables = await run(async (tx) => {
      const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
        .session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        const frame = await readCalendarMonthPlan(tx, v.cfg, "2026-04", AT);
        expect(frame.plan.special.get("2026-04-03")?.specialDayId).toBe(semanaSanta.id);
        return prepared.mock.calls.flatMap((call) =>
          [...(call[0] as { sql: string }).sql.matchAll(/\b(?:from|join) "(\w+)"/g)].map(
            (match) => match[1]!,
          ),
        );
      } finally {
        prepared.mockRestore();
      }
    });
    expect([...new Set(tables)].sort()).toEqual([...CALENDAR_MONTH_PLAN_READS].sort());
  });

  it("reads the location once when a repeating special day follows a public holiday, and places it by that holiday", async () => {
    const v = await venue();
    const semanaSanta = await special(v, {
      name: "Semana Santa",
      repeatsYearly: true,
      dates: [{ date: "2025-04-18", closedAllDay: true }],
    });
    // 2025's list is not shipped, so the save cannot have named the holiday itself.
    await suite.db
      .update(specialDayDates)
      .set({ holidayName: "Viernes Santo" })
      .where(eq(specialDayDates.specialDayId, semanaSanta.id));
    const { month, tables } = await run(async (tx) => {
      const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
        .session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        return {
          month: await readOpeningHoursMonth(tx, v.cfg, "2026-04", AT),
          tables: prepared.mock.calls.flatMap((call) =>
            [...(call[0] as { sql: string }).sql.matchAll(/\b(?:from|join) "(\w+)"/g)].map(
              (match) => match[1]!,
            ),
          ),
        };
      } finally {
        prepared.mockRestore();
      }
    });
    // Viernes Santo falls on 2026-04-03.
    const day = (date: string) => month.days.find((d) => d.date === date)!;
    expect(day("2026-04-03").specialDay).toEqual({ id: semanaSanta.id, name: "Semana Santa" });
    expect(day("2026-04-18").specialDay).toBeNull();
    expect(tables.filter((table) => table === "locations")).toHaveLength(1);
  });

  it("sends the same statements for one department as for three, not one per day or department", async () => {
    const statementsFor = async (v: { cfg: VenueScope }) =>
      run(async (tx) => {
        const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
          .session;
        const prepared = vi.spyOn(session, "prepareQuery");
        try {
          await readOpeningHoursMonth(tx, v.cfg, "2030-12", AT);
          return prepared.mock.calls.length;
        } finally {
          prepared.mockRestore();
        }
      });
    const one = await statementsFor(await venue([[1]]));
    expect(await statementsFor(await venue([[1], [1], [1]]))).toBe(one);
    expect(one).toBeLessThan(40);
  });
});

describe("the season days read", () => {
  it("gives each asked date its season's hours and closures by value, under a special day's paint and Closed tick", async () => {
    const v = await monthVenue();
    await special(v, {
      name: "Nochebuena",
      repeatsYearly: false,
      dates: [
        { date: "2030-12-24", closedAllDay: false },
        { date: "2030-11-30", closedAllDay: true },
      ],
      paint: [
        {
          departmentId: v.sala,
          date: "2030-12-24",
          ranges: [{ periodId: v.lunch, startsAt: "19:00", endsAt: "20:30" }],
        },
      ],
      zonePaint: [
        {
          zoneId: v.bar,
          date: "2030-12-24",
          ranges: [{ kind: "closed", startsAt: "19:00", endsAt: "20:00" }],
        },
      ],
    });
    const read = await run((tx) =>
      readSeasonDays(tx, v.cfg, ["2030-12-24", "2030-11-30", "2030-12-01", "2030-12-24"]),
    );
    const barra = {
      departmentId: v.barra,
      ranges: [{ periodId: v.barLunch, startsAt: "13:00", endsAt: "15:00" }],
      zones: [{ zoneId: v.counter, closed: [] }],
    };
    expect(read).toEqual({
      days: [
        {
          date: "2030-12-24",
          seasonId: v.seasons.Winter,
          dayCutover: "06:00",
          departments: [
            barra,
            {
              departmentId: v.sala,
              ranges: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
              zones: [
                { zoneId: v.terrace, closed: [] },
                { zoneId: v.bar, closed: [] },
              ],
            },
          ],
        },
        {
          date: "2030-11-30",
          seasonId: v.seasons.Autumn,
          dayCutover: "06:00",
          departments: [
            barra,
            {
              departmentId: v.sala,
              ranges: [{ periodId: v.lunch, startsAt: "12:00", endsAt: "16:00" }],
              zones: [
                { zoneId: v.terrace, closed: [] },
                { zoneId: v.bar, closed: [] },
              ],
            },
          ],
        },
        {
          date: "2030-12-01",
          seasonId: v.seasons.Winter,
          dayCutover: "06:00",
          departments: [
            barra,
            {
              departmentId: v.sala,
              ranges: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
              zones: [
                { zoneId: v.terrace, closed: [{ startsAt: "20:00", endsAt: "22:00" }] },
                { zoneId: v.bar, closed: [] },
              ],
            },
          ],
        },
      ],
    });
  });

  it("gives each date its own changeover across a pending changeover change", async () => {
    const v = await venue([]);
    await suite.db.insert(locationDayCutoverChanges).values({
      locationId: v.cfg.locationId,
      effectiveBusinessDay: "2030-12-10",
      dayCutover: "07:00:00",
    });
    const read = await run((tx) => readSeasonDays(tx, v.cfg, ["2030-12-09", "2030-12-10"]));
    expect(read.days.map(({ date, dayCutover }) => ({ date, dayCutover }))).toEqual([
      { date: "2030-12-09", dayCutover: "06:00" },
      { date: "2030-12-10", dayCutover: "07:00" },
    ]);
  });
});

describe("a past day's range around a start change", () => {
  const AFTER_RETURN = new Date("2026-11-02T12:00:00Z");
  /** 05:00, then 03:00 from 2026-10-21, then 05:00 again from 2026-10-28, with Sala's dinner
   *  stored at 22:00–04:30 on Tuesdays and Saturdays after the start came back to 05:00, and Terrace closed
   *  23:00–04:00 then. */
  async function lateSaturday() {
    const { cfg } = await venue([]);
    await suite.db
      .update(locations)
      .set({ dayCutover: "05:00:00" })
      .where(eq(locations.id, cfg.locationId));
    await run(async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: cfg.locationId, revision: 1 });
      await tx.insert(locationDayCutoverChanges).values([
        { locationId: cfg.locationId, effectiveBusinessDay: "2026-10-21", dayCutover: "03:00:00" },
        { locationId: cfg.locationId, effectiveBusinessDay: "2026-10-28", dayCutover: "05:00:00" },
      ]);
    });
    return run(async (tx) => {
      const menuId = (await createCatalogue(tx, { name: `Carta ${randomUUID()}` })).id;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      const sala = (await createDepartment(tx, cfg, { name: "Sala", orderStart: "table" })).id;
      const period = async (name: string) =>
        (await saveMenuPeriod(tx, cfg, sala, { name, menuId, staffMenuIds: [] })).id;
      const lunch = await period("Lunch");
      const dinner = await period("Dinner");
      await replaceMenuWeek(
        tx,
        cfg,
        sala,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 2 || weekday === 6
              ? [{ periodId: dinner, startsAt: "22:00", endsAt: "04:30" }]
              : [],
        })),
        AFTER_RETURN,
        1,
      );
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name: "Terrace", displayOrder: 1 })
        .returning({ id: floorZones.id });
      await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: sala });
      await replaceZoneClosedWeek(
        tx,
        cfg,
        zone!.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: weekday === 6 ? [{ startsAt: "23:00", endsAt: "04:00" }] : [],
        })),
        1,
        AFTER_RETURN,
      );
      return { cfg, sala, lunch, dinner, terrace: zone!.id };
    });
  }
  const october = (v: { cfg: VenueScope }) =>
    run((tx) => readOpeningHoursMonth(tx, v.cfg, "2026-10", AFTER_RETURN));
  const onSaturday = (month: Awaited<ReturnType<typeof october>>, date: string) => {
    const day = month.days.find((d) => d.date === date)!;
    return {
      dayCutover: day.dayCutover,
      ranges: day.departments[0]!.ranges,
      closed: day.departments[0]!.zones[0]!.closed,
    };
  };

  it("draws it cut at the day's own changeover, and a day under today's start as stored", async () => {
    const v = await lateSaturday();
    const month = await october(v);
    expect(onSaturday(month, "2026-10-24")).toEqual({
      dayCutover: "03:00",
      ranges: [{ periodId: v.dinner, startsAt: "22:00", endsAt: "03:00" }],
      closed: [{ startsAt: "23:00", endsAt: "03:00" }],
    });
    expect(onSaturday(month, "2026-10-31")).toEqual({
      dayCutover: "05:00",
      ranges: [{ periodId: v.dinner, startsAt: "22:00", endsAt: "04:30" }],
      closed: [{ startsAt: "23:00", endsAt: "04:00" }],
    });
  });

  it("cuts a range fitting a shortened day's own start at that day's end", async () => {
    const v = await lateSaturday();
    const tuesday = (await october(v)).days.find((d) => d.date === "2026-10-20")!;
    expect({ dayCutover: tuesday.dayCutover, ranges: tuesday.departments[0]!.ranges }).toEqual({
      dayCutover: "05:00",
      ranges: [{ periodId: v.dinner, startsAt: "22:00", endsAt: "03:00" }],
    });
  });

  it("keeps the season's cut dinner beside a special day's painted lunch", async () => {
    const v = await lateSaturday();
    await run((tx) =>
      saveSpecialDay(
        tx,
        v.cfg,
        null,
        {
          name: "Feria",
          repeatsYearly: false,
          dates: [{ date: "2026-10-24", closedAllDay: false }],
          paint: [
            {
              departmentId: v.sala,
              date: "2026-10-24",
              ranges: [{ periodId: v.lunch, startsAt: "12:00", endsAt: "15:00" }],
            },
          ],
        },
        AFTER_RETURN,
        1,
      ),
    );
    expect(onSaturday(await october(v), "2026-10-24").ranges).toEqual([
      { periodId: v.lunch, startsAt: "12:00", endsAt: "15:00" },
      { periodId: v.dinner, startsAt: "22:00", endsAt: "03:00" },
    ]);
  });

  it("counts the cut range as open in the year, under a special day with no paint", async () => {
    const v = await lateSaturday();
    await run((tx) =>
      saveSpecialDay(
        tx,
        v.cfg,
        null,
        {
          name: "Feria",
          repeatsYearly: false,
          dates: [
            { date: "2026-10-24", closedAllDay: false },
            // The last day starting at 03:00, 1560 minutes long.
            { date: "2026-10-27", closedAllDay: false },
          ],
        },
        AFTER_RETURN,
        1,
      ),
    );
    const year = await run((tx) => readOpeningHoursYear(tx, v.cfg, 2026, AFTER_RETURN));
    for (const date of ["2026-10-24", "2026-10-27"])
      expect(year.days.find((day) => day.date === date)).toMatchObject({
        tone: "special_day",
        closed: false,
      });
  });
});
