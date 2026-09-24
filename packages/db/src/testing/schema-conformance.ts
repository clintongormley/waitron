// A reusable suite comparing the drizzle table declarations one migration set is supposed to build
// with the database that set actually builds: table name, column names and SQL types, nullability,
// column defaults, primary keys, foreign keys with the actions they take on delete and on update,
// unique and non-unique indexes with their columns and their filters, and check constraints by name
// AND by what they say. Plus every closed vocabulary a column declares, and one rule the database
// cannot state: every column spells its own name out rather than letting drizzle derive one from
// the property key.
//
// WHICH TABLES THE SUBJECT SET BUILT, derived and never hand-listed. A module's database also holds
// its prerequisites' tables, so "every table in the database" is the right inventory only for a set
// that has none. `useVenueDb` applies the sets it is handed and THEN calls `setup`, so the
// prerequisites are handed to it as its `migrations` and the SUBJECT alone is migrated inside
// `setup`: a list of the table names, then the subject set, then a second list. The difference is
// the subject's.
//
// HOW THE DATABASE SIDE IS READ. `pragma table_info` / `foreign_key_list` / `index_list` /
// `index_info` give the structural facts, and `sqlite_master.sql` — the CREATE statement stored
// VERBATIM as the migration wrote it — everything else. So check constraints and index filters are
// read by parsing that text, which is a real limit on this file and is stated at each parser below.
// Because drizzle-kit WROTE that statement with the same renderer this file calls, a declared
// expression and a built one are directly comparable as text, and a difference of wording alone
// fails.
//
// There is NO allowance list here: no foreign key, index or check may be created by a migration
// while no declaration holds it. A hand-written foreign key, index or named check on a table the
// subject set builds therefore fails this suite. Three things are outside it: a check with no name
// (`checksInDdl` says why), anything the set creates on a prerequisite's table, and every trigger.
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
  /**
   * The module holding the declarations that set is supposed to build — the package's schema barrel,
   * or, where it has none, the file its `drizzle.config.ts` generates from. Of its exports, only
   * the tables are read.
   */
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
   * Re-imports that same module from INSIDE a test. Omitted, the cases read the `declarations` the
   * caller already passed, and nothing is re-imported.
   *
   * It is here for a MUTATION run with `coverageAnalysis: "perTest"`. A drizzle declaration
   * executes when its module LOADS, not while a test runs, so `perTest` coverage credits each of
   * those mutants to whichever test happened to be running when the module first loaded.
   * Re-importing inside the test body, after a `vi.resetModules()`, puts the declaration's
   * execution inside the test.
   *
   * Must be an arrow written in the CALLING module: a relative specifier resolves against the
   * module it is written in, never the one that calls it.
   */
  readonly reload?: () => Promise<Record<string, unknown>>;
  /** Override when this suite's own setup is slower than `useVenueDb`'s default budget. */
  readonly timeoutMs?: number;
}

const dialect = new SQLiteSyncDialect();

function tablesIn(module: Record<string, unknown>): SQLiteTable[] {
  return Object.values<unknown>(module).filter((value): value is SQLiteTable =>
    is(value, SQLiteTable),
  );
}

/**
 * Every column declared with a closed vocabulary, table name and all, in declaration order.
 * `enumCheck` puts its values into a `check()` constraint at each table (`../schema/columns.ts`),
 * so the question "can the application write a value the database refuses, or the other way round?"
 * is asked of the constraint.
 */
function vocabularyColumns(tables: SQLiteTable[]): { table: string; column: SQLiteColumn }[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns
      .filter((column) => column.enumValues !== undefined)
      .map((column) => ({ table: config.name, column: column as SQLiteColumn }));
  });
}

async function reloadTables(
  reload: SchemaConformanceOptions["reload"],
  alreadyRead: SQLiteTable[],
): Promise<SQLiteTable[]> {
  if (reload === undefined) return alreadyRead;
  vi.resetModules();
  return tablesIn(await reload());
}

