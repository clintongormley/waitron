import { seedPhotoMetadata } from "./seed.js";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { useVenueDb } from "./venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { menus } from "../schema/menus.js";
import { deviceProfiles } from "../schema/device-profiles.js";
import { devices } from "../schema/devices.js";
import { kitchenStations } from "../schema/kitchen-stations.js";
import { nodes } from "../schema/nodes.js";
import { readTaxpayer } from "../read-taxpayer.js";
import { readVenue } from "../venue.js";
import { withTransaction } from "../tenancy.js";
import {
  freshNif,
  seedDevice,
  seedDepartmentReceipt,
  seedDeviceProfiles,
  seedKitchenStation,
  seedNode,
  seedTaxpayer,
  seedVenue,
  seedWorkingOrder,
  seedZone,
} from "./seed.js";

import { departments } from "../schema/venue-service/service.js";
import { floorZones } from "../schema/floor-zones.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from working_orders`);
  await suite.db.execute(sql`delete from devices`);
  await suite.db.execute(sql`delete from device_profiles`);
  await suite.db.execute(sql`delete from kitchen_stations`);
  await suite.db.execute(sql`delete from nodes`);
  await suite.db.execute(sql`delete from menus`);
  await suite.db.execute(sql`delete from taxpayer`);
});

describe("freshNif", () => {
  // Deliberately asserts the SHAPE and the base, never a specific counter value: the counter is
  // module-global and any other test in this file that seeds a taxpayer advances it, so pinning a
  // value here would make the file order-dependent.
  it("returns an 8-digit NIF on the 40-million base no other generator in this repo uses", () => {
    expect(freshNif()).toMatch(/^4\d{7}K$/);
  });

  it("never repeats within a run", () => {
    const minted = new Set(Array.from({ length: 5 }, () => freshNif()));
    expect(minted.size).toBe(5);
  });
});

