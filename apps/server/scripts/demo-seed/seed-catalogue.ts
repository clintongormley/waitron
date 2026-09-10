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
  createMenuItem,
  createMenuSection,
  createProduct,
} from "@waitron/catalogue";
import {
  CASA_DELGADO,
  DELI_TAKEAWAY,
  MENU_DEL_DIA,
  type SeedCatalogue,
  type SeedLocale,
} from "./menu.js";

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
  menuItemsByProduct: Map<string, string>;
  menuIds: { restaurant: string; lunch: string; deli: string };
}

/** The logical routing targets a seed category names, mapped to their concrete `kitchen_stations.id`. */
type StationIds = Record<"kitchen" | "bar" | "deli", string>;

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
  await tx.execute(sql`
    update kitchen_stations set name = 'Kitchen'
    where tenant_id = ${tenantId} and id = ${kitchen}`);
  // Seed scripts have no management session, so insert the non-default station directly.
  const { rows: barra } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (${tenantId}, ${locationId}, 'Bar', 1, false, true)
    returning id`);
  const bar = barra[0]?.id;
  if (bar === undefined) {
    throw new Error(`seedCatalogues: failed to create "Barra" station for location ${locationId}`);
  }
  const { rows: deliRows } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (${tenantId}, ${locationId}, 'Deli counter', 2, false, true)
    returning id`);
  const deli = deliRows[0]?.id;
  if (deli === undefined) {
    throw new Error(
      `seedCatalogues: failed to create "Deli counter" station for location ${locationId}`,
    );
  }
  return { kitchen, bar, deli };
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
  const menuItemsByProduct = new Map<string, string>();

  const { rows: provisionedMenus } = await tx.execute<{ id: string }>(sql`
    select default_menu_id as id from zone_service_policies
    where tenant_id = ${tenantId} and location_id = ${locationId} and is_counter_default
      and default_menu_id is not null
    limit 1`);

  const seedOne = async (data: SeedCatalogue, existingMenuId?: string): Promise<string> => {
    const catalogue =
      existingMenuId === undefined
        ? await createCatalogue(tx, tenantId, { name: data.name[locale] })
        : { id: existingMenuId };
    if (existingMenuId !== undefined) {
      await tx.execute(sql`
        update catalogues set name = ${data.name[locale]}
        where tenant_id = ${tenantId} and id = ${existingMenuId}`);
    }
    for (const [categoryIndex, cat] of data.categories.entries()) {
      const category = await createCategory(tx, tenantId, { name: cat.name[locale] });
      if (cat.station !== null) {
        // The create op takes no station; set the route with a parameterised update. Both the id and
        // the category id are bound params.
        await tx.execute(
          sql`update categories set station_id = ${stationIds[cat.station]} where id = ${category.id}`,
        );
      }
      await tx.execute(sql`
        insert into preparation_routes
          (tenant_id, location_id, category_id, station_id, no_preparation)
        values (
          ${tenantId}, ${locationId}, ${category.id},
          ${cat.station === null ? null : stationIds[cat.station]}, ${cat.station === null}
        )`);
      const section = await createMenuSection(tx, tenantId, {
        menuId: catalogue.id,
        name: { [locale]: cat.name[locale] },
        displayOrder: categoryIndex,
      });
      for (const [productIndex, product] of cat.products.entries()) {
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
        const menuItem = await createMenuItem(tx, tenantId, {
          menuId: catalogue.id,
          productId: created.id,
          sectionId: section.id,
          grossPrice: product.unitPrice,
          displayOrder: productIndex,
        });
        menuItemsByProduct.set(created.id, menuItem.id);
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

  const casaId = await seedOne(CASA_DELGADO, provisionedMenus[0]?.id);
  const diaId = await seedOne(MENU_DEL_DIA);
  const deliId = await seedOne(DELI_TAKEAWAY);

  await assignCatalogueToLocation(tx, locationId, casaId);
  await addCatalogueToLocation(tx, tenantId, locationId, diaId);
  await addCatalogueToLocation(tx, tenantId, locationId, deliId);

  return {
    productsByImage,
    menuItemsByProduct,
    menuIds: { restaurant: casaId, lunch: diaId, deli: deliId },
  };
}
