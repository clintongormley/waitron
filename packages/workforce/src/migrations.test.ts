import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { hashPin } from "./verify-pin.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";

let tenantId: string;

const suite = usePgliteDb({
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

const PIN = hashPin("1234");

describe("the workforce migration set", () => {
  it("creates persons with row-level security both enabled and forced", async () => {
    // relforcerowsecurity is the load-bearing half: ENABLE alone (drizzle's .enableRLS(), migration
    // 0000) leaves the table owner and every superuser exempt, so the tenant policy would not bind
    // the deployment role. FORCE comes from the hand-written 0001 — deleting its FORCE line drops
    // relforcerowsecurity to false and fails this.
    const result = await suite.db.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'persons'`);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("stores a person and defaults role to staff and status to active", async () => {
    await suite.db.execute(sql`
      insert into persons (tenant_id, display_name, pin_hash)
      values (${tenantId}, 'Ana', ${PIN})`);
    const rows = await suite.db.execute<{ role: string; status: string }>(sql`
      select role, status from persons where tenant_id = ${tenantId} and display_name = 'Ana'`);
    expect(rows.rows[0]).toEqual({ role: "staff", status: "active" });
  });

  it("accepts every workforce_role value", async () => {
    for (const role of ["staff", "supervisor", "manager", "admin"]) {
      await suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, ${`role-${role}`}, ${PIN}, ${role})`);
    }
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from persons
      where tenant_id = ${tenantId} and role in ('staff','supervisor','manager','admin')`);
    expect(rows.rows[0]!.n).toBeGreaterThanOrEqual(4);
  });

  it("rejects a role outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'Bad role', ${PIN}, 'ceo')`),
    );
    expect(pgErrorCode(error)).toBe("22P02"); // invalid_text_representation
  });

  it("rejects a status outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, status)
        values (${tenantId}, 'Bad status', ${PIN}, 'fired')`),
    );
    expect(pgErrorCode(error)).toBe("22P02");
  });

  it("rejects an empty display_name", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash)
        values (${tenantId}, '', ${PIN})`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/persons_display_name_ck/);
  });

  it("rejects an empty pin_hash", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash)
        values (${tenantId}, 'No pin', '')`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/persons_pin_hash_ck/);
  });

  it("rejects a row whose tenant does not exist", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash)
        values (gen_random_uuid(), 'Orphan', ${PIN})`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});
