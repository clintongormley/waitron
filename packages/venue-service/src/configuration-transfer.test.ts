import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
  validateHolidayConfiguration,
  validateHoursConfiguration,
} from "./configuration-transfer.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const RESTAURANT = "d-restaurant";
const DELI = "d-deli";
const KITCHEN = "k-kitchen"; // the default station
const BAR = "k-bar";
const CHRISTMAS = "sd-christmas";

const weekCell = (owner: Row, weekday: number, mode: string, id = randomUUID()): Row => ({
  id,
  department_id: null,
  station_id: null,
  ...owner,
  weekday,
  mode,
});
const periodRow = (cellId: string, position: number, opensAt: string, closesAt: string): Row => ({
  id: randomUUID(),
  cell_id: cellId,
  position,
  opens_at: opensAt,
  closes_at: closesAt,
});

/** A complete week for `owner`, every day open `opensAt`–`closesAt`. */
function openWeek(owner: Row, opensAt: string, closesAt: string): { cells: Row[]; periods: Row[] } {
  const cells = [0, 1, 2, 3, 4, 5, 6].map((weekday) => weekCell(owner, weekday, "periods"));
  return {
    cells,
    periods: cells.map((cell) => periodRow(cell.id as string, 0, opensAt, closesAt)),
  };
}

/**
 * A bundle the validator accepts: the restaurant opens 12:00–01:00 every day, the deli's week is
 * Closed, all day or periods, the bar has no hours set, and Christmas closes the restaurant, gives
 * the bar a lunch and keeps a retained Closed cell for the default station.
 */
function validTables(): Tables {
  const restaurant = openWeek({ department_id: RESTAURANT }, "12:00:00", "01:00:00");
  const deliCells = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
    weekCell(
      { department_id: DELI },
      weekday,
      weekday === 0 ? "closed" : weekday === 6 ? "all_day" : "periods",
    ),
  );
  const deliPeriods = deliCells
    .filter((cell) => cell.mode === "periods")
    .flatMap((cell) => [
      periodRow(cell.id as string, 0, "09:00:00", "13:00:00"),
      periodRow(cell.id as string, 1, "16:00:00", "20:00:00"),
    ]);
  const barLunch = { id: "sdh-bar", special_date_id: CHRISTMAS, department_id: null };
  return {
    departments: [
      { id: RESTAURANT, is_default: 1 },
      { id: DELI, is_default: 0 },
    ],
    kitchen_stations: [
      { id: KITCHEN, is_default: 1 },
      { id: BAR, is_default: 0 },
    ],
    hours_week_cells: [...restaurant.cells, ...deliCells],
    hours_week_periods: [...restaurant.periods, ...deliPeriods],
    special_dates: [
      {
        id: CHRISTMAS,
        location_id: "location",
        date: "2026-12-25",
        name: "Christmas",
        colour: "red",
        close_whole_venue: 0,
      },
    ],
    special_date_hours: [
      {
        id: "sdh-restaurant",
        special_date_id: CHRISTMAS,
        department_id: RESTAURANT,
        station_id: null,
        mode: "closed",
      },
      { ...barLunch, station_id: BAR, mode: "periods" },
      {
        id: "sdh-kitchen",
        special_date_id: CHRISTMAS,
        department_id: null,
        station_id: KITCHEN,
        mode: "closed",
      },
    ],
    special_date_hours_periods: [periodRow("sdh-bar", 0, "13:00:00", "16:00:00")],
  };
}

function refusal(field: string) {
  return expect.objectContaining({ code: "setup.request_invalid", params: { field } });
}

