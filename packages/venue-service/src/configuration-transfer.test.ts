import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
  validateHolidayConfiguration,
  validateNamedDaysConfiguration,
  validateMenuTimetables,
  validateRoutingConfiguration,
} from "./configuration-transfer.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const RESTAURANT = "d-restaurant";
const DELI = "d-deli";
const KITCHEN = "k-kitchen"; // the default station
const BAR = "k-bar";
const CHRISTMAS = "sd-christmas";

function namedTables(): Tables {
  return {
    special_dates: [
      {
        id: "day",
        location_id: "venue",
        date: "2026-12-25",
        name: "Christmas",
        kind: "holiday",
        repeat_on: null,
        own_hours: 0,
        close_whole_venue: 0,
      },
    ],
  };
}

function refusal(field: string) {
  return expect.objectContaining({ code: "setup.request_invalid", params: { field } });
}

describe("named days in configuration transfer", () => {
  it.each([
    ["kind", "other", "special_dates"],
    ["kind", null, "special_dates"],
    ["repeat_on", "12-24", "special_dates.repeat_on"],
    ["repeat_on", true, "special_dates.repeat_on"],
    ["own_hours", true, "special_dates.own_hours"],
    ["own_hours", null, "special_dates.own_hours"],
  ])("refuses named-day %s=%s", (key, value, field) => {
    const tables = namedTables();
    tables.special_dates![0]![key as string] = value;
    expect(() => validateNamedDaysConfiguration(tables)).toThrowError(refusal(field as string));
  });

  it("refuses own hours combined with whole-venue closure", () => {
    const tables = namedTables();
    Object.assign(tables.special_dates![0]!, { own_hours: 1, close_whole_venue: 1 });
    expect(() => validateNamedDaysConfiguration(tables)).toThrowError(refusal("special_dates"));
  });

  it.each([
    "hours_week_cells",
    "hours_week_periods",
    "special_date_hours",
    "special_date_hours_periods",
  ])("validates named days independently of retired %s rows", (table) => {
    const tables = namedTables();
    tables.special_dates![0]!.repeat_on = "12-25";
    tables[table] = [
      { id: "retired", mode: "invalid", cell_id: "missing", special_date_id: "missing" },
    ];
    expect(() => validateNamedDaysConfiguration(tables)).not.toThrow();
  });

  it.each([
    ["2026-12-25", "12-25", "2027-12-25", null],
    ["2027-12-25", null, "2026-12-25", "12-25"],
    ["2026-12-25", "12-25", "2028-12-25", "12-25"],
  ])("refuses colliding occurrences %s/%s and %s/%s", (a, ar, b, br) => {
    const tables = namedTables();
    const row = tables.special_dates![0]!;
    Object.assign(row, { date: a, repeat_on: ar });
    tables.special_dates!.push({ ...row, id: "other", date: b, repeat_on: br });
    expect(() => validateNamedDaysConfiguration(tables)).toThrowError(
      refusal("special_dates.date"),
    );
  });

  it("accepts a one-off before the repeat begins and independent venues", () => {
    const tables = namedTables();
    const row = tables.special_dates![0]!;
    Object.assign(row, { date: "2027-12-25", repeat_on: "12-25", own_hours: 1 });
    tables.special_dates!.push({ ...row, id: "past", date: "2026-12-25", repeat_on: null });
    tables.special_dates!.push({ ...row, id: "elsewhere", location_id: "other" });
    expect(() => validateNamedDaysConfiguration(tables)).not.toThrow();
  });
});

describe("named-day fields in configuration transfer", () => {
  it.each<[string, (tables: Tables) => void, string]>([
    [
      "a date that does not exist",
      (t) => (t.special_dates![0]!.date = "2026-02-30"),
      "special_dates.date",
    ],
    [
      "two special dates on one date",
      (t) => t.special_dates!.push({ ...t.special_dates![0]!, id: "sd-copy" }),
      "special_dates.date",
    ],
    ["a blank name", (t) => (t.special_dates![0]!.name = "  "), "special_dates.name"],
    [
      "a kind outside the vocabulary",
      (t) => (t.special_dates![0]!.kind = "party"),
      "special_dates",
    ],
    [
      "a whole-venue flag other than 0 or 1",
      (t) => (t.special_dates![0]!.close_whole_venue = true),
      "special_dates.close_whole_venue",
    ],
  ])("refuses %s", (_, edit, field) => {
    const tables = namedTables();
    edit(tables);
    expect(() => validateNamedDaysConfiguration(tables)).toThrowError(refusal(field));
  });

  it("runs named-day validation through the transfer callback", () => {
    const tables = namedTables();
    tables.special_dates![0]!.date = "2026-02-30";
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).toThrowError(
      refusal("special_dates.date"),
    );
    tables.special_dates![0]!.date = "2026-12-25";
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).not.toThrow();
  });

  it("accepts a bundle without named days", () => {
    expect(() => validateNamedDaysConfiguration({})).not.toThrow();
  });
});

/** An invented country, so no expectation below depends on any real country's allowance. */
function holidayPack(localEntryLimit: number): CountryPack {
  return {
    countryCode: "ZZ",
    defaultLocale: "en-GB",
    defaultTimeZone: "Europe/Madrid",
    invoiceLocales: ["en-GB"],
    moduleIds: [],
    availableForVenueSetup: false,
    fiscalJurisdictions: [],
    administrativeAreas: [
      { code: "10", name: "Northshire", aliases: ["North"], postalPrefixes: [] },
      { code: "30", name: "Isleshire", postalPrefixes: [] },
    ],
    holidayCalendar: createHolidayCalendar({
      localEntryLimit,
      sources: [
        {
          id: "ZZ-ANNEX",
          title: "Invented annex",
          url: "https://example.test",
          sha256: "a".repeat(64),
        },
      ],
      provinceRegions: { "10": "R1", "30": "R3" },
      areas: [
        { key: "isle-a", name: "Isle A", provinces: ["30"] },
        { key: "isle-b", name: "Isle B", provinces: ["30"] },
      ],
      years: [
        {
          year: 2026,
          dataVersion: "ZZ-2026.1",
          sourceIds: ["ZZ-ANNEX"],
          rows: [
            {
              key: "isle-a-day",
              date: "2026-07-01",
              name: "Isle A day",
              scope: "regional",
              regions: ["R3"],
              onlyAreas: ["isle-a"],
              sourceId: "ZZ-ANNEX",
            },
          ],
        },
      ],
    }),
  };
}

const WITHOUT_CALENDAR: CountryPack = { ...holidayPack(0), countryCode: "ZY" };
delete (WITHOUT_CALENDAR as { holidayCalendar?: unknown }).holidayCalendar;

const packs = (limit: number) => (country: string) =>
  country === "ZZ" ? holidayPack(limit) : country === "ZY" ? WITHOUT_CALENDAR : undefined;

const NORTH = "g-north";
const ISLE = "g-isle";

/**
 * Two geographies of one venue, as an export carries them: the North one, and a retained Isle one
 * with its area chosen. Each has two entries in 2026 and one in 2027.
 */
