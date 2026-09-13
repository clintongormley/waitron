import { beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { TenantId } from "@waitron/shared";
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
import { createUnit } from "./units.js";
import { useCatalogueDb } from "../test/fixtures.js";

// PGlite exercises aggregate round-trips; role privileges and races use the PostgreSQL suite.
const fx = useCatalogueDb();
let tenantId: TenantId;
let productId: string;
let offerId: string;
let menuId: string;
const variant = (name: string, unitPrice: string) => ({
  name: { en: name },
  unitPrice,
  available: true,
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTenant(fx.db, tenantId, fn);

beforeEach(async () => {
  tenantId = await seedTenant(fx.db);
  await run(async (tx) => {
    const menu = await createCatalogue(tx, tenantId, { name: "Bar" });
    menuId = menu.id;
    const unit = await createUnit(tx, tenantId, { name: { en: "each" }, precision: 0 }, "en");
    const product = await createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "Coffee" },
      unitId: unit.id,
      unitPrice: "9.00",
      vatClass: "reduced",
    });
    productId = product.id;
    const section = await createMenuSection(tx, tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    offerId = (
      await createMenuItem(tx, tenantId, {
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
        tenantId,
        productId,
        [
          { ...variant("Small", "2.00"), name: { en: "Small", es: "Pequeño" } },
          variant("Large", "3.00"),
        ],
        "en",
      ),
    );
    expect(saved.map(({ name, unitPrice, available }) => ({ name, unitPrice, available }))).toEqual(
      [
        { name: { en: "Small", es: "Pequeño" }, unitPrice: "2.00", available: true },
        { name: { en: "Large" }, unitPrice: "3.00", available: true },
      ],
    );
    expect(new Set(saved.map((v) => v.id)).size).toBe(2);
    const updated = await run((tx) =>
      setProductVariants(
        tx,
        tenantId,
        productId,
        [
          { ...saved[1]!, available: false },
          { ...saved[0]!, unitPrice: "2.50" },
        ],
        "en",
      ),
    );
    expect(updated.map((v) => v.id)).toEqual([saved[1]!.id, saved[0]!.id]);
    expect(await run((tx) => listProductVariants(tx, tenantId, productId))).toEqual(updated);
    expect(updated[0]!.available).toBe(false);
  });

  it.each(["-1.00", "1.001", "10000000000.00", "NaN", "", "1e2"])(
    "rejects invalid price %j without a partial save",
    async (unitPrice) => {
      await expect(
        run((tx) =>
          setProductVariants(
            tx,
            tenantId,
            productId,
            [variant("Good", "2.00"), variant("Bad", unitPrice)],
            "en",
          ),
        ),
      ).rejects.toMatchObject({ code: "product.variant_invalid" });
      expect(await run((tx) => listProductVariants(tx, tenantId, productId))).toEqual([]);
    },
  );

  it("rejects duplicate and foreign variant identities", async () => {
    const [saved] = await run((tx) =>
      setProductVariants(tx, tenantId, productId, [variant("Small", "2.00")], "en"),
    );
    await expect(
      run((tx) => setProductVariants(tx, tenantId, productId, [saved!, saved!], "en")),
    ).rejects.toMatchObject({ code: "product.variant_invalid" });
    await expect(
      run((tx) =>
        setProductVariants(tx, tenantId, productId, [{ ...saved!, id: crypto.randomUUID() }], "en"),
      ),
    ).rejects.toMatchObject({ code: "product.variant_not_found" });
  });

  it("refuses another tenant's product and hides its variants", async () => {
    const other = await seedTenant(fx.db);
    await expect(
      run((tx) => setProductVariants(tx, other, productId, [variant("Small", "2.00")], "en")),
    ).rejects.toMatchObject({ code: "product.not_found" });
    expect(await run((tx) => listProductVariants(tx, other, productId))).toEqual([]);
  });

  it("requires the default-language name while preserving disabled translations", async () => {
    await expect(
      run((tx) =>
        setProductVariants(
          tx,
          tenantId,
          productId,
          [{ ...variant("Small", "2.00"), name: { es: "Pequeño" } }],
          "en",
        ),
      ),
    ).rejects.toMatchObject({ code: "content.translation_required" });
  });

  it("keeps menu prices independent and requires explicit publication of new variants", async () => {
    const variants = await run((tx) =>
      setProductVariants(
        tx,
        tenantId,
        productId,
        [variant("Small", "2.00"), variant("Large", "3.00")],
        "en",
      ),
    );
    expect(await run((tx) => listMenuVariants(tx, tenantId, offerId))).toEqual([]);
    await run((tx) =>
      setMenuVariants(tx, tenantId, offerId, [
        { variantId: variants[0]!.id, unitPrice: "4.00", available: true },
      ]),
    );
    await run((tx) =>
      setProductVariants(
        tx,
        tenantId,
        productId,
        [{ ...variants[0]!, unitPrice: "2.50" }, variants[1]!],
        "en",
      ),
    );
    const published = await run((tx) => listMenuVariants(tx, tenantId, offerId));
    expect(published).toEqual([{ variantId: variants[0]!.id, unitPrice: "4.00", available: true }]);
    expect((await run((tx) => listProducts(tx, tenantId)))[0]!.variants).toEqual([
      expect.objectContaining({ id: variants[0]!.id, name: { en: "Small" }, unitPrice: "2.50" }),
      expect.objectContaining({ id: variants[1]!.id, name: { en: "Large" }, unitPrice: "3.00" }),
    ]);
    expect(await run((tx) => listMenuOffers(tx, tenantId, []))).toEqual([]);
    const offers = await run((tx) => listMenuOffers(tx, tenantId, [menuId]));
    expect(offers[0]!.variants).toEqual([
      {
        id: variants[0]!.id,
        name: { en: "Small" },
        unitPrice: "4.00",
        available: true,
      },
    ]);
    await expect(
      run((tx) => setProductVariants(tx, tenantId, productId, [variants[1]!], "en")),
    ).rejects.toMatchObject({ code: "product.variant_in_use" });
    expect(await run((tx) => listProductVariants(tx, tenantId, productId))).toHaveLength(2);
  });
});

it("prices the required published variant instead of the base or product variant price", async () => {
  const [small] = await run((tx) =>
    setProductVariants(tx, tenantId, productId, [variant("Small", "2.00")], "en"),
  );
  await expect(run((tx) => resolveMenuVariant(tx, tenantId, offerId, null))).rejects.toMatchObject({
    code: "product.variant_required",
  });
  await expect(
    run((tx) => resolveMenuVariant(tx, tenantId, offerId, small!.id)),
  ).rejects.toMatchObject({ code: "product.variant_unavailable" });
  await run((tx) =>
    setMenuVariants(tx, tenantId, offerId, [
      { variantId: small!.id, unitPrice: "4.00", available: true },
    ]),
  );
  const selected = await run((tx) => resolveMenuVariant(tx, tenantId, offerId, small!.id));
  expect(selected).toEqual({
    variantId: small!.id,
    productName: { en: "Coffee" },
    variantName: { en: "Small" },
    kitchenName: null,
    unitPrice: "4.00",
  });
  const priced = priceBasketWithOptions([
    {
      product: {
        descriptions: { en: "Coffee · Small" },
        unit: { name: { en: "each" }, precision: 0 },
        unitPrice: selected.unitPrice,
        vatClass: "reduced",
        category: null,
      },
      quantity: "2",
      options: [{ name: { en: "Milk" }, priceDelta: "1.00", vatClass: null, quantity: 1 }],
    },
  ]);
  expect(priced.total).toBe("10.00");
  await run((tx) =>
    updateProduct(tx, tenantId, productId, {
      descriptions: { en: "Renamed" },
      unitPrice: "99.00",
      active: false,
    }),
  );
  expect(selected.productName).toEqual({ en: "Coffee" });
  expect(selected.unitPrice).toBe("4.00");
  await expect(
    run((tx) => resolveMenuVariant(tx, tenantId, offerId, small!.id)),
  ).rejects.toMatchObject({ code: "product.unavailable" });
});
