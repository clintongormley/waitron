import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { menuItems } from "./schema/menu.js";
import { setMenuVariants, setProductVariants } from "./variants.js";
import { products, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { priceBasket } from "./pricing.js";
import type { PriceableProduct, PricingUnit } from "./pricing.js";
import { customerPresentationText } from "./product-presentation.js";

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
  createMenuItem,
  createMenuSection,
  createProduct,
  deactivateCatalogue,
  deactivateMenuItem,
  deactivateProduct,
  listAccessibleCatalogues,
  listAvailableProducts,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listMenuOffers,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  renameCatalogue,
  updateCategory,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import type { AvailableProduct } from "./operations.js";
import { createUnit, EACH_UNIT } from "./units.js";
import { seedCatalogueFixture, seedVenue, storedUnitId, useCatalogueDb } from "../test/fixtures.js";

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
      const category = await createCategory(tx, { name: { en: "Cocktails" } });
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
      const upstairsSection = await createMenuSection(tx, {
        menuId: upstairs.id,
        name: { en: "Cocktails" },
      });
      const downstairsSection = await createMenuSection(tx, {
        menuId: downstairs.id,
        name: { en: "Drinks" },
      });
      const nine = await createMenuItem(tx, {
        menuId: upstairs.id,
        productId: product.id,
        sectionId: upstairsSection.id,
        grossPrice: "9.00",
      });
      const eleven = await createMenuItem(tx, {
        menuId: downstairs.id,
        productId: product.id,
        sectionId: downstairsSection.id,
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
      await deactivateMenuItem(tx, downstairs.id, eleven.id);
      await expect(listMenuOffers(tx, [downstairs.id])).resolves.toEqual([]);
      const restored = await createMenuItem(tx, {
        menuId: downstairs.id,
        productId: product.id,
        sectionId: downstairsSection.id,
        grossPrice: "13.00",
      });
      expect(restored).toMatchObject({ id: eleven.id, active: true, grossPrice: "13.00" });
      await expect(
        updateMenuItem(tx, downstairs.id, crypto.randomUUID(), { grossPrice: "8.00" }),
      ).rejects.toMatchObject({ code: "menu_item.not_found" });
      await expect(
        createMenuItem(tx, {
          menuId: downstairs.id,
          productId: crypto.randomUUID(),
          sectionId: downstairsSection.id,
          grossPrice: "8.00",
        }),
      ).rejects.toMatchObject({ code: "product.not_found" });
      await expect(
        createMenuItem(tx, {
          menuId: downstairs.id,
          productId: product.id,
          sectionId: crypto.randomUUID(),
          grossPrice: "8.00",
        }),
      ).rejects.toMatchObject({ code: "menu_section.not_found" });
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
      const section = await createMenuSection(tx, {
        menuId: menu.id,
        name: { en: "Drinks" },
      });
      const item = await createMenuItem(tx, {
        menuId: menu.id,
        productId: product.id,
        sectionId: section.id,
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
      const food = await createCategory(tx, { name: { en: "Food" } });
      const drinks = await createCategory(tx, { name: { en: "Drinks" } });
      const cats = await listCategories(tx);
      expect(cats.map((c) => c.name.en).sort()).toEqual(["Drinks", "Food"]);
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

  // Two rows written with the SAME `created_at`, the earlier insert carrying the LEXICALLY GREATER
  // id, so insert order and id order disagree and the read has to come back as one or the other.
  // Ties are ordinary rather than contrived: `created_at` is an ISO string at millisecond
  // resolution and two authoring transactions land inside one millisecond most of the time (22 of
  // 30 pairs, measured 2026-09-22).
  //
  // What settles the tie is the `group by products.id`, not the `id` in the `order by`: the group
  // key is the table's primary key, so the engine walks that index and hands the rows back in id
  // order. Deleting `products.id` from `listProducts`'s `orderBy` therefore moves nothing here —
  // this case pins the ORDER the read returns, and nothing pins that tiebreak.
  //
  // Note what it does NOT give: `id` is a random v4 UUID, so which of two same-millisecond rows
  // comes first is decided afresh on every run. A caller that needs creation order cannot get it
  // from these two columns.
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

  it("toggles a product's active flag through updateProduct", async () => {
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
      expect(p.active).toBe(true);
      // `{ active: false }` deactivates through the same edit route (the headless deactivateProduct
      // stays for the till/other callers)…
      await updateProduct(tx, p.id, { active: false });
      const deactivated = (await listProducts(tx, cat.id)).find((x) => x.id === p.id)!;
      expect(deactivated.active).toBe(false);
      // …and `{ active: true }` reactivates it.
      await updateProduct(tx, p.id, { active: true });
      const reactivated = (await listProducts(tx, cat.id)).find((x) => x.id === p.id)!;
      expect(reactivated.active).toBe(true);
    });
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
      // Omitting `active` leaves the column default (true) — today's behaviour, unchanged.
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

  // A product with no recipe still publishes exactly the manual value (today's behavior).
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

  // The management read exposes the staff diet OVERRIDE distinctly from the published `diet` union, so
  // the dashboard's diet-override editor (Task 8b) seeds its tri-state controls from the manual value —
  // the diet twin of `manualAllergens` above. A product with no override reads `dietOverride: null`.
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

  // A caller-supplied id that names no product is a SILENT no-op, exactly as every other patch field
  // is (image/active/…) — updateProduct does not pre-check existence, and republishProduct's SELECT
  // returns no row, so `republish(null, null) = null` and the follow-up UPDATE matches nothing. This
  // also exercises republishProduct's `row === undefined` branch.
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

  // ── Diet derivation + override republish (Task 3) ────────────────────────────────────────────────
  const readDiet = (tx: Transaction, id: string) =>
    tx
      .select({
        diet: products.diet,
        deriv: products.dietDerivation,
        override: products.dietOverride,
      })
      .from(products)
      .where(eq(products.id, id));

  // CAUTIOUS posture: at create there is no recipe, so the published `diet` is the override overlaid
  // on the EMPTY, PENDING derived profile — a bare product with no override reads vegan/vegetarian
  // "unknown" (never a positive claim on an unreviewed plate), mirroring the allergen twin's `pending`.
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

  // Step 7 of the brief: a forced vegan override WINS over an uncategorised (pending) recipe — the
  // pending derivation alone would read vegan "unknown", the override forces "yes".
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
  // (republishProductOverlays' single SELECT+UPDATE), landing the same values the two single-overlay
  // republishes would.
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

  // A null derivation folds as "no recipe" (empty but PENDING) — republishProductDiet's default branch,
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

  // A caller-supplied id that names no product is a SILENT no-op — republishProductDiet's SELECT
  // returns no row (its `row === undefined` branch), so both defaults apply and the UPDATE matches
  // nothing. Mirrors applyRecipeDerivation's nonexistent-id test.
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
      await renameCatalogue(tx, cat.id, "Delicatessen");
      const [seen] = await listCatalogues(tx);
      expect(seen!.name).toBe("Delicatessen");
    });
  });

  it("renames a category", async () => {
    await asTenant(async (tx) => {
      const food = await createCategory(tx, { name: { en: "Food" } });
      await updateCategory(tx, food.id, { name: { en: "Fresh food" } });
      const [seen] = await listCategories(tx);
      expect(seen!.name).toEqual({ en: "Fresh food" });
    });
  });

  it("lists a location's catalogue's active products only, with the category name resolved", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const food = await createCategory(tx, { name: { en: "Food" } });
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
  // member-remove op can never strip a location's default menu — calling it with the default id is a
  // no-op on the member table. This is the guard that keeps a location from dropping to zero sellable
  // menus via the remove route.
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

  // Re-setting the same catalogue as default must NOT insert a redundant `location_catalogues` member
  // row for it (leaving it as both default and member) — the `defaultId !== catalogueId` branch skips
  // the keep-sellable add. `listAccessibleCatalogues` de-duplicates, so it CANNOT see a redundant row;
  // this asserts the member count DIRECTLY, so deleting that branch (which would then add the row) turns
  // this test red. (Proven by deletion: `defaultId !== catalogueId` removed → member count becomes 1.)
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

  // The trust-boundary guard the location-menu write routes use: does this catalogue exist at all?
  // A real id is true; an absent id is false.
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
      // KDS-2: a product with no default course reports `courseId: null` (the till's course picker reads
      // this as "no pre-selected default"). The non-null path is proven end-to-end by the server's
      // ring-time course resolver (it reads this field as `<override> ?? product.course_id`).
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
 * A parent's variants follow it onto every menu it is on (spec §15.5, V5), nested under its offer
 * and priced by the chain in `offer-price.ts` (§15.3). The parent's own price (4.00) and its price
 * on this menu (4.50) differ, so a variant priced from the wrong step of the chain fails.
 */
describe("menu offers nest a product's variants", () => {
  let f: { menuId: string; sectionId: string; parentId: string; offerId: string };
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
      const section = await createMenuSection(tx, { menuId: menu.id, name: { en: "Wine" } });
      const offer = await createMenuItem(tx, {
        menuId: menu.id,
        productId: parent.id,
        sectionId: section.id,
        grossPrice: "4.50",
      });
      return { menuId: menu.id, sectionId: section.id, parentId: parent.id, offerId: offer.id };
    });
  });

  const offers = (options: { includeUnavailable?: boolean } = {}) =>
    run((tx) => listMenuOffers(tx, [f.menuId], options));
  const nested = async () =>
    (await offers())[0]!.variants.map(({ name, unitPrice, menuPrice, offered, available }) => ({
      name,
      unitPrice,
      menuPrice,
      offered,
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
      await createMenuItem(tx, {
        menuId: f.menuId,
        productId: product.id,
        sectionId: f.sectionId,
        grossPrice: "3.75",
        displayOrder: 1,
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

  it("creates an offer with a blank price, and blanks a re-activated offer's old one", async () => {
    const created = await run(async (tx) => {
      const product = await createProduct(tx, {
        catalogueId: f.menuId,
        categoryId: null,
        name: "Vermut",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      return createMenuItem(tx, {
        menuId: f.menuId,
        productId: product.id,
        sectionId: f.sectionId,
        grossPrice: null,
      });
    });
    expect(created).toMatchObject({ grossPrice: null, active: true });
    await run((tx) => deactivateMenuItem(tx, f.menuId, f.offerId));
    const restored = await run((tx) =>
      createMenuItem(tx, {
        menuId: f.menuId,
        productId: f.parentId,
        sectionId: f.sectionId,
        grossPrice: null,
      }),
    );
    expect(restored).toMatchObject({ id: f.offerId, active: true, grossPrice: null });
    expect((await offers()).find((offer) => offer.id === f.offerId)).toMatchObject({
      grossPrice: null,
      unitPrice: "4.00",
    });
  });

  it("prices a variant with nothing set below its parent at the parent's own price", async () => {
    await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await run((tx) => updateMenuItem(tx, f.menuId, f.offerId, { grossPrice: null }));
    expect(await nested()).toEqual([
      { name: "Wine 125", unitPrice: "4.00", menuPrice: null, offered: true, available: true },
      { name: "Wine 175", unitPrice: "5.50", menuPrice: null, offered: true, available: true },
    ]);
  });

  it("offers a variant added after its parent went on the menu, at once", async () => {
    await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    expect(await nested()).toEqual([
      { name: "Wine 125", unitPrice: "4.50", menuPrice: null, offered: true, available: true },
      { name: "Wine 175", unitPrice: "5.50", menuPrice: null, offered: true, available: true },
    ]);
    // Variants are only ever nested: the menu lists the parent alone.
    expect((await offers()).map((offer) => offer.productId)).toEqual([f.parentId]);
  });

  it("never lists a variant as an offer of its own, even with a menu row naming it", async () => {
    const [w125] = await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null)], "en"),
    );
    // Written straight into the table: `createMenuItem` refuses a variant.
    await fx.db
      .insert(menuItems)
      .values({ menuId: f.menuId, productId: w125!.id, sectionId: f.sectionId, grossPrice: 900 });
    expect((await offers()).map((offer) => offer.productId)).toEqual([f.parentId]);
  });

  it("charges a price set for the variant on this menu, and switches it off there", async () => {
    const [, w175] = await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await run((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: "6.00", offered: true }]),
    );
    expect((await nested())[1]).toEqual({
      name: "Wine 175",
      unitPrice: "6.00",
      menuPrice: "6.00",
      offered: true,
      available: true,
    });

    await run((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: null, offered: false }]),
    );
    expect((await nested())[1]).toEqual({
      name: "Wine 175",
      unitPrice: "5.50",
      menuPrice: null,
      offered: false,
      available: false,
    });

    await run((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: null, offered: true }]),
    );
    expect((await nested())[1]).toMatchObject({
      unitPrice: "5.50",
      offered: true,
      available: true,
    });
  });

  it("lists an Unavailable variant as unavailable and leaves an Inactive one out", async () => {
    const [w125, w175] = await run((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("Wine 125", null), wine("Wine 175", "5.50", false), wine("Wine 250", "7.00")],
        "en",
      ),
    );
    // Wine 250 is left out of this save, so it becomes Inactive.
    await run((tx) => setProductVariants(tx, f.parentId, [w125!, w175!], "en"));
    expect(await nested()).toEqual([
      { name: "Wine 125", unitPrice: "4.50", menuPrice: null, offered: true, available: true },
      { name: "Wine 175", unitPrice: "5.50", menuPrice: null, offered: true, available: false },
    ]);
  });

  it("takes the offer and its variants away when the parent is Inactive or Unavailable", async () => {
    await run((tx) => setProductVariants(tx, f.parentId, [wine("Wine 125", null)], "en"));
    await run((tx) => updateProduct(tx, f.parentId, { available: false }));
    expect(await offers()).toEqual([]);
    await run((tx) => updateProduct(tx, f.parentId, { available: true, active: false }));
    expect(await offers()).toEqual([]);
  });

  it("still lists a parent none of whose variants is offered here, every variant unavailable", async () => {
    const [w125, w175] = await run((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await run((tx) =>
      setMenuVariants(tx, f.offerId, [
        { variantId: w125!.id, price: null, offered: false },
        { variantId: w175!.id, price: null, offered: false },
      ]),
    );
    expect(await offers()).toHaveLength(1);
    expect((await nested()).map(({ available }) => available)).toEqual([false, false]);
  });

  it("lists only top-level products, each with its Active variants nested in order", async () => {
    const [w125, w175] = await run((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("Wine 125", null), wine("Wine 175", "5.50"), wine("Wine 250", "7.00")],
        "en",
      ),
    );
    await run((tx) => setProductVariants(tx, f.parentId, [w175!, w125!], "en"));
    const listed = await run((tx) => listProducts(tx, f.menuId));
    expect(listed.map((product) => product.id)).toEqual([f.parentId]);
    expect(
      listed[0]!.variants.map(({ name, unitPrice, active }) => ({ name, unitPrice, active })),
    ).toEqual([
      { name: "Wine 175", unitPrice: "5.50", active: true },
      { name: "Wine 125", unitPrice: null, active: true },
    ]);
  });
});
