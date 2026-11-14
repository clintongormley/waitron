import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { settings, readVenueSettings } from "@waitron/db";
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
    await suite.db.run(
      sql`update settings set doc = json_set(doc, '$.operationDescription', ${"Existing service"}) where module = 'venue'`,
    );
    await seedVenueSettings(suite.db, { name: "Existing venue", invoiceLocales: ["en-GB"] });
    const before = await suite.db.select().from(settings).where(eq(settings.module, "venue"));
    const documentBefore = await readVenueSettings(suite.db);
    expect(documentBefore.doc.name).toBe("Existing venue");
    await seed();
    expect(await suite.db.select().from(settings).where(eq(settings.module, "venue"))).toEqual(
      before,
    );
    expect(await readVenueSettings(suite.db)).toEqual(documentBefore);
  });
});
