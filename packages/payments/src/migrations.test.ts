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
});
