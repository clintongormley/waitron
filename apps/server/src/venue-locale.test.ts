import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, settings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant, seedVenue } from "@waitron/db/testing/seed.js";
import { getCountryPack } from "@waitron/country-packs";
import {
  saleLanguageFor,
  offeredReceiptLanguages,
  readOfferedReceiptLanguages,
  readVenueContentLanguageRules,
  readVenueLocale,
  readVenueReceiptLanguageRules,
} from "./venue-locale.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    // `seedVenue` writes the taxpayer row through `seedTenant`: country 'ES' (and legal_name
    // 'Test SL', a generated tax_id).
    // Barcelona prefers Catalan in the Spain pack. This server build ships no Catalan UI catalogue,
    // so locale resolution falls through to the country default.
    await seedVenue(db, {
      name: "Counter",
      province: "Barcelona",
      invoiceLocales: ["es-ES"],
      operationDescription: "Retail",
    });
  },
});

/** Runs `act` with the one venue moved to Madrid, and back to Barcelona afterwards. */
async function inMadrid(act: () => Promise<void>) {
  await seedVenueSettings(suite.db, { province: "Madrid" });
  try {
    await act();
  } finally {
    await seedVenueSettings(suite.db, { province: "Barcelona" });
  }
}

describe("readVenueLocale", () => {
  it("derives the country default", async () => {
    // Barcelona → ca-ES unavailable in this build → country ES → es-ES.
    const got = await readVenueLocale(suite.db);
    expect(got).toBe("es-ES");
  });

  it("falls to the English floor when there is no taxpayer row to read a country from", async () => {
    // With the taxpayer row deleted `country` and `province` are null and the resolver reaches its
    // `en-GB` floor. Not a production shape, but the `?? null` path exists rather than a throw.
    // Restored afterwards so the suite stays order-independent.
    await suite.db.execute(sql`delete from tenants`);
    try {
      const got = await readVenueLocale(suite.db);
      expect(got).toBe("en-GB");
    } finally {
      await seedTenant(suite.db);
    }
  });
});

it.each([
  ["readOfferedReceiptLanguages", () => withTransaction(suite.db, readOfferedReceiptLanguages)],
  [
    "saleLanguageFor",
    () =>
      withTransaction(suite.db, (tx) =>
        saleLanguageFor(tx, undefined, { log: undefined, workingOrderId: randomUUID() }),
      ),
  ],
  ["readVenueLocale", () => readVenueLocale(suite.db)],
  ["readVenueContentLanguageRules", () => readVenueContentLanguageRules(suite.db)],
  ["readVenueReceiptLanguageRules", () => withTransaction(suite.db, readVenueReceiptLanguageRules)],
])("%s refuses when no venue is set up", async (_name, read) => {
  const [venue] = await suite.db.select().from(settings).where(eq(settings.module, "venue"));
  try {
    await suite.db.delete(settings).where(eq(settings.module, "venue"));
    await expect(read()).rejects.toMatchObject({ code: "venue.not_found" });
  } finally {
    await suite.db.insert(settings).values(venue!);
  }
});

describe("readVenueContentLanguageRules", () => {
  const SPAIN_OFFICIAL = ["es", "ca", "ca-ES-valencia", "gl", "eu"];

  it("requires Catalan and Spanish for the Barcelona venue", async () => {
    expect(await readVenueContentLanguageRules(suite.db)).toStrictEqual({
      required: ["ca", "es"],
      official: SPAIN_OFFICIAL,
    });
  });

  it("requires Spanish for a Madrid venue", async () => {
    await inMadrid(async () => {
      expect(await readVenueContentLanguageRules(suite.db)).toStrictEqual({
        required: ["es"],
        official: SPAIN_OFFICIAL,
      });
    });
  });

  it("requires nothing when there is no taxpayer row to read a country from", async () => {
    await suite.db.execute(sql`delete from tenants`);
    try {
      expect(await readVenueContentLanguageRules(suite.db)).toStrictEqual({
        required: [],
        official: [],
      });
    } finally {
      await seedTenant(suite.db);
    }
  });
});

describe("readVenueReceiptLanguageRules", () => {
  const SPAIN_RECEIPT = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];

  it("fixes the Barcelona venue's receipts in Catalan, giving the pack's reason", async () => {
    const catalonia = getCountryPack("ES")!.administrativeAreas.find(({ code }) => code === "08")!;
    expect(catalonia.fixedReceiptLocale?.locale).toBe("ca-ES");
    expect(
      await withTransaction(suite.db, (tx) => readVenueReceiptLanguageRules(tx)),
    ).toStrictEqual({
      choices: SPAIN_RECEIPT,
      defaultLocale: "ca-ES",
      fixed: catalonia.fixedReceiptLocale,
    });
  });

  it("fixes nothing for a Madrid venue, offering Spanish first", async () => {
    await inMadrid(async () => {
      expect(await withTransaction(suite.db, readVenueReceiptLanguageRules)).toStrictEqual({
        choices: SPAIN_RECEIPT,
        defaultLocale: "es-ES",
      });
    });
  });

  it("offers nothing when there is no taxpayer row to read a country from", async () => {
    await suite.db.execute(sql`delete from tenants`);
    try {
      expect(
        await withTransaction(suite.db, (tx) => readVenueReceiptLanguageRules(tx)),
      ).toStrictEqual({ choices: [], defaultLocale: "es-ES" });
    } finally {
      await seedTenant(suite.db);
    }
  });
});

describe("offeredReceiptLanguages", () => {
  const SPAIN_RECEIPT = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];

  it.each([
    ["Madrid, content es and en", "es-ES", ["es", "en"], ["es-ES"]],
    ["Barcelona, content ca, es and en", "ca-ES", ["ca", "es", "en"], ["ca-ES", "es-ES"]],
    [
      "content es, gl and eu, receipt Spanish",
      "es-ES",
      ["es", "gl", "eu"],
      ["es-ES", "gl-ES", "eu-ES"],
    ],
    [
      "a receipt language outside the content languages",
      "gl-ES",
      ["es", "ca"],
      ["gl-ES", "es-ES", "ca-ES"],
    ],
    [
      "a Valencian venue, which does not offer Catalan",
      "es-ES",
      ["ca-ES-valencia", "es"],
      ["es-ES"],
    ],
  ])("%s", (_name, receiptLanguage, contentCodes, expected) => {
    expect(offeredReceiptLanguages(receiptLanguage, SPAIN_RECEIPT, contentCodes)).toEqual(expected);
  });

  it("puts the receipt language first and repeats nothing", () => {
    expect(offeredReceiptLanguages("eu-ES", SPAIN_RECEIPT, ["es", "eu", "ca"])).toEqual([
      "eu-ES",
      "es-ES",
      "ca-ES",
    ]);
  });
});

describe("readOfferedReceiptLanguages", () => {
  it("offers the venue's receipt languages without being told a venue", async () => {
    expect(await withTransaction(suite.db, readOfferedReceiptLanguages)).toEqual(["es-ES"]);
  });

  it("files a sale in the venue's first language", async () => {
    expect(
      await withTransaction(suite.db, (tx) =>
        saleLanguageFor(tx, undefined, { log: undefined, workingOrderId: randomUUID() }),
      ),
    ).toEqual({ locale: "es-ES", invoiceLocales: ["es-ES"] });
  });
});
