// Real-Postgres proof of `seedDemoRestaurant` (Phase 2, Task 11): the orchestrator that wires the
// Task 6-10 sub-seeds together — catalogues → floor → staff → media (inside ONE
// `withTenant`/`asAppUser` tx), then the historical sales (its own per-sale tx, OUTSIDE that tx). This
// asserts every sub-seed actually ran: both menus present, the full floor, the staff, ≥1 back-dated
// sale, and a product's `image` rewritten to the content-addressed served name.
//
// Real Postgres (not PGlite): the sub-seeds run as `app_user` and `seedSales` writes real
// hash-chained preproduction `registros_facturacion` rows through `recordSale` — PGlite's
// superuser connection cannot check those grants; its triggers still fire (CLAUDE.md §4). Uses
// the shared `manifest` template, cloned per file via `useTemplateDb`.
//
// Preproduction only: `WAITRON_ENV` is left unset, which `deploymentEnvironment` resolves to
// `preproduction` — the safe default `seedSales` stamps (a wrong `entorno` is unrecoverable, §5).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
import { seedDemoRestaurant } from "./seed.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF. A distinct base (90_000_000) keeps this suite's NIFs
// from colliding with seed-catalogue's 50M and seed-sales' 80M ranges on the shared container.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(90_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

/** Provision a fresh chained venue (as the owner) and return the ids the orchestrator needs. */
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
    { db: suite.admin, modules: ALL_MODULES },
  );
  return {
    tenantId: venue.tenantId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };
}

