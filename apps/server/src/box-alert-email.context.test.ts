import { describe, expect, it } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { venueLocationId } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBoxEmailContext } from "./box-alert-email.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("readBoxEmailContext", () => {
  it("reads the venue's name, the managers and the settings", async () => {
    await seedVenue(suite.db, {
      name: "Corner Bistro",
      invoiceLocales: ["en-GB"],
      operationDescription: "Sale",
    });
    const venueId = await venueLocationId(suite.db);
    const [admin] = await suite.db
      .insert(persons)
      .values({ displayName: "Admin", role: "admin", email: "admin@example.test" })
      .returning({ id: persons.id });
    const deps = { ring, locationId: venueId, venueLanguage: "en" as const };

    await expect(readBoxEmailContext(suite.db, { ...deps, practiceMode: false })).resolves.toEqual({
      venue: "Corner Bistro",
      recipients: [{ personId: admin!.id, email: "admin@example.test", language: "en" }],
      delivery: { mode: "unconfigured" },
    });
    const practice = await readBoxEmailContext(suite.db, { ...deps, practiceMode: true });
    expect(practice.delivery.mode).toBe("local_capture");
  });
});
