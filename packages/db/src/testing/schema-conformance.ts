// A reusable suite comparing the drizzle table declarations one migration set is supposed to build
// with the database that set actually builds: table name, column names and SQL types, nullability,
// column defaults, primary keys, foreign keys with the actions they take on delete and on update,
// unique and non-unique indexes with their columns and their filters, and check constraints by name
// AND by what they say. Plus every closed vocabulary a column declares, and one rule the database
// cannot state: every column spells its own name out rather than letting drizzle derive one from
// the property key.
//
// WHAT ELSE IN THE TREE CHECKS THE SCHEMA, so that the gap this file fills is the real one.
// `scripts/schema-constraints.test.ts` builds every migration set in the tree and holds the
// database it gets to three HAND-WRITTEN lists: foreign keys by child table, child columns and
// parent TABLE; unique indexes by name; check constraints by name. It fails on a list entry the
// schema is MISSING, so an object the schema has and the list does not is not its business. And
// `schema-ownership.test.ts`, which several packages carry — this suite's callers `payments`,
// `workforce` and `workforce-es` among them — checks the table names a barrel exports against a
// hand-written list of the tables that package owns, and that its generated SQL creates each of
// them. What neither of them reads SYSTEMATICALLY is a column's own definition or what an object
// SAYS: a renamed or retyped column, a nullability or a default that moved, a referential action
// dropped, a foreign key pointing at the wrong parent COLUMN, an index's columns or its filter, a
// non-unique index, and the BODY of a check constraint. Those are what this file compares.
// "Systematically" is the word doing the work in that sentence, and the parent COLUMN is why: two
// ownership suites name one by hand in their generated SQL — `references working_orders(id)`
// and `references sales(id)` at `packages/payments/src/schema-ownership.test.ts`,
// `references sales(id)` and `references tills(id)` at
// `packages/fiscal-verifactu/src/schema-ownership.test.ts`. Four keys, written out one at a time,
// and no rule that the next one gets a line.
//
// WHICH TABLES THE SUBJECT SET BUILT, derived and never hand-listed. A module's database also holds
// its prerequisites' tables, so "every table in the database" is the right inventory only for a set
// that has none. `useVenueDb` applies the sets it is handed and THEN calls `setup`, so the
// prerequisites are handed to it as its `migrations` and the SUBJECT alone is migrated inside
// `setup`: a list of the table names, then the subject set, then a second list. The difference is
// the subject's. A set with no prerequisites hands `useVenueDb` an empty list, takes its first
// reading of an unmigrated database and follows the same code path.
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
// where PostgreSQL rewrote `in (…)` into `= ANY (ARRAY[…])` on both sides and hid it. The
// measurement that established this was taken over the core set and is recorded at that caller.
//
// There is NO allowance list here: no foreign key, index or check may be created by a migration
// while no declaration holds it. A hand-written object appearing in a migration therefore fails
// this suite. Why the three lists the core caller used to carry went, and the measurement that said
// nothing was given up with them, are recorded at that caller.
import { is, SQL, sql } from "drizzle-orm";
import {
  getTableConfig,
  SQLiteSyncDialect,
  SQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../client.js";
import { enumCheck } from "../schema/columns.js";
import { assertSafeIdentifier } from "./identifiers.js";
import {
  applyMigrationSet,
  migratedTableNames,
  useVenueDb,
  type VenueMigrationSet,
} from "./venue-db.js";

export interface SchemaConformanceOptions {
  /** Sets that must migrate BEFORE the subject, in order. Omitted for a set that has none. */
  readonly prerequisites?: readonly VenueMigrationSet[];
  /** The migration set whose tables are under test. */
  readonly subject: VenueMigrationSet;
  /**
   * The set's name as the suite's own case names say it — `core`, `catalogue`. It names the SET,
   * not the package, and it is read by whoever reads a failure.
   */
  readonly subjectName: string;
  /** The barrel holding the declarations that set is supposed to build. */
  readonly declarations: Record<string, unknown>;
  /**
   * Whether any column in this set is declared with a closed vocabulary — the `enumText`/`enumCheck`
   * pair in `../schema/columns.ts`, which holds a column to a fixed list of values.
   *
   * Stated by the caller and then checked, rather than counted from the declarations, because the
   * block below is a list of one case per such column: a set that has none leaves it empty, and an
   * empty list of cases is indistinguishable from a passing one. Required rather than defaulted, so
   * that a set losing its last vocabulary has to say so here.
   */
  readonly declaresClosedVocabularies: boolean;
  /**
   * Re-imports that same barrel from INSIDE a test. Omitted, the cases read the `declarations` the
   * caller already passed, and nothing is re-imported.
   *
   * It is here for the MUTATION run, and `packages/db` is the only caller that collects one
   * (`packages/db/stryker.config.json`, the one `coverageAnalysis: "perTest"` config among these
   * callers). A drizzle declaration executes when its module LOADS, not while a test runs, so
   * `perTest` coverage credits each of those mutants to whichever test happened to be running when
   * the module first loaded — in a whole-package run, some unrelated file's test, which is then the
   * only test the mutant is ever run against. Re-importing inside the test body, after a
   * `vi.resetModules()`, puts the declaration's execution inside the test. It buys nothing in a
   * package that runs no mutation, where it is a module-registry reset and a re-import per case.
   *
   * Must be an arrow written in the CALLING module: a relative specifier resolves against the
   * module it is written in, never the one that calls it.
   */
  readonly reload?: () => Promise<Record<string, unknown>>;
  /**
   * Override when this suite's own setup — the prerequisite sets, the subject, and the append-only
   * triggers of each — is slower than `useVenueDb`'s default budget. Passed straight through to it.
   */
  readonly timeoutMs?: number;
}

const dialect = new SQLiteSyncDialect();

/** Every table a barrel exports. */
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
 * constraint at each table (`../schema/columns.ts`). So the question "can the application write a
 * value the database refuses, or the other way round?" is now asked of the constraint.
 */
function vocabularyColumns(tables: SQLiteTable[]): { table: string; column: SQLiteColumn }[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns
      .filter((column) => column.enumValues !== undefined)
      .map((column) => ({ table: config.name, column: column as SQLiteColumn }));
  });
}

