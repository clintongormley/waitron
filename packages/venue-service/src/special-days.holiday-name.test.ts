import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CountryPack } from "@waitron/country";
import {
  CORE_MIGRATIONS,
  specialDayDates,
  specialDays,
  taxpayer,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { listVenueReadiness } from "./operations.js";
import { readSpecialDay, saveSpecialDay, specialDaysOn } from "./special-days.js";

/** Calls to the invented calendar's `read`, so a test can count the holiday-list reads. */
const reads = vi.hoisted(() => ({ count: 0 }));

/** An invented country "ZZ": Holy Thursday and Holy Friday move with Easter, Nativity stays
 *  on 25 December, Festival of 2026 is in 2026's list alone; 2028's list renamed Holy Friday and
 *  has no Holy Thursday, and there is no list for 2029 on. */
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
        row("2026-04-02", "Holy Thursday"),
        row("2026-04-03", "Holy Friday"),
        row("2026-10-01", "Festival of 2026"),
        row("2026-12-25", "Nativity"),
      ]),
      year(2027, [
        row("2027-03-25", "Holy Thursday"),
        row("2027-03-26", "Holy Friday"),
        row("2027-12-25", "Nativity"),
      ]),
      year(2028, [row("2028-04-14", "Holy Friday (renamed)"), row("2028-12-25", "Nativity")]),
    ],
  });
  const pack: CountryPack = {
    countryCode: "ZZ",
    defaultLocale: "es-ES",
    defaultTimeZone: "Europe/Madrid",
    timeZones: ["Europe/Madrid"],
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
  migrations: [CORE_MIGRATIONS],
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
    .insert(taxpayer)
    .values({ id: 1, country: "ZZ", taxId: "X0000000", legalName: "Invented SL" })
    .onConflictDoNothing();
  await seedVenue(db, {
    name: `Venue ${randomUUID()}`,
    invoiceLocales: ["es-ES"],
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    province: "Northshire",
    city: "Kingsford",
  });
}

const save = (input: unknown, at = AT) => scoped((tx) => saveSpecialDay(tx, null, input, at, 1));
const dates = (days: readonly string[]) => days.map((date) => ({ date, closedAllDay: false }));
const yearly = (name: string, date: string) =>
  save({ name, repeatsYearly: true, dates: dates([date]) });
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
const standing = async (days: readonly string[]) => {
  const found = await scoped((tx) => specialDaysOn(tx, days));
  return Object.fromEntries(days.map((day) => [day, found.get(day)?.specialDayId ?? null]));
};

/** A Closed all day date written raw, as when a later year's holiday list ships after it was saved
 *  and moves a repeating holiday date onto it, which the special-day writer refuses once that list
 *  is present, as it is in this suite. */
const rawDay = (
  name: string,
  date: string,
  repeatsYearly = false,
  holidayName: string | null = null,
) =>
  scoped(async (tx) => {
    const [day] = await tx
      .insert(specialDays)
      .values({ name, repeatsYearly })
      .returning({ id: specialDays.id });
    await tx.insert(specialDayDates).values({
      specialDayId: day!.id,
      date,
      closedAllDay: true,
      holidayName,
    });
    return { id: day!.id };
  });

describe("a special-day date records the public holiday it was saved on", () => {
  it("stores the holiday's official name on a holiday, and none on an ordinary date", async () => {
    await venue();
    const day = await save({
      name: "Holy week",
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
      { date: "2026-04-03", holidayName: "Holy Friday" },
      { date: "2026-04-04", holidayName: null },
    ]);
  });
});

describe("reading a special day gives each date's stored holiday name", () => {
  it("names the holiday on a holiday date and leaves an ordinary date without one, in one read", async () => {
    await venue();
    const day = await save({
      name: "Holy week",
      repeatsYearly: false,
      dates: dates(["2026-04-03", "2026-04-04"]),
    });
    const expected = [
      { date: "2026-04-03", closedAllDay: false, holidayName: "Holy Friday" },
      { date: "2026-04-04", closedAllDay: false },
    ];
    expect((await scoped((tx) => readSpecialDay(tx, day.id))).dates).toEqual(expected);
  });
});

