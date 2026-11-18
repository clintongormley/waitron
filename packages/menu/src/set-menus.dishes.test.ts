import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  menus,
  products,
  setMenuDishCourses,
  setMenuLines,
  setMenuVariantExclusions,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useMenuDb } from "../test/fixtures.js";
import { duplicateMenu } from "./menu-copy.js";
import { requireMenuRoot } from "./menu-structure.js";
import { createMenu, updateMenuDetails, updateMenuItem } from "./operations.js";
import { addMember, addProducts, moveMember, removeMember, replaceMember } from "./sections.js";
import {
  addSetMenuDishes,
  copySetMenuDishes,
  readSetMenu,
  saveSetMenuLines,
  saveSetMenuVariantChoices,
} from "./set-menus.js";

import { listMenuVariants, setMenuVariantPrice, setMenuVariants } from "./variants.js";

const suite = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const terms = { kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" } as const;

async function fixture(tx: Transaction) {
  const menu = await createMenu(tx, { ...terms, name: "Daily menu", names: { en: "Lunch" } });
  const root = await requireMenuRoot(tx, menu.id);
  const [starters, mains, desserts, coffee, inactive] = await tx
    .insert(kitchenCourses)
    .values(
      ["Starters", "Mains", "Desserts", "Coffee", "Retired"].map((name, displayOrder) => ({
        name,
        displayOrder,
        active: name !== "Retired",
      })),
    )
    .returning({ id: kitchenCourses.id });
  async function dish(name: string, courseId: string | null, parentId: string | null = null) {
    const [row] = await tx
      .insert(products)
      .values({
        name,
        courseId,
        parentId,
        ...(parentId === null
          ? { unitPrice: 900, vatClass: "reduced", dietaryDeclarations: [] }
          : { unitPrice: 1800, variantOrder: name === "Bottle" ? 1 : 0 }),
      })
      .returning({ id: products.id });
    return row!.id;
  }
  const soup = await dish("Soup", starters!.id);
  const hake = await dish("Hake", mains!.id);
  const salad = await dish("Salad", starters!.id);
  const wine = await dish("Wine", mains!.id);
  const glass = await dish("Glass", null, wine);
  const bottle = await dish("Bottle", desserts!.id, wine);
  const noCourse = await dish("Sandwich", null);
  return {
    menuId: menu.id,
    root,
    starters: starters!.id,
    mains: mains!.id,
    desserts: desserts!.id,
    coffee: coffee!.id,
    inactive: inactive!.id,
    soup,
    hake,
    salad,
    wine,
    glass,
    bottle,
    noCourse,
  };
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await app(fixture);
});
afterEach(() => vi.useRealTimers());

const line = (...courseIds: string[]) => ({ count: 1, courseIds });
const reading = () => app((tx) => readSetMenu(tx, f.menuId));
const pick = (productId: string, ...excludedVariantIds: string[]) => ({
  productId,
  excludedVariantIds,
});
const choosing = (tx: Transaction, item: string, includeBottle: boolean) =>
  saveSetMenuVariantChoices(tx, f.menuId, item, [
    { variantId: f.glass, included: true, surcharge: "1.50" },
    { variantId: f.bottle, included: includeBottle, surcharge: null },
  ]);

it("adds a line for each newly listed course that no line accepts", async () => {
  const added = await app((tx) => addProducts(tx, f.root, [f.soup, f.hake]));
  expect(added).toEqual({
    added: 2,
    addedLines: [
      { id: expect.any(String), ...line(f.starters) },
      { id: expect.any(String), ...line(f.mains) },
    ],
  });
  expect(await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.salad)]))).toEqual([]);
  expect((await reading()).lines).toEqual(added.addedLines);
});

