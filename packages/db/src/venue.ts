import { AppError, type BusinessDayClock } from "@waitron/shared";
import { asc, eq } from "drizzle-orm";
import "./errors.js";
import type { Transaction } from "./client.js";
import { locationDayCutoverChanges } from "./schema/business-day-clock.js";
import { locations } from "./schema/tenants.js";
import { settings } from "./schema/settings.js";
import { decodeSettingsRow, readSettings, saveSettings, type SettingsRead } from "./settings.js";
import { VENUE_SETTINGS, type VenueSettings } from "./venue-settings.js";

function requireVenue(read: SettingsRead<VenueSettings>): SettingsRead<VenueSettings> {
  if (read.revision === 0) throw new AppError("venue.not_found", {});
  return read;
}

export async function readVenueSettings(tx: Transaction): Promise<SettingsRead<VenueSettings>> {
  return requireVenue(await readSettings(tx, VENUE_SETTINGS));
}

export async function createVenueSettings(
  tx: Transaction,
  doc: VenueSettings,
  personId: string | null,
): Promise<void> {
  await saveSettings(tx, VENUE_SETTINGS, { doc, expectedRevision: 0, personId });
}

export async function saveVenueFields(
  tx: Transaction,
  fields: Partial<VenueSettings>,
  personId: string | null,
): Promise<void> {
  const current = await readVenueSettings(tx);
  await saveSettings(tx, VENUE_SETTINGS, {
    doc: { ...current.doc, ...fields },
    expectedRevision: current.revision,
    personId,
  });
}

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

async function venueRow(tx: Transaction): Promise<{ id: string; venue: Venue }> {
  const rows = await tx
    .select({
      id: locations.id,
      invoiceLocales: locations.invoiceLocales,
      operationDescription: locations.operationDescription,
      fiscalTerritory: locations.fiscalTerritory,
      timeZone: locations.timeZone,
      dayCutover: locations.dayCutover,
      defaultCatalogueId: locations.catalogueId,
    })
    .from(locations)
    .limit(2);
  const { id, ...venue } = theOneRow(rows);
  return { id, venue: { ...venue, ...(await readVenueSettings(tx)).doc } };
}

function theOneRow<T>(rows: T[]): T {
  if (rows.length === 0) throw new AppError("venue.not_found", {});
  if (rows.length > 1) throw new AppError("provisioning.second_venue", {});
  return rows[0]!;
}

export async function readVenue(tx: Transaction): Promise<Venue> {
  return (await venueRow(tx)).venue;
}

/** Reads no other column, so an invoice reprint that must not depend on the venue's current
 * address can call it. */
export async function readVenueInvoiceLocales(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ invoiceLocales: locations.invoiceLocales })
    .from(locations)
    .limit(2);
  return theOneRow(rows).invoiceLocales;
}

function storedCutover(value: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value) ? value.slice(0, 5) : value;
}

export async function readVenueClockAndPlace(
  tx: Transaction,
): Promise<{ clock: BusinessDayClock; place: VenuePlace }> {
  const rows = await tx
    .select({
      id: locations.id,
      timeZone: locations.timeZone,
      dayCutover: locations.dayCutover,
      effectiveBusinessDay: locationDayCutoverChanges.effectiveBusinessDay,
      changedCutover: locationDayCutoverChanges.dayCutover,
      settings: {
        module: settings.module,
        version: settings.version,
        revision: settings.revision,
        doc: settings.doc,
      },
    })
    .from(locations)
    .leftJoin(settings, eq(settings.module, "venue"))
    .leftJoin(locationDayCutoverChanges, eq(locationDayCutoverChanges.locationId, locations.id))
    .orderBy(asc(locationDayCutoverChanges.effectiveBusinessDay));
  const venue = rows[0];
  if (venue === undefined) throw new AppError("venue.not_found", {});
  if (rows.some((row) => row.id !== venue.id)) {
    throw new AppError("provisioning.second_venue", {});
  }
  const place = requireVenue(decodeSettingsRow(venue.settings ?? undefined, VENUE_SETTINGS)).doc;
  return {
    clock: {
      timeZone: venue.timeZone,
      dayCutover: storedCutover(venue.dayCutover),
      cutoverChanges: rows.flatMap((row) =>
        row.effectiveBusinessDay === null
          ? []
          : [
              {
                effectiveBusinessDay: row.effectiveBusinessDay,
                dayCutover: storedCutover(row.changedCutover!),
              },
            ],
      ),
    },
    place: { province: place.province, city: place.city },
  };
}

export async function readVenueClock(tx: Transaction): Promise<BusinessDayClock> {
  return (await readVenueClockAndPlace(tx)).clock;
}

/** Interim, until the schema stops keying rows by location: the one `locations` row's id. */
export async function venueLocationId(tx: Transaction): Promise<string> {
  return theOneRow(await tx.select({ id: locations.id }).from(locations).limit(2)).id;
}
