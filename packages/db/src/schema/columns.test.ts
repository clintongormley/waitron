import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect, check, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import {
  table,
  id,
  ts,
  tsString,
  json,
  money,
  quantity,
  rate,
  enumText,
  enumCheck,
  flag,
  count,
  label,
  day,
  timeOfDay,
  smallCount,
  bigCount,
  binary,
} from "./columns.js";
import * as vocabulary from "./columns.js";
import * as publicSurface from "../index.js";
import { binary as doorBinary, day as doorDay, table as doorTable } from "../index.js";
import { drawerOpens } from "./drawer-opens.js";

const probe = table("probe", {
  pk: id("pk").primaryKey().defaultRandom(),
  at: ts("at"),
  atString: tsString("at_string"),
  doc: json<{ a: number }>("doc"),
  amount: money("amount"),
  qty: quantity("qty"),
  vat: rate("vat"),
  kind: enumText("kind", ["cash_sale", "manual"] as const),
  on: flag("on"),
  n: count("n"),
  name: label("name"),
  onDay: day("on_day"),
  opensAt: timeOfDay("opens_at"),
  small: smallCount("small"),
  big: bigCount("big"),
  bytes: binary("bytes"),
});

const otherProbe = table("other_probe", {
  kind: enumText("kind", ["standard", "rectificative"] as const),
});

const checkedProbe = table(
  "checked_probe",
  { kind: enumText("kind", ["cash_sale", "manual"] as const) },
  (t) => [check("checked_probe_kind_ck", enumCheck(t.kind))],
);

const render = (fragment: SQL) => new PgDialect().sqlToQuery(fragment).sql;

/** A table's columns keyed by the name they carry in SQL, which is what every assertion here uses. */
const columnsOf = (built: PgTable) =>
  Object.fromEntries(getTableConfig(built).columns.map((c) => [c.name, c]));

describe("the column vocabulary emits today's PostgreSQL types", () => {
  it("keeps the exact SQL type of every helper", () => {
    const c = columnsOf(probe);
    expect(c.pk.getSQLType()).toBe("uuid");
    expect(c.at.getSQLType()).toBe("timestamp with time zone");
    expect(c.at_string.getSQLType()).toBe("timestamp with time zone");
    expect(c.doc.getSQLType()).toBe("jsonb");
    // Money is a count of whole cents. A decimal column would have no equivalent on the engine
    // this vocabulary exists to switch to, and a float cannot hold a cent exactly; eight bytes
    // rather than four because the money bound stated elsewhere is twelve integer digits, which
    // a four-byte column cannot hold (see the helper's own comment for the measurement).
    expect(c.amount.getSQLType()).toBe("bigint");
    // A quantity is a count of whole thousandths and a rate a count of whole basis points, for
    // the same reason money is a count of cents. Their WIDTHS differ, and that is not decoration:
    // the quantity column's old numeric(12, 3) admitted 999999999.999, which is 999999999999
    // thousandths and past a four-byte integer, while the rate column's numeric(5, 2) admitted
    // 999.99, which is 99999 basis points and fits one.
    expect(c.qty.getSQLType()).toBe("bigint");
    expect(c.vat.getSQLType()).toBe("integer");
    expect(c.kind.getSQLType()).toBe("text");
    expect(c.on.getSQLType()).toBe("boolean");
    expect(c.name.getSQLType()).toBe("text");
    expect(c.on_day.getSQLType()).toBe("date");
    expect(c.opens_at.getSQLType()).toBe("time");
    expect(c.bytes.getSQLType()).toBe("bytea");
    // The three whole-number helpers are named together because they are interchangeable at a call
    // site and are not interchangeable in the database.
    expect(c.small.getSQLType()).toBe("smallint");
    expect(c.n.getSQLType()).toBe("integer");
    expect(c.big.getSQLType()).toBe("bigint");
  });

  it("distinguishes the two timestamp helpers by what a read returns, not by SQL type", () => {
    // The assertion above shows both report the same SQL type, so the generated schema cannot tell
    // a column converted to the wrong one from a correct one. The read mapping can.
    const c = columnsOf(probe);
    expect(c.at.mapFromDriverValue("2026-09-16T10:00:00Z")).toBeInstanceOf(Date);
    expect(c.at_string.mapFromDriverValue("2026-09-16T10:00:00Z")).toBe("2026-09-16T10:00:00Z");
  });

  it("gives the two timestamp helpers different drizzle column types", () => {
    // The cheapest discriminator of the two, and the shape the sibling suite uses
    // (`packages/payments/src/monetary-columns.test.ts:45`).
    const c = columnsOf(probe);
    expect(c.at.columnType).toBe("PgTimestamp");
    expect(c.at_string.columnType).toBe("PgTimestampString");
  });
});

