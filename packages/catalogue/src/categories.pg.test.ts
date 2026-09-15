import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  readCategory,
  replaceProductCategories,
  readProductCategories,
  categoryDependants,
  addProductsToCategory,
} from "./categories.js";
import { writeContentLanguages } from "./content-languages.js";
import { createCatalogue, createProduct } from "./operations.js";
import { seedLegacySellingUnits } from "../test/fixtures.js";
const suite = useTemplateDb({ template: "core" });
const app = <T>(db: Database, tenant: string, action: (tx: Transaction) => Promise<T>) => {
  void tenant;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
};
async function fixture() {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin);
  const a = await app(suite.admin, tenantId, (tx) =>
    createCategory(tx, tenantId, { name: { en: "A" } }),
  );
  const b = await app(suite.admin, tenantId, (tx) =>
    createCategory(tx, tenantId, { name: { en: "B" } }),
  );
  return { tenantId, a, b };
}
async function race(
  tenant: string,
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<unknown>,
) {
  const [one, two] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let settled: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    const pid = (await two.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]!
      .pid;
    const writing = app(one, tenant, async (tx) => {
      const result = await first(tx);
      ready();
      await hold;
      return result;
    });
    void writing.catch(() => ready());
    await started;
    const competing = app(two, tenant, second);
    settled = Promise.allSettled([writing, competing]);
    try {
      await expect
        .poll(
          async () =>
            (
              await suite.admin.execute<{ blocked: boolean }>(
                sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`,
              )
            ).rows[0]!.blocked,
        )
        .toBe(true);
    } finally {
      release();
    }
    return await settled;
  } finally {
    release();
    await settled;
    await Promise.all([one.close(), two.close()]);
  }
}
it("authors hierarchy and membership with the non-superuser deployment role", async () => {
  const { tenantId, a, b } = await fixture();
  await app(suite.admin, tenantId, async (tx) => {
    expect(
      (
        await tx.execute(
          sql`select current_user as role, rolsuper from pg_roles where rolname = current_user`,
        )
      ).rows,
    ).toEqual([{ role: "app_user", rolsuper: false }]);
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: a.id,
      name: "P",
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    await replaceProductCategories(tx, product.id, { categoryIds: [a.id, b.id] });
    expect(await readProductCategories(tx, product.id)).toEqual({
      categoryIds: [a.id, b.id].sort(),
      primaryCategoryId: a.id,
    });
    await replaceProductCategories(tx, product.id, { categoryIds: [] });
    await updateCategory(tx, a.id, { parentId: b.id });
    await updateCategory(tx, a.id, { parentId: null });
    await deleteCategory(tx, b.id);
  });
});
it("serializes opposing reparenting and rejects the second edge", async () => {
  const { tenantId, a, b } = await fixture();
  const [first, second] = await race(
    tenantId,
    (tx) => updateCategory(tx, a.id, { parentId: b.id }),
    (tx) => updateCategory(tx, b.id, { parentId: a.id }),
  );
  expect(first!.status).toBe("fulfilled");
  expect(second).toMatchObject({ status: "rejected", reason: { code: "category.parent_cycle" } });
  expect((await app(suite.admin, tenantId, (tx) => readCategory(tx, b.id))).parentId).toBeNull();
});
it.each(["attach", "delete"] as const)(
  "serializes delete/attach with %s committing first",
  async (winner) => {
    const { tenantId, a } = await fixture();
    const product = await app(suite.admin, tenantId, async (tx) => {
      const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
      return createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: null,
        name: "P",
        pricingUnit: "each",
        unitPrice: "1",
        vatClass: "general",
      });
    });
    const attach = (tx: Transaction) =>
      replaceProductCategories(tx, product.id, { categoryIds: [a.id] });
    const remove = (tx: Transaction) => deleteCategory(tx, a.id);
    const result = await race(
      tenantId,
      winner === "attach" ? attach : remove,
      winner === "attach" ? remove : attach,
    );
    expect(result[0]!.status).toBe("fulfilled");
    if (winner === "attach")
      // The delete serializes behind the attach, then cascades the just-added membership away.
      expect(result[1]).toMatchObject({ status: "fulfilled" });
    // The attach serializes behind the delete and cannot reference the gone category.
    else
      expect(result[1]).toMatchObject({
        status: "rejected",
        reason: { code: "category.not_found" },
      });
    // Either ordering leaves no membership pointing at the deleted category.
    expect(await app(suite.admin, tenantId, (tx) => readProductCategories(tx, product.id))).toEqual(
      { categoryIds: [], primaryCategoryId: null },
    );
  },
);

it.each(["category", "language"] as const)(
  "serializes a name/hierarchy edit against default-language changes with %s first",
  async (winner) => {
    const { tenantId, a, b } = await fixture();
    await app(suite.admin, tenantId, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      await updateCategory(tx, a.id, { name: { en: "A", fr: "Un" } });
      await updateCategory(tx, b.id, { name: { en: "B", fr: "Deux" } });
    });
    const edit = (tx: Transaction) =>
      updateCategory(tx, a.id, {
        name: { en: "Changed" },
        parentId: b.id,
      });
    const language = (tx: Transaction) =>
      writeContentLanguages(tx, {
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
    const result = await race(
      tenantId,
      winner === "category" ? edit : language,
      winner === "category" ? language : edit,
    );
    expect(result[0]!.status).toBe("fulfilled");
    expect(result[1]).toMatchObject({
      status: "rejected",
      reason: {
        code: winner === "category" ? "content.default_missing" : "content.translation_required",
      },
    });
    expect(await app(suite.admin, tenantId, (tx) => readCategory(tx, a.id))).toEqual({
      ...a,
      name: winner === "category" ? { en: "Changed" } : { en: "A", fr: "Un" },
      parentId: winner === "category" ? b.id : null,
    });
  },
);
it("stores and validates a category colour", async () => {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin);
  const made = await app(suite.admin, tenantId, (tx) =>
    createCategory(tx, tenantId, { name: { en: "Hot" }, color: "#b12525" }),
  );
  expect(made.color).toBe("#b12525");
  const cleared = await app(suite.admin, tenantId, (tx) =>
    updateCategory(tx, made.id, { color: null }),
  );
  expect(cleared.color).toBeNull();
  await expect(
    app(suite.admin, tenantId, (tx) =>
      createCategory(tx, tenantId, { name: { en: "Bad" }, color: "#FFF" }),
    ),
  ).rejects.toMatchObject({ code: "category.color_invalid" });
});
const seedProduct = (tenantId: Awaited<ReturnType<typeof seedTenant>>) =>
  app(suite.admin, tenantId, async (tx) => {
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    return (
      await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: null,
        name: "P",
        pricingUnit: "each",
        unitPrice: "1",
        vatClass: "general",
      })
    ).id;
  });
it("allows memberships with no reporting category", async () => {
  const { tenantId, a, b } = await fixture();
  const productId = await seedProduct(tenantId);
  const saved = await app(suite.admin, tenantId, (tx) =>
    replaceProductCategories(tx, productId, {
      categoryIds: [a.id, b.id],
      primaryCategoryId: null,
    }),
  );
  expect(saved.primaryCategoryId).toBeNull();
  expect(saved.categoryIds).toEqual([a.id, b.id].sort());
});
it("clears reporting category when the current one is removed and none is chosen", async () => {
  const { tenantId, a, b } = await fixture();
  const productId = await seedProduct(tenantId);
  await app(suite.admin, tenantId, (tx) =>
    replaceProductCategories(tx, productId, {
      categoryIds: [a.id, b.id],
      primaryCategoryId: a.id,
    }),
  );
  const saved = await app(suite.admin, tenantId, (tx) =>
    replaceProductCategories(tx, productId, { categoryIds: [b.id] }),
  );
  expect(saved.primaryCategoryId).toBeNull();
  expect(saved.categoryIds).toEqual([b.id]);
});
it("deleting a category unassigns products and clears their reporting category", async () => {
  const { tenantId, a, b } = await fixture();
  const product1 = await seedProduct(tenantId);
  const product2 = await seedProduct(tenantId);
  await app(suite.admin, tenantId, async (tx) => {
    // product1: primary A, also a member of B; product2: only A.
    await replaceProductCategories(tx, product1, {
      categoryIds: [a.id, b.id],
      primaryCategoryId: a.id,
    });
    await replaceProductCategories(tx, product2, {
      categoryIds: [a.id],
      primaryCategoryId: a.id,
    });
    await deleteCategory(tx, a.id);
    // A's memberships are gone; product1 keeps B but loses its A reporting category.
    expect(await readProductCategories(tx, product1)).toEqual({
      categoryIds: [b.id],
      primaryCategoryId: null,
    });
    expect(await readProductCategories(tx, product2)).toEqual({
      categoryIds: [],
      primaryCategoryId: null,
    });
  });
});
it("deleting a category reparents its children to its parent", async () => {
  const tenantId = await seedTenant(suite.admin);
  await app(suite.admin, tenantId, async (tx) => {
    const food = await createCategory(tx, tenantId, { name: { en: "Food" } });
    const breakfast = await createCategory(tx, tenantId, {
      name: { en: "Breakfast" },
      parentId: food.id,
    });
    const eggs = await createCategory(tx, tenantId, {
      name: { en: "Eggs" },
      parentId: breakfast.id,
    });
    await deleteCategory(tx, breakfast.id);
    expect((await readCategory(tx, eggs.id)).parentId).toBe(food.id);
  });
});
it("deleting a top-level category makes its children top-level", async () => {
  const tenantId = await seedTenant(suite.admin);
  await app(suite.admin, tenantId, async (tx) => {
    const breakfast = await createCategory(tx, tenantId, { name: { en: "Breakfast" } });
    const eggs = await createCategory(tx, tenantId, {
      name: { en: "Eggs" },
      parentId: breakfast.id,
    });
    await deleteCategory(tx, breakfast.id);
    expect((await readCategory(tx, eggs.id)).parentId).toBeNull();
  });
});
async function dependantsFixture() {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin);
  const made = await app(suite.admin, tenantId, async (tx) => {
    const food = await createCategory(tx, tenantId, { name: { en: "Food" } });
    const x = await createCategory(tx, tenantId, { name: { en: "X" }, parentId: food.id });
    const eggs = await createCategory(tx, tenantId, { name: { en: "Eggs" }, parentId: x.id });
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const p1 = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "P1",
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    const p2 = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "P2",
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    // p1's reporting category is X (also a member); p2 is a member of X with no reporting category.
    await replaceProductCategories(tx, p1.id, {
      categoryIds: [x.id],
      primaryCategoryId: x.id,
    });
    await replaceProductCategories(tx, p2.id, {
      categoryIds: [x.id],
      primaryCategoryId: null,
    });
    return { food, x, eggs, p1, p2 };
  });
  return {
    tenantId,
    foodId: made.food.id,
    xId: made.x.id,
    eggsId: made.eggs.id,
    p1Id: made.p1.id,
    p2Id: made.p2.id,
  };
}
it("reports a category's dependants for the delete preview", async () => {
  const { tenantId, foodId, xId, eggsId, p1Id, p2Id } = await dependantsFixture();
  const deps = await app(suite.admin, tenantId, (tx) => categoryDependants(tx, xId));
  expect(deps.parentId).toBe(foodId);
  expect(deps.children.map((c) => c.id)).toEqual([eggsId]);
  expect(deps.products.find((p) => p.id === p1Id)!.reporting).toBe(true);
  expect(deps.products.find((p) => p.id === p2Id)!.reporting).toBe(false);
});
// The bulk add runs here rather than on PGlite because its write is one multi-row
// `insert … on conflict do nothing` plus one set-based update, and only real PostgreSQL runs those
// under the non-superuser `app_user` role that production uses.
async function bulkAddFixture() {
  const { tenantId, a: c, b: d } = await fixture();
  const p1Id = await seedProduct(tenantId);
  const p2Id = await seedProduct(tenantId);
  // p2 starts as a member of D with D as its reporting category; p1 has neither.
  await app(suite.admin, tenantId, (tx) =>
    replaceProductCategories(tx, p2Id, {
      categoryIds: [d.id],
      primaryCategoryId: d.id,
    }),
  );
  return { tenantId, cId: c.id, dId: d.id, p1Id, p2Id };
}
it("bulk-adds products, setting the reporting category only where absent", async () => {
  const { tenantId, cId, dId, p1Id, p2Id } = await bulkAddFixture();
  await app(suite.admin, tenantId, (tx) => addProductsToCategory(tx, cId, [p1Id, p2Id]));
  expect(await app(suite.admin, tenantId, (tx) => readProductCategories(tx, p1Id))).toEqual({
    categoryIds: [cId],
    primaryCategoryId: cId,
  });
  expect(await app(suite.admin, tenantId, (tx) => readProductCategories(tx, p2Id))).toEqual({
    categoryIds: [cId, dId].sort(),
    primaryCategoryId: dId,
  });
});
it("a repeated bulk add and an empty list change nothing", async () => {
  const { tenantId, cId, dId, p2Id } = await bulkAddFixture();
  await app(suite.admin, tenantId, async (tx) => {
    await addProductsToCategory(tx, cId, [p2Id]);
    await addProductsToCategory(tx, cId, [p2Id]);
    await addProductsToCategory(tx, cId, []);
  });
  expect(await app(suite.admin, tenantId, (tx) => readProductCategories(tx, p2Id))).toEqual({
    categoryIds: [cId, dId].sort(),
    primaryCategoryId: dId,
  });
});
it("refuses a bulk add whose product ids are not an array", async () => {
  const { tenantId, cId } = await bulkAddFixture();
  await expect(
    app(suite.admin, tenantId, (tx) =>
      // A request body coerced to a bare string: the type says string[], the wire does not.
      addProductsToCategory(tx, cId, "not-a-list" as unknown as string[]),
    ),
  ).rejects.toMatchObject({ code: "category.membership_invalid" });
});
const badProductIds: [string, (p1Id: string) => Promise<string>][] = [
  ["repeats a product id", (p1Id) => Promise.resolve(p1Id)],
  ["names a malformed product id", () => Promise.resolve("not-a-uuid")],
];
it.each(badProductIds)("refuses a bulk add that %s, applying nothing", async (_what, badId) => {
  const { tenantId, cId, p1Id } = await bulkAddFixture();
  const bad = await badId(p1Id);
  await expect(
    app(suite.admin, tenantId, (tx) => addProductsToCategory(tx, cId, [p1Id, bad])),
  ).rejects.toMatchObject({ code: "category.membership_invalid" });
  expect(await app(suite.admin, tenantId, (tx) => readProductCategories(tx, p1Id))).toEqual({
    categoryIds: [],
    primaryCategoryId: null,
  });
});
