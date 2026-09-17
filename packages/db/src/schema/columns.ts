import { getTableColumns, sql, type AnyColumn } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The one place the storage engine's column types are named.
 *
 * Every table definition imports its columns from here so the engine can be changed in one file
 * rather than in every column definition across the schema. The bodies below emit PostgreSQL types;
 * the SQLite switch replaces them and nothing else.
 *
 * Scale is part of the meaning, not decoration: money, quantity and rate are three different
 * scales and a single "numeric" helper would let one silently truncate another.
 */

/** A uuid identifier. */
export const id = (name: string) => uuid(name);

/**
 * A moment on the server clock, read back as a JavaScript `Date`.
 *
 * `ts` and `tsString` emit the SAME SQL type (`timestamp with time zone`), so converting a column
 * to the wrong one is invisible to the SCHEMA PROBE and to any migration diff: the generated SQL is
 * byte-identical either way. It is not invisible to everything else. The two differ in `columnType`
 * (`PgTimestamp` against `PgTimestampString` — the one-line discriminator, asserted in
 * `columns.test.ts`), in what a read returns, and in the WRITE mapper: measured 2026-09-17, a
 * date-mode column's `mapToDriverValue` given a string threw "value.toISOString is not a function",
 * while a string-mode column's given a `Date` returned "2026-09-16T10:00:00.000Z". The typechecker
 * usually gets there first: the swap flips the inferred select type between `Date | null` and
 * `string | null` and the insert type between `Date` and `string`, so a call site using the value as
 * one of those stops compiling. Pick by what the existing column declared, never by which helper is
 * shorter.
 */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A moment on the server clock, read back as the STRING the driver rendered — no `Date` is
 * constructed. See `ts` above for why the generated schema cannot tell the two apart, and what can.
 */
export const tsString = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/**
 * A calendar day: no time, no zone. Read back as the string the driver rendered — a bare
 * `date(name)` is drizzle's STRING mode. `date(name, { mode: "date" })` emits the same SQL type and
 * returns a `Date`, so the schema tells them apart no better than it does `ts` from `tsString`; the
 * read mapping does, and `columns.test.ts` pins it.
 */
export const day = (name: string) => date(name);

/** A time of day: no date, no zone — a venue's opening time rather than a moment. */
export const timeOfDay = (name: string) => time(name);

/** A structured document. */
export const json = <T>(name: string) => jsonb(name).$type<T>();

/** A monetary amount: two decimal places. */
export const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** A quantity: three decimal places, so 0.005 kg is representable. */
export const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/** A percentage rate: two decimal places, e.g. a 21.00 VAT rate. */
export const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * A closed vocabulary: a text column whose permitted values are listed in a `check()` constraint.
 *
 * The values array is written ONCE, at the call site. This helper derives the column's TypeScript
 * type from it and hands the same array to drizzle as the column's `enumValues`; `enumCheck` below
 * builds the constraint's SQL from those, so the type and the constraint cannot state different
 * sets.
 *
 * There is no house rule choosing between this shape and a `pgEnum`, and no two-family split to
 * apply: the repository carries both, declares more `pgEnum` types than checked text columns (a
 * `pgEnum` declaration looks like `packages/db/src/schema/tenants.ts:52`), and the checked text
 * columns it does carry were each taken for their own stated reason. Two of those reasons, and they
 * are different reasons: `packages/db/src/schema/series.ts:58-61`, because the permitted set depends
 * on an unverified question to the accountant, so widening must cost one line of migration rather
 * than an `ALTER TYPE`; `packages/payments/src/schema/payments.ts:72-74`, because adding a value
 * later must not hit the one-transaction `ALTER TYPE` trap (its check is at `payments.ts:132-133`).
 * So: read the sibling column's own comment before copying either shape, rather than looking for a
 * rule here.
 */
export const enumText = <T extends string>(name: string, values: readonly T[]) =>
  text(name, { enum: values as readonly [T, ...T[]] });

