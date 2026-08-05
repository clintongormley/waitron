import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { priceBasket } from "./pricing.js";
import type { PriceableProduct } from "./pricing.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
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

  it("creates and lists catalogues", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const food = await createCategory(tx, { name: "Food" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const cats = await listCategories(tx);
      expect(cats.map((c) => c.name).sort()).toEqual(["Drinks", "Food"]);
      expect(cats.map((c) => c.id).sort()).toEqual([drinks.id, food.id].sort());
    });
  });

  it("creates and lists a catalogue's products", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
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

  it("renames a catalogue", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Deli" });
      await renameCatalogue(tx, cat.id, "Delicatessen");
      const [seen] = await listCatalogues(tx);
      expect(seen!.name).toBe("Delicatessen");
    });
  });

  it("renames a category", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const food = await createCategory(tx, { name: "Food" });
      await renameCategory(tx, food.id, "Fresh food");
      const [seen] = await listCategories(tx);
      expect(seen!.name).toBe("Fresh food");
    });
  });

  it("lists a location's catalogue's active products only, with the category name resolved", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
      const available = await listAvailableProducts(tx, locationId);
      expect(available.map((p) => p.id)).toEqual([p1.id]);
      expect(available[0]!.category).toBe("Food");
      expect(available[0]!.unitPrice).toBe("24.90");
      expect(available[0]!.pricingUnit).toBe("weight");
      expect(available[0]!.vatClass).toBe("reduced");
    });
  });

  it("returns null category for an available product with no category", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
      const [available] = await listAvailableProducts(tx, locationId);
      expect(available!.category).toBeNull();
    });
  });

  it("returns [] for a location with no catalogue assigned", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      expect(await listAvailableProducts(tx, locationId)).toEqual([]);
    });
  });

  it("hides every product of a deactivated catalogue", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const fixture = await seedCatalogueFixture(tx, { locationId });
      expect((await listAvailableProducts(tx, locationId)).length).toBe(2);
      await deactivateCatalogue(tx, fixture.catalogueId);
      expect(await listAvailableProducts(tx, locationId)).toEqual([]);
    });
  });

  it("returns products from a seeded catalogue that priceBasket can consume directly", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await seedCatalogueFixture(tx, { locationId });
      const available = await listAvailableProducts(tx, locationId);
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
    };
    expect(widen(sample).unitPrice).toBe("1.50");
  });
});
