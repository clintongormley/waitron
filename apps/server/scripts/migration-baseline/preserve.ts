import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readList } from "../protection-list/cli.js";
import {
  compareSchemaLists,
  formatDifference,
  type SchemaListEntry,
  type SchemaListFile,
} from "../protection-list/compare.js";
import { readSchema } from "../protection-list/read-schema.js";
import { createdObject, normaliseSql, type CreatedObject } from "../protection-list/sql-tokens.js";

const BREAKPOINT = "--> statement-breakpoint";
/** Only `sql-only` holds what the SQL alone made; the later phases hold installers' triggers too. */
const PHASE = "sql-only";

interface OldObject extends CreatedObject {
  readonly sql: string;
  readonly rowid: number;
  readonly set: string;
}

export interface PreserveResult {
  readonly changed: boolean;
  /** One line per statement written, saying which old set its text came from. */
  readonly provenance: readonly string[];
}

const keyOf = (object: CreatedObject) => `${object.kind} ${object.name}`;

/** Engine objects and the journal tables are never part of a set's baseline. */
function isEngineOrJournal(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("__drizzle_migrations_");
}

function storedObjects(entry: SchemaListEntry): Map<string, Omit<OldObject, "set">> {
  const objects = new Map<string, Omit<OldObject, "set">>();
  const add = (
    kind: CreatedObject["kind"],
    item: { name: string; sql: string | null; rowid: number | null },
  ) => {
    if (item.sql !== null && item.rowid !== null) {
      objects.set(`${kind} ${item.name}`, {
        kind,
        name: item.name,
        sql: item.sql,
        rowid: item.rowid,
      });
    }
  };
  for (const table of entry.schema.tables) add("table", table);
  for (const view of entry.schema.views) add("view", view);
  for (const index of entry.schema.indexes) add("index", index);
  for (const trigger of entry.schema.triggers) add("trigger", trigger);
  return objects;
}

/**
 * The kept triggers' names, in `sqlite_schema` row order, for each table, timing and event: A760
 * keeps that relative order (plan risk 4).
 */
function triggerOrders(
  entry: SchemaListEntry,
  kept: ReadonlyMap<string, OldObject>,
): Map<string, string> {
  const groups = new Map<string, string[]>();
  const triggers = entry.schema.triggers
    .filter((trigger) => kept.has(`trigger ${trigger.name}`))
    .sort((a, b) => a.rowid - b.rowid);
  for (const trigger of triggers) {
    const group = `${trigger.table} ${trigger.timing} ${trigger.event}`;
    groups.set(group, [...(groups.get(group) ?? []), trigger.name]);
  }
  return new Map([...groups].map(([group, names]) => [group, names.join(", ")]));
}

/** The final stored objects of the old sets, from the one database that holds them. */
function oldObjects(reference: SchemaListFile, from: readonly string[]): Map<string, OldObject> {
  const wanted = new Set(from);
  let found: {
    where: string;
    objects: Map<string, OldObject>;
    orders: Map<string, string>;
  } | null = null;
  for (const entry of reference.entries.filter((candidate) => candidate.phase === PHASE)) {
    const stored = storedObjects(entry);
    const objects = new Map<string, OldObject>();
    for (const [key, set] of Object.entries(entry.owningSet)) {
      if (!wanted.has(set)) continue;
      const object = stored.get(key);
      if (object === undefined || isEngineOrJournal(object.name)) continue;
      objects.set(key, { ...object, set });
    }
    if (objects.size === 0) continue;
    const where = `composition=${entry.composition} database=${entry.database}`;
    const orders = triggerOrders(entry, objects);
    if (found === null) {
      found = { where, objects, orders };
      continue;
    }
    const same = (a: OldObject, b: OldObject | undefined) =>
      b !== undefined && a.sql === b.sql && a.set === b.set;
    const first = found.objects;
    const agree =
      first.size === objects.size &&
      [...first].every(([key, object]) => same(object, objects.get(key)));
    if (!agree) {
      throw new Error(
        `The reference's ${PHASE} entries disagree about ${from}: ${found.where} and ${where}`,
      );
    }
    for (const [group, names] of found.orders) {
      if (orders.get(group) !== names) {
        throw new Error(
          `The reference's ${PHASE} entries disagree about the trigger order on ${group}: ` +
            `${found.where} has ${names}, ${where} has ${orders.get(group)}`,
        );
      }
    }
  }
  const objects = found?.objects ?? new Map<string, OldObject>();
  const owners = new Set([...objects.values()].map((object) => object.set));
  for (const set of from) {
    if (!owners.has(set))
      throw new Error(`Old set ${set} owns nothing in the reference's ${PHASE} phase`);
  }
  return objects;
}

