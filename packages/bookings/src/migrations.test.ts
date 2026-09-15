// The migration SPLIT proven on real Postgres (CLAUDE.md §4): the bookings table + all three FKs come
// from the MODULE's set, NOT from core, and core applied ALONE carries no `bookings` relation. Real PG
// rather than PGlite because the three FKs and the ACL are what this proves, and PGlite is a superuser
// holding every grant. The templates are migrated once in globalSetup — `manifest` is the whole chain
// (bookings FKs into core, so it applies the whole manifest), `core` is [core] alone — so this suite
// only clones them. The core-vs-manifest contrast is what pins that
// `bookings` left core WITH the module rather than living in the core set.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { BOOKINGS_MIGRATIONS } from "./migrations.js";

describe("BOOKINGS_MIGRATIONS is the module's own migration lane", () => {
  it("targets a bookings-specific journal table, isolated from core's", () => {
    expect(BOOKINGS_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_bookings");
    expect(BOOKINGS_MIGRATIONS.migrationsFolder).toMatch(/bookings\/drizzle$/);
  });
});

describe("the full manifest carries the bookings module's table and every FK", () => {
  const suite = useTemplateDb({ template: "manifest" });

  it("creates the `bookings` relation", async () => {
    const { rows } = await suite.admin.execute<{ reg: string | null }>(
      sql`select to_regclass('public.bookings')::text as reg`,
    );
    expect(rows[0]!.reg).toBe("bookings");
  });

  it("installs all three FKs — location from the drizzle schema, table and tab from the custom migration", async () => {
    const { rows } = await suite.admin.execute<{ conname: string }>(sql`
      select conname from pg_constraint
      where conrelid = 'public.bookings'::regclass and contype = 'f'
      order by conname`);
    expect(rows.map((r) => r.conname)).toEqual([
      "bookings_location_fk",
      "bookings_tab_fk",
      "bookings_table_fk",
    ]);
  });

  it("points each foreign key from one column at its parent's primary key", async () => {
    const { rows } = await suite.admin.execute<{ def: string }>(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.bookings'::regclass and contype = 'f'
      order by conname`);
    expect(rows.map((r) => r.def)).toEqual([
      "FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT",
      "FOREIGN KEY (tab_id) REFERENCES working_orders(id)",
      "FOREIGN KEY (table_id) REFERENCES dining_tables(id)",
    ]);
  });

  it("carries no tenant_id column, no unique key, and indexes without the tenant", async () => {
    const columns = await suite.admin.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'bookings' and column_name = 'tenant_id'`);
    expect(columns.rows).toEqual([]);
    const uniques = await suite.admin.execute<{ conname: string }>(sql`
      select conname from pg_constraint
      where conrelid = 'public.bookings'::regclass and contype = 'u'`);
    expect(uniques.rows).toEqual([]);
    const indexes = await suite.admin.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'bookings' and indexname <> 'bookings_pkey'
      order by indexname`);
    expect(
      indexes.rows.map((r) => [r.indexname, r.indexdef.replace(/^.* USING btree /, "")]),
    ).toEqual([
      ["bookings_location_date_idx", "(location_id, booking_date)"],
      ["bookings_table_status_date_time_idx", "(table_id, status, booking_date, booking_time)"],
    ]);
  });
});

describe("core applied ALONE carries no bookings", () => {
  const suite = useTemplateDb({ template: "core" });

  it("has no `bookings` relation — the table left core with the module", async () => {
    const { rows } = await suite.admin.execute<{ reg: string | null }>(
      sql`select to_regclass('public.bookings')::text as reg`,
    );
    expect(rows[0]!.reg).toBeNull();
  });
});
