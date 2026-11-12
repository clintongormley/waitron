import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { kitchenStations, venueLocationId, withTransaction, type Database } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";

import { departments, seasons } from "@waitron/venue-service";

/** The venue with two staff, a department, a prep station and a season. */
export async function seedVenueWithStaff(db: Database) {
  return withTransaction(db, async (tx) => {
    const venue = {
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
    };
    await seedVenue(tx, venue);
    const locationId = await venueLocationId(tx);
    const person = async (displayName: string) => {
      const [row] = await seedPersons(tx, { displayName, role: "staff" });
      return row!.id;
    };
    const suffix = randomUUID().slice(0, 8);
    const ana = await person(`Ana ${suffix}`);
    const marc = await person(`Marc ${suffix}`);
    const [department] = await tx
      .insert(departments)
      .values({ name: "Dining room", tradingName: "Dining room" })
      .returning({ id: departments.id });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [season] = await tx
      .insert(seasons)
      .values({ name: "Summer", startsOn: "06-01" })
      .returning({ id: seasons.id });
    return {
      cfg: { locationId },
      ana,
      marc,
      departmentId: department!.id,
      stationId: station!.id,
      seasonId: season!.id,
    };
  });
}
