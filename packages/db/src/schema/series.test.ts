import { randomUUID } from "node:crypto";
import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedNode } from "../testing/seed.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from invoice_series`);
  await suite.db.execute(sql`delete from nodes`);
  await suite.db.execute(sql`delete from tills`);
  await suite.db.execute(sql`delete from locations`);
  await suite.db.execute(sql`delete from tenants`);
});

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_A2 = "aaaaaaaa-1111-4000-8000-000000000002";

// A series is keyed on its NODE since the node-id rekey (2026-08-03): invoice_series dropped
// till_id and now carries a NOT NULL node_id. seed() creates two nodes for tenant A so the
// per-node uniqueness tests have a second node to collide against. The tills stay seeded — sales
// still ring on a till — but nothing in invoice_series references them.
let nodeA1 = "";
let nodeA2 = "";

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
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, locationId: LOCATION_A, name: "A1" },
    { id: TILL_A2, locationId: LOCATION_A, name: "A2" },
  ]);
  nodeA1 = await seedNode(db, brandLocationId(LOCATION_A));
  nodeA2 = await seedNode(db, brandLocationId(LOCATION_A));
}

describe("invoice_series schema", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("holds several series on one node", async () => {
    await db.insert(invoiceSeries).values([
      { nodeId: nodeA1, code: "FA", purpose: "standard", nextNumber: 1 },
      { nodeId: nodeA1, code: "RA", purpose: "rectificative", nextNumber: 1 },
    ]);
    const found = await db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, nodeA1));
    expect(found.map((r) => r.code).sort()).toEqual(["FA", "RA"]);
  });

  it("rejects a duplicate code on the same node", async () => {
    // Not `.rejects.toThrow(/pattern/)`: drizzle-orm@0.45.2 wraps every failed
    // query in a DrizzleQueryError whose own `.message` is
    // `Failed query: <sql>` — the real Postgres text lives on `.cause`
    // (see tenancy.test.ts's `rejectsWithCauseMatching` for the same finding).
    // `toThrow` only reads `.message`, so it would pass against any rejection
    // at all, not specifically this one.
    await db.insert(invoiceSeries).values({ nodeId: nodeA1, code: "FA", purpose: "standard" });
    const error = await captureError(() =>
      db.insert(invoiceSeries).values({ nodeId: nodeA1, code: "FA", purpose: "standard" }),
    );
    expect(pgErrorMessage(error)).toMatch(/duplicate key value/);
  });

  it("permits the same code on two different nodes", async () => {
    // Series codes are a per-node numbering concern (node-id rekey, 2026-08-03). Two nodes in one
    // venue both running series "FA" is normal, and their numbers are independent.
    await db.insert(invoiceSeries).values([
      { nodeId: nodeA1, code: "FA", purpose: "standard" },
      { nodeId: nodeA2, code: "FA", purpose: "standard" },
    ]);
    const found = await db.select({ id: invoiceSeries.id }).from(invoiceSeries);
    expect(found).toHaveLength(2);
  });

  it("rejects a purpose outside the permitted set", async () => {
    // Same wrapper issue as the duplicate-code test above: match the
    // unwrapped Postgres message, not the DrizzleQueryError's own.
    const error = await captureError(() =>
      db.insert(invoiceSeries).values({ nodeId: nodeA1, code: "XX", purpose: "invented" }),
    );
    expect(pgErrorMessage(error)).toMatch(/invoice_series_purpose_ck/);
  });

  it("has exactly the columns it has today — none relating a series to a chain", async () => {
    // Findings §1: series is a numbering concern, the chain is a device concern. A column named for
    // chain position here would be the first step towards per-series chaining, which AEAT art. 7.c)
    // forbids outright. An exact pin is the whole check: any new column — chain-named,
    // Spanish-named, or added by hand-written SQL in drizzle/ that no source scan sees — is a
    // deliberate edit here. (A Spanish column NAME in this package's schema source is the tree
    // guard's job, scripts/english-only.test.ts; fiscal's own terms are fiscal's to declare, not
    // this package's.)
    // `pragma_table_info` for `information_schema.columns`, which does not exist on this engine —
    // run as written this statement died with `no such table: information_schema.columns`
    // (measured on this suite). The pragma reports the same column NAMES, so the exact pin below
    // is unchanged and still catches any new column.
    const cols = await rows<{ name: string }>(
      db,
      sql`select name from pragma_table_info('invoice_series')`,
    );
    expect(cols.map((c) => c.name).sort()).toEqual([
      "code",
      "id",
      "next_number",
      "node_id",
      "purpose",
      "retired_at",
    ]);
  });

  it("carries a NOT NULL node_id column referencing nodes", async () => {
    // Node-id rekey (2026-08-03): node_id is now NOT NULL — a series is OWNED by a node (its SIF).
    // This supersedes Task 3's scaffolding assertion that the column was nullable. Raw SQL for the
    // inserts so a mis-migrated run fails on the real cause rather than a drizzle column-object error
    // — the same reason sales.test.ts's corrective-link tests use a raw insert.
    //
    // `id` is named explicitly in the raw inserts below because `invoice_series.id` is
    // `$defaultFn(newId)` — a JavaScript generator rather than a SQL DEFAULT, which a raw insert
    // never reaches. Without it the first insert was refused
    // `NOT NULL constraint failed: invoice_series.id` and this case never got as far as the
    // node_id refusal it is about (measured on this case). Supplying it keeps the insert raw,
    // which is what the paragraph above asks for.
    const node = await seedNode(db, brandLocationId(LOCATION_A));
    // `pragma_table_info` for `information_schema.columns`. Its `notnull` is 1 for a NOT NULL
    // column and 0 otherwise — the exact counterpart of `is_nullable`'s 'NO'/'YES', so the
    // assertion carries across unchanged.
    const meta = await rows<{ notnull: number }>(
      db,
      sql`select "notnull" from pragma_table_info('invoice_series') where name = 'node_id'`,
    );
    expect(meta).toEqual([{ notnull: 1 }]);
    // Accepts a valid node id.
    const withNode = await rows<{ node_id: string | null }>(
      db,
      sql`insert into invoice_series (id, node_id, code) values (${randomUUID()}, ${node}, 'FN') returning node_id`,
    );
    expect(withNode).toEqual([{ node_id: node }]);
    // And a row WITHOUT it is now refused (NOT NULL), the flip Task 4 introduces.
    const error = await captureError(() =>
      db.execute(sql`insert into invoice_series (id, code) values (${randomUUID()}, 'FM')`),
    );
    expect(pgErrorMessage(error)).toMatch(/null value in column "node_id"|not-null/i);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // The (node_id) FK guarantees referential existence too: a node id with
    // no `nodes` row is refused. `id` is supplied for the reason the case above records — without
    // it this insert was refused `NOT NULL constraint failed: invoice_series.id` and never reached
    // the foreign key.
    const error = await captureError(() =>
      db.execute(
        sql`insert into invoice_series (id, node_id, code) values (${randomUUID()}, '99999999-9999-4999-8999-999999999999', 'FX')`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/violates foreign key constraint/);
  });

  it("has no unique constraint on node_id alone", async () => {
    // The subtle coupling: a unique index on node_id would silently reimpose
    // one series per node, which is the thing N-series-from-day-one exists to
    // avoid (node-id rekey, 2026-08-03: the pair moved from till to node). It
    // reads as a harmless index, so only a test catches it.
    // `pg_indexes` does not exist on this engine — run as written this statement died with
    // `no such table: pg_indexes`. The replacement reads the index list and then each index's own
    // column list, rather than pattern-matching a `CREATE INDEX` string: `pragma_index_list` gives
    // the name and a `unique` flag (1 or 0), and `pragma_index_info` gives the columns the index
    // is on. That is what the old regex over `indexdef` was approximating, so the assertion below
    // pins the same property and no longer depends on how the DDL happens to be spelt.
    const indexes = await rows<{ name: string; unique: number }>(
      db,
      sql`select name, "unique" from pragma_index_list('invoice_series')`,
    );
    const nodeIdAlone: string[] = [];
    for (const index of indexes) {
      if (index.unique !== 1) continue;
      const columns = await rows<{ name: string }>(
        db,
        sql`select name from pragma_index_info(${index.name})`,
      );
      if (columns.length === 1 && columns[0]!.name === "node_id") nodeIdAlone.push(index.name);
    }
    expect(nodeIdAlone).toEqual([]);
  });
});
