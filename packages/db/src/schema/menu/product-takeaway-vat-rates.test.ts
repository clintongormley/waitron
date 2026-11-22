import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  engineErrorMessage,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  products,
  productTakeawayVatRates,
  UNIQUE_VIOLATION,
} from "../../index.js";
import type { Database } from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function product(): Promise<string> {
  return (
    await db
      .insert(products)
      .values({ name: "Soup", unitPrice: 1, vatClass: "general" })
      .returning({ id: products.id })
  )[0]!.id;
}

function rateRow(productId: string, startsOn: string | null, rate: number) {
  return db.insert(productTakeawayVatRates).values({ productId, startsOn, rate });
}

async function ratesOf(productId: string) {
  return db
    .select({ startsOn: productTakeawayVatRates.startsOn, rate: productTakeawayVatRates.rate })
    .from(productTakeawayVatRates)
    .where(eq(productTakeawayVatRates.productId, productId))
    .orderBy(productTakeawayVatRates.startsOn);
}

describe("product_takeaway_vat_rates", () => {
  it("refuses a second row from the beginning of time for one product", async () => {
    const id = await product();
    await rateRow(id, null, 1000);
    const error = await captureError(() => rateRow(id, null, 2100));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("product_takeaway_vat_rates.product_id");
    expect(await ratesOf(id)).toEqual([{ startsOn: null, rate: 1000 }]);
  });

  it("refuses two rows on one day and accepts rows on two days", async () => {
    const id = await product();
    await rateRow(id, "2026-01-01", 1000);
    const error = await captureError(() => rateRow(id, "2026-01-01", 2100));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("product_takeaway_vat_rates.starts_on");
    await rateRow(id, "2026-07-01", 2100);
    expect(await ratesOf(id)).toEqual([
      { startsOn: "2026-01-01", rate: 1000 },
      { startsOn: "2026-07-01", rate: 2100 },
    ]);
  });

  it("refuses a rate above 100% or below 0%", async () => {
    const id = await product();
    for (const rate of [10001, -1]) {
      const error = await captureError(() => rateRow(id, null, rate));
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toContain("product_takeaway_vat_rates_rate_ck");
    }
    await rateRow(id, null, 0);
    await rateRow(id, "2026-01-01", 10000);
    expect(await ratesOf(id)).toEqual([
      { startsOn: null, rate: 0 },
      { startsOn: "2026-01-01", rate: 10000 },
    ]);
  });

  it("refuses a row for no product", async () => {
    const error = await captureError(() => rateRow("no-such-product", null, 1000));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("removes a product's rows when the product row is removed", async () => {
    const id = await product();
    const other = await product();
    await rateRow(id, null, 1000);
    await rateRow(id, "2026-01-01", 2100);
    await rateRow(other, null, 400);
    await db.delete(products).where(eq(products.id, id));
    expect(await ratesOf(id)).toEqual([]);
    expect(await ratesOf(other)).toEqual([{ startsOn: null, rate: 400 }]);
  });
});
