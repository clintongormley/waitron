import { withPrinter } from "../station-printer-list.js";
import { parties } from "../schema/parties.js";
import { partyAllergyGuests } from "../schema/venue-service/party-allergy.js";
import { persons } from "../schema/identity/persons.js";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { deviceId as brandDeviceId, nodeId as brandNodeId } from "@waitron/shared";
import type { DeviceId, NodeId } from "@waitron/shared";
import type { Database, Transaction } from "../client.js";
import { departments } from "../schema/venue-service/service.js";
import { floorZones } from "../schema/floor-zones.js";
import { deviceFormFactorEnum, deviceProfiles } from "../schema/device-profiles.js";
import { devices } from "../schema/devices.js";
import { kitchenStations } from "../schema/kitchen-stations.js";
import { nodes } from "../schema/nodes.js";
import { workingOrders } from "../schema/orders.js";
import { newId, nowIso } from "../schema/columns.js";
import { settings } from "../schema/settings.js";
import {
  BUSINESS_DAY_SETTINGS,
  VENUE_SETTINGS,
  FIRST_DAY_START,
  type VenueSettings,
} from "../venue-settings.js";
import { readSettings, saveSettings } from "../settings.js";
import { dayCutoverChanges } from "../schema/day-cutover-changes.js";
import { catalogues } from "../schema/catalogue.js";
import { createVenueSettings, saveVenueFields, readVenueSettings, type Venue } from "../venue.js";

import { deviceProfileAdmissionRoles } from "../schema/identity/profile-admission.js";
import { staffRoles } from "../schema/identity/staff-roles.js";

export const FIXTURE_JOB_ROLE = "Fixture team";
export async function ensureFixtureJobRole(db: Database | Transaction): Promise<string> {
  const [existing] = await db
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(eq(staffRoles.name, FIXTURE_JOB_ROLE), isNull(staffRoles.hiddenAt)));
  if (existing) return existing.id;
  const [created] = await db
    .insert(staffRoles)
    .values({ name: FIXTURE_JOB_ROLE })
    .returning({ id: staffRoles.id });
  return created!.id;
}

export async function seedVenueSettings(
  db: Database | Transaction,
  overrides: Partial<VenueSettings> = {},
): Promise<void> {
  const [row] = await db
    .select({ module: settings.module })
    .from(settings)
    .where(eq(settings.module, "venue"));
  if (row === undefined) {
    await createVenueSettings(
      db,
      {
        cloudVenueId: null,
        streamId: null,
        name: "Test venue",
        fiscalTerritory: "ES-common",
        operationDescription: "Restaurant",
        invoiceLocales: ["es"],
        contentLanguages: null,
        defaultContentLanguage: null,
        holidayArea: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        province: null,
        ...overrides,
      },
      null,
    );
  } else {
    await saveVenueFields(db, overrides, null);
  }
}

// The taxpayer row is a singleton keyed on id = 1, so a suite has at most one NIF in play and a
// second seed is a no-op. The counter survives because other fixtures still mint their own NIFs for
// rows that are not the taxpayer (a restore's recorded identity, for one), and because a suite that
// truncates `tenants` between tests re-seeds a row whose NIF need not repeat.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(40_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Makes sure the database's ONE taxpayer row exists. Idempotent: `tenants.id` is pinned to 1 by its
 * primary key and `tenants_singleton_ck`, so a second call adds nothing and returns nothing to
 * scope a query by.
 */
export async function seedTenant(db: Database | Transaction): Promise<void> {
  // Plain SQL: upgrade tests seed a database migrated only to an earlier point, where today's
  // columns do not exist yet.
  await db.run(sql`insert into tenants (id, country, tax_id, legal_name, created_at)
    values (1, 'ES', ${freshNif()}, 'Test SL', ${nowIso()})
    on conflict (id) do nothing`);
}

