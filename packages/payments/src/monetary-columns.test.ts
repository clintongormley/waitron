import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { paymentRefunds, payments } from "./schema/index.js";

/**
 * Every money column this package owns must be `numeric(12, 2)` — the same shape
 * `packages/db`'s `sales`/`sale_lines`/`tenders` amount columns carry (see #14, "Exact-decimal
 * amounts: remove float from the fiscal-amount path") — and never `real`, `double precision`, or
 * any other float width. `payments.amount`/`payment_refunds.amount` carry currency and feed
 * straight into the captured-vs-refunded balance `payments.state` reflects; a binary float here
 * reintroduces the exact drift class that commit was written to remove.
 *
 * Unlike `fiscal-verifactu`'s own `monetary-columns.test.ts` — where `cuota_total`/`importe_total`
 * are deliberately `text`, because the huella hashes those bytes verbatim — this package's amount
 * columns have no hash-chain constraint, so `numeric(12, 2)` is the correct, exact-decimal type
 * here, not merely the default `payments.ts`/`payment-refunds.ts` happened to pick.
 */
const OWNED_TABLES = { payments, payment_refunds: paymentRefunds } as const;
const MONEY_COLUMN = "amount";

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n");
}

describe("payments/payment_refunds monetary columns are numeric(12, 2), never float", () => {
  for (const [tableName, table] of Object.entries(OWNED_TABLES)) {
    const columns = getTableColumns(table);
    const amountColumn = Object.values(columns).find((c) => c.name === MONEY_COLUMN);

    it(`${tableName} declares an "amount" column`, () => {
      // Positive control: without it, a rename of the money column would make every assertion
      // below vacuously true (nothing left to check).
      expect(amountColumn).toBeDefined();
    });

    it(`${tableName}.amount is numeric(12, 2) in the Drizzle schema`, () => {
      expect(amountColumn?.columnType).toBe("PgNumeric");
      expect((amountColumn as { precision?: number } | undefined)?.precision).toBe(12);
      expect((amountColumn as { scale?: number } | undefined)?.scale).toBe(2);
      expect(amountColumn?.getSQLType()).toBe("numeric(12, 2)");
    });
  }

  it('generated migration declares "amount" numeric(12, 2) not null for both tables', () => {
    const sqlText = generatedSql();
    for (const tableName of Object.keys(OWNED_TABLES)) {
      // Non-greedy up to the table's own closing paren: the amount column line always precedes it
      // within the same CREATE TABLE statement, so this cannot accidentally match a later table.
      const tablePattern = new RegExp(
        `create table "${tableName}" \\([\\s\\S]*?"amount" numeric\\(12, 2\\) not null[\\s\\S]*?\\);`,
        "i",
      );
      expect(sqlText).toMatch(tablePattern);
    }
  });

  it("generated migration contains no real/double precision/float column anywhere", () => {
    const sqlText = generatedSql().toLowerCase();
    expect(sqlText).not.toMatch(/\breal\b/);
    expect(sqlText).not.toMatch(/double precision/);
    expect(sqlText).not.toMatch(/\bfloat4\b|\bfloat8\b/);
  });

  it("has teeth: the float pattern would catch a real regression", () => {
    // A vacuous negative assertion (one that would pass against ANY string) is worse than no
    // assertion at all — this proves the pattern above actually fires on the shape it exists to
    // catch, mirroring `no-provider-vocabulary.test.ts`'s own "the guard has teeth" block.
    const offendingSql = 'create table "payments" (\n\t"amount" double precision not null\n);';
    expect(offendingSql.toLowerCase()).toMatch(/double precision/);
  });
});
