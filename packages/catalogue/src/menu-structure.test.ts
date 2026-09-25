import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import {
  addProductToMenu,
  createCatalogue,
  createProduct,
  deactivateMenuItem,
  listMenuOffers,
  renameCatalogue,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import { listContentTranslationGaps } from "./content-languages.js";
import { createExtraList, setMenuItemExtraLists } from "./extras.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { menuDetails, menuItems } from "./schema/menu.js";
import { menuItemExtraItems, menuItemExtraLists } from "./schema/extras.js";
import { sections } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { readMenuStructure, syncMenuOffers } from "./menu-structure.js";
import {
  addMember,
  createSection,
  deleteSection,
  duplicateSection,
  listSections,
  moveMember,
  removeMember,
} from "./sections.js";
import { setMenuVariants, setProductVariants } from "./variants.js";
import type { MemberRef } from "./section-types.js";

// A menu's structure and the settings rows it keeps in step with it.
const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const product = (productId: string): MemberRef => ({ kind: "product", productId });
const section = (sectionId: string): MemberRef => ({ kind: "section", sectionId });

interface Fixture {
  lunch: string;
  dinner: string;
  lunchRoot: string;
  dinnerRoot: string;
  lemonade: string;
  /** A variant of lemonade. */
  large: string;
  water: string;
  burger: string;
  juice: string;
  drinks: string;
  favourites: string;
}

async function fixture(): Promise<Fixture> {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const lunch = await createCatalogue(tx, { name: "Lunch menu" });
    const dinner = await createCatalogue(tx, { name: "Dinner menu" });
    // Three different names per product, so a read of the wrong one cannot pass by accident.
    const make = async (name: string, unitPrice: string) =>
      (
        await createProduct(tx, {
          catalogueId: lunch.id,
          categoryId: null,
          name: `${name} (staff)`,
          customerName: { en: `${name} (customer)` },
          kitchenName: `${name} (kitchen)`,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        })
      ).id;
    const lemonade = await make("Lemonade", "3.00");
    const [large] = await setProductVariants(
      tx,
      lemonade,
      [
        {
          name: "Large",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "3.50",
          available: true,
        },
      ],
      "en",
    );
    return {
      lunch: lunch.id,
      dinner: dinner.id,
      lunchRoot: (await readMenuStructure(tx, lunch.id)).rootSectionId,
      dinnerRoot: (await readMenuStructure(tx, dinner.id)).rootSectionId,
      lemonade,
      large: large!.id,
      water: await make("Water", "2.00"),
      burger: await make("Burger", "12.00"),
      juice: await make("Juice", "2.75"),
      drinks: (await createSection(tx, { internalName: "Drinks" })).id,
      favourites: (await createSection(tx, { internalName: "Favourites" })).id,
    };
  });
}

/** The member of `sectionId` holding `ref`. */
async function memberHolding(sectionId: string, ref: MemberRef): Promise<string> {
  const { rows } = await fx.db.execute<{ id: string }>(sql`
    select id from section_members where section_id = ${sectionId}
      and ${ref.kind === "product" ? sql`product_id = ${ref.productId}` : sql`child_section_id = ${ref.sectionId}`}`);
  return rows[0]!.id;
}

async function menuItemRow(tx: Transaction, menuId: string, productId: string) {
  const [row] = await tx
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.menuId, menuId), eq(menuItems.productId, productId)));
  return row;
}

/** What a menu says about one product beyond reaching it. */
async function settingsOf(tx: Transaction, menuId: string, productId: string) {
  const row = (await menuItemRow(tx, menuId, productId))!;
  const variantOverrides = await tx
    .select({
      variantId: menuItemVariantOverrides.variantId,
      price: menuItemVariantOverrides.price,
      offered: menuItemVariantOverrides.offered,
    })
    .from(menuItemVariantOverrides)
    .where(eq(menuItemVariantOverrides.menuItemId, row.id));
  const extraLists = await tx
    .select({ listId: menuItemExtraLists.listId })
    .from(menuItemExtraLists)
    .where(eq(menuItemExtraLists.menuItemId, row.id));
  const extraItems = await tx
    .select({ productId: menuItemExtraItems.productId, price: menuItemExtraItems.price })
    .from(menuItemExtraItems)
    .where(eq(menuItemExtraItems.menuItemId, row.id));
  return {
    id: row.id,
    grossPrice: row.grossPrice,
    active: row.active,
    variantOverrides,
    extraLists,
    extraItems,
  };
}

