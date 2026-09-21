import { randomUUID } from "node:crypto";
import { sql, type AnyColumn } from "drizzle-orm";
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The one place the storage engine's column and table types are named.
 *
 * Every table definition imports its columns from here so the engine can be changed in one file
 * rather than in every column definition across the schema. The bodies below emit SQLite types.
 *
 * ## What the engine no longer refuses
 *
 * SQLite gives these helpers three storage classes, and most of the vocabulary lands on two of
 * them. `id`, `ts`, `tsString`, `day`, `timeOfDay`, `enumText`, `enumType`, `label`, `labelList`
 * and `json` all emit `text`;
 * `money`, `quantity`, `rate`, `count`, `smallCount`, `bigCount` and `flag` all emit `integer`;
 * `binary` alone emits `blob`. So a column's SQL type no longer separates a count of cents from a
 * count of thousandths, a calendar day from a time of day, or either from free text, and picking
 * the wrong helper of a group leaves the generated schema and any migration diff byte-identical.
 * What still separates them is the helper's NAME, the read mapping (below), and the typechecker.
 *
 * The PostgreSQL types these replaced refused a wrong value on their own, and that refusal is gone.
 * Measured 2026-09-21, the same seven inserts against PGlite and against a real `node:sqlite` file:
 * `uuid` refused `'not-a-uuid'` (22P02), `date` refused `'not-a-day'` (22007), `time` refused
 * `'not-a-time'` (22023), `jsonb` refused `'{not json'` (22P02), `numeric(5, 2)` refused 1000.00,
 * `integer` refused 2147483648 and `smallint` refused 32768 (22003 each). Every one of the seven is
 * ACCEPTED and stored by the SQLite column that replaces it. The only refusal left in this module is
 * an `enumText` column's own `check()` constraint, which `columns.test.ts` asks a real engine to
 * perform.
 *
 * Two consequences worth stating rather than discovering. `smallCount` and `bigCount` no longer
 * bound anything — SQLite's INTEGER is 64-bit whatever the declared type says — so those names now
 * carry the caller's meaning and the record of the width the column held when the engine had
 * widths. And the integer-digit bounds the old `numeric` columns enforced live only in the
 * converters in `@waitron/shared` (`MAX_MONEY_INTEGER_DIGITS`, `MAX_QUANTITY_INTEGER_DIGITS`,
 * `MAX_RATE_INTEGER_DIGITS`); nothing below them checks.
 *
 * Scale is still part of the meaning: money, quantity and rate are three different scales and a
 * single "integer" helper would let one silently truncate another.
 */

/** An identifier. `newId` below supplies the value a PostgreSQL `defaultRandom()` used to. */
export const id = (name: string) => text(name);

const isoTimestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});

/**
 * A moment on the server clock, stored as an ISO-8601 string and read back as a JavaScript `Date`.
 *
 * `ts` and `tsString` do NOT collapse into one helper on SQLite, which is the question the storage
 * swap's plan left open. They store the same bytes and emit the same SQL type (`text`), and the
 * read mapping is the entire difference — the same split they had on PostgreSQL. Measured through a
 * real `node:sqlite` file on 2026-09-21 (`columns.test.ts`, "round-trips one row of every helper's
 * value through the engine"): the stored string `2026-09-16T10:00:00.000Z` comes back from this
 * helper as a `Date` and from `tsString` as that string.
 *
 * The typechecker is what usually catches a column converted to the wrong one: the swap flips the
 * inferred select type between `Date | null` and `string | null` and the insert type between `Date`
 * and `string`, so a call site using the value as one of those stops compiling. Pick by what the
 * existing column declared, never by which helper is shorter.
 */
export const ts = (name: string) => isoTimestamp(name);

/**
 * A moment on the server clock, read back as the STRING the driver returned — no `Date` is
 * constructed. See `ts` above for why the generated schema cannot tell the two apart, and what can.
 */
export const tsString = (name: string) => text(name);

/** A calendar day: no time, no zone, handed to a caller as the string the driver returned. */
export const day = (name: string) => text(name);

/** A time of day: no date, no zone — a venue's opening time rather than a moment. */
export const timeOfDay = (name: string) => text(name);

/**
 * A structured document, stored as JSON text. The read mapping parses it, which is the only thing
 * separating this column from `label`; `columns.test.ts` pins both directions.
 */
export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

/**
 * A monetary amount, counted in whole cents: 12.34 euros is the number 1234.
 *
 * An integer rather than a decimal because SQLite has no exact decimal type and a float cannot hold
 * a cent exactly. The name says cents so a caller cannot read the number as units. Decimal
 * arithmetic and the decimal literals a receipt or a fiscal record carries live at the edges, in
 * `@waitron/shared`'s money module. SQLite's INTEGER is 64-bit, so the twelve-integer-digit money
 * bound the rest of the system states fits with room to spare — but see the header: the column no
 * longer refuses anything outside it.
 */
