import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { plantStoredCategory, seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCategory, listCategories, readCategory } from "./categories.js";
import { createCatalogue, createProduct, deactivateProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import {
  deleteCatalogueItems,
  moveCatalogueItems,
  summariseFolders,
  type FolderContents,
} from "./catalogue-items.js";

const suite = useCatalogueDb();
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);
let d: string, b: string, f: string, cola: string, lager: string, burger: string, variant: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  await app(async (tx) => {
    d = (await createCategory(tx, { name: "Drinks" })).id;
    b = (await createCategory(tx, { name: "Beer", parentId: d })).id;
    f = (await createCategory(tx, { name: "Food" })).id;
    const menu = await createCatalogue(tx, { name: "Menu" });
    const make = async (name: string, categoryId: string) =>
      (
        await createProduct(tx, {
          catalogueId: menu.id,
          categoryId,
          name,
          pricingUnit: "each",
          unitPrice: "2",
          vatClass: "general",
        })
      ).id;
    cola = await make("Cola", d);
    lager = await make("Lager", b);
    burger = await make("Burger", f);
    variant = (
      await setProductVariants(
        tx,
        lager,
        [
          {
            name: "Half",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            available: true,
          },
        ],
        "en",
      )
    )[0]!.id;
  });
});

async function product(id: string) {
  const [row] = await suite.db
    .select({
      active: products.active,
      categoryId: products.categoryId,
      parentId: products.parentId,
    })
    .from(products)
    .where(eq(products.id, id));
  return row!;
}

describe("moveCatalogueItems", () => {
  it("checks cycles before moving any product, even before rollback", async () => {
    let beforeRollback: string | null | undefined;
    await expect(
      app(async (tx) => {
        try {
          await moveCatalogueItems(tx, { productIds: [cola], categoryIds: [d] }, b);
        } finally {
          const [row] = await tx
            .select({ categoryId: products.categoryId })
            .from(products)
            .where(eq(products.id, cola));
          beforeRollback = row!.categoryId;
        }
      }),
    ).rejects.toMatchObject({ code: "category.parent_cycle" });
    expect(beforeRollback).toBe(d);
  });

  it("moves products and folders together into a folder and to the top level", async () => {
    await app((tx) => moveCatalogueItems(tx, { productIds: [cola], categoryIds: [b] }, f));
    expect((await product(cola)).categoryId).toBe(f);
    expect((await app((tx) => readCategory(tx, b))).parentId).toBe(f);
    expect((await product(lager)).categoryId).toBe(b);
    expect((await product(variant)).parentId).toBe(lager);
    await app((tx) => moveCatalogueItems(tx, { productIds: [cola], categoryIds: [b] }, null));
    expect((await product(cola)).categoryId).toBeNull();
    expect((await app((tx) => readCategory(tx, b))).parentId).toBeNull();
  });

  it("refuses self and descendant destinations without moving a selected product", async () => {
    for (const to of [d, b]) {
      await expect(
        app((tx) => moveCatalogueItems(tx, { productIds: [cola], categoryIds: [d] }, to)),
      ).rejects.toMatchObject({ code: "category.parent_cycle" });
      expect((await product(cola)).categoryId).toBe(d);
      expect((await app((tx) => readCategory(tx, d))).parentId).toBeNull();
    }
  });

  it("checks every selected identity and the destination before writing", async () => {
    const missing = crypto.randomUUID();
    for (const bad of [missing, variant]) {
      await expect(
        app((tx) => moveCatalogueItems(tx, { productIds: [cola, bad], categoryIds: [] }, f)),
      ).rejects.toMatchObject({ code: "product.not_found", params: { productId: bad } });
    }
    for (const selection of [
      { productIds: [cola], categoryIds: [missing] },
      { productIds: [cola], categoryIds: [] },
    ]) {
      await expect(app((tx) => moveCatalogueItems(tx, selection, missing))).rejects.toMatchObject({
        code: "category.not_found",
        params: { categoryId: missing },
      });
    }
    expect((await product(cola)).categoryId).toBe(d);
  });

  it("reads the folder tree once even when several folders move below a deep destination", async () => {
    const leaf = await app((tx) => createCategory(tx, { name: "Leaf", parentId: b }));
    const other = await app((tx) => createCategory(tx, { name: "Other" }));
    await app(async (tx) => {
      const reads = vi.spyOn(tx, "select");
      try {
        await moveCatalogueItems(tx, { productIds: [], categoryIds: [f, other.id] }, leaf.id);
        expect(reads).toHaveBeenCalledTimes(1);
      } finally {
        reads.mockRestore();
      }
    });
    expect((await app((tx) => readCategory(tx, f))).parentId).toBe(leaf.id);
    expect((await app((tx) => readCategory(tx, other.id))).parentId).toBe(leaf.id);
  });
});

