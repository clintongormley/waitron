import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { BATCH_SIZE } from "./batches.js";
import { createCatalogue, createProduct, updateProduct } from "./operations.js";
import { saveProductEditor, type ProductEditorInput } from "./product-editor.js";
import { storeProductNameKeys } from "./product-names.js";
import { setProductVariants, type VariantWrite } from "./variants.js";

/** Each product row stores its folded staff name, which the unique-name check looks up. */
const suite = useCatalogueDb();
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);

let menu: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  menu = (await app((tx) => createCatalogue(tx, { name: "Lunch" }))).id;
});

const make = (name: string) =>
  app((tx) =>
    createProduct(tx, {
      catalogueId: menu,
      categoryId: null,
      name,
      pricingUnit: "each",
      unitPrice: "2",
      vatClass: "general",
    }),
  ).then((created) => created.id);

const keyOf = (id: string) =>
  app(async (tx) => {
    const [row] = await tx
      .select({ nameKey: products.nameKey })
      .from(products)
      .where(eq(products.id, id));
    return row!.nameKey;
  });

const variant = (name: string, id?: string): VariantWrite => ({
  ...(id === undefined ? {} : { id }),
  name,
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: null,
  available: true,
});

describe("the stored name key", () => {
  it("is the folded name on a created product", async () => {
    expect(await keyOf(await make("  ÑOQUIS Fritos "))).toBe("ñoquis fritos");
  });

  it("follows a rename", async () => {
    const id = await make("Ñoquis");
    await app((tx) => updateProduct(tx, id, { name: "Gnocchi Verdes" }));
    expect(await keyOf(id)).toBe("gnocchi verdes");
  });

  it("is left as it was by an update that does not name the product", async () => {
    const id = await make("Ñoquis");
    await app((tx) => updateProduct(tx, id, { unitPrice: "3" }));
    expect(await keyOf(id)).toBe("ñoquis");
  });

  it("is the folded name on a created variant and follows the variant's rename", async () => {
    const parent = await make("Lemonade");
    const [small] = await app((tx) => setProductVariants(tx, parent, [variant("SMALL")], "en"));
    expect(await keyOf(small!.id)).toBe("small");
    await app((tx) => setProductVariants(tx, parent, [variant("Pequeña", small!.id)], "en"));
    expect(await keyOf(small!.id)).toBe("pequeña");
  });

  it("is written for the product and its variants by a product editor save", async () => {
    const input = {
      name: "Tortilla",
      customerName: null,
      ordering: "public",
      description: null,
      kitchenName: null,
      unitId: null,
      unitPrice: "4.00",
      active: true,
      available: true,
      vatClass: "general",
      image: null,
      variants: [{ ...variant("Media Ración"), active: true }],
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: [],
      color: null,
    } satisfies ProductEditorInput;
    const saved = await app((tx) => saveProductEditor(tx, null, menu, input, "en"));
    expect(await keyOf(saved.id)).toBe("tortilla");
    expect(await keyOf(saved.variants[0]!.id)).toBe("media ración");
  });

  it("is re-folded for every product and variant by storeProductNameKeys, whatever it held", async () => {
    const parent = await make("Lemonade");
    const [small] = await app((tx) => setProductVariants(tx, parent, [variant("SMALL")], "en"));
    const other = await make("Ñoquis");
    await app((tx) => tx.update(products).set({ nameKey: null }).where(eq(products.id, parent)));
    await app((tx) => tx.update(products).set({ nameKey: "wrong" }).where(eq(products.id, other)));
    await app(storeProductNameKeys);
    expect([await keyOf(parent), await keyOf(small!.id), await keyOf(other)]).toEqual([
      "lemonade",
      "small",
      "ñoquis",
    ]);
  });

  it("is re-folded by storeProductNameKeys on rows past the first batch", async () => {
    const template = await make("Plantilla");
    const count = BATCH_SIZE + 1;
    const { rows: info } = await suite.db.execute<{ name: string }>(
      sql`pragma table_info(products)`,
    );
    const columns = info.map((row) => row.name);
    const picked = columns.map((column) =>
      column === "id"
        ? sql`'bulk-' || substr('000000' || n, -6)`
        : column === "name"
          ? sql`'ÑOQUI ' || n`
          : column === "name_key"
            ? sql`null`
            : sql.identifier(column),
    );
    await suite.db.execute(sql`
      insert into products (${sql.join(
        columns.map((column) => sql.identifier(column)),
        sql`, `,
      )})
      with recursive seq(n) as (select 1 union all select n + 1 from seq where n < ${count})
      select ${sql.join(picked, sql`, `)} from seq, products where products.id = ${template}`);
    await app(storeProductNameKeys);
    const stored = await app((tx) =>
      tx.select({ name: products.name, nameKey: products.nameKey }).from(products),
    );
    const wrong = stored.filter(
      (row) =>
        row.nameKey !==
        (row.name === "Plantilla" ? "plantilla" : row.name.replace("ÑOQUI", "ñoqui")),
    );
    expect(stored).toHaveLength(count + 1);
    expect(wrong).toEqual([]);
  });
});

describe("the clash lookup", () => {
  it("finds a clash that differs only in a non-ASCII letter's case", async () => {
    await make("Ñoquis");
    await expect(make("ñoquis")).rejects.toMatchObject({
      code: "product.name_taken",
      params: { field: "name", name: "ñoquis" },
    });
  });

  it("does not match a row whose stored key is NULL: rows saved before the key existed are not backfilled", async () => {
    const old = await make("Gazpacho");
    await app((tx) => tx.update(products).set({ nameKey: null }).where(eq(products.id, old)));
    await make("gazpacho");
  });
});
