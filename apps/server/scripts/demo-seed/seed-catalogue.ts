// Seed both demo menus in the caller's transaction and return the image-to-product map.
// The explicit tenant id supplies writes; this module resolves the kitchen stations.

import { sql } from "drizzle-orm";
import type { TenantId } from "@waitron/shared";
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

/** Resolve the location's provisioned Cocina station and create its non-default Barra station. */
async function resolveStationIds(
  tx: Transaction,
  tenantId: TenantId,
  locationId: string,
): Promise<StationIds> {
  const { rows: cocina } = await tx.execute<{ id: string }>(sql`
    select id from kitchen_stations
    where location_id = ${locationId} and name = 'Cocina'
    limit 1`);
  const kitchen = cocina[0]?.id;
  if (kitchen === undefined) {
    throw new Error(`seedCatalogues: no "Cocina" station found for location ${locationId}`);
  }
  // Seed scripts have no management session, so insert the non-default station directly.
  const { rows: barra } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (${tenantId}, ${locationId}, 'Barra', 1, false, true)
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
  tenantId: TenantId,
  { locationId, locale }: SeedCataloguesInput,
): Promise<SeedCataloguesResult> {
  const stationIds = await resolveStationIds(tx, tenantId, locationId);
  const productsByImage = new Map<string, string>();

  const seedOne = async (data: SeedCatalogue): Promise<string> => {
    const catalogue = await createCatalogue(tx, tenantId, { name: data.name[locale] });
    for (const cat of data.categories) {
      const category = await createCategory(tx, tenantId, { name: cat.name[locale] });
      if (cat.station !== null) {
        // The create op takes no station; set the route with a parameterised update. Both the id and
        // the category id are bound params.
        await tx.execute(
          sql`update categories set station_id = ${stationIds[cat.station]} where id = ${category.id}`,
        );
      }
      for (const product of cat.products) {
        const created = await createProduct(tx, tenantId, {
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
        if (productsByImage.has(product.image)) {
          throw new Error(
            `demo-seed: duplicate image basename '${product.image}' — image basenames must be unique across the menu`,
          );
        }
        productsByImage.set(product.image, created.id);
      }
    }
    return catalogue.id;
  };

  const casaId = await seedOne(CASA_DELGADO);
  const diaId = await seedOne(MENU_DEL_DIA);

  await assignCatalogueToLocation(tx, locationId, casaId);
  await addCatalogueToLocation(tx, tenantId, locationId, diaId);

  return { productsByImage };
}
