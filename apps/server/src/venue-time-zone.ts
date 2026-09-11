import { and, eq } from "drizzle-orm";
import { asAppUser, locations, withTenant, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

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
    if (location === undefined) {
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_TILL_LOCATION_ID",
        reason: "location_not_found",
      });
    }
    return location.timeZone;
  });
}
