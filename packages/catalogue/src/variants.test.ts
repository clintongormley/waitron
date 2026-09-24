import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  createCatalogue,
  createProduct,
  createMenuItem,
  createMenuSection,
  listMenuOffers,
  listProducts,
} from "./operations.js";
import {
  listProductVariants,
  setProductVariants,
  variantsOfProducts,
  listMenuVariants,
  setMenuVariants,
  parentsWithActiveVariants,
} from "./variants.js";
import { createUnit } from "./units.js";
import { useCatalogueDb } from "../test/fixtures.js";

// Aggregate round-trips. The cases with two transactions started together are in
// variants.db.test.ts.
const fx = useCatalogueDb();
let productId: string;
let offerId: string;
let menuId: string;
const variant = (name: string, unitPrice: string) => ({
  name,
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice,
  available: true,
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

beforeEach(async () => {
  await seedTenant(fx.db);
  await run(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    menuId = menu.id;
    const unit = await createUnit(
      tx,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    );
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      unitId: unit.id,
      unitPrice: "9.00",
      vatClass: "reduced",
    });
    productId = product.id;
    const section = await createMenuSection(tx, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    offerId = (
      await createMenuItem(tx, {
        menuId: menu.id,
        sectionId: section.id,
        productId,
        grossPrice: "8.00",
      })
    ).id;
  });
});

describe("product variants", () => {
  it("round-trips ordered translated names, stable identities, absolute prices and availability", async () => {
    const saved = await run((tx) =>
      setProductVariants(
        tx,
        productId,
        [
          { ...variant("Small", "2.00"), customerName: { en: "Small", es: "Pequeño" } },
          variant("Large", "3.00"),
        ],
        "en",
      ),
    );
    expect(
      saved.map(({ name, customerName, unitPrice, available }) => ({
        name,
        customerName,
        unitPrice,
        available,
      })),
    ).toEqual([
      {
        name: "Small",
        customerName: { en: "Small", es: "Pequeño" },
        unitPrice: "2.00",
        available: true,
      },
      { name: "Large", customerName: null, unitPrice: "3.00", available: true },
    ]);
    expect(new Set(saved.map((v) => v.id)).size).toBe(2);
    const updated = await run((tx) =>
      setProductVariants(
        tx,
        productId,
        [
          { ...saved[1]!, available: false },
          { ...saved[0]!, unitPrice: "2.50" },
        ],
        "en",
      ),
    );
    expect(updated.map((v) => v.id)).toEqual([saved[1]!.id, saved[0]!.id]);
    expect(await run((tx) => listProductVariants(tx, productId))).toEqual(updated);
    expect(updated[0]!.available).toBe(false);
  });

  it.each(["-1.00", "1.001", "10000000000.00", "NaN", "", "1e2"])(
    "rejects invalid price %j without a partial save",
    async (unitPrice) => {
      await expect(
        run((tx) =>
          setProductVariants(
            tx,
            productId,
            [variant("Good", "2.00"), variant("Bad", unitPrice)],
            "en",
          ),
        ),
      ).rejects.toMatchObject({ code: "product.variant_invalid" });
      expect(await run((tx) => listProductVariants(tx, productId))).toEqual([]);
    },
  );

  it("rejects duplicate and foreign variant identities", async () => {
    const [saved] = await run((tx) =>
      setProductVariants(tx, productId, [variant("Small", "2.00")], "en"),
    );
    await expect(
      run((tx) => setProductVariants(tx, productId, [saved!, saved!], "en")),
    ).rejects.toMatchObject({ code: "product.variant_invalid" });
    await expect(
      run((tx) =>
        setProductVariants(tx, productId, [{ ...saved!, id: crypto.randomUUID() }], "en"),
      ),
    ).rejects.toMatchObject({ code: "product.variant_not_found" });
  });

  it("requires the default language in a variant's customer name when one is given", async () => {
    await expect(
      run((tx) =>
        setProductVariants(
          tx,
          productId,
          [{ ...variant("Small", "2.00"), customerName: { es: "Pequeño" } }],
          "en",
        ),
      ),
    ).rejects.toMatchObject({ code: "content.translation_required" });
  });

  it("offers new variants at once and keeps a menu price independent of the variant's own", async () => {
    const variants = await run((tx) =>
      setProductVariants(tx, productId, [variant("Small", "2.00"), variant("Large", "3.00")], "en"),
    );
    expect(await run((tx) => listMenuVariants(tx, offerId))).toEqual([
      { variantId: variants[0]!.id, price: null, offered: true },
      { variantId: variants[1]!.id, price: null, offered: true },
    ]);
    await run((tx) =>
      setMenuVariants(tx, offerId, [{ variantId: variants[0]!.id, price: "4.00", offered: true }]),
    );
    await run((tx) =>
      setProductVariants(
        tx,
        productId,
        [{ ...variants[0]!, unitPrice: "2.50" }, variants[1]!],
        "en",
      ),
    );
    const overrides = await run((tx) => listMenuVariants(tx, offerId));
    expect(overrides).toEqual([
      { variantId: variants[0]!.id, price: "4.00", offered: true },
      { variantId: variants[1]!.id, price: null, offered: true },
    ]);
    expect((await run((tx) => listProducts(tx)))[0]!.variants).toEqual([
      expect.objectContaining({ id: variants[0]!.id, name: "Small", unitPrice: "2.50" }),
      expect.objectContaining({ id: variants[1]!.id, name: "Large", unitPrice: "3.00" }),
    ]);
    expect(await run((tx) => listMenuOffers(tx, []))).toEqual([]);
    const offers = await run((tx) => listMenuOffers(tx, [menuId]));
    expect(
      offers[0]!.variants.map(
        ({ id, name, customerName, kitchenName, image, unitPrice, available }) => ({
          id,
          name,
          customerName,
          kitchenName,
          image,
          unitPrice,
          available,
        }),
      ),
    ).toEqual([
      {
        id: variants[0]!.id,
        name: "Small",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "4.00",
        available: true,
      },
      {
        id: variants[1]!.id,
        name: "Large",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.00",
        available: true,
      },
    ]);
    await run((tx) =>
      setProductVariants(
        tx,
        productId,
        [{ ...variants[0]!, unitPrice: "2.50", available: false }, variants[1]!],
        "en",
      ),
    );
    expect((await run((tx) => listMenuOffers(tx, [menuId])))[0]!.variants).toEqual([
      expect.objectContaining({ id: variants[0]!.id, available: false }),
      expect.objectContaining({ id: variants[1]!.id, available: true }),
    ]);
    // Removing a variant a menu overrides is allowed (spec §15.6): it becomes Inactive.
    await run((tx) => setProductVariants(tx, productId, [variants[1]!], "en"));
    expect(
      (await run((tx) => listProductVariants(tx, productId))).map(({ id, active }) => ({
        id,
        active,
      })),
    ).toEqual([
      { id: variants[1]!.id, active: true },
      { id: variants[0]!.id, active: false },
    ]);
  });

  it("refuses to override a variant belonging to another product and stores no override", async () => {
    const [foreign] = await run(async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "plate" }, precision: 0, abbreviation: { en: "pl" } },
        "en",
      );
      const other = await createProduct(tx, {
        catalogueId: menuId,
        categoryId: null,
        name: "Bravas",
        unitId: unit.id,
        unitPrice: "6.00",
        vatClass: "reduced",
      });
      return setProductVariants(tx, other.id, [variant("Half portion", "4.00")], "en");
    });
    const [own] = await run((tx) =>
      setProductVariants(tx, productId, [variant("Small", "2.00")], "en"),
    );
    await expect(
      run((tx) =>
        setMenuVariants(tx, offerId, [
          { variantId: own!.id, price: "4.00", offered: true },
          { variantId: foreign!.id, price: "5.00", offered: true },
        ]),
      ),
    ).rejects.toMatchObject({
      code: "product.variant_not_found",
      params: { variantId: foreign!.id },
    });
    expect(await run((tx) => listMenuVariants(tx, offerId))).toEqual([
      { variantId: own!.id, price: null, offered: true },
    ]);
  });
});

