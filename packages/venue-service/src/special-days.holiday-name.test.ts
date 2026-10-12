import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import type { CountryPack } from "@waitron/country";
import {
  CORE_MIGRATIONS,
  locations,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { businessDayClockConflicts } from "./business-day-schedule.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, listVenueReadiness, type VenueScope } from "./operations.js";
import { menuPeriods } from "./schema/menus.js";
import {
  departmentDayRanges,
  departmentDays,
  specialDayDates,
  specialDays,
} from "./schema/seasons.js";
import { listSpecialDays, readSpecialDay, saveSpecialDay, specialDaysOn } from "./special-days.js";

/** Calls to the invented calendar's `read`, so a test can count the holiday-list reads. */
const reads = vi.hoisted(() => ({ count: 0 }));

/** An invented country "ZZ": Jueves and Viernes Santo move with Easter, Natividad del Señor stays
 *  on 25 December, Fiesta de 2026 is in 2026's list alone; 2028's list renamed Viernes Santo and
 *  has no Jueves Santo, and there is no list for 2029 on. */
vi.mock("@waitron/country-packs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/country-packs")>();
  const { createHolidayCalendar } = await import("@waitron/country");
  const row = (date: string, name: string) => ({
    key: `${name}-${date}`,
    date,
    name,
    scope: "national" as const,
    regions: ["R1"],
    sourceId: "ZZ-ANNEX",
  });
  const year = (number: number, rows: ReturnType<typeof row>[]) => ({
    year: number,
    dataVersion: `ZZ-${number}.1`,
    sourceIds: ["ZZ-ANNEX"],
    rows,
  });
  const calendar = createHolidayCalendar({
    localEntryLimit: 0,
    sources: [
      { id: "ZZ-ANNEX", title: "Invented", url: "https://example.test", sha256: "a".repeat(64) },
    ],
    provinceRegions: { "10": "R1" },
    areas: [],
    years: [
      year(2026, [
        row("2026-04-02", "Jueves Santo"),
        row("2026-04-03", "Viernes Santo"),
        row("2026-10-01", "Fiesta de 2026"),
        row("2026-12-25", "Natividad del Señor"),
      ]),
      year(2027, [
        row("2027-03-25", "Jueves Santo"),
        row("2027-03-26", "Viernes Santo"),
        row("2027-12-25", "Natividad del Señor"),
      ]),
      year(2028, [
        row("2028-04-14", "Viernes Santo (renamed)"),
        row("2028-12-25", "Natividad del Señor"),
      ]),
    ],
  });
  const pack: CountryPack = {
    countryCode: "ZZ",
    defaultLocale: "es-ES",
    defaultTimeZone: "Europe/Madrid",
    invoiceLocales: ["es-ES"],
    moduleIds: [],
    availableForVenueSetup: false,
    fiscalJurisdictions: [],
    administrativeAreas: [{ code: "10", name: "Northshire", postalPrefixes: [] }],
    holidayCalendar: {
      ...calendar,
      read: (input) => {
        reads.count++;
        return calendar.read(input);
      },
    },
  };
  return {
    ...real,
    getCountryPack: (country: string) => (country === "ZZ" ? pack : real.getCountryPack(country)),
  };
});

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const AT = new Date("2026-01-10T10:00:00Z");

async function venue() {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ZZ", taxId: "X0000000", legalName: "Invented SL" })
    .onConflictDoNothing();
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      province: "Northshire",
      city: "Villa Real",
    })
    .returning({ id: locations.id });
  const cfg: VenueScope = { locationId: brandLocationId(location!.id) };
  return scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const period = async (name: string) => {
      const menuId = (await createCatalogue(tx, { name })).id;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      return (await saveMenuPeriod(tx, cfg, restaurant, { name, menuId, staffMenuIds: [] }, 0)).id;
    };
    return { cfg, restaurant, lunch: await period("Lunch"), dinner: await period("Dinner") };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;

const save = (v: Venue, input: unknown, at = AT) =>
  scoped((tx) => saveSpecialDay(tx, v.cfg, null, input, at, 0));