describe("one special day's own dates under name-following", () => {
  it("refuses two dates of one repeating day that meet where the holiday falls in a later year", async () => {
    await venue();
    expect(
      await refusal(
        save({
          name: "Holy Friday",
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
    await venue();
    const day = await save({
      name: "Holy Friday",
      repeatsYearly: true,
      dates: dates(["2026-04-03", "2027-04-03"]),
    });
    expect(day.dates.map((entry) => entry.date)).toEqual(["2026-04-03", "2027-04-03"]);
  });

  it("keeps a kept date's stored holiday name when the day is saved again", async () => {
    await venue();
    const day = await yearly("Holy Friday", "2026-04-03");
    await db
      .update(specialDayDates)
      .set({ holidayName: "Stored name" })
      .where(eq(specialDayDates.specialDayId, day.id));
    await scoped((tx) =>
      saveSpecialDay(
        tx,
        day.id,
        {
          name: "Good Friday",
          repeatsYearly: true,
          dates: [{ date: "2026-04-03", closedAllDay: true }],
        },
        AT,
        1,
      ),
    );
    expect(
      await db
        .select({ holidayName: specialDayDates.holidayName })
        .from(specialDayDates)
        .where(eq(specialDayDates.specialDayId, day.id)),
    ).toEqual([{ holidayName: "Stored name" }]);
  });

  it("checks a kept date stored without a holiday name on its month and day, though the list names it", async () => {
    await venue();
    const day = await yearly("Holy Friday", "2026-04-03");
    await db
      .update(specialDayDates)
      .set({ holidayName: null })
      .where(eq(specialDayDates.specialDayId, day.id));
    // Where 2027's list puts Holy Friday, which the unnamed date does not follow.
    await save({ name: "Dinner", repeatsYearly: false, dates: dates(["2027-03-26"]) });
    const saved = await scoped((tx) =>
      saveSpecialDay(
        tx,
        day.id,
        { name: "Good Friday", repeatsYearly: true, dates: dates(["2026-04-03"]) },
        AT,
        1,
      ),
    );
    expect(saved.dates).toEqual([{ date: "2026-04-03", closedAllDay: false }]);
  });
});

describe("a repeating holiday date follows the holiday's name", () => {
  it("applies on the date the later year's list gives the name, not on the old month and day", async () => {
    await venue();
    const day = await yearly("Holy Friday", "2026-04-03");
    expect(await standing(["2026-04-03", "2027-03-26", "2027-04-03"])).toEqual({
      "2026-04-03": day.id,
      "2027-03-26": day.id,
      "2027-04-03": null,
    });
    // As the till reads it: the business day and the one before, neither on 3 April.
    expect(await standing(["2027-03-25", "2027-03-26"])).toEqual({
      "2027-03-25": null,
      "2027-03-26": day.id,
    });
  });

  it("keeps a fixed holiday's date", async () => {
    await venue();
    const day = await yearly("Nativity", "2026-12-25");
    expect(await standing(["2027-12-25", "2028-12-25"])).toEqual({
      "2027-12-25": day.id,
      "2028-12-25": day.id,
    });
  });

  it("applies nothing in a year whose list lacks the name, or that has no list", async () => {
    await venue();
    await yearly("Holy Friday", "2026-04-03");
    expect(await standing(["2028-04-03", "2028-04-14", "2029-04-03", "2029-03-30"])).toEqual({
      "2028-04-03": null,
      "2028-04-14": null,
      "2029-04-03": null,
      "2029-03-30": null,
    });
  });

  it("repeats a date with no holiday name on its month and day", async () => {
    await venue();
    const day = await yearly("House party", "2026-06-10");
    expect(await standing(["2027-06-10", "2029-06-10"])).toEqual({
      "2027-06-10": day.id,
      "2029-06-10": day.id,
    });
  });

  it("reads the holiday lists once for a read, and not at all without a holiday-named repeating date", async () => {
    await venue();
    await yearly("House party", "2026-06-10");
    reads.count = 0;
    await standing(["2027-06-10", "2028-06-10"]);
    expect(reads.count).toBe(0);
    await yearly("Holy Friday", "2026-04-03");
    reads.count = 0;
    await standing(["2027-03-26", "2028-04-03", "2028-06-10"]);
    expect(reads.count).toBe(1);
  });

  it("reads no holiday list for days in the holiday-named date's own year", async () => {
    await venue();
    const day = await yearly("Holy Friday", "2026-04-03");
    reads.count = 0;
    expect(await standing(["2026-04-02", "2026-04-03"])).toEqual({
      "2026-04-02": null,
      "2026-04-03": day.id,
    });
    expect(reads.count).toBe(0);
  });
});

describe("a date saved on a day beats a holiday date that moved onto it", () => {
  it("gives the day to the one-off date, not to the repeating holiday that later followed its name there", async () => {
    await venue();
    await yearly("Holy Friday", "2026-04-03");
    const dinner = await rawDay("Company dinner", "2027-03-26");
    const found = await scoped((tx) => specialDaysOn(tx, ["2027-03-26"]));
    expect(found.get("2027-03-26")).toMatchObject({ specialDayId: dinner.id, closedAllDay: true });
  });

  it("gives the day to a repeating month and day standing there, not to the holiday that moved there", async () => {
    await venue();
    await yearly("Holy Friday", "2026-04-03");
    const anniversary = await rawDay("Anniversary", "2027-03-26", true);
    expect(await standing(["2027-03-26"])).toEqual({ "2027-03-26": anniversary.id });
  });

  it("still stands the moved holiday date on its new day when nothing else is there", async () => {
    await venue();
    const friday = await yearly("Holy Friday", "2026-04-03");
    const dinner = await rawDay("Company dinner", "2027-03-27");
    expect(await standing(["2027-03-26", "2027-03-27"])).toEqual({
      "2027-03-26": friday.id,
      "2027-03-27": dinner.id,
    });
  });
});

describe("the date-taken check uses each year's resolved date", () => {
  it("refuses a one-off date where a repeating holiday falls in a later year, and allows the old month and day", async () => {
    await venue();
    const friday = await yearly("Holy Friday", "2026-04-03");
    expect(
      await refusal(save({ name: "Dinner", repeatsYearly: false, dates: dates(["2027-03-26"]) })),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-26", specialDayId: friday.id, name: "Holy Friday" },
    });
    await save({ name: "Dinner", repeatsYearly: false, dates: dates(["2027-04-03"]) });
  });

  it("refuses a repeating holiday whose later date another special day already holds", async () => {
    await venue();
    const dinner = await save({
      name: "Dinner",
      repeatsYearly: false,
      dates: dates(["2027-03-26"]),
    });
    expect(await refusal(yearly("Holy Friday", "2026-04-03"))).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-26", specialDayId: dinner.id, name: "Dinner" },
    });
  });
});

describe("a repeating month and day against a repeating holiday date", () => {
  it("refuses them where they first meet in a later year, though their stored dates differ", async () => {
    await venue();
    const thursday = await yearly("Holy Thursday", "2026-04-02");
    expect(await refusal(yearly("Anniversary", "2026-03-25"))).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-25", specialDayId: thursday.id, name: "Holy Thursday" },
    });
    await yearly("Anniversary", "2026-03-24");
  });
});