/** The third spelling of the values: a separate variable, and the same variable written `as const`. */
const VALUES_IN_A_VARIABLE = ["a", "b"];
const VALUES_IN_A_CONST_VARIABLE = ["a", "b"] as const;
const VALUES_IN_AN_ANNOTATED_VARIABLE: ("a" | "b")[] = ["a", "b"];

const enumSpellings = table("enum_spellings", {
  bareNullable: enumText("bare_nullable", ["a", "b"]),
  bareNotNull: enumText("bare_not_null", ["a", "b"]).notNull(),
  constNullable: enumText("const_nullable", ["a", "b"] as const),
  constNotNull: enumText("const_not_null", ["a", "b"] as const).notNull(),
  variableNullable: enumText("variable_nullable", VALUES_IN_A_VARIABLE),
  variableNotNull: enumText("variable_not_null", VALUES_IN_A_VARIABLE).notNull(),
  constVariableNullable: enumText("const_variable_nullable", VALUES_IN_A_CONST_VARIABLE),
  constVariableNotNull: enumText("const_variable_not_null", VALUES_IN_A_CONST_VARIABLE).notNull(),
  annotatedVariableNullable: enumText(
    "annotated_variable_nullable",
    VALUES_IN_AN_ANNOTATED_VARIABLE,
  ),
  annotatedVariableNotNull: enumText(
    "annotated_variable_not_null",
    VALUES_IN_AN_ANNOTATED_VARIABLE,
  ).notNull(),
});

type SpellingInsert = typeof enumSpellings.$inferInsert;

/**
 * What a caller may WRITE to an `enumText` column: one case per cell of the table in that helper's
 * own note, four ways of spelling the values crossed with the column's nullability, plus the
 * annotated declaration that note names as the second way out of the one spelling still wide.
 *
 * These are COMPILE-TIME cases. `expectTypeOf` puts a mismatch inside a type argument's constraint,
 * so `pnpm --filter @waitron/db typecheck` is what runs them — vitest's typecheck mode is off in
 * this repository and these do not need it, which is worth knowing before you go looking for the
 * config that would make them run in the suite. Nothing here can be checked at runtime: a `const`
 * type parameter is erased, so the single `expect` closing each case is incidental, there to keep
 * the body from being a no-op.
 */
