import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { stringToThousandths } from "@waitron/shared";
import {
  catalogues,
  CORE_MIGRATIONS,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getSellableUnit,
  getUnit,
  listUnits,
  productsUsingUnit,
  reassignProductsToUnit,
  updateUnit,
} from "./units.js";
import { assertQuantityPrecision } from "./units.js";
import { contentLanguages } from "./schema/menu.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

/**
 * Both rows go through their drizzle tables: `catalogues.id` and `products.id` come from each
 * table's own `$defaultFn` rather than from a SQL default.
 */
async function product(tx: Transaction, name: string) {
  const [menu] = await tx
    .insert(catalogues)
    .values({ name: "Menu" })
    .returning({ id: catalogues.id });
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: menu!.id,
      name,
      pricingUnit: "each",
      unitPrice: 1,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
}

/** A refusal's code and params exactly, so a key the refusal should not carry fails the case. */
async function refusalOf(write: Promise<unknown>): Promise<{ code: unknown; params: unknown }> {
  const error = (await write.then(
    () => expect.fail("the write was not refused"),
    (caught: unknown) => caught,
  )) as { code: unknown; params: unknown };
  return { code: error.code, params: error.params };
}

describe("unit operations", () => {
  it.each<[string, Record<string, string>]>([
    ["an empty", { en: "" }],
    ["a missing", {}],
  ])(
    "retains staff identity when %s abbreviation translation is supplied",
    async (_, abbreviation) => {
      const saved = await run((tx) =>
        createUnit(
          tx,
          {
            staffName: "Staff unit",
            staffAbbreviation: "su",
            name: { en: "Litre" },
            precision: 3,
            abbreviation,
          },
          "en",
        ),
      );
      expect(saved).toEqual({
        id: expect.any(String),
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "Litre" },
        precision: 3,
        abbreviation: {},
      });
      expect(await run((tx) => getUnit(tx, saved.id))).toEqual(saved);
    },
  );

  it("accepts a missing default name with either a translated or an empty abbreviation", async () => {
    await suite.db
      .insert(contentLanguages)
      .values({ defaultLanguage: "en", languages: ["en", "es"] });
    for (const abbreviation of [{ en: "l" }, {}] as Record<string, string>[]) {
      const saved = await run((tx) =>
        createUnit(
          tx,
          {
            staffName: "Staff unit",
            staffAbbreviation: "su",
            name: { es: "Litro" },
            precision: 3,
            abbreviation,
          },
          "en",
        ),
      );
      expect(saved).toEqual({
        id: expect.any(String),
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { es: "Litro" },
        precision: 3,
        abbreviation,
      });
      expect(await run((tx) => getUnit(tx, saved.id))).toEqual(saved);
    }
  });

  it("clears only the abbreviation when an update supplies an empty map", async () => {
    const unit = await run((tx) =>
      createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "Litre" },
          precision: 3,
          abbreviation: { en: "l" },
        },
        "en",
      ),
    );
    const saved = await run((tx) => updateUnit(tx, unit.id, { abbreviation: {} }, "en"));
    expect(saved).toEqual({ ...unit, abbreviation: {} });
    expect(await run((tx) => getUnit(tx, unit.id))).toEqual(saved);
  });

  it("reads content languages only for an update that merges stored translations", async () => {
    await run(async (tx) => {
      const reads = vi.spyOn(tx, "select");
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "Litre" },
          precision: 3,
          abbreviation: { en: "l" },
        },
        "en",
      );
      expect(reads).toHaveBeenCalledTimes(0);
      reads.mockClear();
      await updateUnit(tx, unit.id, { name: { en: "Liter" }, abbreviation: { en: "L" } }, "en");
      expect(reads).toHaveBeenCalledTimes(1);
    });
  });

  it("stores and returns the abbreviation", async () => {
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "Litre" },
          precision: 3,
          abbreviation: { en: "l" },
        },
        "en",
      );
      expect(unit.abbreviation).toEqual({ en: "l" });
      const [listed] = await listUnits(tx);
      expect(listed!.abbreviation).toEqual({ en: "l" });
    });
  });

  it("updates and clears the translated abbreviation without clearing staff identity", async () => {
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "Litre" },
          precision: 3,
          abbreviation: { en: "l" },
        },
        "en",
      );
      const updated = await updateUnit(tx, unit.id, { abbreviation: { en: "L" } }, "en");
      expect(updated.abbreviation).toEqual({ en: "L" });
      expect(await updateUnit(tx, unit.id, { abbreviation: {} }, "en")).toEqual({
        ...unit,
        abbreviation: {},
      });
    });
  });

  it("creates, reads, updates, assigns and deletes within a tenant", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "portion" },
          precision: 2,
          abbreviation: { en: "u" },
        },
        "en",
      );
      expect(await getUnit(tx, unit.id)).toEqual(unit);
      expect(await listUnits(tx)).toEqual([unit]);
      await updateUnit(
        tx,
        unit.id,
        { staffName: "Staff unit", staffAbbreviation: "su", name: { en: "serving" }, precision: 1 },
        "en",
      );
      expect(await getUnit(tx, unit.id)).toMatchObject({
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "serving" },
        precision: 1,
      });

      const productId = await product(tx, "Soup");
      await assignProductUnit(tx, productId, unit.id);
      await tx.execute(sql`
        update products set active = false where id = ${productId}`);
      expect(await refusalOf(deleteUnit(tx, unit.id))).toEqual({
        code: "unit.in_use",
        params: { products: [{ id: productId, name: "Soup", active: false }] },
      });
    });
  });

  it("lists the products using a unit, with each product's Active flag", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "portion" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      );
      expect(await productsUsingUnit(tx, unit.id)).toEqual([]);

      const soup = await product(tx, "Soup");
      const tea = await product(tx, "Tea");
      await assignProductUnit(tx, soup, unit.id);
      await assignProductUnit(tx, tea, unit.id);
      await tx.execute(sql`
        update products set active = false where id = ${tea}`);

      const using = await productsUsingUnit(tx, unit.id);
      expect(using).toHaveLength(2);
      expect(using).toEqual(
        expect.arrayContaining([
          { id: soup, name: "Soup", active: true },
          { id: tea, name: "Tea", active: false },
        ]),
      );
    });
  });

  it("reassigns products from one unit to another", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "each" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      );
      const to = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "kg" },
          precision: 3,
          abbreviation: { en: "u" },
        },
        "en",
      );
      const a = await product(tx, "A");
      const b = await product(tx, "B");
      await assignProductUnit(tx, a, from.id);
      await assignProductUnit(tx, b, from.id);
      expect(await productsUsingUnit(tx, from.id)).toHaveLength(2);

      await reassignProductsToUnit(tx, from.id, [a, b], to.id);
      expect(await productsUsingUnit(tx, from.id)).toEqual([]);
      expect((await productsUsingUnit(tx, to.id)).map((p) => p.id).sort()).toEqual([a, b].sort());
    });
  });

  it("skips an unknown product id instead of failing the reassignment", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "each" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      );
      const to = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "kg" },
          precision: 3,
          abbreviation: { en: "u" },
        },
        "en",
      );
      const a = await product(tx, "A");
      await assignProductUnit(tx, a, from.id);

      await expect(
        reassignProductsToUnit(tx, from.id, [a, "00000000-0000-4000-8000-0000000000aa"], to.id),
      ).resolves.toBeUndefined();

      // The valid id moved; the unmatched id neither stopped it nor was itself touched.
      expect(await productsUsingUnit(tx, from.id)).toEqual([]);
      expect((await productsUsingUnit(tx, to.id)).map((p) => p.id)).toEqual([a]);
    });
  });

  it("refuses to reassign to a unit that does not exist", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "each" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      );
      const a = await product(tx, "A");
      await assignProductUnit(tx, a, from.id);
      await expect(
        reassignProductsToUnit(tx, from.id, [a], "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "unit.not_found" });
    });
  });

  it("rejects excess precision before anything downstream can round it", async () => {
    // The database never rounds a quantity; `decimalToThousandths` owns the third place.
    // Receipt: docs/developers/conventions-data.md.
    expect(stringToThousandths("1.2345")).toBe(1235);
    expect(() => assertQuantityPrecision("1.2345", 3, { positive: true })).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "precision" } }),
    );
  });

  it("starts a new unit as no measure unless the create asks for one", async () => {
    const plain = await run((tx) =>
      createUnit(
        tx,
        {
          staffName: "portion",
          staffAbbreviation: "u",
          name: { en: "portion" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      ),
    );
    expect(plain).not.toHaveProperty("measure");
    expect(await run((tx) => getUnit(tx, plain.id))).not.toHaveProperty("measure");

    const measured = await run((tx) =>
      createUnit(
        tx,
        {
          staffName: "Centilitre",
          staffAbbreviation: "cl",
          name: { en: "Centilitre" },
          precision: 0,
          abbreviation: { en: "cl" },
          measure: true,
        },
        "en",
      ),
    );
    expect(measured).toMatchObject({ id: measured.id, measure: true });
    expect(await run((tx) => getUnit(tx, measured.id))).toEqual(measured);
    expect((await run((tx) => listUnits(tx))).find((u) => u.id === measured.id)).toEqual(measured);
    expect((await run((tx) => listUnits(tx))).find((u) => u.id === plain.id)).toEqual(plain);
  });

  it("turns the measure switch on and off by itself", async () => {
    const unit = await run((tx) =>
      createUnit(
        tx,
        {
          staffName: "portion",
          staffAbbreviation: "u",
          name: { en: "portion" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      ),
    );

    const on = await run((tx) => updateUnit(tx, unit.id, { measure: true }, "en"));
    expect(on).toEqual({ ...unit, measure: true });
    expect(await run((tx) => getUnit(tx, unit.id))).toEqual({ ...unit, measure: true });

    const off = await run((tx) => updateUnit(tx, unit.id, { measure: false }, "en"));
    expect(off).toEqual(unit);
    expect(off).not.toHaveProperty("measure");
    expect(await run((tx) => getUnit(tx, unit.id))).toEqual(unit);
  });
});

describe("what a unit operation refuses for an id that names nothing", () => {
  const MISSING = "00000000-0000-4000-8000-0000000000bb";

  it("refuses to read, sell by, update or delete a unit no row holds", async () => {
    const attempts: ((tx: Transaction) => Promise<unknown>)[] = [
      (tx) => getUnit(tx, MISSING),
      (tx) => getSellableUnit(tx, MISSING),
      (tx) => updateUnit(tx, MISSING, { precision: 1 }, "en"),
      (tx) => updateUnit(tx, MISSING, {}, "en"),
      (tx) => deleteUnit(tx, MISSING),
    ];
    for (const attempt of attempts) {
      await expect(run(attempt)).rejects.toMatchObject({
        code: "unit.not_found",
        params: { unitId: MISSING },
      });
    }
  });

  it("refuses to assign a unit to a product no row holds", async () => {
    await seedTenant(suite.db);
    const unit = await run((tx) =>
      createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "portion" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      ),
    );

    await expect(run((tx) => assignProductUnit(tx, MISSING, unit.id))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: MISSING },
    });

    expect(await run((tx) => productsUsingUnit(tx, unit.id))).toEqual([]);
  });

  it("answers an empty patch with the unit as stored, changing nothing", async () => {
    const unit = await run((tx) =>
      createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "portion" },
          precision: 2,
          abbreviation: { en: "u" },
        },
        "en",
      ),
    );

    expect(await run((tx) => updateUnit(tx, unit.id, {}, "en"))).toEqual(unit);

    expect(await run((tx) => getUnit(tx, unit.id))).toEqual(unit);
  });
});
