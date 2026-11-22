import { and, eq, inArray, sql } from "drizzle-orm";
import { kitchenStations, readVenue, readTaxpayer, type Transaction } from "@waitron/db";
import { setRoutingCell, STARTER_OPEN_PERIOD_NAMES } from "@waitron/venue-service";
import {
  addMember,
  addProductToMenu,
  addProducts,
  assignMenuToVenue,
  createMenu,
  createCategory,
  createProduct,
  createSectionIn,
  createUnit,
  menuItems,
  updateMenuDetails,
  updateMenuItem,
  readVenueVatRates,
  requireMenuRoot,
  setProductVariants,
  writeContentLanguages,
} from "@waitron/menu";
import type { DemoPlainText } from "@waitron/country";
import type { SeedLocale } from "./locale.js";
import { demoPlainText, demoLanguagesFor, type DemoDataSet, type SeedMenu } from "./data-set.js";
import { inLanguages } from "./in-languages.js";
import { storeDemoImage } from "./seed-media.js";

export interface SeedMenusInput {
  locale: SeedLocale;
  dataSet: DemoDataSet;
}

export interface SeedMenusResult {
  /** image basename → product id; every seeded product appears exactly once. */
  productsByImage: Map<string, string>;
  menuItemsByProduct: Map<string, string>;
  menuIds: { restaurant: string; lunch: string; deli: string; drinks: string };
  stationIds: StationIds;
  /** The categories of the products the deli lists from other menus, which the deli makes. */
  deliListed: { stationId: string; categoryIds: string[] };
}

type StationIds = Record<"kitchen" | "bar" | "deli", string> & {
  upstairsBar: string;
};

async function resolveStationIds(
  tx: Transaction,
  dataSet: DemoDataSet,
  locale: SeedLocale,
): Promise<StationIds> {
  const plain = (text: DemoPlainText) => demoPlainText(text, dataSet, locale);
  const names = dataSet.stations;
  const { rows: defaults } = await tx.execute<{ id: string }>(sql`
    select id from kitchen_stations
    where is_default = 1 and active = 1
    limit 1`);
  const kitchen = defaults[0]?.id;
  if (kitchen === undefined) {
    throw new Error("seedMenus: the venue has no default station");
  }
  await tx.execute(sql`
    update kitchen_stations set name = ${plain(names.kitchen)}, colour = 'orange'
    where id = ${kitchen}`);
  // Seed scripts have no management session, so insert directly — through the table definition,
  // because the insert BUILDER generates `kitchen_stations.id` and `created_at`.
  const [bar, upstairsBar, deli] = await tx
    .insert(kitchenStations)
    .values(
      [
        { name: plain(names.downstairsBar), colour: "blue" as const },
        { name: plain(names.upstairsBar), colour: "indigo" as const },
        { name: plain(names.deli), colour: "green" as const },
      ].map(({ name, colour }) => ({
        name,
        colour,
        isDefault: false,
        active: true,
      })),
    )
    .returning({ id: kitchenStations.id });
  if (bar === undefined || upstairsBar === undefined || deli === undefined) {
    throw new Error("seedMenus: failed to create the demo stations");
  }
  return { kitchen, bar: bar.id, upstairsBar: upstairsBar.id, deli: deli.id };
}

/**
 * The data set's restaurant menu becomes the venue's default menu; the others are added beside
 * it.
 */
