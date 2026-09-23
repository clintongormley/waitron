import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { nodes } from "./nodes.js";
import { locations, tenants } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from nodes`);
  await suite.db.execute(sql`delete from locations`);
  await suite.db.execute(sql`delete from tenants`);
});

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const NODE_A1 = "aaaaaaaa-2222-4000-8000-000000000001";
// Never seeded — the FK target for the "location does not exist" rejection below.
const LOCATION_MISSING = "cccccccc-0000-4000-8000-000000000009";

/** Normalise the query result before reading catalog rows. */
async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      name: "Fixture Location A",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    },
    {
      id: LOCATION_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    },
  ]);
}

describe("nodes schema", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("inserts a node under its tenant", async () => {
    await db.insert(nodes).values({ locationId: LOCATION_A, name: "Node A1" });
    const found = await db.select({ name: nodes.name }).from(nodes);
    expect(found.map((r) => r.name)).toEqual(["Node A1"]);
  });

  it("rejects a duplicate id with a uniqueness violation", async () => {
    // `id` is the primary key, and it is what the foreign keys from the fiscal and commercial
    // tables point at (see the definition test below).
    //
    // The refusal names the key rather than carrying a SQLSTATE: measured on this case, it arrives
    // as errcode 1555 with `UNIQUE constraint failed: nodes.id`. `UNIQUE_VIOLATION` covers 1555
    // (primary key) as well as 2067 (any other unique index), which is what keeps this the same
    // question the `23505` assertion asked, and `refusalOn` adds the half that SQLSTATE could not
    // express — that the collision was on `nodes.id` and not on some sibling index of this table.
    await db.insert(nodes).values({ id: NODE_A1, locationId: LOCATION_A, name: "N" });
    const error = await captureError(() =>
      db.insert(nodes).values({ id: NODE_A1, locationId: LOCATION_A, name: "N again" }),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "nodes", columns: ["id"] })).toBe(true);
  });

  it("is what the fiscal and commercial node foreign keys point at, by its id", async () => {
    // Read the definition back rather than trusting that an FK pointing at `nodes` has this shape.
    //
    // WHAT THIS CASE LOST. It used to read `pg_get_constraintdef(oid)` out of `pg_constraint`,
    // selecting the two rows BY CONSTRAINT NAME (`invoice_series_node_fk`, `sales_node_fk`) and
    // comparing the rendered definition strings. `pg_constraint` is not a table on this engine —
    // run as written this statement died with `no such table: pg_constraint` (measured on this
    // suite).
    //
    // `pragma_foreign_key_list` is the replacement. It reports the referencing column, the
    // referenced table and column, and the delete action — every part of the definition strings
    // this case compared, including the difference between the two, which is that only the sale's
    // key restricts the delete. It does NOT report a constraint NAME, because a SQLite foreign key
    // has none: drizzle's generator emits a bare `FOREIGN KEY (…) REFERENCES …(…)` clause. So the
    // name pin is gone and the shape pin stays, and each table's list is read separately because
    // the pragma takes one table.
    const nodeKeyOf = async (table: string) => {
      const keys = await rows<{ from: string; table: string; to: string; on_delete: string }>(
        db,
        sql`select "from", "table", "to", on_delete from pragma_foreign_key_list(${table})
             where "from" = 'node_id'`,
      );
      return keys;
    };
    expect(await nodeKeyOf("invoice_series")).toEqual([
      { from: "node_id", table: "nodes", to: "id", on_delete: "NO ACTION" },
    ]);
    expect(await nodeKeyOf("sales")).toEqual([
      { from: "node_id", table: "nodes", to: "id", on_delete: "RESTRICT" },
    ]);
  });

  it("rejects a node whose location does not exist with a foreign-key violation", async () => {
    // The brief framed this as "a location_id belonging to another tenant" — a
    // framing the schema never had and no longer could, since there is one
    // taxpayer per database. What the plain `location_id -> locations.id` FK
    // actually guarantees is referential existence, so that is what is asserted:
    // a location that does not exist is rejected.
    //
    // WHAT THIS CASE LOST, and what replaces it. A foreign-key refusal on this engine names no
    // table and no column — measured on this case, the whole message is
    // `FOREIGN KEY constraint failed` (errcode 787) — so the class is all the refusal itself can
    // say, and nothing in it distinguishes `location_id` from any other key on the row. The
    // positive control below is what closes that gap: the same insert with a real location is
    // accepted, and `location_id` is the only value the two calls set differently, so the refusal
    // cannot be coming from anything else this case supplies.
    const accepted = await db
      .insert(nodes)
      .values({ locationId: LOCATION_A, name: "Orphan" })
      .returning({ id: nodes.id });
    expect(accepted).toHaveLength(1);
    const error = await captureError(() =>
      db.insert(nodes).values({ locationId: LOCATION_MISSING, name: "Orphan" }),
    );
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  describe("tenants fiscal identity is country + tax_id", () => {
    it("has country and tax_id, not nif, and a (country, tax_id) unique index", async () => {
      // `information_schema.columns` and `pg_indexes` do not exist on this engine — run as written
      // each of these statements died with `no such table: …` (measured on this suite).
      // `pragma_table_info` and `pragma_index_list` are the replacements, following
      // `packages/payments/src/migrations.test.ts`. Nothing is lost in either half: the pragma
      // reports the same column NAMES, and it reports the index by the same NAME the migration
      // created it under — `tenants_country_tax_id_key` is what `pragma_index_list('tenants')`
      // returns on this package's own migrated database.
      const cols = await db.execute<{ name: string }>(
        sql`select name from pragma_table_info('tenants') order by name`,
      );
      const names = cols.rows.map((r) => r.name);
      expect(names).toContain("country");
      expect(names).toContain("tax_id");
      expect(names).not.toContain("nif");

      const idx = await db.execute<{ name: string }>(
        sql`select name from pragma_index_list('tenants')`,
      );
      const indexes = idx.rows.map((r) => r.name);
      expect(indexes).toContain("tenants_country_tax_id_key");
      expect(indexes).not.toContain("tenants_nif_key");
    });
  });

  it("locations carry fiscal_territory, an address, time_zone and day_cutover", async () => {
    // `pragma_table_info` for `information_schema.columns`, which does not exist here. Its
    // `notnull` is 1 for a NOT NULL column and 0 otherwise — the exact counterpart of
    // `is_nullable`'s 'NO'/'YES', so the three NOT NULL assertions carry across unchanged.
    const cols = await db.execute<{ name: string; notnull: number }>(
      sql`select name, "notnull" from pragma_table_info('locations')`,
    );
    const byName = new Map(cols.rows.map((r) => [r.name, r.notnull]));
    expect(byName.get("fiscal_territory")).toBe(1);
    expect(byName.get("time_zone")).toBe(1);
    expect(byName.get("day_cutover")).toBe(1);
    for (const a of ["address_line1", "address_line2", "postal_code", "city", "province"]) {
      expect(byName.has(a)).toBe(true);
    }
  });

  it("nodes record the resolved filing_module and tax_module", async () => {
    // `pragma_table_info` for `information_schema.columns`; the column names are the same.
    const cols = await db.execute<{ name: string }>(
      sql`select name from pragma_table_info('nodes')`,
    );
    const names = cols.rows.map((r) => r.name);
    expect(names).toContain("filing_module");
    expect(names).toContain("tax_module");
  });
});
