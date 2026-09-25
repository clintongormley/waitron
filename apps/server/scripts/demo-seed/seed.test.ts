/**
 * `seedDemoRestaurant` runs every sub-seed. `WAITRON_ENV` is left unset, so `deploymentEnvironment`
 * resolves to `preproduction` for the seeded sales.
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
import { seedDemoRestaurant } from "./seed.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One NIF per provisioned venue.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(90_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

async function provisionVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("5555"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  return {
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };
}

describe("seedDemoRestaurant", () => {
  it("runs every sub-seed: both menus, the floor, the staff, a sale, and content-addressed media", async () => {
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
        from preparation_routes r
        join categories c on c.id = r.category_id
        join floor_zones z on z.id = r.zone_id
        join kitchen_stations s on s.id = r.station_id
        where c.name->>'en' = 'Drinks'
        order by z.name`);
      return {
        menus,
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
      "Menú del Día",
    ]);
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
    // Casa Delgado sets no menu price, so it charges the product's own 11.00; Menú del Día sets
    // its own 9.00.
    expect(read.negroniOffers).toEqual([
      {
        product_id: expect.any(String),
        menu_name: "Casa Delgado",
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
    expect(read.cocktailRoutes).toEqual([
      { zone_name: "Downstairs bar", station_name: "Downstairs bar" },
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
