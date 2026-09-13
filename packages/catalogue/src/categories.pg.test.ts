import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
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
} from "./categories.js";
import { writeContentLanguages } from "./content-languages.js";
import { createCatalogue, createProduct } from "./operations.js";
import { seedLegacySellingUnits } from "../test/fixtures.js";
const suite = useTemplateDb({ template: "core" });
const app = <T>(db: Database, tenant: string, action: (tx: Transaction) => Promise<T>) =>
  withTenant(db, tenant, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
async function fixture() {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
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
      descriptions: { en: "P" },
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    await replaceProductCategories(tx, tenantId, product.id, { categoryIds: [a.id, b.id] });
    expect(await readProductCategories(tx, tenantId, product.id)).toEqual({
      categoryIds: [a.id, b.id].sort(),
      primaryCategoryId: a.id,
    });
    await replaceProductCategories(tx, tenantId, product.id, { categoryIds: [] });
    await updateCategory(tx, tenantId, a.id, { parentId: b.id });
    await updateCategory(tx, tenantId, a.id, { parentId: null });
    await deleteCategory(tx, tenantId, b.id);
  });
});
it("serializes opposing reparenting and rejects the second edge", async () => {
  const { tenantId, a, b } = await fixture();
  const [first, second] = await race(
    tenantId,
    (tx) => updateCategory(tx, tenantId, a.id, { parentId: b.id }),
    (tx) => updateCategory(tx, tenantId, b.id, { parentId: a.id }),
  );
  expect(first!.status).toBe("fulfilled");
  expect(second).toMatchObject({ status: "rejected", reason: { code: "category.parent_cycle" } });
  expect(
    (await app(suite.admin, tenantId, (tx) => readCategory(tx, tenantId, b.id))).parentId,
  ).toBeNull();
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
        descriptions: { en: "P" },
        pricingUnit: "each",
        unitPrice: "1",
        vatClass: "general",
      });
    });
    const attach = (tx: Transaction) =>
      replaceProductCategories(tx, tenantId, product.id, { categoryIds: [a.id] });
    const remove = (tx: Transaction) => deleteCategory(tx, tenantId, a.id);
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
    expect(
      await app(suite.admin, tenantId, (tx) => readProductCategories(tx, tenantId, product.id)),
    ).toEqual({ categoryIds: [], primaryCategoryId: null });
  },
);

it.each(["category", "language"] as const)(
  "serializes a name/hierarchy edit against default-language changes with %s first",
  async (winner) => {
    const { tenantId, a, b } = await fixture();
    await app(suite.admin, tenantId, async (tx) => {
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en", "fr"] });
      await updateCategory(tx, tenantId, a.id, { name: { en: "A", fr: "Un" } });
      await updateCategory(tx, tenantId, b.id, { name: { en: "B", fr: "Deux" } });
    });
    const edit = (tx: Transaction) =>
      updateCategory(tx, tenantId, a.id, {
        name: { en: "Changed" },
        parentId: b.id,
      });
    const language = (tx: Transaction) =>
      writeContentLanguages(tx, tenantId, {
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
    expect(await app(suite.admin, tenantId, (tx) => readCategory(tx, tenantId, a.id))).toEqual({
      ...a,
      name: winner === "category" ? { en: "Changed" } : { en: "A", fr: "Un" },
      parentId: winner === "category" ? b.id : null,
    });
  },
);
it("stores and validates a category colour", async () => {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
  const made = await app(suite.admin, tenantId, (tx) =>
    createCategory(tx, tenantId, { name: { en: "Hot" }, color: "#b12525" }),
  );
  expect(made.color).toBe("#b12525");
  const cleared = await app(suite.admin, tenantId, (tx) =>
    updateCategory(tx, tenantId, made.id, { color: null }),
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
        descriptions: { en: "P" },
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
    replaceProductCategories(tx, tenantId, productId, {
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
    replaceProductCategories(tx, tenantId, productId, {
      categoryIds: [a.id, b.id],
      primaryCategoryId: a.id,
    }),
  );
  const saved = await app(suite.admin, tenantId, (tx) =>
    replaceProductCategories(tx, tenantId, productId, { categoryIds: [b.id] }),
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
    await replaceProductCategories(tx, tenantId, product1, {
      categoryIds: [a.id, b.id],
      primaryCategoryId: a.id,
    });
    await replaceProductCategories(tx, tenantId, product2, {
      categoryIds: [a.id],
      primaryCategoryId: a.id,
    });
    await deleteCategory(tx, tenantId, a.id);
    // A's memberships are gone; product1 keeps B but loses its A reporting category.
    expect(await readProductCategories(tx, tenantId, product1)).toEqual({
      categoryIds: [b.id],
      primaryCategoryId: null,
    });
    expect(await readProductCategories(tx, tenantId, product2)).toEqual({
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
    await deleteCategory(tx, tenantId, breakfast.id);
    expect((await readCategory(tx, tenantId, eggs.id)).parentId).toBe(food.id);
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
    await deleteCategory(tx, tenantId, breakfast.id);
    expect((await readCategory(tx, tenantId, eggs.id)).parentId).toBeNull();
  });
});
async function dependantsFixture() {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
  const otherTenantId = await seedTenant(suite.admin);
  const made = await app(suite.admin, tenantId, async (tx) => {
    const food = await createCategory(tx, tenantId, { name: { en: "Food" } });
    const x = await createCategory(tx, tenantId, { name: { en: "X" }, parentId: food.id });
    const eggs = await createCategory(tx, tenantId, { name: { en: "Eggs" }, parentId: x.id });
    const menu = await createCatalogue(tx, tenantId, { name: "Menu" });
    const p1 = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "P1" },
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    const p2 = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "P2" },
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    // p1's reporting category is X (also a member); p2 is a member of X with no reporting category.
    await replaceProductCategories(tx, tenantId, p1.id, {
      categoryIds: [x.id],
      primaryCategoryId: x.id,
    });
    await replaceProductCategories(tx, tenantId, p2.id, {
      categoryIds: [x.id],
      primaryCategoryId: null,
    });
    return { food, x, eggs, p1, p2 };
  });
  return {
    tenantId,
    otherTenantId,
    foodId: made.food.id,
    xId: made.x.id,
    eggsId: made.eggs.id,
    p1Id: made.p1.id,
    p2Id: made.p2.id,
  };
}
it("reports a category's dependants for the delete preview", async () => {
  const { tenantId, foodId, xId, eggsId, p1Id, p2Id } = await dependantsFixture();
  const deps = await app(suite.admin, tenantId, (tx) => categoryDependants(tx, tenantId, xId));
  expect(deps.parentId).toBe(foodId);
  expect(deps.children.map((c) => c.id)).toEqual([eggsId]);
  expect(deps.products.find((p) => p.id === p1Id)!.reporting).toBe(true);
  expect(deps.products.find((p) => p.id === p2Id)!.reporting).toBe(false);
});
it("dependants is tenant-scoped", async () => {
  const { otherTenantId, xId } = await dependantsFixture();
  await expect(
    app(suite.admin, otherTenantId, (tx) => categoryDependants(tx, otherTenantId, xId)),
  ).rejects.toMatchObject({ code: "category.not_found" });
});
