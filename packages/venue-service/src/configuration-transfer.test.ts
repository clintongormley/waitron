import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
  validateHolidayConfiguration,
  validateMenuTimetables,
  validateRoutingConfiguration,
} from "./configuration-transfer.js";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const RESTAURANT = "d-restaurant";
const DELI = "d-deli";
const KITCHEN = "k-kitchen"; // the default station
const BAR = "k-bar";

function refusal(field: string) {
  return expect.objectContaining({ code: "setup.request_invalid", params: { field } });
}

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

  it("is run by the venue-service transfer's validate callback", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    const both = holidayTables();
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
    expect(names.slice(-2)).toEqual(["zone_day_ranges", "holiday_geographies"]);
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
      expect(() => validateMenuTimetables(tables)).toThrowError(
        refusal("menu_periods.end_offset_minutes"),
      );
    },
  );
  it.each([-15, 0, 14, undefined])("accepts scalar imported end offset %s", (offset) => {
    const tables = menuTables();
    if (offset !== undefined) tables.menu_periods![0]!.end_offset_minutes = offset;
    expect(() => validateMenuTimetables(tables)).not.toThrow();
  });

  it("refuses imported grace reaching the next business day's period in a season week", () => {
    const tables = menuTables();
    tables.menu_periods![1]!.end_offset_minutes = 240;
    expect(() => validate(tables, madrid("2026-10-07T10:00:00Z"))).not.toThrow();
    tables.seasons = [
      { id: "s-year", location_id: "location", name: "Year", starts_on: "01-01", colour: "grey" },
    ];
    tables.department_days = [5, 6].map((weekday) => ({
      id: `d-${weekday}`,
      department_id: RESTAURANT,
      season_id: "s-year",
      weekday,
      special_day_date_id: null,
    }));
    tables.department_day_ranges = [
      ["d-5", MADRUGADA, "22:00:00", "02:00:00"],
      ["d-6", MANANAS, "06:00:00", "09:00:00"],
    ].map(([dayId, periodId, startsAt, endsAt]) => ({
      id: randomUUID(),
      day_id: dayId,
      department_id: RESTAURANT,
      period_id: periodId,
      starts_at: startsAt,
      ends_at: endsAt,
    }));
    expect(() => validate(tables, madrid("2026-10-07T10:00:00Z"))).toThrowError(
      refusal("department_day_ranges"),
    );
    tables.menu_periods![1]!.end_offset_minutes = 239;
    expect(() => validate(tables, madrid("2026-10-07T10:00:00Z"))).not.toThrow();
  });

  const BARRA = "z-barra";
  const MANANAS = "11111111-1111-4111-8111-111111111111";
  const MADRUGADA = "22222222-2222-4222-8222-222222222222";
  const DELI_PERIOD = "33333333-3333-4333-8333-333333333333";
  function menuTables(): Tables {
    return {
      departments: [
        { id: RESTAURANT, is_default: 1 },
        { id: DELI, is_default: 0 },
      ],
      floor_zones: [{ id: BARRA, active: 1 }],
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

  it("are transferred after the zone sale policies, with staff rows after their periods", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    const at = names.indexOf("menu_periods");
    expect(names.slice(at, at + 2)).toEqual(["menu_periods", "menu_period_staff_menus"]);
    expect(at).toBeGreaterThan(names.indexOf("zone_sale_policies"));
  });

  it("accept rows a writer could have written, and a bundle with none", () => {
    expect(() => validateMenuTimetables(menuTables())).not.toThrow();
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
    expect(() => validateMenuTimetables(tables)).toThrowError(refusal(field));
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
    tables.floor_zones!.find((row) => row.id === CLOSED_ZONE)!.active = 1;
    expect(() => validate(tables)).not.toThrow();
    tables.routing_cells!.push(cell({ product: LARGE, station: BAR }));
    expect(() => validate(tables)).toThrowError(refusal("routing_cells.product_id"));
  });
});