/**
 * The `in (...)` constraint body for an `enumText` column, read off that column's own values, so
 * the constraint and the column's TypeScript type cannot list different sets.
 *
 * Two measurements from 2026-09-17 shape the body:
 *
 * - `.inlineParams()` is what writes the values into the DDL as literals. Without it drizzle
 *   renders them as bind placeholders — `in ($1, $2)` — which lands in the generated migration and
 *   changes the schema.
 * - A table's extra-config callback is handed an `ExtraConfigColumn`, a different object from the
 *   table's own column. It renders as the right column reference, but its `enumValues` is
 *   undefined at runtime, so reading it directly threw "Cannot read properties of undefined
 *   (reading 'map')" — both inside `drizzle-kit generate` and when the node-postgres client builds
 *   its relational config. Every column knows its table, and the table's own column does carry the
 *   values, which is what the fallback reads.
 *
 * That second measurement is also why the parameter is any column rather than a type that demands
 * a vocabulary: TypeScript types the extra-config column's `enumValues` as `string[] | undefined` —
 * not the vocabulary union — so no call from the only place a check can be declared would compile.
 * A column `enumText` did not declare is refused at runtime instead.
 */
export const enumCheck = (column: AnyColumn) => {
  const onTable: readonly AnyColumn[] = Object.values(getTableColumns(column.table));
  const values: readonly string[] | undefined =
    column.enumValues ?? onTable.find((c) => c.name === column.name)?.enumValues;
  if (values === undefined) {
    throw new Error(`enumCheck: column "${column.name}" was not declared with enumText`);
  }
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`.inlineParams();
};

/** A true/false flag. */
export const flag = (name: string) => boolean(name);

/** A whole number. */
export const count = (name: string) => integer(name);

/** A whole number with a small fixed range — a weekday, a position on a floor plan. */
export const smallCount = (name: string) => smallint(name);

/**
 * A whole number wider than `count`, read back as a JavaScript number.
 * `bigint(name, { mode: "bigint" })` emits the same SQL type and reads back a `bigint` instead, so
 * only the read mapping separates the two; `columns.test.ts` pins which one this is.
 */
export const bigCount = (name: string) => bigint(name, { mode: "number" });

/**
 * Free text.
 *
 * A fiscal amount held as `text` is NOT free text and must not become `label()`:
 * `packages/fiscal-verifactu/src/schema/registros.ts:86-96` keeps `cuota_total`/`importe_total` as
 * `text` because the fiscal fingerprint hashes the stored bytes verbatim, so the stored bytes must
 * equal the hashed bytes.
 *
 * Nothing catches that substitution, so do not expect a test to stop you.
 * `packages/fiscal-verifactu/src/monetary-columns.test.ts` builds its database from the migration
 * SQL and reads no schema source: measured 2026-09-17, with both columns redeclared through a
 * locally defined helper whose body is `label()`'s, `vitest run src/monetary-columns.test.ts`
 * exited 0 with one test passing. What that test does catch is a stored type that has become lossy
 * — the amount it round-trips is rejected by `numeric(12, 2)` with SQLSTATE 22003.
 */
export const label = (name: string) => text(name);

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/**
 * Opaque bytes (`bytea`), handed to callers as a `Uint8Array` and bound as a node `Buffer`.
 *
 * `Uint8Array` is the caller-facing type because the callers already hold one and convert only
 * because the column demands a `Buffer`: `packages/printing/src/outbox.ts:26` takes a `Uint8Array`
 * and calls `Buffer.from` at line 55, and `packages/printing/src/runtime.ts:288-291` copies a
 * read-back payload back into a `Uint8Array`. No table uses this helper yet, so those two hand
 * conversions are still the live ones; converting their columns to it will DELETE them rather than
 * add a third.
 *
 * `packages/db/src/schema/print-jobs.ts` and `packages/credentials/src/schema/tenant-credentials.ts`
 * declare their own `bytea` typed as `Buffer` in both directions, so converting those two columns
 * changes what their call sites receive — the SQL type is the same either way, so nothing in the
 * schema will report it.
 *
 * The custom type itself stays private: drizzle's overloads on it also accept no name at all and a
 * config object, so exporting it directly would make `binary()` compile where every sibling helper
 * here demands a column name.
 */
export const binary = (name: string) => bytea(name);

export const table = pgTable;
