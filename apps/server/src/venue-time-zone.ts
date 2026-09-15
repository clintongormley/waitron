import { eq } from "drizzle-orm";
import { asAppUser, locations, withTransaction, type Database } from "@waitron/db";

/** Onboarding derives this zone from the address; email times use the deployment's location. */
export function readVenueTimeZone(db: Database, input: { locationId: string }): Promise<string> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    const [location] = await tx
      .select({ timeZone: locations.timeZone })
      .from(locations)
      .where(eq(locations.id, input.locationId));
    // Email formatting must remain usable when the deployment has no valid stored zone.
    if (location === undefined) return "UTC";
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: location.timeZone }).resolvedOptions()
        .timeZone;
    } catch {
      return "UTC";
    }
  });
}
