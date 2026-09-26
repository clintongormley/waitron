import { and, eq } from "drizzle-orm";
import { kitchenCourses, withTransaction, type Database, type Transaction } from "@waitron/db";
import { seedLegacySellingUnits, seedVenue } from "./fixtures.js";
import { createCatalogue, createProduct, updateMenuItem } from "../src/operations.js";
import { createCategory } from "../src/categories.js";
import { createExtraList, setMenuItemExtraLists } from "../src/extras.js";
import { createOptionList } from "../src/options.js";
import { writeProductModifiers } from "../src/product-modifiers.js";
import { readMenuStructure } from "../src/menu-structure.js";
import { addMember, createSection } from "../src/sections.js";
import { setProductVariants } from "../src/variants.js";
import { menuItems } from "../src/schema/menu.js";
import type { MemberRef } from "../src/section-types.js";

export const NO_ICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const WITH_ICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export interface MenusFixture {
  locationId: string;
  lunch: string;
  dinner: string;
  lunchRoot: string;
  dinnerRoot: string;
  drinks: string;
  beer: string;
  mains: string;
  lemonade: string;
  /** Lemonade's one variant. */
  large: string;
  lager: string;
  burger: string;
  soup: string;
  /** The one item of the extras list Lemonade carries. */
  extraLemon: string;
  extrasList: string;
  iceList: string;
  softDrinks: string;
  coldDrinks: string;
  course: string;
}

export const product = (productId: string): MemberRef => ({ kind: "product", productId });
export const section = (sectionId: string): MemberRef => ({ kind: "section", sectionId });

/**
 * Review Focus 3's venue. Lunch: Drinks, Soup. Dinner: Drinks, Mains. Drinks holds Lemonade and
 * Beer; Beer holds Lager; Mains, which Dinner alone uses, holds Burger. Lunch sets its own price for
 * Lemonade. Lemonade carries an extras list offering Extra lemon, and an options list.
 *
 * Every product's staff, customer and kitchen names are three different texts, and every section's
 * internal and customer names differ, so a read of the wrong one fails.
 */
export async function menusFixture(db: Database): Promise<MenusFixture> {
  const { locationId } = await seedVenue(db);
  await seedLegacySellingUnits(db);
  return withTransaction(db, async (tx) => {
    const softDrinks = (await createCategory(tx, { name: { en: "Soft drinks" } })).id;
    const coldDrinks = (await createCategory(tx, { name: { en: "Cold drinks" } })).id;
    const lunch = await createCatalogue(tx, { name: "Lunch Menu" });
    const dinner = await createCatalogue(tx, { name: "Dinner Menu" });
    const make = async (name: string, unitPrice: string, image: string | null = null) =>
      (
        await createProduct(tx, {
          catalogueId: lunch.id,
          categoryId: softDrinks,
          name,
          customerName: { en: `${name} for guests` },
          kitchenName: name.toUpperCase(),
          description: { en: `All about ${name}` },
          pricingUnit: "each",
          unitPrice,
          vatClass: "reduced",
          allergens: {},
          ...(image === null ? {} : { image }),
        })
      ).id;
    const lemonade = await make("Lemonade", "3.00", "lemonade.jpg");
    const [large] = await setProductVariants(
      tx,
      lemonade,
      [
        {
          name: "Large",
          customerName: { en: "A big glass" },
          kitchenName: "LRG",
          image: "large.jpg",
          unitPrice: "3.50",
          available: true,
        },
      ],
      "en",
    );
    const lager = await make("Lager", "4.00");
    const burger = await make("Burger", "12.00");
    const soup = await make("Soup", "5.00");
    const extraLemon = await make("Extra lemon", "0.50");

    const drinks = (
      await createSection(tx, { internalName: "Drinks", names: { en: "Something to drink" } })
    ).id;
    const beer = (await createSection(tx, { internalName: "Beer", names: { en: "On tap" } })).id;
    const mains = (
      await createSection(tx, { internalName: "Mains", names: { en: "Main courses" } })
    ).id;
    const lunchRoot = (await readMenuStructure(tx, lunch.id)).rootSectionId;
    const dinnerRoot = (await readMenuStructure(tx, dinner.id)).rootSectionId;
    await addMember(tx, drinks, product(lemonade));
    await addMember(tx, drinks, section(beer));
    await addMember(tx, beer, product(lager));
    await addMember(tx, mains, product(burger));
    await addMember(tx, lunchRoot, section(drinks));
    await addMember(tx, lunchRoot, product(soup));
    await addMember(tx, dinnerRoot, section(drinks));
    await addMember(tx, dinnerRoot, section(mains));

    const extrasList = (
      await createExtraList(
        tx,
        {
          name: "Extras",
          customerName: { en: "Add something" },
          kitchenName: "EXTRAS",
          minPicks: 0,
          maxPicks: 2,
          items: [{ productId: extraLemon, price: "0.40" }],
        },
        "en",
      )
    ).id;
    const iceList = (
      await createOptionList(
        tx,
        {
          name: "Ice",
          customerName: { en: "Ice?" },
          kitchenName: "ICE",
          defaultLabelId: NO_ICE,
          labels: [
            {
              id: NO_ICE,
              name: "No ice",
              customerName: { en: "Neat" },
              kitchenName: "NO",
              available: true,
            },
            {
              id: WITH_ICE,
              name: "With ice",
              customerName: { en: "Chilled" },
              kitchenName: "YES",
              available: true,
            },
          ],
        },
        "en",
      )
    ).id;
    await writeProductModifiers(tx, lemonade, [
      { kind: "extras", id: extrasList },
      { kind: "options", id: iceList },
    ]);
    for (const menuId of [lunch.id, dinner.id])
      await setMenuItemExtraLists(tx, await offerOf(tx, menuId, lemonade), [
        { listId: extrasList, items: [] },
      ]);
    await updateMenuItem(tx, lunch.id, await offerOf(tx, lunch.id, lemonade), {
      grossPrice: "2.80",
    });
    const [course] = await tx
      .insert(kitchenCourses)
      .values({ locationId, name: "Starters" })
      .returning({ id: kitchenCourses.id });
    return {
      locationId,
      lunch: lunch.id,
      dinner: dinner.id,
      lunchRoot,
      dinnerRoot,
      drinks,
      beer,
      mains,
      lemonade,
      large: large!.id,
      lager,
      burger,
      soup,
      extraLemon,
      extrasList,
      iceList,
      softDrinks,
      coldDrinks,
      course: course!.id,
    };
  });
}

/** The menu's `menu_items` row for the product. */
export async function offerOf(tx: Transaction, menuId: string, productId: string): Promise<string> {
  const [row] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.menuId, menuId), eq(menuItems.productId, productId)));
  return row!.id;
}