const offerNames = async (menuId: string) =>
  (await app((tx) => listMenuOffers(tx, [menuId]))).map((offer) => offer.name);

describe("creating a menu", () => {
  it("makes a root and a home layout the menu owns, and records both in menu_details", async () => {
    await seedTenant(fx.db);
    const menu = await app((tx) => createCatalogue(tx, { name: "Lunch menu" }));
    const owned = await app((tx) =>
      tx
        .select({ id: sections.id, role: sections.role, internalName: sections.internalName })
        .from(sections)
        .where(eq(sections.ownerMenuId, menu.id)),
    );
    const [details] = await app((tx) =>
      tx.select().from(menuDetails).where(eq(menuDetails.menuId, menu.id)),
    );
    const root = owned.find((row) => row.role === "menu_root")!;
    const layout = owned.find((row) => row.role === "home_layout")!;
    expect(owned).toHaveLength(2);
    expect(root.internalName).toBe("Lunch menu");
    expect(details).toEqual({
      menuId: menu.id,
      rootSectionId: root.id,
      defaultHomeLayoutId: layout.id,
    });
    expect(await app((tx) => readMenuStructure(tx, menu.id))).toEqual({
      rootSectionId: root.id,
      nodes: [],
    });
  });

  it("keeps the root's internal name the menu's name when the menu is renamed", async () => {
    await seedTenant(fx.db);
    const menu = await app((tx) => createCatalogue(tx, { name: "Lunch menu" }));
    await app((tx) => renameCatalogue(tx, menu.id, "Weekday lunch"));
    const { rootSectionId } = await app((tx) => readMenuStructure(tx, menu.id));
    const [root] = await app((tx) =>
      tx
        .select({ internalName: sections.internalName })
        .from(sections)
        .where(eq(sections.id, rootSectionId)),
    );
    expect(root).toEqual({ internalName: "Weekday lunch" });
  });

  it("refuses the structure of a menu that does not exist", async () => {
    await seedTenant(fx.db);
    await expect(app((tx) => readMenuStructure(tx, crypto.randomUUID()))).rejects.toMatchObject({
      code: "catalogue.not_found",
    });
  });
});

describe("a menu's own lists stay out of the library", () => {
  it("never lists the root or the layout, never takes either as a member, and never reports their names", async () => {
    const f = await fixture();
    const [details] = await app((tx) =>
      tx.select().from(menuDetails).where(eq(menuDetails.menuId, f.lunch)),
    );
    const listed = await app((tx) => listSections(tx));
    expect(listed.map((row) => row.internalName)).toEqual(["Drinks", "Favourites"]);
    for (const owned of [details!.rootSectionId, details!.defaultHomeLayoutId])
      await expect(app((tx) => addMember(tx, f.drinks, section(owned)))).rejects.toMatchObject({
        code: "menu_section.not_library",
      });
    // A customer name missing Spanish, on the owned lists and on a library section alike: only the
    // library section is a gap.
    await fx.db.execute(sql`update sections set names = '{"en":"Named"}'`);
    const gaps = await app((tx) => listContentTranslationGaps(tx, "es"));
    expect(
      gaps
        .filter((gap) => gap.kind.includes("section"))
        .map((gap) => gap.id)
        .sort(),
    ).toEqual([f.drinks, f.favourites].sort());
  });
});