export async function seedMenus(
  tx: Transaction,
  { locale, dataSet }: SeedMenusInput,
): Promise<SeedMenusResult> {
  const plain = (text: DemoPlainText) => demoPlainText(text, dataSet, locale);
  const stationIds = await resolveStationIds(tx, dataSet, locale);
  const venue = await readVenue(tx);
  const taxpayer = await readTaxpayer(tx);
  const { defaultLanguage, languages, required } = demoLanguagesFor(dataSet, {
    country: taxpayer?.country,
    area: venue.province ?? undefined,
  });
  await writeContentLanguages(tx, { defaultLanguage, languages: [...languages] }, required, null);
  const vatRates = await readVenueVatRates(tx);
  // An area may not offer the data set's rate (the GB stand-in offers only 0%): leave it out, so the
  // product starts at the venue's saved default, else the area's.
  const takeawayVatRateOf = (rate: string | undefined) =>
    rate !== undefined && vatRates.pickable.includes(rate) ? rate : undefined;
  const translated = (text: Readonly<Record<string, string>>) => inLanguages(text, languages);
  const presentation = async (text: Readonly<Record<string, string>>, basename?: string) => {
    const names = translated(text);
    const image =
      basename === undefined
        ? undefined
        : await storeDemoImage(tx, dataSet.mediaDataSet, basename, names);
    return { names, image };
  };
  const productsByImage = new Map<string, string>();
  const menuItemsByProduct = new Map<string, string>();
  const categoryByImage = new Map<string, string>();

  const { rows: provisionedMenus } = await tx.execute<{ id: string }>(sql`
    select d.menu_id as id from floor_zones p
    join menu_periods d on d.department_id = p.department_id
    where p.is_counter_default
      and d.name in (${sql.join(
        STARTER_OPEN_PERIOD_NAMES.map((name) => sql`${name}`),
        sql`, `,
      )})
    limit 1`);

  const seedOne = async (data: SeedMenu, existingMenuId?: string): Promise<string> => {
    const menuPresentation = await presentation(data.customerName, data.image);
    const menu =
      existingMenuId === undefined
        ? await createMenu(tx, {
            name: plain(data.name),
            ...menuPresentation,
          })
        : { id: existingMenuId };
    if (existingMenuId !== undefined)
      await updateMenuDetails(tx, existingMenuId, {
        name: plain(data.name),
        ...menuPresentation,
      });
    const rootSectionId = await requireMenuRoot(tx, menu.id);
    for (const cat of data.categories) {
      const category = await createCategory(tx, {
        name: plain(cat.categoryName ?? cat.name),
        color: cat.color,
      });
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: category.id }, zoneId: null },
        cat.station === null
          ? { kind: "no_preparation" }
          : { kind: "station", stationId: stationIds[cat.station] },
      );
      const section = await createSectionIn(
        tx,
        rootSectionId,
        { internalName: plain(cat.name), ...(await presentation(cat.name, cat.sectionImage)) },
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
                  staffName: plain(product.unit.staffName),
                  staffAbbreviation: plain(product.unit.staffAbbreviation),
                  name: translated(product.unit.name),
                  precision: product.unit.precision,
                  abbreviation: translated(product.unit.abbreviation),
                },
                locale,
              )
            ).id
          : undefined;
        const created = await createProduct(
          tx,
          {
            categoryId: category.id,
            name: plain(product.staffName ?? product.customerName),
            customerName: translated(product.customerName),
            description:
              product.description === undefined ? undefined : translated(product.description),
            kitchenName: product.kitchenName === undefined ? undefined : plain(product.kitchenName),
            dietaryDeclarations:
              product.dietaryDeclarations === undefined
                ? undefined
                : [...product.dietaryDeclarations],
            ...(unitId === undefined ? { pricingUnit: product.pricingUnit } : { unitId }),
            unitPrice: product.unitPrice,
            vatClass: product.vatClass,
            takeawayVatRate: takeawayVatRateOf(product.takeawayVatRate),
          },
          vatRates,
        );
        productIds.push(created.id);
        if (product.variants?.length) {
          await setProductVariants(
            tx,
            created.id,
            product.variants.map((variant) => ({
              name: plain(variant.staffName ?? variant.customerName),
              customerName: translated(variant.customerName),
              kitchenName: variant.kitchenName === undefined ? null : plain(variant.kitchenName),
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
        categoryByImage.set(product.image, category.id);
      }
      await addProducts(tx, section.id, productIds);
      const rows = await tx
        .select({ id: menuItems.id, productId: menuItems.productId })
        .from(menuItems)
        .where(and(eq(menuItems.menuId, menu.id), inArray(menuItems.productId, productIds)));
      if (rows.length !== productIds.length)
        throw new Error(`demo-seed: a product of '${plain(cat.name)}' has no row on its menu`);
      for (const row of rows) menuItemsByProduct.set(row.productId, row.id);
    }
    if (data.listedSection !== undefined) {
      const listed = data.listedSection.productImages.map((image) => {
        const productId = productsByImage.get(image);
        if (productId === undefined)
          throw new Error(
            `demo-seed: listed product '${image}' was not created by an earlier menu`,
          );
        return productId;
      });
      const section = await createSectionIn(
        tx,
        rootSectionId,
        {
          internalName: plain(data.listedSection.name),
          ...(await presentation(data.listedSection.name, data.listedSection.image)),
        },
        undefined,
        locale,
      );
      await addProducts(tx, section.id, listed);
    }
    return menu.id;
  };

  const { restaurant, lunch, deli, drinksName, drinksCustomerName, drinksImage } = dataSet.menus;
  const drinksCategories = restaurant.categories.filter((category) => category.station === "bar");
  const drinksId = await seedOne({
    name: drinksName,
    customerName: drinksCustomerName,
    image: drinksImage,
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
  for (const override of dataSet.menuPriceOverrides) {
    const productId = productsByImage.get(override.productImage);
    if (productId === undefined)
      throw new Error(`demo-seed: override product was not created: ${override.productImage}`);
    if (override.menu === "drinks") {
      await updateMenuItem(tx, drinksId, menuItemsByProduct.get(productId)!, {
        grossPrice: override.grossPrice,
      });
    } else {
      await addProductToMenu(tx, { menuId: diaId, productId, grossPrice: override.grossPrice });
    }
  }

  await assignMenuToVenue(tx, casaId);

  return {
    productsByImage,
    menuItemsByProduct,
    menuIds: { restaurant: casaId, lunch: diaId, deli: deliId, drinks: drinksId },
    stationIds,
    deliListed: {
      stationId: stationIds.deli,
      categoryIds: [
        ...new Set(
          (deli.listedSection?.productImages ?? []).map((image) => categoryByImage.get(image)!),
        ),
      ],
    },
  };
}
