// Every drizzle table declaration in this package, compared with the database the core migrations
// actually build: table name, column names and SQL types, nullability, column defaults, primary
// keys, foreign keys with the actions they take on delete and on update, unique and non-unique
// indexes with their columns and their filters, and check constraints by name AND by what they
// say. Plus every closed vocabulary a column declares, and one rule the database cannot state:
// every column spells its own name out rather than letting drizzle derive one from the property
// key.
//
// Nothing else in the suite reads a declaration and checks it against the schema, so a declaration
// that drifts from its migration — a renamed column, a foreign key pointing at the wrong table, a
// money column declared as free text — is invisible until a query fails at runtime.
//
// HOW THE DATABASE SIDE IS READ, because it changed with the engine. PostgreSQL had a queryable
// catalogue (`pg_attribute`, `pg_constraint`, `pg_index`) and a renderer (`pg_get_constraintdef`,
// `pg_get_expr`) that normalised an expression on the way back out. SQLite has neither. What it
// has is `pragma table_info` / `foreign_key_list` / `index_list` / `index_info` for the structural
// facts, and `sqlite_master.sql` — the CREATE statement stored VERBATIM as the migration wrote it
// — for everything else. So check constraints and index filters are read by parsing that text,
// which is a real limit on this file and is stated at each parser below.
//
// The one place that made the translation easy: because SQLite stores the statement verbatim and
// drizzle-kit WROTE that statement with the same renderer this file calls, a declared expression
// and a built one are directly comparable as text, with nothing normalising either side. The
// scratch-schema round trip the PostgreSQL version needed (`create table … (like …)`, add the
// declared constraints, read them back through `pg_get_constraintdef`) is therefore gone, and the
// comparison is TIGHTER than it was rather than looser: a difference of wording alone now fails,
// where PostgreSQL rewrote `in (…)` into `= ANY (ARRAY[…])` on both sides and hid it. Measured
// 2026-09-22 across all 47 core tables: zero differences between the rendered declaration and the
// stored DDL, for every check constraint and every index filter.
//
// The three allowance lists this file used to carry — foreign keys, indexes and checks the
// migrations created that no declaration held — are gone with them, and NOT because anything was
// given up. They existed because those objects were written by hand in `--custom` migrations that
// drizzle-kit had never diffed. The flip regenerated every set as one baseline, so every one of
// them is a declaration now; measured the same day, comparing each table's declared foreign keys,
// indexes and checks against the catalogue with no allowance at all and finding nothing on either
// side unmatched. A hand-written object reappearing in a migration fails this file, which is what
// an empty allowance list buys.
import { is, SQL, sql } from "drizzle-orm";
import {
  getTableConfig,
  SQLiteSyncDialect,
  SQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { assertSafeIdentifier } from "../testing/identifiers.js";
import { useVenueDb } from "../testing/venue-db.js";
import { enumCheck } from "./columns.js";
import * as barrel from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

const dialect = new SQLiteSyncDialect();

/**
 * Every table a module exports.
 *
 * `deployment`, `mirror_config` and `node_membership` used to be handed in separately, because a
 * hand-written `--custom` migration created them and they were kept out of the barrel. The flip
 * brought all three into it (`./index.js`), so listing them again here would declare each table
 * twice — a duplicate case per table, and an inventory comparison that never matches.
 */
function tablesIn(module: Record<string, unknown>): SQLiteTable[] {
  return Object.values<unknown>(module).filter((value): value is SQLiteTable =>
    is(value, SQLiteTable),
  );
}

/**
 * Every column declared with a closed vocabulary, table name and all, in declaration order.
 *
 * This is what a `pgEnum` declaration became. PostgreSQL held the permitted values as a TYPE, which
 * could be read back out of `pg_enum` label by label; SQLite has no such type, and `enumText`
 * carries the values in TypeScript while `enumCheck` puts the same array into a `check()`
 * constraint at each table (`./columns.ts`). So the question "can the application write a value the
 * database refuses, or the other way round?" is now asked of the constraint.
 */
function vocabularyColumns(tables: SQLiteTable[]): { table: string; column: SQLiteColumn }[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns
      .filter((column) => column.enumValues !== undefined)
      .map((column) => ({ table: config.name, column: column as SQLiteColumn }));
  });
}