const dates = (days: readonly string[]) => days.map((date) => ({ date, closedAllDay: false }));
const yearly = (v: Venue, name: string, date: string) =>
  save(v, { name, repeatsYearly: true, dates: dates([date]) });
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      params: (error as { params?: object }).params,
    };
  }
  throw new Error("expected a refusal");
};
/** The special day standing on each day, by its id, or null. */
const standing = async (v: Venue, days: readonly string[]) => {
  const found = await scoped((tx) => specialDaysOn(tx, v.cfg, days));
  return Object.fromEntries(days.map((day) => [day, found.get(day)?.specialDayId ?? null]));
};

describe("a special-day date records the public holiday it was saved on", () => {
  it("stores the holiday's official name on a holiday, and none on an ordinary date", async () => {
    const v = await venue();
    const day = await save(v, {
      name: "Semana Santa",
      repeatsYearly: false,
      dates: dates(["2026-04-03", "2026-04-04"]),
    });
    expect(
      await db
        .select({ date: specialDayDates.date, holidayName: specialDayDates.holidayName })
        .from(specialDayDates)
        .where(eq(specialDayDates.specialDayId, day.id))
        .orderBy(asc(specialDayDates.date)),
    ).toEqual([
      { date: "2026-04-03", holidayName: "Viernes Santo" },
      { date: "2026-04-04", holidayName: null },
    ]);
  });
});

describe("reading a special day gives each date's stored holiday name", () => {
  it("names the holiday on a holiday date and leaves an ordinary date without one, in one read and the list", async () => {
    const v = await venue();
    const day = await save(v, {
      name: "Semana Santa",
      repeatsYearly: false,
      dates: dates(["2026-04-03", "2026-04-04"]),
    });
    const expected = [
      { date: "2026-04-03", closedAllDay: false, holidayName: "Viernes Santo" },
      { date: "2026-04-04", closedAllDay: false },
    ];
    expect((await scoped((tx) => readSpecialDay(tx, v.cfg, day.id))).dates).toEqual(expected);
    expect(await scoped((tx) => listSpecialDays(tx, v.cfg))).toEqual([
      { id: day.id, name: "Semana Santa", repeatsYearly: false, dates: expected },
    ]);
  });
});

describe("one special day's own dates under name-following", () => {
  it("refuses two dates of one repeating day that meet where the holiday falls in a later year", async () => {
    const v = await venue();
    expect(
      await refusal(
        save(v, {
          name: "Viernes Santo",
          repeatsYearly: true,
          dates: dates(["2026-04-03", "2027-03-26"]),
        }),
      ),
    ).toEqual({
      code: "special_day.invalid",
      params: { field: "dates.1.date", reason: "overlap" },
    });
  });

  it("accepts a holiday date and the same month and day a year later, which never meet in this suite's invented holiday list", async () => {
    const v = await venue();
    const day = await save(v, {
      name: "Viernes Santo",
      repeatsYearly: true,
      dates: dates(["2026-04-03", "2027-04-03"]),
    });
    expect(day.dates.map((entry) => entry.date)).toEqual(["2026-04-03", "2027-04-03"]);
  });

  it("keeps a kept date's stored holiday name when the day is saved again", async () => {
    const v = await venue();
    const day = await yearly(v, "Viernes Santo", "2026-04-03");
    await db
      .update(specialDayDates)
      .set({ holidayName: "Stored name" })
      .where(eq(specialDayDates.specialDayId, day.id));
    await scoped((tx) =>
      saveSpecialDay(
        tx,
        v.cfg,
        day.id,
        {
          name: "Good Friday",
          repeatsYearly: true,
          dates: [{ date: "2026-04-03", closedAllDay: true }],
        },
        AT,
        0,
      ),
    );
    expect(
      await db
        .select({ holidayName: specialDayDates.holidayName })
        .from(specialDayDates)
        .where(eq(specialDayDates.specialDayId, day.id)),
    ).toEqual([{ holidayName: "Stored name" }]);
  });
});

