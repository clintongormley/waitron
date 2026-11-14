import { rangeDates } from "./hours-rules.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import type { HoursSubject } from "./testing/legacy-station-types.js";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  CORE_MIGRATIONS,
  catalogues,
  departments,
  kitchenStations,
  specialDayDates,
  specialDays,
  tenants,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { calendarDays } from "./hours.js";
import { createHolidayStore, readHolidayFacts as installedReadHolidayFacts } from "./holidays.js";
import { stationStates } from "./routing-store.js";
import { type CalendarDay, type HolidayFact, type LocalDate } from "./hours-types.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { occursOn } from "./repeat-rules.js";
import { deleteSpecialDay, saveSpecialDay } from "./special-days.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** Tuesday 6 October 2026, 12:00 in Madrid. */
const AT = new Date("2026-10-06T10:00:00Z");

interface Fixture {
  cfg: {};
  restaurant: HoursSubject;
  deli: HoursSubject;
  bar: HoursSubject;
  kitchen: HoursSubject;
  departmentIds: { restaurant: string; deli: string };
}

async function fixture(): Promise<Fixture> {
  return withTransaction(db, async (tx) => {
    await seedVenue(tx, {
      name: `Venue ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    });
    const cfg = {};
    const department = (name: string, isDefault = false) => ({
      name,
      tradingName: name,
      isDefault,
    });
    const [restaurant, deli] = await tx
      .insert(departments)
      .values([department("Restaurant", true), department("Deli")])
      .returning();
    const [bar, kitchen] = await tx
      .insert(kitchenStations)
      .values([{ name: "Bar" }, { name: "Kitchen", isDefault: true }])
      .returning();
    const [restaurantStation, deliStation] = await tx
      .insert(kitchenStations)
      .values([{ name: "Pass" }, { name: "Grill" }])
      .returning();
    const [calendarMenu] = await tx
      .insert(catalogues)
      .values({ name: `Calendar ${randomUUID()}` })
      .returning();
    const calendarPeriod = await saveMenuPeriod(tx, restaurant!.id, {
      name: "Open",
      menuId: calendarMenu!.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      restaurant!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: calendarPeriod.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
      1,
    );
    return {
      cfg,
      departmentIds: { restaurant: restaurant!.id, deli: deli!.id },
      restaurant: { kind: "station", id: restaurantStation!.id },
      deli: { kind: "station", id: deliStation!.id },
      bar: { kind: "station", id: bar!.id },
      kitchen: { kind: "station", id: kitchen!.id },
    };
  });
}

/** Saves special day `id` (a new one when null) holding `dates`, through the special-day writer. */
const saveDay = (
  id: string | null,
  name: string,
  dates: readonly LocalDate[],
  options: {
    closedAllDay?: boolean;
    paint?: {
      departmentId: string;
      ranges: { periodId: string | null; startsAt: string; endsAt: string }[];
    }[];
  } = {},
) =>
  withTransaction(db, (tx) =>
    saveSpecialDay(
      tx,
      id,
      {
        name,
        repeatsYearly: false,
        dates: dates.map((date) => ({ date, closedAllDay: options.closedAllDay ?? false })),
        paint: dates.flatMap((date) => (options.paint ?? []).map((entry) => ({ ...entry, date }))),
      },
      AT,
      1,
    ),
  );

const dateSnapshot = (_f: Fixture, subject: HoursSubject, date: LocalDate) =>
  withTransaction(db, async (tx) => {
    const day = (await calendarDays(tx, [date], []).then(({ days }) => days))[0]!;
    const named = (
      await tx
        .select({
          id: specialDays.id,
          date: specialDayDates.date,
          repeatsYearly: specialDays.repeatsYearly,
          closedAllDay: specialDayDates.closedAllDay,
        })
        .from(specialDayDates)
        .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    ).find((row) => occursOn({ date: row.date, repeats: row.repeatsYearly }, date));
    const states = await stationStates(tx, new Date(`${date}T10:00:00Z`));
    return {
      subject,
      openingDate: day.date,
      specialDateId: named?.id ?? null,
      closeWholeVenue: named?.closedAllDay ?? false,
      state: states.get(subject.id)!,
    };
  });

const storedDates = () =>
  withTransaction(db, async (tx) => ({
    days: await tx
      .select()
      .from(specialDays)

      .orderBy(asc(specialDays.name)),
    dates: await tx
      .select()
      .from(specialDayDates)

      .orderBy(asc(specialDayDates.date)),
  }));
const toneAndClosed = (date: LocalDate) =>
  withTransaction(db, async (tx) => {
    const day = (await calendarDays(tx, [date], []).then(({ days }) => days))[0]!;
    return [day.tone, day.closed];
  });

const setDepartmentActive = (department: { id: string }, active: boolean) =>
  withTransaction(db, (tx) =>
    tx.update(departments).set({ active }).where(eq(departments.id, department.id)),
  );

async function addSubjects() {
  return withTransaction(db, async (tx) => {
    const [terrace] = await tx
      .insert(departments)
      .values({
        name: `Terrace ${randomUUID()}`,
        tradingName: "Terrace",
      })
      .returning();
    const [terraceStation, grill] = await tx
      .insert(kitchenStations)
      .values([{ name: "Terrace pass" }, { name: `Grill ${randomUUID()}` }])
      .returning();
    return {
      terraceDepartment: { kind: "department" as const, id: terrace!.id },
      terrace: { kind: "station", id: terraceStation!.id } as HoursSubject,
      grill: { kind: "station", id: grill!.id } as HoursSubject,
    };
  });
}

describe("the calendar's Closed colour", () => {
  it("is Closed when no active department has a service range, whatever the stations do", async () => {
    const f = await fixture();
    const deliPeriod = await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const restaurantPeriod = await saveMenuPeriod(tx, f.departmentIds.restaurant, {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      const deliPeriod = await saveMenuPeriod(tx, f.departmentIds.deli, {
        name: "Deli",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        f.departmentIds.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 1
              ? [{ periodId: restaurantPeriod.id, startsAt: "09:00", endsAt: "17:00" }]
              : [],
        })),
        AT,
        1,
      );
      return deliPeriod;
    });
    expect(await toneAndClosed("2026-10-19")).toEqual(["standard", false]);
    expect(await toneAndClosed("2026-10-20")).toEqual(["closed", true]);
    for (const [date, open] of [
      ["2026-10-21", false],
      ["2026-10-22", true],
      ["2026-10-23", true],
    ] as const) {
      await saveDay(null, `Special ${date}`, [date], {
        paint: open
          ? [
              {
                departmentId: f.departmentIds.deli,
                ranges: [{ periodId: deliPeriod.id, startsAt: "10:00", endsAt: "14:00" }],
              },
            ]
          : [],
      });
      expect(await toneAndClosed(date)).toEqual(["special_day", !open]);
    }
    const { terraceDepartment: terrace } = await addSubjects();
    expect(await toneAndClosed("2026-10-21")).toEqual(["special_day", true]);
    await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const period = await saveMenuPeriod(tx, terrace.id, {
        name: "Terrace",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        terrace.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 3 ? [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        AT,
        1,
      );
    });
    expect(await toneAndClosed("2026-10-21")).toEqual(["special_day", false]);
    await setDepartmentActive(terrace, false);
    expect(await toneAndClosed("2026-10-21")).toEqual(["special_day", true]);
    expect(await toneAndClosed("2026-10-26")).toEqual(["standard", false]);
    await saveDay(null, "Closed Monday", ["2026-10-26"], { closedAllDay: true });
    expect(await toneAndClosed("2026-10-26")).toEqual(["special_day", true]);
  });
});

describe("holiday facts beside the calendar", () => {
  // Invented facts: no fixture here claims a real public holiday.
  const fact = (id: string, date: LocalDate, name: string): HolidayFact => ({
    id,
    date,
    name,
    scope: "local",
    sourceId: "test-source",
  });
  const FACTS = [
    fact("h1", "2026-10-14", "Invented feast"),
    fact("h2", "2026-10-14", "Second invented feast"),
    fact("h3", "2026-10-16", "Another invented day"),
    fact("h4", "2026-11-30", "Outside the range"),
  ];
  const calendar = (facts: readonly HolidayFact[] = []) =>
    withTransaction(db, (tx) =>
      calendarDays(tx, rangeDates("2026-10-13", "2026-10-16"), facts).then(({ days }) => days),
    );
  const holidaysOn = (days: CalendarDay[], date: LocalDate) =>
    days.find((day) => day.date === date)!.holidays.map((holiday) => holiday.id);

  it("merges supplied holiday facts by date", async () => {
    await fixture();
    const days = await calendar(FACTS);
    expect(days.map((day) => [day.date, day.holidays.map((holiday) => holiday.name)])).toEqual([
      ["2026-10-13", []],
      ["2026-10-14", ["Invented feast", "Second invented feast"]],
      ["2026-10-15", []],
      ["2026-10-16", ["Another invented day"]],
    ]);
    expect(days[1]!.holidays[0]).toEqual(FACTS[0]);
    expect((await calendar()).every((day) => day.holidays.length === 0)).toBe(true);
  });

  it("reads holiday facts on an ordinary date", async () => {
    const f = await fixture();
    const wednesday = (await calendar(FACTS))[1]!;
    expect(wednesday).toEqual({
      date: "2026-10-14",
      specialDay: null,
      holidays: [FACTS[0], FACTS[1]],
      tone: "standard",
      closed: false,
    });
    await dateSnapshot(f, f.restaurant, "2026-10-14");
  });

  it("keeps a date's facts as they are while a special date there is added, renamed and deleted", async () => {
    await fixture();
    const before = holidaysOn(await calendar(FACTS), "2026-10-14");
    expect(before).toEqual(["h1", "h2"]);

    const added = await saveDay(null, "Our own party", ["2026-10-14"]);
    let days = await calendar(FACTS);
    expect(days[1]!.specialDay).toEqual({ id: added.id, name: "Our own party" });
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);

    await saveDay(added.id, "Renamed party", ["2026-10-14"]);
    days = await calendar(FACTS);
    expect(days[1]!.specialDay?.name).toBe("Renamed party");
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);

    await withTransaction(db, (tx) => deleteSpecialDay(tx, added.id, AT, 1));
    days = await calendar(FACTS);
    expect(days[1]!.specialDay).toBeNull();
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);
  });
});

describe("Hours with the holiday store", () => {
  const SHA = "a".repeat(64);
  const long = (letter: string) => letter.repeat(200);
  /** An invented country, so nothing here depends on a real country's holidays. */
  function pack(repeatFacts = false, reads?: string[]): CountryPack {
    const calendar = createHolidayCalendar({
      localEntryLimit: 2,
      sources: [
        { id: "ZZ-ANNEX", title: "Invented annex", url: "https://example.test/annex", sha256: SHA },
      ],
      provinceRegions: { "10": "R1" },
      areas: [],
      years: [
        {
          year: 2026,
          dataVersion: "ZZ-2026.1",
          sourceIds: ["ZZ-ANNEX"],
          rows: [
            ...(
              [
                ["feast", "2026-12-25", "National label", "national"],
                ["north", "2026-12-25", "Regional label", "regional"],
                ["long-n", "2026-08-03", long("a"), "national"],
                ["long-r", "2026-08-03", long("b"), "regional"],
              ] as const
            ).map(([key, date, name, scope]) => ({
              key,
              date,
              name,
              scope,
              regions: ["R1"],
              sourceId: "ZZ-ANNEX",
            })),
          ],
        },
      ],
    });
    return {
      countryCode: "ZZ",
      defaultLocale: "en-GB",
      defaultTimeZone: "Europe/Madrid",
      timeZones: ["Europe/Madrid"],
      invoiceLocales: ["en-GB"],
      moduleIds: [],
      availableForVenueSetup: false,
      fiscalJurisdictions: [],
      administrativeAreas: [{ code: "10", name: "Northshire", postalPrefixes: [] }],
      holidayCalendar: {
        ...calendar,
        read: (input) => {
          reads?.push(`${input.from}..${input.to}`);
          const read = calendar.read(input);
          return repeatFacts ? { ...read, facts: [...read.facts, ...read.facts] } : read;
        },
      },
    };
  }
  const store = createHolidayStore((country) => (country === "ZZ" ? pack() : undefined));

  // The file shares one taxpayer row; put back whatever it held before each case moved it.
  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await withTransaction(db, (tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  async function placed(): Promise<Fixture> {
    const f = await fixture();
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ZZ", taxId: "X0000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ZZ" } });
      await seedVenueSettings(tx, { province: "Northshire", city: "Villa Real" });
    });
    return f;
  }

  it("reads a holiday with no special date as its facts beside the standard hours", async () => {
    const f = await placed();
    const days = await withTransaction(db, (tx) =>
      store
        .readHolidayFacts(tx, "2026-12-24", "2026-12-26")
        .then((facts) => calendarDays(tx, rangeDates("2026-12-24", "2026-12-26"), facts))
        .then(({ days }) => days),
    );
    expect(days[1]).toEqual({
      date: "2026-12-25",
      specialDay: null,
      holidays: [
        {
          id: "shipped:feast",
          date: "2026-12-25",
          name: "National label",
          scope: "national",
          sourceId: "ZZ-ANNEX",
        },
        {
          id: "shipped:north",
          date: "2026-12-25",
          name: "Regional label",
          scope: "regional",
          sourceId: "ZZ-ANNEX",
        },
      ],
      tone: "public_holiday",
      closed: false,
    });
    expect([days[0]!.holidays, days[2]!.holidays]).toEqual([[], []]);
    expect(await dateSnapshot(f, f.restaurant, "2026-12-25")).toMatchObject({
      closeWholeVenue: false,
      specialDateId: null,
      state: { isDefault: false },
    });
  });

  it("gives the calendar a fact the provider repeats only once", async () => {
    await placed();
    const repeating = createHolidayStore((country) => (country === "ZZ" ? pack(true) : undefined));
    const days = await withTransaction(db, (tx) =>
      repeating
        .readHolidayFacts(tx, "2026-12-25", "2026-12-25")
        .then((facts) => calendarDays(tx, ["2026-12-25"], facts))
        .then(({ days }) => days),
    );
    expect(days[0]!.holidays.map(({ id }) => id)).toEqual(["shipped:feast", "shipped:north"]);
  });

  it("keeps a holiday's facts while a special date there is saved, renamed, moved and deleted", async () => {
    await placed();
    const calendar = () =>
      withTransaction(db, (tx) =>
        store
          .readHolidayFacts(tx, "2026-12-24", "2026-12-25")
          .then((facts) => calendarDays(tx, rangeDates("2026-12-24", "2026-12-25"), facts))
          .then(({ days }) => days),
      );
    const before = await calendar();
    const added = await saveDay(null, "Ours", ["2026-12-25"]);
    expect((await calendar())[1]).toEqual({
      ...before[1],
      specialDay: { id: added.id, name: "Ours" },
      tone: "public_holiday",
    });
    await saveDay(added.id, "Renamed", ["2026-12-25"]);
    expect((await calendar())[1]!.holidays).toEqual(before[1]!.holidays);
    await saveDay(added.id, "Renamed", ["2026-12-24"]);
    const moved = await calendar();
    expect(moved.map(({ specialDay }) => specialDay?.id ?? null)).toEqual([added.id, null]);
    expect(moved.map(({ holidays }) => holidays)).toEqual(before.map(({ holidays }) => holidays));
    await withTransaction(db, (tx) => deleteSpecialDay(tx, added.id, AT, 1));
    expect(await calendar()).toEqual(before);
  });
});

describe("Hours on a real Spanish public holiday", () => {
  // Monday 12 October 2026 is Spain's national day; Monday 5 October is an ordinary Monday.
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";

  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await withTransaction(db, (tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  async function seville(): Promise<Fixture> {
    const f = await fixture();
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "X0000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
    });
    return f;
  }

  it("shows holiday facts without changing station states", async () => {
    const f = await seville();
    const days = await withTransaction(db, (tx) =>
      installedReadHolidayFacts(tx, HOLIDAY, HOLIDAY)
        .then((facts) => calendarDays(tx, [HOLIDAY], facts))
        .then(({ days }) => days),
    );
    expect(days).toEqual([
      {
        date: HOLIDAY,
        specialDay: null,
        holidays: [expect.objectContaining({ date: HOLIDAY, scope: "national" })],
        tone: "public_holiday",
        closed: false,
      },
    ]);
    for (const subject of [f.restaurant, f.bar, f.kitchen]) {
      const holiday = await dateSnapshot(f, subject, HOLIDAY);
      expect({ ...holiday, openingDate: ORDINARY }).toEqual(
        await dateSnapshot(f, subject, ORDINARY),
      );
    }
    expect(await storedDates()).toEqual({ days: [], dates: [] });
  });
});

describe("special-day station occurrences", () => {
  /** A special day "Navidad" closed all day, written straight to its tables. */
  async function closure({ date = "2026-12-25", repeats = true } = {}) {
    return withTransaction(db, async (tx) => {
      const [day] = await tx
        .insert(specialDays)
        .values({ name: "Navidad", repeatsYearly: repeats })
        .returning({ id: specialDays.id });
      await tx.insert(specialDayDates).values({ specialDayId: day!.id, date, closedAllDay: true });
      return day!.id;
    });
  }

  const calendar = (from: LocalDate, to = from) =>
    withTransaction(db, (tx) =>
      calendarDays(tx, rangeDates(from, to), []).then(({ days }) => days),
    );

  it("closes the Calendar on each yearly occurrence without closing prep stations, adjacent dates or earlier years", async () => {
    const f = await fixture();
    const id = await closure();
    const days = await calendar("2027-12-20", "2027-12-31");
    expect(days.filter((day) => day.closed).map((day) => day.date)).toEqual(["2027-12-25"]);
    expect(days.find((day) => day.date === "2027-12-25")).toMatchObject({
      tone: "special_day",
      specialDay: { id, name: "Navidad" },
    });
    expect(
      (await calendar("2025-12-20", "2025-12-31")).every((day) => day.tone === "standard"),
    ).toBe(true);
    for (const at of ["2027-12-25T12:00:00Z", "2025-12-25T12:00:00Z"]) {
      const states = await withTransaction(db, (tx) => stationStates(tx, new Date(at)));
      for (const id of [f.bar.id, f.restaurant.id, f.kitchen.id])
        expect(states.get(id)?.open).toBe(true);
    }
  });

  it("applies a repeating leap-day Calendar closure only in leap years", async () => {
    await fixture();
    await closure({ date: "2024-02-29" });
    expect((await calendar("2027-02-28", "2027-03-01")).map((day) => day.tone)).toEqual([
      "standard",
      "standard",
    ]);
    expect((await calendar("2028-02-28", "2028-03-01")).map((day) => day.tone)).toEqual([
      "standard",
      "special_day",
      "standard",
    ]);
    expect((await calendar("2028-02-29"))[0]!.closed).toBe(true);
  });

  it("reports a recurring Calendar closure even when its first date is before the requested range", async () => {
    await fixture();
    const id = await closure();
    expect((await calendar("2027-12-25"))[0]).toMatchObject({
      date: "2027-12-25",
      tone: "special_day",
      closed: true,
      specialDay: { id, name: "Navidad" },
    });
  });

  it("does not report a repeating Calendar closure when no occurrence remains in the date range", async () => {
    await fixture();
    await closure({ date: "2024-02-29" });
    expect((await calendar("9999-01-01"))[0]).toMatchObject({
      date: "9999-01-01",
      tone: "standard",
      specialDay: null,
    });
  });

  it("does not report an expired one-off closure on a later Calendar date", async () => {
    await fixture();
    const id = await closure({ repeats: false });
    expect((await calendar("2027-01-01"))[0]).toMatchObject({
      date: "2027-01-01",
      tone: "standard",
      specialDay: null,
    });
    expect((await calendar("2027-12-25"))[0]).toMatchObject({ specialDay: null });
    expect((await calendar("2026-12-25"))[0]).toMatchObject({
      date: "2026-12-25",
      tone: "special_day",
      closed: true,
      specialDay: { id, name: "Navidad" },
    });
  });
});
