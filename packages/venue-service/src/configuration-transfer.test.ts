import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
  validateHolidayConfiguration,
  validateHoursConfiguration,
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
const PASS = "k-pass";
const GRILL = "k-grill";
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
 * Pass and Grill carry the two scheduled weeks; Bar is unset and Kitchen is the default.
 */
function validTables(): Tables {
  const restaurant = openWeek({ station_id: PASS }, "12:00:00", "01:00:00");
  const deliCells = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
    weekCell(
      { station_id: GRILL },
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
      { id: PASS, is_default: 0 },
      { id: GRILL, is_default: 0 },
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
        department_id: null,
        station_id: PASS,
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
  it.each(["hours_week_cells", "special_date_hours"] as const)(
    "refuses department-owned %s even when the bundle contains the department",
    (table) => {
      const tables = validTables();
      const bar = openWeek({ station_id: BAR }, "09:00:00", "17:00:00");
      tables.hours_week_cells = bar.cells;
      tables.hours_week_periods = bar.periods;
      tables.special_date_hours = [
        {
          id: "bar-date",
          special_date_id: CHRISTMAS,
          department_id: null,
          station_id: BAR,
          mode: "closed",
        },
      ];
      tables.special_date_hours_periods = [];
      expect(() => validateHoursConfiguration(tables)).not.toThrow();
      for (const owned of tables[table]!) {
        owned.department_id = RESTAURANT;
        owned.station_id = null;
      }
      expect(() => validateHoursConfiguration(tables)).toThrowError(
        refusal(`${table}.department_id`),
      );
    },
  );

  it.each([null, undefined])(
    "refuses a missing station even when the station inventory contains %s",
    (id) => {
      const tables = validTables();
      const owner = tables.hours_week_cells![0]!.station_id;
      tables.kitchen_stations!.push({ id, is_default: 0 });
      for (const row of tables.hours_week_cells!) if (row.station_id === owner) row.station_id = id;
      expect(() => validateHoursConfiguration(tables)).toThrowError(
        refusal("hours_week_cells.station_id"),
      );
    },
  );

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
      dayCutover: "06:00",
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
      (t) => (t.hours_week_cells![0]!.department_id = RESTAURANT),
      "hours_week_cells.department_id",
    ],
    [
      "a cell with no owner",
      (t) => (t.hours_week_cells![0]!.station_id = null),
      "hours_week_cells.station_id",
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
          (row) => row.station_id === GRILL && row.weekday === 1,
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
          (row) => row.station_id === PASS && row.weekday === 0,
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
      "special_date_hours.station_id",
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
          department_id: null,
          station_id: GRILL,
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

describe("the menu timetable rows of a bundle", () => {
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
      t.special_dates = [
        { id: "spring", date, name: "Spring", colour: "red", close_whole_venue: 0 },
      ];
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
    t.special_dates = [
      { id: "spring", date: "2027-03-27", name: "Spring", colour: "red", close_whole_venue: 0 },
    ];
    t.menu_day_timetables![0]!.weekday = null;
    t.menu_day_timetables![0]!.special_date_id = "spring";
    t.menu_slots![0]!.starts_at = "02:30:00";
    t.menu_slots![0]!.ends_at = "21:00:00";
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, { ...context, dayCutover: "02:30" }),
    ).not.toThrow();
  });
});