function holidayTables(): Tables {
  return {
    holiday_geographies: [
      {
        id: NORTH,
        location_id: "location",
        country: "ZZ",
        province_code: "10",
        city: "Villa  Real",
        city_key: "villa real",
        area_key: null,
      },
      {
        id: ISLE,
        location_id: "location",
        country: "ZZ",
        province_code: "30",
        city: "Puerto Ísla",
        city_key: "puerto ísla",
        area_key: "isle-a",
      },
    ],
  };
}

describe("validateHolidayConfiguration", () => {
  it("accepts holiday area geographies and a bundle with no holiday tables", () => {
    expect(() => validateHolidayConfiguration(holidayTables(), packs(2))).not.toThrow();
    expect(() => validateHolidayConfiguration({}, packs(2))).not.toThrow();
  });

  it("accepts a geography with no entries whose country has no holiday capability", () => {
    const tables: Tables = {
      holiday_geographies: [{ ...holidayTables().holiday_geographies![0]!, country: "ZY" }],
    };
    expect(() => validateHolidayConfiguration(tables, packs(2))).not.toThrow();
  });

  it.each<[string, (tables: Tables) => void, string]>([
    [
      "a geography id used twice",
      (t) => (t.holiday_geographies![1]!.id = NORTH),
      "holiday_geographies.id",
    ],
    [
      "a country no installed pack knows",
      (t) => (t.holiday_geographies![0]!.country = "QQ"),
      "holiday_geographies.country",
    ],
    [
      "a country not spelled as its pack's code",
      (t) => (t.holiday_geographies![0]!.country = "zz"),
      "holiday_geographies.country",
    ],
    [
      "a province the pack does not list",
      (t) => (t.holiday_geographies![0]!.province_code = "99"),
      "holiday_geographies.province_code",
    ],
    [
      "a province given by name rather than code",
      (t) => (t.holiday_geographies![0]!.province_code = "Northshire"),
      "holiday_geographies.province_code",
    ],
    ["a blank city", (t) => (t.holiday_geographies![0]!.city = "  "), "holiday_geographies.city"],
    [
      "a city with the spaces around it the writer trims",
      (t) => (t.holiday_geographies![0]!.city = "  Villa  Real "),
      "holiday_geographies.city",
    ],
    [
      "a city key that is not the city's normalized form",
      (t) => (t.holiday_geographies![0]!.city_key = "Villa  Real"),
      "holiday_geographies.city_key",
    ],
    [
      "two geographies for one place",
      (t) => {
        t.holiday_geographies![1]!.province_code = "10";
        t.holiday_geographies![1]!.city = "VILLA REAL";
        t.holiday_geographies![1]!.city_key = "villa real";
        t.holiday_geographies![1]!.area_key = null;
      },
      "holiday_geographies.city_key",
    ],
    [
      "an area nobody sourced for its province",
      (t) => (t.holiday_geographies![1]!.area_key = "isle-z"),
      "holiday_geographies.area_key",
    ],
    [
      "an area on a province that has none",
      (t) => (t.holiday_geographies![0]!.area_key = "isle-a"),
      "holiday_geographies.area_key",
    ],
    [
      "an area of a country with no holiday capability",
      (t) => {
        t.holiday_geographies![1]!.country = "ZY";
      },
      "holiday_geographies.area_key",
    ],
  ])("refuses %s", (_, edit, field) => {
    const tables = holidayTables();
    edit(tables);
    expect(() => validateHolidayConfiguration(tables, packs(2))).toThrowError(refusal(field));
  });

  it("accepts a city of any length, as setup stores one and the writer copies it", () => {
    const tables = holidayTables();
    tables.holiday_geographies![0]!.city = "V".repeat(5000);
    tables.holiday_geographies![0]!.city_key = "v".repeat(5000);
    expect(() => validateHolidayConfiguration(tables, packs(2))).not.toThrow();
  });

  it("is run by the venue-service transfer's validate callback, beside the named-day check", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    const both = { ...namedTables(), ...holidayTables() };
    // The installed packs know no country ZZ.
    expect(() => validate(both)).toThrowError(refusal("holiday_geographies.country"));
    for (const row of both.holiday_geographies!) row.country = "ES";
    both.holiday_geographies![0]!.province_code = "41";
    both.holiday_geographies![1]!.province_code = "25";
    both.holiday_geographies![1]!.area_key = "aran";
    expect(() => validate(both)).not.toThrow();
  });

  it("declares holiday geographies and excludes the retired local entries", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names.slice(-2)).toEqual(["zone_closed_times", "holiday_geographies"]);
    expect(names).not.toContain("local_holidays");
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.at(-1)).toEqual({
      name: "holiday_geographies",
      locationColumns: ["location_id"],
    });
  });
});

