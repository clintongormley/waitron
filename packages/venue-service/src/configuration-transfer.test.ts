import { CORE_CONFIGURATION_TRANSFER } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
  validateHolidayConfiguration,
  validateMenuTimetables,
  validateRoutingConfiguration,
} from "./configuration-transfer.js";
import { MAX_SERVICE_STEPS } from "./service-step-limits.js";

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
    timeZones: ["Europe/Madrid"],
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

const holidayArea = (): Row => ({
  country: "ZZ",
  provinceCode: "30",
  cityKey: "villa real",
  areaKey: "isle-a",
});

describe("validateHolidayConfiguration", () => {
  it("accepts a chosen area and an absent holiday area", () => {
    expect(() => validateHolidayConfiguration(holidayArea(), packs(2))).not.toThrow();
    expect(() => validateHolidayConfiguration(null, packs(2))).not.toThrow();
  });
  it("accepts a place with no choice when its country has no holiday capability", () => {
    expect(() =>
      validateHolidayConfiguration({ ...holidayArea(), country: "ZY", areaKey: null }, packs(2)),
    ).not.toThrow();
  });
  it.each<[string, Row, string]>([
    ["an unknown country", { country: "QQ" }, "country"],
    ["a country not spelled as its pack's code", { country: "zz" }, "country"],
    ["an unknown province", { provinceCode: "99" }, "provinceCode"],
    ["a province name instead of code", { provinceCode: "Northshire" }, "provinceCode"],
    ["an unknown area", { areaKey: "isle-z" }, "areaKey"],
    ["an area on a province that has none", { provinceCode: "10" }, "areaKey"],
    ["an area of a country without a holiday capability", { country: "ZY" }, "areaKey"],
  ])("refuses %s", (_name, fields, field) => {
    expect(() =>
      validateHolidayConfiguration({ ...holidayArea(), ...fields }, packs(2)),
    ).toThrowError(refusal(`holidayArea.${field}`));
  });
  it("accepts a city key of any length", () => {
    expect(() =>
      validateHolidayConfiguration({ ...holidayArea(), cityKey: "v".repeat(5000) }, packs(2)),
    ).not.toThrow();
  });
  it("is run by the venue-service transfer's validate callback", () => {
    const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
    const context = {
      createdAt: new Date("2026-11-10T10:00:00Z"),
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      holidayArea: holidayArea(),
    };
    expect(() => validate({}, context)).toThrowError(refusal("holidayArea.country"));
    expect(() =>
      validate(
        {},
        {
          ...context,
          holidayArea: { country: "ES", provinceCode: "25", cityKey: "vielha", areaKey: "aran" },
        },
      ),
    ).not.toThrow();
  });
  it("excludes holiday geographies and the retired local entries from transferred tables", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names.at(-1)).toBe("opening_hours");
    expect(names).not.toContain("holiday_geographies");
    expect(names).not.toContain("local_holidays");
  });
});

describe("the menu timetable rows of a bundle", () => {
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
      floor_zones: [{ id: BARRA, active: 1, department_id: RESTAURANT }],

      menus: [{ id: "m-desayunos" }, { id: "m-copas" }, { id: "m-cafe" }, { id: "m-deli" }],
      menu_periods: [
        {
          id: MANANAS,
          department_id: RESTAURANT,
          name: "Mañanas",
          colour: "blue",
          menu_id: "m-desayunos",
          staff_menu_ids: '["m-cafe"]',
          floor_plan_set_id: "s-dinner",
        },
        {
          id: MADRUGADA,
          department_id: RESTAURANT,
          name: "Madrugada",
          colour: "red",
          menu_id: "m-copas",
          staff_menu_ids: "[]",
        },
        {
          id: DELI_PERIOD,
          department_id: DELI,
          name: "Mañanas",
          colour: "blue",
          menu_id: "m-deli",
          staff_menu_ids: "[]",
        },
      ],
      floor_plan_sets: [
        { id: "s-standard", department_id: RESTAURANT, name: "Standard", is_default: 1 },
        { id: "s-dinner", department_id: RESTAURANT, name: "Dinner", is_default: 0 },
        { id: "s-deli", department_id: DELI, name: "Standard", is_default: 1 },
      ],
    };
  }
  const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
  const madrid = (createdAt: string) => ({
    createdAt: new Date(createdAt),
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  });

  it("transfers each period with its staff-menu JSON references after departments", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    const at = names.indexOf("menu_periods");
    expect(names.filter((name) => name === "menu_periods")).toHaveLength(1);
    expect(
      VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "menu_periods"),
    ).toMatchObject({ jsonReferences: [{ column: "staff_menu_ids", paths: [["*"]] }] });
    expect(at).toBeGreaterThan(names.indexOf("departments"));
  });

  it("transfers floor sets once through core and periods through venue-service", () => {
    const coreNames = CORE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    const moduleNames = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(coreNames.filter((name) => name === "floor_plan_sets")).toHaveLength(1);
    expect(moduleNames).not.toContain("floor_plan_sets");
    expect(moduleNames).toContain("menu_periods");
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
      "a staff menu the bundle does not hold",
      (t: Tables) => {
        t.menu_periods![0]!.staff_menu_ids = '["m-gone"]';
      },
      "menu_periods.staff_menu_ids",
    ],
    [
      "a set menu as the customer menu",
      (t: Tables) => {
        t.menus!.find(({ id }) => id === "m-desayunos")!.kind = "set_menu";
      },
      "menu_periods.menu_id",
    ],
    [
      "a set menu as a staff menu",
      (t: Tables) => {
        t.menus!.find(({ id }) => id === "m-cafe")!.kind = "set_menu";
      },
      "menu_periods.staff_menu_ids",
    ],
    [
      "a floor plan set of a department the bundle lacks",
      (t: Tables) => {
        t.floor_plan_sets![2]!.department_id = "d-gone";
      },
      "floor_plan_sets.department_id",
    ],
    [
      "a floor plan set name its department uses twice",
      (t: Tables) => {
        t.floor_plan_sets![1]!.name = "Standard";
      },
      "floor_plan_sets.name",
    ],
    [
      "a department whose floor plan sets have no default",
      (t: Tables) => {
        t.floor_plan_sets![0]!.is_default = 0;
      },
      "floor_plan_sets.is_default",
    ],
    [
      "a department with two default floor plan sets",
      (t: Tables) => {
        t.floor_plan_sets![1]!.is_default = 1;
      },
      "floor_plan_sets.is_default",
    ],
    [
      "a period naming another department's floor plan set",
      (t: Tables) => {
        t.menu_periods![0]!.floor_plan_set_id = "s-deli";
      },
      "menu_periods.floor_plan_set_id",
    ],
    [
      "a period naming a floor plan set no department holds",
      (t: Tables) => {
        t.menu_periods![0]!.floor_plan_set_id = "s-gone";
      },
      "menu_periods.floor_plan_set_id",
    ],
  ])("refuse %s", (_, edit, field) => {
    const tables = menuTables();
    edit(tables);
    expect(() => validateMenuTimetables(tables)).toThrowError(refusal(field));
  });
});