describe("deleted hierarchy rows in a configuration bundle", () => {
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

  it("refuses a deleted department before checking its zone", () => {
    const error = refusalOf(zoneTables());
    expect(error).toMatchObject({ code: "setup.request_invalid" });
    expect((error as { params: unknown }).params).toEqual({
      field: "departments.active",
    });
  });

  it.each([
    ["no zone or department name", undefined, undefined],
    ["empty zone and department names", "", ""],
    ["a non-text zone and department name", 7, null],
  ])(
    "refuses its deleted department regardless of missing or malformed names (%s)",
    (_, zoneName, departmentName) => {
      const tables = zoneTables();
      const zone = tables.floor_zones![0]!;
      const department = tables.departments!.find((row) => row.id === DELI)!;
      if (zoneName === undefined) delete zone.name;
      else zone.name = zoneName;
      if (departmentName === undefined) delete department.name;
      else department.name = departmentName;
      const error = refusalOf(tables);
      expect(error).toMatchObject({ code: "setup.request_invalid" });
      expect((error as { params: unknown }).params).toEqual({ field: "departments.active" });
    },
  );

  it("is accepted once its department is switched on", () => {
    const tables = zoneTables();
    tables.departments!.find((row) => row.id === DELI)!.active = 1;
    expect(() => validate(tables)).not.toThrow();
  });

  it("refuses a deleted zone even when its department is deleted too", () => {
    const tables = zoneTables();
    tables.floor_zones![0]!.active = 0;
    expect(() => validate(tables)).toThrowError(refusal("floor_zones.active"));
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
    expect(refusalOf(tables)).toMatchObject({ code: "setup.request_invalid" });
  });

  it("reads a department row without the flag as switched on, as storage does", () => {
    const tables = zoneTables();
    delete tables.departments!.find((row) => row.id === DELI)!.active;
    expect(() => validate(tables)).not.toThrow();
  });

  it("refuses the deleted department before a routing cell naming its zone", () => {
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
    expect(error).toMatchObject({ code: "setup.request_invalid" });
    expect((error as { params: unknown }).params).toEqual({
      field: "departments.active",
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
    };
  }
  it("accepts customer and staff menus without a retired department menu list", () => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(), context)).not.toThrow();
  });
  it("accepts a period in a newer calendar colour", () => {
    const t = tables();
    t.menu_periods![0]!.colour = "cyan";
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).not.toThrow();
  });
  it.each([
    [
      "a colour outside the palette",
      (t: Tables) => {
        t.menu_periods![0]!.colour = "magenta";
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
  ])("refuses %s", (_, edit, field) => {
    const t = tables();
    edit(t);
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).toThrowError(
      refusal(field),
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
            departments: [{ id: RESTAURANT }],
            floor_zones: [{ id: "zone" }],
            [table]: [{ department_id: RESTAURANT, zone_id: "zone", receipt_print_mode: value }],
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
            departments: [{ id: RESTAURANT }],
            floor_zones: [{ id: "zone" }],
            [table]: [
              {
                department_id: RESTAURANT,
                zone_id: "zone",
                ...(value === undefined ? {} : { receipt_print_mode: value }),
              },
            ],
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
            departments: [{ id: RESTAURANT }],
            floor_zones: [{ id: "zone" }],
            [table]: [{ department_id: RESTAURANT, zone_id: "zone", order_start: value }],
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
            departments: [{ id: RESTAURANT }],
            floor_zones: [{ id: "zone" }],
            [table]: [
              {
                department_id: RESTAURANT,
                zone_id: "zone",
                ...(value === undefined ? {} : { order_start: value }),
              },
            ],
          }),
        ).not.toThrow();
      }
    },
  );
});

it.each([0, false])(
  "refuses a deleted department with active=%j even without children",
  (active) => {
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({ departments: [{ id: "old", active }] }),
    ).toThrowError(refusal("departments.active"));
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({ departments: [{ id: "live", active: 1 }] }),
    ).not.toThrow();
  },
);

it.each([
  ["zone_service_policies", "zone_id", { zone_id: "missing", department_id: RESTAURANT }],
  ["zone_service_policies", "department_id", { zone_id: "z-live", department_id: "missing" }],
  ["department_receipts", "department_id", { department_id: "missing", receipt: {} }],
  ["department_sale_policies", "department_id", { department_id: "missing" }],
  ["zone_sale_policies", "zone_id", { zone_id: "missing" }],
])("refuses a deleted hierarchy child %s.%s with an absent parent", (table, field, row) => {
  const tables = {
    departments: [{ id: RESTAURANT, active: 1 }],
    floor_zones: [{ id: "z-live", active: 1 }],
    [table]: [row],
  };
  expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).toThrowError(
    refusal(`${table}.${field}`),
  );
});

