import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";

describe("payments migrations", () => {
  it("apply cleanly after core", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      await runMigrations(db, PAYMENTS_MIGRATIONS);
      const rows = await db.execute<{ to_regclass: string | null }>(
        sql`select to_regclass('public.payments')::text as to_regclass`,
      );
      expect(rows.rows[0].to_regclass).toBe("payments");
    } finally {
      await db.close();
    }
  });

  it("fails when run before core (the FK targets and current_tenant_id() do not exist yet)", async () => {
    const db = await createPgliteDb();
    try {
      await expect(runMigrations(db, PAYMENTS_MIGRATIONS)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("adds a nullable external_ref column to payments", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      await runMigrations(db, PAYMENTS_MIGRATIONS);
      const rows = await db.execute<{ data_type: string; is_nullable: string }>(sql`
        select data_type, is_nullable
        from information_schema.columns
        where table_name = 'payments' and column_name = 'external_ref'
      `);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].data_type).toBe("text");
      expect(rows.rows[0].is_nullable).toBe("YES");
    } finally {
      await db.close();
    }
  });
});
