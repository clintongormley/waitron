/**
 * `seedDemoRestaurant` runs every sub-seed. `WAITRON_ENV` is left unset, so `deploymentEnvironment`
 * resolves to `preproduction` for the seeded sales; one case stubs it to `production` and proves the
 * seed refuses before its first write.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createCategory,
  createProduct,
  listAccessibleCatalogues,
  listAvailableProducts,
  menuStatus,
} from "@waitron/catalogue";
import { locationId as brandLocationId } from "@waitron/shared";
import { resolveMakers, setClaim } from "@waitron/venue-service";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { seedDemoRestaurant } from "./seed.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 90_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
  nifFormat: "calculated",
  adminPin: "5555",
});

describe("seedDemoRestaurant", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a production environment before writing anything", async () => {
    const venue = await provisionVenue();
    const before = await withTransaction(suite.db, async (tx) => ({
      menus: (await listAccessibleCatalogues(tx, venue.locationId)).length,
      products: (await listAvailableProducts(tx, venue.locationId)).products.length,
    }));
    vi.stubEnv("WAITRON_ENV", "production");

    await expect(
      seedDemoRestaurant(suite.db, { venue, locale: LOCALE, salesDays: 7 }),
    ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });

    const after = await withTransaction(suite.db, async (tx) => ({
      menus: (await listAccessibleCatalogues(tx, venue.locationId)).length,
      products: (await listAvailableProducts(tx, venue.locationId)).products.length,
      sales: (
        await tx.execute<{ n: number }>(sql`select cast(count(*) as integer) as n from sales`)
      ).rows[0]!.n,
    }));
    expect(after).toEqual({ ...before, sales: 0 });
  });

  it("routes seeded drinks by zone, dishes to Kitchen, and a test-only no-preparation folder without work", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, { venue, locale: LOCALE, salesDays: 1 });

    await withTransaction(suite.db, async (tx) => {
      const { rows: pass } = await tx.execute<{
        name: string;
        every_zone: number;
        runs_pass: number;
        active: number;
        display_order: number;
        station_name: string;
      }>(sql`
        select w.name, w.every_zone, w.runs_pass, w.active, w.display_order,
               ks.name as station_name
        from watchers w
        join watcher_stations ws on ws.watcher_id = w.id
        join kitchen_stations ks on ks.id = ws.station_id
        where w.location_id = ${venue.locationId}
        order by ks.name`);
      expect(pass).toEqual([
        {
          name: "Pass",
          every_zone: 1,
          runs_pass: 1,
          active: 1,
          display_order: 1,
          station_name: "Deli counter",
        },
        {
          name: "Pass",
          every_zone: 1,
          runs_pass: 1,
          active: 1,
          display_order: 1,
          station_name: "Kitchen",
        },
      ]);
      const cfg = { locationId: brandLocationId(venue.locationId) };
      const { rows: stations } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from kitchen_stations where location_id = ${venue.locationId}`);
      const { rows: zones } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from floor_zones where location_id = ${venue.locationId}`);
      const { products } = await listAvailableProducts(tx, venue.locationId);
      const drink = products.find((product) => product.name === "Negroni")!;
      const dish = products.find((product) => product.name === "Solomillo")!;
      const downstairs = zones.find((zone) => zone.name === "Downstairs bar")!;
      const upstairs = zones.find((zone) => zone.name === "Upstairs bar")!;
      const downstairsStation = stations.find((station) => station.name === "Downstairs bar")!;
      const upstairsStation = stations.find((station) => station.name === "Upstairs bar")!;
      const kitchen = stations.find((station) => station.name === "Kitchen")!;

      expect(
        await resolveMakers(
          tx,
          cfg,
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
        await resolveMakers(
          tx,
          cfg,
          upstairs.id,
          [drink.id, dish.id],
          new Date("2026-10-02T18:30:00Z"),
        ),
      ).toEqual(
        new Map([
          [drink.id, { kind: "made", route: { kind: "station", stationId: upstairsStation.id } }],
          [dish.id, { kind: "made", route: { kind: "station", stationId: kitchen.id } }],
        ]),
      );

      const [menu] = await listAccessibleCatalogues(tx, venue.locationId);
      const folder = await createCategory(tx, { name: "Test-only packaged snacks" });
      const snack = await createProduct(tx, {
        catalogueId: menu!.id,
        name: "Test-only packet of crisps",
        categoryId: folder.id,
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      await setClaim(tx, cfg, folder.id, { kind: "no_preparation" });
      for (const zone of [downstairs, upstairs]) {
        expect(
          await resolveMakers(tx, cfg, zone.id, [snack.id], new Date("2026-10-02T18:30:00Z")),
        ).toEqual(new Map([[snack.id, { kind: "made", route: { kind: "no_preparation" } }]]));
      }
    });
  });

  it("opens Upstairs bar on Friday and Saturday evenings and routes closed evenings to Downstairs bar", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, { venue, locale: LOCALE, salesDays: 1 });

    await withTransaction(suite.db, async (tx) => {
      const cfg = { locationId: brandLocationId(venue.locationId) };
      const { rows: hours } = await tx.execute<{
        weekday: number;
        opens_at: string;
        closes_at: string;
      }>(sql`
        select h.weekday, h.opens_at, h.closes_at from station_hours h
        join kitchen_stations s on s.id = h.station_id
        where s.location_id = ${venue.locationId} and s.name = 'Upstairs bar'
        order by h.weekday`);
      expect(hours).toEqual([
        { weekday: 5, opens_at: "19:00:00", closes_at: "21:00:00" },
        { weekday: 6, opens_at: "19:00:00", closes_at: "21:00:00" },
      ]);
      const { rows: fallbacks } = await tx.execute<{ name: string }>(sql`
        select fallback.name from station_fallbacks f
        join kitchen_stations s on s.id = f.station_id
        join kitchen_stations fallback on fallback.id = f.fallback_station_id
        where s.location_id = ${venue.locationId} and s.name = 'Upstairs bar'`);
      expect(fallbacks).toEqual([{ name: "Downstairs bar" }]);

      const { rows: zones } = await tx.execute<{ id: string }>(sql`
        select id from floor_zones
        where location_id = ${venue.locationId} and name = 'Upstairs bar'`);
      const { rows: stations } = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from kitchen_stations where location_id = ${venue.locationId}`);
      const { products } = await listAvailableProducts(tx, venue.locationId);
      const drink = products.find((product) => product.name === "Negroni")!;
      for (const [instant, stationName] of [
        ["2026-10-02T18:00:00Z", "Upstairs bar"],
        ["2026-10-06T18:00:00Z", "Downstairs bar"],
      ] as const) {
        const station = stations.find((candidate) => candidate.name === stationName)!;
        expect(await resolveMakers(tx, cfg, zones[0]!.id, [drink.id], new Date(instant))).toEqual(
          new Map([
            [drink.id, { kind: "made", route: { kind: "station", stationId: station.id } }],
          ]),
        );
      }
    });
  });

  it("runs every sub-seed: both menus, the floor, the staff, the adjustment reasons, a sale, and content-addressed media", async () => {
    const venue = await provisionVenue();

    await seedDemoRestaurant(suite.db, { venue, locale: LOCALE, salesDays: 7 });

    const read = await withTransaction(suite.db, async (tx) => {
      const menus = await listAccessibleCatalogues(tx, venue.locationId);
      const { products } = await listAvailableProducts(tx, venue.locationId);
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
        default_service_mode: string;
      }>(sql`
        select name, trading_name, default_service_mode
        from departments
        order by name`);
      const { rows: serviceZoneRaw } = await tx.execute<{
        zone_name: string;
        department_name: string;
        service_mode: string;
        is_counter_default: number;
        menus: string;
      }>(sql`
        select z.name as zone_name, d.name as department_name,
               coalesce(p.service_mode, d.default_service_mode) as service_mode,
               p.is_counter_default,
               json_group_array(c.name order by zm.display_order) as menus
        from zone_service_policies p
        join floor_zones z on z.id = p.zone_id
        join departments d on d.id = p.department_id
        join zone_menus zm on zm.zone_id = p.zone_id
        join catalogues c on c.id = zm.menu_id
        group by z.name, d.name, p.service_mode, d.default_service_mode, p.is_counter_default
        order by z.name`);
      const serviceZoneRows = serviceZoneRaw.map((row) => ({
        ...row,
        is_counter_default: row.is_counter_default === 1,
        menus: JSON.parse(row.menus) as string[],
      }));
      const { rows: hoursRows } = await tx.execute<{ department_name: string; days: number }>(sql`
        select d.name as department_name, cast(count(distinct h.weekday) as integer) as days
        from department_hours h
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
        join catalogues c on c.id = mi.menu_id
        where p.name = 'Negroni'
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
        left join option_labels dflt on dflt.id = ol.default_label_id
        group by p.name, ol.name, dflt.name
        order by p.name, ol.name`);
      const optionListRows = optionListRaw.map((row) => ({
        ...row,
        labels: JSON.parse(row.labels) as string[],
      }));
      const { rows: cocktailRouteRows } = await tx.execute<{
        zone_name: string;
        station_name: string;
      }>(sql`
        select z.name as zone_name, s.name as station_name
        from route_exceptions r
        join categories c on c.id = r.category_id
        join floor_zones z on z.id = r.zone_id
        join kitchen_stations s on s.id = r.station_id
        where c.name = 'Drinks'
        order by z.name`);
      const { rows: cocktailClaims } = await tx.execute<{ station_name: string }>(sql`
        select s.name as station_name from station_claims r
        join categories c on c.id = r.category_id
        join kitchen_stations s on s.id = r.station_id
        where c.name = 'Drinks'`);
      const published = await menuStatus(
        tx,
        menus.map((menu) => menu.id),
      );
      return {
        menus,
        cocktailClaims,
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
    const coffee = read.products.find((p) => p.name === "Café");
    const steak = read.products.find((p) => p.name === "Solomillo");
    expect(coffee).toBeDefined();
    expect(steak).toBeDefined();
    expect(coffee!.offeredModifiers).toEqual([]);
    expect(steak!.offeredModifiers.map((entry) => [entry.kind, entry.name])).toEqual([
      ["options", "Punto"],
    ]);
    // The back-dated generator writes one row per dish and nothing below it.
    expect(read.modifierLines).toBe(0);

    expect(read.menus.map((m) => m.name).sort()).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Drinks",
      "Menú del Día",
    ]);
    // Every menu is published as seeded, so a till sells it (D17).
    expect(read.menuStates).toEqual(["current", "current", "current", "current"]);
    expect(read.departments).toEqual([
      {
        name: "Deli",
        trading_name: "Casa Delgado Deli",
        default_service_mode: "prepay",
      },
      {
        name: "Restaurant and bar",
        trading_name: "Casa Delgado",
        default_service_mode: "table_tab",
      },
    ]);
    expect(read.serviceZones).toEqual([
      {
        zone_name: "Deli counter",
        department_name: "Deli",
        service_mode: "prepay",
        is_counter_default: false,
        menus: ["Deli takeaway"],
      },
      {
        zone_name: "Dining room",
        department_name: "Restaurant and bar",
        service_mode: "table_tab",
        is_counter_default: false,
        menus: ["Casa Delgado", "Menú del Día"],
      },
      {
        zone_name: "Downstairs bar",
        department_name: "Restaurant and bar",
        service_mode: "prepay",
        is_counter_default: true,
        menus: ["Casa Delgado", "Menú del Día"],
      },
      {
        zone_name: "Terrace",
        department_name: "Restaurant and bar",
        service_mode: "table_tab",
        is_counter_default: false,
        menus: ["Casa Delgado", "Menú del Día"],
      },
      {
        zone_name: "Upstairs bar",
        department_name: "Restaurant and bar",
        service_mode: "prepay",
        is_counter_default: false,
        menus: ["Casa Delgado", "Menú del Día"],
      },
    ]);
    expect(read.hours).toEqual([
      { department_name: "Deli", days: 6 },
      { department_name: "Restaurant and bar", days: 7 },
    ]);
    expect(read.stations).toEqual(["Deli counter", "Downstairs bar", "Kitchen", "Upstairs bar"]);
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
        menu_name: "Menú del Día",
        gross_price: 900,
        unit_price: 1100,
      },
    ]);
    expect(new Set(read.negroniOffers.map((offer) => offer.product_id)).size).toBe(1);
    expect(read.cocktailClaims).toEqual([{ station_name: "Downstairs bar" }]);
    expect(read.cocktailRoutes).toEqual([
      { zone_name: "Upstairs bar", station_name: "Upstairs bar" },
    ]);

    // The cooking list as it is STORED, behind the `offeredModifiers` read above.
    expect(read.optionLists).toEqual([
      {
        product_name: "Solomillo",
        list_name: "Punto",
        default_label: "Punto medio",
        labels: ["Poco", "Punto medio", "Muy"],
      },
    ]);

    expect(read.tables).toBeGreaterThanOrEqual(16);

    expect(read.staff).toBeGreaterThanOrEqual(5);

    const reasons = await withTransaction(suite.db, (tx) => listAdjustmentReasons(tx));
    expect(reasons.map((reason) => reason.name)).toEqual([
      "Entry error",
      "Changed mind",
      "Unavailable item",
      "Complaint",
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
});
