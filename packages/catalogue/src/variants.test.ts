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
  updateProduct,
} from "./operations.js";
import {
  listProductVariants,
  setProductVariants,
  listMenuVariants,
  setMenuVariants,
  resolveMenuVariant,
} from "./variants.js";
import { priceBasketWithOptions } from "./pricing.js";
import { customerPresentationText } from "./product-presentation.js";
import { createUnit } from "./units.js";
import { useCatalogueDb } from "../test/fixtures.js";

// Aggregate round-trips. The two transactions started together, and the cases that used to sit in
// a real-PostgreSQL sibling, are in variants.db.test.ts.
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

it("prices a required variant at its menu price, falling back to its own", async () => {
  const [small] = await run((tx) =>
    setProductVariants(tx, productId, [variant("Small", "2.00")], "en"),
  );
  await expect(run((tx) => resolveMenuVariant(tx, offerId, null))).rejects.toMatchObject({
    code: "product.variant_required",
  });
  // A variant follows its parent onto the menu (spec §15.5), at its own price until the menu
  // sets one.
  expect(await run((tx) => resolveMenuVariant(tx, offerId, small!.id))).toMatchObject({
    variantId: small!.id,
    unitPrice: "2.00",
  });
  await run((tx) =>
    setMenuVariants(tx, offerId, [{ variantId: small!.id, price: "4.00", offered: true }]),
  );
  const selected = await run((tx) => resolveMenuVariant(tx, offerId, small!.id));
  expect(selected).toEqual({
    variantId: small!.id,
    name: "Coffee",
    customerName: null,
    kitchenName: null,
    variantName: "Small",
    variantCustomerName: null,
    variantKitchenName: null,
    unitPrice: "4.00",
  });
  // The selection is resolved into the priceable through `product-presentation.ts` — the one home
  // for the blank-falls-back-to-the-staff-name rule — rather than a name written out by hand here.
  const customer = customerPresentationText(selected, "en");
  const priced = priceBasketWithOptions([
    {
      product: {
        name: selected.name,
        descriptions: customer.product,
        variantId: selected.variantId,
        variantName: selected.variantName,
        variantDescriptions: customer.variant,
        variantKitchenName: selected.variantKitchenName,
        kitchenName: selected.kitchenName,
        unit: { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } },
        unitPrice: selected.unitPrice,
        vatClass: "reduced",
        category: null,
      },
      quantity: "2",
      options: [
        {
          name: "Milk",
          descriptions: { en: "Milk" },
          priceDelta: "1.00",
          vatClass: null,
          quantity: 1,
        },
      ],
    },
  ]);
  expect(priced.total).toBe("10.00");
  // Neither variant carries customer text, so both fall back to the staff names.
  expect(priced.lines[0]).toMatchObject({
    name: "Coffee",
    descriptions: { en: "Coffee" },
    variantName: "Small",
    variantDescriptions: { en: "Small" },
  });
  await run((tx) =>
    updateProduct(tx, productId, {
      name: "Renamed",
      unitPrice: "99.00",
      active: false,
    }),
  );
  expect(selected.name).toBe("Coffee");
  expect(selected.unitPrice).toBe("4.00");
  await expect(run((tx) => resolveMenuVariant(tx, offerId, small!.id))).rejects.toMatchObject({
    code: "product.unavailable",
  });
});

it("refuses a variant of a product that is Active but Unavailable", async () => {
  await run((tx) => updateProduct(tx, productId, { available: false }));

  await expect(run((tx) => resolveMenuVariant(tx, offerId, null))).rejects.toMatchObject({
    code: "product.unavailable",
  });
});
