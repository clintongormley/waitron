import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "./tenancy.js";
import { kitchenStations } from "./schema/kitchen-stations.js";
import { locations } from "./schema/tenants.js";
import { seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { nextStationColour } from "./station-colour.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function location(name: string) {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name,
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant service",
    })
    .returning({ id: locations.id });
  return row!.id;
}

it("sees colours inserted earlier in the caller's transaction", async () => {
  const locationId = await location("Restaurant");
  const choices = await withTransaction(suite.db, async (tx) => {
    const first = await nextStationColour(tx, locationId);
    await tx.insert(kitchenStations).values({ locationId, name: "Kitchen", colour: first });
    const second = await nextStationColour(tx, locationId);
    await tx.insert(kitchenStations).values({ locationId, name: "Bar", colour: second });
    return [first, second, await nextStationColour(tx, locationId)];
  });
  expect(choices).toEqual(["red", "orange", "amber"]);
});

it.each(["inactive", "another location"] as const)("ignores %s station colours", async (scope) => {
  const locationId = await location("Restaurant");
  const otherId = scope === "another location" ? await location("Takeaway") : locationId;
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(kitchenStations).values({ locationId, name: "Kitchen", colour: "red" });
    await tx.insert(kitchenStations).values({
      locationId: otherId,
      name: "Other station",
      colour: "orange",
      active: scope !== "inactive",
    });
    expect(await nextStationColour(tx, locationId)).toBe("orange");
  });
});