describe("department transfer settings in a configuration bundle", () => {
  const valid = (): Tables => ({
    departments: [{ id: RESTAURANT, transfer_desk_profile_id: "receiving-profile" }, { id: DELI }],
    device_profiles: [{ id: "receiving-profile" }],
    department_transfer_destinations: [
      { source_department_id: DELI, destination_department_id: RESTAURANT },
    ],
  });
  it("accepts retained directional settings and a bundle without transfer settings", () => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(valid())).not.toThrow();
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({})).not.toThrow();
  });
  it.each([
    ["departments", "transfer_desk_profile_id", "missing"],
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
  it.each(["department_transfer_destinations"])("refuses duplicate %s rows", (table) => {
    const tables = valid();
    tables[table]!.push({ ...tables[table]![0]! });
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).toThrowError(
      refusal(table),
    );
  });
});

describe("validateRoutingConfiguration", () => {
  const TERRACE = "z-terrace";
  const INSIDE = "z-inside"; // in the deli, which is switched off
  const CLOSED_ZONE = "z-closed";
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
        { id: TERRACE, name: "Terrace", active: 1, department_id: RESTAURANT },
        { id: INSIDE, name: "Inside", active: 1, department_id: DELI },
        { id: CLOSED_ZONE, name: "Closed", active: 0, department_id: RESTAURANT },
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
        {
          id: LUNCH,
          department_id: RESTAURANT,
          name: "Lunch",
          menu_id: "m-empty",
          staff_menu_ids: "[]",
        },
        {
          id: BREAKFAST,
          department_id: DELI,
          name: "Breakfast",
          menu_id: "m-empty",
          staff_menu_ids: "[]",
        },
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

    it("refuses a period the bundle does not hold", () => {
      choiceRefused({ period: "mp-missing" }, "routing_cell_periods.period_id");
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
      floor_zones: [{ id: PATIO, name: "Patio", active: 1, department_id: DELI }],

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
      menus: [{ id: "customer" }, { id: "staff" }],
      menu_periods: [
        {
          id: periodId,
          department_id: RESTAURANT,
          name: "Night",
          colour: "blue",
          menu_id: "customer",
          staff_menu_ids: '["staff"]',
        },
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
    t.menu_periods![0]!.colour = "magenta";
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).not.toThrow();
  });
  it.each([
    [
      "a colour outside the palette",
      (t: Tables) => {
        t.menu_periods![0]!.colour = "beige";
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
        t.menu_periods![0]!.staff_menu_ids = '["gone"]';
      },
      "menu_periods.staff_menu_ids",
    ],
    [
      "the customer menu repeated as staff",
      (t: Tables) => {
        t.menu_periods![0]!.staff_menu_ids = '["customer"]';
      },
      "menu_periods.staff_menu_ids",
    ],
    [
      "a repeated staff menu",
      (t: Tables) => {
        t.menu_periods![0]!.staff_menu_ids = '["staff","staff"]';
      },
      "menu_periods.staff_menu_ids",
    ],
  ])("refuses %s", (_, edit, field) => {
    const t = tables();
    edit(t);
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(t, context)).toThrowError(
      refusal(field),
    );
  });
});

