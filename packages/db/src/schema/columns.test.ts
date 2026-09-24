import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { getTableColumns, sql, type AnyColumn, type SQL, type Table } from "drizzle-orm";
import { SQLiteSyncDialect, check, getTableConfig } from "drizzle-orm/sqlite-core";
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
  enumType,
  labelList,
  newId,
  now,
  nowIso,
} from "./columns.js";
import * as vocabulary from "./columns.js";

const publicSurface = () => import("../index.js");
const drawerOpensTable = async () => (await import("./drawer-opens.js")).drawerOpens;

const probe = table("probe", {
  pk: id("pk").primaryKey().$defaultFn(newId),
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
  tags: labelList("tags"),
});

const otherProbe = table("other_probe", {
  kind: enumText("kind", ["standard", "rectificative"] as const),
});

const checkedProbe = table(
  "checked_probe",
  { kind: enumText("kind", ["cash_sale", "manual"] as const) },
  (t) => [check("checked_probe_kind_ck", enumCheck(t.kind))],
);

const render = (fragment: SQL) => new SQLiteSyncDialect().sqlToQuery(fragment).sql;

const columnsOf = (built: Table): Record<string, AnyColumn> =>
  Object.fromEntries(Object.values(getTableColumns(built)).map((c) => [c.name, c]));

describe("the column vocabulary emits SQLite's types", () => {
  it("keeps the exact SQL type of every helper", () => {
    const c = columnsOf(probe);
    expect(c.pk.getSQLType()).toBe("text");
    expect(c.at.getSQLType()).toBe("text");
    expect(c.at_string.getSQLType()).toBe("text");
    expect(c.doc.getSQLType()).toBe("text");
    expect(c.amount.getSQLType()).toBe("integer");
    expect(c.qty.getSQLType()).toBe("integer");
    expect(c.vat.getSQLType()).toBe("integer");
    expect(c.kind.getSQLType()).toBe("text");
    expect(c.on.getSQLType()).toBe("integer");
    expect(c.name.getSQLType()).toBe("text");
    expect(c.on_day.getSQLType()).toBe("text");
    expect(c.opens_at.getSQLType()).toBe("text");
    expect(c.bytes.getSQLType()).toBe("blob");
    expect(c.tags.getSQLType()).toBe("text");
    expect(c.small.getSQLType()).toBe("integer");
    expect(c.n.getSQLType()).toBe("integer");
    expect(c.big.getSQLType()).toBe("integer");
  });

  it("emits only three distinct SQL types across the whole vocabulary", () => {
    // The case that states the LOSS: nothing about a column's SQL type separates one helper of a
    // group from another; the helper's NAME and the read mapping pinned below do.
    const types = new Set(Object.values(columnsOf(probe)).map((c) => c.getSQLType()));
    expect([...types].sort()).toEqual(["blob", "integer", "text"]);
  });
});

