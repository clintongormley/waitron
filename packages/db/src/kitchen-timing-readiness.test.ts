import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";
import { assertKitchenTimingPresent } from "./kitchen-timing-readiness.js";
import { kitchenTimingDefaults } from "./schema/kitchen-timing.js";
import { locations, tenants } from "./schema/tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function seed() {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Timing fixture" });
  return suite.db
    .insert(locations)
    .values([
      { name: "Ready", invoiceLocales: ["es"], operationDescription: "Hostelería" },
      { name: "Missing", invoiceLocales: ["es"], operationDescription: "Hostelería" },
    ])
    .returning({ id: locations.id });
}
it("allows an empty setup store and locations whose timing defaults exist", async () => {
  await expect(withTransaction(suite.db, assertKitchenTimingPresent)).resolves.toBeUndefined();
  const rows = await seed();
  await suite.db.insert(kitchenTimingDefaults).values(rows.map(({ id }) => ({ locationId: id })));
  await expect(withTransaction(suite.db, assertKitchenTimingPresent)).resolves.toBeUndefined();
});
it("names a missing location even when another location has defaults", async () => {
  const [ready, missing] = await seed();
  await suite.db.insert(kitchenTimingDefaults).values({ locationId: ready!.id });
  await expect(withTransaction(suite.db, assertKitchenTimingPresent)).rejects.toMatchObject({
    code: "station.timing_missing",
    params: { locationId: missing!.id },
  });
});