describe("a menu offers what its structure reaches", () => {
  it("offers a section's products in order, and a product added to a shared section on every menu using it", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await addMember(tx, f.drinks, product(f.lemonade));
      await addMember(tx, f.drinks, product(f.water));
      await addMember(tx, f.lunchRoot, section(f.drinks));
    });
    const lunchOffers = await app((tx) => listMenuOffers(tx, [f.lunch]));
    expect(lunchOffers.map((offer) => [offer.productId, offer.placements])).toEqual([
      [f.lemonade, [[f.drinks]]],
      [f.water, [[f.drinks]]],
    ]);
    const rows = await app((tx) =>
      tx.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.menuId, f.lunch)),
    );
    expect(rows.map((row) => row.id).sort()).toEqual(lunchOffers.map((offer) => offer.id).sort());

    await app((tx) => addMember(tx, f.dinnerRoot, section(f.drinks)));
    await app((tx) => addMember(tx, f.drinks, product(f.juice)));
    for (const menuId of [f.lunch, f.dinner]) {
      const offers = await app((tx) => listMenuOffers(tx, [menuId]));
      expect(offers.map((offer) => offer.productId)).toEqual([f.lemonade, f.water, f.juice]);
      expect(offers[2]).toMatchObject({ grossPrice: null, unitPrice: "2.75" });
    }
  });

  it("writes every menu's rows inside the transaction that changed a shared section", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await addMember(tx, f.lunchRoot, section(f.drinks));
      await addMember(tx, f.dinnerRoot, section(f.drinks));
    });
    await app(async (tx) => {
      await addMember(tx, f.drinks, product(f.juice));
      // Read before the commit, in the writing transaction.
      expect(await menuItemRow(tx, f.lunch, f.juice)).toBeDefined();
      expect(await menuItemRow(tx, f.dinner, f.juice)).toBeDefined();
    });
  });

  it("reorders one menu's top level without moving another menu's", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await addMember(tx, f.drinks, product(f.lemonade));
      for (const root of [f.lunchRoot, f.dinnerRoot]) {
        await addMember(tx, root, section(f.drinks));
        await addMember(tx, root, product(f.burger));
      }
    });
    const burgerOnLunch = await memberHolding(f.lunchRoot, product(f.burger));
    await app((tx) => moveMember(tx, f.lunchRoot, burgerOnLunch, 0));
    expect(await offerNames(f.lunch)).toEqual(["Burger (staff)", "Lemonade (staff)"]);
    expect(await offerNames(f.dinner)).toEqual(["Lemonade (staff)", "Burger (staff)"]);
  });

  it("names every path a product is placed on, with [] for the top level", async () => {
    const f = await fixture();
    const beer = await app((tx) => createSection(tx, { internalName: "Beer" }));
    await app(async (tx) => {
      await addMember(tx, beer.id, product(f.lemonade));
      await addMember(tx, f.drinks, section(beer.id));
      await addMember(tx, f.favourites, product(f.lemonade));
      await addMember(tx, f.lunchRoot, section(f.favourites));
      await addMember(tx, f.lunchRoot, section(f.drinks));
      await addMember(tx, f.lunchRoot, product(f.lemonade));
    });
    const [offer] = await app((tx) => listMenuOffers(tx, [f.lunch]));
    expect(offer!.placements).toEqual([[f.favourites], [f.drinks, beer.id], []]);
    const structure = await app((tx) => readMenuStructure(tx, f.lunch));
    expect(structure).toEqual({
      rootSectionId: f.lunchRoot,
      nodes: [
        {
          memberId: expect.any(String),
          ref: section(f.favourites),
          children: [{ memberId: expect.any(String), ref: product(f.lemonade) }],
        },
        {
          memberId: expect.any(String),
          ref: section(f.drinks),
          children: [
            {
              memberId: expect.any(String),
              ref: section(beer.id),
              children: [{ memberId: expect.any(String), ref: product(f.lemonade) }],
            },
          ],
        },
        {
          memberId: await memberHolding(f.lunchRoot, product(f.lemonade)),
          ref: product(f.lemonade),
        },
      ],
    });
  });

  it("orders several menus by name, each in its own structure's order", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await addMember(tx, f.lunchRoot, product(f.water));
      await addMember(tx, f.lunchRoot, product(f.burger));
      await addMember(tx, f.dinnerRoot, product(f.burger));
      await addMember(tx, f.dinnerRoot, product(f.water));
    });
    const offers = await app((tx) => listMenuOffers(tx, [f.lunch, f.dinner]));
    expect(offers.map((offer) => [offer.menuName, offer.name])).toEqual([
      ["Dinner menu", "Burger (staff)"],
      ["Dinner menu", "Water (staff)"],
      ["Lunch menu", "Water (staff)"],
      ["Lunch menu", "Burger (staff)"],
    ]);
  });
});

