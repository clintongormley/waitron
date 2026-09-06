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

  it("inserts one tenant and returns its id", async () => {
    const id = await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants where id = ${id}`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("gives each tenant its own tax_id, so a suite can seed several", async () => {
    await seedTenant(db);
    await seedTenant(db);
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(distinct tax_id)::int as n from tenants`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(3);
  });
});

describe("seedNode", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("inserts one node for the tenant + location and returns its id", async () => {
    // seedNode takes the tenant and location as given, so build them first: a
    // node FKs both, and there is deliberately no seedLocation helper (only
    // seedTenant and seedNode exist).
    const tenant = await seedTenant(db);
    const locResult = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenant}, 'Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
    const location = brandLocationId(locResult.rows[0]!.id);
    const node = await seedNode(db, tenant, location);
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
    const tenant = await seedTenant(db);
    const locResult = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenant}, 'Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
    return { tenant, location: brandLocationId(locResult.rows[0]!.id) };
  }

  it("defaults to a DEFAULT station named 'Cocina' and returns its id", async () => {
    const { tenant, location } = await seedVenue();
    const id = await seedKitchenStation(db, { tenantId: tenant, locationId: location });
    const result = await db.execute<{ name: string; is_default: boolean }>(
      sql`select name, is_default from kitchen_stations where id = ${id} and location_id = ${location}`,
    );
    expect(result.rows[0]).toEqual({ name: "Cocina", is_default: true });
  });

  it("honours an overridden name and is_default", async () => {
    const { tenant, location } = await seedVenue();
    const id = await seedKitchenStation(db, {
      tenantId: tenant,
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