// Reloads the declarations INSIDE the calling test. The comparisons below would read the same
// values without this; what it changes is whether the MUTATION run ever runs them. A drizzle
// declaration executes when its module loads, not while a test runs, so Stryker's `perTest`
// coverage credits each of those mutants to whatever test happened to be running when the module
// first loaded — in a whole-package run, some unrelated file's test, which is then the only test
// the mutant is run against. Re-importing in the test body puts the declaration's execution inside
// the test.
async function reload(): Promise<SQLiteTable[]> {
  vi.resetModules();
  const fresh: Record<string, unknown> = await import("./index.js");
  return tablesIn(fresh);
}

const declared: SQLiteTable[] = tablesIn(barrel);
const declaredVocabulary = vocabularyColumns(declared);

/**
 * A declared fragment as text, refusing one that renders with bind parameters.
 *
 * A placeholder can never equal what the database stored, so a fragment carrying one would fail the
 * comparison with a `?` in the diff and no hint about why. `enumCheck` calls `.inlineParams()` for
 * exactly this reason (`./columns.ts`); a helper such as `eq(column, false)` does not, and a
 * declaration using one has to be rewritten as an inline `sql` template before it can be compared.
 * The refusal names the fragment so the message points at the declaration rather than at this file.
 */
function render(what: string, fragment: SQL): string {
  const query = dialect.sqlToQuery(fragment);
  if (query.params.length > 0) {
    throw new Error(
      `${what} renders with bind parameters (${query.sql}); write it as an inline sql\`…\` ` +
        `template so it can be compared with the statement the migration stored`,
    );
  }
  return query.sql;
}

/**
 * The default the declaration asks the DATABASE for, in the words the database renders it back in
 * — `undefined` where it asks for none. A default drizzle computes in JavaScript (`$defaultFn`) is
 * one the database does not hold, so it reads as none here.
 */
function declaredDefault(column: SQLiteColumn): string | undefined {
  if (!column.hasDefault || column.defaultFn !== undefined) return undefined;
  const value = column.default;
  if (value === undefined) return undefined;
  if (is(value, SQL)) return unquote(render(`a column default on ${column.name}`, value));
  if (typeof value === "object") return unquote(JSON.stringify(value));
  return unquote(String(value));
}

/**
 * Drops the quotes around a stored literal: `pragma table_info` reports a text default as
 * `'Europe/Madrid'` and a numeric one as `1`.
 *
 * Blind to a default whose own text contains a quote, which SQLite would store doubled. No column
 * in this schema has one, and the comparison is symmetric, so such a default would fail visibly on
 * one side rather than pass wrongly.
 */
function unquote(expression: string): string {
  return expression.replace(/^'([\s\S]*)'$/, "$1");
}

interface TableShape {
  readonly name: string;
  readonly columns: Record<string, { type: string; notNull: boolean; default?: string }>;
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly indexes: readonly string[];
  readonly checks: readonly string[];
}

/**
 * One index, in the form both sides are put into: `[unique ]name(columns)[ filtered]`.
 *
 * Unique CONSTRAINTS and unique INDEXES share this list, where PostgreSQL kept them apart. They are
 * the same object on SQLite: drizzle-kit emits `create unique index` for `unique()` and for
 * `uniqueIndex()` alike (both appear in `drizzle/0000_baseline.sql` in that one form), and
 * `pragma index_list` reports both with `origin = 'c'`. Nothing observable separates them, so
 * nothing here tries to.
 */
function indexEntry(unique: boolean, name: string, columns: readonly string[], filtered: boolean) {
  return `${unique ? "unique " : ""}${name}(${columns.join(",")})${filtered ? " filtered" : ""}`;
}

