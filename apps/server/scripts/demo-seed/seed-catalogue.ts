// `seedCatalogues` — the demo-seed's catalogue step (Phase 2, Task 6). Given a provisioned venue's
// location, it stands up the two demo menus (menu.ts), wires KDS routing, and reports which product
// each image basename became so Task 9's media step can attach the real PNGs.
//
// It runs inside the CALLER's transaction, under the tenant GUC the caller set with `withTenant` and
// (in the demo/POS shape) `asAppUser` — so every write adopts the current tenant through
// `current_tenant_id()` and satisfies each table's `WITH CHECK (tenant_id = current_tenant_id())`.
// It takes no `tenantId`/`stationIds` argument: the GUC is the single source of the tenant, and this
// module OWNS station resolution (see `resolveStationIds`).
//
// All SQL is parameterised via Drizzle's `sql` template (the station lookup, the Barra insert, the
// category route update) — never string-concatenated (CLAUDE.md §3).

import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  addCatalogueToLocation,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { CASA_DELGADO, MENU_DEL_DIA, type SeedCatalogue, type SeedLocale } from "./menu.js";

export interface SeedCataloguesInput {
  /** The provisioned venue's location — the default/accessible catalogue assignment target, and the
   * location whose "Cocina" station is looked up and whose "Barra" station is created. */
  locationId: string;
  /** Which of the two authored locales each catalogue/category/product is created under. */
  locale: SeedLocale;
}

export interface SeedCataloguesResult {
  /** image basename → created product id, for Task 9's media attach and the sales generator. Every
   * seeded product appears exactly once (the menu's image basenames are unique across both menus). */
  productsByImage: Map<string, string>;
}

/** The logical routing targets a seed category names, mapped to their concrete `kitchen_stations.id`. */
type StationIds = Record<"kitchen" | "bar", string>;

/**
 * Resolve the KDS station ids this seed routes to. Provisioning (`applyVenue`) seeds exactly one
 * DEFAULT station named "Cocina" per location, so `kitchen` is a lookup; the bar is not seeded by
 * provisioning, so this creates a second, NON-default "Barra" station. Both run under the caller's
 * tenant GUC as `app_user` (SELECT + INSERT on `kitchen_stations`, granted by 0027-era migrations).
 */
async function resolveStationIds(tx: Transaction, locationId: string): Promise<StationIds> {
  const { rows: cocina } = await tx.execute<{ id: string }>(sql`
    select id from kitchen_stations
    where location_id = ${locationId} and name = 'Cocina'
    limit 1`);
  const kitchen = cocina[0]?.id;
  if (kitchen === undefined) {
    throw new Error(`seedCatalogues: no "Cocina" station found for location ${locationId}`);
  }
  // Create "Barra" for drinks via a raw insert because `createStation` (apps/server/src/kitchen.ts) is
  // management-session-gated (`withVenueAuth`), which a seed script has no session for — the same
  // raw-insert-past-a-gated-helper pattern `seedFloor`/`seedStaff` use. NOT the default (the partial
  // unique allows one default per location, which "Cocina" already holds). `current_tenant_id()`
  // satisfies the FORCE-RLS WITH CHECK.
  const { rows: barra } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (current_tenant_id(), ${locationId}, 'Barra', 1, false, true)
    returning id`);
  const bar = barra[0]?.id;
  if (bar === undefined) {
    throw new Error(`seedCatalogues: failed to create "Barra" station for location ${locationId}`);
  }
  return { kitchen, bar };
}

/**
 * Seed both demo menus onto `locationId` under the caller's tenant context, routing each category to
 * its KDS station, setting Casa Delgado as the location DEFAULT and Menú del Día as an accessible
 * second menu. Returns the image→productId map for the downstream media/sales steps.
 */
export async function seedCatalogues(
  tx: Transaction,
  { locationId, locale }: SeedCataloguesInput,
): Promise<SeedCataloguesResult> {
  const stationIds = await resolveStationIds(tx, locationId);
  const productsByImage = new Map<string, string>();

  const seedOne = async (data: SeedCatalogue): Promise<string> => {
    const catalogue = await createCatalogue(tx, { name: data.name[locale] });
    for (const cat of data.categories) {
      const category = await createCategory(tx, { name: cat.name[locale] });
      if (cat.station !== null) {
        // The create op takes no station; set the route with a parameterised update. Both the id and
        // the category id are bound params.
        await tx.execute(
          sql`update categories set station_id = ${stationIds[cat.station]} where id = ${category.id}`,
        );
      }
      for (const product of cat.products) {
        const created = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          // Only the active locale's text — the till reads the venue's locale, and a single-locale
          // description is what the demo needs (the other locale lives in menu.ts for reuse).
          descriptions: { [locale]: product.descriptions[locale] },
          pricingUnit: product.pricingUnit,
          unitPrice: product.unitPrice,
          vatClass: product.vatClass,
          image: product.image,
        });
        productsByImage.set(product.image, created.id);
      }
    }
    return catalogue.id;
  };

  const casaId = await seedOne(CASA_DELGADO);
  const diaId = await seedOne(MENU_DEL_DIA);

  await assignCatalogueToLocation(tx, locationId, casaId);
  await addCatalogueToLocation(tx, locationId, diaId);

  return { productsByImage };
}