describe("deleteCatalogueItems", () => {
  it("validates every folder before changing products, even before rollback", async () => {
    const missing = crypto.randomUUID();
    let beforeRollback: { active: boolean; categoryId: string | null } | undefined;
    await expect(
      app(async (tx) => {
        try {
          await deleteCatalogueItems(tx, { productIds: [cola], categoryIds: [missing] }, "delete");
        } finally {
          [beforeRollback] = await tx
            .select({ active: products.active, categoryId: products.categoryId })
            .from(products)
            .where(eq(products.id, cola));
        }
      }),
    ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
    expect(beforeRollback).toEqual({ active: true, categoryId: d });
  });

  it("switches selected products off without moving them", async () => {
    await app((tx) => deleteCatalogueItems(tx, { productIds: [cola], categoryIds: [] }, "move_up"));
    expect(await product(cola)).toMatchObject({ active: false, categoryId: d });
    expect((await product(lager)).active).toBe(true);
  });

  it("moves the contents of a deleted folder to its parent", async () => {
    await app((tx) => deleteCatalogueItems(tx, { productIds: [], categoryIds: [d] }, "move_up"));
    expect(await product(cola)).toMatchObject({ active: true, categoryId: null });
    expect((await app((tx) => readCategory(tx, b))).parentId).toBeNull();
    expect((await product(lager)).categoryId).toBe(b);
    await expect(app((tx) => readCategory(tx, d))).rejects.toMatchObject({
      code: "category.not_found",
    });
  });

  it("clears a variant's stored category in a deleted folder whose contents move up", async () => {
    await app((tx) => plantStoredCategory(tx, variant, b));
    await app((tx) => deleteCatalogueItems(tx, { productIds: [], categoryIds: [b] }, "move_up"));
    expect(await product(lager)).toMatchObject({ active: true, categoryId: d });
    expect(await product(variant)).toMatchObject({ categoryId: null, parentId: lager });
    await expect(app((tx) => readCategory(tx, b))).rejects.toMatchObject({
      code: "category.not_found",
    });
  });

  it.each(["parent-first", "child-first"])(
    "moves nested selected folders' contents to their grandparent (%s)",
    async (order) => {
      await app((tx) =>
        deleteCatalogueItems(
          tx,
          { productIds: [], categoryIds: order === "parent-first" ? [d, b] : [b, d] },
          "move_up",
        ),
      );
      expect(await product(lager)).toMatchObject({ active: true, categoryId: null });
      expect((await app(listCategories)).map((row) => row.id)).toEqual([f]);
    },
  );

  it.each(["parent-first", "child-first"])(
    "deletes a subtree selected with its child only once (%s)",
    async (order) => {
      await app((tx) =>
        deleteCatalogueItems(
          tx,
          { productIds: [], categoryIds: order === "parent-first" ? [d, b] : [b, d] },
          "delete",
        ),
      );
      expect((await app(listCategories)).map((row) => row.id)).toEqual([f]);
      for (const id of [cola, lager])
        expect(await product(id)).toMatchObject({ active: false, categoryId: null });
      expect(await product(burger)).toMatchObject({ active: true, categoryId: f });
    },
  );

  it("clears a variant's stored category in a deleted subtree while retaining its product", async () => {
    await app((tx) => plantStoredCategory(tx, variant, b));
    await app((tx) => deleteCatalogueItems(tx, { productIds: [], categoryIds: [b] }, "delete"));
    expect(await product(variant)).toMatchObject({ categoryId: null, parentId: lager });
    expect(await product(lager)).toMatchObject({ active: false, categoryId: d });
    expect((await product(cola)).active).toBe(true);
  });

  it("refuses unknown or variant identities and rolls back the whole selection", async () => {
    const missing = crypto.randomUUID();
    for (const bad of [missing, variant]) {
      await expect(
        app((tx) =>
          deleteCatalogueItems(tx, { productIds: [cola, bad], categoryIds: [d] }, "delete"),
        ),
      ).rejects.toMatchObject({ code: "product.not_found", params: { productId: bad } });
    }
    await expect(
      app((tx) =>
        deleteCatalogueItems(tx, { productIds: [cola], categoryIds: [missing] }, "delete"),
      ),
    ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
    expect(await product(cola)).toMatchObject({ active: true, categoryId: d });
    expect(await app(listCategories)).toHaveLength(3);
  });
});

describe("deleteCatalogueItems with the counts the client read before deleting", () => {
  const shownFor = async (ids: string[]) =>
    (await app((tx) => summariseFolders(tx, ids))).map(
      ({ id, folders, products, activeProducts, routes, ownRoutes }) => ({
        id,
        folders,
        products,
        activeProducts,
        routes,
        ownRoutes,
      }),
    );
  const addProduct = (tx: Transaction, categoryId: string) =>
    createCatalogue(tx, { name: "Later" }).then((menu) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId,
        name: "Stout",
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "general",
      }),
    );

  it.each<[string, (tx: Transaction) => Promise<unknown>]>([
    ["an active product added to a subcategory", (tx) => addProduct(tx, b)],
    ["a subcategory added", (tx) => createCategory(tx, { name: "Ale", parentId: b })],
  ])("refuses with old counts after %s, and deletes nothing", async (_change, change) => {
    const shown = await shownFor([d]);
    await app(change);
    await expect(
      app((tx) =>
        deleteCatalogueItems(tx, { productIds: [burger], categoryIds: [d] }, "delete", shown),
      ),
    ).rejects.toMatchObject({ code: "category.contents_changed", params: { categoryId: d } });
    expect((await app((tx) => readCategory(tx, d))).id).toBe(d);
    expect((await app((tx) => readCategory(tx, b))).parentId).toBe(d);
    for (const id of [cola, lager, burger]) expect((await product(id)).active).toBe(true);
  });

  it.each<FolderContents>(["move_up", "delete"])(
    "refuses an empty category's delete after an inactive product was added to it, leaving the product in place (%s)",
    async (contents) => {
      const empty = (await app((tx) => createCategory(tx, { name: "Desserts" }))).id;
      const shown = await shownFor([empty]);
      const added = await app(async (tx) => {
        const created = await addProduct(tx, empty);
        await deactivateProduct(tx, created.id);
        return created.id;
      });
      await expect(
        app((tx) =>
          deleteCatalogueItems(tx, { productIds: [], categoryIds: [empty] }, contents, shown),
        ),
      ).rejects.toMatchObject({ code: "category.contents_changed", params: { categoryId: empty } });
      expect((await app((tx) => readCategory(tx, empty))).id).toBe(empty);
      expect(await product(added)).toMatchObject({ active: false, categoryId: empty });
    },
  );

  it.each<FolderContents>(["move_up", "delete"])(
    "checks the counts before switching off a selected product, even before rollback (%s)",
    async (contents) => {
      const shown = await shownFor([d]);
      await app((tx) => addProduct(tx, b));
      let beforeRollback: boolean | undefined;
      await expect(
        app(async (tx) => {
          try {
            await deleteCatalogueItems(
              tx,
              { productIds: [burger], categoryIds: [d] },
              contents,
              shown,
            );
          } finally {
            const [row] = await tx
              .select({ active: products.active })
              .from(products)
              .where(eq(products.id, burger));
            beforeRollback = row!.active;
          }
        }),
      ).rejects.toMatchObject({ code: "category.contents_changed", params: { categoryId: d } });
      expect(beforeRollback).toBe(true);
    },
  );

  it("names the first selected category whose counts differ", async () => {
    const shown = await shownFor([f, b]);
    await app((tx) => addProduct(tx, b));
    await expect(
      app((tx) =>
        deleteCatalogueItems(tx, { productIds: [], categoryIds: [f, b] }, "delete", shown),
      ),
    ).rejects.toMatchObject({ code: "category.contents_changed", params: { categoryId: b } });
    expect(await app(listCategories)).toHaveLength(3);
  });

  it.each<FolderContents>(["move_up", "delete"])(
    "refuses when the category's own routing rules differ from those shown, and deletes nothing (%s)",
    async (contents) => {
      const [shown] = await shownFor([d]);
      await expect(
        app((tx) =>
          deleteCatalogueItems(tx, { productIds: [], categoryIds: [d] }, contents, [
            { ...shown!, ownRoutes: shown!.ownRoutes + 1 },
          ]),
        ),
      ).rejects.toMatchObject({ code: "category.contents_changed", params: { categoryId: d } });
      expect(await app(listCategories)).toHaveLength(3);
    },
  );

  it("deletes when the counts shown still hold", async () => {
    const shown = await shownFor([d]);
    await app((tx) =>
      deleteCatalogueItems(tx, { productIds: [], categoryIds: [d] }, "delete", shown),
    );
    expect((await app(listCategories)).map((row) => row.id)).toEqual([f]);
    for (const id of [cola, lager]) expect((await product(id)).active).toBe(false);
  });

  it("refuses a shown list that leaves out a selected category, and deletes nothing", async () => {
    const shown = await shownFor([d]);
    await expect(
      app((tx) =>
        deleteCatalogueItems(tx, { productIds: [], categoryIds: [d, f] }, "delete", shown),
      ),
    ).rejects.toMatchObject({ code: "category.contents_changed", params: { categoryId: f } });
    expect(await app(listCategories)).toHaveLength(3);
    for (const id of [cola, lager, burger]) expect((await product(id)).active).toBe(true);
  });
});

