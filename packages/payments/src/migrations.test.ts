import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("payments migrations", () => {
  it("apply cleanly after core", async () => {
    const db = suite.db;
    const rows = await db.execute<{ to_regclass: string | null }>(
      sql`select to_regclass('public.payments')::text as to_regclass`,
    );
    expect(rows.rows[0].to_regclass).toBe("payments");
  });

  it("fails when run before core (the FK targets do not exist yet)", async () => {
    // This case needs an unmigrated database to exercise the missing FK targets.
    const db = await createPgliteDb();
    try {
      await expect(runMigrations(db, PAYMENTS_MIGRATIONS)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("adds a nullable external_ref column to payments", async () => {
    const db = suite.db;
    const rows = await db.execute<{ data_type: string; is_nullable: string }>(sql`
        select data_type, is_nullable
        from information_schema.columns
        where table_name = 'payments' and column_name = 'external_ref'
      `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].data_type).toBe("text");
    expect(rows.rows[0].is_nullable).toBe("YES");
  });

  it("adds 'attempting' to the payment_state enum", async () => {
    const db = suite.db;
    const rows = await db.execute<{ enumlabel: string }>(sql`
        select e.enumlabel from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = 'payment_state'
      `);
    expect(rows.rows.map((r) => r.enumlabel)).toContain("attempting");
  });

  it("adds accepted_offline, settled and declined to the payment_state enum", async () => {
    const db = suite.db;
    const rows = await db.execute<{ enumlabel: string }>(sql`
        select e.enumlabel from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = 'payment_state'
      `);
    const labels = rows.rows.map((r) => r.enumlabel);
    expect(labels).toEqual(expect.arrayContaining(["accepted_offline", "settled", "declined"]));
  });

  it("adds 'initiated' to the payment_state enum", async () => {
    const db = suite.db;
    const rows = await db.execute<{ enumlabel: string }>(sql`
        select e.enumlabel from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = 'payment_state'
      `);
    expect(rows.rows.map((r) => r.enumlabel)).toContain("initiated");
  });

  it("adds a nullable reconcile_remediated_at column to payments", async () => {
    const db = suite.db;
    const rows = await db.execute<{ data_type: string; is_nullable: string }>(sql`
        select data_type, is_nullable
        from information_schema.columns
        where table_name = 'payments' and column_name = 'reconcile_remediated_at'
      `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].data_type).toBe("timestamp with time zone");
    expect(rows.rows[0].is_nullable).toBe("YES");
  });

  it("creates the reconcile sweep index on payments", async () => {
    const db = suite.db;
    const rows = await db.execute<{ indexdef: string }>(sql`
        select indexdef from pg_indexes
        where tablename = 'payments' and indexname = 'payments_reconcile_idx'
      `);
    expect(rows.rows).toHaveLength(1);
    // A plain, NON-UNIQUE index: a unique one here would break any legitimate
    // "N rows sharing a key" writer (the PR #25 lesson).
    expect(rows.rows[0].indexdef).not.toContain("UNIQUE");
    expect(rows.rows[0].indexdef).toContain("tenant_id");
    expect(rows.rows[0].indexdef).toContain("provider");
    expect(rows.rows[0].indexdef).toContain("settled_at");
  });

  it("creates the payment_policy table with a numeric(12,2) offline_amount_cap", async () => {
    const db = suite.db;
    const table = await db.execute<{ to_regclass: string | null }>(
      sql`select to_regclass('public.payment_policy')::text as to_regclass`,
    );
    expect(table.rows[0].to_regclass).toBe("payment_policy");
    const col = await db.execute<{
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(sql`
        select data_type, numeric_precision, numeric_scale
        from information_schema.columns
        where table_name = 'payment_policy' and column_name = 'offline_amount_cap'
      `);
    expect(col.rows[0].data_type).toBe("numeric");
    expect(col.rows[0].numeric_precision).toBe(12);
    expect(col.rows[0].numeric_scale).toBe(2);
  });
});
