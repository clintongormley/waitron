import { AppError, type BusinessDayClock } from "@waitron/shared";
import { asc, sql, inArray } from "drizzle-orm";
import "./errors.js";
import type { Transaction } from "./client.js";
import { dayCutoverChanges } from "./schema/day-cutover-changes.js";
import { locations } from "./schema/tenants.js";
import { settings } from "./schema/settings.js";
import { decodeSettingsRow, readSettings, saveSettings, type SettingsRead } from "./settings.js";
import { VENUE_SETTINGS, BUSINESS_DAY_SETTINGS, type VenueSettings } from "./venue-settings.js";

function requireVenue<T>(read: SettingsRead<T>): SettingsRead<T> {
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
}

export interface VenuePlace {
  holidayArea?: VenueSettings["holidayArea"];
  province: string | null;
  city: string | null;
}

async function venueRow(tx: Transaction): Promise<{ id: string; venue: Venue }> {
  const { first, doc, businessDay } = await clockRows(tx);
  return {
    id: first.id,
    venue: {
      name: doc.name,
      invoiceLocales: doc.invoiceLocales,
      operationDescription: doc.operationDescription,
      fiscalTerritory: doc.fiscalTerritory,
      addressLine1: doc.addressLine1,
      addressLine2: doc.addressLine2,
      postalCode: doc.postalCode,
      city: doc.city,
      province: doc.province,
      timeZone: businessDay.timeZone,
      dayCutover: first.dayCutover!,
    },
  };
}

export async function readBusinessDayRevision(tx: Transaction): Promise<number> {
  return requireVenue(await readSettings(tx, BUSINESS_DAY_SETTINGS)).revision;
}

function theOneRow<T>(rows: T[]): T {
  if (rows.length === 0) throw new AppError("venue.not_found", {});
  if (rows.length > 1) throw new AppError("provisioning.second_venue", {});
  return rows[0]!;
}

export async function readVenue(tx: Transaction): Promise<Venue> {
  return (await venueRow(tx)).venue;
}

export async function readVenueInvoiceLocales(tx: Transaction): Promise<string[]> {
  return (await readVenueSettings(tx)).doc.invoiceLocales;
}

function storedCutover(value: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value) ? value.slice(0, 5) : value;
}

async function clockRows(tx: Transaction) {
  const rows = await tx
    .select({
      id: locations.id,
      effectiveBusinessDay: dayCutoverChanges.effectiveBusinessDay,
      dayCutover: dayCutoverChanges.dayCutover,
      document: {
        module: settings.module,
        version: settings.version,
        revision: settings.revision,
        doc: settings.doc,
      },
    })
    .from(locations)
    .leftJoin(settings, inArray(settings.module, ["venue", "business_day"]))
    .leftJoin(dayCutoverChanges, sql`true`)
    .orderBy(asc(dayCutoverChanges.effectiveBusinessDay));
  const location = rows[0];
  if (location === undefined) throw new AppError("venue.not_found", {});
  if (rows.some((row) => row.id !== location.id))
    throw new AppError("provisioning.second_venue", {});
  const doc = requireVenue(
    decodeSettingsRow(
      rows.find((row) => row.document?.module === "venue")?.document ?? undefined,
      VENUE_SETTINGS,
    ),
  ).doc;
  const businessDay = requireVenue(
    decodeSettingsRow(
      rows.find((row) => row.document?.module === "business_day")?.document ?? undefined,
      BUSINESS_DAY_SETTINGS,
    ),
  ).doc;
  const dayRows = rows.filter((row) => row.document?.module === "venue");
  const first = dayRows[0]!;
  if (first.effectiveBusinessDay === null) throw new AppError("venue.not_found", {});
  return { rows: dayRows, first, doc, businessDay };
}

export async function readVenueClockAndPlace(
  tx: Transaction,
): Promise<{ clock: BusinessDayClock; place: VenuePlace }> {
  const { rows, first, doc, businessDay } = await clockRows(tx);
  return {
    clock: {
      timeZone: businessDay.timeZone,
      dayCutover: storedCutover(first.dayCutover!),
      cutoverChanges: rows.slice(1).map((row) => ({
        effectiveBusinessDay: row.effectiveBusinessDay!,
        dayCutover: storedCutover(row.dayCutover!),
      })),
    },
    place: { province: doc.province, city: doc.city, holidayArea: doc.holidayArea },
  };
}

export async function readVenueClock(tx: Transaction): Promise<BusinessDayClock> {
  return (await readVenueClockAndPlace(tx)).clock;
}

/** Interim, until the schema stops keying rows by location: the one `locations` row's id. */
export async function venueLocationId(tx: Transaction): Promise<string> {
  return theOneRow(await tx.select({ id: locations.id }).from(locations).limit(2)).id;
}
