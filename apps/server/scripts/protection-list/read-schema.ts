import type { DatabaseSync } from "node:sqlite";
import { quoteIdent } from "@waitron/provisioning";
import {
  checkClausesIn,
  hasAutoincrement,
  indexParts,
  tableDeclarations,
  triggerParts,
} from "./sql-tokens.js";
import type {
  CheckClause,
  DeclaredForeignKey,
  TableDeclarations,
  TriggerParts,
} from "./sql-tokens.js";

/** Values are strings so that the list survives JSON: a 64-bit integer and Infinity do not as numbers. */
export type Cell = readonly ["null"] | readonly ["integer" | "real" | "text" | "blob", string];

export interface SchemaColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
  /** `pragma_table_xinfo`'s value: 0 normal, 1 hidden, 2 virtual generated, 3 stored generated. */
  readonly hidden: number;
  /** 0 outside the primary key, otherwise the column's 1-based place in it. */
  readonly primaryKeyPosition: number;
}

export interface SchemaForeignKey {
  readonly table: string;
  readonly from: readonly string[];
  /** A null entry means the key names no column and targets the parent's primary key. */
  readonly to: readonly (string | null)[];
  readonly onUpdate: string;
  readonly onDelete: string;
  readonly match: string;
  /** From the stored CREATE text, which is the only place it is kept. */
  readonly deferrable: string | null;
}

export interface SchemaTable {
  readonly name: string;
  readonly type: string;
  readonly strict: boolean;
  readonly withoutRowid: boolean;
  readonly autoincrement: boolean;
  readonly sql: string | null;
  readonly rowid: number;
  readonly columns: readonly SchemaColumn[];
  readonly foreignKeys: readonly SchemaForeignKey[];
  readonly checks: readonly CheckClause[];
  readonly declared: Omit<TableDeclarations, "foreignKeys">;
  readonly rows: readonly (readonly Cell[])[];
}

export interface SchemaView {
  readonly name: string;
  readonly sql: string | null;
  readonly rowid: number;
  readonly columns: readonly SchemaColumn[];
}

export interface SchemaIndexColumn {
  readonly column: string | null;
  /** The key's SQL when it is an expression; `column` is then null. */
  readonly expression: string | null;
  readonly descending: boolean;
  readonly collation: string;
  /** False for the columns the engine appends to find the row. */
  readonly key: boolean;
}

export interface SchemaIndex {
  readonly name: string;
  readonly table: string;
  readonly unique: boolean;
  readonly origin: string;
  readonly partial: boolean;
  readonly predicate: string | null;
  readonly columns: readonly SchemaIndexColumn[];
  readonly sql: string | null;
  /** Null for a WITHOUT ROWID table's primary key, which the engine keeps no catalogue row for. */
  readonly rowid: number | null;
}

export interface SchemaTrigger extends TriggerParts {
  readonly name: string;
  readonly table: string;
  /** 0 for the first created on its table. */
  readonly creationOrder: number;
  readonly sql: string;
  readonly rowid: number;
}

export interface SchemaList {
  readonly tables: readonly SchemaTable[];
  readonly views: readonly SchemaView[];
  readonly indexes: readonly SchemaIndex[];
  readonly triggers: readonly SchemaTrigger[];
}

interface CatalogueRow {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
  readonly rowid: number;
}

function all<T>(db: DatabaseSync, sql: string, ...parameters: string[]): T[] {
  return db.prepare(sql).all(...parameters) as T[];
}

function byName(first: { name: string }, second: { name: string }): number {
  return first.name < second.name ? -1 : first.name > second.name ? 1 : 0;
}

function readColumns(db: DatabaseSync, table: string): SchemaColumn[] {
  return all<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    hidden: number;
    pk: number;
  }>(db, "SELECT * FROM pragma_table_xinfo(?, 'main') ORDER BY cid", table).map((column) => ({
    name: column.name,
    type: column.type,
    notNull: column.notnull === 1,
    defaultValue: column.dflt_value,
    hidden: column.hidden,
    primaryKeyPosition: column.pk,
  }));
}

/** The engine folds only ASCII letters when it compares names. */
function foldedName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Everything the engine reports about a key and the CREATE text states too. MATCH is left out:
 * the engine reports every key's as NONE, whatever the text says.
 */
