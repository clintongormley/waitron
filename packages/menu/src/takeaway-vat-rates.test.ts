import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  products,
  productTakeawayVatRates,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedTaxpayer, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  readTakeawayVatSchedules,
  readVenueVatRates,
  setTakeawayVatRate,
} from "./takeaway-vat-rates.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);

async function spanishVenue(): Promise<void> {
  await seedTaxpayer(suite.db);
  await seedVenueSettings(suite.db, { fiscalTerritory: "ES-common" });
}

async function product(parentId: string | null = null): Promise<string> {
  const values =
    parentId === null
      ? { name: "Soup", unitPrice: 100, vatClass: "general" }
      : { name: "Large", parentId };
  return (await suite.db.insert(products).values(values).returning({ id: products.id }))[0]!.id;
}

function rateRow(productId: string, startsOn: string | null, rate: number) {
  return suite.db.insert(productTakeawayVatRates).values({ productId, startsOn, rate });
}

async function rowsOf(productId: string) {
  return suite.db
    .select({ startsOn: productTakeawayVatRates.startsOn, rate: productTakeawayVatRates.rate })
    .from(productTakeawayVatRates)
    .where(eq(productTakeawayVatRates.productId, productId))
    .orderBy(productTakeawayVatRates.startsOn);
}

describe("readVenueVatRates", () => {
  it("gives a Spanish venue the pack's pick list and the seven accepted rates", async () => {
    await spanishVenue();
    const rates = await app((tx) => readVenueVatRates(tx));
    expect(rates.pickable).toEqual(["0.00", "4.00", "10.00", "21.00"]);
    expect(rates.accepted).toEqual(["0.00", "2.00", "4.00", "5.00", "7.50", "10.00", "21.00"]);
    expect(rates.dineIn).toEqual([{ from: null, rate: "10.00" }]);
    expect(rates.defaultTakeaway).toBe("10.00");
  });

  it("refuses a venue with no taxpayer", async () => {
    await seedVenueSettings(suite.db, { fiscalTerritory: "ES-common" });
    await expect(app((tx) => readVenueVatRates(tx))).rejects.toMatchObject({
      code: "vat_rate.area_unsupported",
      params: { country: null, territory: "ES-common" },
    });
  });

  it("refuses an area the packs list no rates for", async () => {
    await seedTaxpayer(suite.db);
    await seedVenueSettings(suite.db, { fiscalTerritory: "ES-nowhere" });
    await expect(app((tx) => readVenueVatRates(tx))).rejects.toMatchObject({
      code: "vat_rate.area_unsupported",
      params: { country: "ES", territory: "ES-nowhere" },
    });
  });
});

describe("setTakeawayVatRate", () => {
  it("stores a pickable rate in basis points", async () => {
    await spanishVenue();
    const id = await product();
    await app((tx) => setTakeawayVatRate(tx, id, "21.00"));
    expect(await rowsOf(id)).toEqual([{ startsOn: null, rate: 2100 }]);
  });

  it("refuses a rate outside the pick list, accepted or not", async () => {
    await spanishVenue();
    const id = await product();
    for (const rate of ["5.00", "7.50", "3.00", "21"]) {
      await expect(app((tx) => setTakeawayVatRate(tx, id, rate))).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "takeawayVatRate" },
      });
    }
    expect(await rowsOf(id)).toEqual([]);
  });

  it("replaces a list holding a dated row with exactly one first row", async () => {
    await spanishVenue();
    const id = await product();
    await rateRow(id, null, 1000);
    await rateRow(id, "2027-01-01", 2100);
    await app((tx) => setTakeawayVatRate(tx, id, "4.00"));
    expect(await rowsOf(id)).toEqual([{ startsOn: null, rate: 400 }]);
  });

  it("clears a variant's rows with null and refuses null on a top-level product", async () => {
    await spanishVenue();
    const parent = await product();
    const variant = await product(parent);
    await rateRow(parent, null, 1000);
    await rateRow(variant, null, 2100);
    await app((tx) => setTakeawayVatRate(tx, variant, null));
    expect(await rowsOf(variant)).toEqual([]);
    await expect(app((tx) => setTakeawayVatRate(tx, parent, null))).rejects.toMatchObject({
      code: "product.invalid",
      params: { field: "takeawayVatRate" },
    });
    expect(await rowsOf(parent)).toEqual([{ startsOn: null, rate: 1000 }]);
  });

  it("checks before deleting, so a caller that catches a refusal keeps the rows", async () => {
    await spanishVenue();
    const id = await product();
    await rateRow(id, null, 1000);
    const left = await app(async (tx) => {
      for (const rate of [null, "5.00"]) {
        await expect(setTakeawayVatRate(tx, id, rate)).rejects.toMatchObject({
          code: "product.invalid",
        });
      }
      return tx
        .select({ rate: productTakeawayVatRates.rate })
        .from(productTakeawayVatRates)
        .where(eq(productTakeawayVatRates.productId, id));
    });
    expect(left).toEqual([{ rate: 1000 }]);
  });

  it("checks against the area's rates a caller hands in, without reading the area", async () => {
    await seedVenueSettings(suite.db, { fiscalTerritory: "ES-common" });
    const id = await product();
    const rates = {
      dineIn: [{ from: null, rate: "10.00" }],
      accepted: ["5.00"],
      pickable: ["5.00"],
      defaultTakeaway: "5.00",
    };
    await app((tx) => setTakeawayVatRate(tx, id, "5.00", rates));
    expect(await rowsOf(id)).toEqual([{ startsOn: null, rate: 500 }]);
    await expect(app((tx) => setTakeawayVatRate(tx, id, "10.00", rates))).rejects.toMatchObject({
      code: "product.invalid",
      params: { field: "takeawayVatRate" },
    });
  });

  it("refuses a product that does not exist", async () => {
    await spanishVenue();
    await expect(
      app((tx) => setTakeawayVatRate(tx, "no-such-product", "10.00")),
    ).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: "no-such-product" },
    });
  });
});

describe("readTakeawayVatSchedules", () => {
  it("reads a stored rate back at two places, oldest first", async () => {
    const id = await product();
    await rateRow(id, "2027-01-01", 2100);
    await rateRow(id, null, 750);
    const schedules = await app((tx) => readTakeawayVatSchedules(tx, [id]));
    expect(schedules.get(id)).toEqual([
      { from: null, rate: "7.50" },
      { from: "2027-01-01", rate: "21.00" },
    ]);
  });

  it("gives a variant without rows its parent's, and one with rows its own", async () => {
    const parent = await product();
    const plain = await product(parent);
    const own = await product(parent);
    await rateRow(parent, null, 1000);
    await rateRow(own, null, 2100);
    const schedules = await app((tx) => readTakeawayVatSchedules(tx, [plain, own, parent]));
    expect(schedules.get(plain)).toEqual([{ from: null, rate: "10.00" }]);
    expect(schedules.get(own)).toEqual([{ from: null, rate: "21.00" }]);
    expect(schedules.get(parent)).toEqual([{ from: null, rate: "10.00" }]);
  });

  it("leaves out a top-level product without rows, and reads nothing for no ids", async () => {
    const bare = await product();
    const rated = await product();
    await rateRow(rated, null, 400);
    const schedules = await app((tx) => readTakeawayVatSchedules(tx, [bare, rated]));
    expect([...schedules.keys()]).toEqual([rated]);
    expect((await app((tx) => readTakeawayVatSchedules(tx, []))).size).toBe(0);
  });
});