/**
 * A declared fragment as text, refusing one that renders with bind parameters: a placeholder can
 * never equal what the database stored, so a fragment carrying one would fail the comparison with a
 * `?` in the diff and no hint about why.
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
 * It strips one outer pair and decodes nothing inside, so the comparison happens over the stored
 * TEXT rather than over the value: against a table built `default 'a''b'`, a declaration asking for
 * that value the natural way, `.default("a'b")`, FAILS, and `.default("a''b")` PASSES.
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
 * Unique CONSTRAINTS and unique INDEXES share this list: drizzle-kit emits `create unique index`
 * for `unique()` and for `uniqueIndex()` alike, and `pragma index_list` reports both with
 * `origin = 'c'`.
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
      // SQLite reports an expression part as a null column name. So an index over an EXPRESSION is
      // compared by name, uniqueness and the POSITION of the expression among its columns — never
      // by what the expression says. An index FILTER is a different thing and is compared in full,
      // below.
      const columnNames = parts.map((part) =>
        "name" in part ? String(part.name) : "(expression)",
      );
      return indexEntry(unique === true, name, columnNames, where !== undefined);
    }),
    ...config.uniqueConstraints.map((constraint) => {
      // The narrowing the TYPE asks for: `UniqueConstraint.name` is declared `name?: string`. No
      // declaration reaches the throw on drizzle-orm 0.45.2, whose constructor fills an omitted
      // name in with a derived one; the case beside this file pins that reading.
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
 * No pragma reports a check constraint, so this READS TEXT. An ANONYMOUS check, written without a
 * `CONSTRAINT <name>` clause, is invisible to it. And the parentheses are balanced by scanning,
 * skipping anything inside a quote, so a check is read correctly only while the engine keeps
 * writing the statement back the way it was given.
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
 * has none. Read from the stored statement because `pragma index_list` reports only THAT an index
 * is partial, never what it filters on. The column list is skipped by balancing its parentheses, so
 * an expression index containing its own parentheses is not mistaken for the end of the list.
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
 * A pragma with an object's name written into it. SQLite binds no identifier, so the name is
 * validated and thrown on (`CLAUDE.md` §3). `kind` is what a refusal calls the name: `index_info`
 * takes an index's.
 */
function pragmaRows<T>(db: Database, pragma: string, kind: "table" | "index", name: string): T[] {
  return db.all<T>(sql.raw(`pragma ${pragma}("${assertSafeIdentifier(kind, name)}")`));
}

/** One table as the database holds it: the shape compared below, and its check bodies. */
export interface BuiltTable {
  readonly shape: TableShape;
  /**
   * Each named check constraint's body, keyed by name, parsed from the same stored CREATE TABLE
   * the shape was read from.
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
    // The subject NOT here: `setup` is the only place a table list can be taken on each side of it.
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
      // them. Asked of the built constraints as a set rather than by name, because what matters is
      // that SOME constraint holds this column to these values. The case this exists for is a new
      // `enumText` column whose `enumCheck` was never written: the table case below passes, because
      // "declared none, built none" agrees, and only this case fails.
      expect(Object.values(checksInDdl(ddl!))).toContain(
        render(`the vocabulary on ${table}.${column.name}`, enumCheck(column)),
      );
    });
  });

  describe(`the drizzle schema matches the database the ${options.subjectName} migrations build`, () => {
    it(`declares every table the ${options.subjectName} migrations build`, () => {
      // An inventory, not a count: a table dropped from the declarations takes its own case away
      // with it, so a count would go green with fewer cases.
      expect(declared.map((table) => getTableConfig(table).name).sort()).toEqual(
        [...builtTables].sort(),
      );
    });

    it.each(declared.map((table, index) => [getTableConfig(table).name, index] as const))(
      "%s",
      async (_name, index) => {
        const tables = await reloadTables(options.reload, declared);
        expect(tables).toHaveLength(declared.length);
        // Every column spells its database name out: a name drizzle derives from the property key
        // would move if the `casing` option ever changed.
        const config = getTableConfig(tables[index]!);
        expect(
          config.columns.filter((column) => column.keyAsName).map((column) => column.name),
        ).toEqual([]);
        const shape = fromDeclaration(tables[index]!);
        const built = fromDatabase(suite.db, shape.name);
        expect(built.shape).toEqual(shape);
        // The shape above compares check constraints by NAME and indexes by name and columns. This
        // compares what each declared one SAYS.
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
