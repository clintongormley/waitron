import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { menuItems } from "./schema/menu.js";
import { readMenuStructure } from "./menu-structure.js";
import { listProductVariants, setMenuVariants, setProductVariants } from "./variants.js";
import { applyLiveFields } from "./menu-document.js";
import { previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { menusFixture } from "../test/menus-fixture.js";
import { products, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { Transaction } from "@waitron/db";
import { priceBasket } from "./pricing.js";
import type { PriceableProduct, PricingUnit } from "./pricing.js";
import { customerPresentationText } from "./product-presentation.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";

// The till resolves an AvailableProduct's customer-facing text (customerName, falling back to the
// staff name) before pricing — the three-name model's seam between a catalogue read and a sale
// line, owned by product-presentation.ts rather than re-implemented here.
const toPriceable = (p: AvailableProduct): PriceableProduct => ({
  ...p,
  descriptions: customerPresentationText(
    {
      name: p.name,
      customerName: p.customerName,
      kitchenName: null,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
    },
    "en",
  ).product,
});
import {
  addCatalogueToLocation,
  applyDietDerivation,
  applyRecipeDerivation,
  assignCatalogueToLocation,
  catalogueExists,
  createCatalogue,
  createCategory,
  addProductToMenu,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
  listAccessibleCatalogues,
  listAvailableProducts,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listMenuOffers,
  listProducts,
  readInvoiceLocales,
  readReceiptLanguage,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  updateMenuDetails,
  updateCategory,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import type { AvailableProduct } from "./operations.js";
import { createUnit, EACH_UNIT } from "./units.js";
import {
  seedCatalogueFixture,
  seedLegacySellingUnits,
  seedVenue,
  storedUnitId,
  useCatalogueDb,
} from "../test/fixtures.js";

// Query behaviour. Each case starts with empty authoring tables.
const fx = useCatalogueDb();

describe("catalogue operations", () => {
  it("round-trips independent product description and kitchen name, and clears both", async () => {
    await asTenant(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Lunch" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Coffee",
        customerName: { en: "Coffee", es: "Café" },
        description: { en: "Freshly roasted beans", es: "Granos recién tostados" },
        kitchenName: "BAR COFFEE",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "reduced",
      });
      expect(product).toMatchObject({
        name: "Coffee",
        customerName: { en: "Coffee", es: "Café" },
        description: { en: "Freshly roasted beans", es: "Granos recién tostados" },
        kitchenName: "BAR COFFEE",
      });
      expect((await listProducts(tx, menu.id))[0]).toEqual(product);
      await updateProduct(tx, product.id, { description: null, kitchenName: null });
      expect((await listProducts(tx, menu.id))[0]).toMatchObject({
        name: "Coffee",
        customerName: { en: "Coffee", es: "Café" },
        description: null,
        kitchenName: null,
      });
    });
  });
  it("offers one product on two menus with distinct identities and prices", async () => {
    await asTenant(async (tx) => {
      const category = await createCategory(tx, { name: "Cocktails" });
      const upstairs = await createCatalogue(tx, { name: "Upstairs" });
      const downstairs = await createCatalogue(tx, { name: "Downstairs" });
      const product = await createProduct(tx, {
        catalogueId: upstairs.id,
        categoryId: category.id,
        name: "Negroni",
        unitId: eachUnitId,
        unitPrice: "0.00",
        vatClass: "general",
      });
      const nine = await addProductToMenu(tx, {
        menuId: upstairs.id,
        productId: product.id,
        grossPrice: "9.00",
      });
      const eleven = await addProductToMenu(tx, {
        menuId: downstairs.id,
        productId: product.id,
        grossPrice: "11.00",
      });
      const offers = await listMenuOffers(tx, [upstairs.id, downstairs.id]);
      expect(
        offers.map(({ id, productId, grossPrice }) => ({ id, productId, grossPrice })),
      ).toEqual([
        { id: eleven.id, productId: product.id, grossPrice: "11.00" },
        { id: nine.id, productId: product.id, grossPrice: "9.00" },
      ]);

      await updateMenuItem(tx, downstairs.id, eleven.id, { grossPrice: "12.50" });
      expect((await listMenuOffers(tx, [downstairs.id]))[0]!.grossPrice).toBe("12.50");
      await updateMenuItem(tx, downstairs.id, eleven.id, { grossPrice: "13.00" });
      const [repriced] = await listMenuOffers(tx, [downstairs.id]);
      expect(repriced).toMatchObject({ id: eleven.id, grossPrice: "13.00", unitPrice: "13.00" });
      await expect(
        updateMenuItem(tx, downstairs.id, crypto.randomUUID(), { grossPrice: "8.00" }),
      ).rejects.toMatchObject({ code: "menu_item.not_found" });
      await expect(
        addProductToMenu(tx, {
          menuId: downstairs.id,
          productId: crypto.randomUUID(),
          grossPrice: "8.00",
        }),
      ).rejects.toMatchObject({ code: "product.not_found" });
      await expect(
        addProductToMenu(tx, {
          menuId: crypto.randomUUID(),
          productId: product.id,
          grossPrice: "8.00",
        }),
      ).rejects.toMatchObject({ code: "catalogue.not_found" });
    });
  });

  it("keeps a category-less product visible with its null category", async () => {
    await asTenant(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Counter" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Water",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      const item = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: product.id,
        grossPrice: "1.50",
      });

      await expect(listMenuOffers(tx, [menu.id])).resolves.toEqual([
        expect.objectContaining({ id: item.id, category: null }),
      ]);
    });
  });

  let locationId: string;
  let eachUnitId: string;
  let kgUnitId: string;

  beforeEach(async () => {
    const venue = await seedVenue(fx.db);
    locationId = venue.locationId;
    await withTransaction(fx.db, async (tx) => {
      eachUnitId = (
        await createUnit(
          tx,
          { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
          "en",
        )
      ).id;
      kgUnitId = (
        await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en")
      ).id;
      await tx.execute(
        sql`update units
            set seed_key = case when id = ${eachUnitId} then 'each' else 'kg' end,
                hardware_unit = case when id = ${kgUnitId} then 'kg' else null end
            where id in (${eachUnitId}, ${kgUnitId})`,
      );
    });
  });

  // Every test body runs on its own transaction.
  const asTenant = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(fx.db, async (tx) => {
      return fn(tx);
    });

  it("creates and lists catalogues", async () => {
    await asTenant(async (tx) => {
      const deli = await createCatalogue(tx, { name: "Deli" });
      const stall = await createCatalogue(tx, { name: "Drinks stall" });
      expect(deli.active).toBe(true);
      expect(deli.version).toBe(1);
      const cats = await listCatalogues(tx);
      expect(cats.map((c) => c.name).sort()).toEqual(["Deli", "Drinks stall"]);
      expect(cats.map((c) => c.id).sort()).toEqual([deli.id, stall.id].sort());
    });
  });

  it("creates and lists categories", async () => {
    await asTenant(async (tx) => {
      const food = await createCategory(tx, { name: "Food" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const cats = await listCategories(tx);
      expect(cats.map((c) => c.name).sort()).toEqual(["Drinks", "Food"]);
      expect(cats.map((c) => c.id).sort()).toEqual([drinks.id, food.id].sort());
    });
  });

  it("creates and lists a catalogue's products", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const other = await createCatalogue(tx, { name: "Other" });
      const ham = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "sliced ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const water = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      // A product in a DIFFERENT catalogue must not leak into this catalogue's listing.
      await createProduct(tx, {
        catalogueId: other.id,
        categoryId: null,
        name: "olives",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
      });
      const products = await listProducts(tx, cat.id);
      expect(products.map((p) => p.id).sort()).toEqual([ham.id, water.id].sort());
      const seenHam = products.find((p) => p.id === ham.id)!;
      expect(seenHam.unit).toEqual({
        id: kgUnitId,
        name: { en: "kg" },
        precision: 3,
        hardwareUnit: "kg",
        abbreviation: { en: "u" },
      });
      expect(seenHam.unitPrice).toBe("24.90");
      expect(seenHam.vatClass).toBe("reduced");
      expect(seenHam.name).toBe("sliced ham");
      expect(seenHam.active).toBe(true);
    });
  });

  // Two rows with the SAME `created_at`, the earlier insert carrying the LEXICALLY GREATER id, so
  // insert order and id order disagree. `created_at` is at millisecond resolution, so ties are
  // ordinary. Weaker than it looks: the `group by products.id` settles the tie, so this pins the
  // ORDER the read returns and nothing pins the `id` in `listProducts`'s `orderBy`. And `id` is a
  // random v4 UUID, so a caller that needs creation order cannot get it from these two columns.
  it("settles a created_at tie on the product id rather than on insert order", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const sameMoment = new Date("2026-09-22T10:00:00.000Z");
      const row = (id: string, name: string) => ({
        id,
        catalogueId: cat.id,
        name,
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
        createdAt: sameMoment,
        updatedAt: sameMoment,
      });
      await tx
        .insert(products)
        .values(row("ffffffff-0000-4000-8000-000000000001", "written first"));
      await tx
        .insert(products)
        .values(row("00000000-0000-4000-8000-000000000002", "written second"));
      expect((await listProducts(tx, cat.id)).map((p) => p.name)).toEqual([
        "written second",
        "written first",
      ]);
    });
  });

  it("reads a product with no unit as the synthetic Each unit", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      // Create a normal product, then remove its product_units row so the read exercises the
      // null-join branch of a product that has no stored unit at all.
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "loose sweets",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await tx.execute(sql`delete from product_units where product_id = ${product.id}`);
      const [seen] = await listProducts(tx, cat.id);
      // toEqual(EACH_UNIT) asserts the whole synthetic unit, hardwareUnit: null included.
      expect(seen!.unit).toEqual(EACH_UNIT);
      expect(seen!.unit.id).toBe("00000000-0000-0000-0000-000000000001");
      expect(seen!.unitId).toBe("00000000-0000-0000-0000-000000000001");
      expect(seen!.pricingUnit).toBe("each");
    });
  });

  it("creates a product with no unit when unitId is null", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const created = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "loose sweets",
        unitId: null,
        unitPrice: "0.00",
        vatClass: "general",
      });
      expect(created.pricingUnit).toBe("each");
      expect(created.unit).toEqual(EACH_UNIT);
      expect(await storedUnitId(tx, created.id)).toBeNull();
    });
  });

  it("clears a product's unit when updated to null", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const created = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, created.id, { unitId: null });
      expect(await storedUnitId(tx, created.id)).toBeNull();
      const [after] = await tx
        .select({ p: products.pricingUnit })
        .from(products)
        .where(eq(products.id, created.id));
      expect(after!.p).toBe("each");
    });
  });

  it("leaves a product's unit unchanged when neither unitId nor pricingUnit is patched", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const created = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, created.id, { unitPrice: "25.00" });
      expect(await storedUnitId(tx, created.id)).toBe(kgUnitId);
    });
  });

  it("legacy pricingUnit 'each' creates a product with no unit", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const created = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "loose sweets",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      expect(await storedUnitId(tx, created.id)).toBeNull();
      expect(created.pricingUnit).toBe("each");
    });
  });

  it("refuses a create naming an unknown category before writing the product", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const missing = crypto.randomUUID();
      await expect(
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: missing,
          name: "Stray",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
      // Read inside the same transaction, which a refused create leaves open for the caller.
      expect(await listProducts(tx, cat.id)).toEqual([]);
    });
  });

  it("refuses a create naming an unknown catalogue with catalogue.not_found", async () => {
    const missing = crypto.randomUUID();
    await expect(
      asTenant((tx) =>
        createProduct(tx, {
          catalogueId: missing,
          categoryId: null,
          name: "Stray",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ),
    ).rejects.toMatchObject({ code: "catalogue.not_found", params: { catalogueId: missing } });
  });

  it("names the catalogue before the category when both are unknown", async () => {
    const missing = crypto.randomUUID();
    await expect(
      asTenant((tx) =>
        createProduct(tx, {
          catalogueId: missing,
          categoryId: crypto.randomUUID(),
          name: "Stray",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ),
    ).rejects.toMatchObject({ code: "catalogue.not_found", params: { catalogueId: missing } });
  });

  it("still rejects a create with neither unitId nor pricingUnit", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await expect(
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: null,
          name: "mystery",
          unitPrice: "0.00",
          vatClass: "general",
        }),
      ).rejects.toMatchObject({ code: "product.invalid" });
    });
  });

  it("rejects a create whose legacy pricingUnit is neither 'each' nor 'weight'", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await expect(
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: null,
          name: "mystery",
          // A stray legacy value must be rejected at the boundary, not treated as weight.
          pricingUnit: "portion" as PricingUnit,
          unitPrice: "0.00",
          vatClass: "general",
        }),
      ).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "pricingUnit" },
      });
    });
  });

  it("rejects an update whose legacy pricingUnit is neither 'each' nor 'weight'", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await expect(
        updateProduct(tx, product.id, { pricingUnit: "portion" as PricingUnit }),
      ).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "pricingUnit" },
      });
    });
  });

  it("attaches legacy product creates to the tenant's real seeded unit", async () => {
    await asTenant(async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const ham = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "ham",
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const assignments = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from product_units
        where product_id = ${ham.id}`);
      expect(assignments.rows).toEqual([{ unit_id: kgUnitId }]);
      expect(ham.unit).toEqual({
        id: kgUnitId,
        name: { en: "kg" },
        precision: 3,
        hardwareUnit: "kg",
        abbreviation: { en: "u" },
      });
    });
  });

  it("keeps the legacy pricing sentinel coherent when a product's unit changes", async () => {
    await asTenant(async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const ham = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, ham.id, { unitId: eachUnitId });
      const stored = await tx.execute<{ pricing_unit: string }>(sql`
        select pricing_unit from products
        where id = ${ham.id}`);
      expect(stored.rows).toEqual([{ pricing_unit: "each" }]);
      const [updated] = await listProducts(tx, catalogue.id);
      expect(updated).toMatchObject({
        unitId: eachUnitId,
        pricingUnit: "each",
        unit: { id: eachUnitId, precision: 0, hardwareUnit: null },
      });
    });
  });

  it("keeps the real unit assignment coherent when a legacy product changes pricing basis", async () => {
    await asTenant(async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "ham",
        pricingUnit: "each",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, product.id, { pricingUnit: "weight" });
      const assignments = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from product_units
        where product_id = ${product.id}`);
      expect(assignments.rows).toEqual([{ unit_id: kgUnitId }]);
      const [updated] = await listProducts(tx, catalogue.id);
      expect(updated).toMatchObject({
        unitId: kgUnitId,
        pricingUnit: "weight",
        unit: { id: kgUnitId, precision: 3, hardwareUnit: "kg" },
      });
    });
  });

  it("updates a product's price and description", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const water = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await updateProduct(tx, water.id, {
        unitPrice: "1.80",
        name: "sparkling water",
      });
      const [seen] = await listProducts(tx, cat.id);
      expect(seen!.unitPrice).toBe("1.80");
      expect(seen!.name).toBe("sparkling water");
    });
  });

  it("threads a product's image through create, update and list", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      // Created WITH an image: the stored reference round-trips out of createProduct and listProducts.
      const withImage = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
        image: "x.webp",
      });
      expect(withImage.image).toBe("x.webp");
      // Omitting `image` leaves it null (no picture — distinct from allergens' PENDING null).
      const noImage = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(noImage.image).toBeNull();
      const listed = await listProducts(tx, cat.id);
      expect(listed.find((p) => p.id === withImage.id)!.image).toBe("x.webp");
      expect(listed.find((p) => p.id === noImage.id)!.image).toBeNull();
      // updateProduct sets a new image reference…
      await updateProduct(tx, noImage.id, { image: "y.png" });
      const afterSet = (await listProducts(tx, cat.id)).find((p) => p.id === noImage.id)!;
      expect(afterSet.image).toBe("y.png");
      // …and `null` clears it back to no-picture.
      await updateProduct(tx, noImage.id, { image: null });
      const afterClear = (await listProducts(tx, cat.id)).find((p) => p.id === noImage.id)!;
      expect(afterClear.image).toBeNull();
    });
  });

  it("archives a product through updateProduct and refuses switching it back on", async () => {
    const { cat, p } = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(p.active).toBe(true);
      await updateProduct(tx, p.id, { active: false });
      expect((await listProducts(tx, cat.id)).find((x) => x.id === p.id)!.active).toBe(false);
      return { cat, p };
    });
    await expect(asTenant((tx) => updateProduct(tx, p.id, { active: true }))).rejects.toMatchObject(
      { code: "product.archived", params: { productId: p.id } },
    );
    expect(
      (await asTenant((tx) => listProducts(tx, cat.id))).find((x) => x.id === p.id)!.active,
    ).toBe(false);
  });

  it("creates a product inactive when active:false, active by default when omitted", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      // Created INACTIVE in one write: the flag round-trips out of createProduct.
      const hidden = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "seasonal",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
        active: false,
      });
      expect(hidden.active).toBe(false);
      // Omitting `active` leaves the column default (true).
      const shown = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(shown.active).toBe(true);
      // Both round-trip through listProducts.
      const listed = await listProducts(tx, cat.id);
      expect(listed.find((p) => p.id === hidden.id)!.active).toBe(false);
      expect(listed.find((p) => p.id === shown.id)!.active).toBe(true);
    });
  });

  it("creates a product with the ordering it is given, public when it is given none", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const base = {
        catalogueId: cat.id,
        categoryId: null,
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general" as const,
      };
      const bacon = await createProduct(tx, {
        ...base,
        name: "bacon",
        ordering: "not_sold_separately",
      });
      const staff = await createProduct(tx, {
        ...base,
        name: "staff meal",
        ordering: "staff_only",
      });
      const water = await createProduct(tx, { ...base, name: "water" });
      expect([bacon.ordering, staff.ordering, water.ordering]).toEqual([
        "not_sold_separately",
        "staff_only",
        "public",
      ]);
      const listed = await listProducts(tx, cat.id);
      expect(listed.find((p) => p.id === bacon.id)!.ordering).toBe("not_sold_separately");
      expect(listed.find((p) => p.id === water.id)!.ordering).toBe("public");
    });
  });

  it("changes a product's ordering through updateProduct and leaves it alone when not named", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "bacon",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await updateProduct(tx, p.id, { ordering: "not_sold_separately" });
      await updateProduct(tx, p.id, { name: "streaky bacon" });
      const listed = (await listProducts(tx, cat.id)).find((x) => x.id === p.id)!;
      expect(listed.ordering).toBe("not_sold_separately");
    });
  });

  it("round-trips a product's allergens", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "bread",
        unitId: eachUnitId,
        unitPrice: "1.20",
        vatClass: "general",
        allergens: { gluten: { presence: "contains", source: "wheat" } },
      });
      expect(p.allergens).toEqual({ gluten: { presence: "contains", source: "wheat" } });
      const [listed] = await listProducts(tx, cat.id);
      expect(listed!.allergens).toEqual({ gluten: { presence: "contains", source: "wheat" } });
    });
  });

  it("defaults allergens to null (unreviewed) when omitted", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(p.allergens).toBeNull();
    });
  });

  it("rejects an invalid allergen code on create", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await expect(
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: null,
          name: "mystery",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
          allergens: { nope: { presence: "contains" } } as never,
        }),
      ).rejects.toMatchObject({ code: "allergen.invalid_code" });
    });
  });

  it("validates allergens on update and clears them with null", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "cake",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { eggs: { presence: "contains" } },
      });
      // An invalid code on update is rejected before the write.
      await expect(
        updateProduct(tx, p.id, {
          allergens: { nope: { presence: "contains" } } as never,
        }),
      ).rejects.toMatchObject({ code: "allergen.invalid_code" });
      // A valid update is written back.
      await updateProduct(tx, p.id, { allergens: { milk: { presence: "may_contain" } } });
      const [afterSet] = await listProducts(tx, cat.id);
      expect(afterSet!.allergens).toEqual({ milk: { presence: "may_contain" } });
      // `null` clears the declaration back to unreviewed.
      await updateProduct(tx, p.id, { allergens: null });
      const [afterClear] = await listProducts(tx, cat.id);
      expect(afterClear!.allergens).toBeNull();
    });
  });

  it("listAvailableProducts returns allergens", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "milk",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
        allergens: { milk: { presence: "contains" } },
      });
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const [available] = (await listAvailableProducts(tx, locationId)).products;
      expect(available!.allergens).toEqual({ milk: { presence: "contains" } });
    });
  });

  it("listAvailableProducts carries the diet profile", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "falafel wrap",
        unitId: eachUnitId,
        unitPrice: "6.00",
        vatClass: "general",
        dietOverride: { vegan: "no", halal: "yes", addContains: ["meat"] },
      });

      await assignCatalogueToLocation(tx, locationId, cat.id);
      const [available] = (await listAvailableProducts(tx, locationId)).products;

      expect(available!.diet).toMatchObject({ vegan: "no", halal: "yes", contains: ["meat"] });
      expect(available!.dietOverride).toEqual({ vegan: "no", halal: "yes", addContains: ["meat"] });
      expect(available!.dietDerivation).toBeNull();
    });
  });

  // A product with no recipe publishes exactly the manual value.
  it("createProduct publishes the manual allergen map when there is no recipe", async () => {
    const result = await withTransaction(fx.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "sandwich",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { gluten: { presence: "contains" } },
      });
      return p;
    });
    expect(result.allergens).toEqual({ gluten: { presence: "contains" } });
  });

  // applyRecipeDerivation unions the floor over the manual overlay (add-only).
  it("applyRecipeDerivation republishes allergens as floor ∪ manual", async () => {
    const seen = await withTransaction(fx.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "sandwich",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { nuts: { presence: "may_contain" } },
      });
      await applyRecipeDerivation(tx, p.id, {
        allergens: { eggs: { presence: "contains" } },
        pending: false,
      });
      const [row] = await listProducts(tx, cat.id);
      return row!.allergens;
    });
    expect(seen).toEqual({ eggs: { presence: "contains" }, nuts: { presence: "may_contain" } });
  });

  // The read exposes the MANUAL overlay distinctly from the published union, so a later dashboard
  // can seed the allergen picker from `manualAllergens` without double-counting the recipe floor.
  it("exposes manual_allergens distinctly from the published union", async () => {
    const seen = await withTransaction(fx.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "sandwich",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { gluten: { presence: "contains" } }, // → manual_allergens
      });
      // A recipe contributes a derived floor of eggs; published becomes eggs ∪ gluten.
      await applyRecipeDerivation(tx, p.id, {
        allergens: { eggs: { presence: "contains" } },
        pending: false,
      });
      const [row] = await listProducts(tx, cat.id);
      return row!;
    });
    expect(seen.allergens).toEqual({
      eggs: { presence: "contains" },
      gluten: { presence: "contains" },
    });
    expect(seen.manualAllergens).toEqual({ gluten: { presence: "contains" } });
  });

  // The management read exposes the staff diet OVERRIDE distinctly from the published `diet`, so
  // the dashboard's editor can seed its controls from the manual value. No override reads `null`.
  it("exposes diet_override on the management product read", async () => {
    const [withOverride, without] = await withTransaction(fx.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const forced = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "falafel",
        unitId: eachUnitId,
        unitPrice: "4.00",
        vatClass: "general",
        dietOverride: { vegan: "no", halal: "yes", addContains: ["meat"] },
      });
      const plain = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "plain",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      const rows = await listProducts(tx, cat.id);
      return [rows.find((p) => p.id === forced.id)!, rows.find((p) => p.id === plain.id)!];
    });
    expect(withOverride.dietOverride).toEqual({ vegan: "no", halal: "yes", addContains: ["meat"] });
    expect(without.dietOverride).toBeNull();
  });

  // A pending derivation forces PENDING (null), even with a manual overlay present.
  it("applyRecipeDerivation with pending=true publishes PENDING (null)", async () => {
    const seen = await withTransaction(fx.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "x",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
        allergens: { nuts: { presence: "contains" } },
      });
      await applyRecipeDerivation(tx, p.id, { allergens: {}, pending: true });
      const [row] = await listProducts(tx, cat.id);
      return row!.allergens;
    });
    expect(seen).toBeNull();
  });

  // A caller-supplied id that names no product is a SILENT no-op, as for every other patch field.
  it("updateProduct with allergens on a nonexistent id does not throw and affects no row", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const missing = "00000000-0000-0000-0000-0000000000ff";
      await expect(
        updateProduct(tx, missing, { allergens: { eggs: { presence: "contains" } } }),
      ).resolves.toBeUndefined();
      // No row was created or altered: the catalogue stays empty.
      expect(await listProducts(tx, cat.id)).toEqual([]);
    });
  });

  it("applyRecipeDerivation on a nonexistent id does not throw", async () => {
    await asTenant(async (tx) => {
      const missing = "00000000-0000-0000-0000-0000000000fe";
      await expect(
        applyRecipeDerivation(tx, missing, { allergens: {}, pending: false }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Diet derivation + override republish ─────────────────────────────────────────────────────────
  const readDiet = (tx: Transaction, id: string) =>
    tx
      .select({
        diet: products.diet,
        deriv: products.dietDerivation,
        override: products.dietOverride,
      })
      .from(products)
      .where(eq(products.id, id));

  // CAUTIOUS posture: with no recipe and no override, vegan/vegetarian read "unknown" — never a
  // positive claim on an unreviewed plate.
  it("createProduct with no override publishes an unknown (cautious) diet profile", async () => {
    const [row] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "plain",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      return readDiet(tx, p.id);
    });
    expect(row!.diet).toEqual({ vegan: "unknown", vegetarian: "unknown", contains: [] });
    expect(row!.override).toBeNull();
  });

  // The override is stored AND folded into the published profile at create — halal/kosher live only in
  // the override, so they surface on `diet` straight away.
  it("createProduct persists dietOverride and folds it into published diet", async () => {
    const [row] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "falafel",
        unitId: eachUnitId,
        unitPrice: "4.00",
        vatClass: "general",
        dietOverride: { vegan: "no", halal: "yes", addContains: ["meat"] },
      });
      return readDiet(tx, p.id);
    });
    expect(row!.override).toEqual({ vegan: "no", halal: "yes", addContains: ["meat"] });
    expect(row!.diet).toMatchObject({ vegan: "no", halal: "yes", contains: ["meat"] });
  });

  it("createProduct rejects a diet override that both adds and removes a contains-tag", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      await expect(
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: null,
          name: "x",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
          dietOverride: { addContains: ["fish"], removeContains: ["fish"] },
        }),
      ).rejects.toMatchObject({ code: "diet.add_remove_conflict" });
    });
  });

  // The pending derivation alone would read vegan "unknown"; the override forces "yes".
  it("a forced vegan override wins over an uncategorised (pending) recipe", async () => {
    const [before, after] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "mystery bowl",
        unitId: eachUnitId,
        unitPrice: "5.00",
        vatClass: "general",
      });
      // Simulate the recipe module setting a pending derivation (an uncategorised ingredient).
      await applyDietDerivation(tx, p.id, { origins: [], pending: true });
      const [b] = await readDiet(tx, p.id);
      await updateProduct(tx, p.id, { dietOverride: { vegan: "yes" } });
      const [a] = await readDiet(tx, p.id);
      return [b!, a!];
    });
    expect(before.diet).toMatchObject({ vegan: "unknown" }); // pending, no override yet
    expect(after.diet).toMatchObject({ vegan: "yes" }); // override wins over pending
  });

  // Clearing the override with `null` reverts the published diet to the pure derived profile.
  it("updateProduct with dietOverride null reverts diet to the derived profile", async () => {
    const [row] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "salad",
        unitId: eachUnitId,
        unitPrice: "6.00",
        vatClass: "general",
        dietOverride: { vegan: "no" },
      });
      // reviewed all-plant recipe derivation → derived is vegan
      await applyDietDerivation(tx, p.id, { origins: ["plant"], pending: false });
      await updateProduct(tx, p.id, { dietOverride: null });
      return readDiet(tx, p.id);
    });
    expect(row!.override).toBeNull();
    expect(row!.diet).toMatchObject({ vegan: "yes", vegetarian: "yes" });
  });

  // Changing BOTH overlays in one updateProduct call republishes allergens AND diet together
  // in one republishOverlays call.
  it("updateProduct with both allergens and dietOverride republishes both columns", async () => {
    const result = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "salad",
        unitId: eachUnitId,
        unitPrice: "6.00",
        vatClass: "general",
      });
      // reviewed all-plant recipe derivation → derived is vegan
      await applyDietDerivation(tx, p.id, { origins: ["plant"], pending: false });
      await updateProduct(tx, p.id, {
        allergens: { milk: { presence: "contains" } },
        dietOverride: { vegan: "no" },
      });
      const [product] = await listProducts(tx, cat.id);
      const [diet] = await readDiet(tx, p.id);
      return { allergens: product!.allergens, diet: diet! };
    });
    expect(result.allergens).toEqual({ milk: { presence: "contains" } });
    expect(result.diet.override).toEqual({ vegan: "no" });
    // override wins for vegan; vegetarian still follows the all-plant derivation.
    expect(result.diet.diet).toMatchObject({ vegan: "no", vegetarian: "yes" });
  });

  it("updateProduct rejects a conflicting diet override", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "x",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      await expect(
        updateProduct(tx, p.id, {
          dietOverride: { addContains: ["meat"], removeContains: ["meat"] },
        }),
      ).rejects.toMatchObject({ code: "diet.add_remove_conflict" });
    });
  });

  // An unrelated edit (no dietOverride key) must NOT disturb the published diet profile.
  it("updateProduct without a dietOverride key leaves diet untouched", async () => {
    const [row] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "x",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
        dietOverride: { vegan: "no" },
      });
      await updateProduct(tx, p.id, { unitPrice: "2.00" });
      return readDiet(tx, p.id);
    });
    expect(row!.diet).toMatchObject({ vegan: "no" });
  });

  // applyDietDerivation folds an all-plant reviewed derivation into a vegan published profile.
  it("applyDietDerivation republishes diet from the origin set", async () => {
    const [row] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "veg",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      await applyDietDerivation(tx, p.id, { origins: ["plant", "meat"], pending: false });
      return readDiet(tx, p.id);
    });
    expect(row!.deriv).toEqual({ origins: ["plant", "meat"], pending: false });
    expect(row!.diet).toMatchObject({ vegan: "no", vegetarian: "no", contains: ["meat"] });
  });

  // A null derivation folds as "no recipe" (empty but PENDING) — republishOverlays' default branch,
  // the cautious posture: clearing the recipe drops the diet back to "unknown", not a positive claim.
  it("applyDietDerivation with null clears the derivation and republishes", async () => {
    const [row] = await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "veg",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      await applyDietDerivation(tx, p.id, { origins: ["meat"], pending: false });
      await applyDietDerivation(tx, p.id, null); // clear
      return readDiet(tx, p.id);
    });
    expect(row!.deriv).toBeNull();
    expect(row!.diet).toEqual({ vegan: "unknown", vegetarian: "unknown", contains: [] });
  });

  // A caller-supplied id that names no product is a SILENT no-op: the derivation UPDATE matches
  // nothing and nothing is republished. Mirrors applyRecipeDerivation's nonexistent-id test.
  it("applyDietDerivation on a nonexistent id does not throw", async () => {
    await asTenant(async (tx) => {
      const missing = "00000000-0000-0000-0000-0000000000fd";
      await expect(
        applyDietDerivation(tx, missing, { origins: ["plant"], pending: false }),
      ).resolves.toBeUndefined();
    });
  });

  it("renames a catalogue", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await updateMenuDetails(tx, cat.id, { name: "Delicatessen" });
      const [seen] = await listCatalogues(tx);
      expect(seen!.name).toBe("Delicatessen");
    });
  });

  it("renames a category", async () => {
    await asTenant(async (tx) => {
      const food = await createCategory(tx, { name: "Food" });
      await updateCategory(tx, food.id, { name: "Fresh food" });
      const [seen] = await listCategories(tx);
      expect(seen!.name).toBe("Fresh food");
    });
  });

  it("lists a location's catalogue's active products only, with the category name resolved", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const food = await createCategory(tx, { name: "Food" });
      const p1 = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: food.id,
        name: "sliced ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const p2 = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await deactivateProduct(tx, p2.id);
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const { products: available } = await listAvailableProducts(tx, locationId);
      expect(available.map((p) => p.id)).toEqual([p1.id]);
      expect(available[0]!.category).toBe("Food");
      expect(available[0]!.unitPrice).toBe("24.90");
      expect(available[0]!.unit).toMatchObject({ id: kgUnitId, name: { en: "kg" }, precision: 3 });
      expect(available[0]!.vatClass).toBe("reduced");
    });
  });

  it("lists products across the default AND other accessible catalogues, tagged", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      const lunch = await createCatalogue(tx, { name: "Lunch" });
      const other = await createCatalogue(tx, { name: "Unlisted" }); // NOT accessible
      const pMain = await createProduct(tx, {
        catalogueId: main.id,
        categoryId: null,
        name: "Steak",
        unitId: eachUnitId,
        unitPrice: "20.00",
        vatClass: "general",
      });
      const pLunch = await createProduct(tx, {
        catalogueId: lunch.id,
        categoryId: null,
        name: "Set menu",
        unitId: eachUnitId,
        unitPrice: "12.00",
        vatClass: "general",
      });
      await createProduct(tx, {
        catalogueId: other.id,
        categoryId: null,
        name: "Hidden",
        unitId: eachUnitId,
        unitPrice: "9.00",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, locationId, main.id); // default
      await addCatalogueToLocation(tx, locationId, lunch.id); // other accessible
      const { products: rows } = await listAvailableProducts(tx, locationId);
      expect(rows.map((r) => r.id).sort()).toEqual([pMain.id, pLunch.id].sort());
      expect(rows.find((r) => r.id === pLunch.id)).toMatchObject({
        catalogueId: lunch.id,
        catalogueName: "Lunch",
      });
    });
  });

  it("lists accessible catalogues with the default flagged, default first", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      const lunch = await createCatalogue(tx, { name: "Lunch" });
      await assignCatalogueToLocation(tx, locationId, main.id);
      await addCatalogueToLocation(tx, locationId, lunch.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: main.id, name: "Main", isDefault: true },
        { id: lunch.id, name: "Lunch", isDefault: false },
      ]);
    });
  });

  // The "then by name" half of the ordering: several non-default catalogues tie on isDefault, so the
  // sort must fall through to the alphabetical comparison rather than the default-first branch alone.
  it("sorts non-default accessible catalogues alphabetically after the default", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      const zebra = await createCatalogue(tx, { name: "Zebra" });
      const alpha = await createCatalogue(tx, { name: "Alpha" });
      await assignCatalogueToLocation(tx, locationId, main.id);
      await addCatalogueToLocation(tx, locationId, zebra.id);
      await addCatalogueToLocation(tx, locationId, alpha.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: main.id, name: "Main", isDefault: true },
        { id: alpha.id, name: "Alpha", isDefault: false },
        { id: zebra.id, name: "Zebra", isDefault: false },
      ]);
    });
  });

  // Ordering must come from `isDefault`, not row order: the default is created SECOND here (so it is
  // not first in creation/scan order) and still sorts first.
  it("sorts the default first regardless of creation order", async () => {
    await asTenant(async (tx) => {
      const lunch = await createCatalogue(tx, { name: "Lunch" });
      const main = await createCatalogue(tx, { name: "Main" });
      await addCatalogueToLocation(tx, locationId, lunch.id);
      await assignCatalogueToLocation(tx, locationId, main.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: main.id, name: "Main", isDefault: true },
        { id: lunch.id, name: "Lunch", isDefault: false },
      ]);
    });
  });

  it("readInvoiceLocales returns a location's invoice languages in order, and [] for no such location", async () => {
    await asTenant(async (tx) => {
      await tx.execute(
        sql`update locations set invoice_locales = '["es-ES","en-GB"]' where id = ${locationId}`,
      );
      expect(await readInvoiceLocales(tx, locationId)).toEqual(["es-ES", "en-GB"]);
      expect(await readInvoiceLocales(tx, crypto.randomUUID())).toEqual([]);
    });
  });

  it("readReceiptLanguage returns a location's first saved language and the whole list", async () => {
    await asTenant(async (tx) => {
      await tx.execute(
        sql`update locations set invoice_locales = '["gl-ES","es-ES"]' where id = ${locationId}`,
      );
      expect(await readReceiptLanguage(tx, locationId)).toEqual({
        locale: "gl-ES",
        invoiceLocales: ["gl-ES", "es-ES"],
      });
    });
  });

  it("readReceiptLanguage throws for no such location", async () => {
    await asTenant(async (tx) => {
      const missing = crypto.randomUUID();
      await expect(readReceiptLanguage(tx, missing)).rejects.toThrow(`no location ${missing}`);
    });
  });

  it("returns [] from listAccessibleCatalogues for a location with no accessible catalogue", async () => {
    await asTenant(async (tx) => {
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([]);
    });
  });

  it("removes a member catalogue from a location's accessible set", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      const lunch = await createCatalogue(tx, { name: "Lunch" });
      await assignCatalogueToLocation(tx, locationId, main.id);
      await addCatalogueToLocation(tx, locationId, lunch.id);
      await removeCatalogueFromLocation(tx, locationId, lunch.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: main.id, name: "Main", isDefault: true },
      ]);
    });
  });

  it("removeCatalogueFromLocation is a no-op for a catalogue that is not a member", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      const ghost = await createCatalogue(tx, { name: "Ghost" });
      await assignCatalogueToLocation(tx, locationId, main.id);
      await removeCatalogueFromLocation(tx, locationId, ghost.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: main.id, name: "Main", isDefault: true },
      ]);
    });
  });

  // The default lives in `locations.catalogue_id`, never as a `location_catalogues` row, so the
  // remove route cannot drop a location to zero sellable menus.
  it("removeCatalogueFromLocation never removes the default (it is not a member row)", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      await assignCatalogueToLocation(tx, locationId, main.id);
      await removeCatalogueFromLocation(tx, locationId, main.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: main.id, name: "Main", isDefault: true },
      ]);
    });
  });

  // The management screen's read: EVERY tenant catalogue (sellable here or not), each flagged
  // `sellable` (in this location's accessible set — default OR member) and `isDefault`. `shelf` is a
  // catalogue the tenant owns but this location does not sell, so it must appear with `sellable:false`.
  it("lists every tenant catalogue with sellable + default flags for a location", async () => {
    await asTenant(async (tx) => {
      const main = await createCatalogue(tx, { name: "Main" });
      const lunch = await createCatalogue(tx, { name: "Lunch" });
      const shelf = await createCatalogue(tx, { name: "Shelf" });
      await assignCatalogueToLocation(tx, locationId, main.id);
      await addCatalogueToLocation(tx, locationId, lunch.id);
      const rows = await listCataloguesForLocation(tx, locationId);
      expect(rows).toHaveLength(3);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(main.id)).toMatchObject({ name: "Main", sellable: true, isDefault: true });
      expect(byId.get(lunch.id)).toMatchObject({ name: "Lunch", sellable: true, isDefault: false });
      expect(byId.get(shelf.id)).toMatchObject({
        name: "Shelf",
        sellable: false,
        isDefault: false,
      });
    });
  });

  // Keep-sellable (owner decision): changing the default demotes the OLD default to a member so the
  // location keeps selling it — "which menus does this location sell?" and "which one opens first?" are
  // independent choices. Casa was the default, Día a member; after making Día the default, both are
  // still sellable, Día now flagged default.
  it("setLocationDefaultCatalogue changes the default and keeps the old default sellable", async () => {
    await asTenant(async (tx) => {
      const casa = await createCatalogue(tx, { name: "Casa" });
      const dia = await createCatalogue(tx, { name: "Día" });
      await assignCatalogueToLocation(tx, locationId, casa.id);
      await addCatalogueToLocation(tx, locationId, dia.id);
      await setLocationDefaultCatalogue(tx, locationId, dia.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: dia.id, name: "Día", isDefault: true },
        { id: casa.id, name: "Casa", isDefault: false },
      ]);
    });
  });

  // No prior default (a freshly-provisioned location) → just set it, nothing to demote.
  it("setLocationDefaultCatalogue sets the default when the location had none", async () => {
    await asTenant(async (tx) => {
      const casa = await createCatalogue(tx, { name: "Casa" });
      await setLocationDefaultCatalogue(tx, locationId, casa.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: casa.id, name: "Casa", isDefault: true },
      ]);
    });
  });

  // Re-setting the same catalogue as default must NOT insert a redundant member row for it.
  // `listAccessibleCatalogues` de-duplicates and so cannot see one; this counts member rows
  // DIRECTLY.
  it("setLocationDefaultCatalogue is idempotent when the catalogue is already the default", async () => {
    await asTenant(async (tx) => {
      const casa = await createCatalogue(tx, { name: "Casa" });
      await assignCatalogueToLocation(tx, locationId, casa.id);
      await setLocationDefaultCatalogue(tx, locationId, casa.id);
      expect(await listAccessibleCatalogues(tx, locationId)).toEqual([
        { id: casa.id, name: "Casa", isDefault: true },
      ]);
      const members = await tx.execute<{ count: number }>(
        sql`select count(*) as count from location_catalogues where location_id = ${locationId}`,
      );
      expect(members.rows[0]!.count).toBe(0);
    });
  });

  describe.each([
    ["addCatalogueToLocation", addCatalogueToLocation],
    ["setLocationDefaultCatalogue", setLocationDefaultCatalogue],
  ] as const)("%s with an id naming nothing", (_name, write) => {
    it("refuses an unknown location with location.not_found", async () => {
      const casa = await asTenant((tx) => createCatalogue(tx, { name: "Casa" }));
      const missing = crypto.randomUUID();
      await expect(asTenant((tx) => write(tx, missing, casa.id))).rejects.toMatchObject({
        code: "location.not_found",
        params: { locationId: missing },
      });
    });

    it("refuses an unknown catalogue at a real location with catalogue.not_found", async () => {
      const missing = crypto.randomUUID();
      await expect(asTenant((tx) => write(tx, locationId, missing))).rejects.toMatchObject({
        code: "catalogue.not_found",
        params: { catalogueId: missing },
      });
    });

    it("names the location first when both ids are unknown", async () => {
      const missing = crypto.randomUUID();
      await expect(asTenant((tx) => write(tx, missing, crypto.randomUUID()))).rejects.toMatchObject(
        {
          code: "location.not_found",
          params: { locationId: missing },
        },
      );
    });
  });

  it("catalogueExists is true for an existing catalogue and false for an absent id", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Casa" });
      expect(await catalogueExists(tx, cat.id)).toBe(true);
      expect(await catalogueExists(tx, "00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });

  it("returns null category for an available product with no category", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const [available] = (await listAvailableProducts(tx, locationId)).products;
      expect(available!.category).toBeNull();
      expect(available!.courseId).toBeNull();
    });
  });

  it("returns [] for a location with no catalogue assigned", async () => {
    await asTenant(async (tx) => {
      expect((await listAvailableProducts(tx, locationId)).products).toEqual([]);
    });
  });

  it("hides every product of a deactivated catalogue", async () => {
    await asTenant(async (tx) => {
      const fixture = await seedCatalogueFixture(tx, { locationId });
      expect((await listAvailableProducts(tx, locationId)).products.length).toBe(2);
      await deactivateCatalogue(tx, fixture.catalogueId);
      expect((await listAvailableProducts(tx, locationId)).products).toEqual([]);
    });
  });

  it("returns products from a seeded catalogue that priceBasket can consume directly", async () => {
    await asTenant(async (tx) => {
      await seedCatalogueFixture(tx, { locationId });
      const { products: available } = await listAvailableProducts(tx, locationId);
      expect(available.map((p) => p.category).sort()).toEqual(["Drinks", "Food"]);
      // The till prices catalogue rows by first resolving each one's customer-facing text; the
      // resolved rows feed straight into priceBasket.
      const priced = priceBasket(
        available.map((product) => ({ product: toPriceable(product), quantity: "1" })),
        "2026-09-27",
      );
      expect(priced.lines.length).toBe(2);
    });
  });

  it("prices an AvailableProduct once its customer-facing text is resolved", () => {
    const sample: AvailableProduct = {
      id: "00000000-0000-0000-0000-000000000000",
      name: "water",
      customerName: null,
      unit: {
        id: eachUnitId,
        name: { en: "each" },
        precision: 0,
        hardwareUnit: null,
        abbreviation: { en: "ea" },
      },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      catalogueId: "00000000-0000-0000-0000-000000000001",
      catalogueName: "Deli",
      offeredModifiers: [],
    };
    const priceable = toPriceable(sample);
    // A blank customer name falls back to the staff name for the snapshotted line text.
    expect(priceable.descriptions).toEqual({ en: "water" });
    expect(priceable.unitPrice).toBe("1.50");
  });
});

