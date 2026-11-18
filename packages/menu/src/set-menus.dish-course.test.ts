import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { kitchenCourses, menus, products, withTransaction, type Transaction } from "@waitron/db";
import { useMenuDb } from "../test/fixtures.js";
import { duplicateMenu } from "./menu-copy.js";
import { requireMenuRoot } from "./menu-structure.js";
import { createMenu, listMenuOffers } from "./operations.js";
import { addProducts } from "./sections.js";
import {
  copySetMenuDishes,
  readSetMenu,
  saveSetMenuDishCourse,
  saveSetMenuLines,
} from "./set-menus.js";

const suite = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const terms = { kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" } as const;

async function fixture(tx: Transaction) {
  const menu = await createMenu(tx, { ...terms, name: "Daily menu" });
  const root = await requireMenuRoot(tx, menu.id);
  const [starters, sharing, desserts, retired] = await tx
    .insert(kitchenCourses)
    .values(
      ["Starters", "Sharing plates", "Desserts", "Retired"].map((name, displayOrder) => ({
        name,
        displayOrder,
        active: name !== "Retired",
      })),
    )
    .returning({ id: kitchenCourses.id });
  const soup = await dish(tx, "Soup", starters!.id);
  const bravas = await dish(tx, "Bravas", sharing!.id);
  const small = await dish(tx, "Small", null, bravas);
  const large = await dish(tx, "Large", sharing!.id, bravas);
  return {
    menuId: menu.id,
    root,
    soup,
    bravas,
    small,
    large,
    starters: starters!.id,
    sharing: sharing!.id,
    desserts: desserts!.id,
    retired: retired!.id,
  };
}

async function dish(
  tx: Transaction,
  name: string,
  courseId: string | null,
  parentId: string | null = null,
) {
  const [product] = await tx
    .insert(products)
    .values({
      name,
      courseId,
      parentId,
      ...(parentId === null
        ? { unitPrice: 800, vatClass: "reduced", dietaryDeclarations: [] }
        : { variantOrder: name === "Large" ? 1 : 0 }),
    })
    .returning({ id: products.id });
  return product!.id;
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await app(fixture);
});
afterEach(() => vi.useRealTimers());

const read = () => app((tx) => readSetMenu(tx, f.menuId));
const add = (...ids: string[]) => app((tx) => addProducts(tx, f.root, ids));
const change = (menuItemId: string, courseId: string | null) =>
  app((tx) => saveSetMenuDishCourse(tx, f.menuId, menuItemId, courseId));
const line = (...courseIds: string[]) => ({ id: expect.any(String), count: 1, courseIds });

it("sets a course for the dish and its variants in this set menu alone", async () => {
  await add(f.soup, f.bravas);
  const before = await read();
  const bravas = before.dishes[1]!.menuItemId;
  expect(await change(bravas, f.starters)).toEqual({
    addedLines: [],
    removedLines: [before.lines[1]],
  });
  const after = await read();
  expect(after.lines).toEqual([before.lines[0]]);
  expect(after.problems).toEqual([]);
  expect(after.dishes[1]).toMatchObject({
    courseId: f.starters,
    productCourseId: f.sharing,
    courseOverrideId: f.starters,
    variants: [
      { id: f.small, courseId: f.starters },
      { id: f.large, courseId: f.starters },
    ],
  });
  const ordinary = await app(async (tx) => {
    const ordinary = await createMenu(tx, { name: "Ordinary menu" });
    await addProducts(tx, await requireMenuRoot(tx, ordinary.id), [f.bravas]);
    return listMenuOffers(tx, [ordinary.id]);
  });
  expect(ordinary[0]).toMatchObject({
    productId: f.bravas,
    courseId: f.sharing,
    variants: [
      { id: f.small, courseId: f.sharing },
      { id: f.large, courseId: f.sharing },
    ],
  });
  expect(await change(bravas, f.sharing)).toEqual({
    addedLines: [line(f.sharing)],
    removedLines: [],
  });
  expect((await read()).dishes[1]).toMatchObject({
    courseId: f.sharing,
    productCourseId: f.sharing,
    courseOverrideId: null,
  });
});