function definitionOf(key: {
  table: string;
  from: readonly string[];
  to: readonly (string | null)[];
  onUpdate: string;
  onDelete: string;
}): string {
  return JSON.stringify([
    foldedName(key.table),
    key.from.map(foldedName),
    key.to.map((name) => (name === null ? null : foldedName(name))),
    key.onUpdate,
    key.onDelete,
  ]);
}

function readForeignKeys(
  db: DatabaseSync,
  table: string,
  declared: readonly DeclaredForeignKey[],
): SchemaForeignKey[] {
  const rows = all<{
    id: number;
    table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
    match: string;
  }>(db, "SELECT * FROM pragma_foreign_key_list(?, 'main') ORDER BY id, seq", table);
  const keys = new Map<number, { head: (typeof rows)[number]; parts: typeof rows }>();
  for (const row of rows) {
    const key = keys.get(row.id);
    if (key === undefined) keys.set(row.id, { head: row, parts: [row] });
    else key.parts.push(row);
  }
  const unclaimed = declared.map((key) => ({
    definition: definitionOf({
      ...key,
      to: key.to.length === 0 ? key.from.map(() => null) : key.to,
    }),
    deferrable: key.deferrable,
  }));
  const read = [...keys.values()].map(({ head, parts }) => {
    const key = {
      table: head.table,
      from: parts.map((part) => part.from),
      to: parts.map((part) => part.to),
      onUpdate: head.on_update,
      onDelete: head.on_delete,
      match: head.match,
    };
    const definition = definitionOf(key);
    const claimed = unclaimed.findIndex((candidate) => candidate.definition === definition);
    const declaration = unclaimed[claimed];
    if (declaration === undefined) {
      throw new Error(`Could not find where ${table} declares its foreign key ${definition}`);
    }
    unclaimed.splice(claimed, 1);
    return { ...key, deferrable: declaration.deferrable };
  });
  if (unclaimed.length > 0) {
    throw new Error(
      `${table} declares a foreign key the engine does not report: ${unclaimed[0]?.definition}`,
    );
  }
  return read;
}

/**
 * Each value is read with its type and fetched so nothing is lost on the way to JavaScript: a
 * driver number would blur an integer past 2^53, and a decoded string would hide invalid UTF-8.
 */
function readRows(db: DatabaseSync, table: string, columns: readonly SchemaColumn[]): Cell[][] {
  const selected = columns.map(({ name }, position) => {
    const column = quoteIdent(name);
    return `typeof(${column}) AS t${position}, CASE typeof(${column}) WHEN 'integer' THEN CAST(${column} AS TEXT) WHEN 'text' THEN CAST(${column} AS BLOB) ELSE ${column} END AS v${position}`;
  });
  const rows = all<Record<string, string | number | Uint8Array | null>>(
    db,
    `SELECT ${selected.join(", ")} FROM main.${quoteIdent(table)}`,
  );
  return rows.map((row) =>
    columns.map(({ name }, position): Cell => {
      const type = row[`t${position}`];
      const value = row[`v${position}`];
      if (type === "integer") return ["integer", value as string];
      if (type === "real") {
        return ["real", Object.is(value, -0) ? "-0" : String(value as number)];
      }
      if (type === "blob") return ["blob", Buffer.from(value as Uint8Array).toString("hex")];
      if (type === "text") {
        const bytes = Buffer.from(value as Uint8Array);
        const text = bytes.toString("utf8");
        if (!Buffer.from(text, "utf8").equals(bytes)) {
          throw new Error(
            `Text in ${table}.${name} is not valid UTF-8, so its bytes would be lost`,
          );
        }
        return ["text", text];
      }
      return ["null"];
    }),
  );
}