describe("the menu timetable rows of a bundle", () => {
  it.each([null, "15", 1.5, NaN, Infinity, -1440, 1440])(
    "refuses malformed imported end offset %s at its own column",
    (endOffsetMinutes) => {
      const tables = menuTables();
      tables.menu_periods![0]!.end_offset_minutes = endOffsetMinutes;
      expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
        refusal("menu_periods.end_offset_minutes"),
      );
    },
  );
  it.each([-15, 0, 14, undefined])("accepts scalar imported end offset %s", (offset) => {
    const tables = menuTables();
    if (offset !== undefined) tables.menu_periods![0]!.end_offset_minutes = offset;
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).not.toThrow();
  });

  it("refuses imported grace reaching the next business day's period", () => {
    const tables = menuTables();
    tables.menu_periods![1]!.end_offset_minutes = 240;
    tables.menu_day_timetables!.push({
      id: "t-saturday",
      department_id: RESTAURANT,
      weekday: 6,
      special_date_id: null,
    });
    tables.menu_slots!.push(slotRow("t-saturday", MANANAS, "06:00:00", "09:00:00"));
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
      refusal("menu_slots"),
    );
    tables.menu_periods![1]!.end_offset_minutes = 239;
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).not.toThrow();
  });

  const BARRA = "z-barra";
  const MANANAS = "11111111-1111-4111-8111-111111111111";
  const MADRUGADA = "22222222-2222-4222-8222-222222222222";
  const DELI_PERIOD = "33333333-3333-4333-8333-333333333333";
  const dateRow = (id: string, date: string, closeWholeVenue = 0) => ({
    id,
    location_id: "location",
    date,
    name: "Fiesta",
    colour: "red",
    close_whole_venue: closeWholeVenue,
  });
  const slotRow = (timetableId: string, periodId: string, startsAt: string, endsAt: string) => ({
    id: randomUUID(),
    timetable_id: timetableId,
    department_id: RESTAURANT,
    period_id: periodId,
    starts_at: startsAt,
    ends_at: endsAt,
  });

  /**
   * The restaurant's Mañanas (Desayunos) runs 09:00–12:00 on Monday and Madrugada (Copas)
   * 22:00–02:00 on Friday; on Christmas, a Friday, Mañanas alone runs 10:00–13:00. Barra serves
   * Café is a staff menu in Mañanas. Deli has a period of its own.
   */
  function menuTables(): Tables {
    return {
      departments: [
        { id: RESTAURANT, is_default: 1 },
        { id: DELI, is_default: 0 },
      ],
      special_dates: [dateRow(CHRISTMAS, "2026-12-25")],
      zone_service_policies: [{ zone_id: BARRA, department_id: RESTAURANT }],
      catalogues: [{ id: "m-desayunos" }, { id: "m-copas" }, { id: "m-cafe" }, { id: "m-deli" }],
      menu_periods: [
        {
          id: MANANAS,
          department_id: RESTAURANT,
          name: "Mañanas",
          colour: "blue",
          menu_id: "m-desayunos",
        },
        {
          id: MADRUGADA,
          department_id: RESTAURANT,
          name: "Madrugada",
          colour: "red",
          menu_id: "m-copas",
        },
        {
          id: DELI_PERIOD,
          department_id: DELI,
          name: "Mañanas",
          colour: "blue",
          menu_id: "m-deli",
        },
      ],
      menu_day_timetables: [
        { id: "t-monday", department_id: RESTAURANT, weekday: 1, special_date_id: null },
        { id: "t-friday", department_id: RESTAURANT, weekday: 5, special_date_id: null },
        { id: "t-christmas", department_id: RESTAURANT, weekday: null, special_date_id: CHRISTMAS },
      ],
      menu_slots: [
        slotRow("t-monday", MANANAS, "09:00:00", "12:00:00"),
        slotRow("t-friday", MADRUGADA, "22:00:00", "02:00:00"),
        slotRow("t-christmas", MANANAS, "10:00:00", "13:00:00"),
      ],
      menu_period_staff_menus: [
        { period_id: MANANAS, department_id: RESTAURANT, menu_id: "m-cafe", display_order: 0 },
      ],
    };
  }
  const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
  const madrid = (createdAt: string) => ({
    createdAt: new Date(createdAt),
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  });

  it("are transferred after special dates, with staff rows after their periods", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    const at = names.indexOf("special_dates");
    expect(names.slice(at + 1, at + 5)).toEqual([
      "menu_periods",
      "menu_period_staff_menus",
      "menu_day_timetables",
      "menu_slots",
    ]);
    expect(at).toBeGreaterThan(names.indexOf("zone_sale_policies"));
  });

  it("accept rows a writer could have written, and a bundle with none", () => {
    expect(() =>
      validateMenuTimetables(menuTables(), madrid("2026-10-07T10:00:00Z")),
    ).not.toThrow();
    expect(() => validateMenuTimetables({})).not.toThrow();
    expect(() => validate(menuTables(), madrid("2026-10-07T10:00:00Z"))).not.toThrow();
  });

  it.each([
    [
      "a period of a department the bundle lacks",
      (t: Tables) => {
        t.menu_periods![0]!.department_id = "d-gone";
      },
      "menu_periods.department_id",
    ],
    [
      "a blank period name",
      (t: Tables) => {
        t.menu_periods![0]!.name = "  ";
      },
      "menu_periods.name",
    ],
    [
      "an untrimmed period name",
      (t: Tables) => {
        t.menu_periods![0]!.name = "Mañanas ";
      },
      "menu_periods.name",
    ],
    [
      "a period name its department uses twice",
      (t: Tables) => {
        t.menu_periods![1]!.name = "Mañanas";
      },
      "menu_periods.name",
    ],
    [
      "a period menu the bundle does not hold",
      (t: Tables) => {
        t.menu_periods![0]!.menu_id = "m-gone";
      },
      "menu_periods.menu_id",
    ],
    [
      "a day of a department the bundle lacks",
      (t: Tables) => {
        t.menu_day_timetables![0]!.department_id = "d-gone";
      },
      "menu_day_timetables.department_id",
    ],
    [
      "a day that is both a weekday and a special date",
      (t: Tables) => {
        t.menu_day_timetables![0]!.special_date_id = CHRISTMAS;
      },
      "menu_day_timetables.weekday",
    ],
    [
      "a day that is neither",
      (t: Tables) => {
        t.menu_day_timetables![0]!.weekday = null;
      },
      "menu_day_timetables.weekday",
    ],
    [
      "a weekday outside the week",
      (t: Tables) => {
        t.menu_day_timetables![0]!.weekday = 7;
      },
      "menu_day_timetables.weekday",
    ],
    [
      "a special date the bundle lacks",
      (t: Tables) => {
        t.menu_day_timetables![2]!.special_date_id = "sd-gone";
      },
      "menu_day_timetables.special_date_id",
    ],
    [
      "a weekday held twice",
      (t: Tables) => {
        t.menu_day_timetables![1]!.weekday = 1;
      },
      "menu_day_timetables.weekday",
    ],
    [
      "a special date held twice by one department",
      (t: Tables) => {
        t.menu_day_timetables!.push({
          id: "t-again",
          department_id: RESTAURANT,
          weekday: null,
          special_date_id: CHRISTMAS,
        });
      },
      "menu_day_timetables.special_date_id",
    ],
    [
      "a slot of a day the bundle lacks",
      (t: Tables) => {
        t.menu_slots![0]!.timetable_id = "t-gone";
      },
      "menu_slots.timetable_id",
    ],
    [
      "a slot filed under another department than its day's",
      (t: Tables) => {
        t.menu_slots![0]!.department_id = DELI;
      },
      "menu_slots.department_id",
    ],
    [
      "a slot placing another department's period",
      (t: Tables) => {
        t.menu_slots![0]!.period_id = DELI_PERIOD;
      },
      "menu_slots.period_id",
    ],
    [
      "a slot time that is not canonical",
      (t: Tables) => {
        t.menu_slots![0]!.starts_at = "09:00";
      },
      "menu_slots.starts_at",
    ],
    [
      "a slot ending where it starts",
      (t: Tables) => {
        t.menu_slots![0]!.ends_at = "09:00:00";
      },
      "menu_slots",
    ],
    [
      "two slots overlapping within a day",
      (t: Tables) => {
        t.menu_slots!.push(slotRow("t-monday", MADRUGADA, "11:00:00", "13:00:00"));
      },
      "menu_slots",
    ],
    [
      "a week range crossing the business-day boundary",
      (t: Tables) => {
        t.menu_day_timetables!.push({
          id: "t-saturday",
          department_id: RESTAURANT,
          weekday: 6,
          special_date_id: null,
        });
        t.menu_slots!.push(slotRow("t-saturday", MANANAS, "01:00:00", "07:00:00"));
      },
      "menu_slots",
    ],
    [
      "a special-date range crossing the business-day boundary",
      (t: Tables) => {
        t.special_dates!.push(dateRow("sd-boxing", "2026-12-26"));
        t.menu_day_timetables!.push({
          id: "t-boxing",
          department_id: RESTAURANT,
          weekday: null,
          special_date_id: "sd-boxing",
        });
        t.menu_slots!.push(slotRow("t-boxing", MANANAS, "01:00:00", "07:00:00"));
        t.special_dates!.push(dateRow("sd-18", "2026-12-19"));
        t.menu_day_timetables!.push({
          id: "t-18",
          department_id: RESTAURANT,
          weekday: null,
          special_date_id: "sd-18",
        });
        t.menu_slots!.push(slotRow("t-18", MANANAS, "01:00:00", "03:00:00"));
      },
      "menu_slots",
    ],
    [
      "a staff menu filed under another department than its period's",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.department_id = DELI;
      },
      "menu_period_staff_menus.department_id",
    ],
    [
      "a staff menu naming a missing period",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.period_id = "gone";
      },
      "menu_period_staff_menus.period_id",
    ],
    [
      "a staff menu the bundle does not hold",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.menu_id = "m-gone";
      },
      "menu_period_staff_menus.menu_id",
    ],
  ])("refuse %s", (_, edit, field) => {
    const tables = menuTables();
    edit(tables);
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
      refusal(field),
    );
  });

  it("refuse a special-date slot at a skipped quarter-hour, including a past date", () => {
    const forward = clockChangeAfter("Europe/Madrid", "2027-01-01T00:00:00Z", "forward");
    const tables = menuTables();
    tables.special_dates!.push(
      dateRow(
        "sd-march",
        new Date(new Date(`${forward.date}T12:00:00Z`).getTime() - 86400000)
          .toISOString()
          .slice(0, 10),
      ),
    );
    tables.menu_day_timetables!.push({
      id: "t-march",
      department_id: RESTAURANT,
      weekday: null,
      special_date_id: "sd-march",
    });
    tables.menu_slots!.push(
      slotRow("t-march", MANANAS, `${minutesAfter(forward.after, -30)}:00`, "05:00:00"),
    );
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
      refusal("menu_slots.starts_at"),
    );
    tables.menu_slots!.at(-1)!.starts_at = "21:00:00";
    tables.menu_slots!.at(-1)!.ends_at = `${minutesAfter(forward.after, -30)}:00`;
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
      refusal("menu_slots.ends_at"),
    );
    expect(() => validateMenuTimetables(tables, madrid("2027-06-01T10:00:00Z"))).toThrowError(
      refusal("menu_slots.ends_at"),
    );
    expect(() =>
      validateMenuTimetables(tables, { ...madrid("2026-10-07T10:00:00Z"), timeZone: "Unreadable" }),
    ).not.toThrow();
  });

  it("refuses a business-day boundary crossing even for a past special date or closure", () => {
    const tables = menuTables();
    tables.special_dates!.push(dateRow("sd-boxing", "2026-12-26", 1));
    tables.menu_day_timetables!.push({
      id: "t-boxing",
      department_id: RESTAURANT,
      weekday: null,
      special_date_id: "sd-boxing",
    });
    tables.menu_slots!.push(slotRow("t-boxing", MANANAS, "01:00:00", "07:00:00"));
    tables.menu_day_timetables = tables.menu_day_timetables!.filter(
      (row) => row.id !== "t-christmas",
    );
    tables.menu_slots = tables.menu_slots!.filter((row) => row.timetable_id !== "t-christmas");
    expect(() => validateMenuTimetables(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
      refusal("menu_slots"),
    );
    expect(() => validateMenuTimetables(tables, madrid("2027-01-10T10:00:00Z"))).toThrowError(
      refusal("menu_slots"),
    );
  });
});

