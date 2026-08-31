import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  asAppUser,
  optionGroupItems,
  optionGroups,
  productOptionGroups,
  withTenant,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { priceBasket } from "./pricing.js";
import type { PriceableProduct } from "./pricing.js";
import {
  addCatalogueToLocation,
  applyRecipeDerivation,
  assignCatalogueToLocation,
  catalogueExists,
  createCatalogue,
  createCategory,
  createOptionGroup,
  createOptionGroupItem,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
  listAccessibleCatalogues,
  listAvailableProducts,
  listCatalogues,
  listCataloguesForLocation,
  listCategories,
  listOptionGroupItems,
  listOptionGroups,
  listProductOptionGroupIds,
  listProducts,
  removeCatalogueFromLocation,
  setLocationDefaultCatalogue,
  renameCatalogue,
  renameCategory,
  setProductOptionGroups,
  updateOptionGroup,
  updateOptionGroupItem,
  updateProduct,
} from "./operations.js";
import { AppError } from "@waitron/shared";
import type { AvailableProduct } from "./operations.js";
import { seedCatalogueFixture, seedVenue } from "../test/fixtures.js";

// Behaviour and query-shape correctness run on PGlite: fast, hermetic, and enough for the joins and
// CRUD here. The cross-tenant ISOLATION GUARANTEE is proven separately, on real Postgres under a
// non-superuser probe role (operations.rls.test.ts) — the authoritative place for PostgreSQL's RLS
// and privilege semantics, per the brief and CLAUDE.md §4. Each test seeds a FRESH tenant so the
// suites are order-independent (every operation is scoped to `current_tenant_id()`).
const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