describe("what a caller may write to an enumText column", () => {
  const c = columnsOf(enumSpellings);

  it("narrows an inline array literal, with no `as const` at the call site", () => {
    // Revert the `const` type parameter on enumText and the first of these stops compiling — the
    // only one of the ten cases in this describe that does, which is how the rest establish that
    // the one word moved this cell and nothing else.
    expectTypeOf<SpellingInsert["bareNullable"]>().toEqualTypeOf<"a" | "b" | null | undefined>();
    expectTypeOf<SpellingInsert["bareNotNull"]>().toEqualTypeOf<"a" | "b">();

    // A control on the pins themselves, because a pin that cannot fail proves nothing: this one is
    // deliberately wrong, and it is pinned closed from both sides. Delete the directive and
    // typecheck fails on the pin (`Type 'string' does not satisfy the constraint`); make the pin
    // right and it fails as an unused directive. There is no spelling of it that passes quietly.
    // @ts-expect-error `bareNotNull` is the union of its values, not plain `string`
    expectTypeOf<SpellingInsert["bareNotNull"]>().toEqualTypeOf<string>();

    expect(c.bare_nullable.enumValues).toEqual(["a", "b"]);
  });

  it("keeps the narrowing a caller who writes `as const` already had", () => {
    // `as const` on an inline list is not wrong, it is just no longer the only spelling that works.
    expectTypeOf<SpellingInsert["constNullable"]>().toEqualTypeOf<"a" | "b" | null | undefined>();
    expectTypeOf<SpellingInsert["constNotNull"]>().toEqualTypeOf<"a" | "b">();

    expect(c.const_nullable.enumValues).toEqual(["a", "b"]);
  });

  it("still widens to string when the values come from an unannotated variable", () => {
    // The trap that survives. An unannotated `const VALUES = ["a", "b"]` is widened to `string[]`
    // at its own declaration, before `enumText` ever sees it, so there is no literal type left for
    // a `const` type parameter to keep.
    expectTypeOf<SpellingInsert["variableNullable"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<SpellingInsert["variableNotNull"]>().toEqualTypeOf<string>();

    // The two ways out, and the receipt for the sentence above: the same spelling at the call site,
    // with the declaration written `as const` or annotated. So it is the declaration that loses the
    // values, not the call, and UNANNOTATED is the condition rather than "a variable".
    expectTypeOf<SpellingInsert["constVariableNullable"]>().toEqualTypeOf<
      "a" | "b" | null | undefined
    >();
    expectTypeOf<SpellingInsert["constVariableNotNull"]>().toEqualTypeOf<"a" | "b">();
    expectTypeOf<SpellingInsert["annotatedVariableNullable"]>().toEqualTypeOf<
      "a" | "b" | null | undefined
    >();
    expectTypeOf<SpellingInsert["annotatedVariableNotNull"]>().toEqualTypeOf<"a" | "b">();

    expect(c.variable_nullable.enumValues).toEqual(["a", "b"]);
  });
});

describe("enumCheck derives the check constraint from the column's own values", () => {
  it("lists exactly the values the column was declared with", () => {
    expect(render(enumCheck(probe.kind))).toBe("\"probe\".\"kind\" in ('cash_sale', 'manual')");
    expect(render(enumCheck(otherProbe.kind))).toBe(
      "\"other_probe\".\"kind\" in ('standard', 'rectificative')",
    );
  });

  it("works from a table's extra-config callback, the only place a check is declared", () => {
    // Drizzle hands that callback an `ExtraConfigColumn`, a different object from the table's own
    // column: it renders as the right column reference but carries no values at runtime, and
    // TypeScript types its `enumValues` as `string[] | undefined` — not as the vocabulary. The
    // fallback to the table's own column is what makes this case pass.
    const [constraint] = getTableConfig(checkedProbe).checks;
    expect(render(constraint.value)).toBe("\"checked_probe\".\"kind\" in ('cash_sale', 'manual')");
  });

  it("refuses a column that was not declared with enumText", () => {
    expect(() => enumCheck(probe.name)).toThrow(/enumText/);
  });

  it("keeps its values inline when a caller composes a null arm around it", () => {
    // A nullable checked column is written `<col> is null or <col> in (...)`, and enumCheck emits
    // only the second half — so the null arm is composed AROUND it. The risk that makes this worth
    // a case: `.inlineParams()` is set on the inner fragment, and if it did not survive being
    // nested the values would render as bind placeholders and change the generated DDL. Prove it by
    // deleting `.inlineParams()` from enumCheck: this case goes red on the placeholders.
    expect(render(sql`${probe.kind} is null or ${enumCheck(probe.kind)}`)).toBe(
      '"probe"."kind" is null or "probe"."kind" in (\'cash_sale\', \'manual\')',
    );
  });

  it("renders the values as SQL literals, never as bind placeholders", () => {
    // A check constraint is DDL: a placeholder here would be written into the generated migration
    // as `in ($1, $2)` and change the schema. Measured 2026-09-17: without `.inlineParams()` that
    // is exactly what drizzle emits.
    expect(render(enumCheck(probe.kind))).not.toMatch(/\$\d/);
  });
});

/**
 * The vocabulary is only worth anything if what it emits is what the migrations on disk already
 * declare. `drawer_opens` is the one table converted to it so far, so these assertions read the
 * generated DDL from disk — the payments package's `monetary-columns.test.ts` shape — and pin it
 * against the live column, rather than letting Drizzle's in-memory builder describe itself.
 */
const drizzleDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

const generatedSql = () =>
  readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n");

/** The body of `drawer_opens`'s own CREATE TABLE, non-greedy so a later table cannot be caught. */
const createTableBody = (tableName: string) =>
  new RegExp(`create table "${tableName}" \\(([\\s\\S]*?)\\n\\);`, "i").exec(generatedSql())?.[1];

/** The SQL type the migration gives each `drawer_opens` column, and the helper that must emit it. */
const DRAWER_OPENS_TYPES = {
  id: "uuid",
  till_id: "uuid",
  person_id: "uuid",
  opened_at: "timestamp with time zone",
  reason: "text",
  sale_id: "uuid",
  authorized_by: "uuid",
  via_override: "boolean",
} as const;

/** `drawer_opens` as the vocabulary builds it, keyed by column name. */
const liveColumns = columnsOf(drawerOpens);

describe("the generated migration and the converted table agree", () => {
  const body = createTableBody("drawer_opens");
  const live = liveColumns;

  it("finds drawer_opens in the generated migrations at all", () => {
    // Positive control: a renamed or deleted table would otherwise make every assertion below
    // vacuously true, with nothing left to check.
    expect(body).toBeDefined();
  });

  for (const [column, sqlType] of Object.entries(DRAWER_OPENS_TYPES)) {
    it(`declares "${column}" as ${sqlType}, and the vocabulary still emits that`, () => {
      expect(body).toContain(`"${column}" ${sqlType}`);
      expect(live[column]?.getSQLType()).toBe(sqlType);
    });
  }

  it("declares the reason check exactly as enumCheck builds it", () => {
    const [constraint] = getTableConfig(drawerOpens).checks.filter(
      (c) => c.name === "drawer_opens_reason_ck",
    );
    expect(constraint).toBeDefined(); // positive control, as above
    expect(render(constraint.value)).toBe("\"drawer_opens\".\"reason\" in ('cash_sale', 'manual')");
    expect(body).toContain(
      `CONSTRAINT "drawer_opens_reason_ck" CHECK ("drawer_opens"."reason" in ('cash_sale', 'manual'))`,
    );
  });
});

/**
 * Everything above reads Drizzle's own builder and the migration TEXT on disk. Neither is a
 * database, and the claim this module rests on is that the helpers emit the PostgreSQL types they
 * replaced — which only a server that ran the migrations can settle. So: migrate, then ask
 * `information_schema` what was created.
 *
 * PGlite rather than a container: nothing here turns on who connected, on a trigger's role or on
 * concurrency, which are the three things PGlite cannot show (CLAUDE.md §4). No rows are written,
 * so the per-test reset has nothing to do.
 */
const pg = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

/** What the server says it created: one table's `data_type` per column name. */
const reportedTypes = async (tableName: string) => {
  const result = (await pg.db.execute(sql`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = ${tableName}`)) as unknown as
    | { rows: { column_name: string; data_type: string }[] }
    | { column_name: string; data_type: string }[];
  const rows = Array.isArray(result) ? result : result.rows;
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
};

describe("the migrated database reports the types the vocabulary declared", () => {
  let reported: Record<string, string> = {};

  beforeAll(async () => {
    reported = await reportedTypes("drawer_opens");
  });

  it("created drawer_opens with exactly the columns named below", () => {
    // Positive control: a renamed or missing table reports NO columns, and a column the loop never
    // names is a column nothing checks. Comparing the whole key set catches both, so the per-column
    // cases below cannot pass by being absent.
    expect(Object.keys(reported).sort()).toEqual(Object.keys(DRAWER_OPENS_TYPES).sort());
  });

  for (const [column, sqlType] of Object.entries(DRAWER_OPENS_TYPES)) {
    it(`stored "${column}" as ${sqlType}, and the helper still emits that type`, () => {
      expect(reported[column]).toBe(sqlType);
      // The second assertion is what makes this sensitive to the vocabulary rather than only to
      // the migration: swap a column's helper and the live column stops matching the database.
      expect(liveColumns[column]?.getSQLType()).toBe(reported[column]);
    });
  }
});

/**
 * `drawer_opens`, the one migrated table this file interrogates, carries no `day`, `timeOfDay`,
 * `smallCount`, `bigCount` or `binary` column, so it cannot settle those five the way it settles
 * the helpers before them. (Other migrated tables do declare them — `daily_closes.business_day`,
 * `tenants.day_cutover`, `dining_tables.pos_x`, `catalogue.version`, `print_jobs.payload` — so a
 * future version of this file could interrogate one of those instead.) The probe table at
 * the top of this file can: create it in the same database from the DDL drizzle-kit generates for
 * that very table object — the statement it would write into a migration, not one typed here — and
 * then ask the server what it made.
 *
 * The type `information_schema` reports is the server's own spelling, not the helper's:
 * `timeOfDay`'s `time` comes back as `time without time zone`.
 */
const NEW_HELPER_TYPES = {
  on_day: "date",
  opens_at: "time without time zone",
  small: "smallint",
  big: "bigint",
  bytes: "bytea",
} as const;

describe("the same database reports the types the newest helpers declared", () => {
  let reported: Record<string, string> = {};

  beforeAll(async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const statements = await generateMigration(
      await generateDrizzleJson({}),
      await generateDrizzleJson({ probe }),
    );
    for (const statement of statements) await pg.db.execute(sql.raw(statement));
    reported = await reportedTypes("probe");
  });

  it("created probe with every column the vocabulary declared on it", () => {
    // What this catches: drizzle-kit emitting no statements at all, or DDL that silently drops a
    // column. Weaker than the `drawer_opens` control above in one way, because it compares against
    // `probe` itself — the very object the DDL was generated from — so it does NOT catch "a column
    // the loop never names". The type table below names five of probe's columns; the rest have
    // their existence checked here and their type checked by nothing.
    expect(Object.keys(reported).sort()).toEqual(Object.keys(columnsOf(probe)).sort());
  });

  for (const [column, sqlType] of Object.entries(NEW_HELPER_TYPES)) {
    it(`stored "${column}" as ${sqlType}`, () => {
      expect(reported[column]).toBe(sqlType);
    });
  }

  it("writes and reads back the same bytes through the bytea column", async () => {
    // Only that the bytes survive a real column. The trap, so nobody adds a mapping assertion here:
    // on PGlite this case cannot see the Buffer-to-Uint8Array conversion AT ALL, because PGlite's
    // own bytea parser already returns a `Uint8Array` and drizzle passes the driver value straight
    // through when `fromDriver` is absent. Measured 2026-09-17: with BOTH `toDriver` and
    // `fromDriver` deleted from the `bytea` custom type, this case still passed and the only red
    // one in the file was "binary binds a Buffer and reads back a plain Uint8Array" in the describe
    // below — which is where that mapping is pinned. `printing.test.ts:247` asserts
    // `Buffer.isBuffer(row.payload)` is false on a REAL PostgreSQL read, where node-postgres hands
    // back a `Buffer` for `fromDriver` to convert — so a missing `fromDriver` would turn that file
    // red where it cannot turn this one red. The difference between the two files is the driver's,
    // not any helper's.
    await pg.db.insert(probe).values({ bytes: new Uint8Array([1, 2, 3]) });
    const [row] = await pg.db.select({ bytes: probe.bytes }).from(probe);
    expect(row?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("the newest helpers differ in ways their SQL type cannot show", () => {
  // The SQL types themselves are pinned with every other helper's, on the shared probe table above.
  const c = columnsOf(probe);

  it("gives day the string reading, not the Date one", () => {
    // A date column asked for `{ mode: "date" }` emits the same SQL type and returns a `Date`, so
    // the schema probe cannot separate the two — only the read mapping can, as with ts/tsString.
    expect(c.on_day.columnType).toBe("PgDateString");
    expect(c.on_day.mapFromDriverValue("2026-09-16")).toBe("2026-09-16");
  });

  it("hands a timeOfDay value back as the driver's own string", () => {
    // Pins the shape a caller receives. Unlike `day` and `bigCount` above this is NOT a mode
    // discriminator: drizzle's `time` takes no `mode` (only `precision` and `withTimezone`), so
    // `PgTime` never overrides `mapFromDriverValue` and this is an identity check. Measured
    // 2026-09-17: rebuilding `timeOfDay` on `timestamp(..., { mode: "date" })` does turn it red,
    // but the two SQL-type cases go red with it — so treat this as documentation of the returned
    // type, not as the assertion that would catch such a swap.
    expect(c.opens_at.mapFromDriverValue("06:00:00")).toBe("06:00:00");
  });

  it("gives money the number reading, so a count of cents arrives as a number", () => {
    // `money` and `bigCount` emit the same SQL type, so the type assertion above cannot tell a
    // mode swap from a correct column. A caller that received a JavaScript `bigint` here would
    // break every arithmetic and every conversion in `@waitron/shared`'s cents module.
    expect(c.amount.columnType).toBe("PgBigInt53");
    expect(c.amount.mapFromDriverValue("1234")).toBe(1234);
  });

  it("gives quantity the number reading, so a count of thousandths arrives as a number", () => {
    // The third column of the same SQL type, and the one a mode swap would hurt most quietly: a
    // caller handed a JavaScript `bigint` here cannot pass it to `thousandthsToDecimal` in
    // `@waitron/shared`, which takes a number. The SQL-type case above cannot see the swap —
    // rebuilt as `{ mode: "bigint" }` every assertion in this file but this one still passes.
    expect(c.qty.columnType).toBe("PgBigInt53");
    expect(c.qty.mapFromDriverValue("1500")).toBe(1500);
  });

  it("gives bigCount the number reading, not the bigint one", () => {
    // `{ mode: "number" }` and `{ mode: "bigint" }` both emit `bigint`: the ts/tsString trap again.
    expect(c.big.columnType).toBe("PgBigInt53");
    expect(c.big.mapFromDriverValue("42")).toBe(42);
  });

  it("binary takes a column name, like every other helper", () => {
    // `customType(...)` returns a two-parameter function whose overloads also admit `binary()` and
    // `binary({ ... })`, so exporting that result directly would let a call with no name compile.
    expect(binary.length).toBe(1);
  });

  it("binary binds a Buffer and reads back a plain Uint8Array", () => {
    // A `Buffer` IS a `Uint8Array`, so `toBeInstanceOf(Uint8Array)` passes for both and cannot tell
    // the two apart; `Buffer.isBuffer` is what does.
    expect(Buffer.isBuffer(c.bytes.mapToDriverValue(new Uint8Array([1, 2, 3])))).toBe(true);
    const read = c.bytes.mapFromDriverValue(Buffer.from([1, 2, 3]));
    expect(Buffer.isBuffer(read)).toBe(false);
    expect(read).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("the vocabulary is reachable from outside packages/db", () => {
  it("re-exports every name columns.ts provides, as the same value", () => {
    // Comparing identities keeps a helper added later from being reachable only in here. Weaker
    // than its name in one way: `Object.keys` on a module namespace sees VALUES, so an exported
    // TYPE is never checked.
    const door = publicSurface as Record<string, unknown>;
    const inside = vocabulary as Record<string, unknown>;
    const names = Object.keys(inside);
    expect(names.length).toBeGreaterThan(0); // positive control: an empty list checks nothing
    expect(names.filter((name) => door[name] !== inside[name])).toEqual([]);
  });

  it("builds a column through that door", () => {
    const c = columnsOf(doorTable("door_probe", { on: doorDay("on"), bytes: doorBinary("bytes") }));
    expect(c.on.getSQLType()).toBe("date");
    expect(c.bytes.getSQLType()).toBe("bytea");
  });
});