describe("department transfer settings in a configuration bundle", () => {
  const valid = (): Tables => ({
    departments: [{ id: RESTAURANT }, { id: DELI }],
    device_profiles: [{ id: "receiving-profile" }],
    department_transfer_desks: [
      { department_id: RESTAURANT, receiving_profile_id: "receiving-profile" },
    ],
    department_transfer_destinations: [
      { source_department_id: DELI, destination_department_id: RESTAURANT },
    ],
  });
  it("accepts retained directional settings and a bundle without transfer settings", () => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(valid())).not.toThrow();
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({})).not.toThrow();
  });
  it.each([
    ["department_transfer_desks", "department_id", "missing"],
    ["department_transfer_desks", "receiving_profile_id", "missing"],
    ["department_transfer_destinations", "source_department_id", "missing"],
    ["department_transfer_destinations", "destination_department_id", "missing"],
    ["department_transfer_destinations", "destination_department_id", DELI],
  ])("refuses an invalid %s.%s", (table, column, value) => {
    const tables = valid();
    tables[table!]![0]![column!] = value;
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).toThrowError(
      refusal(`${table}.${column}`),
    );
  });
  it.each(["department_transfer_desks", "department_transfer_destinations"])(
    "refuses duplicate %s rows",
    (table) => {
      const tables = valid();
      tables[table]!.push({ ...tables[table]![0]! });
      expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).toThrowError(
        refusal(table),
      );
    },
  );
});