/** Writes the taxpayer row ({@link seedTenant}) and the one venue; refuses a second venue. */
export async function seedVenue(
  db: Database | Transaction,
  overrides: Partial<Venue> & { defaultCatalogueId?: string | null } = {},
): Promise<void> {
  const existing = await readSettings(db, VENUE_SETTINGS);
  if (existing.revision > 0) throw new Error("seedVenue: a venue document already exists");
  await seedTenant(db);
  const {
    defaultCatalogueId,
    invoiceLocales,
    name,
    addressLine1,
    addressLine2,
    postalCode,
    city,
    province,
    timeZone,
    dayCutover,
    fiscalTerritory,
    operationDescription,
  } = overrides;
  if (defaultCatalogueId !== undefined) {
    await db.update(catalogues).set({ isDefault: false }).where(eq(catalogues.isDefault, true));
    if (defaultCatalogueId !== null)
      await db
        .update(catalogues)
        .set({ isDefault: true })
        .where(eq(catalogues.id, defaultCatalogueId));
  }
  const doc: Partial<VenueSettings> = {};
  for (const [key, value] of Object.entries({
    name,
    invoiceLocales,
    addressLine1,
    addressLine2,
    postalCode,
    city,
    province,
    fiscalTerritory,
    operationDescription,
  }))
    if (value !== undefined) Object.assign(doc, { [key]: value });
  await seedVenueSettings(db, doc);
  await seedBusinessDay(db, { timeZone, dayCutover });
}

export async function seedNode(db: Database | Transaction): Promise<NodeId> {
  const [row] = await db.insert(nodes).values({ name: "Test node" }).returning({ id: nodes.id });
  return brandNodeId(row!.id);
}

