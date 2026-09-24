import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { nodes } from "./nodes.js";
import { locations, tenants } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

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
    // `UNIQUE_VIOLATION` covers a primary key as well as any other unique index; `refusalOn` adds
    // that the collision was on `nodes.id` and not on some sibling index of this table.
    await db.insert(nodes).values({ id: NODE_A1, locationId: LOCATION_A, name: "N" });
    const error = await captureError(() =>
      db.insert(nodes).values({ id: NODE_A1, locationId: LOCATION_A, name: "N again" }),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "nodes", columns: ["id"] })).toBe(true);
  });

  it("is what the fiscal and commercial node foreign keys point at, by its id", async () => {
    // Read the definition back rather than trusting that an FK pointing at `nodes` has this shape.
    // Not checked: a constraint NAME, which `pragma_foreign_key_list` does not report.
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
    // A foreign-key refusal on this engine names no table and no column, so the class is all the
    // refusal itself can say. The positive control below closes that gap: the same insert with a
    // real location is accepted, and `location_id` is the only value the two calls set differently.
    const accepted = await db
      .insert(nodes)
      .values({ locationId: LOCATION_A, name: "Orphan" })
      .returning({ id: nodes.id });
    expect(accepted).toHaveLength(1);
    const error = await captureError(() =>
      db.insert(nodes).values({ locationId: LOCATION_MISSING, name: "Orphan" }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  describe("tenants fiscal identity is country + tax_id", () => {
    it("has country and tax_id, not nif, and a (country, tax_id) unique index", async () => {
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
    const cols = await db.execute<{ name: string }>(
      sql`select name from pragma_table_info('nodes')`,
    );
    const names = cols.rows.map((r) => r.name);
    expect(names).toContain("filing_module");
    expect(names).toContain("tax_module");
  });
});
