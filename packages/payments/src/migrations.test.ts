// WHAT THE TRANSLATION LOST, engine by engine, because every loss below is a case that used to
// fail and now cannot.
//
// This suite read PostgreSQL's own catalogue — `information_schema.columns`, `pg_enum`,
// `pg_indexes`, `pg_proc`, `to_regclass`. SQLite has none of them, so each read moved to
// `sqlite_master` or the `pragma table_info` / `index_list` / `index_info` family, and three facts
// went with the old catalogue:
//
//  - **The column TYPE no longer separates one meaning from another.** `information_schema` gave
//    `timestamp with time zone` for a timestamp and `bigint` with `numeric_scale = 0` for a money
//    column; `pragma table_info` gives `TEXT` and `INTEGER`. `packages/db/src/schema/columns.ts`
//    states the same thing from the other end: every timestamp, label and json column emits `text`
//    and every money, quantity and count column emits `integer`, so the declared type can no longer
//    tell a cents count from a thousandths count. What is asserted below is the storage class the
//    vocabulary now produces; the SCALE assertion has no counterpart at all and is gone.
//  - **There is no enum type.** `payment_state` was a PostgreSQL enum and its labels were rows in
//    `pg_enum`. Drizzle's SQLite generator emits the same list as a CHECK constraint instead
//    (`packages/payments/drizzle/0000_baseline.sql`, `payments_state_ck`), so the three cases that
//    read `pg_enum` now read that constraint's own text out of `sqlite_master`. Reading DDL text is
//    weaker than reading a catalogue table: a label spelt inside a comment in the same statement
//    would be found by {@link acceptedPaymentStates} too.
//  - **There are no stored functions.** See the `resolve_payment_tenant` note further down.
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

/** One row of `pragma table_info`, the three columns this suite reads. `notnull` is 1 for a NOT
 * NULL column and 0 otherwise — the replacement for `information_schema`'s `is_nullable`. A `type`
 * rather than an `interface` so it satisfies `db.execute`'s `Record<string, unknown>` row
 * constraint. */
type ColumnRow = {
  name: string;
  type: string;
  notnull: number;
};