describe("validateRoutingConfiguration", () => {
  const TERRACE = "z-terrace";
  const INSIDE = "z-inside"; // in the deli, which is switched off
  const CLOSED_ZONE = "z-closed";
  const BARE_ZONE = "z-bare"; // no service configuration
  const DRINKS = "c-drinks";
  const MOJITO = "p-mojito";
  const LARGE = "p-mojito-large"; // a variant of the mojito
  const OFF = "k-off"; // a disabled station

  type CellSpec = {
    category?: string | null;
    product?: string | null;
    zone?: string | null;
    station?: string | null;
    noPrep?: unknown;
    noCategory?: unknown;
  };
  const cell = (spec: CellSpec) => {
    const { category = null, product = null, zone = null, station = null, noCategory = 0 } = spec;
    return {
      id: randomUUID(),
      location_id: "location",
      category_id: category,
      product_id: product,
      zone_id: zone,
      station_id: station,
      no_preparation: "noPrep" in spec ? spec.noPrep : station === null ? 1 : 0,
      no_category: noCategory,
    };
  };

  /** One cell of each of the seven classes, an explicit No preparation and a disabled station. */
  function routingTables(): Tables {
    return {
      departments: [
        { id: RESTAURANT, name: "Restaurant", active: 1 },
        { id: DELI, name: "Deli", active: 0 },
      ],
      floor_zones: [
        { id: TERRACE, name: "Terrace", active: 1 },
        { id: INSIDE, name: "Inside", active: 1 },
        { id: CLOSED_ZONE, name: "Closed", active: 0 },
        { id: BARE_ZONE, name: "Bare", active: 1 },
      ],
      zone_service_policies: [
        { zone_id: TERRACE, department_id: RESTAURANT },
        { zone_id: INSIDE, department_id: DELI },
        { zone_id: CLOSED_ZONE, department_id: RESTAURANT },
      ],
      kitchen_stations: [
        { id: KITCHEN, is_default: 1, active: 1 },
        { id: BAR, is_default: 0, active: 1 },
        { id: OFF, is_default: 0, active: 0 },
      ],
      categories: [{ id: DRINKS, name: "Drinks" }],
      products: [
        { id: MOJITO, name: "Mojito", parent_id: null },
        { id: LARGE, name: "Large", parent_id: MOJITO },
      ],
      routing_cells: [
        cell({ category: DRINKS, station: BAR }),
        cell({ category: DRINKS, zone: TERRACE }),
        cell({ product: MOJITO, station: OFF }),
        cell({ product: MOJITO, zone: TERRACE, station: KITCHEN }),
        cell({ zone: TERRACE, station: BAR }),
        cell({ noCategory: 1 }),
        cell({ noCategory: 1, zone: TERRACE, station: BAR }),
      ],
    };
  }

  function refusedFor(spec: CellSpec, field: string) {
    const tables = routingTables();
    tables.routing_cells!.push(cell(spec));
    expect(() => validateRoutingConfiguration(tables)).toThrowError(refusal(field));
  }

  it("accepts all seven classes, explicit No preparation and a retained disabled-station target", () => {
    expect(() => validateRoutingConfiguration(routingTables())).not.toThrow();
    expect(() => validateRoutingConfiguration({})).not.toThrow();
  });

  describe("a cell for a zone whose department is switched off", () => {
    const inside = {
      zoneId: INSIDE,
      zoneName: "Inside",
      departmentId: DELI,
      departmentName: "Deli",
    };
    const refusalFor = (spec: CellSpec, tables = routingTables()) => {
      tables.routing_cells!.push(cell(spec));
      try {
        validateRoutingConfiguration(tables);
      } catch (error) {
        return error;
      }
      throw new Error("the bundle was accepted");
    };

    it.each([
      ["a category", { category: DRINKS }, { row: "category", name: "Drinks" }],
      ["a product", { product: MOJITO }, { row: "product", name: "Mojito" }],
      ["a No category", { noCategory: 1 }, { row: "no_category" }],
      ["an All categories", {}, { row: "all" }],
    ])("refuses %s row with the routing grid's code, naming the choice", (_, spec, row) => {
      const error = refusalFor({ ...spec, zone: INSIDE, station: KITCHEN });
      expect(error).toMatchObject({ code: "service_zone.not_found" });
      expect((error as { params: unknown }).params).toEqual({ ...inside, ...row });
    });

    it.each([
      ["no zone or department name", undefined, undefined],
      ["empty zone and department names", "", ""],
      ["a non-text zone and department name", 7, null],
    ])("leaves out a name the bundle does not hold as text (%s)", (_, zoneName, departmentName) => {
      const tables = routingTables();
      const zone = tables.floor_zones!.find((row) => row.id === INSIDE)!;
      const department = tables.departments!.find((row) => row.id === DELI)!;
      if (zoneName === undefined) delete zone.name;
      else zone.name = zoneName;
      if (departmentName === undefined) delete department.name;
      else department.name = departmentName;
      delete tables.categories![0]!.name;
      const refusal = refusalFor({ category: DRINKS, zone: INSIDE, station: KITCHEN }, tables);
      expect(refusal).toMatchObject({ code: "service_zone.not_found" });
      expect((refusal as { params: unknown }).params).toEqual({
        zoneId: INSIDE,
        departmentId: DELI,
        row: "category",
      });
    });

    it("leaves out a product name the bundle does not hold", () => {
      const tables = routingTables();
      delete tables.products!.find((row) => row.id === MOJITO)!.name;
      const error = refusalFor({ product: MOJITO, zone: INSIDE, station: KITCHEN }, tables);
      expect((error as { params: unknown }).params).toEqual({ ...inside, row: "product" });
    });

    it("accepts the same cells once the department is switched on", () => {
      const tables = routingTables();
      tables.departments!.find((row) => row.id === DELI)!.active = 1;
      tables.routing_cells!.push(
        cell({ category: DRINKS, zone: INSIDE, station: KITCHEN }),
        cell({ product: MOJITO, zone: INSIDE, station: KITCHEN }),
        cell({ noCategory: 1, zone: INSIDE, station: KITCHEN }),
        cell({ zone: INSIDE, station: KITCHEN }),
      );
      expect(() => validateRoutingConfiguration(tables)).not.toThrow();
    });

    it.each([true, "1", 2, null])(
      "refuses a department flag of %j rather than guessing how storage keeps it",
      (active) => {
        const tables = routingTables();
        tables.departments!.find((row) => row.id === DELI)!.active = active;
        tables.routing_cells!.push(cell({ category: DRINKS, zone: INSIDE, station: KITCHEN }));
        expect(() => validateRoutingConfiguration(tables)).toThrowError(
          refusal("departments.active"),
        );
      },
    );

    it("reads a department row without the flag as switched on, as storage does", () => {
      const tables = routingTables();
      delete tables.departments!.find((row) => row.id === DELI)!.active;
      tables.routing_cells!.push(cell({ category: DRINKS, zone: INSIDE, station: KITCHEN }));
      expect(() => validateRoutingConfiguration(tables)).not.toThrow();
    });

    it("never refuses an Every zone cell for a switched-off department", () => {
      const tables = routingTables();
      tables.departments!.forEach((row) => (row.active = 0));
      tables.routing_cells = tables.routing_cells!.filter((row) => row.zone_id === null);
      expect(tables.routing_cells).toHaveLength(3);
      expect(() => validateRoutingConfiguration(tables)).not.toThrow();
    });
  });

  it("refuses a row naming both a category and a product", () => {
    refusedFor(
      { category: DRINKS, product: MOJITO, zone: INSIDE, station: BAR },
      "routing_cells.category_id",
    );
  });

  it("refuses the implicit All categories × Every zone cell", () => {
    refusedFor({ station: BAR }, "routing_cells.zone_id");
    refusedFor({}, "routing_cells.zone_id");
  });

  it("refuses a row with no target, both targets, or a No preparation value that is not 0 or 1", () => {
    refusedFor({ category: DRINKS, zone: INSIDE, noPrep: 0 }, "routing_cells.station_id");
    refusedFor(
      { category: DRINKS, zone: INSIDE, station: BAR, noPrep: 1 },
      "routing_cells.station_id",
    );
    refusedFor({ category: DRINKS, zone: INSIDE, noPrep: true }, "routing_cells.no_preparation");
    refusedFor({ category: DRINKS, zone: INSIDE, noPrep: null }, "routing_cells.no_preparation");
  });

  it("refuses a second cell at a coordinate of each of the five classes", () => {
    refusedFor({ category: DRINKS, station: KITCHEN }, "routing_cells.category_id");
    refusedFor({ category: DRINKS, zone: TERRACE, station: BAR }, "routing_cells.category_id");
    refusedFor({ product: MOJITO }, "routing_cells.product_id");
    refusedFor({ product: MOJITO, zone: TERRACE }, "routing_cells.product_id");
    refusedFor({ zone: TERRACE }, "routing_cells.zone_id");
  });

  it("refuses a No category flag that is not 0 or 1, including a row without one", () => {
    refusedFor({ noCategory: 2, zone: INSIDE, station: BAR }, "routing_cells.no_category");
    refusedFor({ noCategory: true, zone: INSIDE, station: BAR }, "routing_cells.no_category");
    refusedFor({ noCategory: null, zone: INSIDE, station: BAR }, "routing_cells.no_category");
    const tables = routingTables();
    const withoutFlag: Record<string, unknown> = cell({ category: DRINKS, zone: INSIDE });
    delete withoutFlag.no_category;
    tables.routing_cells!.push(withoutFlag);
    expect(() => validateRoutingConfiguration(tables)).toThrowError(
      refusal("routing_cells.no_category"),
    );
  });

  it("refuses a No category row that also names a category or a product", () => {
    refusedFor({ noCategory: 1, category: DRINKS, zone: INSIDE }, "routing_cells.no_category");
    refusedFor({ noCategory: 1, product: MOJITO, zone: INSIDE }, "routing_cells.no_category");
  });

  it("refuses a second No category cell at Every zone or at a zone", () => {
    refusedFor({ noCategory: 1, station: KITCHEN }, "routing_cells.no_category");
    refusedFor({ noCategory: 1, zone: TERRACE }, "routing_cells.no_category");
  });

  it("checks a No category cell's zone and station like any row's", () => {
    refusedFor({ noCategory: 1, zone: CLOSED_ZONE, station: BAR }, "routing_cells.zone_id");
    refusedFor({ noCategory: 1, zone: "z-missing", station: BAR }, "routing_cells.zone_id");
    refusedFor({ noCategory: 1, zone: INSIDE, station: "k-missing" }, "routing_cells.station_id");
    refusedFor({ noCategory: 1, zone: INSIDE, noPrep: 0 }, "routing_cells.station_id");
  });

  it("refuses a product the bundle does not hold, and a variant", () => {
    refusedFor({ product: "p-missing", station: BAR }, "routing_cells.product_id");
    refusedFor({ product: LARGE, station: BAR }, "routing_cells.product_id");
    refusedFor({ product: LARGE, zone: INSIDE, station: BAR }, "routing_cells.product_id");
  });

  it("refuses a category the bundle does not hold", () => {
    refusedFor({ category: "c-missing", station: BAR }, "routing_cells.category_id");
  });

  it("refuses a zone the bundle does not hold, a switched-off zone, and a zone with no service configuration", () => {
    refusedFor({ category: DRINKS, zone: "z-missing", station: BAR }, "routing_cells.zone_id");
    refusedFor({ category: DRINKS, zone: CLOSED_ZONE, station: BAR }, "routing_cells.zone_id");
    refusedFor({ category: DRINKS, zone: BARE_ZONE, station: BAR }, "routing_cells.zone_id");
  });

  it.each([true, "1", 2, null])(
    "refuses a zone flag of %j rather than guessing how storage keeps it",
    (active) => {
      const tables = routingTables();
      tables.floor_zones!.find((row) => row.id === TERRACE)!.active = active;
      expect(() => validateRoutingConfiguration(tables)).toThrowError(
        refusal("floor_zones.active"),
      );
    },
  );

  it("reads a zone row without the flag as switched on, as storage does", () => {
    const tables = routingTables();
    delete tables.floor_zones!.find((row) => row.id === TERRACE)!.active;
    expect(() => validateRoutingConfiguration(tables)).not.toThrow();
  });

  it("refuses a station the bundle does not hold", () => {
    refusedFor(
      { category: DRINKS, zone: INSIDE, station: "k-missing" },
      "routing_cells.station_id",
    );
  });

  describe("a cell's period choices", () => {
    const LUNCH = "mp-lunch"; // the restaurant's
    const BREAKFAST = "mp-breakfast"; // the deli's

    type ChoiceSpec = {
      cell?: string;
      period?: string;
      department?: string;
      station?: string | null;
      noPrep?: unknown;
    };
    /** The routing tables plus a Terrace cell and an Every zone cell, and one period each side. */
    function periodTables() {
      const tables = routingTables();
      tables.menu_periods = [
        { id: LUNCH, department_id: RESTAURANT, name: "Lunch", menu_id: "m-empty" },
        { id: BREAKFAST, department_id: DELI, name: "Breakfast", menu_id: "m-empty" },
      ];
      const terrace = tables.routing_cells!.find(
        (row) => row.category_id === DRINKS && row.zone_id === TERRACE,
      )!.id as string;
      const everyZone = tables.routing_cells!.find(
        (row) => row.product_id === MOJITO && row.zone_id === null,
      )!.id as string;
      const choice = (spec: ChoiceSpec = {}) => {
        const station = "station" in spec ? spec.station : BAR;
        return {
          id: randomUUID(),
          cell_id: spec.cell ?? terrace,
          period_id: spec.period ?? LUNCH,
          department_id: spec.department ?? RESTAURANT,
          station_id: station,
          no_preparation: "noPrep" in spec ? spec.noPrep : station === null ? 1 : 0,
        };
      };
      tables.routing_cell_periods = [];
      return { tables, terrace, everyZone, choice };
    }

    function choiceRefused(spec: ChoiceSpec, field: string) {
      const { tables, choice } = periodTables();
      tables.routing_cell_periods!.push(choice(spec));
      expect(() => validateRoutingConfiguration(tables)).toThrowError(refusal(field));
    }

    it("accepts a zone cell's own-department period, any department's on an Every zone cell, No preparation and a disabled station", () => {
      const { tables, everyZone, choice } = periodTables();
      tables.routing_cell_periods!.push(
        choice(),
        choice({ cell: everyZone, station: null }),
        choice({ cell: everyZone, period: BREAKFAST, department: DELI, station: OFF }),
      );
      expect(() => validateRoutingConfiguration(tables)).not.toThrow();
    });

    it("refuses a choice whose cell the bundle does not hold", () => {
      choiceRefused({ cell: randomUUID() }, "routing_cell_periods.cell_id");
    });

    it("refuses a zone cell's choice naming another department's period", () => {
      choiceRefused({ period: BREAKFAST, department: DELI }, "routing_cell_periods.period_id");
    });

    it("refuses a period the bundle does not hold, and a department that is not the period's", () => {
      choiceRefused({ period: "mp-missing" }, "routing_cell_periods.period_id");
      choiceRefused({ department: DELI }, "routing_cell_periods.department_id");
    });

    it("refuses a second choice for one cell and period", () => {
      const { tables, choice } = periodTables();
      tables.routing_cell_periods!.push(choice(), choice({ station: null }));
      expect(() => validateRoutingConfiguration(tables)).toThrowError(
        refusal("routing_cell_periods.period_id"),
      );
    });

    it("refuses a station the bundle does not hold", () => {
      choiceRefused({ station: "k-missing" }, "routing_cell_periods.station_id");
    });

    it("refuses a choice with no target, both targets, or a No preparation value that is not 0 or 1", () => {
      choiceRefused({ station: null, noPrep: 0 }, "routing_cell_periods.station_id");
      choiceRefused({ station: BAR, noPrep: 1 }, "routing_cell_periods.station_id");
      choiceRefused({ noPrep: true }, "routing_cell_periods.no_preparation");
      choiceRefused({ noPrep: null }, "routing_cell_periods.no_preparation");
    });
  });

  it("is run by the venue-service transfer's validate callback", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    const tables = routingTables();
    tables.departments!.find((row) => row.id === DELI)!.active = 1;
    expect(() => validate(tables)).not.toThrow();
    tables.routing_cells!.push(cell({ product: LARGE, station: BAR }));
    expect(() => validate(tables)).toThrowError(refusal("routing_cells.product_id"));
  });
});