/**
 * A parent's variants follow it onto every menu it is on, nested under its offer
 * and priced by the chain in `offer-price.ts`. The parent's own price (4.00) and its price
 * on this menu (4.50) differ, so a variant priced from the wrong step of the chain fails.
 */
describe("menu offers nest a product's variants", () => {
  let f: { menuId: string; parentId: string; offerId: string };
  const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(fx.db, fn);
  const wine = (name: string, unitPrice: string | null, available = true) => ({
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice,
    available,
  });

  beforeEach(async () => {
    await seedVenue(fx.db);
    f = await run(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Bar" });
      const parent = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Wine by the glass",
        pricingUnit: "each",
        unitPrice: "4.00",
        vatClass: "reduced",
      });
      const offer = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: parent.id,
        grossPrice: "4.50",
      });
      return { menuId: menu.id, parentId: parent.id, offerId: offer.id };
    });
  });

  const offers = () => run((tx) => listMenuOffers(tx, [f.menuId]));
  const nested = async () =>
    (await offers())[0]!.variants.map(({ name, unitPrice, menuPrice, available }) => ({
      name,
      unitPrice,
      menuPrice,
      available,
    }));

  it("prices a product with no variants at its menu price, with nothing nested", async () => {
    expect(await offers()).toEqual([
      expect.objectContaining({ productId: f.parentId, grossPrice: "4.50", unitPrice: "4.50" }),
    ]);
    expect((await offers())[0]!.variants).toEqual([]);
  });

  it("prices an offer with a blank menu price at the product's own price, and follows it", async () => {
    // A second product on the same menu KEEPS the price this menu sets, whatever its own does.
    const kept = await run(async (tx) => {
      const product = await createProduct(tx, {
        catalogueId: f.menuId,
        categoryId: null,
        name: "Cava",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      await addProductToMenu(tx, {
        menuId: f.menuId,
        productId: product.id,
        grossPrice: "3.75",
      });
      return product.id;
    });
    await run((tx) => updateMenuItem(tx, f.menuId, f.offerId, { grossPrice: null }));
    const prices = async () =>
      (await offers()).map(({ productId, grossPrice, unitPrice }) => ({
        productId,
        grossPrice,
        unitPrice,
      }));
    expect(await prices()).toEqual([
      { productId: f.parentId, grossPrice: null, unitPrice: "4.00" },
      { productId: kept, grossPrice: "3.75", unitPrice: "3.75" },
    ]);
    await run(async (tx) => {
      await updateProduct(tx, f.parentId, { unitPrice: "4.20" });
      await updateProduct(tx, kept, { unitPrice: "3.10" });
    });
    expect(await prices()).toEqual([
      { productId: f.parentId, grossPrice: null, unitPrice: "4.20" },
      { productId: kept, grossPrice: "3.75", unitPrice: "3.75" },
    ]);
  });

  it("creates an offer with a blank price, and a blank-price offer follows its product's price", async () => {
    const created = await run(async (tx) => {
      const product = await createProduct(tx, {
        catalogueId: f.menuId,
        categoryId: null,
        name: "Vermut",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      return addProductToMenu(tx, {
        menuId: f.menuId,
        productId: product.id,
        grossPrice: null,
      });
    });
    expect(created).toEqual({
      id: created.id,
      menuId: f.menuId,
      productId: created.productId,
      grossPrice: null,
    });
    await run((tx) => updateMenuItem(tx, f.menuId, f.offerId, { grossPrice: null }));
    expect((await offers()).find((offer) => offer.id === f.offerId)).toMatchObject({
      id: f.offerId,
      grossPrice: null,
      unitPrice: "4.00",
    });
    await run((tx) => updateProduct(tx, f.parentId, { unitPrice: "4.40" }));
    expect((await offers()).find((offer) => offer.id === f.offerId)).toMatchObject({
      grossPrice: null,
      unitPrice: "4.40",
    });
  });

  it("prices a variant with nothing set below its parent at the parent's own price", async () => {
    await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("125 ml", null), wine("175 ml", "5.50")], "en"),
    );
    await run((tx) => updateMenuItem(tx, f.menuId, f.offerId, { grossPrice: null }));
    expect(await nested()).toEqual([
      { name: "125 ml", unitPrice: "4.00", menuPrice: null, available: true },
      { name: "175 ml", unitPrice: "5.50", menuPrice: null, available: true },
    ]);
  });

  it("offers a variant added after its parent went on the menu, at once", async () => {
    await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("125 ml", null), wine("175 ml", "5.50")], "en"),
    );
    expect(await nested()).toEqual([
      { name: "125 ml", unitPrice: "4.50", menuPrice: null, available: true },
      { name: "175 ml", unitPrice: "5.50", menuPrice: null, available: true },
    ]);
    // Variants are only ever nested: the menu lists the parent alone.
    expect((await offers()).map((offer) => offer.productId)).toEqual([f.parentId]);
  });

  it("never lists a variant as an offer of its own, even with a menu row naming it", async () => {
    const [w125] = await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("125 ml", null)], "en"),
    );
    // Written straight into the tables, as a member of the menu's root and a row of its own:
    // `addProductToMenu` and the member writes both refuse a variant.
    const { rootSectionId } = await run((tx) => readMenuStructure(tx, f.menuId));
    await fx.db.execute(sql`
      insert into section_members (id, section_id, position, product_id)
      values (${crypto.randomUUID()}, ${rootSectionId}, 1, ${w125!.id})`);
    await fx.db
      .insert(menuItems)
      .values({ menuId: f.menuId, productId: w125!.id, grossPrice: 900 });
    expect((await offers()).map((offer) => offer.productId)).toEqual([f.parentId]);
  });

  it("charges a price set for the variant on this menu, and its own price once that is cleared", async () => {
    const [, w175] = await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("125 ml", null), wine("175 ml", "5.50")], "en"),
    );
    await run((tx) => setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: "6.00" }]));
    expect((await nested())[1]).toEqual({
      name: "175 ml",
      unitPrice: "6.00",
      menuPrice: "6.00",
      available: true,
    });

    await run((tx) => setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: null }]));
    expect((await nested())[1]).toEqual({
      name: "175 ml",
      unitPrice: "5.50",
      menuPrice: null,
      available: true,
    });
  });

  it("lists an Unavailable variant as unavailable and leaves an Inactive one out", async () => {
    const [w125, w175] = await run((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("125 ml", null), wine("175 ml", "5.50", false), wine("250 ml", "7.00")],
        "en",
      ),
    );
    // 250 ml is left out of this save, so it becomes Inactive.
    await run((tx) => setProductVariants(tx, f.parentId, [w125!, w175!], "en"));
    expect(await nested()).toEqual([
      { name: "125 ml", unitPrice: "4.50", menuPrice: null, available: true },
      { name: "175 ml", unitPrice: "5.50", menuPrice: null, available: false },
    ]);
  });

  it("takes the offer and its variants away when the parent is Inactive", async () => {
    await run((tx) => setProductVariants(tx, f.parentId, [wine("125 ml", null)], "en"));
    await run((tx) => updateProduct(tx, f.parentId, { active: false }));
    expect(await offers()).toEqual([]);
  });

  it("still lists a parent none of whose variants is Available, every variant unavailable", async () => {
    await run((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("125 ml", null, false), wine("175 ml", "5.50", false)],
        "en",
      ),
    );
    expect(await offers()).toHaveLength(1);
    expect((await nested()).map(({ available }) => available)).toEqual([false, false]);
  });

  it("lists only top-level products, each with every variant nested in order, the removed ones last", async () => {
    const [w125, w175] = await run((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("125 ml", null), wine("175 ml", "5.50"), wine("250 ml", "7.00")],
        "en",
      ),
    );
    await run((tx) => setProductVariants(tx, f.parentId, [w175!, w125!], "en"));
    const listed = await run((tx) => listProducts(tx, f.menuId));
    expect(listed.map((product) => product.id)).toEqual([f.parentId]);
    expect(
      listed[0]!.variants.map(({ name, unitPrice, active }) => ({ name, unitPrice, active })),
    ).toEqual([
      { name: "175 ml", unitPrice: "5.50", active: true },
      { name: "125 ml", unitPrice: null, active: true },
      { name: "250 ml", unitPrice: "7.00", active: false },
    ]);
  });
});