/** Seeds one kitchen station; defaults to the default station. */
export async function seedKitchenStation(
  db: Database | Transaction,
  opts: { name?: string; isDefault?: boolean } = {},
): Promise<string> {
  const { name = "Cocina", isDefault = true } = opts;
  const [row] = await db
    .insert(kitchenStations)
    .values({ name, isDefault })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

export type DeviceProfileInsert = typeof deviceProfiles.$inferInsert & {
  admitted?: readonly string[];
};
export async function seedDeviceProfiles(
  db: Database | Transaction,
  values: DeviceProfileInsert | readonly DeviceProfileInsert[],
): Promise<(typeof deviceProfiles.$inferSelect)[]> {
  const seeds = [values].flat();
  const rows = await db
    .insert(deviceProfiles)
    .values(
      seeds.map((seed) => {
        const row = { ...seed };
        delete row.admitted;
        return row;
      }),
    )
    .returning();
  const fixtureRole = seeds.some((seed) => seed.admitted === undefined)
    ? await ensureFixtureJobRole(db)
    : null;
  const admissions = rows.flatMap((row, i) =>
    (seeds[i]!.admitted ?? [fixtureRole!]).map((staffRoleId) => ({
      deviceProfileId: row.id,
      staffRoleId,
    })),
  );
  if (admissions.length > 0) await db.insert(deviceProfileAdmissionRoles).values(admissions);
  return rows;
}

let deviceCounter = 0;

/** Pairs one active device on `profileId` or on a new
 * profile of `formFactor` (till by default). */
export async function seedDevice(
  db: Database | Transaction,
  opts: {
    label?: string;
    formFactor?: Exclude<(typeof deviceFormFactorEnum.enumValues)[number], "kds">;
    capabilities?: string[];
    profileId?: string;
  } = {},
): Promise<{ deviceId: DeviceId; profileId: string }> {
  await readVenueSettings(db);
  deviceCounter += 1;
  const label = opts.label ?? `Device ${deviceCounter}`;
  const profileId =
    opts.profileId ??
    (
      await seedDeviceProfiles(db, {
        name: `Profile ${deviceCounter}`,
        formFactor: opts.formFactor ?? "till",
        capabilities: opts.capabilities ?? [],
      })
    )[0]!.id;
  const [row] = await db
    .insert(devices)
    .values({
      deviceProfileId: profileId,
      label,
      tokenHash: "seeded",
    })
    .returning({ id: devices.id });
  return { deviceId: brandDeviceId(row!.id), profileId };
}

/** Seeds one working order at the venue and returns the row. Defaults to source "dashboard" (which
 * needs no device) and order number 1. */
export async function seedWorkingOrder(
  db: Database | Transaction,
  values: Partial<typeof workingOrders.$inferInsert> = {},
): Promise<typeof workingOrders.$inferSelect> {
  const [row] = await db
    .insert(workingOrders)
    .values({
      source: "dashboard",
      orderNumber: 1,
      ...values,
    })
    .returning();
  return row!;
}

export async function seedBusinessDay(
  db: Database | Transaction,
  overrides: { timeZone?: string; dayCutover?: string } = {},
): Promise<void> {
  const current = await readSettings(db, BUSINESS_DAY_SETTINGS);
  if (current.revision === 0 || overrides.timeZone !== undefined) {
    await saveSettings(db, BUSINESS_DAY_SETTINGS, {
      doc: {
        ...current.doc,
        ...(overrides.timeZone === undefined ? {} : { timeZone: overrides.timeZone }),
      },
      expectedRevision: current.revision,
      personId: null,
    });
  }
  const value = overrides.dayCutover ?? "06:00:00";
  const stored = value.length === 5 ? `${value}:00` : value;
  if (overrides.dayCutover !== undefined) {
    await db
      .delete(dayCutoverChanges)
      .where(
        and(
          eq(dayCutoverChanges.effectiveBusinessDay, FIRST_DAY_START),
          ne(dayCutoverChanges.dayCutover, stored),
        ),
      );
  }
  await db
    .insert(dayCutoverChanges)
    .values({
      effectiveBusinessDay: FIRST_DAY_START,
      dayCutover: stored,
    })
    .onConflictDoNothing({ target: dayCutoverChanges.effectiveBusinessDay });
}

export async function seedZone(
  db: Database | Transaction,
  input: {
    id?: string;
    name: string;
    displayOrder?: number;
    active?: boolean;
    departmentId?: string;
    isCounterDefault?: boolean;
  },
): Promise<{ id: string; departmentId: string }> {
  let departmentId = input.departmentId;
  if (departmentId === undefined) {
    const [active] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.createdAt))
      .limit(1);
    departmentId = active?.id;
    if (departmentId === undefined) {
      const [existingDefault] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.isDefault, true))
        .limit(1);
      const [created] = await db
        .insert(departments)
        .values({
          name: "Test floor department",
          tradingName: "Test floor department",
          isDefault: existingDefault === undefined,
        })
        .returning({ id: departments.id });
      departmentId = created!.id;
    }
  }
  const [zone] = await db
    .insert(floorZones)
    .values({ ...input, departmentId })
    .returning({ id: floorZones.id, departmentId: floorZones.departmentId });
  return zone!;
}

export async function seedPerson(
  db: Database | Transaction,
  input: { id?: string; displayName?: string } = {},
): Promise<string> {
  const id = input.id ?? newId();
  await db
    .insert(persons)
    .values({ id, displayName: input.displayName ?? "Test person" })
    .onConflictDoNothing({ target: persons.id });
  return id;
}

export async function seedActivityActor(db: Database | Transaction) {
  const personId = await seedPerson(db, { id: "test-activity-person", displayName: "Today actor" });
  return { personId, deviceId: null, authorizedBy: personId };
}

export async function clearPartyAllergyForTest(
  db: Database | Transaction,
  partyId: string,
): Promise<void> {
  await db.delete(partyAllergyGuests).where(eq(partyAllergyGuests.partyId, partyId));
  await db
    .update(parties)
    .set({ allergyAnswer: null, allergyAnsweredBy: null, allergyAnsweredAt: null })
    .where(eq(parties.id, partyId));
}

export async function attachStationPrinterForTest(
  tx: Database | Transaction,
  stationId: string,
  printerId: string,
): Promise<void> {
  const [station] = await tx
    .select({ printerIds: kitchenStations.printerIds })
    .from(kitchenStations)
    .where(eq(kitchenStations.id, stationId));
  await tx
    .update(kitchenStations)
    .set({ printerIds: withPrinter(station!.printerIds, printerId) })
    .where(eq(kitchenStations.id, stationId));
}