describe("configuration order starts", () => {
  it.each(["departments", "floor_zones"])("refuses malformed %s order starts", (table) => {
    for (const value of [
      "tab",
      "",
      ["table"],
      1,
      false,
      {},
      ...(table === "departments" ? [null] : []),
    ]) {
      expect(() =>
        VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
          departments: [{ id: RESTAURANT }],
          floor_zones: [{ id: "zone", department_id: RESTAURANT }],

          [table]: [
            {
              id: table === "departments" ? RESTAURANT : "zone",
              department_id: RESTAURANT,
              order_start: value,
            },
          ],
        }),
      ).toThrowError(refusal(`${table}.order_start`));
    }
  });
  it.each(["departments", "floor_zones"])(
    "accepts explicit and absent %s order starts",
    (table) => {
      for (const value of [
        "table",
        "counter",
        undefined,
        ...(table === "floor_zones" ? [null] : []),
      ]) {
        expect(() =>
          VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
            departments: [{ id: RESTAURANT }],
            floor_zones: [{ id: "zone", department_id: RESTAURANT }],

            [table]: [
              {
                department_id: RESTAURANT,
                id: table === "departments" ? RESTAURANT : "zone",
                ...(value === undefined ? {} : { order_start: value }),
              },
            ],
          }),
        ).not.toThrow();
      }
    },
  );
});

describe("configuration department dining", () => {
  const bundle = (row: Record<string, unknown>) => ({
    departments: [{ id: RESTAURANT, ...row }],
  });

  it.each([
    ["dining", ["sometimes", "", null, 1, ["eat_in"]]],
    ["dining_starts_as", ["till_choice", "sometimes", "", null, 1]],
  ] as const)("refuses a malformed %s", (column, values) => {
    for (const value of values) {
      expect(() =>
        VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(bundle({ [column]: value })),
      ).toThrowError(refusal(`departments.${column}`));
    }
  });

  it("accepts every stored value and a row without them", () => {
    for (const row of [
      {},
      { dining: "eat_in", dining_starts_as: "eat_in" },
      { dining: "takeaway", dining_starts_as: "takeaway" },
      { dining: "till_choice", dining_starts_as: "takeaway" },
    ]) {
      expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(bundle(row))).not.toThrow();
    }
  });
});

it.each([0, false])(
  "refuses a deleted department with active=%j even without children",
  (active) => {
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({ departments: [{ id: "old", active }] }),
    ).toThrowError(refusal("departments.active"));
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
        departments: [{ id: "live", active: 1 }],
      }),
    ).not.toThrow();
  },
);

it.each([["floor_zones", "department_id", { id: "z-live", department_id: "missing" }]])(
  "refuses a deleted hierarchy child %s.%s with an absent parent",
  (table, field, row) => {
    const tables = {
      departments: [{ id: RESTAURANT, active: 1 }],
      floor_zones: [{ id: "z-live", active: 1, department_id: RESTAURANT }],
      [table]: [row],
    };
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables)).toThrowError(
      refusal(`${table}.${field}`),
    );
  },
);

