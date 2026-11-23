import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { vatRatesFor } from "@waitron/country-packs";
import {
  CORE_MIGRATIONS,
  products,
  productTakeawayVatRates,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  seedTakeawayVatRate,
  seedTaxpayer,
  seedVenue,
  seedVenueSettings,
} from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  dineInVatRateToday,
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

/** Pass the refusing call's own transaction: a refusal through `app` rolls back, which would hide a
 * delete that ran before the check. */
async function rowsOf(productId: string, db: Database | Transaction = suite.db) {
  return db
    .select({ startsOn: productTakeawayVatRates.startsOn, rate: productTakeawayVatRates.rate })
    .from(productTakeawayVatRates)
    .where(eq(productTakeawayVatRates.productId, productId))
    .orderBy(productTakeawayVatRates.startsOn);
}

describe("readVenueVatRates", () => {
  it("gives a Spanish venue its area's rates from the packs", async () => {
    await spanishVenue();
    expect(await app((tx) => readVenueVatRates(tx))).toEqual(vatRatesFor("ES", "ES-common"));
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

describe("dineInVatRateToday", () => {
  it("gives the dine-in rate in force on the venue's date, at two places", async () => {
    await seedVenue(suite.db);
    const area = vatRatesFor("ES", "ES-common")!;
    expect(await app((tx) => dineInVatRateToday(tx, area))).toBe("10.00");
    const dated = {
      ...area,
      dineIn: [
        { from: null, rate: "10.00" },
        { from: "2000-01-01", rate: "7.5" },
        { from: "9999-01-01", rate: "21.00" },
      ],
    };
    expect(await app((tx) => dineInVatRateToday(tx, dated))).toBe("7.50");
  });
});

describe("setTakeawayVatRate", () => {
  it("stores a pickable rate in basis points", async () => {
    await spanishVenue();
    const id = await product();
    await app((tx) => setTakeawayVatRate(tx, id, "21.00"));
    expect(await rowsOf(id)).toEqual([{ startsOn: null, rate: 2100 }]);
  });

  it("refuses a rate outside the pick list, accepted or not, before deleting the rows", async () => {
    await spanishVenue();
    const id = await product();
    await seedTakeawayVatRate(suite.db, id);
    const left = await app(async (tx) => {
      for (const rate of ["5.00", "7.50", "3.00", "21"]) {
        await expect(setTakeawayVatRate(tx, id, rate)).rejects.toMatchObject({
          code: "product.invalid",
          params: { field: "takeawayVatRate" },
        });
      }
      return rowsOf(id, tx);
    });
    expect(left).toEqual([{ startsOn: null, rate: 1000 }]);
  });

  it("replaces a list holding a dated row with exactly one first row", async () => {
    await spanishVenue();
    const id = await product();
    await seedTakeawayVatRate(suite.db, id);
    await seedTakeawayVatRate(suite.db, id, { startsOn: "2027-01-01", rate: 2100 });
    await app((tx) => setTakeawayVatRate(tx, id, "4.00"));
    expect(await rowsOf(id)).toEqual([{ startsOn: null, rate: 400 }]);
  });

  it("clears a variant's rows with null and refuses null on a top-level product", async () => {
    await spanishVenue();
    const parent = await product();
    const variant = await product(parent);
    await seedTakeawayVatRate(suite.db, parent);
    await seedTakeawayVatRate(suite.db, variant, { rate: 2100 });
    await app((tx) => setTakeawayVatRate(tx, variant, null));
    expect(await rowsOf(variant)).toEqual([]);
    const parentLeft = await app(async (tx) => {
      await expect(setTakeawayVatRate(tx, parent, null)).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "takeawayVatRate" },
      });
      return rowsOf(parent, tx);
    });
    expect(parentLeft).toEqual([{ startsOn: null, rate: 1000 }]);
  });

  it("checks against the area's rates a caller hands in, without reading the area", async () => {
    await seedVenueSettings(suite.db, { fiscalTerritory: "ES-common" });
    const id = await product();
    const rates = {
      dineIn: [{ from: null, rate: "10.00" }],
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
    await seedTakeawayVatRate(suite.db, id, { startsOn: "2027-01-01", rate: 2100 });
    await seedTakeawayVatRate(suite.db, id, { rate: 750 });
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
    await seedTakeawayVatRate(suite.db, parent);
    await seedTakeawayVatRate(suite.db, own, { rate: 2100 });
    const schedules = await app((tx) => readTakeawayVatSchedules(tx, [plain, own, parent]));
    expect(schedules.get(plain)).toEqual([{ from: null, rate: "10.00" }]);
    expect(schedules.get(own)).toEqual([{ from: null, rate: "21.00" }]);
    expect(schedules.get(parent)).toEqual([{ from: null, rate: "10.00" }]);
  });

  it("leaves out a top-level product without rows, and reads nothing for no ids", async () => {
    const bare = await product();
    const rated = await product();
    await seedTakeawayVatRate(suite.db, rated, { rate: 400 });
    const schedules = await app((tx) => readTakeawayVatSchedules(tx, [bare, rated]));
    expect([...schedules.keys()]).toEqual([rated]);
    expect((await app((tx) => readTakeawayVatSchedules(tx, []))).size).toBe(0);
  });
});
