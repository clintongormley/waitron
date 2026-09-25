import { and, eq, inArray, sql } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { preparationRoutes } from "@waitron/venue-service";
import {
  addCatalogueToLocation,
  addMember,
  addProductToMenu,
  addProducts,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createLabel,
  createProduct,
  createSection,
  createUnit,
  menuItems,
  renameCatalogue,
  requireMenuRoot,
  setProductLabels,
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
  locationId: string;
  locale: SeedLocale;
}

export interface SeedCataloguesResult {
  /** image basename → product id; every seeded product appears exactly once. */
  productsByImage: Map<string, string>;
  menuItemsByProduct: Map<string, string>;
  menuIds: { restaurant: string; lunch: string; deli: string };
}

type StationIds = Record<"kitchen" | "bar" | "deli", string> & {
  upstairsBar: string;
};

async function resolveStationIds(tx: Transaction, locationId: string): Promise<StationIds> {
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
  // Seed scripts have no management session, so insert directly — through the table definition,
  // because the insert BUILDER generates `kitchen_stations.id` and `created_at`.
  const [bar, upstairsBar, deli] = await tx
    .insert(kitchenStations)
    .values(
      [
        { name: "Downstairs bar", displayOrder: 1 },
        { name: "Upstairs bar", displayOrder: 2 },
        { name: "Deli counter", displayOrder: 3 },
      ].map(({ name, displayOrder }) => ({
        locationId,
        name,
        displayOrder,
        isDefault: false,
        active: true,
      })),
    )
    .returning({ id: kitchenStations.id });
  if (bar === undefined || upstairsBar === undefined || deli === undefined) {
    throw new Error(
      `seedCatalogues: failed to create the demo stations for location ${locationId}`,
    );
  }
  return { kitchen, bar: bar.id, upstairsBar: upstairsBar.id, deli: deli.id };
}

/** Casa Delgado becomes the location's default menu; the other menus are added beside it. */
export async function seedCatalogues(
  tx: Transaction,
  { locationId, locale }: SeedCataloguesInput,
): Promise<SeedCataloguesResult> {
  const stationIds = await resolveStationIds(tx, locationId);
  await writeContentLanguages(tx, {
    defaultLanguage: locale,
    languages: locale === "en" ? ["en", "es"] : ["es", "en"],
  });
  const productsByImage = new Map<string, string>();
  const menuItemsByProduct = new Map<string, string>();

  const { rows: provisionedMenus } = await tx.execute<{ id: string }>(sql`
    select default_menu_id as id from zone_service_policies
    where location_id = ${locationId} and is_counter_default
      and default_menu_id is not null
    limit 1`);

  const seedOne = async (data: SeedCatalogue, existingMenuId?: string): Promise<string> => {
    const catalogue =
      existingMenuId === undefined
        ? await createCatalogue(tx, { name: data.name[locale] })
        : { id: existingMenuId };
    if (existingMenuId !== undefined) await renameCatalogue(tx, existingMenuId, data.name[locale]);
    const rootSectionId = await requireMenuRoot(tx, catalogue.id);
    for (const cat of data.categories) {
      const category = await createCategory(tx, { name: cat.name });
      if (cat.station !== null) {
        // The create op takes no station.
        await tx.execute(
          sql`update categories set station_id = ${stationIds[cat.station]} where id = ${category.id}`,
        );
      }
      await tx.insert(preparationRoutes).values({
        locationId,
        categoryId: category.id,
        stationId: cat.station === null ? null : stationIds[cat.station],
        noPreparation: cat.station === null,
      });
      const section = await createSection(
        tx,
        { internalName: (cat.sectionName ?? cat.name)[locale], names: cat.name },
        locale,
      );
      const productIds: string[] = [];
      for (const product of cat.products) {
        const unitId = product.unit
          ? (
              await createUnit(
                tx,
                {
                  name: product.unit.name,
                  precision: product.unit.precision,
                  abbreviation: product.unit.abbreviation,
                },
                locale,
              )
            ).id
          : undefined;
        const created = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: product.staffName ?? product.customerName[locale],
          customerName: product.customerName,
          description: product.description,
          kitchenName: product.kitchenName,
          dietaryDeclarations: product.dietaryDeclarations,
          ...(unitId === undefined ? { pricingUnit: product.pricingUnit } : { unitId }),
          unitPrice: product.unitPrice,
          vatClass: product.vatClass,
        });
        productIds.push(created.id);
        if (product.variants?.length) {
          await setProductVariants(
            tx,
            created.id,
            product.variants.map((variant) => ({
              name: variant.staffName ?? variant.customerName[locale],
              customerName: variant.customerName,
              kitchenName: variant.kitchenName ?? null,
              image: null,
              unitPrice: variant.unitPrice,
              available: variant.available,
            })),
            locale,
          );
        }
        if (productsByImage.has(product.image)) {
          throw new Error(
            `demo-seed: duplicate image basename '${product.image}' — image basenames must be unique across the menu`,
          );
        }
        productsByImage.set(product.image, created.id);
      }
      await addProducts(tx, section.id, productIds);
      await addMember(tx, rootSectionId, { kind: "section", sectionId: section.id });
      // Each product's row sets no menu price, so the menu charges the product's own price and
      // follows it when it changes.
      const rows = await tx
        .select({ id: menuItems.id, productId: menuItems.productId })
        .from(menuItems)
        .where(and(eq(menuItems.menuId, catalogue.id), inArray(menuItems.productId, productIds)));
      if (rows.length !== productIds.length)
        throw new Error(`demo-seed: a product of '${cat.name[locale]}' has no row on its menu`);
      for (const row of rows) menuItemsByProduct.set(row.productId, row.id);
    }
    return catalogue.id;
  };

  const casaId = await seedOne(CASA_DELGADO, provisionedMenus[0]?.id);
  const diaId = await seedOne(MENU_DEL_DIA);
  const deliId = await seedOne(DELI_TAKEAWAY);

  // Two labels that overlap, one of them crossing into a soft drink.
  const alcoholic = await createLabel(tx, "Alcoholic");
  const happyHour = await createLabel(tx, "Happy hour drinks");
  const labelled: [string, string[]][] = [
    ["negroni.png", [alcoholic.id]],
    ["vino-tinto.png", [alcoholic.id, happyHour.id]],
    ["cana-cerveza.png", [alcoholic.id, happyHour.id]],
    ["refresco-cola.png", [happyHour.id]],
  ];
  for (const [image, labelIds] of labelled) {
    const productId = productsByImage.get(image);
    if (productId === undefined) throw new Error(`demo-seed: '${image}' was not created`);
    await setProductLabels(tx, productId, labelIds);
  }

  const negroniId = productsByImage.get("negroni.png");
  if (negroniId === undefined) throw new Error("demo-seed: Negroni product was not created");
  await addProductToMenu(tx, { menuId: diaId, productId: negroniId, grossPrice: "9.00" });

  await assignCatalogueToLocation(tx, locationId, casaId);
  await addCatalogueToLocation(tx, locationId, diaId);
  await addCatalogueToLocation(tx, locationId, deliId);

  return {
    productsByImage,
    menuItemsByProduct,
    menuIds: { restaurant: casaId, lunch: diaId, deli: deliId },
  };
}
