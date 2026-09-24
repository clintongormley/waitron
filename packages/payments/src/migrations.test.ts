import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  captureError,
  isRefusal,
  engineErrorMessage,
  runMigrations,
  openVenueDatabase,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** A `type` rather than an `interface` so it satisfies `db.execute`'s `Record<string, unknown>`
 * row constraint. */
type ColumnRow = {
  name: string;
  type: string;
  notnull: number;
};

/** A `type` for the reason {@link ColumnRow} gives. */
type IndexRow = {
  name: string;
  unique: number;
  origin: string;
};

async function columnsOf(table: string): Promise<ColumnRow[]> {
  const rows = await db.execute<ColumnRow>(
    sql`select name, type, "notnull" from pragma_table_info(${table})`,
  );
  return rows.rows;
}

async function columnOf(table: string, column: string): Promise<ColumnRow | undefined> {
  return (await columnsOf(table)).find((c) => c.name === column);
}

/**
 * The values `payments_state_ck` accepts, read from its stored text:
 * `CONSTRAINT "payments_state_ck" CHECK("payments"."state" in ('attempting', 'captured', …))`.
 * Throws rather than returning an empty list, so a renamed or dropped constraint fails loudly
 * instead of passing the `toContain` assertions vacuously.
 */
async function acceptedPaymentStates(): Promise<string[]> {
  const rows = await db.execute<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'table' and name = 'payments'`,
  );
  const ddl = rows.rows[0]?.sql;
  if (ddl === undefined) throw new Error("no `payments` table in sqlite_master");
  const match = /CONSTRAINT "payments_state_ck" CHECK\([^)]*\bin \(([^)]*)\)\)/.exec(ddl);
  if (match === null) {
    throw new Error(`no payments_state_ck \`in (…)\` list found in:\n${ddl}`);
  }
  return match[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
}

describe("payments migrations", () => {
  it("apply cleanly after core", async () => {
    const rows = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'payments'`,
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["payments"]);
  });

  // Nothing here catches a set applied before core; the product's order comes from each module's
  // declared `requires` (`packages/migrations/src/apply.ts`).
  it("no longer fails when run before core — SQLite resolves an FK target at DML time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "waitron-payments-order-"));
    const store = await openVenueDatabase(directory);
    try {
      await runMigrations(store.venue, PAYMENTS_MIGRATIONS);
      const tables = await store.venue.execute<{ name: string }>(
        sql`select name from sqlite_master
            where type = 'table' and name not glob '__drizzle_migrations*' order by name`,
      );
      expect(tables.rows.map((r) => r.name)).toEqual([
        "card_readers",
        "device_card_readers",
        "payment_policy",
        "payment_refunds",
        "payments",
      ]);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("adds a nullable external_ref column to payments", async () => {
    expect(await columnOf("payments", "external_ref")).toEqual({
      name: "external_ref",
      type: "TEXT",
      notnull: 0,
    });
  });

  it("accepts 'attempting' as a payment state", async () => {
    expect(await acceptedPaymentStates()).toContain("attempting");
  });

  it("accepts accepted_offline, settled and declined as payment states", async () => {
    expect(await acceptedPaymentStates()).toEqual(
      expect.arrayContaining(["accepted_offline", "settled", "declined"]),
    );
  });

  it("accepts 'initiated' as a payment state", async () => {
    expect(await acceptedPaymentStates()).toContain("initiated");
  });

  it("adds a nullable reconcile_remediated_at column to payments", async () => {
    expect(await columnOf("payments", "reconcile_remediated_at")).toEqual({
      name: "reconcile_remediated_at",
      type: "TEXT",
      notnull: 0,
    });
  });

  it("creates the reconcile sweep index on payments", async () => {
    const indexes = await db.execute<IndexRow>(sql`pragma index_list('payments')`);
    const reconcile = indexes.rows.filter((r) => r.name === "payments_reconcile_idx");
    expect(reconcile).toHaveLength(1);
    // NON-UNIQUE: a unique one would refuse two payments sharing a provider and settlement time.
    expect(reconcile[0]!.unique).toBe(0);
    const columns = await db.execute<{ name: string }>(
      sql`select name from pragma_index_info('payments_reconcile_idx')`,
    );
    expect(columns.rows.map((r) => r.name)).toEqual(["provider", "settled_at"]);
  });

  it("creates payment_policy and leaves every money column a count of whole cents", async () => {
    const table = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'payment_policy'`,
    );
    expect(table.rows.map((r) => r.name)).toEqual(["payment_policy"]);
    // Nothing in the schema refuses a fractional value in these columns; only
    // `packages/shared/src/cents.ts` does, above the row.
    const money = [
      ["payment_policy", "offline_amount_cap"],
      ["payment_refunds", "amount"],
      ["payments", "amount"],
    ] as const;
    const found = [];
    for (const [table_name, column_name] of money) {
      found.push({ table_name, column: await columnOf(table_name, column_name) });
    }
    expect(found).toEqual([
      {
        table_name: "payment_policy",
        column: { name: "offline_amount_cap", type: "INTEGER", notnull: 1 },
      },
      { table_name: "payment_refunds", column: { name: "amount", type: "INTEGER", notnull: 1 } },
      { table_name: "payments", column: { name: "amount", type: "INTEGER", notnull: 1 } },
    ]);
  });

  it("carries no tenant_id column on any table in the set", async () => {
    const found: string[] = [];
    for (const table of [
      "payments",
      "payment_refunds",
      "payment_policy",
      "card_readers",
      "device_card_readers",
    ]) {
      for (const column of await columnsOf(table)) {
        if (column.name === "tenant_id") found.push(`${table}.${column.name}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("keeps payment_policy to one row: the first row is id 1 and no second row is accepted", async () => {
    // Named because their defaults are the drizzle schema's `$defaultFn`, which a raw insert skips.
    const stamps = sql`'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'`;
    await db.execute(sql`
        insert into payment_policy (offline_mode, offline_amount_cap, created_at, updated_at)
        values ('cash_only', 0, ${stamps})`);
    const stored = await db.execute<{ id: number }>(sql`select id from payment_policy`);
    expect(stored.rows).toEqual([{ id: 1 }]);

    // `execute` throws synchronously; the async wrapper turns that into the rejection
    // `captureError` catches.
    const second = await captureError(async () => {
      await db.execute(sql`
          insert into payment_policy (id, offline_mode, offline_amount_cap, created_at, updated_at)
          values (2, 'cash_only', 0, ${stamps})`);
    });
    expect(isRefusal(second, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(second)).toMatch(/payment_policy_singleton_ck/);

    // An `integer primary key` is a rowid alias and ignores its column DEFAULT, so a row omitting
    // `id` is assigned 2 and the singleton check, not the key, refuses it.
    const duplicate = await captureError(async () => {
      await db.execute(sql`
          insert into payment_policy (offline_mode, offline_amount_cap, created_at, updated_at)
          values ('cash_only', 0, ${stamps})`);
    });
    expect(isRefusal(duplicate, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(duplicate)).toMatch(/payment_policy_singleton_ck/);
    expect(
      (await db.execute<{ n: number }>(sql`select count(*) as n from payment_policy`)).rows,
    ).toEqual([{ n: 1 }]);
  });
});
