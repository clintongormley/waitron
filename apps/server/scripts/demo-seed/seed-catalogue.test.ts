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
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  return { tenantId: venue.tenantId, locationId: venue.locationId };
}

describe("seedCatalogues", () => {
  it("creates both menus, routes categories to stations, and sets the default + accessible second", async () => {
    const { tenantId, locationId } = await provisionVenue();

    const res = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const out = await seedCatalogues(tx, brandTenantId(tenantId), { locationId, locale: LOCALE });
      const menus = await listAccessibleCatalogues(tx, locationId);
      const { products } = await listAvailableProducts(tx, locationId);
      // Read back the two stations and one category's route per menu, as app_user, to prove routing.
      const { rows: stations } = await tx.execute<{ name: string; is_default: boolean }>(sql`
        select name, is_default from kitchen_stations where location_id = ${locationId}`);
      const { rows: drinksRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        left join kitchen_stations ks on ks.id = c.station_id
        where c.name = 'Drinks'`);
      const { rows: charcuterieRoute } = await tx.execute<{ station_name: string | null }>(sql`
        select ks.name as station_name
        from categories c
        left join kitchen_stations ks on ks.id = c.station_id
        where c.name = 'Charcuterie'`);
      return { out, menus, products, stations, drinksRoute, charcuterieRoute };
    });

    // Casa Delgado is the default and sorts first; Menú del Día is the accessible second.
    expect(res.menus.map((m) => m.name)).toEqual(["Casa Delgado", "Menú del Día"]);
    expect(res.menus.find((m) => m.name === "Casa Delgado")!.isDefault).toBe(true);
    expect(res.menus.find((m) => m.name === "Menú del Día")!.isDefault).toBe(false);

    // Products span BOTH menus and clear the demo floor.
    expect(res.products.length).toBeGreaterThan(35);
    const menuNames = new Set(res.products.map((p) => p.catalogueName));
    expect(menuNames).toEqual(new Set(["Casa Delgado", "Menú del Día"]));

    // A known dish from each menu is present.
    expect(res.products.some((p) => p.descriptions[LOCALE] === "Sliced Iberian ham (per kg)")).toBe(
      true,
    );
    expect(res.products.some((p) => p.descriptions[LOCALE] === "Mixed salad")).toBe(true);

    // The seed created "Barra" beside the provisioning-seeded "Cocina" (the default).
    const cocina = res.stations.find((s) => s.name === "Cocina");
    const barra = res.stations.find((s) => s.name === "Barra");
    expect(cocina?.is_default).toBe(true);
    expect(barra).toBeDefined();
    expect(barra?.is_default).toBe(false);

    // Routing: a drinks category → the bar (Barra); a food category → the kitchen (Cocina).
    expect(res.drinksRoute[0]?.station_name).toBe("Barra");
    expect(res.charcuterieRoute[0]?.station_name).toBe("Cocina");

    // The returned map covers every seeded product and points at a real created id.
    expect(res.out.productsByImage.size).toBe(res.products.length);
    const hamId = res.out.productsByImage.get("jamon-iberico.png");
    expect(hamId).toBeDefined();
    expect(res.products.some((p) => p.id === hamId)).toBe(true);
  });
});
