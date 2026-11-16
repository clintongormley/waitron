import { readVenue, withTransaction, type Database, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";

/** The zone as the runtime names it, or UTC when the runtime does not know it. */
export function knownZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Email times and the pairing window's answer use the venue's zone; onboarding derives it from the
 * address.
 */
export async function venueTimeZoneIn(tx: Transaction): Promise<string> {
  try {
    return knownZone((await readVenue(tx)).timeZone);
  } catch (error) {
    // No venue is set up yet: times still show, in UTC.
    if (error instanceof AppError && error.code === "venue.not_found") return "UTC";
    throw error;
  }
}

export function readVenueTimeZone(db: Database): Promise<string> {
  return withTransaction(db, venueTimeZoneIn);
}