describe("which products have an Active variant", () => {
  it("names a parent with an Active variant, Available or not, and none whose variants are all Inactive", async () => {
    const other = await run(async (tx) => {
      const [product] = await listProducts(tx);
      const make = (name: string) =>
        createProduct(tx, {
          catalogueId: menuId,
          categoryId: null,
          name,
          unitId: product!.unitId,
          unitPrice: "5.00",
          vatClass: "general",
        });
      return {
        unavailable: await make("Tea"),
        inactive: await make("Juice"),
        none: await make("Soda"),
      };
    });
    await run(async (tx) => {
      await setProductVariants(tx, productId, [variant("Small", "2.00")], "en");
      await setProductVariants(
        tx,
        other.unavailable.id,
        [{ ...variant("Green", "2.00"), available: false }],
        "en",
      );
      await setProductVariants(
        tx,
        other.inactive.id,
        [{ ...variant("Orange", "2.00"), active: false }],
        "en",
      );
    });

    const found = await run((tx) =>
      parentsWithActiveVariants(tx, [
        productId,
        productId,
        other.unavailable.id,
        other.inactive.id,
        other.none.id,
      ]),
    );
    expect([...found].sort()).toEqual([productId, other.unavailable.id].sort());
  });

  it("asks the database nothing for an empty product list", async () => {
    const refuses = {
      selectDistinct: () => {
        throw new Error("parentsWithActiveVariants queried the database for no products");
      },
    } as unknown as Transaction;

    expect(await parentsWithActiveVariants(refuses, [])).toEqual(new Set());
  });
});

describe("reading the variants of no products", () => {
  it("asks the database nothing for an empty product list", async () => {
    // A stub whose `select` throws pins "no query at all": a query against the real connection
    // would also answer an empty map.
    const refuses = {
      select: () => {
        throw new Error("variantsOfProducts queried the database for no products");
      },
    } as unknown as Transaction;

    expect(await variantsOfProducts(refuses, [])).toEqual(new Map());
  });
});