describe("season weeks in a configuration bundle", () => {
  const { validate } = VENUE_SERVICE_CONFIGURATION_TRANSFER;
  const LUNCH = "44444444-4444-4444-8444-444444444444";
  const LATE = "55555555-5555-4555-8555-555555555555";
  const clock = {
    createdAt: new Date("2026-10-07T10:00:00Z"),
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  };
  const range = (
    day: "w-fri" | "w-sat" | "a-fri" | "a-sat",
    periodId: string,
    startsAt: string,
    endsAt: string,
  ) => ({
    id: randomUUID(),
    department_id: RESTAURANT,
    zone_id: null,
    season_id: day.startsWith("w") ? "s-winter" : "s-autumn",
    weekday: day.endsWith("fri") ? 5 : 6,
    special_day_date_id: null,
    kind: "period",
    period_id: periodId,
    starts_at: startsAt,
    ends_at: endsAt,
  });

  /** Winter: Late 22:00–02:00 on Friday, Lunch 06:00–09:00 on Saturday. Autumn: Lunch on Saturday
   *  only. Terrace closes 23:00–02:00 on a Winter Friday. */
  function seasonTables(): Tables {
    return {
      departments: [{ id: RESTAURANT }],
      floor_zones: [{ id: "terrace", active: 1, department_id: RESTAURANT }],

      menus: [{ id: "m-lunch" }, { id: "m-late" }],
      menu_periods: [
        {
          id: LUNCH,
          department_id: RESTAURANT,
          name: "Lunch",
          colour: "blue",
          menu_id: "m-lunch",
          staff_menu_ids: "[]",
        },
        {
          id: LATE,
          department_id: RESTAURANT,
          name: "Late",
          colour: "red",
          menu_id: "m-late",
          staff_menu_ids: "[]",
        },
      ],
      seasons: [
        {
          id: "s-autumn",
          name: "Autumn",
          starts_on: "09-01",
          colour: "orange",
        },
        {
          id: "s-winter",
          name: "Winter",
          starts_on: "12-01",
          colour: "blue",
        },
      ],
      opening_hours: [
        {
          id: "z-fri-1",
          department_id: null,
          period_id: null,
          zone_id: "terrace",
          season_id: "s-winter",
          weekday: 5,
          special_day_date_id: null,
          kind: "closed",
          starts_at: "23:00:00",
          ends_at: "02:00:00",
        },
        range("w-fri", LATE, "22:00:00", "02:00:00"),
        range("w-sat", LUNCH, "06:00:00", "09:00:00"),
        range("a-sat", LUNCH, "06:00:00", "09:00:00"),
      ],
    };
  }

  it("accepts department opening_hours ranges and refuses a period from another department", () => {
    const tables = seasonTables();
    tables.opening_hours = tables.opening_hours!.filter((row) => row.zone_id !== null);
    tables.opening_hours!.push({
      id: "department-range",
      department_id: RESTAURANT,
      zone_id: null,
      season_id: "s-autumn",
      weekday: 5,
      special_day_date_id: null,
      kind: "period",
      period_id: LUNCH,
      starts_at: "12:00:00",
      ends_at: "14:00:00",
    });
    expect(() => validate(tables, clock)).not.toThrow();
    tables.departments!.push({ id: DELI });
    tables.opening_hours![1]!.department_id = DELI;
    expect(() => validate(tables, clock)).toThrowError(refusal("opening_hours.period_id"));
  });

  it("accepts raw zone closures beyond department hours", () => {
    const tables = seasonTables();
    tables.opening_hours![0]!.ends_at = "04:00:00";
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("are transferred after the periods and zone policies they name, parents first", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    const at = names.indexOf("seasons");
    expect(names.slice(at, at + 2)).toEqual(["seasons", "opening_hours"]);
    expect(at).toBeGreaterThan(names.indexOf("menu_periods"));
    expect(at).toBeGreaterThan(names.indexOf("departments"));
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables[at]).toEqual({
      name: "seasons",
    });
  });

  it("accepts rows the week writers could have written, and a bundle with none", () => {
    expect(() => validate(seasonTables(), clock)).not.toThrow();
    expect(() => validate({}, clock)).not.toThrow();
  });

  it("refuses a range off the quarter-hour at its table", () => {
    const tables = seasonTables();
    tables.opening_hours![2]!.starts_at = "13:10:00";
    tables.opening_hours![2]!.ends_at = "14:00:00";
    expect(() => validate(tables, clock)).toThrowError(refusal("opening_hours"));
  });

  it("refuses a department range whose kind does not match its period", () => {
    const tables = seasonTables();
    tables.opening_hours!.find((row) => row.department_id === RESTAURANT)!.kind = "open";
    expect(() => validate(tables, clock)).toThrowError(refusal("opening_hours.kind"));
  });

  it("refuses overlapping ranges on one season's day, but not the same hours in two seasons", () => {
    const tables = seasonTables();
    tables.opening_hours!.push(range("w-sat", LATE, "08:00:00", "10:00:00"));
    expect(() => validate(tables, clock)).toThrowError(refusal("opening_hours"));
    const apart = seasonTables();
    apart.opening_hours!.push(range("a-fri", LATE, "22:00:00", "02:00:00"));
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
    const yellow = seasonTables();
    yellow.seasons![0]!.colour = "yellow";
    expect(() => validate(yellow, clock)).not.toThrow();
  });

  it.each([
    ["opening_hours", "season_id", { season_id: "missing" }],
    ["opening_hours", "department_id", { department_id: "missing" }],
    ["opening_hours", "weekday", { weekday: 7 }],
    ["opening_hours", "weekday", { weekday: null }],
    ["opening_hours", "special_day_date_id", { special_day_date_id: "sd-1" }],
  ])("refuses a department day whose %s.%s is %j", (table, field, change) => {
    const tables = seasonTables();
    Object.assign(tables.opening_hours![1]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(`${table}.${field}`));
  });

  it.each([
    ["season_id", { season_id: "missing" }],
    ["department_id", { department_id: DELI }],
    ["period_id", { period_id: null }],
    ["period_id", { period_id: "66666666-6666-4666-8666-666666666666" }],
    ["starts_at", { starts_at: "6:00" }],
    ["ends_at", { ends_at: "24:00:00" }],
  ])("refuses a department range whose %s is wrong", (field, change) => {
    const tables = seasonTables();
    tables.departments!.push({ id: DELI });
    Object.assign(tables.opening_hours![2]!, change);
    expect(() => validate(tables, clock)).toThrowError(
      refusal(`opening_hours.${field === "department_id" ? "period_id" : field}`),
    );
  });

  it.each([
    ["opening_hours.zone_id", "opening_hours", { zone_id: "missing" }],
    ["opening_hours.season_id", "opening_hours", { season_id: "missing" }],
    ["opening_hours.weekday", "opening_hours", { weekday: -1 }],
    ["opening_hours.special_day_date_id", "opening_hours", { special_day_date_id: "sd-1" }],
    ["opening_hours.period_id", "opening_hours", { period_id: "missing" }],
    ["opening_hours.department_id", "opening_hours", { department_id: RESTAURANT }],
    ["opening_hours.kind", "opening_hours", { kind: "open" }],
    ["opening_hours.starts_at", "opening_hours", { starts_at: "23:00" }],
    ["opening_hours", "opening_hours", { ends_at: "23:10:00" }],
  ])("refuses a zone row with a wrong %s", (field, table, change) => {
    const tables = seasonTables();
    Object.assign(tables[table]![0]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(field));
  });

  it("accepts zone season closures when the department has no hours", () => {
    const tables = seasonTables();
    delete tables.menu_periods;
    tables.opening_hours = tables.opening_hours!.filter((row) => row.zone_id !== null);
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("accepts a zone season week with no closures in a bundle with no periods", () => {
    const tables = seasonTables();
    delete tables.menu_periods;
    tables.opening_hours = tables.opening_hours!.filter((row) => row.zone_id !== null);
    tables.opening_hours = [];
    expect(() => validate(tables, clock)).not.toThrow();
  });

  it("refuses season weeks without the bundle's changeover", () => {
    expect(() => validate(seasonTables())).toThrowError(refusal("opening_hours"));
    const zoneOnly = seasonTables();
    zoneOnly.opening_hours = zoneOnly.opening_hours!.filter((row) => row.zone_id !== null);
    expect(() => validate(zoneOnly)).toThrowError(refusal("opening_hours"));
  });
});

describe("department receipt configuration fields", () => {
  it.each([7, [], "x".repeat(501), "bad\u0000text"])(
    "refuses an invalid operation-description column %j",
    (operation_description) => {
      expect(() =>
        VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
          departments: [{ id: RESTAURANT, active: 1, operation_description }],
        }),
      ).toThrowError(refusal("departments.operation_description"));
    },
  );
  it.each([null, "", "Dining service", "x".repeat(500)])(
    "accepts an operation-description column %j without saved receipt text",
    (operation_description) => {
      expect(() =>
        VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
          departments: [{ id: RESTAURANT, active: 1, operation_description, receipt_text: null }],
        }),
      ).not.toThrow();
    },
  );
  it.each([
    { logo: "old-name.png" },
    { unknown: true },
    { operationDescription: "Old receipt text" },
  ])("refuses keys that are not receipt text: %j", (receipt_text) => {
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
        departments: [{ id: RESTAURANT, active: 1, receipt_text }],
      }),
    ).toThrowError(refusal("departments.receipt_text"));
  });

  function tables(receipt: unknown): Tables {
    return {
      departments: [{ id: RESTAURANT, active: 1, receipt_text: receipt }],
    };
  }
  it("accepts a department with no saved receipt text", () => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(null))).not.toThrow();
  });
  it.each([{}, { printAddress: false }, { printAddress: true }])(
    "accepts own receipt fields %j as an object or stored JSON",
    (receipt) => {
      expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(receipt))).not.toThrow();
      expect(() =>
        VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(JSON.stringify(receipt))),
      ).not.toThrow();
    },
  );
  it.each([
    ["null"],
    [[]],
    ["{bad"],
    [3],
    [{ printAddress: null }],
    [{ printAddress: "false" }],
    [{ printAddress: 0 }],
    [{ operationDescription: null }],
  ])("refuses invalid receipt configuration %j", (receipt) => {
    expect(() => VENUE_SERVICE_CONFIGURATION_TRANSFER.validate(tables(receipt))).toThrowError(
      refusal("departments.receipt_text"),
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
    dateId: string,
    periodId: string | null,
    startsAt: string,
    endsAt: string,
  ): Row => ({
    id: randomUUID(),
    department_id: RESTAURANT,
    zone_id: null,
    season_id: null,
    weekday: null,
    special_day_date_id: dateId,
    kind: periodId === null ? "closed" : "period",
    period_id: periodId,
    starts_at: startsAt,
    ends_at: endsAt,
  });

  /** Fiesta repeats from 15 August 2025: Bar 20:00–23:00 and Closed 12:00–16:00 in the
   *  restaurant, the terrace open 12:00–14:00; 16 August is Closed all day. */
  function specialTables(): Tables {
    return {
      departments: [{ id: RESTAURANT }],
      floor_zones: [{ id: "terrace", active: 1, department_id: RESTAURANT }],

      menus: [{ id: "m-bar" }, { id: "m-lunch" }],
      menu_periods: [
        {
          id: BAR_PERIOD,
          department_id: RESTAURANT,
          name: "Bar",
          colour: "red",
          menu_id: "m-bar",
          staff_menu_ids: "[]",
        },
        {
          id: LUNCH,
          department_id: RESTAURANT,
          name: "Lunch",
          colour: "blue",
          menu_id: "m-lunch",
          staff_menu_ids: "[]",
        },
      ],
      special_days: [{ id: "fiesta", name: "Fiesta", repeats_yearly: 1 }],
      special_day_dates: [
        {
          id: "fiesta-15",
          special_day_id: "fiesta",
          date: "2025-08-15",
          closed_all_day: 0,
        },
        {
          id: "fiesta-16",
          special_day_id: "fiesta",
          date: "2025-08-16",
          closed_all_day: 1,
        },
      ],
      opening_hours: [
        {
          id: "zr-15",
          department_id: null,
          period_id: null,
          zone_id: "terrace",
          season_id: null,
          weekday: null,
          special_day_date_id: "fiesta-15",
          kind: "open",
          starts_at: "12:00:00",
          ends_at: "14:00:00",
        },
        range("fiesta-15", BAR_PERIOD, "20:00:00", "23:00:00"),
        range("fiesta-15", null, "12:00:00", "16:00:00"),
      ],
    };
  }

  /** One special day `repeats` or not, on `date`, painting Bar over `startsAt`–`endsAt`. */
  function painted(date: string, repeats: number, startsAt: string, endsAt: string): Tables {
    const tables = specialTables();
    tables.special_days![0]!.repeats_yearly = repeats;
    tables.special_day_dates = [tables.special_day_dates![0]!];
    tables.special_day_dates[0]!.date = date;
    tables.opening_hours = [range("fiesta-15", BAR_PERIOD, startsAt, endsAt)];
    return tables;
  }

  it("are transferred under the importing venue before the days that name their dates", () => {
    const tables = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables;
    const names = tables.map((table) => table.name);
    expect(tables.find((table) => table.name === "special_days")).toEqual({
      name: "special_days",
    });
    expect(tables.find((table) => table.name === "special_day_dates")).toEqual({
      name: "special_day_dates",
    });
    expect(names.indexOf("special_days")).toBeLessThan(names.indexOf("special_day_dates"));
    expect(names.indexOf("special_day_dates")).toBeLessThan(names.indexOf("opening_hours"));
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
    twice.special_days!.push({ id: "other", name: "Other" });
    twice.special_day_dates!.push({
      id: "other-15",
      special_day_id: "other",
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
    twice.special_day_dates![2]!.date = "2027-08-15";
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
    tables.special_days!.push({ id: "other", name: "Other" });
    tables.special_day_dates!.push({
      id: "other-15",
      special_day_id: "other",
      date: "2027-08-15",
      closed_all_day: 0,
    });
    expect(() => validate(tables, clock)).not.toThrow();
    tables.special_day_dates![2]!.date = "2025-08-15";
    expect(() => validate(tables, clock)).toThrowError(refusal("special_day_dates.date"));
  });

  it.each([
    ["opening_hours", "weekday", { weekday: 3 }],
    ["opening_hours", "season_id", { season_id: "s-autumn" }],
    ["opening_hours", "weekday", { weekday: 3 }],
    ["opening_hours", "season_id", { season_id: "s-autumn" }],
  ])("refuses a special-day %s row with a %s", (table, field, change) => {
    const tables = specialTables();
    tables.seasons = [
      {
        id: "s-autumn",
        name: "Autumn",
        starts_on: "09-01",
        colour: "orange",
      },
    ];
    Object.assign(tables[table]![0]!, change);
    expect(() => validate(tables, clock)).toThrowError(refusal(`${table}.${field}`));
  });

  it("accepts several department and zone ranges on one date, and refuses overlapping ranges", () => {
    const departments = specialTables();
    departments.opening_hours!.push({
      ...departments.opening_hours![1]!,
      id: "dd-again",
      starts_at: "16:00:00",
      ends_at: "18:00:00",
    });
    expect(() => validate(departments, clock)).not.toThrow();
    departments.opening_hours!.at(-1)!.starts_at = "21:00:00";
    expect(() => validate(departments, clock)).toThrowError(refusal("opening_hours"));
    const zones = specialTables();
    zones.opening_hours!.push({
      ...zones.opening_hours![0]!,
      id: "zr-again",
      starts_at: "15:00:00",
      ends_at: "16:00:00",
    });
    expect(() => validate(zones, clock)).not.toThrow();
  });

  it("refuses special-day paint a writer could not have saved", () => {
    const foreign = specialTables();
    foreign.opening_hours![1]!.period_id = "66666666-6666-4666-8666-666666666666";
    expect(() => validate(foreign, clock)).toThrowError(refusal("opening_hours.period_id"));
    const overlap = specialTables();
    overlap.opening_hours!.push(range("fiesta-15", LUNCH, "15:00:00", "17:00:00"));
    expect(() => validate(overlap, clock)).toThrowError(refusal("opening_hours"));
    const offStep = specialTables();
    offStep.opening_hours![1]!.starts_at = "20:10:00";
    expect(() => validate(offStep, clock)).toThrowError(refusal("opening_hours"));
    const kind = specialTables();
    kind.opening_hours![0]!.kind = "half";
    expect(() => validate(kind, clock)).toThrowError(refusal("opening_hours.kind"));
    const zoneOverlap = specialTables();
    zoneOverlap.opening_hours!.push({
      id: "zr-again",
      department_id: null,
      period_id: null,
      zone_id: "terrace",
      season_id: null,
      weekday: null,
      special_day_date_id: "fiesta-15",
      kind: "closed",
      starts_at: "13:00:00",
      ends_at: "15:00:00",
    });
    expect(() => validate(zoneOverlap, clock)).toThrowError(refusal("opening_hours"));
  });

  // With the 06:00 changeover, 02:15 on Sunday 29 March 2026 belongs to business day 28 March and
  // does not happen in Madrid; in 2025 the clocks changed on 30 March and in 2027 on 28 March.
  it("refuses paint starting at a time the clocks skip on its date, a repeating date at its next occurrence from the bundle's creation", () => {
    expect(() => validate(painted("2026-03-28", 0, "02:15:00", "03:00:00"), clock)).toThrowError(
      refusal("opening_hours"),
    );
    expect(() => validate(painted("2026-03-29", 0, "02:15:00", "03:00:00"), clock)).not.toThrow();
    const repeating = painted("2025-03-28", 1, "02:15:00", "03:00:00");
    expect(() => validate(repeating, clock)).not.toThrow();
    expect(() =>
      validate(repeating, { ...clock, createdAt: new Date("2026-01-10T10:00:00Z") }),
    ).toThrowError(refusal("opening_hours"));
    const zone = painted("2026-03-28", 0, "22:00:00", "03:00:00");
    zone.opening_hours = [
      {
        id: "zr",
        department_id: null,
        period_id: null,
        zone_id: "terrace",
        season_id: null,
        weekday: null,
        special_day_date_id: "fiesta-15",
        kind: "closed",
        starts_at: "02:15:00",
        ends_at: "03:00:00",
      },
    ];
    zone.special_day_dates![0]!.id = "fiesta-15";
    expect(() => validate(zone, clock)).toThrowError(refusal("opening_hours"));
  });

  it("accepts special-date closure tails independently of department paint", () => {
    const tables = painted("2026-11-20", 0, "20:00:00", "23:00:00");
    tables.opening_hours = [
      {
        id: "zr",
        department_id: null,
        period_id: null,
        zone_id: "terrace",
        season_id: null,
        weekday: null,
        special_day_date_id: "fiesta-15",
        kind: "closed",
        starts_at: "18:00:00",
        ends_at: "05:00:00",
      },
    ];
    expect(() => validate(tables, clock)).not.toThrow();
    tables.opening_hours = [range("fiesta-15", null, "18:00:00", "05:00:00")];
    expect(() => validate(tables, clock)).not.toThrow();
  });

  // 02:30 on 29 March 2026 does not happen in Madrid, but `clockTimeSkippedInDay`, the writer's
  // check, reads an end at the changeover as the day's own end.
  it("accepts paint ending at the changeover on the night the clocks skip it", () => {
    const tables = painted("2026-03-28", 0, "22:00:00", "02:30:00");
    expect(() => validate(tables, { ...clock, dayCutover: "02:30" })).not.toThrow();
  });
});

it("leaves per-device zone choices outside the configuration transfer descriptor", () => {
  const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
  expect(
    CORE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "device_profiles"),
  ).toHaveProperty("jsonReferences", [
    { column: "order_zone_ids", paths: [["*"]] },
    {
      column: "printer_lists",
      paths: [
        ["*", "ids", "*"],
        ["*", "defaultId"],
      ],
    },
  ]);
  expect(names).not.toContain("device_zone_selections");
  expect(names).not.toContain("device_zone_selection_zones");
});

describe("validateServiceSteps", () => {
  const COURSE = "c-mains";
  const validate = VENUE_SERVICE_CONFIGURATION_TRANSFER.validate;

  function stepRow(overrides: Row): Row {
    return {
      id: randomUUID(),
      department_id: RESTAURANT,
      position: 0,
      name: "Set up",
      start: "seated",
      course_id: null,
      minutes: 0,
      ...overrides,
    };
  }

  function bundle(steps: Row[]): Tables {
    return {
      departments: [{ id: RESTAURANT }, { id: DELI }],
      kitchen_courses: [{ id: COURSE }],
      service_steps: steps,
    };
  }

  const starters = (): Row[] => [
    stepRow({ id: "setup", position: 0, name: "Set up", start: "seated", minutes: 0 }),
    stepRow({
      position: 1,
      name: "Take order",
      start: "after_step",
      after_step_id: "setup",
      minutes: 2,
    }),
    stepRow({ position: 2, name: "Anything else?", start: "all_served", minutes: 10 }),
  ];

  it("accepts the three starter rows and a course row", () => {
    const steps = [
      ...starters(),
      stepRow({
        position: 3,
        name: "Dessert?",
        start: "course_served",
        course_id: COURSE,
        minutes: 10,
      }),
      stepRow({ position: 4, name: "Check in", start: "since_last_order", minutes: 1 }),
    ];
    expect(() => validate(bundle(steps))).not.toThrow();
  });

  it("refuses a step of a department the bundle does not hold", () => {
    expect(() => validate(bundle([stepRow({ department_id: "d-gone" })]))).toThrowError(
      refusal("service_steps.department_id"),
    );
  });

  it.each<[string, Row]>([
    ["a course on a non-course start", { start: "seated", course_id: COURSE }],
    ["no course on a course start", { start: "course_served", course_id: null, minutes: 10 }],
    ["a course the bundle does not hold", { start: "course_served", course_id: "c-gone" }],
  ])("refuses %s", (_label, overrides) => {
    expect(() => validate(bundle([stepRow(overrides)]))).toThrowError(
      refusal("service_steps.course_id"),
    );
  });

  it("refuses a start that is not one of the five", () => {
    expect(() => validate(bundle([stepRow({ start: "later" })]))).toThrowError(
      refusal("service_steps.start"),
    );
  });

  it("refuses a named start without a predecessor", () => {
    const steps = [
      stepRow({ department_id: DELI, position: 0, start: "seated" }),
      stepRow({ position: 3, start: "after_step", minutes: 2 }),
      stepRow({ position: 5, start: "seated" }),
    ];
    expect(() => validate(bundle(steps))).toThrowError(refusal("service_steps.after_step_id"));
  });

  it.each<[string, Row]>([
    ["past 120", { minutes: 121 }],
    ["a fraction", { minutes: 2.5 }],
    ["below 0", { minutes: -1 }],
    ["not a number", { minutes: "5" }],
    ["0 on the repeating start", { start: "since_last_order", minutes: 0 }],
  ])("refuses minutes %s", (_label, overrides) => {
    expect(() => validate(bundle([stepRow(overrides)]))).toThrowError(
      refusal("service_steps.minutes"),
    );
  });

  it.each<[string, Row]>([
    ["not text", { name: 7 }],
    ["blank once trimmed", { name: "   " }],
    ["empty", { name: "" }],
    ["with spaces around it", { name: " Set up " }],
  ])("refuses a name %s", (_label, overrides) => {
    expect(() => validate(bundle([stepRow(overrides)]))).toThrowError(
      refusal("service_steps.name"),
    );
  });

  it.each<[string, Row]>([
    ["below 0", { position: -1 }],
    ["a fraction", { position: 0.5 }],
    ["not a number", { position: "0" }],
  ])("refuses a position %s", (_label, overrides) => {
    expect(() => validate(bundle([stepRow(overrides)]))).toThrowError(
      refusal("service_steps.position"),
    );
  });

  const many = (count: number, department: string): Row[] =>
    Array.from({ length: count }, (_, position) =>
      stepRow({ department_id: department, position, name: `Step ${position}` }),
    );

  it("accepts as many steps for one department as its save does, beside another's", () => {
    expect(() =>
      validate(bundle([...many(MAX_SERVICE_STEPS, RESTAURANT), ...many(1, DELI)])),
    ).not.toThrow();
  });

  it("refuses more steps for one department than its save accepts", () => {
    expect(() => validate(bundle(many(MAX_SERVICE_STEPS + 1, RESTAURANT)))).toThrowError(
      refusal("service_steps"),
    );
  });

  it.each(["missing", "other department", "cycle"])(
    "refuses a named predecessor that is %s",
    (kind) => {
      const rows = [
        stepRow({ id: "a", start: "after_step", after_step_id: "b" }),
        stepRow({
          id: "b",
          department_id: kind === "other department" ? DELI : RESTAURANT,
          start: kind === "cycle" ? "after_step" : "seated",
          after_step_id: kind === "cycle" ? "a" : null,
        }),
      ];
      if (kind === "missing") rows.pop();
      expect(() => validate(bundle(rows))).toThrowError(refusal("service_steps.after_step_id"));
    },
  );

  it("lists service_steps right after departments", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names.indexOf("service_steps")).toBe(names.indexOf("departments") + 1);
  });
});

