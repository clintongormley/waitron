import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { getCountryPack } from "@waitron/country-packs";
import {
  readVenueContentLanguageRules,
  readVenueLocale,
  readVenueReceiptLanguageRules,
} from "./venue-locale.js";

// CORE_MIGRATIONS alone: both `tenants.country` and `locations.province` live in core.
let locationId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    // `seedTenant` sets country 'ES' (and legal_name 'Test SL', a generated tax_id).
    await seedTenant(db);
    // Barcelona prefers Catalan in the Spain pack. This server build ships no Catalan UI catalogue,
    // so locale resolution falls through to the country default.
    // Through the table definition: `locations.id` is a NOT NULL `$defaultFn` generator a raw insert
    // never reaches.
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Counter",
        province: "Barcelona",
        invoiceLocales: ["es-ES"],
        operationDescription: "Retail",
      })
      .returning({ id: locations.id });
    locationId = loc!.id;
  },
});

describe("readVenueLocale", () => {
  it("derives the country default when no override and no regional catalogue", async () => {
    // Barcelona → ca-ES unavailable in this build → country ES → es-ES.
    const got = await readVenueLocale(suite.db, { locationId, override: undefined });
    expect(got).toBe("es-ES");
  });

  it("honours a supported override", async () => {
    const got = await readVenueLocale(suite.db, { locationId, override: "en-GB" });
    expect(got).toBe("en-GB");
  });

  it("ignores an unsupported override, falls to country", async () => {
    // 'ca-ES' has no catalogue (not in SUPPORTED_LOCALES), so the override is dropped and the country
    // default 'ES' → es-ES wins — the same result as no override at all.
    const got = await readVenueLocale(suite.db, { locationId, override: "ca-ES" });
    expect(got).toBe("es-ES");
  });

  it("falls to the English floor when there is no taxpayer row to read a country from", async () => {
    // With the taxpayer row deleted `country` and `province` are null and the resolver reaches its
    // `en-GB` floor. Not a production shape, but the `?? null` path exists rather than a throw.
    // Restored afterwards so the suite stays order-independent.
    await suite.db.execute(sql`delete from tenants`);
    try {
      const got = await readVenueLocale(suite.db, {
        locationId: randomUUID(),
        override: undefined,
      });
      expect(got).toBe("en-GB");
    } finally {
      await seedTenant(suite.db);
    }
  });
});

describe("readVenueContentLanguageRules", () => {
  const SPAIN_OFFICIAL = ["es", "ca", "gl", "eu"];

  it("requires Catalan and Spanish for the Barcelona venue", async () => {
    expect(await readVenueContentLanguageRules(suite.db, { locationId })).toStrictEqual({
      required: ["ca", "es"],
      official: SPAIN_OFFICIAL,
    });
  });

  it("requires Spanish for a Madrid venue", async () => {
    const [madrid] = await suite.db
      .insert(locations)
      .values({
        name: "Madrid",
        province: "Madrid",
        invoiceLocales: ["es-ES"],
        operationDescription: "Retail",
      })
      .returning({ id: locations.id });
    expect(await readVenueContentLanguageRules(suite.db, { locationId: madrid!.id })).toStrictEqual(
      { required: ["es"], official: SPAIN_OFFICIAL },
    );
  });

  it("requires nothing when there is no taxpayer row to read a country from", async () => {
    await suite.db.execute(sql`delete from tenants`);
    try {
      expect(
        await readVenueContentLanguageRules(suite.db, { locationId: randomUUID() }),
      ).toStrictEqual({ required: [], official: [] });
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
      await withTransaction(suite.db, (tx) => readVenueReceiptLanguageRules(tx, { locationId })),
    ).toStrictEqual({
      choices: SPAIN_RECEIPT,
      defaultLocale: "ca-ES",
      fixed: catalonia.fixedReceiptLocale,
    });
  });

  it("fixes nothing for a Madrid venue, offering Spanish first", async () => {
    const [madrid] = await suite.db
      .insert(locations)
      .values({
        name: "Madrid receipts",
        province: "Madrid",
        invoiceLocales: ["es-ES"],
        operationDescription: "Retail",
      })
      .returning({ id: locations.id });
    expect(
      await withTransaction(suite.db, (tx) =>
        readVenueReceiptLanguageRules(tx, { locationId: madrid!.id }),
      ),
    ).toStrictEqual({ choices: SPAIN_RECEIPT, defaultLocale: "es-ES" });
  });

  it("offers nothing when there is no taxpayer row to read a country from", async () => {
    await suite.db.execute(sql`delete from tenants`);
    try {
      expect(
        await withTransaction(suite.db, (tx) =>
          readVenueReceiptLanguageRules(tx, { locationId: randomUUID() }),
        ),
      ).toStrictEqual({ choices: [], defaultLocale: "es-ES" });
    } finally {
      await seedTenant(suite.db);
    }
  });
});
