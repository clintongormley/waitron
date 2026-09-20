import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  createPgliteDb,
  pgErrorCode,
  pgErrorMessage,
  runMigrations,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

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
    expect(rows.rows[0].indexdef).toContain("(provider, settled_at)");
  });

  it("creates payment_policy and leaves every money column a count of whole cents", async () => {
    const db = suite.db;
    const table = await db.execute<{ to_regclass: string | null }>(
      sql`select to_regclass('public.payment_policy')::text as to_regclass`,
    );
    expect(table.rows[0].to_regclass).toBe("payment_policy");
    // Every money column this set owns counts whole cents, so none has a fractional part to
    // store. Read after the whole set has been applied, so a later `alter column` is included.
    const cols = await db.execute<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_scale: number | null;
    }>(sql`
        select table_name, column_name, data_type, numeric_scale
        from information_schema.columns
        where (table_name = 'payment_policy' and column_name = 'offline_amount_cap')
           or (table_name in ('payments', 'payment_refunds') and column_name = 'amount')
        order by table_name
      `);
    expect(cols.rows).toEqual([
      {
        table_name: "payment_policy",
        column_name: "offline_amount_cap",
        data_type: "bigint",
        numeric_scale: 0,
      },
      {
        table_name: "payment_refunds",
        column_name: "amount",
        data_type: "bigint",
        numeric_scale: 0,
      },
      { table_name: "payments", column_name: "amount", data_type: "bigint", numeric_scale: 0 },
    ]);
  });

  it("carries no tenant_id column on any table in the set", async () => {
    const rows = await suite.db.execute<{ table_name: string }>(sql`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'tenant_id'
          and table_name in ('payments', 'payment_refunds', 'payment_policy', 'card_readers',
                             'device_card_readers')
      `);
    expect(rows.rows).toEqual([]);
  });

  it("keeps payment_policy to one row: id defaults to 1 and no other id is accepted", async () => {
    await suite.db.execute(sql`
        insert into payment_policy (offline_mode, offline_amount_cap) values ('cash_only', 0)`);
    const stored = await suite.db.execute<{ id: number }>(sql`select id from payment_policy`);
    expect(stored.rows).toEqual([{ id: 1 }]);

    const second = await captureError(() =>
      suite.db.execute(sql`
          insert into payment_policy (id, offline_mode, offline_amount_cap)
          values (2, 'cash_only', 0)`),
    );
    expect(pgErrorCode(second)).toBe("23514"); // check_violation
    expect(pgErrorMessage(second)).toMatch(/payment_policy_singleton_ck/);

    const duplicate = await captureError(() =>
      suite.db.execute(sql`
          insert into payment_policy (offline_mode, offline_amount_cap) values ('cash_only', 0)`),
    );
    expect(pgErrorCode(duplicate)).toBe("23505"); // unique_violation on the primary key
  });

  it("drops resolve_payment_tenant, the webhook's tenant lookup", async () => {
    const rows = await suite.db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_proc where proname = 'resolve_payment_tenant'`);
    expect(rows.rows[0].n).toBe(0);
  });
});
