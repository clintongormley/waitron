import { describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import {
  captureError,
  CORE_MIGRATIONS,
  products,
  productTakeawayVatRates,
  refusalOn,
  UNIQUE_VIOLATION,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedTaxpayer, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { customItemProduct } from "./custom-item-products.js";
import { createProduct } from "./operations.js";
import { notCustomItem } from "./variant-fallback.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);

async function spanishVenue(): Promise<void> {
  await seedTaxpayer(suite.db);
  await seedVenueSettings(suite.db, { fiscalTerritory: "ES-common" });
}

const hiddenProducts = (tx: Transaction) =>
  tx
    .select({ id: products.id, name: products.name, key: products.customItemKey })
    .from(products)
    .where(isNotNull(products.customItemKey))
    .orderBy(products.customItemKey);

const ratesOf = (tx: Transaction, productId: string) =>
  tx
    .select({ startsOn: productTakeawayVatRates.startsOn, rate: productTakeawayVatRates.rate })
    .from(productTakeawayVatRates)
    .where(eq(productTakeawayVatRates.productId, productId));

describe("customItemProduct", () => {
  it("creates the hidden product once and finds it after", async () => {
    await spanishVenue();
    const first = await app((tx) => customItemProduct(tx, 2100));
    const second = await app((tx) => customItemProduct(tx, 2100));
    expect(second).toBe(first);
    const [row, ...others] = await app((tx) => tx.select().from(products));
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      id: first,
      name: "Custom item",
      customItemKey: "2100",
      unitPrice: 0,
      categoryId: null,
      unitId: null,
      allergens: null,
      active: true,
    });
    expect(await app((tx) => ratesOf(tx, first))).toEqual([{ startsOn: null, rate: 2100 }]);
  });

  it("a second rate makes a second product of the same name", async () => {
    await spanishVenue();
    const reduced = await app((tx) => customItemProduct(tx, 1000));
    const zero = await app((tx) => customItemProduct(tx, 0));
    expect(await app(hiddenProducts)).toEqual([
      { id: zero, name: "Custom item", key: "0" },
      { id: reduced, name: "Custom item", key: "1000" },
    ]);
    expect(await app((tx) => ratesOf(tx, reduced))).toEqual([{ startsOn: null, rate: 1000 }]);
    expect(await app((tx) => ratesOf(tx, zero))).toEqual([{ startsOn: null, rate: 0 }]);
  });

  it("the unchosen product has no takeaway rate", async () => {
    await spanishVenue();
    const first = await app((tx) => customItemProduct(tx, null));
    const second = await app((tx) => customItemProduct(tx, null));
    expect(second).toBe(first);
    expect(await app(hiddenProducts)).toEqual([
      { id: first, name: "Custom item", key: "unchosen" },
    ]);
    expect(await app((tx) => ratesOf(tx, first))).toEqual([]);
  });

  it("a second product with a key a hidden product holds is refused", async () => {
    await spanishVenue();
    const held = await app((tx) => customItemProduct(tx, 2100));
    const { id } = await app((tx) =>
      createProduct(tx, {
        name: "Soup",
        categoryId: null,
        unitId: null,
        unitPrice: "1.00",
      }),
    );
    const error = await captureError(() =>
      app((tx) => tx.update(products).set({ customItemKey: "2100" }).where(eq(products.id, id))),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "products", columns: ["custom_item_key"] }),
    ).toBe(true);
    expect(await app(hiddenProducts)).toEqual([{ id: held, name: "Custom item", key: "2100" }]);
  });

  it.each([750, 10.5, -2100])("a rate the area does not pick refuses (%s)", async (rate) => {
    await spanishVenue();
    await app(async (tx) => {
      await expect(customItemProduct(tx, rate)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "takeawayRateBp" },
      });
      expect(await tx.select({ id: products.id }).from(products)).toEqual([]);
    });
  });
});

describe("notCustomItem", () => {
  it("keeps ordinary products, which have no key, and leaves the hidden ones out", async () => {
    await spanishVenue();
    const { id } = await app((tx) =>
      createProduct(tx, {
        name: "Soup",
        categoryId: null,
        unitId: null,
        unitPrice: "1.00",
      }),
    );
    await app((tx) => customItemProduct(tx, 2100));
    await app((tx) => customItemProduct(tx, null));
    expect(
      await app((tx) =>
        tx
          .select({ id: products.id, key: products.customItemKey })
          .from(products)
          .where(notCustomItem),
      ),
    ).toEqual([{ id, key: null }]);
  });
});