describe("A773 pass display policy", () => {
  it("refuses two kitchen screens for one profile while accepting separate profiles", () => {
    const rows = [
      { device_profile_id: "station-profile", screen: "station", every_station: 1, every_zone: 1 },
      { device_profile_id: "pass-profile", screen: "pass", every_station: 1, every_zone: 1 },
    ];
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({ device_profile_kitchen_screens: rows }),
    ).not.toThrow();
    expect(() =>
      VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
        device_profile_kitchen_screens: rows.map((row) => ({
          ...row,
          device_profile_id: "same-profile",
        })),
      }),
    ).toThrowError(refusal("device_profile_kitchen_screens.screen"));
  });

  it("carries a profile's kitchen-screen rows, whole, and leaves every device's choice behind", () => {
    const names: string[] = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables).toContainEqual({
      name: "device_profile_kitchen_screens",
    });
    for (const deviceTable of [
      "device_kitchen_screens",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_zones",
      "device_kitchen_screen_removals",
    ]) {
      expect(names).not.toContain(deviceTable);
    }
  });
});

it("refuses a zone whose folded department is absent from the bundle", () => {
  expect(() =>
    VENUE_SERVICE_CONFIGURATION_TRANSFER.validate({
      departments: [],
      floor_zones: [{ id: "z", department_id: "missing" }],
    }),
  ).toThrowError(refusal("floor_zones.department_id"));
});

