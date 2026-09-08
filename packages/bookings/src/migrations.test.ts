// The migration SPLIT proven on real Postgres (CLAUDE.md §4): the bookings table + all four FKs come
// from the MODULE's set, NOT from core, and core applied ALONE carries no `bookings` relation. Real PG
// rather than PGlite because the four FKs and the ACL are what this proves, and PGlite is a superuser
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

  it("installs all four FKs — the two single-column (core-side) and the two composite (custom-side)", async () => {
    const { rows } = await suite.admin.execute<{ conname: string }>(sql`
      select conname from pg_constraint
      where conrelid = 'public.bookings'::regclass and contype = 'f'
      order by conname`);
    expect(rows.map((r) => r.conname)).toEqual([
      "bookings_location_fk",
      "bookings_tab_fk",
      "bookings_table_fk",
      "bookings_tenant_fk",
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
