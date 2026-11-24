import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { readMenuStructure } from "./menu-structure.js";
import { customItemProduct } from "./custom-item-products.js";
import { listProductVariants, setMenuVariants, setProductVariants } from "./variants.js";
import { applyLiveFields } from "./menu-document.js";
import { previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { menusFixture } from "../test/menus-fixture.js";
import {
  menuItems,
  menus,
  products,
  productTakeawayVatRates,
  sections,
  taxpayer,
  withTransaction,
  readActivityForSubject,
} from "@waitron/db";
import {
  seedTaxpayer,
  seedPerson,
  seedTakeawayVatRate,
  seedVenueSettings,
} from "@waitron/db/testing/seed.js";
import type { Transaction } from "@waitron/db";
import { priceBasket } from "./pricing.js";
import type { PriceableProduct } from "./pricing.js";
import type { PricingUnit } from "@waitron/shared";
import {
  overlayDietProfile,
  UNDECLARED_DIET,
  type DietOverride,
  customerPresentationText,
} from "@waitron/shared";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";
import { readDefaultMenuId } from "./operations.js";
import { readTakeawayVatSchedules } from "./takeaway-vat-rates.js";
import {
  assignMenuToVenue,
  menuExists,
  createMenu,
  createCategory,
  addProductToMenu,
  createProduct,
  deactivateMenu,
  deactivateProduct,
  listAvailableProducts,
  listMenus,
  listCategories,
  listMenuOffers,
  listProducts,
  readInvoiceLocales,
  readReceiptLanguage,
  setVenueDefaultMenu,
  updateMenuDetails,
  updateCategory,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import type { AvailableProduct } from "./operations.js";
import { createUnit, EACH_UNIT, reassignProductsToUnit } from "./units.js";
import {
  countingReadsOf,
  countingSettingsReads,
  seedMenuFixture,
  seedLegacySellingUnits,
  seedVenueWithSeries,
  storedUnitId,
  useMenuDb,
} from "../test/fixtures.js";
import { libraryImageName, seedLibraryImages } from "../test/library-images.js";

// The till resolves an AvailableProduct's customer-facing text (customerName, falling back to the
// staff name) before pricing — the three-name model's seam between a menu read and a sale
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

// Query behaviour. Each case starts with empty authoring tables.
const fx = useMenuDb();
beforeEach(async () => {
  await seedPerson(fx.db, { id: "person-1", displayName: "Test person-1" });
});

beforeEach(() => seedLibraryImages(fx.db, "x.webp", "y.png"));

describe("menu operations", () => {
  it("creates a product with no menu", async () => {
    await asVenue(async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Tea",
        unitId: null,
        unitPrice: "2.00",
        vatClass: "general",
      });
      expect(await listProducts(tx)).toEqual([product]);
      expect(product).toMatchObject({ name: "Tea", unitPrice: "2.00" });
    });
  });
  it("round-trips independent product description and kitchen name, and clears both", async () => {
    await asVenue(async (tx) => {
      const product = await createProduct(tx, {
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
      expect((await listProducts(tx))[0]).toEqual(product);
      await updateProduct(tx, product.id, { description: null, kitchenName: null });
      expect((await listProducts(tx))[0]).toMatchObject({
        name: "Coffee",
        customerName: { en: "Coffee", es: "Café" },
        description: null,
        kitchenName: null,
      });
    });
  });
  it("offers one product on two menus with distinct identities and prices", async () => {
    await asVenue(async (tx) => {
      const category = await createCategory(tx, { name: "Cocktails" });
      const upstairs = await createMenu(tx, { name: "Upstairs" });
      const downstairs = await createMenu(tx, { name: "Downstairs" });
      const product = await createProduct(tx, {
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
      ).rejects.toMatchObject({ code: "menu.not_found" });
    });
  });

  it("keeps a category-less product visible with its null category", async () => {
    await asVenue(async (tx) => {
      const menu = await createMenu(tx, { name: "Counter" });
      const product = await createProduct(tx, {
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

  let eachUnitId: string;
  let kgUnitId: string;

  beforeEach(async () => {
    await seedVenueWithSeries(fx.db);
    await withTransaction(fx.db, async (tx) => {
      eachUnitId = (
        await createUnit(
          tx,
          {
            staffName: "Staff unit",
            staffAbbreviation: "su",
            name: { en: "each" },
            precision: 0,
            abbreviation: { en: "u" },
          },
          "en",
        )
      ).id;
      kgUnitId = (
        await createUnit(
          tx,
          {
            staffName: "Staff unit",
            staffAbbreviation: "su",
            name: { en: "kg" },
            precision: 3,
            abbreviation: { en: "u" },
          },
          "en",
        )
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
  const asVenue = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(fx.db, async (tx) => {
      return fn(tx);
    });

  it("creates and lists menus", async () => {
    await asVenue(async (tx) => {
      const deli = await createMenu(tx, { name: "Deli" });
      const stall = await createMenu(tx, { name: "Drinks stall" });
      expect(deli.active).toBe(true);
      expect(deli).not.toHaveProperty("version");
      const cats = await listMenus(tx);
      expect(cats.map((c) => c.name).sort()).toEqual(["Deli", "Drinks stall"]);
      expect(cats.map((c) => c.id).sort()).toEqual([deli.id, stall.id].sort());
    });
  });

  it("creates and lists categories", async () => {
    await asVenue(async (tx) => {
      const food = await createCategory(tx, { name: "Food" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const cats = await listCategories(tx);
      expect(cats.map((c) => c.name).sort()).toEqual(["Drinks", "Food"]);
      expect(cats.map((c) => c.id).sort()).toEqual([drinks.id, food.id].sort());
    });
  });

  it("creates and lists every product", async () => {
    await asVenue(async (tx) => {
      const ham = await createProduct(tx, {
        categoryId: null,
        name: "sliced ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const water = await createProduct(tx, {
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      const olives = await createProduct(tx, {
        categoryId: null,
        name: "olives",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
      });
      const products = await listProducts(tx);
      expect(products.map((p) => p.id).sort()).toEqual([ham.id, water.id, olives.id].sort());
      const seenHam = products.find((p) => p.id === ham.id)!;
      expect(seenHam.unit).toEqual({
        staffName: "Staff unit",
        staffAbbreviation: "su",
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
  // ORDER the read returns and nothing pins the `id` in `listProducts`'s `orderBy`. Rows with the same
  // minting time can sort in either ID order.
  it("settles a created_at tie on the product id rather than on insert order", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      const sameMoment = new Date("2026-09-22T10:00:00.000Z");
      const row = (id: string, name: string) => ({
        id,
        menuId: cat.id,
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
      await seedTakeawayVatRate(tx, [
        "ffffffff-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ]);
      expect((await listProducts(tx)).map((p) => p.name)).toEqual([
        "written second",
        "written first",
      ]);
    });
  });

  it("reads a product with no unit as the synthetic Each unit", async () => {
    await asVenue(async (tx) => {
      // Create a normal product, then clear its stored unit so the read exercises the
      // null-join branch of a product that has no stored unit at all.
      const product = await createProduct(tx, {
        categoryId: null,
        name: "loose sweets",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await tx.execute(sql`update products set unit_id = null where id = ${product.id}`);
      const [seen] = await listProducts(tx);
      // toEqual(EACH_UNIT) asserts the whole synthetic unit, hardwareUnit: null included.
      expect(seen!.unit).toEqual(EACH_UNIT);
      expect(seen!.unit.id).toBe("00000000-0000-0000-0000-000000000001");
      expect(seen!.unitId).toBe("00000000-0000-0000-0000-000000000001");
      expect(seen!.pricingUnit).toBe("each");
    });
  });

  it("creates a product with no unit when unitId is null", async () => {
    await asVenue(async (tx) => {
      const created = await createProduct(tx, {
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
    await asVenue(async (tx) => {
      const created = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, created.id, { unitId: null });
      expect(await storedUnitId(tx, created.id)).toBeNull();
      const [after] = await tx
        .select({ p: products.unitId })
        .from(products)
        .where(eq(products.id, created.id));
      expect(after!.p).toBeNull();
    });
  });

  it("leaves a product's unit unchanged when neither unitId nor pricingUnit is patched", async () => {
    await asVenue(async (tx) => {
      const created = await createProduct(tx, {
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
    await asVenue(async (tx) => {
      const created = await createProduct(tx, {
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

  it("refuses an empty unit id on create and on update, leaving the stored unit as it was", async () => {
    await asVenue(async (tx) => {
      await expect(
        createProduct(tx, {
          categoryId: null,
          name: "Stray",
          unitId: "",
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ).rejects.toMatchObject({ code: "unit.not_found", params: { unitId: "" } });
      expect(await listProducts(tx)).toEqual([]);

      const created = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await expect(updateProduct(tx, created.id, { unitId: "" })).rejects.toMatchObject({
        code: "unit.not_found",
        params: { unitId: "" },
      });
      expect(await storedUnitId(tx, created.id)).toBe(kgUnitId);
    });
  });

  it("refuses a create naming an unknown category before writing the product", async () => {
    await asVenue(async (tx) => {
      const missing = crypto.randomUUID();
      await expect(
        createProduct(tx, {
          categoryId: missing,
          name: "Stray",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
      // Read inside the same transaction, which a refused create leaves open for the caller.
      expect(await listProducts(tx)).toEqual([]);
    });
  });

  it("reports an unknown category when creating a product without a menu", async () => {
    const missing = crypto.randomUUID();
    await expect(
      asVenue((tx) =>
        createProduct(tx, {
          categoryId: missing,
          name: "Stray",
          unitId: eachUnitId,
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ),
    ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
  });

  it("still rejects a create with neither unitId nor pricingUnit", async () => {
    await asVenue(async (tx) => {
      await expect(
        createProduct(tx, {
          categoryId: null,
          name: "mystery",
          unitPrice: "0.00",
          vatClass: "general",
        }),
      ).rejects.toMatchObject({ code: "product.invalid", params: { field: "unitId" } });
    });
  });

  it("rejects a create whose legacy pricingUnit is neither 'each' nor 'weight'", async () => {
    await asVenue(async (tx) => {
      await expect(
        createProduct(tx, {
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
    await asVenue(async (tx) => {
      const product = await createProduct(tx, {
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

  it("legacy pricingUnit 'each' on update clears a product's unit", async () => {
    await asVenue(async (tx) => {
      const ham = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, ham.id, { pricingUnit: "each" });
      expect(await storedUnitId(tx, ham.id)).toBeNull();
    });
  });

  it("refuses legacy pricingUnit 'weight' on create and update when no kg seed is kept", async () => {
    await asVenue(async (tx) => {
      const ham = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        unitId: eachUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await tx.execute(sql`update units set seed_key = null where id = ${kgUnitId}`);
      await expect(
        createProduct(tx, {
          categoryId: null,
          name: "salami",
          pricingUnit: "weight",
          unitPrice: "24.90",
          vatClass: "reduced",
        }),
      ).rejects.toMatchObject({ code: "product.invalid", params: { field: "unitId" } });
      await expect(updateProduct(tx, ham.id, { pricingUnit: "weight" })).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "unitId" },
      });
      expect(await storedUnitId(tx, ham.id)).toBe(eachUnitId);
    });
  });

  it("attaches legacy product creates to the taxpayer's real seeded unit", async () => {
    await asVenue(async (tx) => {
      const ham = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const assignments = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from products
        where id = ${ham.id}`);
      expect(assignments.rows).toEqual([{ unit_id: kgUnitId }]);
      expect(ham.unit).toEqual({
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: kgUnitId,
        name: { en: "kg" },
        precision: 3,
        hardwareUnit: "kg",
        abbreviation: { en: "u" },
      });
    });
  });

  it("keeps the legacy pricing sentinel coherent when a product's unit changes", async () => {
    await asVenue(async (tx) => {
      const ham = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, ham.id, { unitId: eachUnitId });
      const stored = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from products
        where id = ${ham.id}`);
      expect(stored.rows).toEqual([{ unit_id: eachUnitId }]);
      const [updated] = await listProducts(tx);
      expect(updated).toMatchObject({
        unitId: eachUnitId,
        pricingUnit: "each",
        unit: { id: eachUnitId, precision: 0, hardwareUnit: null },
      });
    });
  });

  it("keeps the real unit assignment coherent when a legacy product changes pricing basis", async () => {
    await asVenue(async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        pricingUnit: "each",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await updateProduct(tx, product.id, { pricingUnit: "weight" });
      const assignments = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from products
        where id = ${product.id}`);
      expect(assignments.rows).toEqual([{ unit_id: kgUnitId }]);
      const [updated] = await listProducts(tx);
      expect(updated).toMatchObject({
        unitId: kgUnitId,
        pricingUnit: "weight",
        unit: { id: kgUnitId, precision: 3, hardwareUnit: "kg" },
      });
    });
  });

  it("updates a product's price and description", async () => {
    await asVenue(async (tx) => {
      const water = await createProduct(tx, {
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
      const [seen] = await listProducts(tx);
      expect(seen!.unitPrice).toBe("1.80");
      expect(seen!.name).toBe("sparkling water");
    });
  });

  it("threads a product's image through create, update and list", async () => {
    await asVenue(async (tx) => {
      // Created WITH an image: the stored reference round-trips out of createProduct and listProducts.
      const withImage = await createProduct(tx, {
        categoryId: null,
        name: "ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
        image: libraryImageName("x.webp"),
      });
      expect(withImage.image).toBe(libraryImageName("x.webp"));
      // Omitting `image` leaves it null (no picture — distinct from allergens' PENDING null).
      const noImage = await createProduct(tx, {
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(noImage.image).toBeNull();
      const listed = await listProducts(tx);
      expect(listed.find((p) => p.id === withImage.id)!.image).toBe(libraryImageName("x.webp"));
      expect(listed.find((p) => p.id === noImage.id)!.image).toBeNull();
      // updateProduct sets a new image reference…
      await updateProduct(tx, noImage.id, { image: libraryImageName("y.png") });
      const afterSet = (await listProducts(tx)).find((p) => p.id === noImage.id)!;
      expect(afterSet.image).toBe(libraryImageName("y.png"));
      // …and `null` clears it back to no-picture.
      await updateProduct(tx, noImage.id, { image: null });
      const afterClear = (await listProducts(tx)).find((p) => p.id === noImage.id)!;
      expect(afterClear.image).toBeNull();
    });
  });

  it("archives a product through updateProduct and refuses switching it back on", async () => {
    const { p } = await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      const p = await createProduct(tx, {
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(p.active).toBe(true);
      await updateProduct(tx, p.id, { active: false });
      expect((await listProducts(tx)).find((x) => x.id === p.id)!.active).toBe(false);
      return { cat, p };
    });
    await expect(asVenue((tx) => updateProduct(tx, p.id, { active: true }))).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: p.id },
    });
    expect((await asVenue((tx) => listProducts(tx))).find((x) => x.id === p.id)!.active).toBe(
      false,
    );
  });

  it("creates a product inactive when active:false, active by default when omitted", async () => {
    await asVenue(async (tx) => {
      // Created INACTIVE in one write: the flag round-trips out of createProduct.
      const hidden = await createProduct(tx, {
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
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(shown.active).toBe(true);
      // Both round-trip through listProducts.
      const listed = await listProducts(tx);
      expect(listed.find((p) => p.id === hidden.id)!.active).toBe(false);
      expect(listed.find((p) => p.id === shown.id)!.active).toBe(true);
    });
  });

  it("creates a product with the ordering it is given, public when it is given none", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      const base = {
        menuId: cat.id,
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
      const listed = await listProducts(tx);
      expect(listed.find((p) => p.id === bacon.id)!.ordering).toBe("not_sold_separately");
      expect(listed.find((p) => p.id === water.id)!.ordering).toBe("public");
    });
  });

  it("changes a product's ordering through updateProduct and leaves it alone when not named", async () => {
    await asVenue(async (tx) => {
      const p = await createProduct(tx, {
        categoryId: null,
        name: "bacon",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await updateProduct(tx, p.id, { ordering: "not_sold_separately" });
      await updateProduct(tx, p.id, { name: "streaky bacon" });
      const listed = (await listProducts(tx)).find((x) => x.id === p.id)!;
      expect(listed.ordering).toBe("not_sold_separately");
    });
  });

  it("updateProduct publishes the declaration sorted and de-duplicated", async () => {
    await asVenue(async (tx) => {
      const p = await createProduct(tx, {
        categoryId: null,
        name: "Bread",
        unitId: eachUnitId,
        unitPrice: "1.20",
        vatClass: "general",
      });
      const input = {
        nuts: { kinds: ["walnuts" as const, "almonds" as const, "almonds" as const] },
      };
      await updateProduct(tx, p.id, { allergens: input });
      const [row] = await tx
        .select({ allergens: products.allergens })
        .from(products)
        .where(eq(products.id, p.id));
      expect(row!.allergens).toEqual({ nuts: { kinds: ["almonds", "walnuts"] } });
    });
  });

  it("round-trips a product's allergens", async () => {
    await asVenue(async (tx) => {
      const p = await createProduct(tx, {
        categoryId: null,
        name: "bread",
        unitId: eachUnitId,
        unitPrice: "1.20",
        vatClass: "general",
        allergens: { gluten: { kinds: ["wheat" as const] } },
      });
      expect(p.allergens).toEqual({ gluten: { kinds: ["wheat" as const] } });
      const [listed] = await listProducts(tx);
      expect(listed!.allergens).toEqual({ gluten: { kinds: ["wheat" as const] } });
    });
  });

  it("defaults allergens to null (unreviewed) when omitted", async () => {
    await asVenue(async (tx) => {
      const p = await createProduct(tx, {
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      expect(p.allergens).toBeNull();
    });
  });

  it.each([null, {}])("keeps allergens %j through create and update", async (allergens) => {
    await asVenue(async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Reviewed tea",
        unitId: null,
        unitPrice: "1.00",
        vatClass: "general",
        ...(allergens === null ? {} : { allergens }),
      });
      expect(product.allergens).toEqual(allergens);
      await updateProduct(tx, product.id, { allergens: { milk: {} } });
      await updateProduct(tx, product.id, { allergens });
      const [stored] = await tx
        .select({ allergens: products.allergens })
        .from(products)
        .where(eq(products.id, product.id));
      expect(stored!.allergens).toEqual(allergens);
      expect((await listProducts(tx)).find((row) => row.id === product.id)!.allergens).toEqual(
        allergens,
      );
    });
  });

  it("rejects an invalid allergen code on create", async () => {
    await asVenue(async (tx) => {
      await expect(
        createProduct(tx, {
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
    await asVenue(async (tx) => {
      const p = await createProduct(tx, {
        categoryId: null,
        name: "cake",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { eggs: {} },
      });
      // An invalid code on update is rejected before the write.
      await expect(
        updateProduct(tx, p.id, {
          allergens: { nope: { presence: "contains" } } as never,
        }),
      ).rejects.toMatchObject({ code: "allergen.invalid_code" });
      // A valid update is written back.
      await updateProduct(tx, p.id, { allergens: { milk: {} } });
      const [afterSet] = await listProducts(tx);
      expect(afterSet!.allergens).toEqual({ milk: {} });
      // `null` clears the declaration back to unreviewed.
      await updateProduct(tx, p.id, { allergens: null });
      const [afterClear] = await listProducts(tx);
      expect(afterClear!.allergens).toBeNull();
    });
  });

  it("listAvailableProducts returns allergens", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      await createProduct(tx, {
        categoryId: null,
        name: "milk",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
        allergens: { milk: {} },
      });
      await assignMenuToVenue(tx, cat.id);
      const [available] = (await listAvailableProducts(tx)).products;
      expect(available!.allergens).toEqual({ milk: {} });
    });
  });

  it("listAvailableProducts carries a measure unit's switch, and no key for one without it", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Bar" });
      const ml = await createUnit(
        tx,
        {
          staffName: "ml",
          staffAbbreviation: "ml",
          name: { en: "ml" },
          precision: 0,
          abbreviation: { en: "ml" },
          measure: true,
        },
        "en",
      );
      for (const [name, unitId] of [
        ["vermut", ml.id],
        ["olives", eachUnitId],
      ] as const) {
        await createProduct(tx, {
          categoryId: null,
          name,
          unitId,
          unitPrice: "1.00",
          vatClass: "general",
        });
      }
      await assignMenuToVenue(tx, cat.id);
      const available = (await listAvailableProducts(tx)).products;

      expect(available.find((p) => p.name === "vermut")!.unit.measure).toBe(true);
      expect(available.find((p) => p.name === "olives")!.unit).not.toHaveProperty("measure");
    });
  });

  it("listAvailableProducts carries the diet profile", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      await createProduct(tx, {
        categoryId: null,
        name: "falafel wrap",
        unitId: eachUnitId,
        unitPrice: "6.00",
        vatClass: "general",
        dietOverride: { vegan: "no", halal: "yes", addContains: ["meat"] },
      });

      await assignMenuToVenue(tx, cat.id);
      const [available] = (await listAvailableProducts(tx)).products;

      expect(available!.diet).toMatchObject({ vegan: "no", halal: "yes", contains: ["meat"] });
      expect(available!.dietOverride).toEqual({ vegan: "no", halal: "yes", addContains: ["meat"] });
    });
  });

  it("createProduct publishes the manual allergen map", async () => {
    const result = await withTransaction(fx.db, async (tx) => {
      const p = await createProduct(tx, {
        categoryId: null,
        name: "sandwich",
        unitId: eachUnitId,
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { gluten: { kinds: ["wheat" as const] } },
      });
      return p;
    });
    expect(result.allergens).toEqual({ gluten: { kinds: ["wheat" as const] } });
  });

  // The management read exposes the staff diet OVERRIDE distinctly from the published `diet`, so
  // the dashboard's editor can seed its controls from the manual value. No override reads `null`.
  it("exposes diet_override on the management product read", async () => {
    const [withOverride, without] = await withTransaction(fx.db, async (tx) => {
      const forced = await createProduct(tx, {
        categoryId: null,
        name: "falafel",
        unitId: eachUnitId,
        unitPrice: "4.00",
        vatClass: "general",
        dietOverride: { vegan: "no", halal: "yes", addContains: ["meat"] },
      });
      const plain = await createProduct(tx, {
        categoryId: null,
        name: "plain",
        unitId: eachUnitId,
        unitPrice: "1.00",
        vatClass: "general",
      });
      const rows = await listProducts(tx);
      return [rows.find((p) => p.id === forced.id)!, rows.find((p) => p.id === plain.id)!];
    });
    expect(withOverride.dietOverride).toEqual({ vegan: "no", halal: "yes", addContains: ["meat"] });
    expect(without.dietOverride).toBeNull();
  });

  // A caller-supplied id that names no product is a SILENT no-op, as for every other patch field.
  it("updateProduct with allergens on a nonexistent id does not throw and affects no row", async () => {
    await asVenue(async (tx) => {
      const missing = "00000000-0000-0000-0000-0000000000ff";
      await expect(
        updateProduct(tx, missing, { allergens: { eggs: {} } }),
      ).resolves.toBeUndefined();
      // No row was created or altered: the menu stays empty.
      expect(await listProducts(tx)).toEqual([]);
    });
  });

  const readDiet = async (tx: Transaction, id: string) =>
    (await listProducts(tx))
      .filter((row) => row.id === id)
      .map((row) => ({ diet: row.diet, override: row.dietOverride }));

  it("createProduct with no override publishes an unknown (cautious) diet profile", async () => {
    const [row] = await asVenue(async (tx) => {
      const p = await createProduct(tx, {
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
    const [row] = await asVenue(async (tx) => {
      const p = await createProduct(tx, {
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
    await asVenue(async (tx) => {
      await expect(
        createProduct(tx, {
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

  it("updateProduct rejects a conflicting diet override", async () => {
    await asVenue(async (tx) => {
      const p = await createProduct(tx, {
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
    const [row] = await asVenue(async (tx) => {
      const p = await createProduct(tx, {
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

  it("renaming a menu writes one row", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      await updateMenuDetails(tx, cat.id, { name: "Delicatessen" });
      const [seen] = await listMenus(tx);
      expect(seen!.name).toBe("Delicatessen");
      const structure = await readMenuStructure(tx, cat.id);
      expect(structure.root.internalName).toBe("Delicatessen");
      const [root] = await tx
        .select({ name: sections.internalName })
        .from(sections)
        .where(eq(sections.id, structure.rootSectionId));
      expect(root!.name).toBeNull();
    });
  });

  it("renames a category", async () => {
    await asVenue(async (tx) => {
      const food = await createCategory(tx, { name: "Food" });
      await updateCategory(tx, food.id, { name: "Fresh food" });
      const [seen] = await listCategories(tx);
      expect(seen!.name).toBe("Fresh food");
    });
  });

  it("lists only the active products of the venue's menus, with the category name resolved", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      const food = await createCategory(tx, { name: "Food" });
      const p1 = await createProduct(tx, {
        categoryId: food.id,
        name: "sliced ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const p2 = await createProduct(tx, {
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await deactivateProduct(tx, p2.id);
      await assignMenuToVenue(tx, cat.id);
      const { products: available } = await listAvailableProducts(tx);
      expect(available.map((p) => p.id)).toEqual([p1.id]);
      expect(available[0]!.category).toBe("Food");
      expect(available[0]!.unitPrice).toBe("24.90");
      expect(available[0]!.unit).toMatchObject({ id: kgUnitId, name: { en: "kg" }, precision: 3 });
      expect(available[0]!.vatClass).toBe("reduced");
    });
  });

  it("lists active products regardless of their former menu state", async () => {
    await asVenue(async (tx) => {
      const main = await createMenu(tx, { name: "Main" });
      const lunch = await createMenu(tx, { name: "Lunch" });
      const old = await createMenu(tx, { name: "Old" });
      for (const [menu, name] of [
        [main, "Steak"],
        [lunch, "Set menu"],
        [old, "Hidden"],
      ] as const) {
        const product = await createProduct(tx, {
          categoryId: null,
          name,
          unitId: eachUnitId,
          unitPrice: "9.00",
          vatClass: "general",
        });
        await tx
          .update(products)
          .set({
            createdAt: new Date(`2026-01-0${[main, lunch, old].indexOf(menu) + 1}T00:00:00.000Z`),
          })
          .where(eq(products.id, product.id));
      }
      await assignMenuToVenue(tx, main.id);
      await deactivateMenu(tx, old.id);
      const { products: rows } = await listAvailableProducts(tx);
      expect(rows.map(({ name }) => name)).toEqual(["Steak", "Set menu", "Hidden"]);
    });
  });

  it("lists products by creation time when the venue has no default", async () => {
    await asVenue(async (tx) => {
      for (const name of ["Lunch", "Main"]) {
        const product = await createProduct(tx, {
          categoryId: null,
          name,
          unitId: eachUnitId,
          unitPrice: "9.00",
          vatClass: "general",
        });
        await tx
          .update(products)
          .set({
            createdAt: new Date(
              name === "Lunch" ? "2026-01-01T00:00:00.000Z" : "2026-01-02T00:00:00.000Z",
            ),
          })
          .where(eq(products.id, product.id));
      }
      expect((await listAvailableProducts(tx)).products.map(({ name }) => name)).toEqual([
        "Lunch",
        "Main",
      ]);
    });
  });

  it("readInvoiceLocales returns the venue's invoice languages in order", async () => {
    await asVenue(async (tx) => {
      await tx.execute(
        sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["es-ES","en-GB"]')) where module = 'venue'`,
      );
      expect(await readInvoiceLocales(tx)).toEqual(["es-ES", "en-GB"]);
    });
  });

  it("readReceiptLanguage reads the venue's first saved language", async () => {
    await asVenue(async (tx) => {
      await tx.execute(
        sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["gl-ES","es-ES"]')) where module = 'venue'`,
      );
      expect(await readReceiptLanguage(tx)).toEqual({
        locale: "gl-ES",
        invoiceLocales: ["gl-ES", "es-ES"],
      });
    });
  });

  it("setVenueDefaultMenu moves the default flag and leaves one default", async () => {
    await asVenue(async (tx) => {
      const house = await createMenu(tx, { name: "House" });
      const day = await createMenu(tx, { name: "Day" });
      await setVenueDefaultMenu(tx, house.id);
      await setVenueDefaultMenu(tx, day.id);
      expect(
        (
          await tx.execute<{ id: string; is_default: number }>(sql`
        select id, is_default from menus order by name`)
        ).rows,
      ).toEqual([
        { id: day.id, is_default: 1 },
        { id: house.id, is_default: 0 },
      ]);
    });
  });

  it("setVenueDefaultMenu moves the default and leaves the old default an active menu", async () => {
    await asVenue(async (tx) => {
      const house = await createMenu(tx, { name: "Casa" });
      const day = await createMenu(tx, { name: "Día" });
      await assignMenuToVenue(tx, house.id);
      await setVenueDefaultMenu(tx, day.id);
      expect(await readDefaultMenuId(tx)).toBe(day.id);
      expect((await listMenus(tx)).find(({ id }) => id === house.id)).toMatchObject({
        active: true,
      });
    });
  });

  it("setVenueDefaultMenu sets the default when the venue had none", async () => {
    await asVenue(async (tx) => {
      const house = await createMenu(tx, { name: "Casa" });
      await setVenueDefaultMenu(tx, house.id);
      expect(await readDefaultMenuId(tx)).toBe(house.id);
    });
  });

  describe.each([["setVenueDefaultMenu", setVenueDefaultMenu]] as const)(
    "%s with an id naming nothing",
    (_name, write) => {
      it("refuses an unknown menu with menu.not_found", async () => {
        const missing = crypto.randomUUID();
        await expect(asVenue((tx) => write(tx, missing))).rejects.toMatchObject({
          code: "menu.not_found",
          params: { menuId: missing },
        });
      });
    },
  );

  it("menuExists is true for an existing menu and false for an absent id", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Casa" });
      expect(await menuExists(tx, cat.id)).toBe(true);
      expect(await menuExists(tx, "00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });

  it("returns null category for an available product with no category", async () => {
    await asVenue(async (tx) => {
      const cat = await createMenu(tx, { name: "Deli" });
      await createProduct(tx, {
        categoryId: null,
        name: "water",
        unitId: eachUnitId,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignMenuToVenue(tx, cat.id);
      const [available] = (await listAvailableProducts(tx)).products;
      expect(available!.category).toBeNull();
      expect(available!.courseId).toBeNull();
    });
  });

  it("returns [] for a venue with no menu assigned", async () => {
    await asVenue(async (tx) => {
      expect((await listAvailableProducts(tx)).products).toEqual([]);
    });
  });

  it("keeps available products when a menu is deactivated", async () => {
    await asVenue(async (tx) => {
      const fixture = await seedMenuFixture(tx);
      const before = (await listAvailableProducts(tx)).products;
      expect(before).toHaveLength(2);
      await deactivateMenu(tx, fixture.menuId);
      expect((await listAvailableProducts(tx)).products).toEqual(before);
    });
  });

  it("returns products from a seeded menu that priceBasket can consume directly", async () => {
    await asVenue(async (tx) => {
      await seedMenuFixture(tx);
      const { products: available } = await listAvailableProducts(tx);
      expect(available.map((p) => p.category).sort()).toEqual(["Drinks", "Food"]);
      // The till prices menu rows by first resolving each one's customer-facing text; the
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
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: eachUnitId,
        name: { en: "each" },
        precision: 0,
        hardwareUnit: null,
        abbreviation: { en: "ea" },
      },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      takeawayVatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
    };
    const priceable = toPriceable(sample);
    // A blank customer name falls back to the staff name for the snapshotted line text.
    expect(priceable.descriptions).toEqual({ en: "water" });
    expect(priceable.unitPrice).toBe("1.50");
  });
  it("works out pricingUnit from the unit on every product read", async () => {
    await asVenue(async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Oil",
        unitId: eachUnitId,
        unitPrice: "2.00",
        vatClass: "general",
      });
      await reassignProductsToUnit(tx, eachUnitId, [product.id], kgUnitId);
      expect((await listProducts(tx))[0]!.pricingUnit).toBe("weight");
      expect(
        (await listAvailableProducts(tx)).products.find((row) => row.id === product.id)!
          .pricingUnit,
      ).toBe("weight");
      await reassignProductsToUnit(tx, kgUnitId, [product.id], null);
      expect((await listProducts(tx))[0]!.pricingUnit).toBe("each");
    });
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
    await seedVenueWithSeries(fx.db);
    f = await run(async (tx) => {
      const menu = await createMenu(tx, { name: "Bar" });
      const parent = await createProduct(tx, {
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
    const listed = await run((tx) => listProducts(tx));
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
  const PARENT_MANUAL = { nuts: { kinds: ["almonds" as const] } };
  const PARENT_DIET_OVERRIDE = { halal: "yes" as const };
  let parentId: string;
  let variantId: string;
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
    await seedVenueWithSeries(fx.db);
    ({ parentId, variantId } = await run(async (tx) => {
      const parent = await createProduct(tx, {
        categoryId: null,
        name: "Latte",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "reduced",
        allergens: PARENT_MANUAL,
        dietOverride: PARENT_DIET_OVERRIDE,
      });
      const [variant, bare] = await setProductVariants(
        tx,
        parent.id,
        [wine("Oat latte"), wine("Small latte")],
        "en",
      );
      return { parentId: parent.id, variantId: variant!.id, bareVariantId: bare!.id };
    }));
  });

  const published = (id: string) =>
    run(async (tx) => {
      const [row] = await tx
        .select({
          allergens: products.allergens,
          dietOverride: products.dietOverride,
          effectiveAllergens: effectiveProductColumns.allergens,
          effectiveDietOverride: effectiveProductColumns.dietOverride,
        })
        .from(products)
        .leftJoin(parentProducts, parentJoin)
        .where(eq(products.id, id));
      const { effectiveDietOverride, ...own } = row!;
      return {
        ...own,
        effectiveDiet: overlayDietProfile(
          UNDECLARED_DIET,
          effectiveDietOverride as DietOverride | null,
        ),
      };
    });

  it("a parent's change leaves a variant's own declaration and override as they are", async () => {
    await run(async (tx) => {
      await updateProduct(tx, variantId, {
        allergens: { milk: {} },
        dietOverride: { kosher: "yes" },
      });
      await updateProduct(tx, parentId, {
        allergens: { sesame: {} },
        dietOverride: { vegan: "yes" },
      });
    });
    const diet = { vegan: "unknown", vegetarian: "unknown", contains: [], kosher: "yes" };
    expect(await published(variantId)).toEqual({
      allergens: { milk: {} },
      dietOverride: { kosher: "yes" },
      effectiveAllergens: { milk: {} },
      effectiveDiet: diet,
    });
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
      dietOverride: null,
      effectiveAllergens: parent.allergens,
      effectiveDiet: parent.effectiveDiet,
    });
    expect(parent.allergens).toEqual({
      nuts: { kinds: ["almonds" as const] },
    });
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
      return (await applyLiveFields(tx, [live.get(f.lunch)!.document])).offers.get(f.lunch)!;
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
  let productId: string;
  let variantId: string;
  beforeEach(async () => {
    await seedTaxpayer(fx.db);
    await seedVenueSettings(fx.db);
    await seedLegacySellingUnits(fx.db);
    ({ productId, variantId } = await app(async (tx) => {
      const menu = await createMenu(tx, { name: "Menu" });
      const product = await createProduct(tx, {
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
      return { menuId: menu.id, productId: product.id, variantId: variant!.id };
    }));
  });

  const storedColor = async (id: string) =>
    (await fx.db.select({ color: products.color }).from(products).where(eq(products.id, id)))[0]!
      .color;

  it("stores a product's own colour, lists it, and clears it", async () => {
    await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
    expect(await storedColor(productId)).toBe("#256bb1");
    const listed = await app((tx) => listProducts(tx));
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

describe("declared product facts", () => {
  const asVenue = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
  beforeEach(async () => {
    await seedTaxpayer(fx.db);
    await seedVenueSettings(fx.db);
  });
  const input = {
    categoryId: null,
    name: "Tea",
    unitId: null,
    unitPrice: "2.00",
    vatClass: "general" as const,
  };
  it("refuses a negative price before the database does on create and update", async () => {
    await asVenue(async (tx) => {
      await expect(createProduct(tx, { ...input, unitPrice: "-1.00" })).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "unitPrice" },
      });
      const product = await createProduct(tx, input);
      await expect(updateProduct(tx, product.id, { unitPrice: "-1.00" })).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "unitPrice" },
      });
    });
  });
  it("refuses a blank name before the database does on create and update", async () => {
    await asVenue(async (tx) => {
      await expect(createProduct(tx, { ...input, name: "  " })).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "name" },
      });
      const product = await createProduct(tx, input);
      await expect(updateProduct(tx, product.id, { name: "  " })).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "name" },
      });
      await expect(
        setProductVariants(
          tx,
          product.id,
          [
            {
              name: "  ",
              customerName: null,
              kitchenName: null,
              image: null,
              unitPrice: null,
              available: true,
            },
          ],
          "en",
        ),
      ).rejects.toMatchObject({ code: "product.invalid", params: { field: "variants.0.name" } });
    });
  });
});

it("frees a deleted menu’s name and leaves only the replacement in the list", async () => {
  await withTransaction(fx.db, async (tx) => {
    const old = await createMenu(tx, { name: "Winter" });
    await deactivateMenu(tx, old.id);
    const replacement = await createMenu(tx, { name: "winter" });
    expect(replacement.id).not.toBe(old.id);
    expect((await listMenus(tx)).map(({ id }) => id)).toEqual([replacement.id]);
    const [retained] = await tx
      .select({ active: menus.active })
      .from(menus)
      .where(eq(menus.id, old.id));
    expect(retained).toEqual({ active: false });
  });
});

it("clears an inactive menu's default and refuses to set it again", async () => {
  await withTransaction(fx.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Winter" });
    await setVenueDefaultMenu(tx, menu.id);
    await deactivateMenu(tx, menu.id);
    expect(await readDefaultMenuId(tx)).toBeNull();
    await expect(setVenueDefaultMenu(tx, menu.id)).rejects.toMatchObject({
      code: "menu.deleted",
    });
  });
});

it("refuses edits to inactive menu details", async () => {
  await withTransaction(fx.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Winter" });
    await deactivateMenu(tx, menu.id);
    await expect(updateMenuDetails(tx, menu.id, { name: "Summer" })).rejects.toMatchObject({
      code: "menu.deleted",
    });
  });
});

it("records menu deletion once with the name and the given person", async () => {
  const personId = await seedPerson(fx.db);
  const menu = await withTransaction(fx.db, (tx) => createMenu(tx, { name: "Winter lunch" }));
  await withTransaction(fx.db, (tx) => deactivateMenu(tx, menu.id, personId));
  const entries = await readActivityForSubject(fx.db, { kind: "menu", id: menu.id });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "menu.deleted",
    subjectKind: "menu",
    subjectId: menu.id,
    personId,
    data: { name: "Winter lunch" },
  });
  await withTransaction(fx.db, (tx) => deactivateMenu(tx, menu.id, personId));
  expect(await readActivityForSubject(fx.db, { kind: "menu", id: menu.id })).toEqual(entries);
});

describe("the hidden products behind a custom item", () => {
  it.each([
    ["listProducts", listProducts],
    [
      "listAvailableProducts",
      async (tx: Transaction) => (await listAvailableProducts(tx)).products,
    ],
  ])("are left out of %s", async (_name, list) => {
    await seedTaxpayer(fx.db);
    await seedVenueSettings(fx.db);
    await withTransaction(fx.db, async (tx) => {
      const tea = await createProduct(tx, {
        categoryId: null,
        name: "Tea",
        unitId: null,
        unitPrice: "2.00",
      });
      await customItemProduct(tx, 2100);
      expect((await list(tx)).map(({ id }) => id)).toEqual([tea.id]);
      await customItemProduct(tx, null);
      expect((await list(tx)).map(({ id }) => id)).toEqual([tea.id]);
    });
  });
});

describe("a new product's takeaway VAT rate", () => {
  const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(fx.db, fn);
  const tea = { categoryId: null, name: "Tea", unitId: null, unitPrice: "2.00" } as const;
  beforeEach(async () => {
    await seedTaxpayer(fx.db);
    await seedVenueSettings(fx.db);
  });

  it("starts at the area's takeaway rate from the beginning of time", async () => {
    const product = await run((tx) => createProduct(tx, { ...tea, vatClass: "general" }));
    const schedules = await run((tx) => readTakeawayVatSchedules(tx, [product.id]));
    expect(schedules.get(product.id)).toEqual([{ from: null, rate: "10.00" }]);
  });

  it("starts at the rate the request names", async () => {
    const product = await run((tx) =>
      createProduct(tx, { ...tea, vatClass: "general", takeawayVatRate: "4.00" }),
    );
    const schedules = await run((tx) => readTakeawayVatSchedules(tx, [product.id]));
    expect(schedules.get(product.id)).toEqual([{ from: null, rate: "4.00" }]);
  });

  const productsNamed = (tx: Transaction, name: string) =>
    tx.select({ id: products.id }).from(products).where(eq(products.name, name));

  it("refuses a rate the area does not offer before writing the product, so a caller that catches it keeps none", async () => {
    const left = await run(async (tx) => {
      await expect(
        createProduct(tx, { ...tea, name: "Juice", vatClass: "general", takeawayVatRate: "5.00" }),
      ).rejects.toMatchObject({ code: "product.invalid", params: { field: "takeawayVatRate" } });
      return productsNamed(tx, "Juice");
    });
    expect(left).toEqual([]);
    const made = await run(async (tx) => {
      const { id } = await createProduct(tx, {
        ...tea,
        name: "Juice",
        vatClass: "general",
        takeawayVatRate: "4.00",
      });
      const rows = await tx
        .select({ startsOn: productTakeawayVatRates.startsOn, rate: productTakeawayVatRates.rate })
        .from(productTakeawayVatRates)
        .where(eq(productTakeawayVatRates.productId, id));
      return { products: await productsNamed(tx, "Juice"), rows };
    });
    expect(made).toEqual({
      products: [{ id: expect.any(String) }],
      rows: [{ startsOn: null, rate: 400 }],
    });
  });

  it("refuses an explicit null, which a product never has, rather than taking the default", async () => {
    const left = await run(async (tx) => {
      await expect(
        createProduct(tx, {
          ...tea,
          name: "Juice",
          vatClass: "general",
          takeawayVatRate: null as unknown as string,
        }),
      ).rejects.toMatchObject({ code: "product.invalid", params: { field: "takeawayVatRate" } });
      return productsNamed(tx, "Juice");
    });
    expect(left).toEqual([]);
  });

  it("checks against the area's rates a caller hands in, reading neither the taxpayer nor the settings", async () => {
    const rates = {
      dineIn: [{ from: null, rate: "10.00" }],
      pickable: ["5.00"],
      defaultTakeaway: "5.00",
    };
    const counts = await run(async (tx) => {
      const taxpayers = countingReadsOf(tx, taxpayer);
      const settingsReads = countingSettingsReads(taxpayers.tx);
      const { id } = await createProduct(
        settingsReads.tx,
        { ...tea, name: "Juice", vatClass: "general" },
        rates,
      );
      return {
        id,
        taxpayer: taxpayers.reads(),
        settings: settingsReads.reads(),
      };
    });
    expect({ taxpayer: counts.taxpayer, settings: counts.settings }).toEqual({
      taxpayer: 0,
      settings: 0,
    });
    const schedules = await run((tx) => readTakeawayVatSchedules(tx, [counts.id]));
    expect(schedules.get(counts.id)).toEqual([{ from: null, rate: "5.00" }]);
    const unread = await run(async (tx) => {
      const taxpayers = countingReadsOf(tx, taxpayer);
      await createProduct(taxpayers.tx, { ...tea, name: "Lemonade", vatClass: "general" });
      return taxpayers.reads();
    });
    expect(unread).toBe(1);
  });

  it("gives a variant no rate of its own", async () => {
    const variantId = await run(async (tx) => {
      const parent = await createProduct(tx, { ...tea, vatClass: "general" });
      const [variant] = await setProductVariants(
        tx,
        parent.id,
        [
          {
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            available: true,
          },
        ],
        "en",
      );
      return variant!.id;
    });
    const rows = await run((tx) =>
      tx
        .select()
        .from(productTakeawayVatRates)
        .where(eq(productTakeawayVatRates.productId, variantId)),
    );
    expect(rows).toEqual([]);
  });
});
