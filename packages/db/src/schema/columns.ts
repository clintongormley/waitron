import { randomUUID } from "node:crypto";
import { sql, type AnyColumn } from "drizzle-orm";
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The one place the storage engine's column and table types are named; every table imports its
 * columns from here.
 *
 * Every helper below emits `text`, `integer` or `blob`, so picking the wrong helper of a group
 * leaves the generated schema byte-identical, and what separates them is the helper's NAME, its
 * read mapping and the typechecker. No column type here refuses a wrong value; the one refusal this
 * file builds is an `enumText` column's `check()` constraint. Measured 2026-09-21, the same seven
 * inserts against PGlite and a real `node:sqlite` file: `'not-a-uuid'`, `'not-a-day'`,
 * `'not-a-time'`, `'{not json'`, 1000.00 into `numeric(5, 2)`, 2147483648 into `integer` and 32768
 * into `smallint` were each refused by PostgreSQL and each ACCEPTED and stored by the SQLite column
 * that replaces it. `smallCount` and `bigCount` bound nothing, because SQLite's INTEGER is 64-bit
 * whatever the name says, and the integer-digit bounds of money, quantity and rate live only in
 * `@waitron/shared`'s converters.
 */

export const id = (name: string) => text(name);

const isoTimestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});

/**
 * A moment on the server clock, stored as an ISO-8601 string and read back as a JavaScript `Date`.
 *
 * `ts` and `tsString` store the same bytes and emit the same SQL type; the read mapping is the
 * whole difference. Pick by what the existing column declared, never by which helper is shorter.
 */
export const ts = (name: string) => isoTimestamp(name);

/** A moment on the server clock, read back as the STRING the driver returned. See `ts`. */
export const tsString = (name: string) => text(name);

/** A calendar day: no time, no zone, handed to a caller as the string the driver returned. */
export const day = (name: string) => text(name);

/** A time of day: no date, no zone — a venue's opening time rather than a moment. */
export const timeOfDay = (name: string) => text(name);

/** A structured document, stored as JSON text. The read mapping parses it; `label`'s does not. */
export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

/**
 * A monetary amount, counted in whole cents: 12.34 euros is the number 1234.
 *
 * An integer because SQLite has no exact decimal type. Decimal arithmetic lives at the edges, in
 * `@waitron/shared`'s money module.
 */
export const money = (name: string) => integer(name);

/**
 * A quantity, counted in whole thousandths: 1.5 kg is the number 1500, and 5 grams is 5.
 *
 * A SEPARATE scale from money: reading one at the money scale gives a different number rather than
 * an obviously wrong one, because the money conversion ROUNDS the third place (0.005 kg is 5
 * thousandths and 1 cent). Convert with `decimalToThousandths` and `thousandthsToDecimal`.
 */
export const quantity = (name: string) => integer(name);

/**
 * A percentage rate, counted in whole basis points: a 21.00% VAT rate is the number 2100.
 *
 * A check constraint on one is written against 10000: `rate <= 100` refuses every rate above one
 * percent.
 */
export const rate = (name: string) => integer(name);

/**
 * A closed vocabulary: a text column whose permitted values are listed in a `check()` constraint.
 *
 * The values array is written ONCE, at the call site. This helper derives the column's TypeScript
 * type from it and hands the same array to drizzle as the column's `enumValues`; `enumCheck` below
 * builds the constraint's SQL from those, so the type and the constraint cannot state different
 * sets. The constraint is the only thing standing between the column and any string at all.
 *
 * The column type each spelling of the values gives, each cell a compile-time case in
 * `columns.test.ts`:
 *
 *                                        nullable column              .notNull() column
 *   enumText(n, ["a", "b"])              "a" | "b" | null | undefined "a" | "b"
 *   enumText(n, ["a", "b"] as const)     "a" | "b" | null | undefined "a" | "b"
 *   enumText(n, VALUES)                  string | null | undefined    string
 *   enumText(n, VALUES_AS_CONST)         "a" | "b" | null | undefined "a" | "b"
 *   enumText(n, VALUES_ANNOTATED)        "a" | "b" | null | undefined "a" | "b"
 *
 * (`VALUES` being a `const VALUES = ["a", "b"]` declared elsewhere, `VALUES_AS_CONST` the same
 * declaration written `as const`, `VALUES_ANNOTATED` the same declaration typed `("a" | "b")[]`.)
 * An UNANNOTATED variable is widened to `string[]` at its own declaration, before `enumText` sees
 * it, so it is that declaration that loses the values, not the call.
 *
 * Never conclude from the spelling that a substitution is caller-safe. Take a control that reaches
 * the column — narrow it to a set the code does not write and watch the typechecker fail — and if
 * that control passes, the typechecker cannot see that column and you have measured nothing.
 */
