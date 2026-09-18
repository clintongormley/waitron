import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "./venue-db.js";

/**
 * `useVenueDb` is the one way a suite asks for a venue database, so that the storage switch
 * replaces one function body rather than every call site. These cases are about the CONTRACT a
 * caller relies on — a migrated database, and data emptied between tests — not about which engine
 * is behind it today.
 */
describe("useVenueDb", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("yields a migrated database", async () => {
    const result = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });

  it("accepts a write", async () => {
    await suite.db.execute(
      sql`insert into tenants (id, country, tax_id, legal_name) values (1, 'ES', 'B00000000', 'Probe')`,
    );
    const result = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 1 });
  });

  // The case that matters: a helper that silently stopped resetting would pass the two above.
  it("emptied the previous test's row", async () => {
    const result = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });
});