it("adds a dish with only its chosen variants, ignoring their ordinary prices", async () => {
  expect(await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle)]))).toEqual([
    { id: expect.any(String), ...line(f.mains) },
  ]);
  const { dishes } = await reading();
  expect(dishes).toEqual([
    {
      menuItemId: expect.any(String),
      productId: f.wine,
      name: "Wine",
      surcharge: null,
      courseId: f.mains,
      productCourseId: f.mains,
      courseOverrideId: null,
      vatClass: "reduced",
      soldByMeasure: false,
      variants: [
        {
          id: f.glass,
          name: "Glass",
          included: true,
          surcharge: null,
          courseId: f.mains,
          vatClass: "reduced",
        },
        {
          id: f.bottle,
          name: "Bottle",
          included: false,
          surcharge: null,
          courseId: f.desserts,
          vatClass: "reduced",
        },
      ],
    },
  ]);
});

it("refuses another product's variant before adding any of the request's dishes", async () => {
  await expect(
    app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup), pick(f.hake, f.bottle)])),
  ).rejects.toMatchObject({ code: "product.variant_not_found", params: { variantId: f.bottle } });
  expect((await reading()).dishes).toEqual([]);
});

it("clears variant exclusions, overrides and the course when a dish leaves the root", async () => {
  const member = await app((tx) => addMember(tx, f.root, { kind: "product", productId: f.wine }));
  const item = (await reading()).dishes[0]!.menuItemId;
  await app(async (tx) => {
    await choosing(tx, item, false);
    await tx.insert(setMenuDishCourses).values({ menuItemId: item, courseId: f.starters });
    await removeMember(tx, f.root, member.id);
    await addMember(tx, f.root, { kind: "product", productId: f.wine });
  });
  expect(await suite.db.select().from(setMenuVariantExclusions)).toEqual([]);
  expect((await reading()).dishes[0]).toMatchObject({
    menuItemId: item,
    courseOverrideId: null,
    productCourseId: f.mains,
    courseId: f.mains,
    variants: [
      { id: f.glass, included: true, surcharge: null },
      { id: f.bottle, included: true, surcharge: null },
    ],
  });
});

it("reads a dish surcharge, preserving zero and clearing the surcharge with null", async () => {
  await app((tx) => addProducts(tx, f.root, [f.soup]));
  const item = (await reading()).dishes[0]!.menuItemId;
  for (const surcharge of ["5.00", "0.00", null]) {
    await app((tx) => updateMenuItem(tx, f.menuId, item, { grossPrice: surcharge }));
    expect((await reading()).dishes[0]!.surcharge).toBe(surcharge);
  }
});

it("saving variant choices replaces the surcharge and clears a stored exclusion", async () => {
  await app((tx) => addProducts(tx, f.root, [f.wine]));
  const item = (await reading()).dishes[0]!.menuItemId;
  await app((tx) => choosing(tx, item, false));
  expect((await reading()).dishes[0]!.variants).toMatchObject([
    { id: f.glass, included: true, surcharge: "1.50" },
    { id: f.bottle, included: false, surcharge: null },
  ]);
  await app((tx) => choosing(tx, item, true));
  expect(await suite.db.select().from(setMenuVariantExclusions)).toEqual([]);
  await app((tx) =>
    saveSetMenuVariantChoices(tx, f.menuId, item, [
      { variantId: f.glass, included: false, surcharge: null },
      { variantId: f.bottle, included: true, surcharge: "0" },
    ]),
  );
  expect((await reading()).dishes[0]!.variants).toMatchObject([
    { id: f.glass, included: false, surcharge: null },
    { id: f.bottle, included: true, surcharge: "0.00" },
  ]);
});

it("replaces lines in given order, ordering each line's courses by their display order", async () => {
  await app((tx) => addProducts(tx, f.root, [f.hake]));
  const saved = await app((tx) =>
    saveSetMenuLines(tx, f.menuId, [
      { count: 2, courseIds: [f.coffee] },
      line(f.mains, f.starters),
      line(f.desserts),
    ]),
  );
  expect(saved).toEqual([
    { id: expect.any(String), count: 2, courseIds: [f.coffee] },
    { id: expect.any(String), ...line(f.starters, f.mains) },
    { id: expect.any(String), ...line(f.desserts) },
  ]);
  expect((await reading()).lines).toEqual(saved);
});

