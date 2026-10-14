import { randomUUID } from "node:crypto";
import { kitchenStations, locations, withTransaction, type Database } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { persons } from "@waitron/identity";
import { departments, seasons } from "@waitron/venue-service";

/** A location with two staff, a department, a prep station and a season, each inserted directly. */
export async function seedVenue(db: Database) {
  await seedTenant(db);
  return withTransaction(db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Casa ${randomUUID()}`,
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      })
      .returning({ id: locations.id });
    const locationId = location!.id;
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