describe("seedDemoRestaurant", () => {
  let mediaDir: string;
  const priorMediaDir = process.env.WAITRON_MEDIA_DIR;

  beforeAll(async () => {
    // Point the media step at a throwaway dir, never the repo's dev media store.
    mediaDir = await mkdtemp(join(tmpdir(), "waitron-seed-media-"));
    process.env.WAITRON_MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    if (priorMediaDir === undefined) delete process.env.WAITRON_MEDIA_DIR;
    else process.env.WAITRON_MEDIA_DIR = priorMediaDir;
    if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
  });

  it("runs every sub-seed: both menus, the floor, the staff, a sale, and content-addressed media", async () => {
    const venue = await provisionVenue();

    // A horizon long enough that the deterministic sales LCG (seeded fixed, not by `days`) is all but
    // certain to draw the coffee/steak at least once each — see the modifier assertions below.
    await seedDemoRestaurant(suite.admin, { venue, locale: LOCALE, salesDays: 7 });

    const read = await withTenant(suite.admin, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      const menus = await listAccessibleCatalogues(tx, venue.locationId);
      const { products } = await listAvailableProducts(tx, venue.locationId);
      const { rows: tableRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from dining_tables`,
      );
      const { rows: staffRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from persons`,
      );
      const { rows: saleRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from sales`,
      );
      const { rows: modifierLineRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from sale_lines where parent_line_id is not null`,
      );
      const { rows: departmentRows } = await tx.execute<{
        name: string;
        trading_name: string;
        default_service_mode: string;
      }>(sql`
        select name, trading_name, default_service_mode
        from departments
        order by name`);
      const { rows: serviceZoneRows } = await tx.execute<{
        zone_name: string;
        department_name: string;
        menus: string[];
      }>(sql`
        select z.name as zone_name, d.name as department_name,
               array_agg(c.name order by zm.display_order) as menus
        from zone_service_policies p
        join floor_zones z on z.tenant_id = p.tenant_id and z.id = p.zone_id
        join departments d on d.tenant_id = p.tenant_id and d.id = p.department_id
        join zone_menus zm on zm.tenant_id = p.tenant_id and zm.zone_id = p.zone_id
        join catalogues c on c.tenant_id = zm.tenant_id and c.id = zm.menu_id
        group by z.name, d.name
        order by z.name`);
      const { rows: hoursRows } = await tx.execute<{ department_name: string; days: number }>(sql`
        select d.name as department_name, count(distinct h.weekday)::int as days
        from department_hours h
        join departments d on d.tenant_id = h.tenant_id and d.id = h.department_id
        group by d.name
        order by d.name`);
      const { rows: stationRows } = await tx.execute<{ name: string }>(sql`
        select name from kitchen_stations where active order by name`);
      const { rows: negroniRows } = await tx.execute<{
        product_id: string;
        menu_name: string;
        gross_price: string;
      }>(sql`
        select mi.product_id, c.name as menu_name, mi.gross_price
        from menu_items mi
        join products p on p.tenant_id = mi.tenant_id and p.id = mi.product_id
        join catalogues c on c.tenant_id = mi.tenant_id and c.id = mi.menu_id
        where p.descriptions->>'en' = 'Negroni'
        order by mi.gross_price`);
      const { rows: cocktailRouteRows } = await tx.execute<{
        zone_name: string;
        station_name: string;
      }>(sql`
        select z.name as zone_name, s.name as station_name
        from preparation_routes r
        join categories c on c.tenant_id = r.tenant_id and c.id = r.category_id
        join floor_zones z on z.tenant_id = r.tenant_id and z.id = r.zone_id
        join kitchen_stations s on s.tenant_id = r.tenant_id and s.id = r.station_id
        where c.name = 'Drinks'
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
      };
    });

    // Ordering modifiers (Phase 4, Task 13): the coffee carries Size + Milk, the steak carries
    // Extras + Cooking, and the back-dated sales generator actually rang at least one of them with a
    // selection — the whole point of seeding modifiers into the demo.
    const coffee = read.products.find((p) => p.descriptions[LOCALE] === "Coffee");
    const steak = read.products.find((p) => p.descriptions[LOCALE] === "Sirloin in whisky sauce");
    expect(coffee).toBeDefined();
    expect(steak).toBeDefined();
    expect(coffee!.optionGroups.map((g) => g.name[LOCALE]).sort()).toEqual(["Milk", "Size"]);
    expect(steak!.optionGroups.map((g) => g.name[LOCALE]).sort()).toEqual(["Cooking", "Extras"]);
    expect(read.modifierLines).toBeGreaterThan(0);

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
        menus: ["Deli takeaway"],
      },
      {
        zone_name: "Dining room",
        department_name: "Restaurant and bar",
        menus: ["Casa Delgado", "Menú del Día"],
      },
      {
        zone_name: "Downstairs bar",
        department_name: "Restaurant and bar",
        menus: ["Casa Delgado", "Menú del Día"],
      },
      {
        zone_name: "Terrace",
        department_name: "Restaurant and bar",
        menus: ["Casa Delgado", "Menú del Día"],
      },
      {
        zone_name: "Upstairs bar",
        department_name: "Restaurant and bar",
        menus: ["Casa Delgado", "Menú del Día"],
      },
    ]);
    expect(read.hours).toEqual([
      { department_name: "Deli", days: 6 },
      { department_name: "Restaurant and bar", days: 7 },
    ]);
    expect(read.stations).toEqual(["Deli counter", "Downstairs bar", "Kitchen", "Upstairs bar"]);
    expect(read.negroniOffers).toEqual([
      { product_id: expect.any(String), menu_name: "Menú del Día", gross_price: "9.00" },
      { product_id: expect.any(String), menu_name: "Casa Delgado", gross_price: "11.00" },
    ]);
    expect(new Set(read.negroniOffers.map((offer) => offer.product_id)).size).toBe(1);
    expect(read.cocktailRoutes).toEqual([
      { zone_name: "Downstairs bar", station_name: "Downstairs bar" },
      { zone_name: "Upstairs bar", station_name: "Upstairs bar" },
    ]);

    // Floor: the ~16-table demo plan (seedFloor seeds 16).
    expect(read.tables).toBeGreaterThanOrEqual(16);

    // Staff: the demo team (seedStaff seeds 6).
    expect(read.staff).toBeGreaterThanOrEqual(5);

    // Sales: at least one back-dated preproduction sale (seedSales).
    expect(read.sales).toBeGreaterThanOrEqual(1);

    // Products were seeded (feed the sales generator).
    expect(read.products.length).toBeGreaterThan(0);

    // Media: seedMedia rewrote each product's `image` to the served `<sha256hex>.png` name.
    // listAvailableProducts does not project `image`, so read one product's image directly.
    const { rows: imageRows } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ image: string | null }>(
        sql`select image from products where image is not null limit 1`,
      );
    });
    expect(imageRows.length).toBe(1);
    expect(imageRows[0]!.image).toMatch(/^[0-9a-f]{64}\.png$/);
  });
});
