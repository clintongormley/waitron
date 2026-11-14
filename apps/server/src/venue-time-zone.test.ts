import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, settings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { readVenueTimeZone } from "./venue-time-zone.js";

const venue = {
  name: "Island venue",
  invoiceLocales: ["es-ES"],
  operationDescription: "Retail",
  timeZone: "Atlantic/Canary",
};
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedVenue(db, venue);
  },
});

it("reads the venue's stored time zone instead of inferring it from language", async () => {
  expect(await readVenueTimeZone(suite.db)).toBe("Atlantic/Canary");
});

it("uses UTC when no venue is set up", async () => {
  const [saved] = await suite.db.select().from(settings).where(eq(settings.module, "venue"));
  await suite.db.delete(settings).where(eq(settings.module, "venue"));
  try {
    await expect(readVenueTimeZone(suite.db)).resolves.toBe("UTC");
  } finally {
    await suite.db.insert(settings).values(saved!);
  }
});

it.each(["", "Not/AZone"])("uses UTC for an invalid stored zone %j", async (timeZone) => {
  await suite.db.run(
    sql`update settings set doc = json_set(doc, '$.timeZone', ${timeZone}) where module = 'business_day'`,
  );
  try {
    expect(await readVenueTimeZone(suite.db)).toBe("UTC");
  } finally {
    await suite.db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${venue.timeZone}) where module = 'business_day'`,
    );
  }
});