export const money = (name: string) => integer(name);

/**
 * A quantity, counted in whole thousandths: 1.5 kg is the number 1500, and 5 grams is 5.
 *
 * A SEPARATE scale from money, for a reason of its own: a quantity carries three decimal places, so
 * reading one at the money scale gives a different number rather than an obviously wrong one —
 * 0.005 kg is 5 thousandths and 1 cent, because the money conversion ROUNDS that third place rather
 * than dropping it (pinned by the 0.005 cases in `packages/shared/src/scales.test.ts`). The
 * conversions are named after the scale — `decimalToThousandths` and `thousandthsToDecimal` in
 * `@waitron/shared`'s scales module — so a call site cannot reach for the money pair by
 * autocomplete.
 */
export const quantity = (name: string) => integer(name);

/**
 * A percentage rate, counted in whole basis points: a 21.00% VAT rate is the number 2100.
 *
 * A check constraint written against the decimal form does NOT follow the column across.
 * `ALTER COLUMN ... SET DATA TYPE` keeps the constraint and casts it, so a `rate <= 100` left alone
 * would refuse every rate above one percent; the four such constraints in the tree are re-derived
 * against 10000.
 */
export const rate = (name: string) => integer(name);

/**
 * A closed vocabulary: a text column whose permitted values are listed in a `check()` constraint.
 *
 * The values array is written ONCE, at the call site. This helper derives the column's TypeScript
 * type from it and hands the same array to drizzle as the column's `enumValues`; `enumCheck` below
 * builds the constraint's SQL from those, so the type and the constraint cannot state different
 * sets. On SQLite the constraint is the only thing standing between the column and any string at
 * all, since the stored type is plain `text` (see the header) — so a checked text column is not a
 * weaker shape than the PostgreSQL enum type it replaces, it is the same shape.
 *
 * Every cell of the table below is a compile-time case in `columns.test.ts`. Reading it: values
 * written INLINE narrow whatever the column's nullability, and `as const` on top of an inline list
 * changes nothing. An UNANNOTATED variable holding them never narrows — it is widened to `string[]`
 * at its own declaration, before `enumText` sees it — so what loses the values is that declaration
 * rather than the call. Either `as const` or an annotation on it is the way out; "a variable" is not
 * the condition, unannotated is.
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
 * The top-left cell read `string | null | undefined` until this helper took a `const` type
 * parameter; reverting that one word fails the pin on that cell and no other, which is what says
 * the rest of the table is unchanged by it.
 *
 * The practical rule, because two earlier attempts at this sentence were both wrong in the unsafe
 * direction: **never conclude from the spelling that a substitution is caller-safe.** Take a control
 * that reaches the column — narrow it to a set the code does not write and watch the typechecker
 * fail — and if that control passes, the typechecker cannot see that column and you have measured
 * nothing.
 */
export const enumText = <const T extends string>(name: string, values: readonly T[]) =>
  text(name, { enum: values as readonly [T, ...T[]] });

/**
 * A closed vocabulary declared ONCE at the top of a schema file and used to build columns, which is
 * what `pgEnum` did. It takes no type name, because `pgEnum`'s first argument created a SQL type
 * and SQLite has none: the values reach the database as the `check()` constraint `enumCheck` builds
 * at each table.
 *
 * A `pgEnum` declaration was used three ways, and all three still work — `columns.test.ts` has a
 * case for each. As a column builder (`ticketState("state")`); for its values at runtime, where a
 * request validator reads `ticketState.enumValues` rather than repeating the list; and for its
 * values at type level, as `(typeof ticketState.enumValues)[number]`. The narrowing is `enumText`'s,
 * so the table in that helper's note applies here unchanged — including its one wide row, which is
 * pinned: values handed in through an unannotated variable widen to `string` here too.
 *
 * The `const` modifier mirrors `enumText`'s and is NOT what makes the narrowing work: removing it
 * moves no pin in `columns.test.ts`, measured 2026-09-21, where removing `enumText`'s fails the
 * inline-literal nullable cell. It is kept for symmetry, not for an effect anybody has shown.
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
 * This used to carry a fallback that re-found the column on its table, because on PostgreSQL a
 * table's extra-config callback — the only place a check can be declared — was handed an
 * `ExtraConfigColumn` whose `enumValues` was undefined at runtime. **That is a PostgreSQL fact, not
 * a drizzle one.** Measured 2026-09-21 on drizzle-orm 0.45.2, one table per dialect declaring the
 * same checked text column and reading the callback's argument after `getTableConfig`: PostgreSQL
 * gave an `ExtraConfigColumn` with `enumValues: undefined`, SQLite gave the table's own
 * `SQLiteText` with `enumValues: ["a", "b"]`. The fallback is therefore dead code here and has
 * gone; the control that says so is deleting it and finding nothing red, which is how it was found.
 *
 * The parameter stays any column rather than a type demanding a vocabulary, because the extra-config
 * argument is still typed loosely enough that a narrower parameter would refuse the only call a
 * caller can make. A column `enumText` did not declare is refused at runtime instead.
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
 * The read mapping is the only thing separating this from `count`. It also does the conversion the
 * driver will not: measured on Node v26.7.0, `node:sqlite` refuses to bind a JavaScript boolean
 * ("cannot be bound to SQLite parameter"), and drizzle's boolean mode converts before the bind, so
 * a column declared here is safe where a hand-written `sql` fragment passing a boolean is not
 * (receipt: `docs/handoffs/2026-09-21-f1-the-flip.md`).
 */
