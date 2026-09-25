import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readVenueLocale } from "./venue-locale.js";

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
