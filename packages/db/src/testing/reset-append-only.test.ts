import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "./venue-db.js";

/**
 * The per-test reset must hand the NEXT test an append-only table that still refuses a write.
 *
 * To empty `sales` the reset has to get past the very triggers that protect it: SQLite has no
 * `ALTER TABLE … DISABLE TRIGGER`, so `useVenueDb`'s reset drops each trigger, deletes the rows and
 * recreates the trigger from the text `sqlite_master` stored for it. A reset that dropped and did
 * not put them back would leave every later test in its file free to rewrite a filed sale.
 *
 * The cycle is exercised rather than assumed: the first test leaves a row in `sales`, so the
 * reset's `delete` really does run against the protected table; the second test reads what the
 * reset left behind.
 *
 * This file's scope is the RESET. The triggers themselves are
 * `scripts/append-only-triggers.test.ts`'s.
 */

/** Rows in `table`. */
const count = (db: Database, table: string) =>
  db.all<{ n: number }>(sql.raw(`select cast(count(*) as int) as n from "${table}"`))[0].n;

/**
 * What the ENGINE said about `statement`, or `undefined` if it was accepted.
 *
 * `error.cause`, never the message drizzle wraps it in: the wrapper quotes the failing STATEMENT,
 * so it carries the table name whatever the engine thought of it, and a match on the table name
 * alone reads that quotation rather than the refusal.
 */
function refusalFor(db: Database, statement: string): string | undefined {
  try {
    db.run(sql.raw(statement));
    return undefined;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    return cause instanceof Error ? cause.message : String(error);
  }
}

/**
 * One `sales` row, every NOT NULL column stated.
 *
 * Only the foreign keys are switched off — the values satisfy every CHECK the table declares — and
 * they are switched straight back on, so no assertion here rests on what the pragma does or does
 * not do to a trigger.
 */
function seedSale(db: Database, id: string, invoiceNumber: number): void {
  db.run(sql.raw("pragma foreign_keys = off"));
  db.run(
    sql.raw(
      `insert into "sales" (id, till_id, series_id, node_id, invoice_number, issued_at,
        issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend,
        fiscal_state)
       values ('${id}', 'till-1', 'series-1', 'node-1', ${String(invoiceNumber)},
        '2026-09-22T00:00:00.000Z', 0, 0, '[]', 'es-ES', '["es-ES"]', 'none', 'recorded')`,
    ),
  );
  db.run(sql.raw("pragma foreign_keys = on"));
}

describe("the per-test reset and an append-only table from a real migration set", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] }); // reset-ON (the default)

  it("leaves a row the reset has to delete THROUGH the append-only protection", () => {
    seedSale(suite.db, "sale-before-reset", 1);
    expect(count(suite.db, "sales")).toBe(1);
    // The protection is already firing before the reset runs, so the next test is reading a
    // restoration and not an installation.
    expect(refusalFor(suite.db, "delete from sales")).toBe("sales is append-only");
  });

  it("after the reset, the table is empty and still refuses an update and a delete", () => {
    // The reset ran in the previous test's afterEach: it dropped every append-only trigger in the
    // database, `sales`'s pair among them, deleted the row the delete trigger would otherwise have
    // refused, and recreated them all.
    expect(count(suite.db, "sales")).toBe(0);

    // FOR EACH ROW is SQLite's only trigger granularity, so a row trigger on an EMPTY table refuses
    // nothing. The seed is what gives the triggers something to fire on.
    seedSale(suite.db, "sale-after-reset", 2);

    expect(refusalFor(suite.db, "update sales set locale = 'es-ES'")).toBe("sales is append-only");
    expect(refusalFor(suite.db, "delete from sales")).toBe("sales is append-only");
    // Refused, not merely noisy: the row the refusals were tried against is still there.
    expect(count(suite.db, "sales")).toBe(1);
  });
});
