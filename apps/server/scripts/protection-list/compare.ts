import type {
  SchemaIndex,
  SchemaList,
  SchemaTable,
  SchemaTrigger,
  SchemaView,
} from "./read-schema.js";
import { normaliseSql } from "./sql-tokens.js";

/** One built database: a composition, at one phase, in one database file. */
export interface SchemaListEntry {
  readonly composition: string;
  readonly phase: string;
  readonly database: string;
  readonly setOrder: readonly string[];
  readonly journals: Readonly<Record<string, unknown>>;
  /** Rows in each set's `__drizzle_migrations_<set>` table, by set. */
  readonly bookkeepingRows: Readonly<Record<string, number>>;
  /** The set that owns each object, by `<kind> <name>`. */
  readonly owningSet: Readonly<Record<string, string>>;
  readonly schema: SchemaList;
}

export interface SchemaListFile {
  readonly entries: readonly SchemaListEntry[];
}

export interface Difference {
  readonly kind: "missing" | "changed" | "extra";
  readonly composition: string;
  readonly phase: string;
  readonly database: string;
  readonly object: string;
  readonly before?: string;
  readonly after?: string;
}

const BOOKKEEPING_PREFIX = "__drizzle_migrations_";

/** A keyed collection: its keys print as `[key]`. Anything else that is not a record is one value. */
type Canonical = string | number | boolean | null | readonly unknown[] | Keyed | Fields;
type Keyed = Map<string, Canonical>;
interface Fields {
  readonly [field: string]: Canonical;
}

function sql(text: string | null): string | null {
  return text === null ? null : normaliseSql(text);
}

function keyed<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  valueOf: (entry: T) => Canonical,
): Keyed {
  const map: Keyed = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    let unique = key;
    for (let count = 2; map.has(unique); count += 1) unique = `${key}#${count}`;
    map.set(unique, valueOf(entry));
  }
  return map;
}

const foreignKeyName = (key: { from: readonly string[]; table: string }): string =>
  `${key.from.join(",")}->${key.table}`;

function canonicalTable(table: SchemaTable): Fields {
  const declaredColumns = new Map(table.declared.columns.map((column) => [column.name, column]));
  const deferrable = new Map<string, (string | null)[]>();
  for (const key of table.declared.foreignKeys) {
    const name = foreignKeyName(key);
    deferrable.set(name, [...(deferrable.get(name) ?? []), key.deferrable]);
  }
  const rows = table.rows.map((row) => JSON.stringify(row)).sort();
  return {
    type: table.type,
    strict: table.strict,
    withoutRowid: table.withoutRowid,
    autoincrement: table.autoincrement,
    columnOrder: table.columns.map((column) => column.name),
    columns: keyed(
      table.columns,
      (column) => column.name,
      (column) => {
        const declared = declaredColumns.get(column.name);
        return {
          type: column.type,
          notNull: column.notNull,
          defaultValue: sql(column.defaultValue),
          hidden: column.hidden,
          primaryKeyPosition: column.primaryKeyPosition,
          collation: declared?.collation ?? null,
          generated: sql(declared?.generated ?? null),
          notNullOnConflict: declared?.notNullOnConflict ?? null,
        };
      },
    ),
    foreignKeys: keyed(
      [...table.foreignKeys].sort((first, second) =>
        compareText(JSON.stringify(first), JSON.stringify(second)),
      ),
      foreignKeyName,
      (key) => ({
        to: key.to,
        onUpdate: key.onUpdate,
        onDelete: key.onDelete,
        match: key.match,
        deferrable: sql(deferrable.get(foreignKeyName(key))?.shift() ?? null),
      }),
    ),
    checks: keyed(
      [...table.checks].sort((first, second) =>
        compareText(normaliseSql(first.expression), normaliseSql(second.expression)),
      ),
      (check) => check.name ?? `#${normaliseSql(check.expression)}`,
      (check) => ({ expression: normaliseSql(check.expression), onConflict: check.onConflict }),
    ),
    keys: keyed(
      table.declared.keys,
      (key) => `${key.kind}(${key.columns.join(",")})`,
      (key) => ({ onConflict: key.onConflict }),
    ),
    rows: keyed(
      rows.map((row, position) => [String(position), row] as const),
      ([position]) => position,
      ([, row]) => row,
    ),
  };
}

function canonicalView(view: SchemaView): Fields {
  return {
    columnOrder: view.columns.map((column) => column.name),
    definition: sql(view.sql),
  };
}

function indexName(index: SchemaIndex): string {
  if (index.origin === "c") return index.name;
  const keyColumns = index.columns.filter((column) => column.key).map((column) => column.column);
  return `${index.table}.${index.origin === "pk" ? "primary key" : "unique"}(${keyColumns.join(",")})`;
}

function canonicalIndex(index: SchemaIndex): Fields {
  return {
    table: index.table,
    unique: index.unique,
    origin: index.origin,
    partial: index.partial,
    predicate: sql(index.predicate),
    columns: keyed(
      index.columns.map((column, position) => [String(position), column] as const),
      ([position]) => position,
      ([, column]) => ({
        column: column.column,
        expression: sql(column.expression),
        descending: column.descending,
        collation: column.collation,
        key: column.key,
      }),
    ),
  };
}