describe("a product that leaves a menu starts fresh there", () => {
  /**
   * Review Focus 4: Lemonade under Favourites and Drinks on Lunch, with a Lunch price, a Lunch
   * price for its Large variant and a Lunch extras publication. Dinner holds Lemonade at its top
   * level with a price of its own, which nothing below may touch.
   */
  async function lemonadeOnLunch() {
    const f = await fixture();
    const settings = await app(async (tx) => {
      await addMember(tx, f.favourites, product(f.lemonade));
      await addMember(tx, f.drinks, product(f.lemonade));
      await addMember(tx, f.drinks, product(f.water));
      await addMember(tx, f.lunchRoot, section(f.favourites));
      await addMember(tx, f.lunchRoot, section(f.drinks));
      await addMember(tx, f.dinnerRoot, product(f.lemonade));
      const lunchItem = (await menuItemRow(tx, f.lunch, f.lemonade))!;
      const dinnerItem = (await menuItemRow(tx, f.dinner, f.lemonade))!;
      await updateMenuItem(tx, f.lunch, lunchItem.id, { grossPrice: "2.50" });
      await updateMenuItem(tx, f.dinner, dinnerItem.id, { grossPrice: "3.25" });
      await setMenuVariants(tx, lunchItem.id, [
        { variantId: f.large, price: "3.00", offered: true },
      ]);
      const ice = await createExtraList(tx, { name: "Ice", items: [{ productId: f.water }] }, "en");
      await writeProductModifiers(tx, f.lemonade, [{ kind: "extras", id: ice.id }]);
      await setMenuItemExtraLists(tx, lunchItem.id, [
        { listId: ice.id, items: [{ productId: f.water, price: "0.20", available: true }] },
      ]);
      return {
        lunch: await settingsOf(tx, f.lunch, f.lemonade),
        dinner: await settingsOf(tx, f.dinner, f.lemonade),
      };
    });
    expect(settings.lunch).toMatchObject({
      grossPrice: 250,
      active: true,
      variantOverrides: [{ variantId: f.large, price: 300, offered: true }],
      extraLists: [{ listId: expect.any(String) }],
      extraItems: [{ productId: f.water, price: 20 }],
    });
    return { f, settings };
  }

  const removeFromFavourites = async (f: Fixture) => {
    const held = await memberHolding(f.favourites, product(f.lemonade));
    await app((tx) => removeMember(tx, f.favourites, held));
  };

  /** Everything Lunch said is gone, on the SAME row; Dinner's own price is untouched; and adding
   * Lemonade back offers the product's own prices. */
  async function expectFresh(
    f: Fixture,
    before: Awaited<ReturnType<typeof lemonadeOnLunch>>["settings"],
  ) {
    const after = await app(async (tx) => ({
      lunch: await settingsOf(tx, f.lunch, f.lemonade),
      dinner: await settingsOf(tx, f.dinner, f.lemonade),
    }));
    expect(after.lunch).toEqual({
      id: before.lunch.id,
      grossPrice: null,
      active: true,
      variantOverrides: [],
      extraLists: [],
      extraItems: [],
    });
    expect(after.dinner).toEqual(before.dinner);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.lemonade)));
    const offer = (await app((tx) => listMenuOffers(tx, [f.lunch]))).find(
      (candidate) => candidate.productId === f.lemonade,
    )!;
    expect(offer).toMatchObject({ id: before.lunch.id, grossPrice: null, unitPrice: "3.00" });
    expect(offer.variants).toEqual([
      expect.objectContaining({ id: f.large, menuPrice: null, unitPrice: "3.50" }),
    ]);
    // An offer publishes an extras list only through its own `menu_item_extra_lists` row, and a
    // fresh one has none.
    expect(offer.offeredModifiers).toEqual([]);
  }

  it("keeps everything while another path still reaches the product", async () => {
    const { f, settings } = await lemonadeOnLunch();
    await removeFromFavourites(f);
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toEqual(settings.lunch);
    const [offer] = await app((tx) => listMenuOffers(tx, [f.lunch]));
    expect(offer).toMatchObject({ productId: f.lemonade, unitPrice: "2.50" });
  });

  it("resets when it is removed from the last list holding it", async () => {
    const { f, settings } = await lemonadeOnLunch();
    await removeFromFavourites(f);
    const held = await memberHolding(f.drinks, product(f.lemonade));
    await app((tx) => removeMember(tx, f.drinks, held));
    await expectFresh(f, settings);
  });

  it("resets when the last section reaching it is removed from the menu", async () => {
    const { f, settings } = await lemonadeOnLunch();
    await removeFromFavourites(f);
    const held = await memberHolding(f.lunchRoot, section(f.drinks));
    await app((tx) => removeMember(tx, f.lunchRoot, held));
    await expectFresh(f, settings);
  });

  it("resets when the last section reaching it is deleted", async () => {
    const { f, settings } = await lemonadeOnLunch();
    await removeFromFavourites(f);
    await app((tx) => deleteSection(tx, f.drinks));
    await expectFresh(f, settings);
  });

  it("resets when the other section is deleted after it left this one", async () => {
    const { f, settings } = await lemonadeOnLunch();
    const held = await memberHolding(f.drinks, product(f.lemonade));
    await app((tx) => removeMember(tx, f.drinks, held));
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toEqual(settings.lunch);
    await app((tx) => deleteSection(tx, f.favourites));
    await expectFresh(f, settings);
  });

  it("resets when a nested section was the last path to it", async () => {
    const { f, settings } = await lemonadeOnLunch();
    await removeFromFavourites(f);
    const soft = await app((tx) => createSection(tx, { internalName: "Soft drinks" }));
    await app(async (tx) => {
      await addMember(tx, soft.id, product(f.lemonade));
      await addMember(tx, f.drinks, section(soft.id));
      await removeMember(tx, f.drinks, await memberHolding(f.drinks, product(f.lemonade)));
    });
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toEqual(settings.lunch);
    const nested = await memberHolding(f.drinks, section(soft.id));
    await app((tx) => removeMember(tx, f.drinks, nested));
    await expectFresh(f, settings);
  });

  it("keeps a removed product's settings while it is only made inactive", async () => {
    const { f, settings } = await lemonadeOnLunch();
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    expect(await offerNames(f.lunch)).toEqual(["Water (staff)"]);
    await app((tx) => syncMenuOffers(tx, [f.lunch, f.dinner]));
    await app((tx) => updateProduct(tx, f.lemonade, { active: true }));
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toEqual(settings.lunch);
  });

  it("keeps the overrides when a section is duplicated and the copy takes its place in one step", async () => {
    const f = await fixture();
    const before = await app(async (tx) => {
      await addMember(tx, f.drinks, product(f.lemonade));
      await addMember(tx, f.lunchRoot, product(f.burger));
      await addMember(tx, f.lunchRoot, section(f.drinks));
      const item = (await menuItemRow(tx, f.lunch, f.lemonade))!;
      await updateMenuItem(tx, f.lunch, item.id, { grossPrice: "2.50" });
      await setMenuVariants(tx, item.id, [{ variantId: f.large, price: "3.00", offered: true }]);
      return settingsOf(tx, f.lunch, f.lemonade);
    });
    const drinksMember = await memberHolding(f.lunchRoot, section(f.drinks));
    const lemonadeMember = await memberHolding(f.drinks, product(f.lemonade));
    const copy = await app((tx) =>
      duplicateSection(tx, f.drinks, {
        internalName: "Lunch drinks",
        memberIds: [lemonadeMember],
        replaceIn: { sectionId: f.lunchRoot, memberId: drinksMember },
      }),
    );
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toEqual(before);
    const structure = await app((tx) => readMenuStructure(tx, f.lunch));
    expect(structure.nodes.map((node) => node.ref)).toEqual([product(f.burger), section(copy.id)]);
    const [, offer] = await app((tx) => listMenuOffers(tx, [f.lunch]));
    expect(offer).toMatchObject({ productId: f.lemonade, placements: [[copy.id]] });
  });

  it("resets the overrides when the same swap is made as a removal and an add in two transactions", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await addMember(tx, f.drinks, product(f.lemonade));
      await addMember(tx, f.lunchRoot, section(f.drinks));
      const item = (await menuItemRow(tx, f.lunch, f.lemonade))!;
      await updateMenuItem(tx, f.lunch, item.id, { grossPrice: "2.50" });
      await setMenuVariants(tx, item.id, [{ variantId: f.large, price: "3.00", offered: true }]);
    });
    const lemonadeMember = await memberHolding(f.drinks, product(f.lemonade));
    const copy = await app((tx) =>
      duplicateSection(tx, f.drinks, { internalName: "Lunch drinks", memberIds: [lemonadeMember] }),
    );
    const drinksMember = await memberHolding(f.lunchRoot, section(f.drinks));
    await app((tx) => removeMember(tx, f.lunchRoot, drinksMember));
    await app((tx) => addMember(tx, f.lunchRoot, section(copy.id)));
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toMatchObject({
      grossPrice: null,
      variantOverrides: [],
    });
  });
});

