import { and, eq } from "drizzle-orm";
import { asAppUser, locations, withTenant, type Database } from "@waitron/db";

/** Onboarding derives this zone from the address; email times use the deployment's location. */
export function readVenueTimeZone(
  db: Database,
  input: { tenantId: string; locationId: string },
): Promise<string> {
  return withTenant(db, input.tenantId, async (tx) => {
    await asAppUser(tx);
    const [location] = await tx
      .select({ timeZone: locations.timeZone })
      .from(locations)
      .where(and(eq(locations.tenantId, input.tenantId), eq(locations.id, input.locationId)));
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
