import { tenantId as brandTenantId } from "@waitron/shared";
// Real-Postgres proof of `seedCatalogues` (Phase 2, Task 6): it stands up the two demo menus,
// routes categories to KDS stations, sets the default + the accessible second, and reports the
// image→product map. Real Postgres (not PGlite): the seed runs as `app_user` (SELECT/INSERT on
// `kitchen_stations`, INSERT on `catalogues`/`categories`/`products`, UPDATE of
// `categories.station_id`) exactly as the demo scripts do, and PGlite's superuser connection
// cannot check those grants (CLAUDE.md §4). Uses the shared `manifest` template (which includes
// the KDS migrations, so `kitchen_stations` and `categories.station_id` exist), cloned per file
// via `useTemplateDb`, the same pattern as `till-sale.test.ts`.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import {
  listAccessibleCatalogues,
  listAvailableProducts,
  readContentLanguages,
} from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same local-counter shape `till-sale.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
async function provisionVenue(): Promise<{ tenantId: string; locationId: string }> {
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
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  return { tenantId: venue.tenantId, locationId: venue.locationId };
}

describe("seedCatalogues", () => {
  it("creates restaurant, lunch and deli menus and routes each category to its preparation station", async () => {
    const { tenantId, locationId } = await provisionVenue();

    const res = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const out = await seedCatalogues(tx, brandTenantId(tenantId), { locationId, locale: LOCALE });
      const menus = await listAccessibleCatalogues(tx, locationId);
      const { products } = await listAvailableProducts(tx, locationId);
      const contentLanguages = await readContentLanguages(tx, brandTenantId(tenantId), LOCALE);
      // Read back the two stations and one category's route per menu, as app_user, to prove routing.
      const { rows: stations } = await tx.execute<{ name: string; is_default: boolean }>(sql`
        select name, is_default from kitchen_stations where location_id = ${locationId}`);
      const { rows: drinksRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        left join kitchen_stations ks on ks.id = c.station_id
        where c.name->>'en' = 'Drinks'`);
      const { rows: charcuterieRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        left join kitchen_stations ks on ks.id = c.station_id
        where c.name->>'en' = 'Charcuterie'`);
      const { rows: editorDemo } = await tx.execute<{
        description: Record<string, string> | null;
        kitchen_name: string | null;
        dietary_declarations: string[];
        category_count: number;
        primary_category: string;
        variant_prices: string[];
        menu_variant_prices: string[];
      }>(sql`
        select p.description, p.kitchen_name, p.dietary_declarations,
          count(distinct pc.category_id)::int as category_count,
          c.name->>'en' as primary_category,
          array_agg(distinct pv.unit_price::text order by pv.unit_price::text) as variant_prices,
          array_agg(distinct mv.unit_price::text order by mv.unit_price::text) as menu_variant_prices
        from products p
        join categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
        join product_categories pc on pc.product_id = p.id and pc.tenant_id = p.tenant_id
        join product_variants pv on pv.product_id = p.id and pv.tenant_id = p.tenant_id
        join menu_item_variants mv on mv.product_id = p.id and mv.variant_id = pv.id and mv.tenant_id = p.tenant_id
        where p.descriptions->>'en' = 'Coffee'
        group by p.id, c.name`);
      const { rows: customUnit } = await tx.execute<{
        precision: number;
        name: Record<string, string>;
      }>(sql`
        select u.precision, u.name from units u
        join product_units pu on pu.unit_id = u.id and pu.tenant_id = u.tenant_id
        join products p on p.id = pu.product_id and p.tenant_id = pu.tenant_id
        where p.descriptions->>'en' = 'Mixed salad'`);
      return {
        out,
        menus,
        products,
        contentLanguages,
        stations,
        drinksRoute,
        charcuterieRoute,
        editorDemo,
        customUnit,
      };
    });

    expect(res.menus.map((m) => m.name)).toEqual(["Casa Delgado", "Deli takeaway", "Menú del Día"]);
    expect(res.menus.find((m) => m.name === "Casa Delgado")!.isDefault).toBe(true);
    expect(res.menus.find((m) => m.name === "Menú del Día")!.isDefault).toBe(false);
    expect(res.contentLanguages).toEqual({
      defaultLanguage: "en",
      languages: ["en", "es"],
    });

    // Products span BOTH menus and clear the demo floor.
    expect(res.products.length).toBeGreaterThan(35);
    const menuNames = new Set(res.products.map((p) => p.catalogueName));
    expect(menuNames).toEqual(new Set(["Casa Delgado", "Menú del Día", "Deli takeaway"]));

    // A known dish from each menu is present.
    expect(res.products.some((p) => p.descriptions[LOCALE] === "Sliced Iberian ham (per kg)")).toBe(
      true,
    );
    expect(res.products.some((p) => p.descriptions[LOCALE] === "Mixed salad")).toBe(true);

    const cocina = res.stations.find((s) => s.name === "Kitchen");
    const downstairsBar = res.stations.find((s) => s.name === "Downstairs bar");
    const upstairsBar = res.stations.find((s) => s.name === "Upstairs bar");
    const deli = res.stations.find((s) => s.name === "Deli counter");
    expect(cocina?.is_default).toBe(true);
    expect(downstairsBar?.is_default).toBe(false);
    expect(upstairsBar?.is_default).toBe(false);
    expect(deli?.is_default).toBe(false);

    // Routing: a drinks category → the bar (Barra); a food category → the kitchen (Cocina).
    expect(res.drinksRoute[0]?.station_name).toBe("Downstairs bar");
    expect(res.charcuterieRoute[0]?.station_name).toBe("Deli counter");

    expect(res.editorDemo).toEqual([
      {
        description: {
          en: "Freshly ground espresso from the downstairs bar",
          es: "Espresso recién molido de la barra de abajo",
        },
        kitchen_name: "COFFEE · DOWNSTAIRS BAR",
        dietary_declarations: ["vegetarian", "halal"],
        category_count: 2,
        primary_category: "Drinks",
        variant_prices: ["1.40", "2.10"],
        menu_variant_prices: ["1.75", "2.60"],
      },
    ]);
    expect(res.customUnit).toEqual([{ precision: 2, name: { en: "serving", es: "ración" } }]);

    // The returned map covers every seeded product and points at a real created id.
    expect(res.out.productsByImage.size).toBe(res.products.length);
    const hamId = res.out.productsByImage.get("jamon-iberico.png");
    expect(hamId).toBeDefined();
    expect(res.products.some((p) => p.id === hamId)).toBe(true);
  });
});