describe("catalogue operations", () => {
  let tenantId: TenantId;
  let locationId: string;

  beforeEach(async () => {
    // A fresh tenant per test (fresh NIF), so suites are order-independent: no test sees another's
    // rows, since every operation is scoped to `current_tenant_id()`.
    const venue = await seedVenue(fx.db);
    tenantId = venue.tenantId;
    locationId = venue.locationId;
  });

  // Every test body runs as app_user inside the current tenant's context. `tenantId` is refreshed
  // per test in beforeEach; this reads it at call time, so the one definition serves every test.
  const asTenant = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
        descriptions: { en: "sliced ham" },
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const water = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "water" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      // A product in a DIFFERENT catalogue must not leak into this catalogue's listing.
      await createProduct(tx, {
        catalogueId: other.id,
        categoryId: null,
        descriptions: { en: "olives" },
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      const products = await listProducts(tx, cat.id);
      expect(products.map((p) => p.id).sort()).toEqual([ham.id, water.id].sort());
      const seenHam = products.find((p) => p.id === ham.id)!;
      expect(seenHam.pricingUnit).toBe("weight");
      expect(seenHam.unitPrice).toBe("24.90");
      expect(seenHam.vatClass).toBe("reduced");
      expect(seenHam.descriptions).toEqual({ en: "sliced ham" });
      expect(seenHam.active).toBe(true);
    });
  });

  it("updates a product's price and description", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const water = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "water" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await updateProduct(tx, water.id, {
        unitPrice: "1.80",
        descriptions: { en: "sparkling water" },
      });
      const [seen] = await listProducts(tx, cat.id);
      expect(seen!.unitPrice).toBe("1.80");
      expect(seen!.descriptions).toEqual({ en: "sparkling water" });
    });
  });

  it("threads a product's image through create, update and list", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      // Created WITH an image: the stored reference round-trips out of createProduct and listProducts.
      const withImage = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "ham" },
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
        image: "x.webp",
      });
      expect(withImage.image).toBe("x.webp");
      // Omitting `image` leaves it null (no picture — distinct from allergens' PENDING null).
      const noImage = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "water" },
        pricingUnit: "each",
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
        descriptions: { en: "water" },
        pricingUnit: "each",
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
        descriptions: { en: "seasonal" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        active: false,
      });
      expect(hidden.active).toBe(false);
      // Omitting `active` leaves the column default (true) — today's behaviour, unchanged.
      const shown = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "water" },
        pricingUnit: "each",
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
        descriptions: { en: "bread" },
        pricingUnit: "each",
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
        descriptions: { en: "water" },
        pricingUnit: "each",
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
          descriptions: { en: "mystery" },
          pricingUnit: "each",
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
        descriptions: { en: "cake" },
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
        allergens: { eggs: { presence: "contains" } },
      });
      // An invalid code on update is rejected before the write.
      await expect(
        updateProduct(tx, p.id, { allergens: { nope: { presence: "contains" } } as never }),
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
        descriptions: { en: "milk" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        allergens: { milk: { presence: "contains" } },
      });
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const [available] = (await listAvailableProducts(tx, locationId)).products;
      expect(available!.allergens).toEqual({ milk: { presence: "contains" } });
    });
  });

  it("listAvailableProducts loads a product's active option groups & items, sorted", async () => {
    await asTenant(async (tx) => {
      const cat = await createCatalogue(tx, { name: "Deli" });
      const burger = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "burger" },
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      });
      // A second product with NO attached groups — must come back with optionGroups: [].
      const water = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "water" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });

      // Active group "Extras" attached to the burger, with two active items (a free one and a +0.50
      // one) plus an inactive item that must be excluded. Items are inserted out of sort order to
      // prove the read sorts, not the insert order.
      //
      // The group's OWN `option_groups.sort` (1 here) is set to DISAGREE with its per-attachment
      // `product_option_groups.sort` (0, below): group order within a product is driven by the
      // per-attachment column, so this fixture would produce ["Sauces", "Extras"] if the read ever
      // reverted to `option_groups.sort`, and the assertion below fails in that case.
      const [extras] = await tx
        .insert(optionGroups)
        .values({
          tenantId: sql`current_tenant_id()`,
          name: { en: "Extras" },
          minSelect: 0,
          maxSelect: 2,
          required: false,
          sort: 1,
          active: true,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values([
        {
          tenantId: sql`current_tenant_id()`,
          groupId: extras!.id,
          name: { en: "Bacon" },
          priceDelta: "0.50",
          vatClass: "reduced",
          sort: 1,
          active: true,
        },
        {
          tenantId: sql`current_tenant_id()`,
          groupId: extras!.id,
          name: { en: "Lettuce" },
          priceDelta: "0",
          vatClass: null,
          sort: 0,
          active: true,
        },
        {
          tenantId: sql`current_tenant_id()`,
          groupId: extras!.id,
          name: { en: "Gold leaf" },
          priceDelta: "5.00",
          vatClass: null,
          sort: 2,
          active: false,
        },
      ]);

      // An INACTIVE group also attached to the burger — must be excluded entirely.
      const [retired] = await tx
        .insert(optionGroups)
        .values({
          tenantId: sql`current_tenant_id()`,
          name: { en: "Retired" },
          sort: 1,
          active: false,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values({
        tenantId: sql`current_tenant_id()`,
        groupId: retired!.id,
        name: { en: "Old" },
        priceDelta: "1.00",
        vatClass: null,
        sort: 0,
        active: true,
      });

      // An ACTIVE group whose only item is INACTIVE — the group survives (active), but with no
      // selectable items it must resolve to `items: []` rather than being dropped. Its own
      // `option_groups.sort` (0) DISAGREES with its per-attachment sort (1, below): by the
      // per-attachment column it sorts AFTER "Extras"; by `option_groups.sort` it would sort BEFORE.
      const [sauces] = await tx
        .insert(optionGroups)
        .values({
          tenantId: sql`current_tenant_id()`,
          name: { en: "Sauces" },
          sort: 0,
          active: true,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values({
        tenantId: sql`current_tenant_id()`,
        groupId: sauces!.id,
        name: { en: "Discontinued ketchup" },
        priceDelta: "0",
        vatClass: null,
        sort: 0,
        active: false,
      });

      // Per-attachment sort drives group order within the product: Extras (0) before Sauces (1).
      // These DISAGREE with the groups' own `option_groups.sort` (Extras 1, Sauces 0), so the
      // expected order below can only be produced by `product_option_groups.sort`. Retired (2) is
      // inactive and excluded regardless.
      await tx.insert(productOptionGroups).values([
        { tenantId: sql`current_tenant_id()`, productId: burger.id, groupId: extras!.id, sort: 0 },
        { tenantId: sql`current_tenant_id()`, productId: burger.id, groupId: retired!.id, sort: 2 },
        { tenantId: sql`current_tenant_id()`, productId: burger.id, groupId: sauces!.id, sort: 1 },
      ]);

      await assignCatalogueToLocation(tx, locationId, cat.id);
      const { products } = await listAvailableProducts(tx, locationId);

      const burgerRow = products.find((p) => p.id === burger.id)!;
      const waterRow = products.find((p) => p.id === water.id)!;

      // The inactive group is gone; the active "Extras" and empty-but-active "Sauces" remain, in
      // group sort order.
      expect(burgerRow.optionGroups.map((g) => g.name.en)).toEqual(["Extras", "Sauces"]);
      // The active group with no active items surfaces with an empty item list, not dropped.
      expect(burgerRow.optionGroups[1]!.items).toEqual([]);
      const group = burgerRow.optionGroups[0]!;
      expect(group.id).toBe(extras!.id);
      expect(group.name).toEqual({ en: "Extras" });
      expect(group.minSelect).toBe(0);
      expect(group.maxSelect).toBe(2);
      expect(group.required).toBe(false);

      // Active items only, in sort order (Lettuce sort 0 then Bacon sort 1); Gold leaf excluded.
      expect(group.items.map((i) => i.name.en)).toEqual(["Lettuce", "Bacon"]);
      expect(group.items[0]).toEqual({
        id: group.items[0]!.id,
        name: { en: "Lettuce" },
        priceDelta: "0.00",
        vatClass: null,
        // Inserted without an explicit cap → the NOT-NULL default 1 (per-option quantity).
        maxQuantity: 1,
      });
      expect(group.items[1]).toMatchObject({
        name: { en: "Bacon" },
        priceDelta: "0.50",
        vatClass: "reduced",
      });

      // A product with nothing attached comes back with an empty array, not undefined.
      expect(waterRow.optionGroups).toEqual([]);
    });
  });

  // A product with no recipe still publishes exactly the manual value (today's behavior).
  it("createProduct publishes the manual allergen map when there is no recipe", async () => {
    const result = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "sandwich" },
        pricingUnit: "each",
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
    const seen = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "sandwich" },
        pricingUnit: "each",
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
    const seen = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "sandwich" },
        pricingUnit: "each",
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

  // A pending derivation forces PENDING (null), even with a manual overlay present.
  it("applyRecipeDerivation with pending=true publishes PENDING (null)", async () => {
    const seen = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "C" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "x" },
        pricingUnit: "each",
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
      const food = await createCategory(tx, { name: "Food" });
      await renameCategory(tx, food.id, "Fresh food");
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
        descriptions: { en: "sliced ham" },
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      const p2 = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { en: "water" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await deactivateProduct(tx, p2.id);
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const { products: available } = await listAvailableProducts(tx, locationId);
      expect(available.map((p) => p.id)).toEqual([p1.id]);
      expect(available[0]!.category).toBe("Food");
      expect(available[0]!.unitPrice).toBe("24.90");
      expect(available[0]!.pricingUnit).toBe("weight");
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
        descriptions: { en: "Steak" },
        pricingUnit: "each",
        unitPrice: "20.00",
        vatClass: "general",
      });
      const pLunch = await createProduct(tx, {
        catalogueId: lunch.id,
        categoryId: null,
        descriptions: { en: "Set menu" },
        pricingUnit: "each",
        unitPrice: "12.00",
        vatClass: "general",
      });
      await createProduct(tx, {
        catalogueId: other.id,
        categoryId: null,
        descriptions: { en: "Hidden" },
        pricingUnit: "each",
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
        sql`select count(*)::int as count from location_catalogues where location_id = ${locationId}`,
      );
      expect(members.rows[0]!.count).toBe(0);
    });
  });

  // The trust-boundary guard the location-menu write routes use: is this catalogue VISIBLE to the
  // current tenant? A same-tenant id is true; an absent id is false. (The cross-tenant/RLS-hidden case
  // is a superuser-blind PGlite can't show — proven in catalogue-api.rls.test.ts on real Postgres.)
  it("catalogueExists is true for a tenant catalogue and false for an absent id", async () => {
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
        descriptions: { en: "water" },
        pricingUnit: "each",
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
      // Compile-time proof that AvailableProduct is structurally assignable to PriceableProduct:
      // this only typechecks if every field priceBasket reads is present and correctly typed. Task 6
      // relies on exactly this — feeding listAvailableProducts rows straight into priceBasket.
      const priced = priceBasket(available.map((product) => ({ product, quantity: "1" })));
      expect(priced.lines.length).toBe(2);
    });
  });

  it("keeps AvailableProduct assignable to PriceableProduct", () => {
    const widen = (p: AvailableProduct): PriceableProduct => p;
    const sample: AvailableProduct = {
      id: "00000000-0000-0000-0000-000000000000",
      descriptions: { en: "water" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
      allergens: null,
      courseId: null,
      catalogueId: "00000000-0000-0000-0000-000000000001",
      catalogueName: "Deli",
      optionGroups: [],
    };
    expect(widen(sample).unitPrice).toBe("1.50");
  });

  // ── Option group + item authoring (Task 11) ────────────────────────────────────────────────────
  describe("option group authoring", () => {
    it("createOptionGroup applies column defaults and validates the select-bound invariant", async () => {
      await asTenant(async (tx) => {
        const g = await createOptionGroup(tx, { name: { en: "Size" } });
        expect(g).toMatchObject({
          name: { en: "Size" },
          minSelect: 0,
          maxSelect: 1,
          required: false,
          sort: 0,
          active: true,
        });
        expect(g.id).toMatch(/^[0-9a-f-]{36}$/);

        // max < min → options.group_invalid / select_bounds.
        await expect(
          createOptionGroup(tx, { name: { en: "bad" }, minSelect: 3, maxSelect: 1 }),
        ).rejects.toMatchObject({
          code: "options.group_invalid",
          params: { reason: "select_bounds" },
        });
        // negative min → select_bounds.
        await expect(
          createOptionGroup(tx, { name: { en: "bad" }, minSelect: -1 }),
        ).rejects.toBeInstanceOf(AppError);
        // required with min 0 → required_without_min.
        await expect(
          createOptionGroup(tx, { name: { en: "bad" }, required: true, minSelect: 0 }),
        ).rejects.toMatchObject({
          code: "options.group_invalid",
          params: { reason: "required_without_min" },
        });
      });
    });

    it("createOptionGroup honours explicit sort/active and lists groups by sort then id", async () => {
      await asTenant(async (tx) => {
        const b = await createOptionGroup(tx, { name: { en: "B" }, sort: 2, active: false });
        const a = await createOptionGroup(tx, { name: { en: "A" }, sort: 1 });
        expect(b.active).toBe(false);
        const list = await listOptionGroups(tx);
        expect(list.map((g) => g.id)).toEqual([a.id, b.id]); // sort 1 before sort 2
      });
    });

    it("updateOptionGroup merges the patch onto the stored row for the bounds check", async () => {
      await asTenant(async (tx) => {
        const g = await createOptionGroup(tx, {
          name: { en: "x" },
          minSelect: 2,
          maxSelect: 3,
        });
        // Lowering only maxSelect to 1 must be caught against the STORED min (2), not a default.
        await expect(updateOptionGroup(tx, g.id, { maxSelect: 1 })).rejects.toMatchObject({
          code: "options.group_invalid",
          params: { reason: "select_bounds" },
        });
        // required:true against the stored min 2 is fine (2 >= 1); the write lands.
        await updateOptionGroup(tx, g.id, {
          required: true,
          name: { en: "y" },
          sort: 5,
          active: false,
        });
        const [after] = await listOptionGroups(tx);
        expect(after).toMatchObject({ required: true, name: { en: "y" }, sort: 5, active: false });
      });
    });

    it("updateOptionGroup on a well-formed but missing id is a silent no-op", async () => {
      await asTenant(async (tx) => {
        await expect(
          updateOptionGroup(tx, "00000000-0000-0000-0000-000000000000", { sort: 1 }),
        ).resolves.toBeUndefined();
        expect(await listOptionGroups(tx)).toEqual([]);
      });
    });

    it("createOptionGroupItem applies defaults, honours overrides, and lists items by sort then id", async () => {
      await asTenant(async (tx) => {
        const g = await createOptionGroup(tx, { name: { en: "Sauces" } });
        const def = await createOptionGroupItem(tx, g.id, { name: { en: "Aioli" } });
        expect(def).toMatchObject({
          groupId: g.id,
          name: { en: "Aioli" },
          priceDelta: "0.00",
          vatClass: null,
          sort: 0,
          active: true,
          maxQuantity: 1, // default: no per-option quantity
        });
        const big = await createOptionGroupItem(tx, g.id, {
          name: { en: "Extra" },
          priceDelta: "1.50",
          vatClass: "reduced",
          sort: 1,
          active: false,
          maxQuantity: 3,
        });
        expect(big).toMatchObject({
          priceDelta: "1.50",
          vatClass: "reduced",
          sort: 1,
          active: false,
          maxQuantity: 3,
        });
        const items = await listOptionGroupItems(tx, g.id);
        expect(items.map((i) => i.id)).toEqual([def.id, big.id]); // sort 0 before sort 1
        // list returns maxQuantity for every item
        expect(items.map((i) => i.maxQuantity)).toEqual([1, 3]);
      });
    });

    it("createOptionGroupItem rejects a maxQuantity below 1 or non-integer with options.item_invalid", async () => {
      await asTenant(async (tx) => {
        const g = await createOptionGroup(tx, { name: { en: "Sauces" } });
        await expect(
          createOptionGroupItem(tx, g.id, { name: { en: "bad" }, maxQuantity: 0 }),
        ).rejects.toMatchObject({
          code: "options.item_invalid",
          params: { reason: "max_quantity" },
        });
        await expect(
          createOptionGroupItem(tx, g.id, { name: { en: "bad" }, maxQuantity: 1.5 }),
        ).rejects.toMatchObject({
          code: "options.item_invalid",
          params: { reason: "max_quantity" },
        });
      });
    });

    it("updateOptionGroupItem writes the named fields", async () => {
      await asTenant(async (tx) => {
        const g = await createOptionGroup(tx, { name: { en: "x" } });
        const item = await createOptionGroupItem(tx, g.id, { name: { en: "before" } });
        await updateOptionGroupItem(tx, item.id, {
          name: { en: "after" },
          priceDelta: "2.00",
          vatClass: null,
          sort: 3,
          active: false,
          maxQuantity: 4,
        });
        const [row] = await listOptionGroupItems(tx, g.id);
        expect(row).toMatchObject({
          name: { en: "after" },
          priceDelta: "2.00",
          vatClass: null,
          sort: 3,
          active: false,
          maxQuantity: 4,
        });
      });
    });

    it("updateOptionGroupItem leaves maxQuantity unchanged when omitted and re-validates when set", async () => {
      await asTenant(async (tx) => {
        const g = await createOptionGroup(tx, { name: { en: "x" } });
        const item = await createOptionGroupItem(tx, g.id, { name: { en: "a" }, maxQuantity: 5 });
        // A patch that omits maxQuantity leaves the stored 5 intact.
        await updateOptionGroupItem(tx, item.id, { priceDelta: "1.00" });
        expect((await listOptionGroupItems(tx, g.id))[0]).toMatchObject({ maxQuantity: 5 });
        // A patch that sets an invalid maxQuantity re-validates → options.item_invalid.
        await expect(updateOptionGroupItem(tx, item.id, { maxQuantity: 0 })).rejects.toMatchObject({
          code: "options.item_invalid",
          params: { reason: "max_quantity" },
        });
      });
    });

    it("setProductOptionGroups is a full ordered replace; listProductOptionGroupIds reads it back", async () => {
      await asTenant(async (tx) => {
        const cat = await createCatalogue(tx, { name: "Menu" });
        const product = await createProduct(tx, {
          catalogueId: cat.id,
          categoryId: null,
          descriptions: { en: "steak" },
          pricingUnit: "each",
          unitPrice: "18.00",
          vatClass: "general",
        });
        const g1 = await createOptionGroup(tx, { name: { en: "A" } });
        const g2 = await createOptionGroup(tx, { name: { en: "B" } });

        // No attach yet.
        expect(await listProductOptionGroupIds(tx, product.id)).toEqual([]);

        // Attach [g1, g2] — order preserved via the per-attachment sort.
        await setProductOptionGroups(tx, product.id, [g1.id, g2.id]);
        expect(await listProductOptionGroupIds(tx, product.id)).toEqual([g1.id, g2.id]);

        // Replace with [g2] — g1 detaches.
        await setProductOptionGroups(tx, product.id, [g2.id]);
        expect(await listProductOptionGroupIds(tx, product.id)).toEqual([g2.id]);

        // Empty list detaches everything.
        await setProductOptionGroups(tx, product.id, []);
        expect(await listProductOptionGroupIds(tx, product.id)).toEqual([]);
      });
    });
  });
});