describe("a switched-on zone whose department is switched off", () => {
  const PATIO = "z-patio";
  const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
  function zoneTables(): Tables {
    return {
      departments: [
        { id: RESTAURANT, name: "Restaurant", active: 1 },
        { id: DELI, name: "Deli", active: 0 },
      ],
      floor_zones: [{ id: PATIO, name: "Patio", active: 1 }],
      zone_service_policies: [{ zone_id: PATIO, department_id: DELI }],
      kitchen_stations: [{ id: KITCHEN, is_default: 1, active: 1 }],
    };
  }
  const refusalOf = (tables: Tables) => {
    try {
      validate(tables);
    } catch (error) {
      return error;
    }
    throw new Error("the bundle was accepted");
  };

  it("is refused with the zone's own code, naming the zone and its department", () => {
    const error = refusalOf(zoneTables());
    expect(error).toMatchObject({ code: "zone.department_inactive" });
    expect((error as { params: unknown }).params).toEqual({
      zoneId: PATIO,
      zoneName: "Patio",
      departmentId: DELI,
      departmentName: "Deli",
    });
  });

  it.each([
    ["no zone or department name", undefined, undefined],
    ["empty zone and department names", "", ""],
    ["a non-text zone and department name", 7, null],
  ])("leaves out a name the bundle does not hold as text (%s)", (_, zoneName, departmentName) => {
    const tables = zoneTables();
    const zone = tables.floor_zones![0]!;
    const department = tables.departments!.find((row) => row.id === DELI)!;
    if (zoneName === undefined) delete zone.name;
    else zone.name = zoneName;
    if (departmentName === undefined) delete department.name;
    else department.name = departmentName;
    const error = refusalOf(tables);
    expect(error).toMatchObject({ code: "zone.department_inactive" });
    expect((error as { params: unknown }).params).toEqual({ zoneId: PATIO, departmentId: DELI });
  });

  it("is accepted once its department is switched on", () => {
    const tables = zoneTables();
    tables.departments!.find((row) => row.id === DELI)!.active = 1;
    expect(() => validate(tables)).not.toThrow();
  });

  it("is accepted once the zone is switched off too, as switching a department off leaves it", () => {
    const tables = zoneTables();
    tables.floor_zones![0]!.active = 0;
    expect(() => validate(tables)).not.toThrow();
  });

  it.each([true, "1"])(
    "refuses a zone flag of %j beside a switched-off department, rather than reading it as off",
    (active) => {
      const tables = zoneTables();
      tables.floor_zones![0]!.active = active;
      expect(() => validate(tables)).toThrowError(refusal("floor_zones.active"));
    },
  );

  it.each([true, "1"])(
    "refuses a department flag of %j, rather than reading it as off",
    (active) => {
      const tables = zoneTables();
      tables.departments!.find((row) => row.id === DELI)!.active = active;
      expect(() => validate(tables)).toThrowError(refusal("departments.active"));
    },
  );

  it("reads a zone row without the flag as switched on, as storage does", () => {
    const tables = zoneTables();
    delete tables.floor_zones![0]!.active;
    expect(refusalOf(tables)).toMatchObject({ code: "zone.department_inactive" });
  });

  it("reads a department row without the flag as switched on, as storage does", () => {
    const tables = zoneTables();
    delete tables.departments!.find((row) => row.id === DELI)!.active;
    expect(() => validate(tables)).not.toThrow();
  });

  it("still gets the routing grid's refusal, naming the row, when a routing cell names the zone", () => {
    const tables = zoneTables();
    tables.routing_cells = [
      {
        id: "cell",
        location_id: "location",
        category_id: null,
        product_id: null,
        zone_id: PATIO,
        station_id: KITCHEN,
        no_preparation: 0,
        no_category: 0,
      },
    ];
    const error = refusalOf(tables);
    expect(error).toMatchObject({ code: "service_zone.not_found" });
    expect((error as { params: unknown }).params).toEqual({
      zoneId: PATIO,
      zoneName: "Patio",
      departmentId: DELI,
      departmentName: "Deli",
      row: "all",
    });
  });
});