describe("a variant's published allergens and diet", () => {
  // The parent's four overlays each carry a value a variant's own could never produce by accident:
  // its manual map (nuts) and its recipe floor (eggs) are different allergens, and its diet
  // override (halal) and derivation (dairy) set different parts of the profile.
  const PARENT_MANUAL = { nuts: { presence: "may_contain" as const } };
  const PARENT_RECIPE = { allergens: { eggs: { presence: "contains" as const } }, pending: false };
  const PARENT_DIET_DERIVATION = { origins: ["plant" as const, "dairy" as const], pending: false };
  const PARENT_DIET_OVERRIDE = { halal: "yes" as const };
  let parentId: string;
  let variantId: string;
  let bareVariantId: string;
  const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(fx.db, fn);
  const wine = (name: string) => ({
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: null,
    available: true,
  });

  beforeEach(async () => {
    await seedVenue(fx.db);
    ({ parentId, variantId, bareVariantId } = await run(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Bar" });
      const parent = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Latte",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "reduced",
        allergens: PARENT_MANUAL,
        dietOverride: PARENT_DIET_OVERRIDE,
      });
      await applyRecipeDerivation(tx, parent.id, PARENT_RECIPE);
      await applyDietDerivation(tx, parent.id, PARENT_DIET_DERIVATION);
      const [variant, bare] = await setProductVariants(
        tx,
        parent.id,
        [wine("Oat latte"), wine("Small latte")],
        "en",
      );
      return { parentId: parent.id, variantId: variant!.id, bareVariantId: bare!.id };
    }));
  });

  /** A product's stored `allergens`/`diet`, and what a read through the fallback sees. */
  const published = (id: string) =>
    run(async (tx) => {
      const [row] = await tx
        .select({
          allergens: products.allergens,
          diet: products.diet,
          effectiveAllergens: effectiveProductColumns.allergens,
          effectiveDiet: effectiveProductColumns.diet,
        })
        .from(products)
        .leftJoin(parentProducts, parentJoin)
        .where(eq(products.id, id));
      return row!;
    });

  it("stores both blank when all four overlays are blank, so the parent's are read", async () => {
    const parent = await published(parentId);
    await run(async (tx) => {
      await updateProduct(tx, variantId, { allergens: null, dietOverride: null });
      await updateProduct(tx, variantId, { allergens: null });
      await updateProduct(tx, variantId, { dietOverride: null });
    });
    expect(await published(variantId)).toEqual({
      allergens: null,
      diet: null,
      effectiveAllergens: parent.allergens,
      effectiveDiet: parent.diet,
    });
    expect(parent.allergens).toEqual({
      eggs: { presence: "contains" },
      nuts: { presence: "may_contain" },
    });
  });

  it("unions a variant's own manual allergens with its PARENT's recipe floor", async () => {
    await run((tx) =>
      updateProduct(tx, variantId, { allergens: { milk: { presence: "contains" } } }),
    );
    expect(await published(variantId)).toMatchObject({
      allergens: { eggs: { presence: "contains" }, milk: { presence: "contains" } },
      diet: null,
    });
  });

  it("combines a variant's own diet override with its PARENT's derivation", async () => {
    await run((tx) => updateProduct(tx, variantId, { dietOverride: { kosher: "yes" } }));
    const parent = await published(parentId);
    expect(parent.diet).toMatchObject({ vegan: "no", vegetarian: "yes", halal: "yes" });
    expect(await published(variantId)).toEqual({
      allergens: null,
      diet: { vegan: "no", vegetarian: "yes", contains: [], kosher: "yes" },
      effectiveAllergens: parent.allergens,
      effectiveDiet: { vegan: "no", vegetarian: "yes", contains: [], kosher: "yes" },
    });
  });

  it("republishes each variant with an override of its own when its parent's recipe changes", async () => {
    await run(async (tx) => {
      await updateProduct(tx, variantId, {
        allergens: { milk: { presence: "contains" } },
        dietOverride: { kosher: "yes" },
      });
      await applyRecipeDerivation(tx, parentId, {
        allergens: { gluten: { presence: "contains" } },
        pending: false,
      });
      await applyDietDerivation(tx, parentId, { origins: ["plant"], pending: false });
    });
    expect(await published(variantId)).toMatchObject({
      allergens: { gluten: { presence: "contains" }, milk: { presence: "contains" } },
      diet: { vegan: "yes", vegetarian: "yes", contains: [], kosher: "yes" },
    });
    // A variant with nothing of its own is left blank, still reading the parent's.
    const parent = await published(parentId);
    expect(await published(bareVariantId)).toEqual({
      allergens: null,
      diet: null,
      effectiveAllergens: parent.allergens,
      effectiveDiet: parent.diet,
    });
  });

  it("republishes a variant with only its own allergens, or only its own diet override, on the column it overrides", async () => {
    await run(async (tx) => {
      await updateProduct(tx, variantId, { allergens: { milk: { presence: "contains" } } });
      await updateProduct(tx, bareVariantId, { dietOverride: { kosher: "yes" } });
      await updateProduct(tx, parentId, { allergens: { sesame: { presence: "contains" } } });
      await applyRecipeDerivation(tx, parentId, {
        allergens: { gluten: { presence: "contains" } },
        pending: false,
      });
      await applyDietDerivation(tx, parentId, { origins: ["plant"], pending: false });
    });
    const parent = await published(parentId);
    expect(await published(variantId)).toEqual({
      allergens: { gluten: { presence: "contains" }, milk: { presence: "contains" } },
      diet: null,
      effectiveAllergens: { gluten: { presence: "contains" }, milk: { presence: "contains" } },
      effectiveDiet: parent.diet,
    });
    expect(await published(bareVariantId)).toEqual({
      allergens: null,
      diet: { vegan: "yes", vegetarian: "yes", contains: [], kosher: "yes" },
      effectiveAllergens: parent.allergens,
      effectiveDiet: { vegan: "yes", vegetarian: "yes", contains: [], kosher: "yes" },
    });
  });

  it("refuses a recipe or diet derivation written to a variant", async () => {
    await expect(
      run((tx) => applyRecipeDerivation(tx, variantId, { allergens: {}, pending: false })),
    ).rejects.toMatchObject({ code: "product.not_found", params: { productId: variantId } });
    await expect(
      run((tx) => applyDietDerivation(tx, variantId, { origins: [], pending: false })),
    ).rejects.toMatchObject({ code: "product.not_found", params: { productId: variantId } });
    expect(await published(variantId)).toMatchObject({ allergens: null, diet: null });
  });
});