describe("season weeks in a configuration bundle", () => {
  const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
  const LUNCH = "44444444-4444-4444-8444-444444444444";
  const LATE = "55555555-5555-4555-8555-555555555555";
  const clock = {
    createdAt: new Date("2026-10-07T10:00:00Z"),
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  };
  const range = (dayId: string, periodId: string, startsAt: string, endsAt: string) => ({
    id: randomUUID(),
    day_id: dayId,
    department_id: RESTAURANT,
    period_id: periodId,
    starts_at: startsAt,
    ends_at: endsAt,
  });
  const day = (id: string, seasonId: string, weekday: number) => ({
    id,
    department_id: RESTAURANT,
    season_id: seasonId,
    weekday,
    special_day_date_id: null,
  });

  /** Winter: Late 22:00–02:00 on Friday, Lunch 06:00–09:00 on Saturday. Autumn: Lunch on Saturday
   *  only. Terrace closes 23:00–02:00 on a Winter Friday. */
  function seasonTables(): Tables {
    return {
      departments: [{ id: RESTAURANT }],
      floor_zones: [{ id: "terrace", active: 1 }],
      zone_service_policies: [{ zone_id: "terrace", department_id: RESTAURANT }],
      catalogues: [{ id: "m-lunch" }, { id: "m-late" }],
      menu_periods: [
        { id: LUNCH, department_id: RESTAURANT, name: "Lunch", colour: "blue", menu_id: "m-lunch" },
        { id: LATE, department_id: RESTAURANT, name: "Late", colour: "red", menu_id: "m-late" },
      ],
      seasons: [
        {
          id: "s-autumn",
          location_id: "venue",
          name: "Autumn",
          starts_on: "09-01",
          colour: "orange",
        },
        {
          id: "s-winter",
          location_id: "venue",
          name: "Winter",
          starts_on: "12-01",
          colour: "blue",
        },
      ],
      department_days: [
        day("w-fri", "s-winter", 5),
        day("w-sat", "s-winter", 6),
        day("a-fri", "s-autumn", 5),
        day("a-sat", "s-autumn", 6),
      ],
      department_day_ranges: [
        range("w-fri", LATE, "22:00:00", "02:00:00"),
        range("w-sat", LUNCH, "06:00:00", "09:00:00"),
        range("a-sat", LUNCH, "06:00:00", "09:00:00"),
      ],
      zone_days: [
        {
          id: "z-fri",
          zone_id: "terrace",
          season_id: "s-winter",
          weekday: 5,
          special_day_date_id: null,
        },
      ],
      zone_day_ranges: [
        {
          id: "z-fri-1",
          day_id: "z-fri",
          kind: "closed",
          starts_at: "23:00:00",
          ends_at: "02:00:00",
        },
      ],
    };
  }

  it("refuses a zone closure outside its department's hours at zone_day_ranges", () => {
    const tables = seasonTables();
    tables.zone_day_ranges![0]!.ends_at = "04:00:00";
    expect(() => validate(tables, clock)).toThrowError(refusal("zone_day_ranges"));
  });

  it("are transferred after the periods and zone policies they name, parents first", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    const at = names.indexOf("seasons");
    expect(names.slice(at, at + 5)).toEqual([
      "seasons",
      "department_days",
      "department_day_ranges",
      "zone_days",
      "zone_day_ranges",
    ]);
    expect(at).toBeGreaterThan(names.indexOf("menu_periods"));
    expect(at).toBeGreaterThan(names.indexOf("zone_service_policies"));
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables[at]).toEqual({
      name: "seasons",
      locationColumns: ["location_id"],
    });
  });

  it("accepts rows the week writers could have written, and a bundle with none", () => {
    expect(() => validate(seasonTables(), clock)).not.toThrow();
    expect(() => validate({}, clock)).not.toThrow();
  });

  it("refuses a range off the quarter-hour at its table", () => {
    const tables = seasonTables();
    tables.department_day_ranges![1]!.starts_at = "13:10:00";
    tables.department_day_ranges![1]!.ends_at = "14:00:00";
    expect(() => validate(tables, clock)).toThrowError(refusal("department_day_ranges"));
  });

  it("refuses overlapping ranges on one season's day, but not the same hours in two seasons", () => {
    const tables = seasonTables();
    tables.department_day_ranges!.push(range("w-sat", LATE, "08:00:00", "10:00:00"));
    expect(() => validate(tables, clock)).toThrowError(refusal("department_day_ranges"));
    const apart = seasonTables();
    apart.department_day_ranges!.push(range("a-fri", LATE, "22:00:00", "02:00:00"));
    expect(() => validate(apart, clock)).not.toThrow();
  });

  it.each(["02-29", "13-01", "02-30", "1-05", "", 301, null])(
    "refuses a season starting on %j",
    (startsOn) => {
      const tables = seasonTables();
      tables.seasons![0]!.starts_on = startsOn;
      expect(() => validate(tables, clock)).toThrowError(refusal("seasons.starts_on"));
    },
  );

  it("refuses two seasons on one start or under one name", () => {
    const sameStart = seasonTables();
    sameStart.seasons![1]!.starts_on = "09-01";
    expect(() => validate(sameStart, clock)).toThrowError(refusal("seasons.starts_on"));
    const sameName = seasonTables();
    sameName.seasons![1]!.name = "Autumn";
    expect(() => validate(sameName, clock)).toThrowError(refusal("seasons.name"));
    const blank = seasonTables();
    blank.seasons![1]!.name = "  ";
    expect(() => validate(blank, clock)).toThrowError(refusal("seasons.name"));
  });

  it.each([" 3f2c1e9a-0000-4000-8000-000000000001", "Winter ", "\tWinter"])(
    "refuses a season name %j that saving a season would have trimmed",
    (name) => {
      const tables = seasonTables();
      tables.seasons![1]!.name = name;
      expect(() => validate(tables, clock)).toThrowError(refusal("seasons.name"));
    },
  );

  it("refuses a season whose colour is not a calendar colour, or has none", () => {
    const mauve = seasonTables();
    mauve.seasons![0]!.colour = "mauve";
    expect(() => validate(mauve, clock)).toThrowError(refusal("seasons.colour"));
    const none = seasonTables();
    delete none.seasons![0]!.colour;
    expect(() => validate(none, clock)).toThrowError(refusal("seasons.colour"));
    const teal = seasonTables();
    teal.seasons![0]!.colour = "teal";
    expect(() => validate(teal, clock)).not.toThrow();
  });

  it("refuses a period's end offset reaching the next day's placement in the same season", () => {
    const tables = seasonTables();
    tables.menu_periods![1]!.end_offset_minutes = 240;
    expect(() => validate(tables, clock)).toThrowError(refusal("department_day_ranges"));
    tables.menu_periods![1]!.end_offset_minutes = 239;
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("checks the end offset across a season boundary, and accepts different weeks that meet no grace", () => {
    const tables = seasonTables();
    tables.menu_periods![1]!.end_offset_minutes = 240;
    // Winter, which runs to 31 August, holds no Saturday. Its Friday Late sends until 06:00, when
    // Autumn's first day, on a Saturday, opens Lunch.
    tables.department_days = tables.department_days!.filter((row) => row.id !== "w-sat");
    tables.department_day_ranges = tables.department_day_ranges!.filter(
      (row) => row.day_id !== "w-sat",
    );
    expect(() => validate(tables, clock)).toThrowError(refusal("department_day_ranges"));
    // Autumn's Lunch from 06:15 is clear of that grace; the two seasons' weeks still differ.
    for (const row of tables.department_day_ranges)
      if (row.day_id === "a-sat") row.starts_at = "06:15:00";
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("refuses a period's end offset reaching the first day of the next season", () => {
    const tables = seasonTables();
    // Autumn's Friday Late sends until 06:00; Winter's first day, on a Saturday, opens Lunch then.
    tables.department_days = [day("a-fri", "s-autumn", 5), day("w-sat", "s-winter", 6)];
    tables.department_day_ranges = [
      range("a-fri", LATE, "22:00:00", "02:00:00"),
      range("w-sat", LUNCH, "06:00:00", "09:00:00"),
    ];
    tables.zone_days![0]!.season_id = "s-autumn";
    tables.menu_periods![1]!.end_offset_minutes = 240;
    expect(() => validate(tables, clock)).toThrowError(refusal("department_day_ranges"));
    tables.menu_periods![1]!.end_offset_minutes = 239;
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it.each([
    ["department_days", "season_id", { season_id: "missing" }],
    ["department_days", "department_id", { department_id: "missing" }],
    ["department_days", "weekday", { weekday: 7 }],
    ["department_days", "weekday", { weekday: null }],
    ["department_days", "special_day_date_id", { special_day_date_id: "sd-1" }],
    ["department_days", "weekday", { weekday: 6 }],
  ])("refuses a department day whose %s.%s is %j", (table, field, change) => {
    const tables = seasonTables();
    Object.assign(tables.department_days![0]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(`${table}.${field}`));
  });

  it.each([
    ["day_id", { day_id: "missing" }],
    ["department_id", { department_id: DELI }],
    ["period_id", { period_id: null }],
    ["period_id", { period_id: "66666666-6666-4666-8666-666666666666" }],
    ["starts_at", { starts_at: "6:00" }],
    ["ends_at", { ends_at: "24:00:00" }],
  ])("refuses a department range whose %s is wrong", (field, change) => {
    const tables = seasonTables();
    tables.departments!.push({ id: DELI });
    Object.assign(tables.department_day_ranges![1]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(`department_day_ranges.${field}`));
  });

  it.each([
    ["zone_days.zone_id", "zone_days", { zone_id: "missing" }],
    ["zone_days.season_id", "zone_days", { season_id: "missing" }],
    ["zone_days.weekday", "zone_days", { weekday: -1 }],
    ["zone_days.special_day_date_id", "zone_days", { special_day_date_id: "sd-1" }],
    ["zone_day_ranges.day_id", "zone_day_ranges", { day_id: "missing" }],
    ["zone_day_ranges.kind", "zone_day_ranges", { kind: "open" }],
    ["zone_day_ranges.starts_at", "zone_day_ranges", { starts_at: "23:00" }],
    ["zone_day_ranges", "zone_day_ranges", { ends_at: "23:10:00" }],
  ])("refuses a zone row with a wrong %s", (field, table, change) => {
    const tables = seasonTables();
    Object.assign(tables[table]![0]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(field));
  });

  it("refuses zone season weeks closed where the department has no hours", () => {
    const tables = seasonTables();
    delete tables.menu_periods;
    tables.department_days = [];
    tables.department_day_ranges = [];
    expect(() => validate(tables, clock)).toThrowError(refusal("zone_day_ranges"));
  });

  it("accepts a zone season week with no closures in a bundle with no periods", () => {
    const tables = seasonTables();
    delete tables.menu_periods;
    tables.department_days = [];
    tables.department_day_ranges = [];
    tables.zone_day_ranges = [];
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("refuses season weeks without the bundle's changeover", () => {
    expect(() => validate(seasonTables())).toThrowError(refusal("department_day_ranges"));
    const zoneOnly = seasonTables();
    zoneOnly.department_day_ranges = [];
    expect(() => validate(zoneOnly)).toThrowError(refusal("zone_day_ranges"));
  });
});

describe("department receipt configuration fields", () => {
  function tables(receipt: unknown): Tables {
    return {
      departments: [{ id: RESTAURANT, active: 1 }],
      department_receipts: [{ department_id: RESTAURANT, receipt }],
    };
  }
  it.each([
    {},
    { printAddress: false, operationDescription: "Dining service" },
    { printAddress: true, operationDescription: "x".repeat(500) },
  ])("accepts own receipt fields %j as an object or stored JSON", (receipt) => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(receipt))).not.toThrow();
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(JSON.stringify(receipt))),
    ).not.toThrow();
  });
  it.each([
    [null],
    [[]],
    ["{bad"],
    [3],
    [{ printAddress: null }],
    [{ printAddress: "false" }],
    [{ printAddress: 0 }],
    [{ operationDescription: null }],
    [{ operationDescription: [] }],
    [{ operationDescription: "x".repeat(501) }],
    [{ operationDescription: "bad\u0000text" }],
  ])("refuses invalid receipt configuration %j", (receipt) => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(receipt))).toThrowError(
      refusal("department_receipts.receipt"),
    );
  });
});

