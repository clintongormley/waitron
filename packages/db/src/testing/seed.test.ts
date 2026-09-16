import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { usePgliteDb } from "./lifecycle.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { freshNif, seedKitchenStation, seedNode, seedTenant } from "./seed.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
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
      sql`select count(*)::int as n from tenants where id = 1`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("is a no-op when the row is already there, so a suite may call it repeatedly", async () => {
    await seedTenant(db);
    await seedTenant(db);
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
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
    // there is deliberately no seedLocation helper (only seedTenant and seedNode exist).
    await seedTenant(db);
    const locResult = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description) values ('Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
    const location = brandLocationId(locResult.rows[0]!.id);
    const node = await seedNode(db, location);
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from nodes where id = ${node} and location_id = ${location}`,
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
    const locResult = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description) values ('Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
    return { location: brandLocationId(locResult.rows[0]!.id) };
  }

  it("defaults to a DEFAULT station named 'Cocina' and returns its id", async () => {
    const { location } = await seedVenue();
    const id = await seedKitchenStation(db, { locationId: location });
    const result = await db.execute<{ name: string; is_default: boolean }>(
      sql`select name, is_default from kitchen_stations where id = ${id} and location_id = ${location}`,
    );
    expect(result.rows[0]).toEqual({ name: "Cocina", is_default: true });
  });

  it("honours an overridden name and is_default", async () => {
    const { location } = await seedVenue();
    const id = await seedKitchenStation(db, {
      locationId: location,
      name: "Barra",
      isDefault: false,
    });
    const result = await db.execute<{ name: string; is_default: boolean }>(
      sql`select name, is_default from kitchen_stations where id = ${id}`,
    );
    expect(result.rows[0]).toEqual({ name: "Barra", is_default: false });
  });
});
