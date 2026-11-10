import { describe, expect, it } from "vitest";
import { locations, readVenueSettings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { seedNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

describe("fiscal fixture venue reuse", () => {
  it.each([
    ["seedTenantWithSif", () => seedTenantWithSif(suite.db)],
    ["seedNode", () => seedNode(suite.db)],
  ] as const)("%s keeps the existing venue when adding another node", async (_name, seed) => {
    await seed();
    await suite.db.update(locations).set({
      operationDescription: "Existing service",
    });
    await seedVenueSettings(suite.db, { name: "Existing venue", invoiceLocales: ["en-GB"] });
    const before = await suite.db.select().from(locations);
    const documentBefore = await readVenueSettings(suite.db);
    expect(documentBefore.doc.name).toBe("Existing venue");
    await seed();
    expect(await suite.db.select().from(locations)).toEqual(before);
    expect(await readVenueSettings(suite.db)).toEqual(documentBefore);
  });
});