describe("a menu's own switch for a product", () => {
  it("hides a product the menu reaches on that menu alone, and turns it back on", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await addMember(tx, f.drinks, product(f.lemonade));
      await addMember(tx, f.drinks, product(f.water));
      await addMember(tx, f.lunchRoot, section(f.drinks));
      await addMember(tx, f.dinnerRoot, section(f.drinks));
    });
    const item = (await app((tx) => menuItemRow(tx, f.lunch, f.lemonade)))!;
    await app((tx) => deactivateMenuItem(tx, f.lunch, item.id));
    expect(await offerNames(f.lunch)).toEqual(["Water (staff)"]);
    expect(await offerNames(f.dinner)).toEqual(["Lemonade (staff)", "Water (staff)"]);
    // A structure change that keeps it reachable leaves the switch where it was.
    await app((tx) => addMember(tx, f.drinks, product(f.juice)));
    expect(await offerNames(f.lunch)).toEqual(["Water (staff)", "Juice (staff)"]);
    await app((tx) => updateMenuItem(tx, f.lunch, item.id, { active: true }));
    expect(await offerNames(f.lunch)).toEqual([
      "Lemonade (staff)",
      "Water (staff)",
      "Juice (staff)",
    ]);
  });

  it("refuses a setting for a product the menu no longer reaches", async () => {
    const f = await fixture();
    await app((tx) => addMember(tx, f.lunchRoot, product(f.lemonade)));
    const item = (await app((tx) => menuItemRow(tx, f.lunch, f.lemonade)))!;
    const held = await memberHolding(f.lunchRoot, product(f.lemonade));
    await app((tx) => removeMember(tx, f.lunchRoot, held));
    for (const write of [
      (tx: Transaction): Promise<unknown> =>
        updateMenuItem(tx, f.lunch, item.id, { grossPrice: "1.00" }),
      (tx: Transaction) => deactivateMenuItem(tx, f.lunch, item.id),
      (tx: Transaction) => updateMenuItem(tx, f.dinner, item.id, { grossPrice: "1.00" }),
    ])
      await expect(app(write)).rejects.toMatchObject({ code: "menu_item.not_found" });
    expect(await app((tx) => settingsOf(tx, f.lunch, f.lemonade))).toMatchObject({
      grossPrice: null,
      active: true,
      variantOverrides: [],
    });
  });
});

