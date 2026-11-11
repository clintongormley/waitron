import { AppError, type BusinessDayClock } from "@waitron/shared";
import { asc, eq, sql } from "drizzle-orm";
import "./errors.js";
import type { Transaction } from "./client.js";
import { alias } from "drizzle-orm/sqlite-core";
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
  defaultCatalogueId: string | null;
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
      defaultCatalogueId: first.defaultCatalogueId,
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

const businessDayDocument = alias(settings, "business_day_document");

async function clockRows(tx: Transaction) {
  const rows = await tx
    .select({
      id: locations.id,
      defaultCatalogueId: locations.catalogueId,
      effectiveBusinessDay: dayCutoverChanges.effectiveBusinessDay,
      dayCutover: dayCutoverChanges.dayCutover,
      venueDocument: {
        module: settings.module,
        version: settings.version,
        revision: settings.revision,
        doc: settings.doc,
      },
      businessDayDocument: {
        module: businessDayDocument.module,
        version: businessDayDocument.version,
        revision: businessDayDocument.revision,
        doc: businessDayDocument.doc,
      },
    })
    .from(locations)
    .leftJoin(settings, eq(settings.module, "venue"))
    .leftJoin(businessDayDocument, eq(businessDayDocument.module, "business_day"))
    .leftJoin(dayCutoverChanges, sql`true`)
    .orderBy(asc(dayCutoverChanges.effectiveBusinessDay));
  const first = rows[0];
  if (first === undefined) throw new AppError("venue.not_found", {});
  if (rows.some((row) => row.id !== first.id)) throw new AppError("provisioning.second_venue", {});
  const doc = requireVenue(decodeSettingsRow(first.venueDocument ?? undefined, VENUE_SETTINGS)).doc;
  const businessDay = requireVenue(
    decodeSettingsRow(first.businessDayDocument ?? undefined, BUSINESS_DAY_SETTINGS),
  ).doc;
  if (first.effectiveBusinessDay === null) throw new AppError("venue.not_found", {});
  return { rows, first, doc, businessDay };
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
