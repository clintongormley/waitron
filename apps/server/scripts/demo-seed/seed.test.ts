import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { venueMenus } from "../../src/testing/venue-menus.js";
/**
 * `seedDemoRestaurant` runs every sub-seed. `WAITRON_ENV` is left unset, so `deploymentEnvironment`
 * resolves to `preproduction` for the seeded sales; one case stubs it to `production` and proves the
 * seed refuses before its first write.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deviceProfiles, floorZones, menuPeriods, withTransaction } from "@waitron/db";
import { readProfilePrinterLists } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createCategory,
  createProduct,
  listAvailableProducts,
  listTranslationGapReport,
  menuStatus,
  readContentLanguages,
} from "@waitron/menu";
import {
  resolveMakers,
  setRoutingCell,
  saveSpecialDay,
  readBusinessDayScheduleRevision,
  listDepartmentCourseSettings,
} from "@waitron/venue-service";
import { VENUE_SERVICE } from "../../src/modules.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { getCountryPack } from "@waitron/country-packs";
import { listCourses } from "../../src/kitchen.js";
import { seedDemoRestaurant } from "./seed.js";
import * as salesSeed from "./seed-sales.js";
import { CASA_DELGADO_ES } from "./testing/data.js";

import type { SeedLocale } from "./locale.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";
const DEPARTMENT_TRADING_NAMES = getCountryPack("ES")!.demo!.departmentTradingNames;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 90_000_000,
  invoiceLocale: "es-ES",
  staffLanguage: LOCALE,
  nifFormat: "calculated",
  adminPin: "5555",
});

describe("seedDemoRestaurant", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it.each(["06:00", "05:00", "04:00"])(
    "stores only Terrace's 23:00–05:00 closure after its sales, retaining it for late special service with a %s changeover",
    async (cutover) => {
      const venue = await provisionVenue();
      await withTransaction(suite.db, (tx) => seedBusinessDay(tx, { dayCutover: cutover }));
      const readClosures = () =>
        suite.db.execute<{ zone: string; weekday: number; starts_at: string; ends_at: string }>(sql`
          select z.name as zone, r.weekday, r.starts_at, r.ends_at
          from opening_hours r
          join seasons se on se.id = r.season_id and se.starts_on = '12-01'
          join floor_zones z on z.id = r.zone_id
          order by z.name, r.weekday, r.starts_at`);
      const realSeedSales = salesSeed.seedSales;
      let closuresAfterSales: unknown;
      let saleCount = 0;
      const salesStep = vi.spyOn(salesSeed, "seedSales").mockImplementation(async (...args) => {
        const result = await realSeedSales(...args);
        saleCount = result.count;
        closuresAfterSales = (await readClosures()).rows;
        return result;
      });
      try {
        await seedDemoRestaurant(suite.db, {
          venue,
          locale: LOCALE,
          salesDays: 3,
          departmentTradingNames: DEPARTMENT_TRADING_NAMES,
          dataSet: CASA_DELGADO_ES,
        });
        expect(saleCount).toBeGreaterThan(0);
        expect(closuresAfterSales).toEqual([]);
        expect((await readClosures()).rows).toEqual(
          [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
            (cutover === "04:00"
              ? [
                  { starts_at: "04:00:00", ends_at: "05:00:00" },
                  { starts_at: "23:00:00", ends_at: "04:00:00" },
                ]
              : [{ starts_at: "23:00:00", ends_at: "05:00:00" }]
            ).map((range) => ({ zone: "Terrace", weekday, ...range })),
          ),
        );
        const zones = await suite.db.select().from(floorZones);
        const terrace = zones.find((zone) => zone.name === "Terrace")!;
        const other = zones.find(
          (zone) => zone.departmentId === terrace.departmentId && zone.id !== terrace.id,
        )!;
        const [period] = await suite.db
          .select()
          .from(menuPeriods)
          .where(eq(menuPeriods.departmentId, terrace.departmentId));
        const at = new Date("2030-12-02T18:00:00Z");
        await withTransaction(suite.db, async (tx) => {
          await saveSpecialDay(
            tx,
            null,
            {
              name: "Late service",
              repeatsYearly: false,
              dates: [{ date: "2030-12-02", closedAllDay: false }],
              paint: [
                {
                  departmentId: terrace.departmentId,
                  date: "2030-12-02",
                  ranges: [{ periodId: period!.id, startsAt: "23:00", endsAt: "03:00" }],
                },
              ],
            },
            at,
            await readBusinessDayScheduleRevision(tx),
          );
        });
        const late = new Date("2030-12-03T00:30:00+01:00");
        const closed = await withTransaction(suite.db, (tx) =>
          VENUE_SERVICE.closedZoneIdsAt(tx, late, [terrace.id, other.id]),
        );
        expect([...closed]).toEqual([terrace.id]);
      } finally {
        salesStep.mockRestore();
      }
    },
  );

  it("attributes demo publications to the provisioned administrator", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 0,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });
    const { rows } = await suite.db.execute<{ publisher: string }>(sql`
      select p.email as publisher from menu_versions v
      join persons p on p.id = v.created_by`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.publisher === "owner@example.test")).toBe(true);
  });

  it("seeds department service periods instead of a second opening-hours grid", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 0,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });
    const { rows } = await suite.db.execute<{
      department: string;
      period: string;
      weekday: number;
      starts_at: string;
      ends_at: string;
    }>(sql`
      select d.name as department, p.name as period, s.weekday, s.starts_at, s.ends_at
      from opening_hours s join menu_periods p on p.id = s.period_id
      join seasons se on se.id = s.season_id and se.starts_on = '12-01'
      join departments d on d.id = p.department_id

      order by d.name, s.weekday, s.starts_at`);
    expect(rows).toEqual([
      ...[1, 2, 3, 4, 5, 6].map((weekday) => ({
        department: "Deli",
        period: "Open",
        weekday,
        starts_at: "09:00:00",
        ends_at: "18:00:00",
      })),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
        [
          ["Bar", "09:00:00", "13:00:00"],
          ["Lunch", "13:00:00", "16:00:00"],
          ["Bar", "16:00:00", "20:00:00"],
          ["Dinner", "20:00:00", "23:00:00"],
          ["Bar", "23:00:00", "00:00:00"],
        ].map(([period, starts_at, ends_at]) => ({
          department: "Restaurant and bar",
          period,
          weekday,
          starts_at,
          ends_at,
        })),
      ),
    ]);
    const { rows: separate } = await suite.db.execute<{ count: number }>(sql`
      select cast(count(*) as integer) as count from sqlite_master where type = 'table' and name = 'hours_week_cells'`);
    expect(separate).toEqual([{ count: 0 }]);
  });

  it("seeds Christmas Day as a closed special day that repeats every year", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-06T10:00:00Z") });
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 0,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });
    const { rows } = await suite.db.execute<{
      name: string;
      repeats_yearly: number;
      date: string;
      closed_all_day: number;
      holiday_name: string | null;
    }>(sql`
      select s.name, s.repeats_yearly, d.date, d.closed_all_day, d.holiday_name
      from special_days s join special_day_dates d on d.special_day_id = s.id
      `);
    expect(rows).toEqual([
      {
        name: "Christmas Day",
        repeats_yearly: 1,
        date: "2026-12-25",
        closed_all_day: 1,
        holiday_name: "Natividad del Señor",
      },
    ]);
  });

  it("gives the kitchen display profile the pass levers", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 0,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });
    const profiles = await suite.db
      .select({ formFactor: deviceProfiles.formFactor, capabilities: deviceProfiles.capabilities })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.formFactor, "kds"));
    expect(profiles).toEqual([
      {
        formFactor: "kds",
        capabilities: [
          "act-as-kds",
          "prepare-orders",
          "take-orders",
          "hand-over-orders",
          "run-the-pass",
        ],
      },
    ]);
  });

  it("connects the demo printer to ordering profiles and preparation stations", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 0,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    const { rows: printers } = await suite.db.execute<{
      id: string;
      name: string;
      transport: string;
      has_cash_drawer: number;
      ticket_stations: number;
    }>(sql`
      select p.id, p.name, p.transport, p.has_cash_drawer,
        (select cast(count(*) as integer) from kitchen_stations ks, json_each(ks.printer_ids) sp where sp.value = p.id) as ticket_stations
      from printers p`);
    expect(printers).toEqual([
      {
        id: expect.any(String),
        name: "Demo printer",
        transport: "usb",
        has_cash_drawer: 1,
        ticket_stations: 4,
      },
    ]);
    const demoId = printers[0]!.id;
    const defaults = await withTransaction(suite.db, async (tx) => {
      const found = [];
      for (const profile of await tx
        .select({ id: deviceProfiles.id, formFactor: deviceProfiles.formFactor })
        .from(deviceProfiles)) {
        found.push({
          formFactor: profile.formFactor,
          lists: await readProfilePrinterLists(tx, profile.id),
        });
      }
      return found;
    });
    expect(defaults.some((profile) => profile.formFactor === "kds")).toBe(true);
    expect(defaults.some((profile) => profile.formFactor !== "kds")).toBe(true);
    for (const profile of defaults) {
      const expected = profile.formFactor === "kds" ? null : demoId;
      expect({
        receipt: profile.lists.receiptPrinterDefaultId,
        slip: profile.lists.paymentSlipPrinterDefaultId,
        drawer: profile.lists.cashDrawerPrinterDefaultId,
        invoice: profile.lists.invoicePrinterDefaultId,
      }).toEqual({ receipt: expected, slip: expected, drawer: expected, invoice: expected });
    }
  });

  it("rates a seeded deli sale's cola at 21% and a seeded restaurant sale's cola at 10%", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T22:00:00.000Z") });
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 7,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });
    const { rows } = await suite.db.execute<{ sale_id: string; name: string; vat_rate: number }>(
      sql`select sale_id, name, vat_rate from sale_lines`,
    );
    const deli = CASA_DELGADO_ES.menus.deli;
    const deliNames = new Set([
      ...deli.categories.flatMap((category) =>
        category.products.map((product) => product.staffName?.en ?? product.customerName.en),
      ),
      "Cola",
      "Coca-Cola Zero",
      "Bottled beer",
    ]);
    const cola = rows.filter((row) => row.name === "Cola");
    const linesOf = (saleId: string) => rows.filter((row) => row.sale_id === saleId);
    const deliCola = cola.filter((row) => Number(row.vat_rate) === 2100);
    expect(deliCola.length).toBeGreaterThan(0);
    for (const row of deliCola)
      expect(linesOf(row.sale_id).filter((line) => !deliNames.has(line.name))).toEqual([]);
    const restaurantCola = cola.filter((row) =>
      linesOf(row.sale_id).some((line) => !deliNames.has(line.name)),
    );
    expect(restaurantCola.length).toBeGreaterThan(0);
    expect(new Set(restaurantCola.map((row) => Number(row.vat_rate)))).toEqual(new Set([1000]));
    expect(new Set(cola.map((row) => Number(row.vat_rate)))).toEqual(new Set([1000, 2100]));
  });

  it("hands the practice sales a product pool in a fixed order, whatever order the database reads them in", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T22:00:00.000Z") });
    const venue = await provisionVenue();
    const realSeedSales = salesSeed.seedSales;
    type Pool = readonly salesSeed.SeedSalesProduct[];
    let pools: { products: Pool; deli: Pool } | undefined;
    const salesStep = vi.spyOn(salesSeed, "seedSales").mockImplementation(async (db, input) => {
      pools = { products: input.products, deli: input.deliProducts ?? [] };
      return realSeedSales(db, input);
    });
    try {
      await seedDemoRestaurant(suite.db, {
        venue,
        locale: LOCALE,
        salesDays: 1,
        departmentTradingNames: DEPARTMENT_TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      });
    } finally {
      salesStep.mockRestore();
    }
    const key = (p: salesSeed.SeedSalesProduct) =>
      JSON.stringify([p.name, p.customerName, p.unitPrice, p.vatClass, p.takeawayVatClass ?? null]);
    const sorted = (list: Pool) => list.map(key).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(pools!.products.length).toBeGreaterThan(1);
    expect(pools!.deli.length).toBeGreaterThan(1);
    expect(pools!.products.map(key)).toEqual(sorted(pools!.products));
    expect(pools!.deli.map(key)).toEqual(sorted(pools!.deli));
  });

  it("refuses a production environment before writing anything", async () => {
    const venue = await provisionVenue();
    const before = await withTransaction(suite.db, async (tx) => ({
      menus: (await venueMenus(tx)).length,
      products: (await listAvailableProducts(tx)).products.length,
    }));
    vi.stubEnv("WAITRON_ENV", "production");

    await expect(
      seedDemoRestaurant(suite.db, {
        venue,
        locale: LOCALE,
        salesDays: 7,
        departmentTradingNames: DEPARTMENT_TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      }),
    ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });

    const after = await withTransaction(suite.db, async (tx) => ({
      menus: (await venueMenus(tx)).length,
      products: (await listAvailableProducts(tx)).products.length,
      sales: (
        await tx.execute<{ n: number }>(sql`select cast(count(*) as integer) as n from sales`)
      ).rows[0]!.n,
    }));
    expect(after).toEqual({ ...before, sales: 0 });
  });

  it("routes seeded drinks by zone, dishes to Kitchen, and a test-only no-preparation folder without work", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 1,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    await withTransaction(suite.db, async (tx) => {
      const { rows: stations } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from kitchen_stations`);
      const { rows: zones } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from floor_zones`);
      const { products } = await listAvailableProducts(tx);
      const drink = products.find((product) => product.name === "House Negroni")!;
      const dish = products.find((product) => product.name === "Sirloin")!;
      const downstairs = zones.find((zone) => zone.name === "Downstairs bar")!;
      const upstairs = zones.find((zone) => zone.name === "Upstairs bar")!;
      const downstairsStation = stations.find((station) => station.name === "Downstairs bar prep")!;
      const kitchen = stations.find((station) => station.name === "Kitchen")!;

      expect(
        await resolveMakers(
          tx,
          downstairs.id,
          [drink.id, dish.id],
          new Date("2026-10-02T18:30:00Z"),
        ),
      ).toEqual(
        new Map([
          [drink.id, { kind: "made", route: { kind: "station", stationId: downstairsStation.id } }],
          [dish.id, { kind: "made", route: { kind: "station", stationId: kitchen.id } }],
        ]),
      );
      expect(
        await resolveMakers(tx, upstairs.id, [drink.id, dish.id], new Date("2026-10-02T18:30:00Z")),
      ).toEqual(
        new Map([
          [drink.id, { kind: "made", route: { kind: "station", stationId: downstairsStation.id } }],
          [dish.id, { kind: "made", route: { kind: "station", stationId: kitchen.id } }],
        ]),
      );

      const folder = await createCategory(tx, { name: "Test-only packaged snacks" });
      const snack = await createProduct(tx, {
        name: "Test-only packet of crisps",
        categoryId: folder.id,
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: folder.id }, zoneId: null },
        { kind: "no_preparation" },
      );
      for (const zone of [downstairs, upstairs]) {
        expect(
          await resolveMakers(tx, zone.id, [snack.id], new Date("2026-10-02T18:30:00Z")),
        ).toEqual(new Map([[snack.id, { kind: "made", route: { kind: "no_preparation" } }]]));
      }
    });
  });

  it("gives each demo station its own colour", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 1,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });
    const { rows } = await suite.db.execute<{ name: string; colour: string }>(sql`
      select name, colour from kitchen_stations order by name`);
    expect(rows).toEqual([
      { name: "Deli prep", colour: "green" },
      { name: "Downstairs bar prep", colour: "blue" },
      { name: "Kitchen", colour: "orange" },
      { name: "Upstairs bar prep", colour: "indigo" },
    ]);
  });

  it("keeps drinks downstairs at dinner without station hours", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 1,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    await withTransaction(suite.db, async (tx) => {
      const { rows: retired } = await tx.execute(sql`
        select name from sqlite_master where type = 'table'
        and name in ('hours_week_cells', 'hours_week_periods', 'station_fallbacks')`);
      expect(retired).toEqual([]);

      const { rows: subjects } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from departments  order by name`);
      const weeks: Record<string, string[]> = {};
      for (const subject of subjects) {
        const { rows: ranges } = await tx.execute<{
          weekday: number;
          starts_at: string;
          ends_at: string;
        }>(sql`
            select s.weekday, s.starts_at, s.ends_at from opening_hours s
            join seasons se on se.id = s.season_id and se.starts_on = '12-01'
            where s.department_id = ${subject.id}
            order by s.weekday, s.starts_at`);
        weeks[subject.name] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
          const slots = ranges.filter((range) => range.weekday === weekday);
          return slots.length === 0
            ? "closed"
            : slots
                .map((slot) => `${slot.starts_at.slice(0, 5)}-${slot.ends_at.slice(0, 5)}`)
                .join(",");
        });
      }
      // Sunday first.
      expect(weeks).toEqual({
        Deli: ["closed", ...Array<string>(6).fill("09:00-18:00")],
        "Restaurant and bar": Array<string>(7).fill(
          "09:00-13:00,13:00-16:00,16:00-20:00,20:00-23:00,23:00-00:00",
        ),
      });

      const { rows: periods } = await tx.execute<{
        department: string;
        name: string;
        menu: string;
        staff_menus: string | null;
      }>(sql`
        select d.name as department, p.name, c.name as menu,
          (select group_concat(sc.name, ',') from json_each(p.staff_menu_ids) s
            join menus sc on sc.id = s.value) as staff_menus
        from menu_periods p join departments d on d.id = p.department_id
        join menus c on c.id = p.menu_id
        order by d.name, p.name`);
      expect(periods).toEqual([
        { department: "Deli", name: "Open", menu: "Deli takeaway", staff_menus: null },
        { department: "Restaurant and bar", name: "Bar", menu: "Drinks", staff_menus: null },
        {
          department: "Restaurant and bar",
          name: "Dinner",
          menu: "Casa Delgado",
          staff_menus: null,
        },
        {
          department: "Restaurant and bar",
          name: "Lunch",
          menu: "Casa Delgado",
          staff_menus: "Set menus",
        },
      ]);

      const { rows: zones } = await tx.execute<{ id: string }>(sql`
        select id from floor_zones
        where name = 'Upstairs bar'`);
      const { rows: stations } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from kitchen_stations`);
      const { products } = await listAvailableProducts(tx);
      const drink = products.find((product) => product.name === "House Negroni")!;
      for (const [instant, stationName] of [
        ["2026-10-02T18:00:00Z", "Downstairs bar prep"],
        ["2026-10-06T18:00:00Z", "Downstairs bar prep"],
      ] as const) {
        const station = stations.find((candidate) => candidate.name === stationName)!;
        expect(await resolveMakers(tx, zones[0]!.id, [drink.id], new Date(instant))).toEqual(
          new Map([
            [drink.id, { kind: "made", route: { kind: "station", stationId: station.id } }],
          ]),
        );
      }
    });
  });

  it("runs every sub-seed: both menus, the floor, the staff, the adjustment reasons, a sale, and content-addressed media", async () => {
    const venue = await provisionVenue();

    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 7,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    const read = await withTransaction(suite.db, async (tx) => {
      const menus = await venueMenus(tx);
      const { products } = await listAvailableProducts(tx);
      const { rows: tableRows } = await tx.execute<{ n: number }>(
        sql`select cast(count(*) as integer) as n from dining_tables`,
      );
      const { rows: staffRows } = await tx.execute<{ n: number }>(
        sql`select cast(count(*) as integer) as n from persons`,
      );
      const { rows: saleRows } = await tx.execute<{ n: number }>(
        sql`select cast(count(*) as integer) as n from sales`,
      );
      const { rows: modifierLineRows } = await tx.execute<{ n: number }>(
        sql`select cast(count(*) as integer) as n from sale_lines where parent_line_id is not null`,
      );
      const { rows: departmentRows } = await tx.execute<{
        name: string;
        trading_name: string;
        order_start: string;
      }>(sql`
        select d.name, d.trading_name, d.order_start
        from departments d
        order by d.name`);
      const { rows: serviceZoneRaw } = await tx.execute<{
        zone_name: string;
        department_name: string;
        order_start: string;
        is_counter_default: number;
        menus: string;
      }>(sql`
        select z.name as zone_name, d.name as department_name,
               coalesce(z.order_start, d.order_start) as order_start,
               z.is_counter_default,
               json_group_array(c.name order by dm.display_order, c.name) as menus
        from floor_zones z
        join departments d on d.id = z.department_id
        join (
          select department_id, menu_id, 0 as display_order from menu_periods
          union
          select p.department_id, s.value as menu_id, s.key + 1 as display_order from menu_periods p, json_each(p.staff_menu_ids) s
        ) dm on dm.department_id = z.department_id
        join menus c on c.id = dm.menu_id
        group by z.name, d.name, z.order_start, d.order_start, z.is_counter_default
        order by z.name`);
      const serviceZoneRows = serviceZoneRaw.map((row) => ({
        ...row,
        is_counter_default: row.is_counter_default === 1,
        menus: JSON.parse(row.menus) as string[],
      }));
      const { rows: hoursRows } = await tx.execute<{ department_name: string; days: number }>(sql`
        select d.name as department_name, cast(count(distinct h.weekday) as integer) as days
        from opening_hours h
        join seasons se on se.id = h.season_id and se.starts_on = '12-01'
        join departments d on d.id = h.department_id
        group by d.name
        order by d.name`);
      const { rows: stationRows } = await tx.execute<{ name: string }>(sql`
        select name from kitchen_stations where active order by name`);
      const { rows: negroniRows } = await tx.execute<{
        product_id: string;
        menu_name: string;
        gross_price: number | null;
        unit_price: number;
      }>(sql`
        -- Both prices count whole cents, and the assertion below is on that COUNT, not on an
        -- amount, so each is read as an integer rather than through rawCentsToDecimal.
        select mi.product_id, c.name as menu_name, cast(mi.gross_price as integer) as gross_price,
          cast(p.unit_price as integer) as unit_price
        from menu_items mi
        join products p on p.id = mi.product_id
        join menus c on c.id = mi.menu_id
        where p.name = 'House Negroni'
        order by c.name`);
      const { rows: optionListRaw } = await tx.execute<{
        product_name: string;
        list_name: string;
        default_label: string | null;
        labels: string;
      }>(sql`
        select p.name as product_name, ol.name as list_name, dflt.name as default_label,
               json_group_array(lab.name order by lab.sort) as labels
        from product_modifiers pm
        join products p on p.id = pm.product_id
        join option_lists ol on ol.id = pm.option_list_id
        join option_labels lab on lab.list_id = ol.id
        left join option_labels dflt on dflt.list_id = ol.id and dflt.is_default = 1
        group by p.name, ol.name, dflt.name
        order by p.name, ol.name`);
      const optionListRows = optionListRaw.map((row) => ({
        ...row,
        labels: JSON.parse(row.labels) as string[],
      }));
      const { rows: cocktailRouteRows } = await tx.execute<{
        category: string;
        zone_name: string;
        station_name: string;
      }>(sql`
        select c.name as category, z.name as zone_name, s.name as station_name
        from routing_cells r
        join categories c on c.id = r.category_id
        join floor_zones z on z.id = r.zone_id
        join kitchen_stations s on s.id = r.station_id
        where c.name in ('Cocktails', 'Wine and beer', 'Soft drinks', 'Coffee')
        order by c.name, z.name`);
      const { rows: cocktailCells } = await tx.execute<{ station_name: string }>(sql`
        select s.name as station_name from routing_cells r
        join categories c on c.id = r.category_id and r.zone_id is null
        join kitchen_stations s on s.id = r.station_id
        where c.name = 'Cocktails'`);
      const published = await menuStatus(
        tx,
        menus.map((menu) => menu.id),
      );
      return {
        menus,
        cocktailCells,
        menuStates: [...published.values()].map((status) => status.state),
        products,
        tables: tableRows[0]!.n,
        staff: staffRows[0]!.n,
        sales: saleRows[0]!.n,
        modifierLines: modifierLineRows[0]!.n,
        departments: departmentRows,
        serviceZones: serviceZoneRows,
        hours: hoursRows,
        stations: stationRows.map((row) => row.name),
        negroniOffers: negroniRows,
        cocktailRoutes: cocktailRouteRows,
        optionLists: optionListRows,
      };
    });

    // The steak asks the cooking question and nothing else does.
    const coffee = read.products.find((p) => p.name === "House coffee");
    const steak = read.products.find((p) => p.name === "Sirloin");
    expect(coffee).toBeDefined();
    expect(steak).toBeDefined();
    expect(coffee!.offeredModifiers).toEqual([]);
    expect(steak!.offeredModifiers.map((entry) => [entry.kind, entry.name])).toEqual([
      ["options", "Doneness"],
    ]);
    // The back-dated generator writes one row per dish and nothing below it.
    expect(read.modifierLines).toBe(0);

    expect(read.menus.map((m) => m.name).sort()).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Drinks",
      "Menu of the day",
      "Set menus",
      "Special menu",
    ]);
    expect(read.menuStates).toEqual(["current", "current", "current", "current"]);
    expect(read.departments).toEqual([
      {
        name: "Deli",
        trading_name: "Deli Delgado",
        order_start: "counter",
      },
      {
        name: "Restaurant and bar",
        trading_name: "Bar Casa Delgado",
        order_start: "table",
      },
    ]);
    expect(read.serviceZones).toEqual([
      {
        zone_name: "Deli counter",
        department_name: "Deli",
        order_start: "counter",
        is_counter_default: false,
        menus: ["Deli takeaway"],
      },
      {
        zone_name: "Dining room",
        department_name: "Restaurant and bar",
        order_start: "table",
        is_counter_default: false,
        menus: ["Casa Delgado", "Drinks", "Set menus"],
      },
      {
        zone_name: "Downstairs bar",
        department_name: "Restaurant and bar",
        order_start: "counter",
        is_counter_default: true,
        menus: ["Casa Delgado", "Drinks", "Set menus"],
      },
      {
        zone_name: "Terrace",
        department_name: "Restaurant and bar",
        order_start: "table",
        is_counter_default: false,
        menus: ["Casa Delgado", "Drinks", "Set menus"],
      },
      {
        zone_name: "Upstairs bar",
        department_name: "Restaurant and bar",
        order_start: "counter",
        is_counter_default: false,
        menus: ["Casa Delgado", "Drinks", "Set menus"],
      },
    ]);
    expect(read.hours).toEqual([
      { department_name: "Deli", days: 6 },
      { department_name: "Restaurant and bar", days: 7 },
    ]);
    expect(read.stations).toEqual([
      "Deli prep",
      "Downstairs bar prep",
      "Kitchen",
      "Upstairs bar prep",
    ]);
    expect(read.negroniOffers).toEqual([
      {
        product_id: expect.any(String),
        menu_name: "Casa Delgado",
        gross_price: null,
        unit_price: 1100,
      },
      {
        product_id: expect.any(String),
        menu_name: "Drinks",
        gross_price: null,
        unit_price: 1100,
      },
      {
        product_id: expect.any(String),
        menu_name: "Set menus",
        gross_price: 900,
        unit_price: 1100,
      },
    ]);
    expect(new Set(read.negroniOffers.map((offer) => offer.product_id)).size).toBe(1);
    expect(read.cocktailCells).toEqual([{ station_name: "Downstairs bar prep" }]);
    expect(read.cocktailRoutes).toEqual([
      { category: "Cocktails", zone_name: "Upstairs bar", station_name: "Downstairs bar prep" },
      { category: "Coffee", zone_name: "Upstairs bar", station_name: "Downstairs bar prep" },
      { category: "Soft drinks", zone_name: "Deli counter", station_name: "Deli prep" },
      { category: "Soft drinks", zone_name: "Upstairs bar", station_name: "Downstairs bar prep" },
      { category: "Wine and beer", zone_name: "Deli counter", station_name: "Deli prep" },
      { category: "Wine and beer", zone_name: "Upstairs bar", station_name: "Downstairs bar prep" },
    ]);

    // The cooking list as it is STORED, behind the `offeredModifiers` read above.
    expect(read.optionLists).toEqual([
      {
        product_name: "Sirloin",
        list_name: "Doneness",
        default_label: "Medium",
        labels: ["Rare", "Medium", "Well done"],
      },
    ]);

    expect(read.tables).toBeGreaterThanOrEqual(16);

    expect(read.staff).toBeGreaterThanOrEqual(5);

    const reasons = await withTransaction(suite.db, (tx) => listAdjustmentReasons(tx));
    expect(reasons.map((reason) => reason.name)).toEqual([
      "Entry error",
      "Item not available",
      "Customer changed mind",
      "Not served",
      "Other",
      "Complaint",
      "On the house",
      "Staff meal",
      "Discount",
      "Friends and family",
      "Employee discount",
      "Manager special",
    ]);

    expect(read.sales).toBeGreaterThanOrEqual(1);

    expect(read.products.length).toBeGreaterThan(0);

    // listAvailableProducts does not project `image`, so read one product's image directly.
    const { rows: imageRows } = await withTransaction(suite.db, async (tx) => {
      return tx.execute<{ image: string | null }>(
        sql`select image from products where image is not null limit 1`,
      );
    });
    expect(imageRows.length).toBe(1);
    expect(imageRows[0]!.image).toMatch(/^[0-9a-f]{64}\.webp$/);
  });

  it.each([
    ["Barcelona", "08001", "ca-ES", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
    [
      "Valencia",
      "46001",
      "es-ES",
      { defaultLanguage: "ca-ES-valencia", languages: ["ca-ES-valencia", "es", "en"] },
    ],
    ["A Coruña", "15001", "es-ES", { defaultLanguage: "gl", languages: ["gl", "es", "en"] }],
    ["Illes Balears", "07001", "es-ES", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
    ["Madrid", "28013", "es-ES", { defaultLanguage: "es", languages: ["es", "en"] }],
  ])(
    "a demo in %s takes the area's languages and misses no translation",
    async (province, postalCode, invoiceLocale, expected) => {
      const venue = await createDemoVenueProvisioner(() => suite.db, {
        nifBase: 91_000_000,
        invoiceLocale,
        nifFormat: "calculated",
        province,
        postalCode,
        city: province,
      })();
      await seedDemoRestaurant(suite.db, {
        venue,
        locale: "es",
        salesDays: 0,
        departmentTradingNames: DEPARTMENT_TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      });

      const restaurantPeriods = await suite.db.execute<{ name: string }>(sql`
        select d.name from floor_zones z
        join menu_periods d on d.department_id = z.department_id
        where z.is_counter_default order by d.name`);
      expect(restaurantPeriods.rows).toEqual([
        { name: "Bar" },
        { name: "Cena" },
        { name: "Comida" },
      ]);

      const read = await withTransaction(suite.db, async (tx) => {
        const languages = await readContentLanguages(tx, "es");
        const gaps = await listTranslationGapReport(tx, languages);
        const { rows } = await tx.execute<{ customer_name: string }>(
          sql`select customer_name from products where name = 'Bravas'`,
        );
        return { languages, gaps, customerName: JSON.parse(rows[0]!.customer_name) as object };
      });
      expect(read.languages).toEqual(expected);
      expect(read.gaps.flatMap((language) => language.gaps)).toEqual([]);
      expect(Object.keys(read.customerName).sort()).toEqual([...expected.languages].sort());
    },
  );

  it("writes a Barcelona demo's practice sales in its Catalan receipt language, whatever the staff language", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 92_000_000,
      invoiceLocale: "ca-ES",
      nifFormat: "calculated",
      province: "Barcelona",
      postalCode: "08001",
      city: "Barcelona",
    })();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: "es",
      salesDays: 3,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    const { rows } = await suite.db.execute<{ descriptions: string }>(
      sql`select descriptions from sale_lines`,
    );
    const { restaurant, deli, lunch } = CASA_DELGADO_ES.menus;
    const products = [restaurant, deli, lunch].flatMap((menu) =>
      menu.categories.flatMap((category) => category.products),
    );
    const catalan = new Set(products.map((product) => product.customerName.ca));
    const spanish = new Set(products.map((product) => product.customerName.es));
    const stored = rows.map((row) => JSON.parse(row.descriptions) as Record<string, string>);

    expect(stored.length).toBeGreaterThan(0);
    for (const descriptions of stored) {
      expect(Object.keys(descriptions)).toEqual(["ca-ES"]);
      expect(catalan.has(descriptions["ca-ES"]!)).toBe(true);
    }
    // Some dishes share a name in both languages; at least one sold line must not.
    expect(stored.some((descriptions) => !spanish.has(descriptions["ca-ES"]!))).toBe(true);
  });

  it("writes a Madrid demo's Catalan-receipt practice sales in the area's Spanish text", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 93_000_000,
      invoiceLocale: "ca-ES",
      nifFormat: "calculated",
      province: "Madrid",
      postalCode: "28013",
      city: "Madrid",
    })();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: "es",
      salesDays: 3,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    const { rows } = await suite.db.execute<{ descriptions: string }>(
      sql`select descriptions from sale_lines`,
    );
    const { restaurant, deli, lunch } = CASA_DELGADO_ES.menus;
    const products = [restaurant, deli, lunch].flatMap((menu) =>
      menu.categories.flatMap((category) => category.products),
    );
    const spanish = new Set(products.map((product) => product.customerName.es));
    const english = new Set(products.map((product) => product.customerName.en));
    const stored = rows.map((row) => JSON.parse(row.descriptions) as Record<string, string>);

    expect(stored.length).toBeGreaterThan(0);
    for (const descriptions of stored) {
      expect(Object.keys(descriptions)).toEqual(["ca-ES"]);
      expect(descriptions["ca-ES"]).not.toBe("");
      expect(spanish.has(descriptions["ca-ES"]!)).toBe(true);
    }
    // Some dishes share a name in both languages; at least one sold line must not.
    expect(stored.some((descriptions) => !english.has(descriptions["ca-ES"]!))).toBe(true);
  });

  it("seeds a Madrid demo in English staff names under the area's Spanish default", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: "en",
      salesDays: 0,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    const read = await withTransaction(suite.db, async (tx) => ({
      languages: await readContentLanguages(tx, "en"),
      products: (await listAvailableProducts(tx)).products,
    }));
    expect(read.languages).toEqual({ defaultLanguage: "es", languages: ["es", "en"] });
    expect(read.products.some((product) => product.name === "Salad")).toBe(true);
  });

  it("seeds a United Kingdom demo from Casa Delgado in English, its practice sales with no fiscal record", async () => {
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      country: "GB",
      nifBase: 101_000_000,
      invoiceLocale: "en-GB",
    })();
    const readCourseSetup = () =>
      withTransaction(suite.db, async (tx) => ({
        courses: (await listCourses(tx)).map(({ id, name, displayOrder }) => ({
          id,
          name,
          displayOrder,
        })),
        settings: await listDepartmentCourseSettings(tx),
      }));
    const beforeCourses = await readCourseSetup();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: "en",
      salesDays: 3,
      departmentTradingNames: DEPARTMENT_TRADING_NAMES,
      dataSet: CASA_DELGADO_ES,
    });

    const read = await withTransaction(suite.db, async (tx) => {
      const languages = await readContentLanguages(tx, "en");
      const gaps = await listTranslationGapReport(tx, languages);
      const { rows: products } = await tx.execute<{ customer_name: string }>(
        sql`select customer_name from products where name = 'Bravas'`,
      );
      const { rows: backends } = await tx.execute<{ fiscal_backend: string }>(
        sql`select fiscal_backend from sales`,
      );
      const { rows: recordCounts } = await tx.execute<{ count: number }>(
        sql`select count(*) as count from verifactu_records`,
      );
      const { rows: takeawayRates } = await tx.execute<{ rate: number }>(
        sql`select distinct rate from product_takeaway_vat_rates`,
      );
      return {
        languages,
        gaps,
        customerName: JSON.parse(products[0]!.customer_name) as object,
        backends: backends.map((row) => row.fiscal_backend),
        recordCount: recordCounts[0]!.count,
        takeawayRates: takeawayRates.map((row) => row.rate),
      };
    });
    expect(read.languages).toEqual({ defaultLanguage: "en", languages: ["en"] });
    expect(read.gaps.flatMap((language) => language.gaps)).toEqual([]);
    expect(Object.keys(read.customerName)).toEqual(["en"]);
    expect(read.backends.length).toBeGreaterThan(0);
    expect(new Set(read.backends)).toEqual(new Set(["none"]));
    expect(read.recordCount).toBe(0);
    // Spain's 4% and 21% are not offered here, so every product takes the area's 0%.
    expect(read.takeawayRates).toEqual([0]);
    expect((await withTransaction(suite.db, venueMenus)).map(({ name }) => name).sort()).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Drinks",
      "Set lunch",
    ]);
    const afterCourses = await readCourseSetup();
    expect(afterCourses.courses).toEqual(beforeCourses.courses);
    expect(Object.values(afterCourses.settings)).toEqual(
      Object.values(beforeCourses.settings).flatMap((settings) => [settings, settings]),
    );
    expect(
      (await suite.db.execute(sql`select course_id from products where course_id is not null`))
        .rows,
    ).toEqual([]);
  });
});