describe("validateHoursConfiguration", () => {
  it("is run by the venue-service transfer's validate callback, with the export's date and zone", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    const badTime = validTables();
    badTime.hours_week_periods![0]!.opens_at = "12:00";
    expect(() => validate(badTime)).toThrowError(refusal("hours_week_periods.opens_at"));
    // 25 December 2020 opens 00:00–06:00, under the night before; only an export before it refuses.
    const clash = validTables();
    clash.special_dates![0]!.date = "2020-12-25";
    clash.special_date_hours![0]!.mode = "periods";
    clash.special_date_hours_periods!.push(periodRow("sdh-restaurant", 0, "00:00:00", "06:00:00"));
    const at = (createdAt: string) => ({
      createdAt: new Date(createdAt),
      timeZone: "Europe/Madrid",
    });
    expect(() => validate(clash, at("2026-10-06T10:00:00Z"))).not.toThrow();
    expect(() => validate(clash, at("2020-12-01T12:00:00Z"))).toThrowError(
      refusal("special_date_hours"),
    );
  });

  it("accepts every cell mode, a subject with no hours and a default station's retained cell", () => {
    expect(() => validateHoursConfiguration(validTables())).not.toThrow();
  });

  it("accepts a bundle without any hours tables", () => {
    expect(() => validateHoursConfiguration({})).not.toThrow();
  });

  it.each<[string, (tables: Tables) => void, string]>([
    [
      "a time not stored as HH:MM:00",
      (t) => (t.hours_week_periods![0]!.opens_at = "12:00"),
      "hours_week_periods.opens_at",
    ],
    [
      "a closing time with seconds",
      (t) => (t.special_date_hours_periods![0]!.closes_at = "16:00:30"),
      "special_date_hours_periods.closes_at",
    ],
    [
      "a period whose cell is not in the bundle",
      (t) => (t.hours_week_periods![0]!.cell_id = "missing"),
      "hours_week_periods.cell_id",
    ],
    [
      "two periods at one position of a cell",
      (t) => (t.hours_week_periods!.at(-1)!.position = 0),
      "hours_week_periods.position",
    ],
    [
      "a position that is not a whole number",
      (t) => (t.special_date_hours_periods![0]!.position = "0"),
      "special_date_hours_periods.position",
    ],
    [
      "a weekday outside 0..6",
      (t) => (t.hours_week_cells![0]!.weekday = 7),
      "hours_week_cells.weekday",
    ],
    [
      "two cells for one subject's weekday",
      (t) => (t.hours_week_cells![1]!.weekday = 0),
      "hours_week_cells.weekday",
    ],
    [
      "a stored not_set mode",
      (t) => (t.hours_week_cells![0]!.mode = "not_set"),
      "hours_week_cells.mode",
    ],
    [
      "a cell with both owners",
      (t) => (t.hours_week_cells![0]!.station_id = BAR),
      "hours_week_cells.department_id",
    ],
    [
      "a cell with no owner",
      (t) => (t.hours_week_cells![0]!.department_id = null),
      "hours_week_cells.department_id",
    ],
    [
      "a department outside the bundle",
      (t) => (t.hours_week_cells![0]!.department_id = "elsewhere"),
      "hours_week_cells.department_id",
    ],
    [
      "a station outside the bundle",
      (t) =>
        t.hours_week_cells!.push(
          ...[0, 1, 2, 3, 4, 5, 6].map((weekday) =>
            weekCell({ station_id: "elsewhere" }, weekday, "closed"),
          ),
        ),
      "hours_week_cells.station_id",
    ],
    [
      "a week with one day left unset",
      (t) => t.hours_week_cells!.splice(t.hours_week_cells!.length - 1, 1),
      "hours_week_cells",
    ],
    [
      "a periods cell with no periods",
      (t) =>
        (t.hours_week_periods = t.hours_week_periods!.filter(
          (row) => row.cell_id !== t.hours_week_cells![0]!.id,
        )),
      "hours_week_cells",
    ],
    [
      "a Closed cell holding a period",
      (t) => (t.hours_week_cells![0]!.mode = "closed"),
      "hours_week_cells",
    ],
    [
      "two overlapping periods in one day",
      (t) => {
        const deliMonday = t.hours_week_cells!.find(
          (row) => row.department_id === DELI && row.weekday === 1,
        )!;
        t.hours_week_periods!.find(
          (row) => row.cell_id === deliMonday.id && row.position === 1,
        )!.opens_at = "12:00:00";
      },
      "hours_week_cells",
    ],
    [
      "Saturday's late hours running into Sunday's",
      (t) => {
        const sunday = t.hours_week_cells!.find(
          (row) => row.department_id === RESTAURANT && row.weekday === 0,
        )!;
        t.hours_week_periods!.find((row) => row.cell_id === sunday.id)!.opens_at = "00:30:00";
      },
      "hours_week_cells",
    ],
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
      "a colour outside the palette",
      (t) => (t.special_dates![0]!.colour = "pink"),
      "special_dates.colour",
    ],
    [
      "a whole-venue flag other than 0 or 1",
      (t) => (t.special_dates![0]!.close_whole_venue = true),
      "special_dates.close_whole_venue",
    ],
    [
      "a date cell whose date is not in the bundle",
      (t) => (t.special_date_hours![0]!.special_date_id = "missing"),
      "special_date_hours.special_date_id",
    ],
    [
      "a stored inherit mode",
      (t) => (t.special_date_hours![0]!.mode = "inherit"),
      "special_date_hours.mode",
    ],
    [
      "two cells for one subject on a date",
      (t) => t.special_date_hours!.push({ ...t.special_date_hours![0]!, id: "sdh-copy" }),
      "special_date_hours.department_id",
    ],
    [
      "a date cell for a station outside the bundle",
      (t) => (t.special_date_hours![1]!.station_id = "elsewhere"),
      "special_date_hours.station_id",
    ],
    [
      "a date periods cell with no periods",
      (t) => (t.special_date_hours_periods = []),
      "special_date_hours",
    ],
    [
      "a date cell whose hours overlap the evening before",
      (t) => {
        t.special_date_hours![0]!.mode = "periods";
        t.special_date_hours_periods!.push(periodRow("sdh-restaurant", 0, "00:00:00", "06:00:00"));
      },
      "special_date_hours",
    ],
    [
      "a date cell whose late hours overlap the next morning",
      (t) => {
        t.special_date_hours!.push({
          id: "sdh-deli",
          special_date_id: CHRISTMAS,
          department_id: DELI,
          station_id: null,
          mode: "periods",
        });
        // 26 December 2026 is a Saturday, when the deli is open all day.
        t.special_date_hours_periods!.push(periodRow("sdh-deli", 0, "22:00:00", "02:00:00"));
      },
      "special_date_hours",
    ],
  ])("refuses %s", (_, edit, field) => {
    const tables = validTables();
    edit(tables);
    expect(() => validateHoursConfiguration(tables)).toThrowError(refusal(field));
  });

  it("checks clashes between two special dates on neighbouring days", () => {
    const tables = validTables();
    tables.special_dates!.push({
      id: "sd-eve",
      location_id: "location",
      date: "2026-12-24",
      name: "Christmas Eve",
      colour: "amber",
      close_whole_venue: 0,
    });
    tables.special_date_hours!.push({
      id: "sdh-eve-bar",
      special_date_id: "sd-eve",
      department_id: null,
      station_id: BAR,
      mode: "periods",
    });
    tables.special_date_hours_periods!.push(periodRow("sdh-eve-bar", 0, "20:00:00", "14:00:00"));
    expect(() => validateHoursConfiguration(tables)).toThrowError(refusal("special_date_hours"));
  });

  describe("a special date that clashes with the day before it", () => {
    /** Friday 25 December 2020 opens 00:00–06:00, under Thursday's restaurant hours to 01:00. */
    function pastClash(): Tables {
      const tables = validTables();
      tables.special_dates![0]!.date = "2020-12-25";
      tables.special_date_hours![0]!.mode = "periods";
      tables.special_date_hours_periods!.push(
        periodRow("sdh-restaurant", 0, "00:00:00", "06:00:00"),
      );
      return tables;
    }
    const exported = (createdAt: string, timeZone = "Europe/Madrid") => ({
      createdAt: new Date(createdAt),
      timeZone,
    });

    it("is accepted when the pair was already past at export, as the saves skip such pairs", () => {
      expect(() =>
        validateHoursConfiguration(pastClash(), exported("2026-10-06T10:00:00Z")),
      ).not.toThrow();
    });

    it("is refused when the export was taken on the clashing day", () => {
      expect(() =>
        validateHoursConfiguration(pastClash(), exported("2020-12-25T12:00:00Z")),
      ).toThrowError(refusal("special_date_hours"));
    });

    it("is refused when the export was taken before the clashing day", () => {
      expect(() =>
        validateHoursConfiguration(pastClash(), exported("2020-12-01T12:00:00Z")),
      ).toThrowError(refusal("special_date_hours"));
    });

    // The pair ends on 25 December, so a save skips it from the venue's 26 December onwards.
    it.each([
      ["Pacific/Kiritimati", "2020-12-25T09:59:59.999Z", "2020-12-25T10:00:00Z"],
      ["America/Los_Angeles", "2020-12-26T07:59:59.999Z", "2020-12-26T08:00:00Z"],
    ])("is refused until 26 December begins in %s, and accepted from then", (zone, before, at) => {
      expect(() => validateHoursConfiguration(pastClash(), exported(before, zone))).toThrowError(
        refusal("special_date_hours"),
      );
      expect(() => validateHoursConfiguration(pastClash(), exported(at, zone))).not.toThrow();
    });

    it("is refused when the export time or zone is not known or cannot be read", () => {
      expect(() => validateHoursConfiguration(pastClash())).toThrowError(
        refusal("special_date_hours"),
      );
      expect(() => validateHoursConfiguration(pastClash(), exported("not a time"))).toThrowError(
        refusal("special_date_hours"),
      );
      expect(() =>
        validateHoursConfiguration(pastClash(), exported("2026-10-06T10:00:00Z", "Not/A_Zone")),
      ).toThrowError(refusal("special_date_hours"));
    });

    it("still has its own periods checked when it is past", () => {
      const tables = pastClash();
      tables.special_date_hours_periods!.push(
        periodRow("sdh-restaurant", 1, "05:00:00", "08:00:00"),
      );
      expect(() =>
        validateHoursConfiguration(tables, exported("2026-10-06T10:00:00Z")),
      ).toThrowError(refusal("special_date_hours"));
    });
  });

  describe("a special-date period that opens or closes at a minute the clocks skip", () => {
    const forward = clockChangeAfter("Europe/Madrid", "2026-10-06T10:00:00Z", "forward");
    const gap = `${minutesAfter(forward.after, -30)}:00`;
    const dayBefore = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const weeksAfter = new Date(forward.instant.getTime() + 18 * 86_400_000).toISOString();
    function skipped(date: string, opensAt: string, closesAt: string): Tables {
      const tables = validTables();
      tables.special_dates![0]!.date = date;
      const bar = tables.special_date_hours_periods![0]!;
      bar.opens_at = opensAt;
      bar.closes_at = closesAt;
      return tables;
    }
    const exported = (createdAt: string, timeZone = "Europe/Madrid") => ({
      createdAt: new Date(createdAt),
      timeZone,
    });
    const before = exported("2026-10-06T10:00:00Z");

    it("is refused at its opening, as a save refuses it", () => {
      expect(() =>
        validateHoursConfiguration(skipped(forward.date, gap, "04:00:00"), before),
      ).toThrowError(refusal("special_date_hours_periods.opens_at"));
    });

    it("is refused at a closing that falls on the next day", () => {
      expect(() =>
        validateHoursConfiguration(skipped(dayBefore, "23:00:00", gap), before),
      ).toThrowError(refusal("special_date_hours_periods.closes_at"));
    });

    it("is accepted in a zone where that minute occurs", () => {
      expect(() =>
        validateHoursConfiguration(
          skipped(forward.date, gap, "04:00:00"),
          exported("2026-10-06T10:00:00Z", "UTC"),
        ),
      ).not.toThrow();
    });

    it("is accepted once its date was past at export", () => {
      expect(() =>
        validateHoursConfiguration(skipped(forward.date, gap, "04:00:00"), exported(weeksAfter)),
      ).not.toThrow();
    });

    it("is accepted on a default station's retained cell", () => {
      const tables = skipped(forward.date, "13:00:00", "16:00:00");
      tables.special_date_hours![2]!.mode = "periods";
      tables.special_date_hours_periods!.push(periodRow("sdh-kitchen", 0, gap, "04:00:00"));
      expect(() => validateHoursConfiguration(tables, before)).not.toThrow();
    });

    it("is accepted when the zone is not known or cannot be read, as a save checks nothing then", () => {
      const tables = skipped(forward.date, gap, "04:00:00");
      expect(() => validateHoursConfiguration(tables)).not.toThrow();
      expect(() =>
        validateHoursConfiguration(tables, exported("2026-10-06T10:00:00Z", "Not/A_Zone")),
      ).not.toThrow();
    });
  });

  it("ignores a default station's retained cells when checking clashes", () => {
    const tables = validTables();
    const kitchen = openWeek({ station_id: KITCHEN }, "22:00:00", "03:00:00");
    tables.hours_week_cells!.push(...kitchen.cells);
    tables.hours_week_periods!.push(...kitchen.periods);
    tables.special_date_hours![2]!.mode = "periods";
    tables.special_date_hours_periods!.push(periodRow("sdh-kitchen", 0, "01:00:00", "05:00:00"));
    expect(() => validateHoursConfiguration(tables)).not.toThrow();
  });

  it("reads a whole-venue closure as Closed, so the cells it keeps cannot clash", () => {
    const tables = validTables();
    tables.special_dates![0]!.close_whole_venue = 1;
    tables.special_date_hours![0]!.mode = "periods";
    tables.special_date_hours_periods!.push(periodRow("sdh-restaurant", 0, "00:00:00", "06:00:00"));
    expect(() => validateHoursConfiguration(tables)).not.toThrow();
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
  const entry = (geographyId: string, date: string, name = `Fiesta ${date}`): Row => ({
    id: randomUUID(),
    geography_id: geographyId,
    date,
    name,
  });
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
    local_holidays: [
      entry(NORTH, "2026-05-15"),
      entry(NORTH, "2026-09-08"),
      entry(NORTH, "2027-05-15"),
      entry(ISLE, "2026-05-15"),
      entry(ISLE, "2026-06-24"),
      entry(ISLE, "2027-06-24"),
    ],
  };
}