describe("seedTaxpayer", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("inserts the one taxpayer row, keyed 1", async () => {
    await seedTaxpayer(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(*) as n from taxpayer where id = 1`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("is a no-op when the row is already there, so a suite may call it repeatedly", async () => {
    await seedTaxpayer(db);
    await seedTaxpayer(db);
    await seedTaxpayer(db);
    const result = await db.execute<{ n: number }>(sql`select count(*) as n from taxpayer`);
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("seedVenue", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("seedVenue writes the taxpayer and the one venue", async () => {
    await seedVenue(db, { name: "House", timeZone: "Atlantic/Canary" });
    expect(await readTaxpayer(db)).not.toBeNull();
    expect(await readVenue(db)).toEqual({
      name: "House",
      invoiceLocales: ["es"],
      fiscalTerritory: "ES-common",
      addressLine1: null,
      addressLine2: null,
      postalCode: null,
      city: null,
      province: null,
      timeZone: "Atlantic/Canary",
      dayCutover: "06:00:00",
    });
  });

  it("seedVenue writes defaultMenuId as the venue's menu", async () => {
    const [menu] = await db.insert(menus).values({ name: "Menu" }).returning({ id: menus.id });
    await seedVenue(db, { defaultMenuId: menu!.id });
    expect(await db.select({ id: menus.id }).from(menus).where(eq(menus.isDefault, true))).toEqual([
      { id: menu!.id },
    ]);
  });

  it("seedVenue refuses a second venue", async () => {
    await seedVenue(db);
    expect((await readVenue(db)).name).toBe("Test venue");
    await expect(seedVenue(db)).rejects.toThrow("seedVenue: a venue document already exists");
  });
});

describe("seedNode", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("inserts one node and returns its id without requiring a venue", async () => {
    const node = await seedNode(db);
    const [row] = await db
      .select({ id: nodes.id, name: nodes.name })
      .from(nodes)
      .where(eq(nodes.id, node));
    expect(row).toEqual({ id: node, name: "Test node" });
  });
});

describe("seedKitchenStation", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  async function seedTaxpayerAndVenue() {
    await seedTaxpayer(db);
    await seedVenueSettings(db, {});
    await seedBusinessDay(db, {});
  }

  it("defaults to a DEFAULT station named 'Cocina' and returns its id", async () => {
    await seedTaxpayerAndVenue();
    const id = await seedKitchenStation(db, {});
    // Read through the table rather than as raw SQL: SQLite stores a flag as 0/1 and only the
    // column's own mapping turns it back into a boolean.
    const rows = await db
      .select({ name: kitchenStations.name, isDefault: kitchenStations.isDefault })
      .from(kitchenStations)
      .where(and(eq(kitchenStations.id, id)));
    expect(rows[0]).toEqual({ name: "Cocina", isDefault: true });
  });

  it("honours an overridden name and is_default", async () => {
    await seedTaxpayerAndVenue();
    const id = await seedKitchenStation(db, {
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

  async function seedVenueFixture(database: Database) {
    await seedVenueSettings(database, {});
    await seedBusinessDay(database, {});
  }

  it("seedDevice pairs an active device on a new till profile at the venue", async () => {
    await seedTaxpayer(db);
    await seedVenueFixture(db);
    const { deviceId, profileId } = await seedDevice(db, { label: "Barra" });
    const [row] = await db
      .select({
        label: devices.label,
        active: devices.active,
        formFactor: deviceProfiles.formFactor,
        capabilities: deviceProfiles.capabilities,
      })
      .from(devices)
      .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
      .where(eq(devices.id, deviceId));
    expect(row).toEqual({
      label: "Barra",
      active: true,
      formFactor: "till",
      capabilities: [],
    });
    expect(profileId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("seedDevice reuses a given profile and takes the form factor and capabilities asked for", async () => {
    await seedTaxpayer(db);
    await seedVenueFixture(db);
    const first = await seedDevice(db, {
      formFactor: "phone-portrait",
      capabilities: ["take-cash"],
    });
    const second = await seedDevice(db, { profileId: first.profileId });
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

  it("seedDevice with no venue refuses before writing a profile", async () => {
    const error: unknown = await seedDevice(db).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "venue.not_found" });
    expect(await db.select({ id: deviceProfiles.id }).from(deviceProfiles)).toEqual([]);
    expect(await db.select({ id: devices.id }).from(devices)).toEqual([]);
  });
});

describe("seedWorkingOrder", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("defaults to the next free order number after an explicit number", async () => {
    await seedVenue(db);
    await seedWorkingOrder(db, { orderNumber: 7 });
    expect((await seedWorkingOrder(db)).orderNumber).toBe(8);
    expect((await seedWorkingOrder(db)).orderNumber).toBe(9);
  });

  it("seedWorkingOrder writes an open order at the venue", async () => {
    await seedVenue(db);
    const order = await seedWorkingOrder(db);
    expect(order).toMatchObject({
      status: "open",
      source: "dashboard",
      orderNumber: 1,
    });
    const node = await seedNode(db);
    const overridden = await seedWorkingOrder(db, { orderNumber: 7, nodeId: node });
    expect(overridden).toMatchObject({ orderNumber: 7, nodeId: node });
  });
});

describe("the helpers inside a transaction", () => {
  it("take the transaction handle withTransaction gives its body", async () => {
    const order = await withTransaction(suite.db, async (tx) => {
      await seedTaxpayer(tx);
      await seedVenue(tx, { name: "In a transaction" });
      const node = await seedNode(tx);
      await seedDevice(tx);
      await seedKitchenStation(tx, {});
      return seedWorkingOrder(tx, { nodeId: node });
    });
    expect((await readVenue(suite.db)).name).toBe("In a transaction");
    expect(order.nodeId).toEqual(expect.any(String));
  });
});

it("seeds one device profile with defaults and returns every stored field", async () => {
  const rows = await seedDeviceProfiles(suite.db, { name: "Front till", formFactor: "till" });
  expect(rows).toHaveLength(1);
  const [profile] = rows;
  expect(profile!.capabilities).toEqual([]);
  expect(profile!.name).toBe("Front till");
  const [stored] = await suite.db
    .select()
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profile!.id));
  expect(profile).toEqual(stored);
});
it("seeds multiple device profiles inside the caller's transaction", async () => {
  const profiles = await withTransaction(suite.db, (tx) =>
    seedDeviceProfiles(tx, [
      { name: "Handheld", formFactor: "phone-portrait", capabilities: ["take-orders"] },
      { name: "Kitchen", formFactor: "kds", capabilities: ["prepare-orders"] },
    ]),
  );
  expect(profiles.map((row) => [row.name, row.formFactor, row.capabilities])).toEqual([
    ["Handheld", "phone-portrait", ["take-orders"]],
    ["Kitchen", "kds", ["prepare-orders"]],
  ]);
  expect(await suite.db.select().from(deviceProfiles)).toHaveLength(2);
});

describe("seedZone", () => {
  it("uses the first active department by creation time", async () => {
    const rows = await suite.db
      .insert(departments)
      .values([
        {
          name: "Deleted",
          tradingName: "Deleted",
          active: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        { name: "First", tradingName: "First", createdAt: "2026-02-01T00:00:00.000Z" },
        { name: "Last", tradingName: "Last", createdAt: "2026-03-01T00:00:00.000Z" },
      ])
      .returning({ id: departments.id });
    const zone = await seedZone(suite.db, { name: "Terrace", displayOrder: 4 });
    expect(zone.departmentId).toBe(rows[1]!.id);
    expect(
      await suite.db
        .select({
          name: floorZones.name,
          displayOrder: floorZones.displayOrder,
          departmentId: floorZones.departmentId,
        })
        .from(floorZones),
    ).toEqual([{ name: "Terrace", displayOrder: 4, departmentId: rows[1]!.id }]);
  });
  it("creates one department when none is active and reuses it", async () => {
    await suite.db
      .insert(departments)
      .values({ name: "Retired", tradingName: "Retired", active: false, isDefault: true });
    const first = await seedZone(suite.db, { name: "Terrace" });
    const second = await seedZone(suite.db, { name: "Counter", isCounterDefault: true });
    expect(second.departmentId).toBe(first.departmentId);
    expect(
      await suite.db
        .select({ name: departments.name, isDefault: departments.isDefault })
        .from(departments)
        .where(eq(departments.active, true)),
    ).toEqual([{ name: "Test floor department", isDefault: false }]);
    expect(
      await suite.db
        .select({ counter: floorZones.isCounterDefault })
        .from(floorZones)
        .where(eq(floorZones.id, second.id)),
    ).toEqual([{ counter: true }]);
  });
  it("uses the department supplied and defaults the new department once", async () => {
    const first = await seedZone(suite.db, { name: "Bar" });
    const [other] = await suite.db
      .insert(departments)
      .values({ name: "Kitchen", tradingName: "Kitchen" })
      .returning({ id: departments.id });
    const second = await seedZone(suite.db, { name: "Pass", departmentId: other!.id });
    expect(second.departmentId).toBe(other!.id);
    expect(
      await suite.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.isDefault, true)),
    ).toEqual([{ id: first.departmentId }]);
  });
});

describe("seedDepartmentReceipt", () => {
  const filename = `${"e".repeat(64)}.png`;
  const rasters = {
    "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
    "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
  };
  it("resolves the filename and stores text, pictures and a saved time on the department", async () => {
    await suite.db
      .insert(departments)
      .values({ id: "receipt-department", name: "Dining", tradingName: "Dining" });
    await seedPhotoMetadata(suite.db, { id: "receipt-image", filename, names: {} });
    await withTransaction(suite.db, (tx) =>
      seedDepartmentReceipt(tx, "receipt-department", { logo: filename, phone: "123" }, rasters),
    );
    expect(
      await suite.db
        .select({
          text: departments.receiptText,
          logo: departments.receiptLogoImageId,
          pictures: departments.receiptLogoRasters,
          saved: departments.receiptUpdatedAt,
        })
        .from(departments),
    ).toEqual([
      {
        text: { phone: "123" },
        logo: "receipt-image",
        pictures: rasters,
        saved: expect.any(String),
      },
    ]);
  });
  it("replaces the receipt and clears the image and defaulted picture cache", async () => {
    await seedPhotoMetadata(suite.db, { id: "receipt-image", filename, names: {} });
    await suite.db.insert(departments).values({
      id: "receipt-department",
      name: "Dining",
      tradingName: "Dining",
      receiptLogoImageId: "receipt-image",
      receiptLogoRasters: rasters,
      receiptText: { phone: "Old" },
    });
    await seedDepartmentReceipt(suite.db, "receipt-department", { email: "dining@example.test" });
    expect(
      await suite.db
        .select({
          text: departments.receiptText,
          logo: departments.receiptLogoImageId,
          pictures: departments.receiptLogoRasters,
          saved: departments.receiptUpdatedAt,
        })
        .from(departments),
    ).toEqual([
      {
        text: { email: "dining@example.test" },
        logo: null,
        pictures: null,
        saved: expect.any(String),
      },
    ]);
  });
  it("refuses a missing image before changing the receipt", async () => {
    await suite.db.insert(departments).values({
      id: "receipt-department",
      name: "Dining",
      tradingName: "Dining",
      receiptText: { phone: "Keep" },
    });
    const before = await suite.db.select().from(departments);
    await expect(
      seedDepartmentReceipt(suite.db, "receipt-department", { logo: filename }, rasters),
    ).rejects.toThrow(`Receipt logo image not found: ${filename}`);
    expect(await suite.db.select().from(departments)).toEqual(before);
  });
});