it.each(["more than one portion", "more than one accepted course", "another dish can fill it"])(
  "keeps the previous line when it has %s",
  async (reason) => {
    await add(f.soup, f.bravas);
    if (reason === "another dish can fill it") {
      const croquetas = await app((tx) => dish(tx, "Croquetas", f.sharing));
      await add(croquetas);
    }
    const previous = {
      count: reason === "more than one portion" ? 2 : 1,
      courseIds: reason === "more than one accepted course" ? [f.sharing, f.desserts] : [f.sharing],
    };
    const [, kept] = await app((tx) =>
      saveSetMenuLines(tx, f.menuId, [{ count: 1, courseIds: [f.starters] }, previous]),
    );
    const bravas = (await read()).dishes[1]!.menuItemId;
    expect(await change(bravas, f.starters)).toEqual({ addedLines: [], removedLines: [] });
    expect((await read()).lines[1]).toEqual(kept);
  },
);

it("can give a course to a dish with none and later clear it explicitly", async () => {
  const cheese = await app((tx) => dish(tx, "Cheese", null));
  await add(cheese);
  const before = await read();
  const itemId = before.dishes[0]!.menuItemId;
  expect(before.problems).toContainEqual({
    kind: "dish_without_course",
    productId: cheese,
    name: "Cheese",
    parentName: null,
  });
  expect(await change(itemId, f.desserts)).toEqual({
    addedLines: [line(f.desserts)],
    removedLines: [],
  });
  const after = await read();
  expect(after.problems).toEqual([]);
  expect(await change(itemId, null)).toEqual({ addedLines: [], removedLines: after.lines });
  expect((await read()).dishes[0]!.courseOverrideId).toBeNull();
});

it("refuses an inactive or unknown course and a dish that is not on this set menu", async () => {
  await add(f.bravas);
  const before = await read();
  const itemId = before.dishes[0]!.menuItemId;
  for (const invalid of [f.retired, crypto.randomUUID()]) {
    await expect(change(itemId, invalid)).rejects.toMatchObject({
      code: "set_menu.invalid",
      params: { field: "courseId" },
    });
  }
  const otherItem = await app(async (tx) => {
    const other = await createMenu(tx, { ...terms, name: "Other menu" });
    await addProducts(tx, await requireMenuRoot(tx, other.id), [f.bravas]);
    return (await readSetMenu(tx, other.id)).dishes[0]!.menuItemId;
  });
  await expect(change(otherItem, f.starters)).rejects.toMatchObject({
    code: "set_menu.not_found",
    params: { menuId: f.menuId },
  });
  expect(await read()).toEqual(before);
});

it("moves the stamp used to decide which copy is newest", async () => {
  await add(f.bravas);
  const itemId = (await read()).dishes[0]!.menuItemId;
  vi.useFakeTimers({ toFake: ["Date"] });
  const time = new Date("2030-02-01T12:00:00Z");
  vi.setSystemTime(time);
  await change(itemId, f.starters);
  const [stored] = await suite.db
    .select({ updatedAt: menus.updatedAt })
    .from(menus)
    .where(eq(menus.id, f.menuId));
  expect(stored!.updatedAt).toEqual(time);
});

it("keeps the override when copying or duplicating a set menu's dish", async () => {
  await add(f.bravas);
  await change((await read()).dishes[0]!.menuItemId, f.starters);
  const [copied, duplicated] = await app(async (tx) => {
    const target = await createMenu(tx, { ...terms, name: "Copy target" });
    const copyLines = await copySetMenuDishes(tx, target.id, f.menuId);
    expect(copyLines).toEqual([line(f.starters)]);
    const duplicate = await duplicateMenu(tx, f.menuId, "Daily copy");
    return [await readSetMenu(tx, target.id), await readSetMenu(tx, duplicate.id)];
  });
  for (const result of [copied, duplicated]) {
    expect(result.dishes[0]).toMatchObject({
      productId: f.bravas,
      courseId: f.starters,
      productCourseId: f.sharing,
      courseOverrideId: f.starters,
    });
    expect(result.lines).toEqual([line(f.starters)]);
    expect(result.problems).toEqual([]);
  }
});