it.each([
  ["too many lines", () => Array.from({ length: 21 }, () => line(f.starters)), "lines"],
  ["zero count", () => [{ ...line(f.starters), count: 0 }], "count"],
  ["count above 99", () => [{ ...line(f.starters), count: 100 }], "count"],
  ["fractional count", () => [{ ...line(f.starters), count: 1.5 }], "count"],
  ["missing course", () => [line()], "courseIds"],
  ["repeated course", () => [line(f.starters, f.starters)], "courseIds"],
  ["unknown course", () => [line(f.soup)], "courseIds"],
  ["inactive course", () => [line(f.inactive)], "courseIds"],
] as const)("refuses %s without losing existing lines", async (_name, invalid, field) => {
  await app((tx) => addProducts(tx, f.root, [f.soup]));
  await expect(app((tx) => saveSetMenuLines(tx, f.menuId, invalid()))).rejects.toMatchObject({
    code: "set_menu.invalid",
    params: { field },
  });
  expect((await reading()).lines).toEqual([{ id: expect.any(String), ...line(f.starters) }]);
});

it("reads the full menus holding the draft as well as its own names and terms", async () => {
  const full = await app(async (tx) => {
    const full = await createMenu(tx, { name: "Dinner" });
    await addMember(tx, await requireMenuRoot(tx, full.id), { kind: "set_menu", menuId: f.menuId });
    return full;
  });
  expect(await reading()).toMatchObject({
    name: "Daily menu",
    names: { en: "Lunch" },
    price: "14.00",
    vatClass: "reduced",
    heldBy: [{ id: full.id, name: "Dinner" }],
  });
});

it("reports missing dishes, missing lines and a line with no active course", async () => {
  expect((await reading()).problems).toEqual([{ kind: "no_dishes" }, { kind: "no_lines" }]);
  const [retired] = await app((tx) =>
    tx.insert(setMenuLines).values({ menuId: f.menuId, position: 0, count: 1 }).returning(),
  );
  expect((await reading()).problems).toEqual([
    { kind: "no_dishes" },
    { kind: "line_without_course", lineId: retired!.id },
  ]);
});

it("reports an unfillable line, a course no line accepts and a dish with no course", async () => {
  await app((tx) => addProducts(tx, f.root, [f.wine, f.noCourse]));
  const saved = await app((tx) => saveSetMenuLines(tx, f.menuId, [line(f.mains), line(f.coffee)]));
  expect((await reading()).problems).toEqual(
    expect.arrayContaining([
      { kind: "line_unfillable", lineId: saved[1]!.id },
      {
        kind: "dish_not_included",
        productId: f.bottle,
        name: "Bottle",
        parentName: "Wine",
        courseId: f.desserts,
        courseName: "Desserts",
      },
      { kind: "dish_without_course", productId: f.noCourse, name: "Sandwich", parentName: null },
    ]),
  );
  expect((await reading()).problems).toHaveLength(3);
});

it("does not offer a parent in place of variants all left out", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle, f.glass)]));
  expect((await reading()).problems).toEqual([{ kind: "no_dishes" }, { kind: "no_lines" }]);
});

it("copies only missing dishes with their settings, in the source's order", async () => {
  const source = await app(async (tx) => {
    const source = await createMenu(tx, { ...terms, name: "Evening" });
    await addSetMenuDishes(tx, source.id, [pick(f.wine, f.bottle), pick(f.hake), pick(f.soup)]);
    const [wine, , soup] = (await readSetMenu(tx, source.id)).dishes;
    await updateMenuItem(tx, source.id, wine!.menuItemId, { grossPrice: "3.00" });
    await updateMenuItem(tx, source.id, soup!.menuItemId, { grossPrice: "9.00" });
    await saveSetMenuVariantChoices(tx, source.id, wine!.menuItemId, [
      { variantId: f.glass, included: true, surcharge: "2.00" },
      { variantId: f.bottle, included: false, surcharge: null },
    ]);
    await tx
      .insert(setMenuDishCourses)
      .values({ menuItemId: wine!.menuItemId, courseId: f.coffee });
    return source;
  });
  await app((tx) => addProducts(tx, f.root, [f.soup]));
  expect(await app((tx) => copySetMenuDishes(tx, f.menuId, source.id))).toEqual([
    { id: expect.any(String), ...line(f.mains) },
    { id: expect.any(String), ...line(f.coffee) },
  ]);
  expect((await reading()).dishes).toMatchObject([
    { productId: f.soup, surcharge: null },
    {
      productId: f.wine,
      surcharge: "3.00",
      courseId: f.coffee,
      variants: [
        { id: f.glass, included: true, surcharge: "2.00", courseId: f.coffee },
        { id: f.bottle, included: false, surcharge: null, courseId: f.coffee },
      ],
    },
    { productId: f.hake, surcharge: null },
  ]);
});

