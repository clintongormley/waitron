import { describe, expect, it } from "vitest";
import {
  catalogues,
  CORE_MIGRATIONS,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { productVariants } from "./schema/variants.js";
import { racePair } from "../test/fixtures.js";
import { createCatalogue, createProduct, createMenuSection, createMenuItem } from "./operations.js";
import {
  listProductVariants,
  setProductVariants,
  setMenuVariants,
  selectMenuVariant,
  type ProductVariant,
} from "./variants.js";
import { staffPresentationName, customerPresentationText } from "./product-presentation.js";
import { createUnit } from "./units.js";

/**
 * Variants against a real database, plus the pure selection core.
 *
 * This replaces a real-PostgreSQL suite. ONE CASE WENT: "creates, reads, edits and deletes
 * variants as the non-superuser app role" walked list / edit / clear. Its list and edit steps are
 * `variants.test.ts`'s "round-trips ordered translated names, stable identities, absolute prices
 * and availability"; its CLEAR step — `setProductVariants` with an empty body returning `[]` — was
 * in no other case, and is now covered only indirectly, by the concurrent-removal case below
 * issuing the same call.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

async function fixture() {
  await seedTenant(suite.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const unit = await createUnit(
      tx,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    );
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      description: { en: "Freshly roasted" },
      kitchenName: "BAR COFFEE",
      unitId: unit.id,
      unitPrice: "9.00",
      vatClass: "reduced",
    });
    expect(product.description).toEqual({ en: "Freshly roasted" });
    expect(product.kitchenName).toBe("BAR COFFEE");
    const section = await createMenuSection(tx, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const offer = await createMenuItem(tx, {
      menuId: menu.id,
      sectionId: section.id,
      productId: product.id,
      grossPrice: "8.00",
    });
    const variants = await setProductVariants(
      tx,
      product.id,
      [
        {
          name: "Small",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.00",
          available: true,
        },
      ],
      "en",
    );
    return { productId: product.id, offerId: offer.id, variant: variants[0]! };
  });
}

it("a concurrent variant removal waits for publication and then reports the dependency", async () => {
  const { productId, offerId, variant } = await fixture();

  // On PostgreSQL the publication held a row lock and the removal was watched blocking on it
  // (`pg_blocking_pids`). One write transaction runs on the venue file at a time, so the removal
  // simply runs second and sees the committed publication; `racePair` (`test/fixtures.ts`) carries
  // the measurement that it does not start early. Both assertions are the ones this case carried.
  const [publishing, removing] = await racePair(
    suite.db,
    (tx) =>
      setMenuVariants(tx, offerId, [{ variantId: variant.id, unitPrice: "4.00", available: true }]),
    (tx) => setProductVariants(tx, productId, [], "en"),
  );

  expect(publishing.status).toBe("fulfilled");
  expect(removing.status).toBe("rejected");
  if (removing.status === "rejected")
    expect(removing.reason).toMatchObject({
      code: "product.variant_in_use",
      params: { variantId: variant.id, menuItemIds: [offerId] },
    });
  expect(await app((tx) => listProductVariants(tx, productId))).toEqual([variant]);
});

/**
 * `setProductVariants` persists and `listProductVariants` reads back the widened variant shape
 * (staff name, customer name, kitchen name and image). Seeded through the tables rather than
 * through `createProduct`, so it does not depend on that function — and through the TABLES rather
 * than raw SQL, because `catalogues.id`, `products.id` and the two timestamps come from each
 * table's `$defaultFn` and not from a SQL default.
 */
it("a variant round-trips staff name, customer name, kitchen name and image through set/list", async () => {
  await seedTenant(suite.db);
  const [menu] = await suite.db
    .insert(catalogues)
    .values({ name: "Bar" })
    .returning({ id: catalogues.id });
  const [created] = await suite.db
    .insert(products)
    .values({
      catalogueId: menu!.id,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: 900,
      vatClass: "reduced",
    })
    .returning({ id: products.id });
  const productId = created!.id;
  await app(async (tx) => {
    await setProductVariants(
      tx,
      productId,
      [
        {
          name: "Large",
          customerName: { en: "Large cup" },
          kitchenName: "LG",
          image: "cup.png",
          unitPrice: "3.00",
          available: true,
        },
      ],
      "en",
    );
    const [variant] = await listProductVariants(tx, productId);
    expect(variant).toMatchObject({
      name: "Large",
      customerName: { en: "Large cup" },
      kitchenName: "LG",
      image: "cup.png",
      unitPrice: "3.00",
      available: true,
    });
  });
});

// selectMenuVariant is the pure core of menu-variant resolution — no DB. It returns the six name
// pieces (product staff/customer/kitchen and variant staff/customer/kitchen) separately, in the
// exact shape product-presentation.ts consumes, so the display join and fallback are never
// re-implemented here.
describe("selectMenuVariant returns the six product and variant name pieces", () => {
  const large: ProductVariant = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Large",
    customerName: { en: "Large cup" },
    kitchenName: "LG",
    image: null,
    unitPrice: "3.00",
    available: true,
  };
  const offer = {
    productId: "22222222-2222-2222-2222-222222222222",
    name: "Coffee",
    customerName: { en: "Fresh Coffee" },
    kitchenName: "BAR COFFEE",
    grossPrice: "8.00",
    variants: [large],
  };

  it("carries the product's names and the chosen variant's own three names", () => {
    const selected = selectMenuVariant(offer, [large], large.id);
    expect(selected).toEqual({
      variantId: large.id,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: "Large",
      variantCustomerName: { en: "Large cup" },
      variantKitchenName: "LG",
      unitPrice: "3.00",
    });
    // The selection is a ProductPresentation superset, so T4's resolvers own the join/fallback.
    expect(staffPresentationName(selected)).toBe("Coffee · Large");
    expect(customerPresentationText(selected, "en")).toEqual({
      product: { en: "Fresh Coffee" },
      variant: { en: "Large cup" },
    });
  });

  it("leaves all three variant name pieces null when no variant is chosen", () => {
    const selected = selectMenuVariant({ ...offer, variants: [] }, [], null);
    expect(selected).toEqual({
      variantId: null,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      unitPrice: "8.00",
    });
    expect(staffPresentationName(selected)).toBe("Coffee");
  });
});

/**
 * Self-contained apply/round-trip proof for the A2 columns, written through the tables so it does
 * not depend on `createProduct`. The `customer_name` map goes in and comes back through the
 * `json()` column's own mapping, which is what the `::jsonb` cast used to arrange — the column
 * stores JSON TEXT here, and a RAW read would hand back that string rather than the map.
 */
it("round-trips a variant's new name, customer_name, kitchen_name and image columns", async () => {
  await seedTenant(suite.db);
  const [menu] = await suite.db
    .insert(catalogues)
    .values({ name: "Bar" })
    .returning({ id: catalogues.id });
  const [created] = await suite.db
    .insert(products)
    .values({
      catalogueId: menu!.id,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: 900,
      vatClass: "reduced",
    })
    .returning({ id: products.id });
  const [row] = await suite.db
    .insert(productVariants)
    .values({
      productId: created!.id,
      name: "Small",
      customerName: { en: "Small" },
      kitchenName: "SM COFFEE",
      image: "abc123.jpg",
      unitPrice: 200,
    })
    .returning({
      name: productVariants.name,
      customer_name: productVariants.customerName,
      kitchen_name: productVariants.kitchenName,
      image: productVariants.image,
    });
  expect(row).toEqual({
    name: "Small",
    customer_name: { en: "Small" },
    kitchen_name: "SM COFFEE",
    image: "abc123.jpg",
  });
});
