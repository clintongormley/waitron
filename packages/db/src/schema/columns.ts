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
 * `pgEnum` declaration looks like `receiptPrintMode` in `packages/db/src/schema/tenants.ts`), and
 * the checked text columns it does carry were each taken for their own stated reason. Two of those
 * reasons, and they are different reasons: `invoiceSeries.purpose` in
 * `packages/db/src/schema/series.ts`, because the permitted set depends on an unverified question
 * to the accountant, so widening must cost one line of migration rather than an `ALTER TYPE`;
 * `payments.cardEntryMode` in `packages/payments/src/schema/payments.ts`, because adding a value
 * later must not hit the one-transaction `ALTER TYPE` trap (its constraint is
 * `payments_card_entry_mode_ck` in the same file). So: read the sibling column's own comment before
 * copying either shape, rather than looking for a rule here.
 *
 * This pair is for a NEW column. Every existing text column that already carried a hand-written
 * `check()` stays as `label()` beside its untouched constraint as the rollout reaches its package,
 * and the reason is NOT one reason for all of them. The two reasons below are the ones met so far;
 * the list of columns each covers grows with the rollout, so read it as a property and not as a
 * roll-call.
 *
 * For three columns in THIS package it is measured. `enumCheck` joins its values with `", "`, so on
 * a constraint written without those spaces the substitution changes the DDL: made on
 * `option_groups.type` on
 * 2026-09-17, the schema probe produced a migration dropping and re-adding `option_groups_type_ck`
 * with `in ('text', 'extras', 'options')` for `in ('text','extras','options')`, and nothing else.
 * `products.pricing_unit` and `products.vat_class` are written the same way.
 *
 * For five others here — `deployment.mode`, `deployment.singleton_role`, `incidents.severity`,
 * `print_jobs.kind` and `invoice_series.purpose` — that reason does not apply at all: their
 * constraints already carry the spacing `enumCheck` emits, which `columns.test.ts` renders
 * byte-for-byte for `invoice_series_purpose_ck`'s body. Substituting there would be schema-silent.
 * They were left alone because rewriting a constraint was out of that conversion's scope — a
 * scope decision, not a measurement. `incidents.severity` has a reason of its own on top: it
 * brands its type as the exported `IncidentSeverity`, and `enumText` would replace that with a
 * union derived from the values array.
 *
 * The second group is open, and it keeps growing as the rollout reaches new packages: checked text
 * columns written with `enumCheck`'s spacing exist outside this package too, among them
 * `units.hardware_unit` in `packages/catalogue` (converted 2026-09-17),
 * `payment_policy.offline_mode` in `packages/payments` (converted 2026-09-18) and, still
 * unconverted on that date, `packages/fiscal-verifactu/src/schema/registros.ts` and
 * `packages/identity/src/schema/google-oidc-states.ts`. So take the two reasons as the property and
 * the names as a dated reading.
 *
 * One mechanical note, because a converter meeting a NULLABLE checked column will ask: `enumCheck`
 * returns only the `in (…)` fragment, so a null arm is composed AROUND it rather than emitted by
 * it, and the values stay inline through that nesting. A nullable column is therefore NOT a reason
 * the pair cannot be used — `payments.card_entry_mode` stays `label()` for the spacing reason
 * above, like the other three. Guard: `columns.test.ts`, "keeps its values inline when a caller
 * composes a null arm around it".
 *
 * `units.hardware_unit` carries a reason worth stating in general: substituting there is schema-silent, but `enumText` NARROWS what a
 * caller may write. Measured 2026-09-17 with `tsc --noEmit` over two probe tables in the catalogue
 * package, one column declared each way — the `enumText` one refused a `string | null | undefined`
 * with `Type 'string' is not assignable to type '"g" | "kg" | "mg" | null | undefined'`, while the
 * `label()` control on the line above it compiled. So this pair is not a free substitution on an
 * existing column even when the DDL is identical: it is a caller-facing change the schema probe
 * cannot see.
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
 * A custom type because drizzle-orm 0.45 ships no first-class `bytea`.
 *
 * `Uint8Array` is the caller-facing type because that is what the callers hold: `enqueuePrintJob`
 * in `packages/printing/src/outbox.ts` takes a `Uint8Array` and passes it straight to the insert.
 *
 * `runAgentOnce` in `packages/printing/src/runtime.ts` also copies a read-back payload into a
 * `Uint8Array`, and that copy STAYS, because the row it copies was never read through a column:
 * `claimPrintJobs` in the same file reads it with raw SQL through `tx.execute`, and its
 * `ClaimedJob.payload` is hand-declared `Buffer`. Drizzle's `execute` hands back the driver's own
 * row values — no column's `fromDriver` runs over them. Measured 2026-09-17 against real
 * PostgreSQL, one physical row read twice — through
 * `.select({ payload: <a binary column> })` and through `tx.execute` — printed
 * `BUILDER: Uint8Array isBuffer=false | RAW: Buffer isBuffer=true`, with both reads carrying the
 * same bytes, so the difference is the mapping and not the data.
 *
 * The hand-rolled `bytea` blocks still in the tree are not the same block.
 * `packages/media/src/schema/images.ts` declares this same `Uint8Array`-facing shape, body for
 * body, so converting it changes nothing a caller sees.
 * `packages/credentials/src/schema/tenant-credentials.ts` declares `Buffer` in both directions, so
 * converting that one changes what its call sites receive — the SQL type is the same either way,
 * so nothing in the schema will report it.
 *
 * The custom type itself stays private: drizzle's overloads on it also accept no name at all and a
 * config object, so exporting it directly would make `binary()` compile where every sibling helper
 * here demands a column name.
 */
export const binary = (name: string) => bytea(name);

export const table = pgTable;