describe("what a menu offers: its structure, Active and Available decide", () => {
  const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(fx.db, fn);
  const listed = async (menuId: string) =>
    (await run((tx) => listMenuOffers(tx, [menuId]))).map((offer) => offer.productId);
  const variantsOf = async (menuId: string, productId: string) =>
    (await run((tx) => listMenuOffers(tx, [menuId])))
      .find((offer) => offer.productId === productId)!
      .variants.map(({ name, available }) => [name, available]);

  it("offers what its own sections place, and what only an included menu places, as its own", async () => {
    // Lunch places Soup itself and reaches Lemonade and Lager only through the Drinks menu.
    const f = await menusFixture(fx.db);
    const offers = await run((tx) => listMenuOffers(tx, [f.lunch]));
    expect(offers.map((offer) => [offer.menuId, offer.productId])).toEqual([
      [f.lunch, f.lemonade],
      [f.lunch, f.lager],
      [f.lunch, f.soup],
    ]);
    for (const offer of offers) {
      expect(offer).not.toHaveProperty("offered");
      for (const variant of offer.variants) {
        expect(variant).not.toHaveProperty("offered");
        expect(variant).not.toHaveProperty("ownOffered");
      }
    }
  });

  it("leaves an Inactive product out, through an included menu too", async () => {
    const f = await menusFixture(fx.db);
    await run(async (tx) => {
      await updateProduct(tx, f.soup, { active: false });
      await updateProduct(tx, f.lager, { active: false });
    });
    expect(await listed(f.lunch)).toEqual([f.lemonade]);
    expect(await listed(f.drinksMenu)).toEqual([f.lemonade]);
  });

  it("offers an Unavailable product, which a published menu then serves as not sellable", async () => {
    const f = await menusFixture(fx.db);
    await run((tx) => updateProduct(tx, f.soup, { available: false }));
    expect(await listed(f.lunch)).toContain(f.soup);
    const { hash } = await run((tx) => previewMenu(tx, f.lunch));
    await run((tx) => publishMenu(tx, f.lunch, hash, "person-1"));
    const served = await run(async (tx) => {
      const live = await readLiveDocuments(tx, [f.lunch]);
      return (await applyLiveFields(tx, [live.get(f.lunch)!.document])).get(f.lunch)!;
    });
    expect(served.map((offer) => [offer.productId, offer.available])).toEqual([
      [f.lemonade, true],
      [f.lager, true],
      [f.soup, false],
    ]);
  });

  it("lists each Active variant as available as it is itself, and leaves an Inactive one out", async () => {
    const f = await menusFixture(fx.db);
    await run(async (tx) => {
      const [large, small] = await setProductVariants(
        tx,
        f.lemonade,
        [
          ...(await listProductVariants(tx, f.lemonade)),
          {
            name: "Small",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "2.50",
            available: false,
          },
          {
            name: "Jug",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "9.00",
            available: true,
          },
        ],
        "en",
      );
      // Jug is left out of this save, so it becomes Inactive.
      await setProductVariants(tx, f.lemonade, [large!, small!], "en");
    });
    const expected = [
      ["Large", true],
      ["Small", false],
    ];
    // Drinks places Lemonade itself; Lunch reaches it only by including Drinks.
    expect(await variantsOf(f.drinksMenu, f.lemonade)).toEqual(expected);
    expect(await variantsOf(f.lunch, f.lemonade)).toEqual(expected);
  });
});