function fromDeclaration(table: SQLiteTable): TableShape {
  const config = getTableConfig(table);
  const columns: Record<string, { type: string; notNull: boolean; default?: string }> = {};
  for (const column of config.columns) {
    const value = declaredDefault(column);
    columns[column.name] = {
      // `pragma table_info` reports the type as written in the CREATE statement, which drizzle-kit
      // wrote from this same call, differing only in case.
      type: column.getSQLType().toLowerCase(),
      notNull: column.notNull,
      ...(value === undefined ? {} : { default: value }),
    };
  }
  const primaryKey = [
    ...config.columns.filter((column) => column.primary).map((column) => column.name),
    ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
  ].sort();
  const foreignKeys = config.foreignKeys
    .map((key) => {
      const reference = key.reference();
      const target = getTableConfig(reference.foreignTable);
      // The two referential actions are part of the key: dropping `onDelete: "restrict"` turns a
      // refused delete into one the engine performs. A key that declares neither gets the SQL
      // default, which is `no action`.
      const actions = `on delete ${key.onDelete ?? "no action"} on update ${key.onUpdate ?? "no action"}`;
      return `${reference.columns.map((column) => column.name).join(",")} -> ${target.name}(${reference.foreignColumns.map((column) => column.name).join(",")}) ${actions}`;
    })
    .sort();
  const indexes = [
    ...config.indexes.map((index) => {
      const { name, unique, columns: parts, where } = index.config;
      // A part is either one of the table's columns or a raw SQL expression, and SQLite reports an
      // expression part as a null column name. So an index over an EXPRESSION is compared by name,
      // uniqueness and the POSITION of the expression among its columns — never by what the
      // expression says. `incidents_open_dedup` is the one such index in this package; changing its
      // `case … end` moves nothing here. That gap is the PostgreSQL version's unchanged, which
      // recorded it for the same reason. An index FILTER is a different thing and is compared in
      // full, below.
      const columnNames = parts.map((part) =>
        "name" in part ? String(part.name) : "(expression)",
      );
      return indexEntry(unique === true, name, columnNames, where !== undefined);
    }),
    ...config.uniqueConstraints.map((constraint) => {
      // Drizzle lets a `unique()` go unnamed and drizzle-kit derives a name for the migration.
      // This file compares by the name both sides SAY, and it does not know the derived one, so
      // an unnamed constraint is refused here rather than compared against a guess. No
      // declaration in this package has one.
      if (constraint.name === undefined) {
        throw new Error(`${config.name} declares an unnamed unique constraint; give it a name`);
      }
      return indexEntry(
        true,
        constraint.name,
        constraint.columns.map((column) => column.name),
        false,
      );
    }),
    ...config.columns
      .filter((column) => column.isUnique)
      .map((column) => indexEntry(true, column.uniqueName ?? "", [column.name], false)),
  ].sort();
  const checks = config.checks.map((check) => check.name).sort();
  return { name: config.name, columns, primaryKey, foreignKeys, indexes, checks };
}

/** The CREATE statement SQLite stored for one object, or `undefined` when it holds none. */
function ddlOf(db: Database, type: "table" | "index", name: string): string | undefined {
  const [row] = db.all<{ sql: string | null }>(
    sql`select sql from sqlite_master where type = ${type} and name = ${name}`,
  );
  return row?.sql ?? undefined;
}

/**
 * Every named check constraint in a CREATE TABLE statement, keyed by name, as the text between the
 * parentheses of its `CHECK(…)`.
 *
 * SQLite has no catalogue of check constraints at all — no pragma reports one, and there is no
 * counterpart to `pg_constraint`. The stored statement is the only record, so this READS TEXT. Two
 * consequences worth knowing before trusting it: an ANONYMOUS check, written without a
 * `CONSTRAINT <name>` clause, is invisible to it (this schema has none — all 69 checks in
 * `drizzle/0000_baseline.sql` are named, and an unnamed one would surface as a table whose declared
 * check count exceeds what this returns); and the parentheses are balanced by scanning, skipping
 * anything inside a quote, so a check is read correctly only while the engine keeps writing the
 * statement back the way it was given.
 */
function checksInDdl(ddl: string): Record<string, string> {
  const found: Record<string, string> = {};
  const opening = /CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(ddl)) !== null) {
    found[match[1]!] = balancedFrom(ddl, opening.lastIndex);
  }
  return found;
}

/**
 * The text from `start` up to the `)` closing the parenthesis that was just opened, ignoring
 * parentheses inside a quoted string or a quoted identifier.
 */
function balancedFrom(text: string, start: number): string {
  let depth = 1;
  let quote: string | undefined;
  let at = start;
  for (; at < text.length && depth > 0; at++) {
    const character = text[at]!;
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
  }
  return text.slice(start, at - 1);
}