describe("validateHolidayConfiguration", () => {
  it("accepts every geography's entries at the allowance, and a bundle with no holiday tables", () => {
    expect(() => validateHolidayConfiguration(holidayTables(), packs(2))).not.toThrow();
    expect(() => validateHolidayConfiguration({}, packs(2))).not.toThrow();
  });

  it("accepts a geography with no entries whose country has no holiday capability", () => {
    const tables: Tables = {
      holiday_geographies: [{ ...holidayTables().holiday_geographies![0]!, country: "ZY" }],
    };
    expect(() => validateHolidayConfiguration(tables, packs(2))).not.toThrow();
  });

  describe.each([1, 3])("with an allowance of %i", (limit) => {
    const days = (geographyId: string, year: number, count: number): Row[] =>
      Array.from({ length: count }, (_, index) => ({
        id: randomUUID(),
        geography_id: geographyId,
        date: `${year}-03-${String(index + 1).padStart(2, "0")}`,
        name: `Day ${index + 1}`,
      }));
    const places = [
      [NORTH, 2026],
      [NORTH, 2027],
      [ISLE, 2026],
      [ISLE, 2027],
    ] as const;

    it("accepts every geography and year holding exactly that many", () => {
      const tables = holidayTables();
      tables.local_holidays = places.flatMap(([geography, year]) => days(geography, year, limit));
      expect(() => validateHolidayConfiguration(tables, packs(limit))).not.toThrow();
    });

    it.each(places)(
      "refuses one more for %s in %i, the retained geography included",
      (over, overYear) => {
        const tables = holidayTables();
        tables.local_holidays = places.flatMap(([geography, year]) =>
          days(geography, year, geography === over && year === overYear ? limit + 1 : limit),
        );
        expect(() => validateHolidayConfiguration(tables, packs(limit))).toThrowError(
          refusal("local_holidays"),
        );
      },
    );
  });

  it("refuses any entry of a geography whose country has no holiday capability", () => {
    const tables = holidayTables();
    tables.holiday_geographies![0]!.country = "ZY";
    tables.holiday_geographies![1]!.country = "ZY";
    tables.holiday_geographies![1]!.area_key = null;
    tables.local_holidays = tables.local_holidays!.slice(0, 1);
    expect(() => validateHolidayConfiguration(tables, packs(2))).toThrowError(
      refusal("local_holidays"),
    );
  });

  it("lets a Spanish geography carry Spain's two local days a year, and refuses a third", () => {
    const sevilla: Tables = {
      holiday_geographies: [
        {
          id: "g-sevilla",
          location_id: "location",
          country: "ES",
          province_code: "41",
          city: "Sevilla",
          city_key: "sevilla",
          area_key: null,
        },
      ],
      local_holidays: ["2026-05-28", "2026-06-04"].map((date) => ({
        id: randomUUID(),
        geography_id: "g-sevilla",
        date,
        name: "Fiesta local",
      })),
    };
    expect(() => validateHolidayConfiguration(sevilla)).not.toThrow();
    sevilla.local_holidays!.push({
      id: randomUUID(),
      geography_id: "g-sevilla",
      date: "2026-10-12",
      name: "Fiesta local",
    });
    expect(() => validateHolidayConfiguration(sevilla)).toThrowError(refusal("local_holidays"));
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
        t.local_holidays = [];
      },
      "holiday_geographies.area_key",
    ],
    [
      "an entry id used twice",
      (t) => (t.local_holidays![1]!.id = t.local_holidays![0]!.id),
      "local_holidays.id",
    ],
    [
      "an entry whose geography is not in the bundle",
      (t) => (t.local_holidays![0]!.geography_id = "g-elsewhere"),
      "local_holidays.geography_id",
    ],
    [
      "an impossible date",
      (t) => (t.local_holidays![0]!.date = "2026-02-30"),
      "local_holidays.date",
    ],
    [
      "a date not written as YYYY-MM-DD",
      (t) => (t.local_holidays![0]!.date = "2026-5-15"),
      "local_holidays.date",
    ],
    [
      "two entries of one geography on one date, under different names",
      (t) => (t.local_holidays![1]!.date = "2026-05-15"),
      "local_holidays.date",
    ],
    ["a blank name", (t) => (t.local_holidays![0]!.name = " "), "local_holidays.name"],
    [
      "a name the writer would have trimmed",
      (t) => (t.local_holidays![0]!.name = " Fiesta "),
      "local_holidays.name",
    ],
    [
      "a name past the limit",
      (t) => (t.local_holidays![0]!.name = "x".repeat(201)),
      "local_holidays.name",
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

  it("accepts the same date for two geographies", () => {
    const tables = holidayTables();
    expect(tables.local_holidays!.filter((row) => row.date === "2026-05-15")).toHaveLength(2);
    expect(() => validateHolidayConfiguration(tables, packs(2))).not.toThrow();
  });

  it("is run by the venue-service transfer's validate callback, beside the Hours check", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    const both = { ...validTables(), ...holidayTables() };
    // The installed packs know no country ZZ.
    expect(() => validate(both)).toThrowError(refusal("holiday_geographies.country"));
    for (const row of both.holiday_geographies!) row.country = "ES";
    both.holiday_geographies![0]!.province_code = "41";
    both.holiday_geographies![1]!.province_code = "25";
    both.holiday_geographies![1]!.area_key = "aran";
    expect(() => validate(both)).not.toThrow();
    both.local_holidays![0]!.date = "2026-02-30";
    expect(() => validate(both)).toThrowError(refusal("local_holidays.date"));
  });

  it("declares geographies after the location they remap to, and entries after their geography", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names.slice(-3)).toEqual([
      "special_date_hours_periods",
      "holiday_geographies",
      "local_holidays",
    ]);
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.at(-2)).toEqual({
      name: "holiday_geographies",
      locationColumns: ["location_id"],
    });
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.at(-1)).toEqual({ name: "local_holidays" });
  });
});