describe("service-period configuration", () => {
  const periodId = "11111111-1111-4111-8111-111111111111";
  const context = {
    createdAt: new Date("2026-10-07T10:00:00Z"),
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  };
  function tables(): Tables {
    return {
      departments: [{ id: RESTAURANT }],
      catalogues: [{ id: "customer" }, { id: "staff" }],
      menu_periods: [
        {
          id: periodId,
          department_id: RESTAURANT,
          name: "Night",
          colour: "blue",
          menu_id: "customer",
        },
      ],
      menu_period_staff_menus: [
        { period_id: periodId, department_id: RESTAURANT, menu_id: "staff", display_order: 0 },
      ],
      menu_day_timetables: [
        { id: "monday", department_id: RESTAURANT, weekday: 1, special_date_id: null },
      ],
      menu_slots: [
        {
          id: "night",
          timetable_id: "monday",
          department_id: RESTAURANT,
          period_id: periodId,
          starts_at: "21:00:00",
          ends_at: "03:00:00",
        },
      ],
    };
  }
  it("accepts customer and staff menus without a retired department menu list", () => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(), context)).not.toThrow();
  });
  it.each([
    [
      "a colour outside the palette",
      (t: Tables) => {
        t.menu_periods![0]!.colour = "orange";
      },
      "menu_periods.colour",
    ],
    [
      "an absent customer menu",
      (t: Tables) => {
        t.menu_periods![0]!.menu_id = "gone";
      },
      "menu_periods.menu_id",
    ],
    [
      "an absent staff menu",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.menu_id = "gone";
      },
      "menu_period_staff_menus.menu_id",
    ],
    [
      "a staff row belonging to another department",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.department_id = DELI;
      },
      "menu_period_staff_menus.department_id",
    ],
    [
      "an absent staff period",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.period_id = "gone";
      },
      "menu_period_staff_menus.period_id",
    ],
    [
      "the customer menu repeated as staff",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.menu_id = "customer";
      },
      "menu_period_staff_menus.menu_id",
    ],
    [
      "a repeated staff menu",
      (t: Tables) => {
        t.menu_period_staff_menus!.push({ ...t.menu_period_staff_menus![0]! });
      },
      "menu_period_staff_menus.menu_id",
    ],
    [
      "a fractional staff position",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.display_order = 0.5;
      },
      "menu_period_staff_menus.display_order",
    ],
    [
      "a negative staff position",
      (t: Tables) => {
        t.menu_period_staff_menus![0]!.display_order = -1;
      },
      "menu_period_staff_menus.display_order",
    ],
    [
      "a non-quarter-hour endpoint",
      (t: Tables) => {
        t.menu_slots![0]!.starts_at = "21:01:00";
      },
      "menu_slots",
    ],
    [
      "a range crossing the changeover",
      (t: Tables) => {
        t.menu_slots![0]!.ends_at = "07:00:00";
      },
      "menu_slots",
    ],
  ])("refuses %s", (_, edit, field) => {
    const t = tables();
    edit(t);
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).toThrowError(
      refusal(field),
    );
  });
  it("keeps early-morning ranges in their own business day, including whole-day ranges", () => {
    const t = tables();
    t.menu_slots![0]!.starts_at = "06:00:00";
    t.menu_slots![0]!.ends_at = "06:00:00";
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).not.toThrow();
    t.menu_day_timetables!.push({
      id: "tuesday",
      department_id: RESTAURANT,
      weekday: 2,
      special_date_id: null,
    });
    t.menu_slots!.push({
      ...t.menu_slots![0]!,
      id: "early",
      timetable_id: "tuesday",
      starts_at: "01:00:00",
      ends_at: "03:00:00",
    });
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).not.toThrow();
  });
  it.each([
    ["2027-03-27", "02:30:00", "05:00:00", "06:00", "menu_slots.starts_at"],
    ["2027-03-27", "21:00:00", "02:30:00", "06:00", "menu_slots.ends_at"],
    ["2027-03-27", "21:00:00", "02:30:00", "02:30", "menu_slots.ends_at"],
  ])(
    "checks skipped endpoints on the next calendar morning (%s %s–%s)",
    (date, startsAt, endsAt, dayCutover, field) => {
      const t = tables();
      t.special_dates = [{ id: "spring", date, name: "Spring", close_whole_venue: 0 }];
      t.menu_day_timetables![0]!.weekday = null;
      t.menu_day_timetables![0]!.special_date_id = "spring";
      t.menu_slots![0]!.starts_at = startsAt;
      t.menu_slots![0]!.ends_at = endsAt;
      expect(() =>
        VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, { ...context, dayCutover }),
      ).toThrowError(refusal(field));
    },
  );
  it("checks a start exactly at changeover on the business date", () => {
    const t = tables();
    t.special_dates = [{ id: "spring", date: "2027-03-27", name: "Spring", close_whole_venue: 0 }];
    t.menu_day_timetables![0]!.weekday = null;
    t.menu_day_timetables![0]!.special_date_id = "spring";
    t.menu_slots![0]!.starts_at = "02:30:00";
    t.menu_slots![0]!.ends_at = "21:00:00";
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, { ...context, dayCutover: "02:30" }),
    ).not.toThrow();
  });
});