describe("a product's own colour", () => {
  const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, action);
  let catalogueId: string;
  let productId: string;
  let variantId: string;
  beforeEach(async () => {
    await seedTenant(fx.db);
    await seedLegacySellingUnits(fx.db);
    ({ catalogueId, productId, variantId } = await app(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Menu" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Wine",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      });
      const [variant] = await setProductVariants(
        tx,
        product.id,
        [
          {
            name: "Glass",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            available: true,
          },
        ],
        "en",
      );
      return { catalogueId: menu.id, productId: product.id, variantId: variant!.id };
    }));
  });

  const storedColor = async (id: string) =>
    (await fx.db.select({ color: products.color }).from(products).where(eq(products.id, id)))[0]!
      .color;

  it("stores a product's own colour, lists it, and clears it", async () => {
    await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
    expect(await storedColor(productId)).toBe("#256bb1");
    const listed = await app((tx) => listProducts(tx, catalogueId));
    expect(listed.find((product) => product.id === productId)).toMatchObject({ color: "#256bb1" });
    await app((tx) => updateProduct(tx, productId, { color: null }));
    expect(await storedColor(productId)).toBeNull();
  });

  it("answers a variant's id as an id that names no product, and leaves both rows", async () => {
    await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
    await expect(
      app((tx) => updateProduct(tx, variantId, { color: "#b12525" })),
    ).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: variantId },
    });
    const unknown = crypto.randomUUID();
    await expect(
      app((tx) => updateProduct(tx, unknown, { color: "#b12525" })),
    ).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: unknown },
    });
    expect(await storedColor(variantId)).toBeNull();
    expect(await storedColor(productId)).toBe("#256bb1");
  });

  it("refuses a variant's id with null too, leaving a colour it holds", async () => {
    await fx.db.update(products).set({ color: "#b12525" }).where(eq(products.id, variantId));
    await expect(app((tx) => updateProduct(tx, variantId, { color: null }))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: variantId },
    });
    expect(await storedColor(variantId)).toBe("#b12525");
  });

  it.each(["#B12525", "", "red"])(
    "refuses the colour %j as product.invalid on color, before looking for the product",
    async (color) => {
      await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
      await expect(app((tx) => updateProduct(tx, productId, { color }))).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "color" },
      });
      await expect(
        app((tx) => updateProduct(tx, crypto.randomUUID(), { color })),
      ).rejects.toMatchObject({ code: "product.invalid", params: { field: "color" } });
      expect(await storedColor(productId)).toBe("#256bb1");
    },
  );

  it("sets the colour through updateProduct, and leaves it when the patch has none", async () => {
    await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
    expect(await storedColor(productId)).toBe("#256bb1");
    await app((tx) => updateProduct(tx, productId, { name: "Red wine" }));
    expect(await storedColor(productId)).toBe("#256bb1");
    await app((tx) => updateProduct(tx, productId, { color: null }));
    expect(await storedColor(productId)).toBeNull();
  });

  it("writes a category and a colour in one patch, and ranks a category refusal above a bad colour", async () => {
    const drinks = await app((tx) => createCategory(tx, { name: "Drinks" }));
    await app((tx) => updateProduct(tx, productId, { categoryId: drinks.id, color: "#256bb1" }));
    expect(await storedColor(productId)).toBe("#256bb1");
    expect(
      (await fx.db.select().from(products).where(eq(products.id, productId)))[0]!.categoryId,
    ).toBe(drinks.id);
    const missing = crypto.randomUUID();
    await expect(
      app((tx) => updateProduct(tx, productId, { categoryId: missing, color: "red" })),
    ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
    await expect(
      app((tx) => updateProduct(tx, variantId, { categoryId: drinks.id, color: "red" })),
    ).rejects.toMatchObject({ code: "product.not_found", params: { productId: variantId } });
    await expect(
      app((tx) => updateProduct(tx, productId, { categoryId: null, color: "red" })),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "color" } });
    expect(await storedColor(productId)).toBe("#256bb1");
  });

  it("looks for the product once and writes the row once for a category and a colour", async () => {
    const drinks = await app((tx) => createCategory(tx, { name: "Drinks" }));
    await app(async (tx) => {
      const reads = vi.spyOn(tx, "select");
      const writes = vi.spyOn(tx, "update");
      try {
        await updateProduct(tx, productId, { categoryId: drinks.id, color: "#256bb1" });
        expect([reads.mock.calls.length, writes.mock.calls.length]).toEqual([2, 1]);
      } finally {
        reads.mockRestore();
        writes.mockRestore();
      }
    });
  });
});
