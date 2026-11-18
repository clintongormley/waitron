import { beforeEach, expect, it } from "vitest";
import { useMenuDb } from "../test/fixtures.js";
import { withTransaction, type Transaction } from "@waitron/db";
import { requireMenuRoot } from "./menu-structure.js";
import {
  createMenu,
  createProduct,
  listMenuOffers,
  updateMenuDetails,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import { addMember, addProducts, replaceMember } from "./sections.js";
import {
  addSetMenuDishes,
  copySetMenuDishes,
  readSetMenu,
  saveSetMenuVariantChoices,
} from "./set-menus.js";
import { createUnit } from "./units.js";
import { setProductVariants } from "./variants.js";

const suite = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const terms = { kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" } as const;
const pick = (productId: string, ...excludedVariantIds: string[]) => ({
  productId,
  excludedVariantIds,
});

async function fixture(tx: Transaction) {
  const daily = await createMenu(tx, { ...terms, name: "Daily menu" });
  const root = await requireMenuRoot(tx, daily.id);
  const soup = await createProduct(tx, {
    name: "Soup",
    categoryId: null,
    unitId: null,
    unitPrice: "6.00",
    vatClass: "reduced",
    takeawayVatClass: "general",
  });
  const sirloin = await createProduct(tx, {
    name: "Sirloin",
    categoryId: null,
    unitId: null,
    unitPrice: "20.00",
    vatClass: "general",
  });
  const wine = await createProduct(tx, {
    name: "Wine",
    categoryId: null,
    unitId: null,
    unitPrice: "8.00",
    vatClass: "reduced",
  });
  const variantDetails = { customerName: null, kitchenName: null, image: null, available: true };
  const [glass, bottle] = await setProductVariants(
    tx,
    wine.id,
    [
      { ...variantDetails, name: "Glass", unitPrice: null },
      { ...variantDetails, name: "Bottle", unitPrice: "20.00" },
    ],
    "en",
  );
  await updateProduct(tx, bottle!.id, { vatClass: "general" });
  return {
    menuId: daily.id,
    root,
    soup: soup.id,
    sirloin: sirloin.id,
    wine: wine.id,
    glass: glass!.id,
    bottle: bottle!.id,
  };
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await app(fixture);
});

const reading = () => app((tx) => readSetMenu(tx, f.menuId));
const choices = (includeBottle: boolean, surcharge: string | null = null) => [
  { variantId: f.glass, included: true, surcharge },
  { variantId: f.bottle, included: includeBottle, surcharge: null },
];

it.each(["add", "add products", "add member", "replace", "copy"] as const)(
  "can %s a dish whose VAT rate differs from the set menu's",
  async (operation) => {
    const ref = { kind: "product", productId: f.sirloin } as const;
    const member = await app((tx) => addMember(tx, f.root, { kind: "product", productId: f.soup }));
    const source = await app(async (tx) => {
      const menu = await createMenu(tx, { ...terms, name: "Evening menu", setVatClass: "general" });
      await addSetMenuDishes(tx, menu.id, [pick(f.sirloin)]);
      return menu;
    });
    await app(async (tx) => {
      const writes = {
        add: () => addSetMenuDishes(tx, f.menuId, [pick(f.sirloin)]),
        "add products": () => addProducts(tx, f.root, [f.sirloin]),
        "add member": () => addMember(tx, f.root, ref),
        replace: () => replaceMember(tx, f.root, member.id, ref),
        copy: () => copySetMenuDishes(tx, f.menuId, source.id),
      };
      await writes[operation]();
    });
    expect((await reading()).dishes.map(({ productId }) => productId)).toEqual(
      operation === "replace" ? [f.sirloin] : [f.soup, f.sirloin],
    );
  },
);

it("can keep a variant whose rate differs from the set menu's", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle)]));
  const [dish] = (await reading()).dishes;
  expect(dish!.variants.map(({ id, included }) => ({ id, included }))).toEqual([
    { id: f.glass, included: true },
    { id: f.bottle, included: false },
  ]);
  await app((tx) => saveSetMenuVariantChoices(tx, f.menuId, dish!.menuItemId, choices(true)));
  expect(
    (await reading()).dishes[0]!.variants.map(({ id, included }) => ({ id, included })),
  ).toEqual([
    { id: f.glass, included: true },
    { id: f.bottle, included: true },
  ]);
});