describe("zone closed times in configuration transfer", () => {
  const clock = {
    createdAt: new Date("2026-10-08T12:00:00Z"),
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
  };
  function closureTables(): Tables {
    return {
      floor_zones: [{ id: "terrace", active: 1 }],
      zone_service_policies: [{ zone_id: "terrace" }],
      special_dates: [
        {
          id: "own-day",
          location_id: "venue",
          date: "2026-12-25",
          name: "Christmas",
          kind: "holiday",
          colour: "red",
          repeat_on: null,
          own_hours: 1,
          close_whole_venue: 0,
        },
      ],
      zone_closed_times: [
        {
          id: "closed",
          zone_id: "terrace",
          weekday: 5,
          special_date_id: null,
          starts_at: "23:00:00",
          ends_at: "04:00:00",
        },
      ],
    };
  }
  it("accepts adjacent ranges, a cutover end and separate weekday/date scopes", () => {
    const tables = closureTables();
    tables.zone_closed_times!.push(
      {
        id: "early",
        zone_id: "terrace",
        weekday: 5,
        special_date_id: null,
        starts_at: "22:00:00",
        ends_at: "23:00:00",
      },
      {
        id: "dated",
        zone_id: "terrace",
        weekday: null,
        special_date_id: "own-day",
        starts_at: "23:00:00",
        ends_at: "04:00:00",
      },
      {
        id: "other-weekday",
        zone_id: "terrace",
        weekday: 6,
        special_date_id: null,
        starts_at: "23:00:00",
        ends_at: "04:00:00",
      },
    );
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables, clock)).not.toThrow();
  });
  it.each([
    ["foreign zone", { zone_id: "foreign" }, "zone_closed_times.zone_id"],
    ["both day selectors", { special_date_id: "own-day" }, "zone_closed_times"],
    ["neither day selector", { weekday: null }, "zone_closed_times"],
    [
      "foreign date",
      { weekday: null, special_date_id: "foreign" },
      "zone_closed_times.special_date_id",
    ],
    ["string weekday", { weekday: "5" }, "zone_closed_times.weekday"],
    ["fractional weekday", { weekday: 1.5 }, "zone_closed_times.weekday"],
    ["negative weekday", { weekday: -1 }, "zone_closed_times.weekday"],
    ["late weekday", { weekday: 7 }, "zone_closed_times.weekday"],
    ["noncanonical start", { starts_at: "23:00" }, "zone_closed_times.starts_at"],
    ["nonzero seconds", { ends_at: "04:00:01" }, "zone_closed_times.ends_at"],
    ["empty range", { ends_at: "23:00:00" }, "zone_closed_times"],
    ["backwards range", { ends_at: "22:00:00" }, "zone_closed_times"],
    ["off-step start", { starts_at: "23:05:00" }, "zone_closed_times"],
    ["off-step end", { ends_at: "03:55:00" }, "zone_closed_times"],
  ])("refuses %s", (_name, changes, field) => {
    const tables = closureTables();
    Object.assign(tables.zone_closed_times![0]!, changes);
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables, clock)).toThrowError(
      refusal(field as string),
    );
  });
  it("refuses a dated closure while the named day keeps the week", () => {
    const tables = closureTables();
    tables.special_dates![0]!.own_hours = 0;
    Object.assign(tables.zone_closed_times![0]!, { weekday: null, special_date_id: "own-day" });
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables, clock)).toThrowError(
      refusal("zone_closed_times.special_date_id"),
    );
  });
  it("refuses overlapping ranges in the same zone and weekday", () => {
    const tables = closureTables();
    tables.zone_closed_times!.push({
      ...tables.zone_closed_times![0]!,
      id: "overlap",
      starts_at: "23:15:00",
    });
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables, clock)).toThrowError(
      refusal("zone_closed_times"),
    );
  });
});

describe("configuration receipt modes", () => {
  it.each(["department_sale_policies", "zone_sale_policies"])(
    "refuses Never and malformed %s receipt values",
    (table) => {
      for (const value of [
        "never",
        "unknown",
        ["auto"],
        1,
        ...(table === "department_sale_policies" ? [null] : []),
      ]) {
        expect(() =>
          VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
            [table]: [{ receipt_print_mode: value }],
          }),
        ).toThrowError(refusal(`${table}.receipt_print_mode`));
      }
    },
  );
  it.each(["department_sale_policies", "zone_sale_policies"])(
    "accepts both modes and absent %s receipt values",
    (table) => {
      for (const value of [
        "auto",
        "on_request",
        undefined,
        ...(table === "zone_sale_policies" ? [null] : []),
      ]) {
        expect(() =>
          VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
            [table]: [value === undefined ? {} : { receipt_print_mode: value }],
          }),
        ).not.toThrow();
      }
    },
  );
});

describe("configuration order starts", () => {
  it.each(["department_sale_policies", "zone_sale_policies"])(
    "refuses malformed %s order starts",
    (table) => {
      for (const value of [
        "tab",
        "",
        ["table"],
        1,
        false,
        {},
        ...(table === "department_sale_policies" ? [null] : []),
      ]) {
        expect(() =>
          VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
            [table]: [{ order_start: value }],
          }),
        ).toThrowError(refusal(`${table}.order_start`));
      }
    },
  );
  it.each(["department_sale_policies", "zone_sale_policies"])(
    "accepts explicit and absent %s order starts",
    (table) => {
      for (const value of [
        "table",
        "counter",
        undefined,
        ...(table === "zone_sale_policies" ? [null] : []),
      ]) {
        expect(() =>
          VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
            [table]: [value === undefined ? {} : { order_start: value }],
          }),
        ).not.toThrow();
      }
    },
  );
});