describe("the department menu rows of a bundle", () => {
  const ZONE = "z-barra";
  const tables = (departmentId: string): Tables => ({
    zone_service_policies: [{ zone_id: ZONE, department_id: RESTAURANT }],
    department_menus: [
      { department_id: RESTAURANT, menu_id: "m-bebidas", display_order: 0 },
      { department_id: DELI, menu_id: "m-bebidas", display_order: 0 },
    ],
    zone_all_day_menus: [{ zone_id: ZONE, department_id: departmentId, menu_id: "m-bebidas" }],
  });

  it("are transferred after the departments and zone policies their keys name", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(
      names.slice(names.indexOf("zone_sale_policies"), names.indexOf("zone_sale_policies") + 4),
    ).toEqual([
      "zone_sale_policies",
      "department_menus",
      "department_all_day_menus",
      "zone_all_day_menus",
    ]);
  });

  it("refuse a zone's all-day menu filed under a department other than the zone's", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    expect(() => validate(tables(RESTAURANT))).not.toThrow();
    expect(() => validate(tables(DELI))).toThrowError(refusal("zone_all_day_menus.department_id"));
    const noPolicy = tables(RESTAURANT);
    noPolicy.zone_service_policies = [];
    expect(() => validate(noPolicy)).toThrowError(refusal("zone_all_day_menus.department_id"));
  });
});