it("can change the menu rate when an existing dish has a different rate", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup)]));
  await app((tx) => updateMenuDetails(tx, f.menuId, { setVatClass: "general" }));
  expect(await reading()).toMatchObject({ vatClass: "general", dishes: [{ productId: f.soup }] });
});

it("keeps the same draft problems after a dish's VAT rate changes", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup), pick(f.wine, f.bottle)]));
  const { problems } = await reading();
  await app((tx) => updateProduct(tx, f.soup, { vatClass: "general" }));
  expect((await reading()).problems).toEqual(problems);
});

it("refuses measured dishes and reports a dish switched to a measured unit later", async () => {
  const turbot = await app(async (tx) => {
    const unit = await createUnit(
      tx,
      {
        staffName: "Kilogram",
        staffAbbreviation: "kg",
        name: { en: "Kilogram" },
        abbreviation: { en: "kg" },
        precision: 3,
        measure: true,
      },
      "en",
    );
    const fish = await createProduct(tx, {
      name: "Turbot",
      categoryId: null,
      unitPrice: "25.00",
      vatClass: "reduced",
      unitId: unit.id,
    });
    await addSetMenuDishes(tx, f.menuId, [pick(f.soup)]);
    await updateProduct(tx, f.soup, { unitId: unit.id });
    return fish;
  });
  await expect(
    app((tx) => addSetMenuDishes(tx, f.menuId, [pick(turbot.id)])),
  ).rejects.toMatchObject({
    code: "set_menu.dish_sold_by_measure",
    params: { productId: turbot.id },
  });
  expect((await reading()).problems).toContainEqual({
    kind: "dish_sold_by_measure",
    productId: f.soup,
    name: "Soup",
  });
});

const surchargeRefusal = { code: "set_menu.invalid", params: { field: "surcharge" } };

it("caps a dish surcharge at 10,000.00 while an ordinary menu accepts more", async () => {
  const ordinary = await app(async (tx) => {
    const menu = await createMenu(tx, { name: "Ordinary menu" });
    const root = await requireMenuRoot(tx, menu.id);
    await addProducts(tx, root, [f.soup]);
    return menu;
  });
  const [offer] = await app((tx) => listMenuOffers(tx, [ordinary.id]));
  await app((tx) => updateMenuItem(tx, ordinary.id, offer!.id, { grossPrice: "10000.01" }));
  expect((await app((tx) => listMenuOffers(tx, [ordinary.id])))[0]!.unitPrice).toBe("10000.01");

  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup)]));
  const [dish] = (await reading()).dishes;
  await app((tx) => updateMenuItem(tx, f.menuId, dish!.menuItemId, { grossPrice: "10000.00" }));
  await expect(
    app((tx) => updateMenuItem(tx, f.menuId, dish!.menuItemId, { grossPrice: "10000.01" })),
  ).rejects.toMatchObject(surchargeRefusal);
  expect((await reading()).dishes[0]!.surcharge).toBe("10000.00");
});

it("caps a kept variant surcharge at 10,000.00", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle)]));
  const [dish] = (await reading()).dishes;
  await app((tx) =>
    saveSetMenuVariantChoices(tx, f.menuId, dish!.menuItemId, choices(false, "10000.00")),
  );
  await expect(
    app((tx) =>
      saveSetMenuVariantChoices(tx, f.menuId, dish!.menuItemId, choices(false, "10000.01")),
    ),
  ).rejects.toMatchObject(surchargeRefusal);
  expect((await reading()).dishes[0]!.variants[0]!.surcharge).toBe("10000.00");
});

it("keeps an existing member when replacing it with the same product after its class changed", async () => {
  const ref = { kind: "product", productId: f.soup } as const;
  const member = await app((tx) => addMember(tx, f.root, ref));
  await app((tx) => updateProduct(tx, f.soup, { vatClass: "general" }));
  const before = await reading();
  expect(await app((tx) => replaceMember(tx, f.root, member.id, ref))).toEqual(member);
  expect(await reading()).toEqual(before);
});
