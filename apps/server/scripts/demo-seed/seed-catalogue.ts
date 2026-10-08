import { and, eq, inArray, sql } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { setRoutingCell } from "@waitron/venue-service";
import { locationId as brandLocationId } from "@waitron/shared";
import {
  addCatalogueToLocation,
  addMember,
  addProductToMenu,
  addProducts,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  createSectionIn,
  createUnit,
  menuItems,
  updateMenuDetails,
  updateMenuItem,
  requireMenuRoot,
  setProductVariants,
  writeContentLanguages,
} from "@waitron/catalogue";
import type { SeedLocale } from "./menu.js";
import { demoLanguagesFor, type DemoDataSet, type SeedCatalogue } from "./data-set.js";
import { inLanguages } from "./in-languages.js";

export interface SeedCataloguesInput {
  locationId: string;
  locale: SeedLocale;
  dataSet: DemoDataSet;
}

export interface SeedCataloguesResult {
  /** image basename → product id; every seeded product appears exactly once. */
  productsByImage: Map<string, string>;
  menuItemsByProduct: Map<string, string>;
  menuIds: { restaurant: string; lunch: string; deli: string; drinks: string };
  stationIds: StationIds;
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

/**
 * The data set's restaurant menu becomes the location's default menu; the others are added beside
 * it.
 */
export async function seedCatalogues(
  tx: Transaction,
  { locationId, locale, dataSet }: SeedCataloguesInput,
): Promise<SeedCataloguesResult> {
  const stationIds = await resolveStationIds(tx, locationId);
  const { rows: geography } = await tx.execute<{ province: string | null; country: string }>(sql`
    select l.province, t.country from locations l
    cross join tenants t
    where l.id = ${locationId}`);
  const { defaultLanguage, languages, required } = demoLanguagesFor(dataSet, {
    country: geography[0]?.country,
    area: geography[0]?.province,
  });
  await writeContentLanguages(
    tx,
    { defaultLanguage, languages: [...languages] },
    defaultLanguage,
    undefined,
    required,
  );
  const translated = (text: Readonly<Record<string, string>>) => inLanguages(text, languages);
  const productsByImage = new Map<string, string>();
  const menuItemsByProduct = new Map<string, string>();

  const { rows: provisionedMenus } = await tx.execute<{ id: string }>(sql`
    select d.menu_id as id from zone_service_policies p
    join department_all_day_menus d on d.department_id = p.department_id
    where p.location_id = ${locationId} and p.is_counter_default
    limit 1`);

  const seedOne = async (data: SeedCatalogue, existingMenuId?: string): Promise<string> => {
    const catalogue =
      existingMenuId === undefined
        ? await createCatalogue(tx, {
            name: data.name[locale],
            names: translated(data.customerName),
          })
        : { id: existingMenuId };
    if (existingMenuId !== undefined)
      await updateMenuDetails(tx, existingMenuId, {
        name: data.name[locale],
        names: translated(data.customerName),
      });
    const rootSectionId = await requireMenuRoot(tx, catalogue.id);
    for (const cat of data.categories) {
      const category = await createCategory(tx, {
        name: cat.categoryName ?? cat.name.en,
        color: cat.color,
      });
      await setRoutingCell(
        tx,
        { locationId: brandLocationId(locationId) },
        { row: { kind: "category", categoryId: category.id }, zoneId: null },
        cat.station === null
          ? { kind: "no_preparation" }
          : { kind: "station", stationId: stationIds[cat.station] },
      );
      const section = await createSectionIn(
        tx,
        rootSectionId,
        { internalName: cat.name[locale], names: translated(cat.name) },
        undefined,
        locale,
      );
      const productIds: string[] = [];
      for (const product of cat.products) {
        const unitId = product.unit
          ? (
              await createUnit(
                tx,
                {
                  name: translated(product.unit.name),
                  precision: product.unit.precision,
                  abbreviation: translated(product.unit.abbreviation),
                },
                locale,
              )
            ).id
          : undefined;
        const created = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: product.staffName ?? product.customerName[locale],
          customerName: translated(product.customerName),
          description:
            product.description === undefined ? undefined : translated(product.description),
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
              customerName: translated(variant.customerName),
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

  const { restaurant, lunch, deli, drinksName, drinksCustomerName } = dataSet.menus;
  const drinksCategories = restaurant.categories.filter((category) => category.station === "bar");
  const drinksId = await seedOne({
    name: drinksName,
    customerName: drinksCustomerName,
    categories: drinksCategories,
  });
  const casaId = await seedOne(
    {
      ...restaurant,
      categories: restaurant.categories.filter((category) => category.station !== "bar"),
    },
    provisionedMenus[0]?.id,
  );
  const diaId = await seedOne(lunch);
  const deliId = await seedOne(deli);

  const drinksRoot = await requireMenuRoot(tx, drinksId);
  for (const menuId of [casaId, diaId])
    await addMember(tx, await requireMenuRoot(tx, menuId), {
      kind: "section",
      sectionId: drinksRoot,
    });
  const beerId = productsByImage.get("cana-cerveza.png");
  if (beerId === undefined) throw new Error("demo-seed: beer product was not created");
  await updateMenuItem(tx, drinksId, menuItemsByProduct.get(beerId)!, { grossPrice: "3.00" });

  const negroniId = productsByImage.get("negroni.png");
  if (negroniId === undefined) throw new Error("demo-seed: Negroni product was not created");
  await addProductToMenu(tx, { menuId: diaId, productId: negroniId, grossPrice: "9.00" });

  await assignCatalogueToLocation(tx, locationId, casaId);
  await addCatalogueToLocation(tx, locationId, diaId);
  await addCatalogueToLocation(tx, locationId, deliId);
  await addCatalogueToLocation(tx, locationId, drinksId);

  return {
    productsByImage,
    menuItemsByProduct,
    menuIds: { restaurant: casaId, lunch: diaId, deli: deliId, drinks: drinksId },
    stationIds,
  };
}
