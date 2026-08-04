import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { describeEachTarget } from "./harness.js";
import { freshNif, seedNode, seedTenant } from "./seed.js";

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

describeEachTarget("seedTenant", (target) => {
  // beforeEach/afterEach rather than a per-test `const db`, matching every other
  // describeEachTarget suite in this package: on the postgres target `target.create()` opens a
  // real pool against the suite's shared container, so a database this file opens and never
  // closes holds its backend for the rest of the run.
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("inserts one tenant and returns its id", async () => {
    const id = await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants where id = ${id}`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("gives each tenant its own NIF, so a suite can seed several", async () => {
    await seedTenant(db);
    await seedTenant(db);
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(distinct tax_id)::int as n from tenants`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(3);
  });
});

describeEachTarget("seedNode", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
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
