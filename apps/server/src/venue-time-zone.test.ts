import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, locations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readVenueTimeZone } from "./venue-time-zone.js";

const venue = {
  id: randomUUID(),
  name: "Island venue",
  invoiceLocales: ["es-ES"],
  operationDescription: "Retail",
  timeZone: "Atlantic/Canary",
};
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    await db.insert(locations).values(venue);
  },
});

it("reads the venue's stored time zone instead of inferring it from language", async () => {
  expect(await readVenueTimeZone(suite.db)).toBe("Atlantic/Canary");
});

it("uses UTC when no venue is set up", async () => {
  await suite.db.execute(sql`delete from locations`);
  try {
    await expect(readVenueTimeZone(suite.db)).resolves.toBe("UTC");
  } finally {
    await suite.db.insert(locations).values(venue);
  }
});

it.each(["", "Not/AZone"])("uses UTC for an invalid stored zone %j", async (timeZone) => {
  await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, venue.id));
  try {
    expect(await readVenueTimeZone(suite.db)).toBe("UTC");
  } finally {
    await suite.db
      .update(locations)
      .set({ timeZone: venue.timeZone })
      .where(eq(locations.id, venue.id));
  }
});
