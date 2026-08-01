import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { describeEachTarget } from "../testing/harness.js";

/**
 * Task 1 is the DDL alone: this suite proves migration 0012 APPLIES and leaves
 * the schema in the shape the later tasks build on. It is deliberately a
 * shape/apply smoke test — every runtime behaviour of the new guards (coverage
 * on settlement, the post-settlement tender guard, sale_settlements
 * immutability, the tightened tender checks) is Task 2's behavioural matrix,
 * proved by deletion as design §7 requires.
 *
 * Real Postgres is the load-bearing target here: 0012 replaces the coverage
 * function body through a `SET ROLE sales_coverage_checker` ownership dance, and
 * a migration that fails that dance fails to apply at all. describeEachTarget
 * runs this against both PGlite and, when Docker is present, real PostgreSQL —
 * the run that matters for the role mechanics.
 */

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

describeEachTarget("sale settlements — schema shape after 0012", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("tenders gains tip_amount and its tightened/new check constraints", async () => {
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
            where table_name = 'tenders' and column_name = 'tip_amount'`,
    );
    expect(cols).toHaveLength(1);

    const checks = await rows<{ conname: string }>(
      db,
      sql`select conname from pg_constraint
            where conrelid = 'tenders'::regclass and contype = 'c'
              and conname in ('tenders_amount_ck', 'tenders_tip_amount_ck')
            order by conname`,
    );
    expect(checks.map((c) => c.conname)).toEqual(["tenders_amount_ck", "tenders_tip_amount_ck"]);
  });

  it("sale_settlements exists, is append-only, and sales lost tip_amount/amount_charged", async () => {
    const settlements = await rows<{ one: number }>(
      db,
      sql`select 1 as one from information_schema.tables where table_name = 'sale_settlements'`,
    );
    expect(settlements).toHaveLength(1);

    // Append-only: the immutability + TRUNCATE triggers must both be present.
    const guards = await rows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger
            where tgrelid = 'sale_settlements'::regclass
              and tgname in ('sale_settlements_enforce_immutability',
                             'sale_settlements_block_truncate')
            order by tgname`,
    );
    expect(guards.map((g) => g.tgname)).toEqual([
      "sale_settlements_block_truncate",
      "sale_settlements_enforce_immutability",
    ]);

    const dropped = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
            where table_name = 'sales' and column_name in ('tip_amount', 'amount_charged')`,
    );
    expect(dropped).toEqual([]);
  });

  it("the deferred coverage triggers are gone and the new ones exist", async () => {
    const trigs = await rows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger
            where tgname in ('sales_check_tender_coverage', 'tenders_check_tender_coverage',
                             'sale_settlements_check_coverage', 'tenders_reject_post_settlement')
            order by tgname`,
    );
    expect(trigs.map((r) => r.tgname)).toEqual([
      "sale_settlements_check_coverage",
      "tenders_reject_post_settlement",
    ]);
  });
});
