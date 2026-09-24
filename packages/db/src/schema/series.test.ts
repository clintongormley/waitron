import { randomUUID } from "node:crypto";
import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, NOT_NULL_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedNode } from "../testing/seed.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

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

// seed() creates two nodes so the per-node uniqueness tests have a second node to collide
// against.
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
    // A unique refusal names columns, not the constraint, so this names the key. Column ORDER is
    // part of the identity `refusalOn` checks. The control in the other direction is the case
    // below: the same code on a different node is accepted, so the index keys on the pair.
    await db.insert(invoiceSeries).values({ nodeId: nodeA1, code: "FA", purpose: "standard" });
    const error = await captureError(() =>
      db.insert(invoiceSeries).values({ nodeId: nodeA1, code: "FA", purpose: "standard" }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "invoice_series",
        columns: ["node_id", "code"],
      }),
    ).toBe(true);
  });

  it("permits the same code on two different nodes", async () => {
    // Series codes are a per-node numbering concern. Two nodes in one venue both running series
    // "FA" is normal, and their numbers are independent.
    await db.insert(invoiceSeries).values([
      { nodeId: nodeA1, code: "FA", purpose: "standard" },
      { nodeId: nodeA2, code: "FA", purpose: "standard" },
    ]);
    const found = await db.select({ id: invoiceSeries.id }).from(invoiceSeries);
    expect(found).toHaveLength(2);
  });

  it("rejects a purpose outside the permitted set", async () => {
    // A CHECK refusal names the constraint and nothing else — no table, no column
    // (`../constraint-target.ts`) — so the name IS the assertion here.
    const error = await captureError(() =>
      db.insert(invoiceSeries).values({ nodeId: nodeA1, code: "XX", purpose: "invented" }),
    );
    expect(engineErrorMessage(error)).toMatch(/invoice_series_purpose_ck/);
  });

  it("has exactly the columns it has today — none relating a series to a chain", async () => {
    // A column named for chain position here would be the first step towards per-series chaining,
    // which AEAT art. 7.c) forbids outright. An exact pin is the whole check: any new column —
    // including one added by hand-written SQL in drizzle/ that no source scan sees — is a
    // deliberate edit here.
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
    // Raw SQL for the inserts so a mis-migrated run fails on the real cause rather than a drizzle
    // column-object error. `id` is named explicitly because `invoice_series.id` is
    // `$defaultFn(newId)` — a JavaScript generator rather than a SQL DEFAULT, which a raw insert
    // never reaches.
    const node = await seedNode(db, brandLocationId(LOCATION_A));
    const meta = await rows<{ notnull: number }>(
      db,
      sql`select "notnull" from pragma_table_info('invoice_series') where name = 'node_id'`,
    );
    expect(meta).toEqual([{ notnull: 1 }]);
    const withNode = await rows<{ node_id: string | null }>(
      db,
      sql`insert into invoice_series (id, node_id, code) values (${randomUUID()}, ${node}, 'FN') returning node_id`,
    );
    expect(withNode).toEqual([{ node_id: node }]);
    // The class is what separates this refusal from a unique index on the same column, which
    // would name exactly the same table and column.
    const error = await captureError(() =>
      db.execute(sql`insert into invoice_series (id, code) values (${randomUUID()}, 'FM')`),
    );
    expect(
      refusalOn(error, NOT_NULL_VIOLATION, { table: "invoice_series", columns: ["node_id"] }),
    ).toBe(true);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // `id` is supplied for the reason the case above records. Class only, and nothing narrower
    // exists to assert: this engine's foreign-key refusal names neither table nor column. The
    // control in the other direction is the case above, which inserts a series with a real node id.
    const error = await captureError(() =>
      db.execute(
        sql`insert into invoice_series (id, node_id, code) values (${randomUUID()}, '99999999-9999-4999-8999-999999999999', 'FX')`,
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("has no unique constraint on node_id alone", async () => {
    // A unique index on node_id would silently reimpose one series per node. It reads as a
    // harmless index, so only a test catches it.
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