/**
 * The filter on one index — the `where` clause of its CREATE INDEX — or the empty string when it
 * has none.
 *
 * Read from the stored statement for the reason `checksInDdl` states: `pragma index_list` reports
 * only THAT an index is partial, never what it filters on. The column list is skipped by balancing
 * its parentheses, which is what keeps an expression index containing its own parentheses
 * (`incidents_open_dedup`, a `case … end`) from being mistaken for the end of the list.
 */
function indexFilterInDdl(ddl: string): string {
  const listOpens = ddl.indexOf("(");
  if (listOpens < 0) return "";
  const afterList = ddl.slice(listOpens + 1 + balancedFrom(ddl, listOpens + 1).length + 1);
  const where = /^\s*WHERE\s+/i.exec(afterList);
  return where === null ? "" : afterList.slice(where[0].length).trim();
}

interface ColumnRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
}

interface IndexRow {
  name: string;
  unique: number;
  /** `c` for a CREATE INDEX, `u` for an inline UNIQUE, `pk` for the index behind a primary key. */
  origin: string;
  partial: number;
}

interface IndexColumnRow {
  seqno: number;
  /** `null` where the indexed part is an expression rather than a column. */
  name: string | null;
}

/**
 * A pragma with the table name written into it.
 *
 * SQLite binds no identifier — `pragma table_info(?)` is a syntax error — so the name arrives as
 * text or not at all, which is the case `CLAUDE.md` §3 allows and `assertSafeIdentifier` is the
 * "validate and throw" half of. The names reaching here come from this package's own declarations
 * and from `sqlite_master`.
 */
function pragmaRows<T>(db: Database, pragma: string, name: string): T[] {
  return db.all<T>(sql.raw(`pragma ${pragma}("${assertSafeIdentifier("table", name)}")`));
}

function fromDatabase(db: Database, name: string): TableShape {
  const ddl = ddlOf(db, "table", name);
  if (ddl === undefined) throw new Error(`no CREATE TABLE stored for ${name}`);
  const columnRows = pragmaRows<ColumnRow>(db, "table_info", name);
  const columns: Record<string, { type: string; notNull: boolean; default?: string }> = {};
  for (const column of columnRows)
    columns[column.name] = {
      type: column.type.toLowerCase(),
      notNull: column.notnull === 1,
      ...(column.dflt_value === null ? {} : { default: unquote(column.dflt_value) }),
    };
  // `pk` is the column's 1-based position in the primary key, and 0 for a column outside it.
  const primaryKey = columnRows
    .filter((column) => column.pk > 0)
    .map((column) => column.name)
    .sort();
  // One row per COLUMN of a key, so a composite key arrives as several rows sharing an `id` and
  // ordered by `seq`. Reading each row as a key of its own would turn one two-column key into two
  // one-column ones.
  const byKey = new Map<number, ForeignKeyRow[]>();
  for (const row of pragmaRows<ForeignKeyRow>(db, "foreign_key_list", name)) {
    const group = byKey.get(row.id) ?? [];
    group.push(row);
    byKey.set(row.id, group);
  }
  const foreignKeys = [...byKey.values()]
    .map((group) => {
      const parts = [...group].sort((left, right) => left.seq - right.seq);
      const first = parts[0]!;
      // `to` is null where a key names no target column, which means the parent's primary key.
      // Every key in this schema names one, so a null here is a difference worth seeing rather
      // than one worth resolving.
      const target = parts.map((part) => part.to ?? "(parent primary key)").join(",");
      return `${parts.map((part) => part.from).join(",")} -> ${first.table}(${target}) on delete ${first.on_delete.toLowerCase()} on update ${first.on_update.toLowerCase()}`;
    })
    .sort();
  // The index SQLite builds for a primary key is that key's, and is compared above. Everything
  // else is an index some declaration asked for by name.
  const indexes = pragmaRows<IndexRow>(db, "index_list", name)
    .filter((index) => index.origin !== "pk")
    .map((index) => {
      const parts = pragmaRows<IndexColumnRow>(db, "index_info", index.name)
        .sort((left, right) => left.seqno - right.seqno)
        .map((part) => part.name ?? "(expression)");
      return indexEntry(index.unique === 1, index.name, parts, index.partial === 1);
    })
    .sort();
  const checks = Object.keys(checksInDdl(ddl)).sort();
  return { name, columns, primaryKey, foreignKeys, indexes, checks };
}