it("refuses course overrides with invalid references and values", () => {
  const validate = VENUE_SERVICE_CONFIGURATION_TRANSFER.validate!;
  const base = {
    departments: [{ id: "dept" }],
    kitchen_courses: [{ id: "course" }],
  };
  const row = {
    department_id: "dept",
    course_id: "course",
    held_until_fired: 0,
    reminder_minutes: null,
  };
  expect(() => validate({ ...base, department_courses: [row] })).not.toThrow();
  for (const [patch, field] of [
    [{ department_id: "gone" }, "department_id"],
    [{ course_id: "gone" }, "course_id"],
    [{ held_until_fired: 2 }, "held_until_fired"],
    [{ reminder_minutes: -1 }, "reminder_minutes"],
    [{ reminder_minutes: 121 }, "reminder_minutes"],
    [{ reminder_minutes: 2.5 }, "reminder_minutes"],
  ] as const)
    expect(() => validate({ ...base, department_courses: [{ ...row, ...patch }] })).toThrow(
      refusal(`department_courses.${field}`),
    );
});

it.each([
  ["an object", "{}"],
  ["malformed JSON", "nope"],
  ["a non-string id", "[42]"],
])("refuses a period staff-menu list holding %s", (_case, staffMenuIds) => {
  expect(() =>
    validateMenuTimetables({
      departments: [{ id: RESTAURANT }],
      menus: [{ id: "customer" }, { id: "staff" }],
      menu_periods: [
        {
          id: "period",
          department_id: RESTAURANT,
          name: "Lunch",
          colour: "blue",
          menu_id: "customer",
          staff_menu_ids: staffMenuIds,
        },
      ],
    }),
  ).toThrowError(refusal("menu_periods.staff_menu_ids"));
});
