import { readVenue, withTransaction, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";

/** The zone as the runtime names it, or UTC when the runtime does not know it. */
export function knownZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** Onboarding derives this zone from the address; email times use the venue's. */
export function readVenueTimeZone(db: Database): Promise<string> {
  return withTransaction(db, async (tx) => {
    try {
      return knownZone((await readVenue(tx)).timeZone);
    } catch (error) {
      // Email formatting must remain usable when the venue has no valid stored zone.
      if (error instanceof AppError && error.code === "venue.not_found") return "UTC";
      throw error;
    }
  });
}