describe("putting a product on a menu's top level", () => {
  it("adds it to the root with an optional menu price, and refuses what cannot be offered", async () => {
    const f = await fixture();
    const item = await app((tx) =>
      addProductToMenu(tx, { menuId: f.lunch, productId: f.lemonade, grossPrice: "2.50" }),
    );
    expect(item).toEqual({
      id: item.id,
      menuId: f.lunch,
      productId: f.lemonade,
      grossPrice: "2.50",
      active: true,
    });
    const blank = await app((tx) => addProductToMenu(tx, { menuId: f.lunch, productId: f.water }));
    expect(blank.grossPrice).toBeNull();
    expect(
      (await app((tx) => readMenuStructure(tx, f.lunch))).nodes.map((node) => node.ref),
    ).toEqual([product(f.lemonade), product(f.water)]);
    for (const [input, code] of [
      [{ menuId: crypto.randomUUID(), productId: f.lemonade }, "catalogue.not_found"],
      [{ menuId: f.lunch, productId: crypto.randomUUID() }, "product.not_found"],
      [{ menuId: f.lunch, productId: f.large }, "menu_item.variant_not_allowed"],
      [{ menuId: f.lunch, productId: f.lemonade }, "menu_section.member_duplicate"],
    ] as const)
      await expect(app((tx) => addProductToMenu(tx, input))).rejects.toMatchObject({ code });
  });
});

describe("syncing menus that have no structure", () => {
  it("does nothing for no menus, or a menu with no details row", async () => {
    await seedTenant(fx.db);
    await app((tx) => syncMenuOffers(tx, []));
    await app((tx) => syncMenuOffers(tx, [crypto.randomUUID()]));
    expect(await app((tx) => tx.select().from(menuItems))).toEqual([]);
  });
});