it("finds no special day on an empty list of days", async () => {
  await venue();
  await yearly("Holy Thursday", "2026-04-02");
  expect(await scoped((tx) => specialDaysOn(tx, []))).toEqual(new Map());
});

describe("the readiness list never warns that a later year has no holiday of the name", () => {
  const codes = async (at: Date) =>
    (await scoped((tx) => listVenueReadiness(tx, at))).map((issue) => issue.code);

  it("says nothing of a current or next year whose list lacks the name, or that has no list", async () => {
    await venue();
    await yearly("Holy Friday", "2026-04-03");
    await yearly("Nativity", "2026-12-25");
    for (const at of ["2026-06-01", "2027-06-01", "2028-06-01"]) {
      const listed = await codes(new Date(`${at}T10:00:00Z`));
      expect(listed, at).toEqual(["venue.default_station_missing", "venue.department_missing"]);
    }
  });

  it("says nothing of a one-off date", async () => {
    await venue();
    await save({ name: "Holy Friday", repeatsYearly: false, dates: dates(["2026-04-03"]) });
    expect(await codes(new Date("2028-06-01T10:00:00Z"))).toEqual([
      "venue.default_station_missing",
      "venue.department_missing",
    ]);
  });
});

describe("the readiness list warns when two special days come to share a date", () => {
  const clashes = async (at: Date) =>
    (await scoped((tx) => listVenueReadiness(tx, at))).filter(
      (issue) => issue.code === "special_day.date_shared",
    );
  const clash = (
    date: string,
    applies: { id: string },
    name: string,
    other: { id: string },
    otherName: string,
  ) => ({
    code: "special_day.date_shared",
    date,
    specialDayId: applies.id,
    specialDayName: name,
    otherSpecialDayId: other.id,
    otherSpecialDayName: otherName,
  });

  it("names a repeating holiday that moved onto a fixed date, which applies, in the current and next year", async () => {
    await venue();
    const friday = await yearly("Holy Friday", "2026-04-03");
    const fair = await rawDay("Fair", "2026-03-26", true);
    const expected = [clash("2027-03-26", fair, "Fair", friday, "Holy Friday")];
    expect(await clashes(new Date("2026-06-01T10:00:00Z"))).toEqual(expected);
    expect(await clashes(new Date("2027-06-01T10:00:00Z"))).toEqual(expected);
    expect(await standing(["2027-03-26"])).toEqual({ "2027-03-26": fair.id });
  });

  it("names a one-off date the moved holiday meets as the one that applies", async () => {
    await venue();
    const friday = await yearly("Holy Friday", "2026-04-03");
    const dinner = await rawDay("Company dinner", "2027-03-26");
    expect(await clashes(new Date("2026-06-01T10:00:00Z"))).toEqual([
      clash("2027-03-26", dinner, "Company dinner", friday, "Holy Friday"),
    ]);
  });

  it("says nothing when no two special days meet", async () => {
    await venue();
    await yearly("Holy Friday", "2026-04-03");
    await rawDay("Company dinner", "2027-03-27");
    expect(await clashes(new Date("2026-06-01T10:00:00Z"))).toEqual([]);
  });

  it("says nothing of a clash outside the current and next year", async () => {
    await venue();
    await yearly("Holy Friday", "2026-04-03");
    await rawDay("Fair", "2026-03-26", true);
    expect(await clashes(new Date("2028-06-01T10:00:00Z"))).toEqual([]);
  });

  it("gives two holiday-following dates that meet to the earlier stored date, the holiday's first", async () => {
    await venue();
    const friday = await yearly("Holy Friday", "2026-04-03");
    const later = await rawDay("Vigil", "2026-04-04", true, "Holy Friday");
    expect(await clashes(new Date("2026-06-01T10:00:00Z"))).toEqual([
      clash("2027-03-26", friday, "Holy Friday", later, "Vigil"),
    ]);
  });

  it("gives two holiday-following dates that meet to the earlier stored date, the other's first", async () => {
    await venue();
    const first = await yearly("Holy Friday", "2026-04-03");
    const earlier = await rawDay("Vigil", "2026-04-02", true, "Holy Friday");
    expect(await clashes(new Date("2026-06-01T10:00:00Z"))).toEqual([
      clash("2027-03-26", earlier, "Vigil", first, "Holy Friday"),
    ]);
  });
});

