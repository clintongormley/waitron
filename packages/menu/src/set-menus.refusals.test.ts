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

const differentClass = (productId: string) => ({
  code: "set_menu.vat_class_differs",
  params: { productId, productVatClass: "general", setMenuVatClass: "reduced" },
});
const reading = () => app((tx) => readSetMenu(tx, f.menuId));
const choices = (includeBottle: boolean, surcharge: string | null = null) => [
  { variantId: f.glass, included: true, surcharge },
  { variantId: f.bottle, included: includeBottle, surcharge: null },
];

it("refuses a different eat-in class before adding or replacing any dishes", async () => {
  const member = await app((tx) => addMember(tx, f.root, { kind: "product", productId: f.soup }));
  const before = await reading();
  const source = await app(async (tx) => {
    const menu = await createMenu(tx, { ...terms, name: "Evening menu", setVatClass: "general" });
    await addSetMenuDishes(tx, menu.id, [pick(f.sirloin)]);
    return menu;
  });
  await app(async (tx) => {
    const ref = { kind: "product", productId: f.sirloin } as const;
    for (const write of [
      () => addSetMenuDishes(tx, f.menuId, [pick(f.sirloin)]),
      () => addProducts(tx, f.root, [f.sirloin]),
      () => addMember(tx, f.root, ref),
      () => replaceMember(tx, f.root, member.id, ref),
      () => copySetMenuDishes(tx, f.menuId, source.id),
    ]) {
      await expect(write()).rejects.toMatchObject(differentClass(f.sirloin));
      expect(await readSetMenu(tx, f.menuId)).toEqual(before);
    }
  });
});

it("checks a kept variant's eat-in class, with inheritance from its parent", async () => {
  await expect(app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine)]))).rejects.toMatchObject(
    differentClass(f.bottle),
  );
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle)]));
  const [dish] = (await reading()).dishes;
  expect(dish!.variants.map(({ id, included }) => ({ id, included }))).toEqual([
    { id: f.glass, included: true },
    { id: f.bottle, included: false },
  ]);
  await expect(
    app((tx) => saveSetMenuVariantChoices(tx, f.menuId, dish!.menuItemId, choices(true))),
  ).rejects.toMatchObject(differentClass(f.bottle));
  expect((await reading()).dishes[0]).toEqual(dish);
});

it("uses the eat-in class when the takeaway class differs", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup)]));
  expect((await reading()).dishes).toMatchObject([{ productId: f.soup, vatClass: "reduced" }]);
});

it("allows changing the VAT class before adding dishes", async () => {
  await app((tx) => updateMenuDetails(tx, f.menuId, { setVatClass: "general" }));
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.sirloin)]));
  expect((await reading()).vatClass).toBe("general");
});

it("names the dish that prevents a class change below the VAT class field", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup)]));
  await expect(
    app((tx) => updateMenuDetails(tx, f.menuId, { setVatClass: "general" })),
  ).rejects.toMatchObject({
    code: "set_menu.vat_class_differs",
    params: {
      productId: f.soup,
      productVatClass: "reduced",
      setMenuVatClass: "reduced",
      field: "setVatClass",
      requestedVatClass: "general",
    },
  });
  expect((await reading()).vatClass).toBe("reduced");
});

it("reports a changed product class in its set menu's problems", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup), pick(f.wine, f.bottle)]));
  expect((await reading()).problems).not.toContainEqual(
    expect.objectContaining({
      kind: "dish_vat_class_differs",
    }),
  );
  await app((tx) => updateProduct(tx, f.soup, { vatClass: "general" }));
  expect((await reading()).problems).toContainEqual({
    kind: "dish_vat_class_differs",
    productId: f.soup,
    name: "Soup",
    parentName: null,
    vatClass: "general",
  });
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

it("checks the listed product's class when every kept variant has a matching class of its own", async () => {
  const other = await app(async (tx) => {
    await updateProduct(tx, f.glass, { vatClass: "reduced" });
    await addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle)]);
    await updateProduct(tx, f.wine, { vatClass: "general" });
    return createMenu(tx, { ...terms, name: "Other menu" });
  });
  expect((await reading()).problems).toContainEqual({
    kind: "dish_vat_class_differs",
    productId: f.wine,
    name: "Wine",
    parentName: null,
    vatClass: "general",
  });
  await expect(
    app((tx) => addSetMenuDishes(tx, other.id, [pick(f.wine, f.bottle)])),
  ).rejects.toMatchObject(differentClass(f.wine));
});