/** One row of `pragma index_list`. `unique` is 1 for a unique index; `origin` is `c` for a
 * `CREATE INDEX` and `pk` for the primary key's implicit index. A `type` for the reason
 * {@link ColumnRow} gives. */
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
 * The values `payments_state_ck` accepts, in the order the constraint lists them.
 *
 * The replacement for `select enumlabel from pg_enum join pg_type …`. The constraint's text is read
 * back out of `sqlite_master` and its `in (…)` list split on the comma — measured on this tree, the
 * stored text is
 * `CONSTRAINT "payments_state_ck" CHECK("payments"."state" in ('attempting', 'captured', …))`.
 * Throws rather than returning an empty list when the constraint is not found, so a renamed or
 * dropped constraint fails loudly instead of passing three `toContain` assertions vacuously.
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

  // WHAT THIS CASE LOST. It used to assert that `runMigrations(db, PAYMENTS_MIGRATIONS)` on an
  // unmigrated database REJECTS, because every `REFERENCES` in the set named a core table that did
  // not exist yet and PostgreSQL resolves a foreign key's target when the table is created. That
  // refusal was the only thing in the suite pinning "payments must be applied after core", and it
  // is gone: SQLite resolves a foreign key's target by NAME at DML time, so `CREATE TABLE` with a
  // `REFERENCES working_orders(id)` succeeds against a database that holds no `working_orders`.
  //
  // Measured on this tree rather than read: the payments set applied ALONE to a virgin venue file
  // resolved, and `sqlite_master` then held card_readers, device_card_readers, payment_policy,
  // payment_refunds and payments. The assertion below is that measurement, kept as a live receipt
  // so it fails the day the engine or the migrator starts refusing — a comment could not.
  //
  // Nothing now catches a set applied in the wrong order. The ordering is stated by the caller
  // (`CORE_MIGRATIONS` first in this file's own `useVenueDb` call, and `applyMigrations` in
  // `packages/migrations/src/apply.ts` for the product) and by nothing else.
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
    // `TEXT` where this case read `text` from `information_schema`: same storage class, read from
    // the engine's own catalogue, which upper-cases what the generator wrote lower-case.
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
    // `TEXT`, not `timestamp with time zone`: `packages/db/src/schema/columns.ts`'s `ts` helper
    // stores a moment as an ISO-8601 string. Nothing in the column's declared type now says it is a
    // timestamp at all — the helper's name and the read mapping do.
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
    // A plain, NON-UNIQUE index: a unique one here would break any legitimate
    // "N rows sharing a key" writer (the PR #25 lesson). `pg_indexes.indexdef` carried the word
    // UNIQUE; `pragma index_list` carries it as the `unique` flag, which is a stronger read than
    // the substring match this replaces.
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
    // Every money column this set owns counts whole cents, so none has a fractional part to store.
    // `INTEGER` is what `columns.ts`'s `money` helper emits. The `numeric_scale = 0` half of this
    // assertion is GONE and has no replacement: SQLite's type affinity carries no scale, so nothing
    // in the schema now refuses a fractional value written into one of these columns — only
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
    // `created_at` and `updated_at` are named because their defaults are the drizzle schema's
    // `$defaultFn`, which a raw insert does not go through — without them the engine refuses with
    // `NOT NULL constraint failed: payment_policy.created_at` (measured on this tree).
    const stamps = sql`'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'`;
    await db.execute(sql`
        insert into payment_policy (offline_mode, offline_amount_cap, created_at, updated_at)
        values ('cash_only', 0, ${stamps})`);
    const stored = await db.execute<{ id: number }>(sql`select id from payment_policy`);
    expect(stored.rows).toEqual([{ id: 1 }]);

    // `async () => { await … }` rather than a bare expression arrow: `execute` returns a
    // `RawResult`, not a Promise (`packages/store/src/node-sqlite-adapter.ts`), and `captureError`
    // takes `() => Promise<unknown>`. The engine throws synchronously, so the wrapper turns the
    // throw into the rejection `captureError` is written to catch.
    const second = await captureError(async () => {
      await db.execute(sql`
          insert into payment_policy (id, offline_mode, offline_amount_cap, created_at, updated_at)
          values (2, 'cash_only', 0, ${stamps})`);
    });
    expect(isRefusal(second, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(second)).toMatch(/payment_policy_singleton_ck/);

    // WHICH CONSTRAINT REFUSES THE SECOND ROW HAS CHANGED, and the old assertion named the one that
    // no longer fires. On PostgreSQL `id` took its `DEFAULT 1`, so an insert omitting it collided
    // with the existing row's PRIMARY KEY and the case asserted `23505`. SQLite ignores a column
    // DEFAULT on an `integer primary key`, which is a rowid alias: measured with a control on
    // 2026-09-22 on Node v26.7.0, a table `(id integer primary key default 1 not null, v text)`
    // took two inserts omitting `id` and stored them as 1 and 2, where the same DEFAULT on a
    // NON-alias integer column did apply. So the second row here is assigned rowid 2 and it is
    // `payment_policy_singleton_ck` that refuses it, not the key.
    //
    // The invariant the case exists for — no second row — still holds, and the assertion is
    // narrower than the one it replaces (it names the constraint, where `23505` named only the
    // class). What is no longer true is the sentence "id defaults to 1": the first row is 1 because
    // it is the first rowid.
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

  // DELETED: "drops resolve_payment_tenant, the webhook's tenant lookup", which read
  // `select count(*) from pg_proc where proname = 'resolve_payment_tenant'` and asserted 0.
  //
  // Its subject does not exist on this engine. SQLite stores no user-defined functions at all —
  // `sqlite_master` holds tables, indexes, triggers and views and nothing else — so there is no
  // catalogue to read and no object that could survive the migration. The coverage lost is the
  // proof that the DROP statement ran: if a future migration re-introduced a per-tenant lookup as
  // some other object, nothing in this file would see it.
});
