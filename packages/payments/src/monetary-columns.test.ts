import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { paymentPolicy, paymentRefunds, payments } from "./schema/index.js";

/**
 * Every money column this package owns must be `bigint` — a count of whole cents, the shape
 * `packages/db/src/schema/columns.ts`'s `money` helper emits, eight bytes wide so the whole
 * twelve-integer-digit range fits — and never `real`, `double precision`, or any other float
 * width. `payments.amount`/`payment_refunds.amount` carry currency and feed straight into the
 * captured-vs-refunded balance `payments.state` reflects; a binary float here reintroduces the
 * drift class exact amounts exist to remove.
 *
 * Whole cents rather than an exact decimal because the storage engine this column vocabulary is
 * being moved to has no exact decimal type. The decimal arithmetic itself did not move: it stays
 * above the column in `@waitron/shared`, and `store.ts` converts at the row.
 *
 * Unlike `fiscal-verifactu`'s own `monetary-columns.test.ts` — where `cuota_total`/`importe_total`
 * are deliberately `text`, because the fiscal fingerprint hashes those bytes verbatim — this package's amount
 * columns have no hash-chain constraint, so nothing here depends on the stored bytes.
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

/**
 * The column types the whole migration set leaves behind, read from drizzle's own latest snapshot
 * rather than from the migration TEXT: a column's type can be set by a `create table` in one file
 * and changed by an `alter table` in a later one, so no single statement states the answer.
 */
function latestSnapshotColumnType(table: string, column: string): string | undefined {
  const snapshots = readdirSync(join(drizzleDir, "meta"))
    .filter((f) => f.endsWith("_snapshot.json"))
    .sort();
  const latest = snapshots[snapshots.length - 1];
  const parsed = JSON.parse(readFileSync(join(drizzleDir, "meta", latest), "utf8")) as {
    tables: Record<string, { columns: Record<string, { type: string }> }>;
  };
  return parsed.tables[`public.${table}`]?.columns[column]?.type;
}

describe("payments/payment_refunds monetary columns count whole cents, never float", () => {
  for (const [tableName, table] of Object.entries(OWNED_TABLES)) {
    const columns = getTableColumns(table);
    const amountColumn = Object.values(columns).find((c) => c.name === MONEY_COLUMN);

    it(`${tableName} declares an "amount" column`, () => {
      // Positive control: without it, a rename of the money column would make every assertion
      // below vacuously true (nothing left to check).
      expect(amountColumn).toBeDefined();
    });

    it(`${tableName}.amount is bigint, read back as a number, in the Drizzle schema`, () => {
      expect(amountColumn?.columnType).toBe("PgBigInt53");
      expect(amountColumn?.getSQLType()).toBe("bigint");
    });
  }

  it("the migration set leaves every money column bigint", () => {
    for (const tableName of Object.keys(OWNED_TABLES)) {
      expect(latestSnapshotColumnType(tableName, "amount")).toBe("bigint");
    }
    expect(latestSnapshotColumnType("payment_policy", "offline_amount_cap")).toBe("bigint");
  });

  it("has teeth: the snapshot read finds a column that is there and nothing that is not", () => {
    // The reader resolves real names rather than answering a constant: a column that is there
    // comes back with its own type, and a name that is not there comes back undefined.
    expect(latestSnapshotColumnType("payments", "provider")).toBe("text");
    expect(latestSnapshotColumnType("payments", "no_such_column")).toBeUndefined();
    expect(latestSnapshotColumnType("no_such_table", "amount")).toBeUndefined();
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

  it("payment_policy.offline_amount_cap is bigint in the Drizzle schema", () => {
    const cap = Object.values(getTableColumns(paymentPolicy)).find(
      (c) => c.name === "offline_amount_cap",
    );
    expect(cap).toBeDefined(); // positive control
    expect(cap?.columnType).toBe("PgBigInt53");
    expect(cap?.getSQLType()).toBe("bigint");
  });
});
