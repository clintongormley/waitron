import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
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
  it("is the venue-service transfer's validate callback", () => {
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.validate).toBe(validateHoursConfiguration);
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