// The declared tables a case compares, re-read inside the case where the caller asked for that.
// Both answers hold the same values; which one a caller wants, and why, is at `reload` above.
async function reloadTables(
  reload: SchemaConformanceOptions["reload"],
  alreadyRead: SQLiteTable[],
): Promise<SQLiteTable[]> {
  if (reload === undefined) return alreadyRead;
  vi.resetModules();
  return tablesIn(await reload());
}

/**
 * A declared fragment as text, refusing one that renders with bind parameters.
 *
 * A placeholder can never equal what the database stored, so a fragment carrying one would fail the
 * comparison with a `?` in the diff and no hint about why. `enumCheck` calls `.inlineParams()` for
 * exactly this reason (`../schema/columns.ts`); a helper such as `eq(column, false)` does not, and
 * a declaration using one has to be rewritten as an inline `sql` template before it can be
 * compared. The refusal names the fragment so the message points at the declaration rather than at
 * this file.
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
 * It strips one outer pair and decodes nothing inside, so it cannot tell an apostrophe SQLite
 * escaped by doubling from two apostrophes that were really there. What that costs is not a drift
 * going unnoticed; it is the comparison happening over the stored TEXT rather than over the value.
 * Measured 2026-09-23 on `node:sqlite` (Node v26.7.0), a table created with
 * `note text default 'a''b'` — a default whose value SQLite hands back on a real insert is `a'b`,
 * with one apostrophe — read back through `pragma table_info` as `'a''b'` and arriving here as
 * `a''b`:
 *
 * - a declaration asking for that value the natural way, `.default("a'b")`, arrives as `a'b` and
 *   FAILS against it, so a schema that is actually in step reports a difference;
 * - a declaration written `.default("a''b")`, which asks drizzle for a different string, arrives as
 *   `a''b` and PASSES.
 *
 * A real drift is still caught: the same declaration against a table built `default 'a''c'` failed.
 *
 * The blindness is inherited rather than introduced: `unquote` and the comparison around it are
 * the pre-branch file's, byte-identical (`git show 127e40ba6:packages/db/src/schema/
 * schema-conformance.test.ts`). Nothing in the tree hits it today, checked 2026-09-23 from both
 * ends: of the 125 `.default(` call sites in non-test `.ts` files under `packages/` and `apps/`,
 * none has an apostrophe anywhere on its line, and of the 36 quoted defaults in the generated
 * migration SQL under every package's own drizzle directory, none holds an escaped apostrophe (the
 * one hit for a doubled quote is `DEFAULT ''`, the empty string). Both greps read one LINE at a
 * time, so a default whose text is assembled across several lines is outside them; and this suite
 * runs over whatever set it is given, so neither is a promise about a set written tomorrow.
 */