describe("special days in a configuration bundle", () => {
  const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
  const BAR_PERIOD = "77777777-7777-4777-8777-777777777777";
  const LUNCH = "88888888-8888-4888-8888-888888888888";
  const clock = {
    createdAt: new Date("2026-10-07T10:00:00Z"),
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  };
  const range = (
    dayId: string,
    periodId: string | null,
    startsAt: string,
    endsAt: string,
  ): Row => ({
    id: randomUUID(),
    day_id: dayId,
    department_id: RESTAURANT,
    period_id: periodId,
    starts_at: startsAt,
    ends_at: endsAt,
  });

  /** Fiesta repeats from 15 August 2025: Bar 20:00–23:00 and Closed 12:00–16:00 in the
   *  restaurant, the terrace open 12:00–14:00; 16 August is Closed all day. */
  function specialTables(): Tables {
    return {
      departments: [{ id: RESTAURANT }],
      floor_zones: [{ id: "terrace", active: 1 }],
      zone_service_policies: [{ zone_id: "terrace", department_id: RESTAURANT }],
      catalogues: [{ id: "m-bar" }, { id: "m-lunch" }],
      menu_periods: [
        { id: BAR_PERIOD, department_id: RESTAURANT, name: "Bar", colour: "red", menu_id: "m-bar" },
        { id: LUNCH, department_id: RESTAURANT, name: "Lunch", colour: "blue", menu_id: "m-lunch" },
      ],
      special_days: [{ id: "fiesta", location_id: "venue", name: "Fiesta", repeats_yearly: 1 }],
      special_day_dates: [
        {
          id: "fiesta-15",
          special_day_id: "fiesta",
          location_id: "venue",
          date: "2025-08-15",
          closed_all_day: 0,
        },
        {
          id: "fiesta-16",
          special_day_id: "fiesta",
          location_id: "venue",
          date: "2025-08-16",
          closed_all_day: 1,
        },
      ],
      department_days: [
        {
          id: "dd-15",
          department_id: RESTAURANT,
          season_id: null,
          weekday: null,
          special_day_date_id: "fiesta-15",
        },
      ],
      department_day_ranges: [
        range("dd-15", BAR_PERIOD, "20:00:00", "23:00:00"),
        range("dd-15", null, "12:00:00", "16:00:00"),
      ],
      zone_days: [
        {
          id: "zd-15",
          zone_id: "terrace",
          season_id: null,
          weekday: null,
          special_day_date_id: "fiesta-15",
        },
      ],
      zone_day_ranges: [
        { id: "zr-15", day_id: "zd-15", kind: "open", starts_at: "12:00:00", ends_at: "14:00:00" },
      ],
    };
  }

  /** One special day `repeats` or not, on `date`, painting Bar over `startsAt`–`endsAt`. */
  function painted(date: string, repeats: number, startsAt: string, endsAt: string): Tables {
    const tables = specialTables();
    tables.special_days![0]!.repeats_yearly = repeats;
    tables.special_day_dates = [tables.special_day_dates![0]!];
    tables.special_day_dates[0]!.date = date;
    tables.department_day_ranges = [range("dd-15", BAR_PERIOD, startsAt, endsAt)];
    tables.zone_days = [];
    tables.zone_day_ranges = [];
    return tables;
  }

  it("are transferred under the importing venue before the days that name their dates", () => {
    const tables = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables;
    const names = tables.map((table) => table.name);
    expect(tables.find((table) => table.name === "special_days")).toEqual({
      name: "special_days",
      locationColumns: ["location_id"],
    });
    expect(tables.find((table) => table.name === "special_day_dates")).toEqual({
      name: "special_day_dates",
      locationColumns: ["location_id"],
    });
    expect(names.indexOf("special_days")).toBeLessThan(names.indexOf("special_day_dates"));
    expect(names.indexOf("special_day_dates")).toBeLessThan(names.indexOf("department_days"));
    expect(names.indexOf("special_day_dates")).toBeLessThan(names.indexOf("zone_days"));
  });

  it("accepts paint, a Closed range, open zone time and a Closed-all-day date", () => {
    expect(() => validate(specialTables(), clock)).not.toThrow();
  });

  it.each([
    ["special_days.name", "special_days", { name: "  " }],
    ["special_days.name", "special_days", { name: 3 }],
    ["special_days.name", "special_days", { name: " Fiesta " }],
    ["special_days.repeats_yearly", "special_days", { repeats_yearly: 2 }],
    ["special_days.repeats_yearly", "special_days", { repeats_yearly: true }],
    ["special_days.repeats_yearly", "special_days", { repeats_yearly: null }],
    ["special_day_dates.special_day_id", "special_day_dates", { special_day_id: "missing" }],
    ["special_day_dates.date", "special_day_dates", { date: "2025-02-30" }],
    ["special_day_dates.closed_all_day", "special_day_dates", { closed_all_day: 2 }],
    ["special_day_dates.closed_all_day", "special_day_dates", { closed_all_day: null }],
  ])("refuses %s when a row holds %s %j", (field, table, change) => {
    const tables = specialTables();
    Object.assign(tables[table]![0]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(field));
  });

  it("refuses two special-day dates on one date, a one-off on a repeating date's later year, but not before it begins", () => {
    const twice = specialTables();
    twice.special_days!.push({ id: "other", location_id: "venue", name: "Other" });
    twice.special_day_dates!.push({
      id: "other-15",
      special_day_id: "other",
      location_id: "venue",
      date: "2027-08-15",
      closed_all_day: 0,
    });
    expect(() => validate(twice, clock)).toThrowError(refusal("special_day_dates.date"));
    twice.special_day_dates![2]!.date = "2024-08-15";
    expect(() => validate(twice, clock)).not.toThrow();
    const oneOffs = specialTables();
    oneOffs.special_days![0]!.repeats_yearly = 0;
    oneOffs.special_day_dates![1]!.date = "2025-08-15";
    expect(() => validate(oneOffs, clock)).toThrowError(refusal("special_day_dates.date"));
    // The import gives every location column the importing venue's location.
    oneOffs.special_day_dates![1]!.location_id = "elsewhere";
    expect(() => validate(oneOffs, clock)).toThrowError(refusal("special_day_dates.date"));
    twice.special_day_dates![2]!.date = "2027-08-15";
    twice.special_day_dates![2]!.location_id = "elsewhere";
    expect(() => validate(twice, clock)).toThrowError(refusal("special_day_dates.date"));
  });

  it("refuses a holiday name that is not a name, and takes one or none", () => {
    for (const holidayName of ["", "  ", 3])
      expect(() =>
        validate(
          {
            ...specialTables(),
            special_day_dates: specialTables().special_day_dates!.map((row, i) =>
              i === 0 ? { ...row, holiday_name: holidayName } : row,
            ),
          },
          clock,
        ),
      ).toThrowError(refusal("special_day_dates.holiday_name"));
    for (const holidayName of ["Asunción de la Virgen", null]) {
      const tables = specialTables();
      tables.special_day_dates![0]!.holiday_name = holidayName;
      expect(() => validate(tables, clock)).not.toThrow();
    }
  });

  it("compares a repeating holiday date in its first year only, as the bundle carries no holiday lists", () => {
    const tables = specialTables();
    tables.special_day_dates![0]!.holiday_name = "Asunción de la Virgen";
    tables.special_days!.push({ id: "other", location_id: "venue", name: "Other" });
    tables.special_day_dates!.push({
      id: "other-15",
      special_day_id: "other",
      location_id: "venue",
      date: "2027-08-15",
      closed_all_day: 0,
    });
    expect(() => validate(tables, clock)).not.toThrow();
    tables.special_day_dates![2]!.date = "2025-08-15";
    expect(() => validate(tables, clock)).toThrowError(refusal("special_day_dates.date"));
  });

  it.each([
    ["department_days", "weekday", { weekday: 3 }],
    ["department_days", "season_id", { season_id: "s-autumn" }],
    ["zone_days", "weekday", { weekday: 3 }],
    ["zone_days", "season_id", { season_id: "s-autumn" }],
  ])("refuses a special-day %s row with a %s", (table, field, change) => {
    const tables = specialTables();
    tables.seasons = [
      {
        id: "s-autumn",
        location_id: "venue",
        name: "Autumn",
        starts_on: "09-01",
        colour: "orange",
      },
    ];
    Object.assign(tables[table]![0]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(`${table}.${field}`));
  });

  it("refuses a second day for one department or zone on one special-day date", () => {
    const departments = specialTables();
    departments.department_days!.push({ ...departments.department_days![0]!, id: "dd-again" });
    expect(() => validate(departments, clock)).toThrowError(
      refusal("department_days.special_day_date_id"),
    );
    const zones = specialTables();
    zones.zone_days!.push({ ...zones.zone_days![0]!, id: "zd-again" });
    expect(() => validate(zones, clock)).toThrowError(refusal("zone_days.special_day_date_id"));
  });

  it("refuses special-day paint a writer could not have saved", () => {
    const foreign = specialTables();
    foreign.department_day_ranges![0]!.period_id = "66666666-6666-4666-8666-666666666666";
    expect(() => validate(foreign, clock)).toThrowError(refusal("department_day_ranges.period_id"));
    const overlap = specialTables();
    overlap.department_day_ranges!.push(range("dd-15", LUNCH, "15:00:00", "17:00:00"));
    expect(() => validate(overlap, clock)).toThrowError(refusal("department_day_ranges"));
    const offStep = specialTables();
    offStep.department_day_ranges![0]!.starts_at = "20:10:00";
    expect(() => validate(offStep, clock)).toThrowError(refusal("department_day_ranges"));
    const kind = specialTables();
    kind.zone_day_ranges![0]!.kind = "half";
    expect(() => validate(kind, clock)).toThrowError(refusal("zone_day_ranges.kind"));
    const zoneOverlap = specialTables();
    zoneOverlap.zone_day_ranges!.push({
      id: "zr-again",
      day_id: "zd-15",
      kind: "closed",
      starts_at: "13:00:00",
      ends_at: "15:00:00",
    });
    expect(() => validate(zoneOverlap, clock)).toThrowError(refusal("zone_day_ranges"));
  });

  // With the 06:00 changeover, 02:15 on Sunday 29 March 2026 belongs to business day 28 March and
  // does not happen in Madrid; in 2025 the clocks changed on 30 March and in 2027 on 28 March.
  it("refuses paint starting at a time the clocks skip on its date, a repeating date at its next occurrence from the bundle's creation", () => {
    expect(() => validate(painted("2026-03-28", 0, "02:15:00", "03:00:00"), clock)).toThrowError(
      refusal("department_day_ranges"),
    );
    expect(() => validate(painted("2026-03-29", 0, "02:15:00", "03:00:00"), clock)).not.toThrow();
    const repeating = painted("2025-03-28", 1, "02:15:00", "03:00:00");
    expect(() => validate(repeating, clock)).not.toThrow();
    expect(() =>
      validate(repeating, { ...clock, createdAt: new Date("2026-01-10T10:00:00Z") }),
    ).toThrowError(refusal("department_day_ranges"));
    const zone = painted("2026-03-28", 0, "22:00:00", "03:00:00");
    zone.zone_days = specialTables().zone_days!;
    zone.zone_day_ranges = [
      { id: "zr", day_id: "zd-15", kind: "closed", starts_at: "02:15:00", ends_at: "03:00:00" },
    ];
    zone.special_day_dates![0]!.id = "fiesta-15";
    expect(() => validate(zone, clock)).toThrowError(refusal("zone_day_ranges"));
  });

  /** `painted` on Friday 20 November 2026 with the terrace closed `startsAt`–`endsAt`; with
   *  `season`, an Autumn season opening Bar 20:00–23:00 on Fridays. */
  function zoneClosedOn(paint: Row[], startsAt: string, endsAt: string, season: boolean): Tables {
    const tables = painted("2026-11-20", 0, "20:00:00", "23:00:00");
    tables.department_day_ranges = paint;
    if (season) {
      tables.seasons = [
        {
          id: "s-autumn",
          location_id: "venue",
          name: "Autumn",
          starts_on: "09-01",
          colour: "orange",
        },
      ];
      tables.department_days!.push({
        id: "a-fri",
        department_id: RESTAURANT,
        season_id: "s-autumn",
        weekday: 5,
        special_day_date_id: null,
      });
      tables.department_day_ranges.push(range("a-fri", BAR_PERIOD, "20:00:00", "23:00:00"));
    }
    tables.zone_days = specialTables().zone_days!;
    tables.zone_day_ranges = [
      { id: "zr", day_id: "zd-15", kind: "closed", starts_at: startsAt, ends_at: endsAt },
    ];
    return tables;
  }

  it("refuses a zone's special-date closure outside the department's hours on that date", () => {
    const paint = () => [range("dd-15", BAR_PERIOD, "20:00:00", "23:00:00")];
    expect(() =>
      validate(zoneClosedOn(paint(), "18:00:00", "19:00:00", false), clock),
    ).toThrowError(refusal("zone_day_ranges"));
    expect(() =>
      validate(zoneClosedOn(paint(), "21:00:00", "22:00:00", false), clock),
    ).not.toThrow();
  });

  it("accepts a zone closure outside the season week but inside the department's special-date paint", () => {
    const tables = zoneClosedOn(
      [range("dd-15", BAR_PERIOD, "18:00:00", "23:00:00")],
      "18:00:00",
      "19:00:00",
      true,
    );
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("refuses a zone closure inside the season week but under the department's Closed special-date paint", () => {
    const tables = zoneClosedOn(
      [range("dd-15", null, "21:00:00", "22:00:00")],
      "21:00:00",
      "22:00:00",
      true,
    );
    expect(() => validate(tables, clock)).toThrowError(refusal("zone_day_ranges"));
  });

  it("checks a zone's special-date closure against its department's season week on that date's weekday", () => {
    const tables = zoneClosedOn([], "21:00:00", "22:00:00", true);
    expect(() => validate(tables, clock)).not.toThrow();
    tables.special_day_dates![0]!.date = "2026-11-19";
    expect(() => validate(tables, clock)).toThrowError(refusal("zone_day_ranges"));
  });

  it("does not check a zone's closure on a date closed all day", () => {
    const tables = zoneClosedOn([], "18:00:00", "19:00:00", false);
    tables.special_day_dates![0]!.closed_all_day = 1;
    expect(() => validate(tables, clock)).not.toThrow();
  });

  // 02:30 on 29 March 2026 does not happen in Madrid, but `clockTimeSkippedInDay`, the writer's
  // check, reads an end at the changeover as the day's own end.
  it("accepts paint ending at the changeover on the night the clocks skip it", () => {
    const tables = painted("2026-03-28", 0, "22:00:00", "02:30:00");
    expect(() => validate(tables, { ...clock, dayCutover: "02:30" })).not.toThrow();
  });

  it("refuses paint whose period's end offset reaches the next day's paint", () => {
    const tables = painted("2026-11-23", 0, "22:00:00", "02:00:00");
    tables.special_day_dates!.push({
      id: "fiesta-24",
      special_day_id: "fiesta",
      location_id: "venue",
      date: "2026-11-24",
      closed_all_day: 0,
    });
    tables.department_days!.push({
      id: "dd-24",
      department_id: RESTAURANT,
      season_id: null,
      weekday: null,
      special_day_date_id: "fiesta-24",
    });
    tables.department_day_ranges!.push(range("dd-24", LUNCH, "06:00:00", "09:00:00"));
    tables.menu_periods![0]!.end_offset_minutes = 240;
    expect(() => validate(tables, clock)).toThrowError(refusal("department_day_ranges"));
    tables.menu_periods![0]!.end_offset_minutes = 239;
    expect(() => validate(tables, clock)).not.toThrow();
  });
});

it("leaves per-device zone choices outside the configuration transfer descriptor", () => {
  const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
  expect(names).toContain("device_profile_service_access");
  expect(names).toContain("device_profile_zones");
  expect(names).not.toContain("device_zone_selections");
  expect(names).not.toContain("device_zone_selection_zones");
});