describe("summariseFolders", () => {
  it("counts descendants and active or inactive top-level products in request order", async () => {
    await app((tx) => deactivateProduct(tx, lager));
    await app((tx) => plantStoredCategory(tx, variant, b));
    expect(await app((tx) => summariseFolders(tx, [f, d, b]))).toEqual([
      { id: f, folders: 0, products: 1, activeProducts: 1, routes: 0, ownRoutes: 0 },
      { id: d, folders: 1, products: 2, activeProducts: 1, routes: 0, ownRoutes: 0 },
      { id: b, folders: 0, products: 1, activeProducts: 0, routes: 0, ownRoutes: 0 },
    ]);
  });
  it("counts active products across the whole subtree, leaving out an inactive one two levels down", async () => {
    await app(async (tx) => {
      const stouts = (await createCategory(tx, { name: "Stout", parentId: b })).id;
      const bar = await createCatalogue(tx, { name: "Bar" });
      const { id } = await createProduct(tx, {
        catalogueId: bar.id,
        categoryId: stouts,
        name: "Porter",
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "general",
      });
      await deactivateProduct(tx, id);
    });
    expect(await app((tx) => summariseFolders(tx, [d, b]))).toEqual([
      { id: d, folders: 2, products: 3, activeProducts: 2, routes: 0, ownRoutes: 0 },
      { id: b, folders: 1, products: 2, activeProducts: 1, routes: 0, ownRoutes: 0 },
    ]);
  });
  it("refuses unknown folders rather than reporting them as empty", async () => {
    const missing = crypto.randomUUID();
    await expect(app((tx) => summariseFolders(tx, [d, missing]))).rejects.toMatchObject({
      code: "category.not_found",
      params: { categoryId: missing },
    });
  });
  it("accepts empty selections and summaries", async () => {
    await app((tx) => moveCatalogueItems(tx, { productIds: [], categoryIds: [] }, null));
    await app((tx) => deleteCatalogueItems(tx, { productIds: [], categoryIds: [] }, "delete"));
    expect(await app((tx) => summariseFolders(tx, []))).toEqual([]);
    expect((await product(cola)).active).toBe(true);
    expect(await app(listCategories)).toHaveLength(3);
  });
});