/** Only triggers that fire on the same table, timing and event run in creation order. */
function canonicalTriggers(triggers: readonly SchemaTrigger[]): Map<string, Fields> {
  const seen = new Map<string, number>();
  const result = new Map<string, Fields>();
  for (const trigger of [...triggers].sort(
    (first, second) => first.creationOrder - second.creationOrder,
  )) {
    const group = JSON.stringify([trigger.table, trigger.timing, trigger.event]);
    const order = seen.get(group) ?? 0;
    seen.set(group, order + 1);
    result.set(`trigger ${trigger.name}`, {
      table: trigger.table,
      timing: trigger.timing,
      event: trigger.event,
      updateOf: trigger.updateOf,
      when: sql(trigger.when),
      body: normaliseSql(trigger.body),
      order,
    });
  }
  return result;
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function isBookkeeping(table: string): boolean {
  return table.startsWith(BOOKKEEPING_PREFIX);
}

function objectsOf(schema: SchemaList): Map<string, Canonical> {
  const objects = new Map<string, Canonical>();
  for (const table of schema.tables) {
    if (!isBookkeeping(table.name)) objects.set(`table ${table.name}`, canonicalTable(table));
  }
  for (const view of schema.views) objects.set(`view ${view.name}`, canonicalView(view));
  for (const index of schema.indexes) {
    if (!isBookkeeping(index.table))
      objects.set(`index ${indexName(index)}`, canonicalIndex(index));
  }
  const triggers = canonicalTriggers(
    schema.triggers.filter((trigger) => !isBookkeeping(trigger.table)),
  );
  for (const [name, trigger] of triggers) objects.set(name, trigger);
  return new Map([...objects].sort(([first], [second]) => compareText(first, second)));
}

function printed(value: Canonical): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isFields(value: Canonical): value is Fields {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Map)
  );
}

type Found = { kind: Difference["kind"]; object: string; before?: string; after?: string };

function diff(
  path: string,
  before: Canonical,
  after: Canonical,
  found: Found[],
  extras: Found[],
): void {
  if (before instanceof Map && after instanceof Map) {
    for (const [key, value] of before) {
      const other = after.get(key);
      if (other === undefined) found.push({ kind: "missing", object: `${path}[${key}]` });
      else diff(`${path}[${key}]`, value, other, found, extras);
    }
    for (const key of after.keys()) {
      if (!before.has(key)) extras.push({ kind: "extra", object: `${path}[${key}]` });
    }
  } else if (isFields(before) && isFields(after)) {
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diff(`${path}.${field}`, before[field] ?? null, after[field] ?? null, found, extras);
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after)) {
    found.push({ kind: "changed", object: path, before: printed(before), after: printed(after) });
  }
}

function entryKey(entry: SchemaListEntry): string {
  return JSON.stringify([entry.composition, entry.phase, entry.database]);
}

function entriesOf(file: SchemaListFile, side: string): Map<string, SchemaListEntry> {
  if (file.entries.length === 0) throw new Error(`The ${side} list has nothing to compare`);
  const entries = new Map<string, SchemaListEntry>();
  for (const entry of file.entries) {
    const objects = objectsOf(entry.schema);
    if (objects.size === 0) {
      throw new Error(
        `The ${side} list has nothing to compare for composition=${entry.composition} phase=${entry.phase} database=${entry.database}`,
      );
    }
    entries.set(entryKey(entry), entry);
  }
  return new Map([...entries].sort(([first], [second]) => compareText(first, second)));
}

/**
 * Compares the protections of every entry both ways. Set order, journals, owning sets, rowids,
 * stored `sql` and the per-set bookkeeping tables are left out, so merging sets compares equal.
 */
export function compareSchemaLists(before: SchemaListFile, after: SchemaListFile): Difference[] {
  const beforeEntries = entriesOf(before, "before");
  const afterEntries = entriesOf(after, "after");
  const differences: Difference[] = [];
  const at = (entry: SchemaListEntry, found: Found): Difference => ({
    composition: entry.composition,
    phase: entry.phase,
    database: entry.database,
    ...found,
  });
  for (const [key, entry] of beforeEntries) {
    const other = afterEntries.get(key);
    if (other === undefined) {
      differences.push(at(entry, { kind: "missing", object: `database ${entry.database}` }));
      continue;
    }
    const beforeObjects = objectsOf(entry.schema);
    const afterObjects = objectsOf(other.schema);
    const found: Found[] = [];
    const extras: Found[] = [];
    for (const [name, value] of beforeObjects) {
      const otherValue = afterObjects.get(name);
      if (otherValue === undefined) found.push({ kind: "missing", object: name });
      else diff(name, value, otherValue, found, extras);
    }
    for (const name of afterObjects.keys()) {
      if (!beforeObjects.has(name)) extras.push({ kind: "extra", object: name });
    }
    differences.push(...[...found, ...extras].map((item) => at(entry, item)));
  }
  for (const [key, entry] of afterEntries) {
    if (!beforeEntries.has(key)) {
      differences.push(at(entry, { kind: "extra", object: `database ${entry.database}` }));
    }
  }
  return differences;
}

export function formatDifference(difference: Difference): string {
  const line = `${difference.kind} ${difference.object}`;
  if (difference.kind !== "changed") return line;
  return `${line}\nold: ${difference.before ?? ""}\nnew: ${difference.after ?? ""}`;
}

/** `EQUAL` when there is nothing to report; otherwise one header per composition, phase and database. */
export function formatDifferences(differences: readonly Difference[]): string {
  if (differences.length === 0) return "EQUAL";
  const groups = new Map<string, string[]>();
  for (const difference of differences) {
    const header = `DIFF composition=${difference.composition} phase=${difference.phase} database=${difference.database}`;
    groups.set(header, [...(groups.get(header) ?? []), formatDifference(difference)]);
  }
  return [...groups].flatMap(([header, lines]) => [header, ...lines]).join("\n");
}
