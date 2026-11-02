import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "./tenancy.js";
import { kitchenStations } from "./schema/kitchen-stations.js";
import { seedVenue } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { nextStationColour } from "./station-colour.js";
import { venueLocationId } from "./venue.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function venue(name: string) {
  await seedVenue(suite.db, {
    name,
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant service",
  });
  return venueLocationId(suite.db);
}

it("sees colours inserted earlier in the caller's transaction", async () => {
  const locationId = await venue("Restaurant");
  const choices = await withTransaction(suite.db, async (tx) => {
    const first = await nextStationColour(tx);
    await tx.insert(kitchenStations).values({ locationId, name: "Kitchen", colour: first });
    const second = await nextStationColour(tx);
    await tx.insert(kitchenStations).values({ locationId, name: "Bar", colour: second });
    return [first, second, await nextStationColour(tx)];
  });
  expect(choices).toEqual(["red", "orange", "amber"]);
});

it("ignores inactive station colours", async () => {
  const locationId = await venue("Restaurant");
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(kitchenStations).values({ locationId, name: "Kitchen", colour: "red" });
    await tx.insert(kitchenStations).values({
      locationId,
      name: "Other station",
      colour: "orange",
      active: false,
    });
    expect(await nextStationColour(tx)).toBe("orange");
  });
});
