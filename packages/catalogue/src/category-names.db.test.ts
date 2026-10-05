import { beforeEach, describe, expect, it } from "vitest";
import { categories, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useCatalogueDb } from "../test/fixtures.js";
import {
  createCategory,
  deleteCategory,
  listCategories,
  readCategory,
  updateCategory,
} from "./categories.js";
import { deleteCatalogueItems, moveCatalogueItems } from "./catalogue-items.js";
import { categoryDetails } from "./schema/categories.js";

/** A category's name is unique among the categories with the same parent, the root included. */
const suite = useCatalogueDb();
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);
const taken = (name: string) => ({ code: "category.name_taken", params: { field: "name", name } });

let drinks: string, food: string, beer: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  await app(async (tx) => {
    drinks = (await createCategory(tx, { name: "Drinks" })).id;
    food = (await createCategory(tx, { name: "Food" })).id;
    beer = (await createCategory(tx, { name: "Beer", parentId: drinks })).id;
  });
});

/** Writes a category past every category path: how a test models two siblings that already share
 * a name, as data written before the rule existed. */
async function plantCategory(name: string, parentId: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await suite.db.insert(categories).values({ id, name });
  await suite.db.insert(categoryDetails).values({ categoryId: id, parentId });
  return id;
}

const snapshot = () => app((tx) => listCategories(tx));

describe("create", () => {
  it.each(["Drinks", "drinks", "  DRINKS "])("refuses a root category named %j", async (name) => {
    await expect(app((tx) => createCategory(tx, { name }))).rejects.toMatchObject(
      taken(name.trim()),
    );
  });
  it("refuses a duplicate under the same parent", async () => {
    await expect(
      app((tx) => createCategory(tx, { name: "beer", parentId: drinks })),
    ).rejects.toMatchObject(taken("beer"));
  });
  it("allows the same name under a different parent", async () => {
    const created = await app((tx) => createCategory(tx, { name: "Beer", parentId: food }));
    expect(created).toMatchObject({ name: "Beer", parentId: food });
    const atRoot = await app((tx) => createCategory(tx, { name: "Beer" }));
    expect(atRoot).toMatchObject({ name: "Beer", parentId: null });
  });
  it("counts a root category stored with no details row", async () => {
    await suite.db.insert(categories).values({ id: crypto.randomUUID(), name: "Bare" });
    await expect(app((tx) => createCategory(tx, { name: "bare" }))).rejects.toMatchObject(
      taken("bare"),
    );
  });
});

describe("update", () => {
  it("refuses a rename onto a sibling's name", async () => {
    await expect(app((tx) => updateCategory(tx, food, { name: " drinks" }))).rejects.toMatchObject(
      taken("drinks"),
    );
    expect((await app((tx) => readCategory(tx, food))).name).toBe("Food");
  });
  it("allows a rename to another casing of its own name", async () => {
    expect(await app((tx) => updateCategory(tx, food, { name: "FOOD" }))).toMatchObject({
      name: "FOOD",
    });
  });
  it("refuses a move into a parent already holding the name", async () => {
    const other = await app((tx) => createCategory(tx, { name: "Beer", parentId: food }));
    await expect(
      app((tx) => updateCategory(tx, other.id, { parentId: drinks })),
    ).rejects.toMatchObject(taken("Beer"));
    expect((await app((tx) => readCategory(tx, other.id))).parentId).toBe(food);
  });
  it("refuses a rename and move together that lands on a name", async () => {
    await expect(
      app((tx) => updateCategory(tx, food, { name: "BEER", parentId: drinks })),
    ).rejects.toMatchObject(taken("BEER"));
  });
  it("does not refuse a save that keeps a name two siblings already shared", async () => {
    const twin = await plantCategory("drinks", null);
    expect(await app((tx) => updateCategory(tx, twin, { name: "drinks" }))).toMatchObject({
      name: "drinks",
    });
  });
});

describe("delete moving the contents up", () => {
  it("refuses when a child would land beside a same-named sibling, and deletes nothing", async () => {
    await app((tx) => createCategory(tx, { name: "food", parentId: drinks }));
    const before = await snapshot();
    await expect(app((tx) => deleteCategory(tx, drinks))).rejects.toMatchObject(taken("food"));
    expect(await snapshot()).toEqual(before);
  });
  it("refuses through the bulk delete as well", async () => {
    await app((tx) => createCategory(tx, { name: "Food", parentId: drinks }));
    const before = await snapshot();
    await expect(
      app((tx) => deleteCatalogueItems(tx, { productIds: [], categoryIds: [drinks] }, "move_up")),
    ).rejects.toMatchObject(taken("Food"));
    expect(await snapshot()).toEqual(before);
  });
  it("lets the children move up when the names differ", async () => {
    await app((tx) => deleteCategory(tx, drinks));
    expect((await app((tx) => readCategory(tx, beer))).parentId).toBeNull();
  });
});

describe("bulk move", () => {
  it("refuses a move into a parent already holding the name, and moves nothing", async () => {
    const other = await app((tx) => createCategory(tx, { name: "beer", parentId: food }));
    const before = await snapshot();
    await expect(
      app((tx) => moveCatalogueItems(tx, { productIds: [], categoryIds: [other.id] }, drinks)),
    ).rejects.toMatchObject(taken("beer"));
    expect(await snapshot()).toEqual(before);
  });
  it("refuses two moved categories that share a name", async () => {
    const left = await app((tx) => createCategory(tx, { name: "Wine", parentId: drinks }));
    const right = await app((tx) => createCategory(tx, { name: "wine", parentId: food }));
    await expect(
      app((tx) =>
        moveCatalogueItems(tx, { productIds: [], categoryIds: [left.id, right.id] }, null),
      ),
    ).rejects.toMatchObject(taken("wine"));
  });
  it("moves a category whose name the target does not hold", async () => {
    await app((tx) => moveCatalogueItems(tx, { productIds: [], categoryIds: [beer] }, food));
    expect((await app((tx) => readCategory(tx, beer))).parentId).toBe(food);
  });
  it("does not refuse a move within the parent a category already has", async () => {
    await plantCategory("beer", drinks);
    await app((tx) => moveCatalogueItems(tx, { productIds: [], categoryIds: [beer] }, drinks));
    expect((await app((tx) => readCategory(tx, beer))).parentId).toBe(drinks);
  });
});