function unquote(expression: string): string {
  return expression.replace(/^'([\s\S]*)'$/, "$1");
}

export interface TableShape {
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
 * `uniqueIndex()` alike (both appear that one way in a generated baseline), and `pragma index_list`
 * reports both with `origin = 'c'`. Nothing observable separates them, so nothing here tries to.
 */
function indexEntry(unique: boolean, name: string, columns: readonly string[], filtered: boolean) {
  return `${unique ? "unique " : ""}${name}(${columns.join(",")})${filtered ? " filtered" : ""}`;
}

export function fromDeclaration(table: SQLiteTable): TableShape {
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
      // expression says. The core set's `incidents_open_dedup` is one such index; changing its
      // `case … end` moves nothing here. That gap is the PostgreSQL version's unchanged, which
      // recorded it for the same reason. An index FILTER is a different thing and is compared in
      // full, below.
      const columnNames = parts.map((part) =>
        "name" in part ? String(part.name) : "(expression)",
      );
      return indexEntry(unique === true, name, columnNames, where !== undefined);
    }),
    ...config.uniqueConstraints.map((constraint) => {
      // The narrowing the TYPE asks for: `UniqueConstraint.name` is declared `name?: string`
      // (`drizzle-orm/sqlite-core/unique-constraint.d.ts`). No declaration reaches the throw on
      // drizzle-orm 0.45.2 — the constructor fills an omitted name in with a derived one, measured
      // by declaring `unique().on(b)` on a probe table and reading `getTableConfig`, which
      // answered `probe_b_unique` where an unnamed constraint would have answered `undefined`.
      // The case beside this file pins that reading, so the day it changes something fails. Kept
      // rather than deleted because this suite compares by the name both sides SAY: a constraint
      // that did arrive unnamed would otherwise be compared under a guessed name and fail the
      // index comparison with nothing in the diff about why.
      /* v8 ignore start */
      if (constraint.name === undefined) {
        throw new Error(`${config.name} declares an unnamed unique constraint; give it a name`);
      }
      /* v8 ignore stop */
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
 * consequences worth knowing before trusting it. An ANONYMOUS check, written without a
 * `CONSTRAINT <name>` clause, is invisible to it; whether a given set has one is a fact about that
 * set, and an anonymous check would surface as a table whose declared check count exceeds what this
 * returns. And the parentheses are balanced by scanning, skipping anything inside a quote, so a
 * check is read correctly only while the engine keeps writing the statement back the way it was
 * given.
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
 * its parentheses, which is what keeps an expression index containing its own parentheses (the core
 * set's `incidents_open_dedup`, a `case … end`) from being mistaken for the end of the list.
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
 * A pragma with an object's name written into it.
 *
 * SQLite binds no identifier — `pragma table_info(?)` is a syntax error — so the name arrives as
 * text or not at all, which is the case `CLAUDE.md` §3 allows and `assertSafeIdentifier` is the
 * "validate and throw" half of. The names reaching here come from the declarations the caller
 * handed over and from `sqlite_master`. `kind` is what a refusal calls the name, and it is not
 * always a table: `index_info` takes an index's.
 */
function pragmaRows<T>(db: Database, pragma: string, kind: "table" | "index", name: string): T[] {
  return db.all<T>(sql.raw(`pragma ${pragma}("${assertSafeIdentifier(kind, name)}")`));
}

/** One table as the database holds it: the shape compared below, and its check bodies. */
export interface BuiltTable {
  readonly shape: TableShape;
  /**
   * Each named check constraint's body, keyed by name, parsed from the same stored CREATE TABLE
   * the shape was read from. Handed back rather than re-read, because the shape compares a check by
   * NAME and the case below compares what it SAYS: two readings of one unchanged text.
   */
  readonly checks: Record<string, string>;
}

export function fromDatabase(db: Database, name: string): BuiltTable {
  const ddl = ddlOf(db, "table", name);
  if (ddl === undefined) throw new Error(`no CREATE TABLE stored for ${name}`);
  const columnRows = pragmaRows<ColumnRow>(db, "table_info", "table", name);
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
  for (const row of pragmaRows<ForeignKeyRow>(db, "foreign_key_list", "table", name)) {
    const group = byKey.get(row.id) ?? [];
    group.push(row);
    byKey.set(row.id, group);
  }
  const foreignKeys = [...byKey.values()]
    .map((group) => {
      const parts = [...group].sort((left, right) => left.seq - right.seq);
      const first = parts[0]!;
      // `to` is null where a key names no target column, which means the parent's primary key.
      // Written out as `(parent primary key)` rather than resolved against the parent, so such a
      // key arrives as a difference worth seeing rather than one quietly reconciled.
      const target = parts.map((part) => part.to ?? "(parent primary key)").join(",");
      return `${parts.map((part) => part.from).join(",")} -> ${first.table}(${target}) on delete ${first.on_delete.toLowerCase()} on update ${first.on_update.toLowerCase()}`;
    })
    .sort();
  // The index SQLite builds for a primary key is that key's, and is compared above. Everything
  // else is an index some declaration asked for by name.
  const indexes = pragmaRows<IndexRow>(db, "index_list", "table", name)
    .filter((index) => index.origin !== "pk")
    .map((index) => {
      const parts = pragmaRows<IndexColumnRow>(db, "index_info", "index", index.name)
        .sort((left, right) => left.seqno - right.seqno)
        .map((part) => part.name ?? "(expression)");
      return indexEntry(index.unique === 1, index.name, parts, index.partial === 1);
    })
    .sort();
  const checks = checksInDdl(ddl);
  return {
    shape: { name, columns, primaryKey, foreignKeys, indexes, checks: Object.keys(checks).sort() },
    checks,
  };
}

/**
 * Applies the subject set to a database its prerequisites have already migrated, and answers with
 * the tables the SUBJECT built: the names present afterwards that were not present before.
 *
 * Separate from the suite below, and exported, so the subtraction can be driven directly against a
 * database whose starting point the caller chose. Through the suite it runs once, in `setup`.
 */
export async function stageSubjectTables(
  db: Database,
  subject: VenueMigrationSet,
): Promise<string[]> {
  const before = new Set(migratedTableNames(db));
  await applyMigrationSet(db, subject);
  return migratedTableNames(db).filter((name) => !before.has(name));
}

/**
 * Declares the whole suite for one migration set. Call it at the top level of a `.test.ts` file:
 * the declared tables are read when that module loads, which is what puts the per-table case list
 * in front of Vitest at collect time.
 */
export function describeSchemaConformance(options: SchemaConformanceOptions): void {
  const declared: SQLiteTable[] = tablesIn(options.declarations);
  const declaredVocabulary = vocabularyColumns(declared);
  // Filled by `setup` below, before any case runs. Left empty rather than undefined so that a setup
  // that somehow did not run fails the inventory case loudly instead of skipping the comparison.
  let builtTables: string[] = [];

  const suite = useVenueDb({
    // The prerequisites here and the subject NOT here: `useVenueDb` applies everything it is given
    // before calling `setup`, and `setup` is the only place a table list can be taken on each side
    // of the subject set.
    migrations: [...(options.prerequisites ?? [])],
    resetPerTest: false,
    timeoutMs: options.timeoutMs,
    setup: async (db) => {
      builtTables = await stageSubjectTables(db, options.subject);
    },
  });

  describe("every closed vocabulary a column declares reaches the database", () => {
    it("declares closed vocabularies exactly where the set says it does", () => {
      expect(declaredVocabulary.length > 0).toBe(options.declaresClosedVocabularies);
    });

    it.each(
      declaredVocabulary.map(
        ({ table, column }, index) => [`${table}.${column.name}`, index] as const,
      ),
    )("%s", async (_name, index) => {
      const vocabulary = vocabularyColumns(await reloadTables(options.reload, declared));
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
      // `enumCheck` was never written, then migrated. The table case passes, because "declared
      // none, built none" agrees, and only this case fails. The measurement is recorded at the core
      // caller. On PostgreSQL the column's TYPE carried the vocabulary and no such hole existed.
      expect(Object.values(checksInDdl(ddl!))).toContain(
        render(`the vocabulary on ${table}.${column.name}`, enumCheck(column)),
      );
    });
  });

  describe(`the drizzle schema matches the database the ${options.subjectName} migrations build`, () => {
    it(`declares every table the ${options.subjectName} migrations build`, () => {
      // An inventory, not a count. A count only says how many declarations there are, so a table
      // dropped from the schema barrel takes its own case away with it and the suite goes green with
      // fewer cases than before — which is how a missing table would arrive.
      expect(declared.map((table) => getTableConfig(table).name).sort()).toEqual(
        [...builtTables].sort(),
      );
    });

    it.each(declared.map((table, index) => [getTableConfig(table).name, index] as const))(
      "%s",
      async (_name, index) => {
        const tables = await reloadTables(options.reload, declared);
        expect(tables).toHaveLength(declared.length);
        // Every column spells its database name out. Left empty, drizzle derives the name from the
        // property key instead, which reads as a declared name while declaring none — and a derived
        // name would move if the `casing` option ever changed.
        const config = getTableConfig(tables[index]!);
        expect(
          config.columns.filter((column) => column.keyAsName).map((column) => column.name),
        ).toEqual([]);
        const shape = fromDeclaration(tables[index]!);
        const built = fromDatabase(suite.db, shape.name);
        expect(built.shape).toEqual(shape);
        // The shape above compares check constraints by NAME and indexes by name and columns. This
        // compares what each declared one SAYS: a permitted value dropped from a list, a bound
        // moved, a comparison flipped, or an index given a filter that leaves out rows the migration
        // indexes — none of which move a name, and all read off the statement `fromDatabase`
        // already parsed.
        expect(
          Object.fromEntries(
            config.checks.map((check) => [
              check.name,
              render(`the check ${check.name}`, check.value),
            ]),
          ),
        ).toEqual(
          Object.fromEntries(config.checks.map((check) => [check.name, built.checks[check.name]])),
        );
        const declaredFilters = config.indexes.filter(
          (declaredIndex) => declaredIndex.config.where !== undefined,
        );
        expect(
          Object.fromEntries(
            declaredFilters.map((declaredIndex) => [
              declaredIndex.config.name,
              render(
                `the filter on index ${declaredIndex.config.name}`,
                declaredIndex.config.where!,
              ),
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
}