describe("a repeating holiday date follows the holiday's name", () => {
  it("applies on the date the later year's list gives the name, not on the old month and day", async () => {
    const v = await venue();
    const day = await yearly(v, "Viernes Santo", "2026-04-03");
    expect(await standing(v, ["2026-04-03", "2027-03-26", "2027-04-03"])).toEqual({
      "2026-04-03": day.id,
      "2027-03-26": day.id,
      "2027-04-03": null,
    });
    // As the till reads it: the business day and the one before, neither on 3 April.
    expect(await standing(v, ["2027-03-25", "2027-03-26"])).toEqual({
      "2027-03-25": null,
      "2027-03-26": day.id,
    });
  });

  it("keeps a fixed holiday's date", async () => {
    const v = await venue();
    const day = await yearly(v, "Natividad del Señor", "2026-12-25");
    expect(await standing(v, ["2027-12-25", "2028-12-25"])).toEqual({
      "2027-12-25": day.id,
      "2028-12-25": day.id,
    });
  });

  it("applies nothing in a year whose list lacks the name, or that has no list", async () => {
    const v = await venue();
    await yearly(v, "Viernes Santo", "2026-04-03");
    expect(await standing(v, ["2028-04-03", "2028-04-14", "2029-04-03", "2029-03-30"])).toEqual({
      "2028-04-03": null,
      "2028-04-14": null,
      "2029-04-03": null,
      "2029-03-30": null,
    });
  });

  it("repeats a date with no holiday name on its month and day", async () => {
    const v = await venue();
    const day = await yearly(v, "Fiesta de la casa", "2026-06-10");
    expect(await standing(v, ["2027-06-10", "2029-06-10"])).toEqual({
      "2027-06-10": day.id,
      "2029-06-10": day.id,
    });
  });

  it("reads the holiday lists once for a read, and not at all without a holiday-named repeating date", async () => {
    const v = await venue();
    await yearly(v, "Fiesta de la casa", "2026-06-10");
    reads.count = 0;
    await standing(v, ["2027-06-10", "2028-06-10"]);
    expect(reads.count).toBe(0);
    await yearly(v, "Viernes Santo", "2026-04-03");
    reads.count = 0;
    await standing(v, ["2027-03-26", "2028-04-03", "2028-06-10"]);
    expect(reads.count).toBe(1);
  });
});

describe("the date-taken check uses each year's resolved date", () => {
  it("refuses a one-off date where a repeating holiday falls in a later year, and allows the old month and day", async () => {
    const v = await venue();
    const friday = await yearly(v, "Viernes Santo", "2026-04-03");
    expect(
      await refusal(save(v, { name: "Cena", repeatsYearly: false, dates: dates(["2027-03-26"]) })),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-26", specialDayId: friday.id, name: "Viernes Santo" },
    });
    await save(v, { name: "Cena", repeatsYearly: false, dates: dates(["2027-04-03"]) });
  });

  it("refuses a repeating holiday whose later date another special day already holds", async () => {
    const v = await venue();
    const dinner = await save(v, {
      name: "Cena",
      repeatsYearly: false,
      dates: dates(["2027-03-26"]),
    });
    expect(await refusal(yearly(v, "Viernes Santo", "2026-04-03"))).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-26", specialDayId: dinner.id, name: "Cena" },
    });
  });
});

describe("the end-offset check uses each year's resolved date", () => {
  /** Lunch from 06:30 every day; Dinner sends for an hour after it ends, so a Dinner until 05:30
   *  runs into the next day's Lunch unless that Lunch is Closed. Holy Saturday's Lunch is Closed
   *  in 2026 and 2027. */
  async function easter(closeSaturday2027: boolean) {
    const v = await venue();
    await db.update(menuPeriods).set({ endOffsetMinutes: 60 }).where(eq(menuPeriods.id, v.dinner));
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: [{ periodId: v.lunch, startsAt: "06:30", endsAt: "09:00" }],
        })),
        AT,
        0,
      ),
    );
    const saturdays = closeSaturday2027 ? ["2026-04-04", "2027-03-27"] : ["2026-04-04"];
    await save(v, {
      name: "Sábado Santo",
      repeatsYearly: false,
      dates: dates(saturdays),
      paint: saturdays.map((date) => ({
        departmentId: v.restaurant,
        date,
        ranges: [{ periodId: null, startsAt: "06:30", endsAt: "09:00" }],
      })),
    });
    return v;
  }
  const lateFriday = (v: Venue) =>
    save(v, {
      name: "Viernes Santo",
      repeatsYearly: true,
      dates: dates(["2026-04-03"]),
      paint: [
        {
          departmentId: v.restaurant,
          date: "2026-04-03",
          ranges: [{ periodId: v.dinner, startsAt: "22:00", endsAt: "05:30" }],
        },
      ],
    });

  it("accepts paint that is clear on the day after each year's holiday", async () => {
    const v = await easter(true);
    await expect(lateFriday(v)).resolves.toMatchObject({ name: "Viernes Santo" });
  });

  it("refuses paint that runs into the day after a later year's holiday", async () => {
    const v = await easter(false);
    expect(await refusal(lateFriday(v))).toEqual({
      code: "special_day.invalid",
      params: {
        field: "paint",
        reason: "end_offset",
        date: "2027-03-26",
        periodId: v.dinner,
        departmentId: v.restaurant,
      },
    });
  });
});

