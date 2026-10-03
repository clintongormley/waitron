import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { useVenueDb } from "./venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { deviceProfiles } from "../schema/device-profiles.js";
import { devices } from "../schema/devices.js";
import { kitchenStations } from "../schema/kitchen-stations.js";
import { locations, tills } from "../schema/tenants.js";
import { freshNif, seedDevice, seedKitchenStation, seedNode, seedTenant } from "./seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from devices`);
  await suite.db.execute(sql`delete from tills`);
  await suite.db.execute(sql`delete from device_profiles`);
  await suite.db.execute(sql`delete from kitchen_stations`);
  await suite.db.execute(sql`delete from nodes`);
  await suite.db.execute(sql`delete from locations`);
  await suite.db.execute(sql`delete from tenants`);
});

describe("freshNif", () => {
  // Deliberately asserts the SHAPE and the base, never a specific counter value: the counter is
  // module-global and any other test in this file that seeds a tenant advances it, so pinning a
  // value here would make the file order-dependent.
  it("returns an 8-digit NIF on the 40-million base no other generator in this repo uses", () => {
    expect(freshNif()).toMatch(/^4\d{7}K$/);
  });

  it("never repeats within a run", () => {
    const minted = new Set(Array.from({ length: 5 }, () => freshNif()));
    expect(minted.size).toBe(5);
  });
});

describe("seedTenant", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("inserts the one taxpayer row, keyed 1", async () => {
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(*) as n from tenants where id = 1`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("is a no-op when the row is already there, so a suite may call it repeatedly", async () => {
    await seedTenant(db);
    await seedTenant(db);
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(sql`select count(*) as n from tenants`);
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("seedNode", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("inserts one node for the tenant + location and returns its id", async () => {
    // seedNode takes the location as given, so build it first: a node FKs it, and
    // there is deliberately no seedLocation helper.
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Test location",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      })
      .returning({ id: locations.id });
    const location = brandLocationId(loc!.id);
    const node = await seedNode(db, location);
    const result = await db.execute<{ n: number }>(
      sql`select count(*) as n from nodes where id = ${node} and location_id = ${location}`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("seedKitchenStation", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  // Build the tenant + location the station FKs first (as seedNode's suite does), then seed the station.
  async function seedVenue() {
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Test location",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      })
      .returning({ id: locations.id });
    return { location: brandLocationId(loc!.id) };
  }

  it("defaults to a DEFAULT station named 'Cocina' and returns its id", async () => {
    const { location } = await seedVenue();
    const id = await seedKitchenStation(db, { locationId: location });
    // Read through the table rather than as raw SQL: SQLite stores a flag as 0/1 and only the
    // column's own mapping turns it back into a boolean.
    const rows = await db
      .select({ name: kitchenStations.name, isDefault: kitchenStations.isDefault })
      .from(kitchenStations)
      .where(and(eq(kitchenStations.id, id), eq(kitchenStations.locationId, location)));
    expect(rows[0]).toEqual({ name: "Cocina", isDefault: true });
  });

  it("honours an overridden name and is_default", async () => {
    const { location } = await seedVenue();
    const id = await seedKitchenStation(db, {
      locationId: location,
      name: "Barra",
      isDefault: false,
    });
    const rows = await db
      .select({ name: kitchenStations.name, isDefault: kitchenStations.isDefault })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, id));
    expect(rows[0]).toEqual({ name: "Barra", isDefault: false });
  });
});

describe("seedDevice", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  async function seedLocation(database: Database) {
    const [loc] = await database
      .insert(locations)
      .values({
        name: "Test location",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      })
      .returning({ id: locations.id });
    return brandLocationId(loc!.id);
  }

  it("seedDevice pairs an active device on a new till profile at the location", async () => {
    await seedTenant(db);
    const location = await seedLocation(db);
    const { deviceId, profileId } = await seedDevice(db, { locationId: location, label: "Barra" });
    const [row] = await db
      .select({
        label: devices.label,
        active: devices.active,
        locationId: devices.locationId,
        formFactor: deviceProfiles.formFactor,
        capabilities: deviceProfiles.capabilities,
      })
      .from(devices)
      .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
      .where(eq(devices.id, deviceId));
    expect(row).toEqual({
      label: "Barra",
      active: true,
      locationId: location,
      formFactor: "till",
      capabilities: [],
    });
    expect(profileId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("seedDevice reuses a given profile and takes the form factor and capabilities asked for", async () => {
    await seedTenant(db);
    const location = await seedLocation(db);
    const first = await seedDevice(db, {
      locationId: location,
      formFactor: "phone-portrait",
      capabilities: ["take-cash"],
    });
    const second = await seedDevice(db, { locationId: location, profileId: first.profileId });
    expect(second.profileId).toBe(first.profileId);
    expect(second.deviceId).not.toBe(first.deviceId);
    const profiles = await db
      .select({
        formFactor: deviceProfiles.formFactor,
        capabilities: deviceProfiles.capabilities,
      })
      .from(deviceProfiles);
    expect(profiles).toEqual([{ formFactor: "phone-portrait", capabilities: ["take-cash"] }]);
  });

  it("seedDevice on a given till binds that till, at its location, and makes no other", async () => {
    await seedTenant(db);
    const location = await seedLocation(db);
    const [till] = await db
      .insert(tills)
      .values({ locationId: location, name: "Caja 1" })
      .returning({ id: tills.id });
    const { deviceId } = await seedDevice(db, { tillId: till!.id });
    const [row] = await db
      .select({ tillId: devices.tillId, locationId: devices.locationId })
      .from(devices)
      .where(eq(devices.id, deviceId));
    expect(row).toEqual({ tillId: till!.id, locationId: location });
    expect(await db.select({ id: tills.id }).from(tills)).toEqual([{ id: till!.id }]);
  });
});
