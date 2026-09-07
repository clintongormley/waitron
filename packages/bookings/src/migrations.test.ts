// The migration SPLIT proven on real Postgres (CLAUDE.md §4): the bookings table + all four FKs come
// from the MODULE's set, applied on top of core, and core applied ALONE carries no `bookings` relation.
// Real PG rather than PGlite because the four FKs and the ACL are what this proves, and PGlite is a
// superuser holding every grant. The templates are migrated once in globalSetup — `core_bookings` is
// [core, bookings] in that order, `core` is [core] alone — so this suite only clones them.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

describe("applying [core, bookings] creates the module's table and every FK", () => {
  const suite = useTemplateDb({ template: "core_bookings" });

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