it("duplicates the set-menu kind, terms, lines and dish choices", async () => {
  await app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.wine, f.bottle)]));
  const before = await reading();
  const copy = await app((tx) => duplicateMenu(tx, f.menuId, "Daily copy"));
  expect(copy).toMatchObject({ kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" });
  const after = await app((tx) => readSetMenu(tx, copy.id));
  expect(after.lines).toEqual([{ id: expect.any(String), ...line(f.mains) }]);
  expect(after.lines[0]!.id).not.toBe(before.lines[0]!.id);
  expect(after.dishes).toMatchObject([
    {
      productId: f.wine,
      variants: [
        { id: f.glass, included: true },
        { id: f.bottle, included: false },
      ],
    },
  ]);
});

it("updates the draft stamp on menu, structure, surcharge, line and variant writes only", async () => {
  const member = await app((tx) => addMember(tx, f.root, { kind: "product", productId: f.soup }));
  await app((tx) => addProducts(tx, f.root, [f.wine]));
  const item = (await reading()).dishes[1]!.menuItemId;
  const stamp = async () =>
    (
      await suite.db
        .select({ updatedAt: menus.updatedAt })
        .from(menus)
        .where(eq(menus.id, f.menuId))
    )[0]!.updatedAt;
  vi.useFakeTimers({ toFake: ["Date"] });
  const writes = [
    () => app((tx) => updateMenuDetails(tx, f.menuId, { names: { en: "New lunch" } })),
    () => app((tx) => moveMember(tx, f.root, member.id, 1)),
    () => app((tx) => updateMenuItem(tx, f.menuId, item, { grossPrice: "5.00" })),
    () => app((tx) => choosing(tx, item, false)),
    () => app((tx) => saveSetMenuLines(tx, f.menuId, [line(f.mains, f.starters)])),
    () =>
      app((tx) => replaceMember(tx, f.root, member.id, { kind: "product", productId: f.salad })),
    () => app((tx) => removeMember(tx, f.root, member.id)),
    () => app((tx) => addSetMenuDishes(tx, f.menuId, [pick(f.soup)])),
  ];
  for (const [index, write] of writes.entries()) {
    const time = new Date(Date.UTC(2030, 0, 1 + index));
    vi.setSystemTime(time);
    await write();
    expect(await stamp()).toEqual(time);
  }
  const before = await stamp();
  vi.setSystemTime(new Date("2030-02-01T00:00:00Z"));
  await reading();
  expect(await stamp()).toEqual(before);
});

it("refuses ordinary Prices operations on a set-menu dish", async () => {
  await app((tx) => addProducts(tx, f.root, [f.wine]));
  const item = (await reading()).dishes[0]!.menuItemId;
  await app((tx) => choosing(tx, item, false));
  const refusal = { code: "set_menu.wrong_place", params: { menuId: f.menuId } };
  await expect(app((tx) => listMenuVariants(tx, item, f.menuId))).rejects.toMatchObject(refusal);
  await expect(app((tx) => setMenuVariants(tx, item, [], f.menuId))).rejects.toMatchObject(refusal);
  await expect(
    app((tx) => setMenuVariantPrice(tx, item, f.bottle, "8", f.menuId)),
  ).rejects.toMatchObject(refusal);
  expect((await reading()).dishes[0]!.variants).toMatchObject([
    { id: f.glass, included: true, surcharge: "1.50" },
    { id: f.bottle, included: false, surcharge: null },
  ]);
});
