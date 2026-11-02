import { randomUUID } from "node:crypto";
import { kitchenStations, venueLocationId, withTransaction, type Database } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { persons } from "@waitron/identity";
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
      const [row] = await tx
        .insert(persons)
        .values({ displayName, role: "staff" })
        .returning({ id: persons.id });
      return row!.id;
    };
    const suffix = randomUUID().slice(0, 8);
    const ana = await person(`Ana ${suffix}`);
    const marc = await person(`Marc ${suffix}`);
    const [department] = await tx
      .insert(departments)
      .values({ locationId, name: "Dining room", tradingName: "Dining room" })
      .returning({ id: departments.id });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [season] = await tx
      .insert(seasons)
      .values({ locationId, name: "Summer", startsOn: "06-01" })
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