export const flag = (name: string) => integer(name, { mode: "boolean" });

/** A whole number. */
export const count = (name: string) => integer(name);

/** A whole number that was `smallint` when the engine had integer widths. See the header. */
export const smallCount = (name: string) => integer(name);

/** A whole number that was `bigint` when the engine had integer widths. See the header. */
export const bigCount = (name: string) => integer(name);

/**
 * Free text.
 *
 * A fiscal amount held as text is NOT free text and must not become `label()`:
 * `packages/fiscal-verifactu/src/schema/registros.ts` keeps `cuota_total`/`importe_total` as their
 * own text column because the fiscal fingerprint hashes the stored bytes verbatim, so the stored
 * bytes must equal the hashed bytes. Nothing catches that substitution, so do not expect a test to
 * stop you.
 */
export const label = (name: string) => text(name);

/**
 * A list of free-text values, stored as a JSON array in one text column.
 *
 * This replaces `label(name).array()`: SQLite has no array type, and the storage swap's design maps
 * an array to text holding JSON. A caller still receives a `string[]`, which is what the array
 * column handed them, so the five columns that use it need no other change.
 *
 * Nothing below this layer understands the list. A PostgreSQL array column could be searched with
 * `= any(...)` and indexed per element; a query that wants to match one entry of one of these now
 * matches inside a JSON string, or the code filters in JavaScript after the read.
 */
export const labelList = (name: string) => text(name, { mode: "json" }).$type<string[]>();

/**
 * The values `defaultRandom()` and `defaultNow()` used to supply. Those are PostgreSQL builder
 * methods with no SQLite equivalent, so the value is generated in JavaScript and passed to
 * `$defaultFn`, which drizzle calls per insert and binds like any other parameter — it is NOT a SQL
 * DEFAULT, so a row written by anything other than drizzle gets nothing.
 *
 * `now` and `nowIso` are two functions on purpose, and the split is enforced by the typechecker
 * rather than by care: a `ts` column stores a `Date` and a `tsString` column a `string`, so
 * `ts(n).$defaultFn(nowIso)` and `tsString(n).$defaultFn(now)` both fail to compile. Pinned by the
 * "refuses the generator that belongs to the other timestamp helper" case in `columns.test.ts`,
 * which holds each wrong pairing under a `@ts-expect-error` — a directive that fails the typecheck
 * if the pairing ever starts compiling.
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
 * Opaque bytes, handed to callers as a `Uint8Array` — which is what the callers hold:
 * `enqueuePrintJob` in `packages/printing/src/outbox.ts` takes one and passes it straight to the
 * insert.
 *
 * A custom type rather than drizzle's `blob(name, { mode: "buffer" })`, because that mode hands a
 * caller a node `Buffer` and every existing call site is written against `Uint8Array`. Measured on
 * a real `node:sqlite` file, 2026-09-21: the driver binds a `Uint8Array` or a `Buffer`, refuses a
 * bare `ArrayBuffer`, and hands a BLOB back as a plain `Uint8Array` already. So `fromDriver` is a
 * belt-and-braces copy on this driver rather than a conversion, and `columns.test.ts` says so where
 * it round-trips a row — the mapping itself is pinned by calling it directly with a `Buffer`.
 *
 * The custom type itself stays private: drizzle's overloads on it also accept no name at all and a
 * config object, so exporting it directly would make `binary()` compile where every sibling helper
 * here demands a column name.
 */
export const binary = (name: string) => bytes(name);

export const table = sqliteTable;
