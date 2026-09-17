import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect, check, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { CORE_MIGRATIONS } from "../migrations.js";
import { usePgliteDb } from "../testing/lifecycle.js";
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

const columnsOf = () => Object.fromEntries(getTableConfig(probe).columns.map((c) => [c.name, c]));

describe("the column vocabulary emits today's PostgreSQL types", () => {
  it("keeps the exact SQL type of every helper", () => {
    const c = columnsOf();
    expect(c.pk.getSQLType()).toBe("uuid");
    expect(c.at.getSQLType()).toBe("timestamp with time zone");
    expect(c.at_string.getSQLType()).toBe("timestamp with time zone");
    expect(c.doc.getSQLType()).toBe("jsonb");
    expect(c.amount.getSQLType()).toBe("numeric(12, 2)");
    expect(c.qty.getSQLType()).toBe("numeric(12, 3)");
    expect(c.vat.getSQLType()).toBe("numeric(5, 2)");
    expect(c.kind.getSQLType()).toBe("text");
    expect(c.on.getSQLType()).toBe("boolean");
    expect(c.n.getSQLType()).toBe("integer");
    expect(c.name.getSQLType()).toBe("text");
  });

  it("distinguishes the two timestamp helpers by what a read returns, not by SQL type", () => {
    // The assertion above shows both report the same SQL type, so the generated schema cannot tell
    // a column converted to the wrong one from a correct one. The read mapping can.
    const c = columnsOf();
    expect(c.at.mapFromDriverValue("2026-09-16T10:00:00Z")).toBeInstanceOf(Date);
    expect(c.at_string.mapFromDriverValue("2026-09-16T10:00:00Z")).toBe("2026-09-16T10:00:00Z");
  });

  it("gives the two timestamp helpers different drizzle column types", () => {
    // The cheapest discriminator of the two, and the shape the sibling suite uses
    // (`packages/payments/src/monetary-columns.test.ts:45`).
    const c = columnsOf();
    expect(c.at.columnType).toBe("PgTimestamp");
    expect(c.at_string.columnType).toBe("PgTimestampString");
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
const liveColumns = Object.fromEntries(
  getTableConfig(drawerOpens).columns.map((c) => [c.name, c] as const),
);

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
const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

describe("the migrated database reports the types the vocabulary declared", () => {
  let reported: Record<string, string> = {};

  beforeAll(async () => {
    const result = (await pg.db.execute(sql`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'drawer_opens'`)) as unknown as
      | { rows: { column_name: string; data_type: string }[] }
      | { column_name: string; data_type: string }[];
    const rows = Array.isArray(result) ? result : result.rows;
    reported = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
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

describe("the vocabulary covers the column builders the rollout still needs", () => {
  const soleColumn = (built: PgTable) => getTableConfig(built).columns[0];

  it("day emits a date column and reads back the driver's string", () => {
    const c = soleColumn(table("day_probe", { on: day("on") }));
    expect(c.getSQLType()).toBe("date");
    // A date column asked for `{ mode: "date" }` emits the same SQL type and returns a `Date`, so
    // the schema probe cannot separate the two — only the read mapping can, as with ts/tsString.
    expect(c.columnType).toBe("PgDateString");
    expect(c.mapFromDriverValue("2026-09-16")).toBe("2026-09-16");
  });

  it("timeOfDay emits a bare time column, with no time zone", () => {
    const c = soleColumn(table("time_probe", { at: timeOfDay("at") }));
    expect(c.getSQLType()).toBe("time");
    expect(c.mapFromDriverValue("06:00:00")).toBe("06:00:00");
  });

  it("keeps the three whole-number helpers on three different SQL types", () => {
    // They are interchangeable at a call site and are not interchangeable in the database, so the
    // assertion names all three together rather than each alone.
    const built = table("number_probe", {
      small: smallCount("small"),
      plain: count("plain"),
      big: bigCount("big"),
    });
    const c = Object.fromEntries(
      getTableConfig(built).columns.map((column) => [column.name, column]),
    );
    expect(c.small.getSQLType()).toBe("smallint");
    expect(c.plain.getSQLType()).toBe("integer");
    expect(c.big.getSQLType()).toBe("bigint");
  });

  it("gives bigCount the number reading, not the bigint one", () => {
    // `{ mode: "number" }` and `{ mode: "bigint" }` both emit `bigint`: the ts/tsString trap again.
    const c = soleColumn(table("big_probe", { n: bigCount("n") }));
    expect(c.columnType).toBe("PgBigInt53");
    expect(c.mapFromDriverValue("42")).toBe(42);
  });

  it("binary emits bytea, binds a Buffer and reads back a plain Uint8Array", () => {
    const c = soleColumn(table("binary_probe", { bytes: binary("bytes") }));
    expect(c.getSQLType()).toBe("bytea");
    // A `Buffer` IS a `Uint8Array`, so `toBeInstanceOf(Uint8Array)` passes for both and cannot tell
    // the two apart; `Buffer.isBuffer` is what does.
    expect(Buffer.isBuffer(c.mapToDriverValue(new Uint8Array([1, 2, 3])))).toBe(true);
    const read = c.mapFromDriverValue(Buffer.from([1, 2, 3]));
    expect(Buffer.isBuffer(read)).toBe(false);
    expect(read).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("the vocabulary is reachable from outside packages/db", () => {
  it("re-exports every name columns.ts provides, as the same value", () => {
    // `packages/db`'s exports map is enumerated, so `src/index.ts` is the only door another package
    // has. Comparing identities keeps a helper added later from being reachable only in here.
    const door = publicSurface as Record<string, unknown>;
    const inside = vocabulary as Record<string, unknown>;
    const names = Object.keys(inside);
    expect(names.length).toBeGreaterThan(0); // positive control: an empty list checks nothing
    expect(names.filter((name) => door[name] !== inside[name])).toEqual([]);
  });

  it("builds a column through that door", () => {
    const built = doorTable("door_probe", { on: doorDay("on"), bytes: doorBinary("bytes") });
    const c = Object.fromEntries(
      getTableConfig(built).columns.map((column) => [column.name, column]),
    );
    expect(c.on.getSQLType()).toBe("date");
    expect(c.bytes.getSQLType()).toBe("bytea");
  });
});