interface Statement extends CreatedObject {
  readonly sql: string;
}

function statementsOf(text: string): Statement[] {
  return text
    .split(BREAKPOINT)
    .map((chunk) => chunk.trim().replace(/;$/, ""))
    .filter((chunk) => chunk !== "")
    .map((sql) => {
      const object = createdObject(sql);
      if (object === null)
        throw new Error(`This statement creates no table, index, trigger or view: ${sql}`);
      return { ...object, sql };
    });
}

function entryOf(statements: readonly string[]): SchemaListEntry {
  const db = new DatabaseSync(":memory:");
  try {
    for (const sql of statements) db.exec(sql);
    return {
      composition: "baseline",
      phase: PHASE,
      database: "baseline",
      setOrder: [],
      journals: {},
      bookkeepingRows: {},
      owningSet: {},
      schema: readSchema(db),
    };
  } finally {
    db.close();
  }
}

/** Differences in what the generated tables and indexes enforce; a different column order is spelling. */
function meaningDeltas(generated: readonly Statement[], old: readonly OldObject[]): string[] {
  if (generated.length === 0) return [];
  return compareSchemaLists(
    { entries: [entryOf(old.map((o) => o.sql))] },
    {
      entries: [entryOf(generated.map((s) => s.sql))],
    },
  )
    .filter((difference) => !/^table [^.]+\.columnOrder$/.test(difference.object))
    .map(formatDifference);
}

/**
 * Rewrites the one generated baseline in `folder` to the old sets' final stored text: each
 * generated table and index keeps its place and takes the old text, and the old triggers and views
 * follow in the old databases' creation order. Never writes `meta/`.
 */
export function preserveBaseline(options: {
  reference: string;
  folder: string;
  from: readonly string[];
}): PreserveResult {
  const reference = readList(options.reference);
  const old = oldObjects(reference, options.from);

  const journal = JSON.parse(
    readFileSync(join(options.folder, "meta", "_journal.json"), "utf8"),
  ) as {
    entries: { tag: string }[];
  };
  if (journal.entries.length !== 1) {
    throw new Error(
      `${options.folder} holds ${journal.entries.length} migrations, not one baseline`,
    );
  }
  const file = join(options.folder, `${journal.entries[0]?.tag}.sql`);
  const text = readFileSync(file, "utf8");

  const statements = statementsOf(text);
  const isGenerated = (object: CreatedObject) => object.kind === "table" || object.kind === "index";
  const generated = statements.filter(isGenerated);
  for (const statement of statements.filter((s) => !isGenerated(s))) {
    const before = old.get(keyOf(statement));
    if (before === undefined || normaliseSql(before.sql) !== normaliseSql(statement.sql)) {
      throw new Error(`${keyOf(statement)} differs from the old one, or the old sets have none`);
    }
  }

  const oldGenerated = [...old.values()].filter(isGenerated).sort((a, b) => a.rowid - b.rowid);
  const generatedKeys = new Set(generated.map(keyOf));
  const unknown = generated.filter((s) => !old.has(keyOf(s))).map(keyOf);
  const lost = oldGenerated.filter((o) => !generatedKeys.has(keyOf(o))).map(keyOf);
  if (unknown.length > 0 || lost.length > 0) {
    throw new Error(
      [
        ...unknown.map((key) => `generated but not in the old sets: ${key}`),
        ...lost.map((key) => `in the old sets but not generated: ${key}`),
      ].join("\n"),
    );
  }
  const deltas = meaningDeltas(generated, oldGenerated);
  if (deltas.length > 0) {
    throw new Error(
      `The generated schema means something the old one does not:\n${deltas.join("\n")}`,
    );
  }

  const manual = [...old.values()].filter((o) => !isGenerated(o)).sort((a, b) => a.rowid - b.rowid);
  const written: OldObject[] = [
    ...generated.map((statement) => old.get(keyOf(statement)) as OldObject),
    ...manual,
  ];
  const result = written.map((object) => `${object.sql};`).join(`\n${BREAKPOINT}\n`);
  const changed = result !== text;
  if (changed) writeFileSync(file, result);
  return {
    changed,
    provenance: written.map((object) =>
      isGenerated(object)
        ? `${keyOf(object)}: old text from ${object.set}`
        : `${keyOf(object)}: appended from ${object.set}`,
    ),
  };
}