function readIndexes(
  db: DatabaseSync,
  table: string,
  catalogue: ReadonlyMap<string, CatalogueRow>,
): SchemaIndex[] {
  const list = all<{ name: string; unique: number; origin: string; partial: number }>(
    db,
    "SELECT * FROM pragma_index_list(?, 'main')",
    table,
  );
  return list.map((index) => {
    const stored =
      index.origin === "pk" && !catalogue.has(`index:${index.name}`)
        ? { sql: null, rowid: null }
        : catalogueRow(catalogue, "index", index.name);
    const parts = stored.sql === null ? null : indexParts(stored.sql);
    const columns = all<{
      seqno: number;
      cid: number;
      name: string | null;
      desc: number;
      coll: string;
      key: number;
    }>(db, "SELECT * FROM pragma_index_xinfo(?, 'main') ORDER BY seqno", index.name).map(
      (column) => {
        const isExpression = column.cid === -2;
        const term = parts?.keyTerms[column.seqno];
        if (isExpression && term === undefined) {
          throw new Error(`Could not read the expression of index ${index.name}`);
        }
        return {
          column: column.name,
          expression: isExpression ? (term as string) : null,
          descending: column.desc === 1,
          collation: column.coll,
          key: column.key === 1,
        };
      },
    );
    return {
      name: index.name,
      table,
      unique: index.unique === 1,
      origin: index.origin,
      partial: index.partial === 1,
      predicate: parts?.predicate ?? null,
      columns,
      sql: stored.sql,
      rowid: stored.rowid,
    };
  });
}

function catalogueRow(
  catalogue: ReadonlyMap<string, CatalogueRow>,
  type: string,
  name: string,
): CatalogueRow {
  const row = catalogue.get(`${type}:${name}`);
  if (row === undefined) throw new Error(`${type} ${name} is not in sqlite_schema`);
  return row;
}

function readTriggers(catalogue: ReadonlyMap<string, CatalogueRow>): SchemaTrigger[] {
  const stored = [...catalogue.values()]
    .filter((row) => row.type === "trigger")
    .sort((first, second) => first.rowid - second.rowid);
  const seenOnTable = new Map<string, number>();
  const triggers = stored.map((row) => {
    const creationOrder = seenOnTable.get(row.tbl_name) ?? 0;
    seenOnTable.set(row.tbl_name, creationOrder + 1);
    return {
      ...triggerParts(row.sql as string),
      name: row.name,
      table: row.tbl_name,
      creationOrder,
      sql: row.sql as string,
      rowid: row.rowid,
    };
  });
  return triggers.sort(
    (first, second) =>
      byName({ name: first.table }, { name: second.table }) ||
      first.creationOrder - second.creationOrder,
  );
}

/** Lists the `main` schema. `sqlite_schema` itself is left out: its rows are what this list reports. */
export function readSchema(db: DatabaseSync): SchemaList {
  const catalogue = new Map(
    all<CatalogueRow>(db, "SELECT type, name, tbl_name, sql, rowid FROM main.sqlite_schema").map(
      (row) => [`${row.type}:${row.name}`, row],
    ),
  );
  const listed = all<{ name: string; type: string; wr: number; strict: number }>(
    db,
    "SELECT * FROM pragma_table_list WHERE schema = 'main' AND name <> 'sqlite_schema'",
  ).sort(byName);

  const tables: SchemaTable[] = [];
  const views: SchemaView[] = [];
  const indexes: SchemaIndex[] = [];
  for (const entry of listed) {
    const columns = readColumns(db, entry.name);
    if (entry.type === "view") {
      const { sql, rowid } = catalogueRow(catalogue, "view", entry.name);
      views.push({ name: entry.name, sql, rowid, columns });
      continue;
    }
    const { sql, rowid } = catalogueRow(catalogue, "table", entry.name);
    const plainDdl = entry.type === "virtual" || sql === null ? null : sql;
    const { foreignKeys, ...declared } =
      plainDdl === null ? { columns: [], keys: [], foreignKeys: [] } : tableDeclarations(plainDdl);
    tables.push({
      name: entry.name,
      type: entry.type,
      strict: entry.strict === 1,
      withoutRowid: entry.wr === 1,
      autoincrement: plainDdl !== null && hasAutoincrement(plainDdl),
      sql,
      rowid,
      columns,
      foreignKeys: readForeignKeys(db, entry.name, foreignKeys),
      checks: plainDdl === null ? [] : checkClausesIn(plainDdl),
      declared,
      rows: readRows(db, entry.name, columns),
    });
    indexes.push(...readIndexes(db, entry.name, catalogue));
  }
  return { tables, views, indexes: indexes.sort(byName), triggers: readTriggers(catalogue) };
}