describe("the readiness list warns when a later year has no holiday of the name", () => {
  const warnings = async (v: Venue, at: Date) =>
    (await scoped((tx) => listVenueReadiness(tx, v.cfg, at))).filter(
      (issue) => issue.code === "special_day.holiday_missing",
    );

  it("names each current or next year whose list lacks the name, or that has no list", async () => {
    const v = await venue();
    const friday = await yearly(v, "Viernes Santo", "2026-04-03");
    const christmas = await yearly(v, "Natividad del Señor", "2026-12-25");
    const missing = (day: { id: string; name: string }, year: number) => ({
      code: "special_day.holiday_missing",
      specialDayId: day.id,
      holidayName: day.name,
      year,
    });
    expect(await warnings(v, new Date("2026-06-01T10:00:00Z"))).toEqual([]);
    expect(await warnings(v, new Date("2027-06-01T10:00:00Z"))).toEqual([missing(friday, 2028)]);
    expect(await warnings(v, new Date("2028-06-01T10:00:00Z"))).toEqual([
      missing(friday, 2028),
      missing(friday, 2029),
      missing(christmas, 2029),
    ]);
  });

  it("does not warn for a one-off date", async () => {
    const v = await venue();
    await save(v, { name: "Viernes Santo", repeatsYearly: false, dates: dates(["2026-04-03"]) });
    expect(await warnings(v, new Date("2028-06-01T10:00:00Z"))).toEqual([]);
  });
});

describe("the clock-change check follows a repeating holiday date to each year's date", () => {
  /** Wednesday's Dinner, 22:00 to 04:30, sends until 07:30; a special day's Thursday opens Lunch
   *  at 07:15. The rows are written raw, as the special-day writer would refuse them under the
   *  venue's own changeover. */
  async function thursdayLunch(date: string, holidayName: string) {
    const v = await venue();
    await db.update(menuPeriods).set({ endOffsetMinutes: 180 }).where(eq(menuPeriods.id, v.dinner));
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: weekday === 3 ? [{ periodId: v.dinner, startsAt: "22:00", endsAt: "04:30" }] : [],
        })),
        AT,
        0,
      ),
    );
    await scoped(async (tx) => {
      const [day] = await tx
        .insert(specialDays)
        .values({ locationId: v.cfg.locationId, name: holidayName, repeatsYearly: true })
        .returning({ id: specialDays.id });
      const [dated] = await tx
        .insert(specialDayDates)
        .values({ specialDayId: day!.id, locationId: v.cfg.locationId, date, holidayName })
        .returning({ id: specialDayDates.id });
      const [painted] = await tx
        .insert(departmentDays)
        .values({ departmentId: v.restaurant, specialDayDateId: dated!.id })
        .returning({ id: departmentDays.id });
      await tx.insert(departmentDayRanges).values({
        dayId: painted!.id,
        departmentId: v.restaurant,
        periodId: v.lunch,
        startsAt: "07:15:00",
        endsAt: "09:00:00",
      });
    });
    return v;
  }
  const reasons = async (v: Venue) =>
    (
      await scoped((tx) =>
        businessDayClockConflicts(
          tx,
          v.cfg,
          { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
          {
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
            cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }],
          },
          "2026-11-04",
        ),
      )
    ).conflicts.map((conflict) => conflict.reason);

  it("checks the Thursday the next year's list gives the holiday", async () => {
    expect(await reasons(await thursdayLunch("2026-04-02", "Jueves Santo"))).toContain(
      "sending_cutoff",
    );
  });

  it("checks no later Thursday when no later list names the holiday", async () => {
    expect(await reasons(await thursdayLunch("2026-10-01", "Fiesta de 2026"))).toEqual([]);
  });
});
