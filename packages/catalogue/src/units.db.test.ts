import { inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { catalogues, CORE_MIGRATIONS, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getUnit,
  listUnits,
  productsUsingUnit,
  reassignProductsToUnit,
  updateUnit,
} from "./units.js";
import { racePair, storedUnitId } from "../test/fixtures.js";

/**
 * Units against a real database: rollback, two transactions started together, and the bulk
 * reassignment's scoping.
 *
 * This replaces a real-PostgreSQL suite that took pooled connections and watched
 * `pg_blocking_pids`. `racePair` (`test/fixtures.ts`) carries what observes serialisation now, and
 * the measurement behind it.
 *
 * WHAT WENT, and why: "changes a product's unit even while product_units is in a publication"
 * created a PostgreSQL logical-replication PUBLICATION over `product_units` and proved the table's
 * primary key doubled as its REPLICA IDENTITY, without which the reassignment upsert's UPDATE was
 * refused. SQLite has no publications and no replica identity, so there is no statement to make and
 * no refusal to provoke. Nothing else covers it, and nothing can.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

const app = <T>(action: (tx: Parameters<typeof getUnit>[0]) => Promise<T>) =>
  withTransaction(suite.db, action);

/**
 * One product on its own catalogue. Both rows go through their drizzle tables, because `id`,
 * `created_at` and `updated_at` come from each table's `$defaultFn` rather than from a SQL default
 * — a raw insert naming the other columns is refused `NOT NULL constraint failed: catalogues.id`.
 * `id` is supplied only where a test needs the rows' key order to be predictable.
 */
async function product(id: string | null = null): Promise<string> {
  const [menu] = await suite.db
    .insert(catalogues)
    .values({ name: "Menu" })
    .returning({ id: catalogues.id });
  const [row] = await suite.db
    .insert(products)
    .values({
      ...(id === null ? {} : { id }),
      catalogueId: menu!.id,
      name: "Soup",
      pricingUnit: "each",
      unitPrice: 1,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
}

it("rolls back unit creation and editing with the caller's transaction", async () => {
  await seedTenant(suite.db);
  await expect(
    app(async (tx) => {
      await createUnit(
        tx,
        { name: { en: "crate" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      throw new Error("rollback create");
    }),
  ).rejects.toThrow("rollback create");
  expect(await app((tx) => listUnits(tx))).toEqual([]);

  const unit = await app((tx) =>
    createUnit(tx, { name: { en: "box" }, precision: 0, abbreviation: { en: "u" } }, "en"),
  );
  await expect(
    app(async (tx) => {
      await updateUnit(tx, unit.id, { name: { en: "carton" } }, "en");
      throw new Error("rollback edit");
    }),
  ).rejects.toThrow("rollback edit");
  expect(await app((tx) => getUnit(tx, unit.id))).toMatchObject({ name: { en: "box" } });
});

it("serializes assignment against deletion so the committed product reference wins", async () => {
  await seedTenant(suite.db);
  const productId = await product();
  const unit = await app((tx) =>
    createUnit(tx, { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } }, "en"),
  );

  const [assignedResult, deletedResult] = await racePair(
    suite.db,
    (tx) => assignProductUnit(tx, productId, unit.id),
    (tx) => deleteUnit(tx, unit.id),
  );

  expect(assignedResult.status).toBe("fulfilled");
  expect(deletedResult.status).toBe("rejected");
  if (deletedResult.status === "rejected")
    expect(deletedResult.reason).toMatchObject({ code: "unit.in_use" });
  await expect(app((tx) => getUnit(tx, unit.id))).resolves.toBeDefined();
});

it("reports unit.not_found when deletion commits before a concurrent assignment", async () => {
  await seedTenant(suite.db);
  const productId = await product();
  const unit = await app((tx) =>
    createUnit(tx, { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } }, "en"),
  );

  const [deletedResult, assignedResult] = await racePair(
    suite.db,
    (tx) => deleteUnit(tx, unit.id),
    (tx) => assignProductUnit(tx, productId, unit.id),
  );

  expect(deletedResult.status).toBe("fulfilled");
  expect(assignedResult.status).toBe("rejected");
  if (assignedResult.status === "rejected")
    expect(assignedResult.reason).toMatchObject({ code: "unit.not_found" });
  expect(await app((tx) => productsUsingUnit(tx, unit.id))).toHaveLength(0);
});

// The contract: a bulk reassignment moves only the products STILL on the source unit when it
// writes, so a selection made stale by another manager's move is skipped, never overwritten.
it("skips a product another manager moved off the source unit while the selection was stale", async () => {
  await seedTenant(suite.db);
  const productId = await product();
  const [source, other, target] = await app(async (tx) => [
    await createUnit(tx, { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } }, "en"),
    await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
    await createUnit(tx, { name: { en: "litre" }, precision: 2, abbreviation: { en: "u" } }, "en"),
  ]);
  await app((tx) => assignProductUnit(tx, productId, source!.id));

  // **WHERE THE STALENESS COMES FROM CHANGED; WHAT IS ASSERTED DID NOT.** On PostgreSQL the read
  // and the write sat in ONE transaction and the other manager's move landed between them. One
  // write transaction runs on the venue file at a time, so nothing can land inside another's body;
  // the stale selection is the one a manager is actually holding — read in an earlier request,
  // acted on in a later one, with the move committed in between.
  await app((tx) => getUnit(tx, source!.id));
  await app((tx) => assignProductUnit(tx, productId, other!.id));
  await app((tx) => reassignProductsToUnit(tx, source!.id, [productId], target!.id));

  expect(await app((tx) => storedUnitId(tx, productId))).toBe(other!.id);
});

it("two bulk reassignments listing the same products in opposite orders both complete", async () => {
  await seedTenant(suite.db);
  // Fixed ids, inserted in this order, so the row reached first is the same under a table scan
  // (insertion order) and under an index scan (id order).
  const first = await product("11111111-1111-4111-8111-111111111111");
  const second = await product("22222222-2222-4222-8222-222222222222");
  const [source, target] = await app(async (tx) => [
    await createUnit(tx, { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } }, "en"),
    await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  ]);
  await app(async (tx) => {
    await assignProductUnit(tx, first, source!.id);
    await assignProductUnit(tx, second, source!.id);
  });

  // The DEADLOCK this case was named for — two transactions taking the same two rows in opposite
  // order and each ending up waiting on the other — is not a shape one writer can produce, and the
  // `40P01` the old assertion spelled out has no counterpart. What is left, and what the two
  // assertions below always also said, is that both reassignments complete and both products end
  // on the target.
  const results = await racePair(
    suite.db,
    (tx) => reassignProductsToUnit(tx, source!.id, [first, second], target!.id),
    (tx) => reassignProductsToUnit(tx, source!.id, [second, first], target!.id),
  );
  expect(
    results.map((outcome) => (outcome.status === "fulfilled" ? "ok" : outcome.reason)),
  ).toEqual(["ok", "ok"]);

  expect(await app((tx) => storedUnitId(tx, first))).toBe(target!.id);
  expect(await app((tx) => storedUnitId(tx, second))).toBe(target!.id);
});

it("reassigning to null clears the products' unit (they become Each)", async () => {
  await seedTenant(suite.db);
  const p1 = await product();
  const p2 = await product();
  const sourceUnit = await app((tx) =>
    createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  await app(async (tx) => {
    await assignProductUnit(tx, p1, sourceUnit.id);
    await assignProductUnit(tx, p2, sourceUnit.id);
  });

  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [p1, p2], null));

  expect(await app((tx) => productsUsingUnit(tx, sourceUnit.id))).toHaveLength(0);
  expect(await app((tx) => storedUnitId(tx, p1))).toBeNull();
});

it("reassigning to null returns the products to each-priced and leaves products on other units alone", async () => {
  await seedTenant(suite.db);
  const onSource = await product();
  const onOther = await product();
  const sourceUnit = await app((tx) =>
    createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  const otherUnit = await app((tx) =>
    createUnit(tx, { name: { en: "litre" }, precision: 2, abbreviation: { en: "u" } }, "en"),
  );
  // Put both products in the real "sold by weight" state: a unit row plus pricing_unit = 'weight'.
  await app(async (tx) => {
    await assignProductUnit(tx, onSource, sourceUnit.id);
    await assignProductUnit(tx, onOther, otherUnit.id);
  });
  await suite.db
    .update(products)
    .set({ pricingUnit: "weight" })
    .where(inArray(products.id, [onSource, onOther]));

  // onOther is in the list but on a different unit, so it stands in for a product already moved
  // elsewhere: scoped by the source unit, it must be skipped by both the delete and the update.
  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [onSource, onOther], null));

  const pricing = await suite.db
    .select({ id: products.id, pricingUnit: products.pricingUnit })
    .from(products)
    .where(inArray(products.id, [onSource, onOther]));
  const pricingById = Object.fromEntries(pricing.map((row) => [row.id, row.pricingUnit]));
  // The reassigned product loses its unit row AND returns to each-priced (the no-unit ⟺ each invariant).
  expect(await app((tx) => storedUnitId(tx, onSource))).toBeNull();
  expect(pricingById[onSource]).toBe("each");
  // The product on another unit keeps both its unit row and its weight pricing.
  expect(await app((tx) => storedUnitId(tx, onOther))).toBe(otherUnit.id);
  expect(pricingById[onOther]).toBe("weight");
});