describe("what a read hands back, which is where the helpers still differ", () => {
  const c = columnsOf(probe);

  it("gives ts a Date and tsString the driver's own string", () => {
    expect(c.at.mapFromDriverValue("2026-09-16T10:00:00.000Z")).toEqual(
      new Date("2026-09-16T10:00:00.000Z"),
    );
    expect(c.at_string.mapFromDriverValue("2026-09-16T10:00:00.000Z")).toBe(
      "2026-09-16T10:00:00.000Z",
    );
  });

  it("writes a ts value as the ISO-8601 string the column stores", () => {
    expect(c.at.mapToDriverValue(new Date("2026-09-16T10:00:00.000Z"))).toBe(
      "2026-09-16T10:00:00.000Z",
    );
  });

  it("parses a json column and leaves a label column alone", () => {
    // `json` and `label` are both `text`, so only this separates them.
    expect(c.doc.mapFromDriverValue('{"a":1}')).toEqual({ a: 1 });
    expect(c.name.mapFromDriverValue('{"a":1}')).toBe('{"a":1}');
    expect(c.doc.mapToDriverValue({ a: 1 })).toBe('{"a":1}');
  });

  it("hands labelList a string array, as the PostgreSQL array column did", () => {
    expect(c.tags.mapFromDriverValue('["one","two"]')).toEqual(["one", "two"]);
    expect(c.tags.mapToDriverValue(["one", "two"])).toBe('["one","two"]');
    expectTypeOf<(typeof probe.$inferSelect)["tags"]>().toEqualTypeOf<string[] | null>();
    expectTypeOf<(typeof probe.$inferInsert)["tags"]>().toEqualTypeOf<
      string[] | null | undefined
    >();
  });

  it("gives flag a boolean where every other integer helper gives a number", () => {
    expect(c.on.mapFromDriverValue(1)).toBe(true);
    expect(c.on.mapFromDriverValue(0)).toBe(false);
    expect(c.on.mapToDriverValue(true)).toBe(1);
    expect(c.amount.mapFromDriverValue(1234)).toBe(1234);
    expect(c.qty.mapFromDriverValue(1500)).toBe(1500);
    expect(c.big.mapFromDriverValue(42)).toBe(42);
  });

  it("gives day and timeOfDay the driver's own string, as they had on PostgreSQL", () => {
    expect(c.on_day.mapFromDriverValue("2026-09-16")).toBe("2026-09-16");
    expect(c.opens_at.mapFromDriverValue("06:00:00")).toBe("06:00:00");
  });

  it("binary binds a Uint8Array and hands back a plain Uint8Array, never a Buffer", () => {
    // A `Buffer` IS a `Uint8Array`, so `toBeInstanceOf(Uint8Array)` passes for both and cannot tell
    // the two apart; `Buffer.isBuffer` is what does.
    const bound = c.bytes.mapToDriverValue(new Uint8Array([1, 2, 3]));
    expect(ArrayBuffer.isView(bound)).toBe(true);
    const read = c.bytes.mapFromDriverValue(Buffer.from([1, 2, 3]));
    expect(Buffer.isBuffer(read)).toBe(false);
    expect(read).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("binary takes a column name, like every other helper", () => {
    // `customType(...)` returns a two-parameter function whose overloads also admit `binary()` and
    // `binary({ ... })`, so exporting that result directly would let a call with no name compile.
    expect(binary.length).toBe(1);
  });
});

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
 * One case per cell of the table in `enumText`'s note. These are COMPILE-TIME cases:
 * `pnpm --filter @waitron/db typecheck` is what runs them, since vitest's typecheck mode is off in
 * this repository. The single `expect` closing each case is incidental, there to keep the body from
 * being a no-op.
 */
describe("what a caller may write to an enumText column", () => {
  const c = columnsOf(enumSpellings);

  it("narrows an inline array literal, with no `as const` at the call site", () => {
    expectTypeOf<SpellingInsert["bareNullable"]>().toEqualTypeOf<"a" | "b" | null | undefined>();
    expectTypeOf<SpellingInsert["bareNotNull"]>().toEqualTypeOf<"a" | "b">();

    // A control on the pins themselves: deliberately wrong, and pinned closed from both sides.
    // Delete the directive and typecheck fails on the pin; make the pin right and it fails as an
    // unused directive.
    // @ts-expect-error `bareNotNull` is the union of its values, not plain `string`
    expectTypeOf<SpellingInsert["bareNotNull"]>().toEqualTypeOf<string>();

    expect(c.bare_nullable.enumValues).toEqual(["a", "b"]);
  });

  it("keeps the narrowing a caller who writes `as const` already had", () => {
    expectTypeOf<SpellingInsert["constNullable"]>().toEqualTypeOf<"a" | "b" | null | undefined>();
    expectTypeOf<SpellingInsert["constNotNull"]>().toEqualTypeOf<"a" | "b">();

    expect(c.const_nullable.enumValues).toEqual(["a", "b"]);
  });

  it("still widens to string when the values come from an unannotated variable", () => {
    // An unannotated `const VALUES = ["a", "b"]` is widened to `string[]` at its own declaration,
    // before `enumText` ever sees it.
    expectTypeOf<SpellingInsert["variableNullable"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<SpellingInsert["variableNotNull"]>().toEqualTypeOf<string>();

    // The same spelling at the call site, with the declaration written `as const` or annotated: it
    // is the declaration that loses the values, not the call.
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

const ticketState = enumType(["open", "served"]);

/** The one wide row of `enumText`'s table, asked of `enumType`: an unannotated variable. */
const STATES_IN_A_VARIABLE = ["open", "served"];
const wideState = enumType(STATES_IN_A_VARIABLE);
const wideStateProbe = table("wide_state_probe", { state: wideState("state") });

const enumTypeProbe = table("enum_type_probe", { state: ticketState("state") }, (t) => [
  check("enum_type_probe_state_ck", enumCheck(t.state)),
]);

describe("enumType stands in for a PostgreSQL enum type", () => {
  it("builds a text column a check constraint can read its values off", () => {
    const c = columnsOf(enumTypeProbe);
    expect(c.state.getSQLType()).toBe("text");
    expect(render(enumCheck(enumTypeProbe.state))).toBe(
      "\"enum_type_probe\".\"state\" in ('open', 'served')",
    );
    // And from the extra-config callback, which is the only place a check is actually declared.
    const [constraint] = getTableConfig(enumTypeProbe).checks;
    expect(render(constraint.value)).toBe("\"enum_type_probe\".\"state\" in ('open', 'served')");
  });

  it("exposes enumValues to a caller, the way a pgEnum declaration did", () => {
    expect(ticketState.enumValues).toEqual(["open", "served"]);
  });

  it("narrows a caller's value exactly as enumText does", () => {
    // Compile-time, like the enumText table above.
    expectTypeOf<(typeof ticketState.enumValues)[number]>().toEqualTypeOf<"open" | "served">();
    expectTypeOf<(typeof enumTypeProbe.$inferInsert)["state"]>().toEqualTypeOf<
      "open" | "served" | null | undefined
    >();

    // The one row of that table where the narrowing is LOST: an unannotated variable.
    expectTypeOf<(typeof wideStateProbe.$inferInsert)["state"]>().toEqualTypeOf<
      string | null | undefined
    >();

    // The same both-sided control the enumText table carries.
    // @ts-expect-error `state` is the union of its values, not plain `string`
    expectTypeOf<(typeof enumTypeProbe.$inferInsert)["state"]>().toEqualTypeOf<string>();

    expect(columnsOf(enumTypeProbe).state.enumValues).toEqual(["open", "served"]);
    // The values still reach the COLUMN in that wide case — it is only the TypeScript type that is
    // lost — so the check constraint such a declaration builds is unaffected.
    expect(columnsOf(wideStateProbe).state.enumValues).toEqual(["open", "served"]);
  });
});

describe("the default generators, which replace defaultRandom and defaultNow", () => {
  it("newId mints a fresh uuid every call", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(newId());
  });

  it("now hands a Date and nowIso the same moment as an ISO-8601 string", () => {
    const before = Date.now();
    const d = now();
    const iso = nowIso();
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBeGreaterThanOrEqual(before);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("arrives on the column as the value drizzle will insert", () => {
    // `$defaultFn` is not a SQL DEFAULT, so the column is where a caller can see it.
    const c = columnsOf(probe);
    expect(c.pk.hasDefault).toBe(true);
    expect(c.pk.defaultFn?.()).toMatch(/^[0-9a-f]{8}-/);
  });

  it("refuses the generator that belongs to the other timestamp helper", () => {
    // Compile-time, and the reason `now` and `nowIso` are two functions rather than one.
    ts("right").$defaultFn(now);
    tsString("right").$defaultFn(nowIso);
    id("right").$defaultFn(newId);

    // @ts-expect-error a ts column stores a Date, so nowIso's string is not assignable
    ts("wrong").$defaultFn(nowIso);
    // @ts-expect-error a tsString column stores a string, so now's Date is not assignable
    tsString("wrong").$defaultFn(now);
    // @ts-expect-error an id column stores a string, so now's Date is not assignable
    id("wrong").$defaultFn(now);

    expect(ts("right").$defaultFn(now)).toBeDefined();
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
    const [constraint] = getTableConfig(checkedProbe).checks;
    expect(render(constraint.value)).toBe("\"checked_probe\".\"kind\" in ('cash_sale', 'manual')");
  });

  it("refuses a column that was not declared with enumText", () => {
    expect(() => enumCheck(probe.name)).toThrow(/enumText/);
  });

  it("keeps its values inline when a caller composes a null arm around it", () => {
    // A nullable checked column is written `<col> is null or <col> in (...)`, so the null arm is
    // composed AROUND enumCheck. `.inlineParams()` is set on the inner fragment, and if it did not
    // survive being nested the values would render as bind placeholders.
    expect(render(sql`${probe.kind} is null or ${enumCheck(probe.kind)}`)).toBe(
      '"probe"."kind" is null or "probe"."kind" in (\'cash_sale\', \'manual\')',
    );
  });

  it("renders the values as SQL literals, never as bind placeholders", () => {
    // A check constraint is DDL: a placeholder here would be written into the generated migration
    // as `in (?, ?)` and change the schema.
    expect(render(enumCheck(probe.kind))).not.toMatch(/\?/);
  });
});

/**
 * These read the generated DDL from disk and pin it against the live column, rather than letting
 * Drizzle's in-memory builder describe itself.
 */
const drizzleDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

const generatedSql = () =>
  readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n");

/** The body of a table's own CREATE TABLE, non-greedy so a later table cannot be caught. */
const createTableBody = (tableName: string) =>
  new RegExp(`create table \`${tableName}\` \\(([\\s\\S]*?)\\n\\);`, "i").exec(generatedSql())?.[1];

/** The SQL type the migration gives each `drawer_opens` column, and the helper that must emit it. */
const DRAWER_OPENS_TYPES = {
  id: "text",
  till_id: "text",
  person_id: "text",
  opened_at: "text",
  reason: "text",
  sale_id: "text",
  authorized_by: "text",
  via_override: "integer",
} as const;

describe("the generated migration and the converted table agree", () => {
  const body = createTableBody("drawer_opens");
  let live: Record<string, AnyColumn> = {};

  beforeAll(async () => {
    live = columnsOf(await drawerOpensTable());
  });

  it("finds drawer_opens in the generated migrations at all", () => {
    // Positive control: a renamed or deleted table would otherwise make every assertion below
    // vacuously true, with nothing left to check.
    expect(body).toBeDefined();
  });

  for (const [column, sqlType] of Object.entries(DRAWER_OPENS_TYPES)) {
    it(`declares "${column}" as ${sqlType}, and the vocabulary still emits that`, () => {
      expect(body).toContain(`\`${column}\` ${sqlType}`);
      expect(live[column]?.getSQLType()).toBe(sqlType);
    });
  }

  it("declares the reason check exactly as enumCheck builds it", async () => {
    const [constraint] = getTableConfig(await drawerOpensTable()).checks.filter(
      (c) => c.name === "drawer_opens_reason_ck",
    );
    expect(constraint).toBeDefined(); // positive control, as above
    expect(render(constraint.value)).toBe("\"drawer_opens\".\"reason\" in ('cash_sale', 'manual')");
    expect(body).toContain(
      `CONSTRAINT "drawer_opens_reason_ck" CHECK("drawer_opens"."reason" in ('cash_sale', 'manual'))`,
    );
  });
});

/**
 * Everything above reads Drizzle's own builder and the migration TEXT on disk; neither is a
 * database. So: generate the probe tables through drizzle-kit as a migration would be generated,
 * run that DDL into a real `node:sqlite` file, and ask the engine what it made. The values are
 * mapped through the columns' own `mapToDriverValue`/`mapFromDriverValue`, which is what a Drizzle
 * insert and select would call.
 */
const PRAGMA_TYPES = {
  pk: "TEXT",
  at: "TEXT",
  at_string: "TEXT",
  doc: "TEXT",
  amount: "INTEGER",
  qty: "INTEGER",
  vat: "INTEGER",
  kind: "TEXT",
  on: "INTEGER",
  n: "INTEGER",
  name: "TEXT",
  on_day: "TEXT",
  opens_at: "TEXT",
  small: "INTEGER",
  big: "INTEGER",
  bytes: "BLOB",
  tags: "TEXT",
} as const;

describe("a real node:sqlite database reports the types the vocabulary declared", () => {
  let dir = "";
  let raw: DatabaseSync;
  let reported: Record<string, string> = {};

  beforeAll(async () => {
    const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
    const statements = await generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson({ probe, checkedProbe, enumTypeProbe }),
    );
    dir = mkdtempSync(join(tmpdir(), "columns-probe-"));
    raw = new DatabaseSync(join(dir, "probe.db"));
    for (const statement of statements) raw.exec(statement);
    reported = Object.fromEntries(
      (raw.prepare("pragma table_info(probe)").all() as { name: string; type: string }[]).map(
        (r) => [r.name, r.type],
      ),
    );
  });

  afterAll(() => {
    raw?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("created probe with exactly the columns named below", () => {
    // Positive control: a renamed or missing table reports NO columns, and a column the table
    // below never names is a column nothing checks. Comparing the whole key set catches both.
    expect(Object.keys(reported).sort()).toEqual(Object.keys(PRAGMA_TYPES).sort());
  });

  for (const [column, pragmaType] of Object.entries(PRAGMA_TYPES)) {
    it(`stored "${column}" as ${pragmaType}`, () => {
      expect(reported[column]).toBe(pragmaType);
    });
  }

  it("round-trips one row of every helper's value through the engine", () => {
    const c = columnsOf(probe);
    const at = new Date("2026-09-16T10:00:00.000Z");
    raw
      .prepare(
        "insert into probe (pk, at, at_string, doc, amount, qty, vat, kind, `on`, n, name," +
          " on_day, opens_at, small, big, bytes, tags)" +
          " values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "row-1",
        c.at.mapToDriverValue(at) as string,
        "2026-09-16T10:00:00.000Z",
        c.doc.mapToDriverValue({ a: 1 }) as string,
        1234,
        1500,
        2100,
        "manual",
        c.on.mapToDriverValue(true) as number,
        7,
        "a name",
        "2026-09-16",
        "06:00:00",
        3,
        42,
        c.bytes.mapToDriverValue(new Uint8Array([1, 2, 3])) as Uint8Array,
        c.tags.mapToDriverValue(["one", "two"]) as string,
      );
    const row = raw.prepare("select * from probe").get() as Record<string, never>;

    expect(c.at.mapFromDriverValue(row.at)).toEqual(at);
    expect(c.at_string.mapFromDriverValue(row.at_string)).toBe("2026-09-16T10:00:00.000Z");
    expect(c.doc.mapFromDriverValue(row.doc)).toEqual({ a: 1 });
    expect(c.amount.mapFromDriverValue(row.amount)).toBe(1234);
    expect(c.qty.mapFromDriverValue(row.qty)).toBe(1500);
    expect(c.vat.mapFromDriverValue(row.vat)).toBe(2100);
    expect(c.kind.mapFromDriverValue(row.kind)).toBe("manual");
    expect(c.on.mapFromDriverValue(row.on)).toBe(true);
    expect(c.n.mapFromDriverValue(row.n)).toBe(7);
    expect(c.name.mapFromDriverValue(row.name)).toBe("a name");
    expect(c.on_day.mapFromDriverValue(row.on_day)).toBe("2026-09-16");
    expect(c.opens_at.mapFromDriverValue(row.opens_at)).toBe("06:00:00");
    expect(c.small.mapFromDriverValue(row.small)).toBe(3);
    expect(c.big.mapFromDriverValue(row.big)).toBe(42);

    // Not proof of `binary`'s read mapping: `node:sqlite` hands a BLOB back as a plain `Uint8Array`
    // already, so `fromDriver` cannot be seen here. What this pins is that the BYTES survive; the
    // mapping is pinned in "binary binds a Uint8Array and hands back a plain Uint8Array, never a
    // Buffer".
    expect(Buffer.isBuffer(row.bytes)).toBe(false);
    expect(c.bytes.mapFromDriverValue(row.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(c.tags.mapFromDriverValue(row.tags)).toEqual(["one", "two"]);
  });

  it("refuses a value outside an enumText column's vocabulary", () => {
    // Asked of the engine rather than of the rendered SQL.
    expect(() =>
      raw.prepare("insert into checked_probe (kind) values (?)").run("not_a_reason"),
    ).toThrow(/CHECK constraint failed: checked_probe_kind_ck/);
  });

  it("refuses a value outside an enumType column's vocabulary too", () => {
    expect(() =>
      raw.prepare("insert into enum_type_probe (state) values (?)").run("cancelled"),
    ).toThrow(/CHECK constraint failed: enum_type_probe_state_ck/);
  });
});

describe("the vocabulary is reachable from outside packages/db", () => {
  it("re-exports every name columns.ts provides, as the same value", async () => {
    // Weaker than its name: `Object.keys` on a module namespace sees VALUES, so an exported TYPE is
    // never checked.
    const door = (await publicSurface()) as unknown as Record<string, unknown>;
    const inside = vocabulary as Record<string, unknown>;
    const names = Object.keys(inside);
    expect(names.length).toBeGreaterThan(0); // positive control: an empty list checks nothing
    expect(names.filter((name) => door[name] !== inside[name])).toEqual([]);
  });

  it("builds a column through that door", async () => {
    const { binary: doorBinary, day: doorDay, table: doorTable } = await publicSurface();
    const c = columnsOf(doorTable("door_probe", { on: doorDay("on"), bytes: doorBinary("bytes") }));
    expect(c.on.getSQLType()).toBe("text");
    expect(c.bytes.getSQLType()).toBe("blob");
  });
});
