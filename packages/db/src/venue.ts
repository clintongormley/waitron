import { AppError, type BusinessDayClock } from "@waitron/shared";
import { asc, eq } from "drizzle-orm";
import "./errors.js";
import type { Transaction } from "./client.js";
import { locationDayCutoverChanges } from "./schema/business-day-clock.js";
import { locations } from "./schema/tenants.js";

/** The venue's settings, as stored. */
export interface Venue {
  name: string;
  invoiceLocales: string[];
  operationDescription: string;
  fiscalTerritory: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  /** As stored and never validated: the zone repair has to read an invalid one. */
  timeZone: string;
  /** As stored: "HH:MM:SS". */
  dayCutover: string;
  defaultCatalogueId: string | null;
}

export interface VenuePlace {
  province: string | null;
  city: string | null;
}

async function venueRow(tx: Transaction): Promise<Venue & { id: string }> {
  const rows = await tx
    .select({
      id: locations.id,
      name: locations.name,
      invoiceLocales: locations.invoiceLocales,
      operationDescription: locations.operationDescription,
      fiscalTerritory: locations.fiscalTerritory,
      addressLine1: locations.addressLine1,
      addressLine2: locations.addressLine2,
      postalCode: locations.postalCode,
      city: locations.city,
      province: locations.province,
      timeZone: locations.timeZone,
      dayCutover: locations.dayCutover,
      defaultCatalogueId: locations.catalogueId,
    })
    .from(locations)
    .limit(2);
  if (rows.length === 0) throw new AppError("venue.not_found", {});
  if (rows.length > 1) throw new AppError("provisioning.second_venue", {});
  return rows[0]!;
}

export async function readVenue(tx: Transaction): Promise<Venue> {
  const { id: _id, ...venue } = await venueRow(tx);
  return venue;
}

function storedCutover(value: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value) ? value.slice(0, 5) : value;
}

export async function readVenueClockAndPlace(
  tx: Transaction,
): Promise<{ clock: BusinessDayClock; place: VenuePlace }> {
  const venue = await venueRow(tx);
  const changes = await tx
    .select({
      effectiveBusinessDay: locationDayCutoverChanges.effectiveBusinessDay,
      dayCutover: locationDayCutoverChanges.dayCutover,
    })
    .from(locationDayCutoverChanges)
    .where(eq(locationDayCutoverChanges.locationId, venue.id))
    .orderBy(asc(locationDayCutoverChanges.effectiveBusinessDay));
  return {
    clock: {
      timeZone: venue.timeZone,
      dayCutover: storedCutover(venue.dayCutover),
      cutoverChanges: changes.map((change) => ({
        effectiveBusinessDay: change.effectiveBusinessDay,
        dayCutover: storedCutover(change.dayCutover),
      })),
    },
    place: { province: venue.province, city: venue.city },
  };
}

export async function readVenueClock(tx: Transaction): Promise<BusinessDayClock> {
  return (await readVenueClockAndPlace(tx)).clock;
}

/** Interim, until the schema stops keying rows by location: the one `locations` row's id, for code
 * that must still fill a `location_id` column. */
export async function venueLocationId(tx: Transaction): Promise<string> {
  return (await venueRow(tx)).id;
}