describe("saving either special day of a pair that came to share a date", () => {
  const pair = async () => {
    await venue();
    const friday = await yearly("Holy Friday", "2026-04-03");
    const fair = await rawDay("Fair", "2026-03-26", true);
    const update = (id: string, input: unknown) =>
      scoped((tx) => saveSpecialDay(tx, id, input, AT, 1));
    return { friday, fair, update };
  };
  const fairOn = (date: string) => ({
    name: "Fair",
    repeatsYearly: true,
    dates: [{ date, closedAllDay: true }],
  });

  it("refuses the repeating holiday unchanged, naming the fixed day that holds the shared date", async () => {
    const { friday, fair, update } = await pair();
    expect(
      await refusal(
        update(friday.id, {
          name: "Holy Friday",
          repeatsYearly: true,
          dates: dates(["2026-04-03"]),
        }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-26", specialDayId: fair.id, name: "Fair" },
    });
  });

  it("refuses the fixed yearly day unchanged, naming the holiday that moved onto it", async () => {
    const { friday, fair, update } = await pair();
    expect(await refusal(update(fair.id, fairOn("2026-03-26")))).toEqual({
      code: "special_day.date_taken",
      params: { date: "2027-03-26", specialDayId: friday.id, name: "Holy Friday" },
    });
  });

  it("saves the fixed yearly day once it moves off the shared date", async () => {
    const { friday, fair, update } = await pair();
    const saved = await update(fair.id, fairOn("2026-03-27"));
    expect(saved.id).toBe(fair.id);
    expect(
      await db
        .select({ date: specialDayDates.date })
        .from(specialDayDates)
        .where(eq(specialDayDates.specialDayId, fair.id)),
    ).toEqual([{ date: "2026-03-27" }]);
    expect(await standing(["2027-03-26", "2027-03-27"])).toEqual({
      "2027-03-26": friday.id,
      "2027-03-27": fair.id,
    });
  });
});
