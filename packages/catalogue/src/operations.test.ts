import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { priceBasket } from "./pricing.js";
import type { PriceableProduct } from "./pricing.js";
import {
  addCatalogueToLocation,
  applyRecipeDerivation,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
  listAccessibleCatalogues,
  listAvailableProducts,
  listCatalogues,
  listCategories,
  listProducts,
  renameCatalogue,
  renameCategory,
  updateProduct,
} from "./operations.js";
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
    };
    expect(widen(sample).unitPrice).toBe("1.50");
  });
});