describe("every closed vocabulary a column declares reaches the database", () => {
  it("declares at least one", () => {
    expect(declaredVocabulary.length).toBeGreaterThan(0);
  });

  it.each(
    declaredVocabulary.map(
      ({ table, column }, index) => [`${table}.${column.name}`, index] as const,
    ),
  )("%s", async (_name, index) => {
    const vocabulary = vocabularyColumns(await reload());
    expect(vocabulary).toHaveLength(declaredVocabulary.length);
    const { table, column } = vocabulary[index]!;
    const ddl = ddlOf(suite.db, "table", table);
    expect(ddl).toBeDefined();
    // The values IN ORDER, because `enumCheck` renders them in the order the declaration lists
    // them: a value dropped, added, changed or moved changes this text. Asked of the built
    // constraints as a set rather than by name, because what matters is that SOME constraint
    // holds this column to these values, not which one.
    //
    // The case this block exists for, and the control that says the table comparison below cannot
    // reach it: a vocabulary column carrying NO constraint — a new `enumText` column whose
    // `enumCheck` was never written, then migrated. Measured 2026-09-22 by removing
    // `locations_order_flow_ck` from the declaration AND from `drizzle/0000_baseline.sql`
    // together: the `locations` table case PASSED, because "declared none, built none" agrees,
    // and only this case failed. On PostgreSQL the column's TYPE carried the vocabulary and no
    // such hole existed.
    expect(Object.values(checksInDdl(ddl!))).toContain(
      render(`the vocabulary on ${table}.${column.name}`, enumCheck(column)),
    );
  });
});

describe("the drizzle schema matches the database the core migrations build", () => {
  it("declares every table the core migrations build", () => {
    // An inventory, not a count. A count only says how many declarations there are, so a table
    // dropped from the schema barrel takes its own case away with it and the suite goes green with
    // fewer cases than before — which is how a missing table would arrive.
    const built = suite.db.all<{ name: string }>(
      // `glob` rather than `like`: LIKE treats `_` as a wildcard, and every name here is full of
      // them. `sqlite_*` is the engine's own bookkeeping, `__drizzle_migrations*` the per-package
      // journals.
      sql`
        select name from sqlite_master
        where type = 'table'
          and name not glob 'sqlite_*'
          and name not glob '__drizzle_migrations*'
      `,
    );
    expect(declared.map((table) => getTableConfig(table).name).sort()).toEqual(
      built.map((row) => row.name).sort(),
    );
  });

  it.each(declared.map((table, index) => [getTableConfig(table).name, index] as const))(
    "%s",
    async (_name, index) => {
      const tables = await reload();
      expect(tables).toHaveLength(declared.length);
      // Every column spells its database name out. Left empty, drizzle derives the name from the
      // property key instead, which reads as a declared name while declaring none — and a derived
      // name would move if the `casing` option ever changed.
      const config = getTableConfig(tables[index]!);
      expect(
        config.columns.filter((column) => column.keyAsName).map((column) => column.name),
      ).toEqual([]);
      const shape = fromDeclaration(tables[index]!);
      expect(fromDatabase(suite.db, shape.name)).toEqual(shape);
      // The shape above compares check constraints by NAME and indexes by name and columns. This
      // compares what each declared one SAYS: a permitted value dropped from a list, a bound
      // moved, a comparison flipped, or an index given a filter that leaves out rows the migration
      // indexes — none of which move a name.
      const builtChecks = checksInDdl(ddlOf(suite.db, "table", shape.name)!);
      expect(
        Object.fromEntries(
          config.checks.map((check) => [
            check.name,
            render(`the check ${check.name}`, check.value),
          ]),
        ),
      ).toEqual(
        Object.fromEntries(config.checks.map((check) => [check.name, builtChecks[check.name]])),
      );
      const declaredFilters = config.indexes.filter(
        (declaredIndex) => declaredIndex.config.where !== undefined,
      );
      expect(
        Object.fromEntries(
          declaredFilters.map((declaredIndex) => [
            declaredIndex.config.name,
            render(`the filter on index ${declaredIndex.config.name}`, declaredIndex.config.where!),
          ]),
        ),
      ).toEqual(
        Object.fromEntries(
          declaredFilters.map((declaredIndex) => [
            declaredIndex.config.name,
            indexFilterInDdl(ddlOf(suite.db, "index", declaredIndex.config.name) ?? ""),
          ]),
        ),
      );
    },
  );
});
