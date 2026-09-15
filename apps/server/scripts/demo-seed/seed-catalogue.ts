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
  createUnit,
  replaceProductCategories,
  setMenuVariants,
  setProductVariants,
  writeContentLanguages,
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
type StationIds = Record<"kitchen" | "bar" | "deli", string> & {
  upstairsBar: string;
};

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
    where id = ${kitchen}`);
  // Seed scripts have no management session, so insert the non-default station directly.
  const { rows: barra } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (${tenantId}, ${locationId}, 'Downstairs bar', 1, false, true)
    returning id`);
  const bar = barra[0]?.id;
  if (bar === undefined) {
    throw new Error(
      `seedCatalogues: failed to create "Downstairs bar" station for location ${locationId}`,
    );
  }
  const { rows: upstairsRows } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (${tenantId}, ${locationId}, 'Upstairs bar', 2, false, true)
    returning id`);
  const upstairsBar = upstairsRows[0]?.id;
  if (upstairsBar === undefined) {
    throw new Error(
      `seedCatalogues: failed to create "Upstairs bar" station for location ${locationId}`,
    );
  }
  const { rows: deliRows } = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, display_order, is_default, active)
    values (${tenantId}, ${locationId}, 'Deli counter', 3, false, true)
    returning id`);
  const deli = deliRows[0]?.id;
  if (deli === undefined) {
    throw new Error(
      `seedCatalogues: failed to create "Deli counter" station for location ${locationId}`,
    );
  }
  return { kitchen, bar, upstairsBar, deli };
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
  await writeContentLanguages(tx, tenantId, {
    defaultLanguage: locale,
    languages: locale === "en" ? ["en", "es"] : ["es", "en"],
  });
  const productsByImage = new Map<string, string>();
  const menuItemsByProduct = new Map<string, string>();
  const categoriesByEnglishName = new Map<string, string>();

  const { rows: provisionedMenus } = await tx.execute<{ id: string }>(sql`
    select default_menu_id as id from zone_service_policies
    where location_id = ${locationId} and is_counter_default
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
        where id = ${existingMenuId}`);
    }
    for (const [categoryIndex, cat] of data.categories.entries()) {
      const category = await createCategory(tx, tenantId, { name: cat.name });
      categoriesByEnglishName.set(cat.name.en, category.id);
      if (cat.station !== null) {
        // The create op takes no station; set the route with a parameterised update. Both the id and
        // the category id are bound params.
        await tx.execute(
          sql`update categories set station_id = ${stationIds[cat.station]} where id = ${category.id}`,
        );
      }
      await tx.execute(sql`
        insert into preparation_routes
          (location_id, category_id, station_id, no_preparation)
        values (
          ${locationId}, ${category.id},
          ${cat.station === null ? null : stationIds[cat.station]}, ${cat.station === null}
        )`);
      const section = await createMenuSection(tx, tenantId, {
        menuId: catalogue.id,
        name: cat.name,
        displayOrder: categoryIndex,
      });
      for (const [productIndex, product] of cat.products.entries()) {
        const unitId = product.unit
          ? (
              await createUnit(
                tx,
                tenantId,
                {
                  name: product.unit.name,
                  precision: product.unit.precision,
                  abbreviation: product.unit.abbreviation,
                },
                locale,
              )
            ).id
          : undefined;
        const created = await createProduct(tx, tenantId, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          // The staff-facing name is the authored short label where the menu gives one, so the demo
          // shows a different string from the customer-facing name on every screen bound to the staff
          // name. Where the menu gives none the two are the same word anyway, and it falls back to the
          // seeded locale's entry. The customer-facing map keeps both locales, so a receipt in the
          // venue's invoice locale reads the authored translation.
          name: product.staffName ?? product.customerName[locale],
          customerName: product.customerName,
          description: product.description,
          kitchenName: product.kitchenName,
          dietaryDeclarations: product.dietaryDeclarations,
          ...(unitId === undefined ? { pricingUnit: product.pricingUnit } : { unitId }),
          unitPrice: product.unitPrice,
          vatClass: product.vatClass,
        });
        const menuItem = await createMenuItem(tx, tenantId, {
          menuId: catalogue.id,
          productId: created.id,
          sectionId: section.id,
          grossPrice: product.unitPrice,
          displayOrder: productIndex,
        });
        menuItemsByProduct.set(created.id, menuItem.id);
        if (product.variants?.length) {
          const variants = await setProductVariants(
            tx,
            tenantId,
            created.id,
            product.variants.map((variant) => ({
              name: variant.staffName ?? variant.customerName[locale],
              customerName: variant.customerName,
              kitchenName: variant.kitchenName ?? null,
              image: null,
              unitPrice: variant.productPrice,
              available: variant.available,
            })),
            locale,
          );
          await setMenuVariants(
            tx,
            tenantId,
            menuItem.id,
            variants.map((variant, index) => ({
              variantId: variant.id,
              unitPrice: product.variants![index]!.menuPrice,
              available: product.variants![index]!.available,
            })),
          );
        }
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

  const coffeeId = productsByImage.get("cafe-solo.png");
  const drinksId = categoriesByEnglishName.get("Drinks");
  if (coffeeId === undefined || drinksId === undefined)
    throw new Error("demo-seed: Coffee or Drinks was not created");
  const hotDrinks = await createCategory(tx, tenantId, {
    name: { en: "Hot drinks", es: "Bebidas calientes" },
  });
  await replaceProductCategories(tx, tenantId, coffeeId, {
    categoryIds: [drinksId, hotDrinks.id],
    primaryCategoryId: drinksId,
  });

  const negroniId = productsByImage.get("negroni.png");
  if (negroniId === undefined) throw new Error("demo-seed: Negroni product was not created");
  const cocktailSection = await createMenuSection(tx, tenantId, {
    menuId: diaId,
    name: { en: "Cocktails", es: "Cócteles" },
    displayOrder: MENU_DEL_DIA.categories.length,
  });
  await createMenuItem(tx, tenantId, {
    menuId: diaId,
    productId: negroniId,
    sectionId: cocktailSection.id,
    grossPrice: "9.00",
    displayOrder: 0,
  });

  await assignCatalogueToLocation(tx, locationId, casaId);
  await addCatalogueToLocation(tx, tenantId, locationId, diaId);
  await addCatalogueToLocation(tx, tenantId, locationId, deliId);

  return {
    productsByImage,
    menuItemsByProduct,
    menuIds: { restaurant: casaId, lunch: diaId, deli: deliId },
  };
}
