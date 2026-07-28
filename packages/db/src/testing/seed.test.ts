import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { describeEachTarget } from "./harness.js";
import { freshNif, seedTenant } from "./seed.js";

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
  it("inserts one tenant and returns its id", async () => {
    const db = await target.create();
    const id = await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants where id = ${id}`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("gives each tenant its own NIF, so a suite can seed several", async () => {
    const db = await target.create();
    await seedTenant(db);
    await seedTenant(db);
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(distinct nif)::int as n from tenants`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(3);
  });
});