export const enumText = <const T extends string>(name: string, values: readonly T[]) =>
  text(name, { enum: values as readonly [T, ...T[]] });

/**
 * A closed vocabulary declared ONCE at the top of a schema file and used to build columns. The
 * result is a column builder (`ticketState("state")`) carrying `enumValues`, for a request
 * validator at runtime and for `(typeof ticketState.enumValues)[number]` at type level. The
 * narrowing is `enumText`'s, so the table in that helper's note applies unchanged. The `const`
 * modifier mirrors `enumText`'s but is NOT what makes the narrowing work here: removing it from
 * `enumType` moves no pin in `columns.test.ts`, where removing `enumText`'s fails its typecheck
 * (measured 2026-09-24).
 */
export const enumType = <const T extends string>(values: readonly T[]) =>
  Object.assign((name: string) => enumText(name, values), {
    enumValues: values as readonly [T, ...T[]],
  });

/**
 * The `in (...)` constraint body for an `enumText` column, read off that column's own values, so
 * the constraint and the column's TypeScript type cannot list different sets.
 *
 * `.inlineParams()` is what writes the values into the DDL as literals. Without it drizzle renders
 * them as bind placeholders, which lands in the generated migration and changes the schema.
 *
 * The parameter is any column because the extra-config argument is typed too loosely for a
 * narrower parameter to accept it; a column `enumText` did not declare is refused at runtime.
 */
export const enumCheck = (column: AnyColumn) => {
  const values: readonly string[] | undefined = column.enumValues;
  if (values === undefined) {
    throw new Error(`enumCheck: column "${column.name}" was not declared with enumText`);
  }
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`.inlineParams();
};

/**
 * A true/false flag, stored as 0 or 1 and read back as a boolean.
 *
 * Measured on Node v26.7.0, `node:sqlite` refuses to bind a JavaScript boolean; drizzle's boolean
 * mode converts before the bind, so a column declared here is safe where a hand-written `sql`
 * fragment passing one is not.
 */
export const flag = (name: string) => integer(name, { mode: "boolean" });

export const count = (name: string) => integer(name);

export const smallCount = (name: string) => integer(name);

export const bigCount = (name: string) => integer(name);

/**
 * Free text.
 *
 * A fiscal amount held as text is NOT free text and must not become `label()`:
 * `packages/fiscal-verifactu/src/schema/registros.ts` keeps `cuota_total`/`importe_total` as their
 * own text column because the fiscal fingerprint hashes the stored bytes verbatim. Nothing catches
 * that substitution.
 */
export const label = (name: string) => text(name);

/**
 * A list of free-text values, stored as a JSON array in one text column and read back as a
 * `string[]`. Nothing below this layer understands the list: a query matching one entry matches
 * inside a JSON string, or filters in JavaScript after the read.
 */
export const labelList = (name: string) => text(name, { mode: "json" }).$type<string[]>();

/**
 * Default generators for `$defaultFn`, which drizzle calls per insert and binds like any other
 * parameter. It is NOT a SQL DEFAULT, so a row written by anything other than drizzle gets nothing.
 *
 * `now` and `nowIso` are two functions so the typechecker refuses a `ts` column paired with
 * `nowIso` and a `tsString` column paired with `now`.
 */
export const newId = () => randomUUID();
export const now = () => new Date();
export const nowIso = () => new Date().toISOString();

const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "blob",
  toDriver: (value) => value,
  fromDriver: (value) => new Uint8Array(value),
});

/**
 * Opaque bytes, handed to callers as a `Uint8Array`.
 *
 * A custom type rather than drizzle's `blob(name, { mode: "buffer" })`, which hands a caller a node
 * `Buffer`. Measured on a real `node:sqlite` file, 2026-09-21: the driver binds a `Uint8Array` or a
 * `Buffer`, refuses a bare `ArrayBuffer`, and hands a BLOB back as a plain `Uint8Array` already.
 * The custom type itself stays private: its overloads also accept no name at all, so exporting it
 * directly would make `binary()` compile where every sibling helper demands a name.
 */
export const binary = (name: string) => bytes(name);

export const table = sqliteTable;
