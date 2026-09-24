// `pragma foreign_key_list` reports no foreign key's name, and drizzle emits these keys unnamed, so
// the keys are checked here by shape; their names are pinned on the drizzle table object, in
// `src/schema/bookings.test.ts`.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { BOOKINGS_MIGRATIONS } from "./migrations.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";

/** A `type`, not an `interface`, so it satisfies `db.execute`'s `Record<string, unknown>` row
 * constraint: TypeScript gives an interface no implicit index signature. */
type ForeignKeyRow = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

/** `origin` is `c` for a `CREATE INDEX`, `u` for a UNIQUE constraint and `pk` for the implicit
 * primary-key index. */
type IndexRow = {
  name: string;
  origin: string;
};

describe("BOOKINGS_MIGRATIONS is the module's own migration lane", () => {
  it("targets a bookings-specific journal table, isolated from core's", () => {
    expect(BOOKINGS_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_bookings");
    expect(BOOKINGS_MIGRATIONS.migrationsFolder).toMatch(/bookings\/drizzle$/);
  });
});

describe("the full manifest carries the bookings module's table and every FK", () => {
  const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

  it("creates the `bookings` relation", async () => {
    const rows = await suite.db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'bookings'`,
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["bookings"]);
  });

  it("installs all three FKs — one per parent, each from one column at its parent's primary key", async () => {
    const rows = await suite.db.execute<ForeignKeyRow>(sql`pragma foreign_key_list('bookings')`);
    expect(
      rows.rows
        .map((r) => ({ from: r.from, table: r.table, to: r.to, onDelete: r.on_delete }))
        .sort((a, b) => (a.from < b.from ? -1 : 1)),
    ).toEqual([
      // The booking must never orphan its location.
      { from: "location_id", table: "locations", to: "id", onDelete: "RESTRICT" },
      { from: "tab_id", table: "working_orders", to: "id", onDelete: "NO ACTION" },
      { from: "table_id", table: "dining_tables", to: "id", onDelete: "NO ACTION" },
    ]);
  });

  it("carries no tenant_id column, no unique key, and indexes without the tenant", async () => {
    const columns = await suite.db.execute<{ name: string }>(
      sql`select name from pragma_table_info('bookings') where name = 'tenant_id'`,
    );
    expect(columns.rows).toEqual([]);

    const indexes = await suite.db.execute<IndexRow>(sql`pragma index_list('bookings')`);
    expect(indexes.rows.filter((r) => r.origin === "u")).toEqual([]);

    const created = indexes.rows.filter((r) => r.origin === "c").map((r) => r.name);
    const withColumns: [string, string[]][] = [];
    for (const name of [...created].sort()) {
      const info = await suite.db.execute<{ name: string }>(
        sql`select name from pragma_index_info(${name})`,
      );
      withColumns.push([name, info.rows.map((r) => r.name)]);
    }
    expect(withColumns).toEqual([
      ["bookings_location_date_idx", ["location_id", "booking_date"]],
      [
        "bookings_table_status_date_time_idx",
        ["table_id", "status", "booking_date", "booking_time"],
      ],
    ]);
  });
});

describe("core applied ALONE carries no bookings", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("has no `bookings` relation — the table left core with the module", async () => {
    const rows = await suite.db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'bookings'`,
    );
    expect(rows.rows).toEqual([]);
  });
});
