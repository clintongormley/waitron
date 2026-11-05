import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ALL_MODULES } from "@waitron/composition";
import { installChangeFeed, openVenueDatabase } from "@waitron/db";
import {
  applyMigrations,
  migrationOptionsFor,
  type VenueMigrationOptions,
} from "@waitron/migrations";
import { orderedMigrationSets, type WaitronModule } from "@waitron/module";
import type { SchemaListEntry, SchemaListFile } from "./compare.js";
import { readSchema } from "./read-schema.js";

export const COMPOSITIONS = ["fiscal-verifactu", "fiscal-none"] as const;
export const PHASES = ["sql-only", "migrated", "change-feed"] as const;
const DATABASES = ["venue", "node"] as const;
type DatabaseName = (typeof DATABASES)[number];

export interface DatabaseChecks {
  readonly foreignKeys: number;
  /** Null for `sql-only`, which is not opened through the product connection. */
  readonly recursiveTriggers: number | null;
  readonly integrity: readonly string[];
  readonly foreignKeyViolations: number;
}

export interface BuiltSchemaListEntry extends SchemaListEntry {
  readonly checks: DatabaseChecks;
}

export interface BuiltSchemaListFile extends SchemaListFile {
  readonly entries: readonly BuiltSchemaListEntry[];
}

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

interface SetPlan {
  readonly name: string;
  readonly database: DatabaseName;
  readonly folder: string;
  readonly table: string;
  readonly journal: readonly JournalEntry[];
}

interface CompositionPlan {
  readonly modules: readonly WaitronModule[];
  readonly options: VenueMigrationOptions[];
  readonly sets: readonly SetPlan[];
}

/** Every module except the other module filling the fiscal slot. */
function modulesFor(composition: string): WaitronModule[] {
  const fiscal = ALL_MODULES.filter((module) => module.fiscal !== undefined).map((m) => m.name);
  if (!fiscal.includes(composition)) {
    throw new Error(`No fiscal module named ${composition}; the fiscal modules are ${fiscal}`);
  }
  return ALL_MODULES.filter((module) => module.fiscal === undefined || module.name === composition);
}

function planFor(composition: string, migrationRoot: string | null): CompositionPlan {
  const modules = modulesFor(composition);
  const sets = orderedMigrationSets(modules);
  if (sets.length === 0) throw new Error(`No migration sets for ${composition}`);
  const options = migrationOptionsFor(sets, migrationRoot);
  const plans = sets.map((set, index) => {
    const option = options[index];
    if (option === undefined || option.migrationsTable !== set.table) {
      throw new Error(`Migration options do not line up with the sets at ${set.name}`);
    }
    const journal = JSON.parse(
      readFileSync(join(option.migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: JournalEntry[] };
    return {
      name: set.name,
      database: set.database ?? "venue",
      folder: option.migrationsFolder,
      table: set.table,
      journal: journal.entries,
    };
  });
  return { modules, options, sets: plans };
}

function objectKeys(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        "select type, name from sqlite_schema where type in ('table','view','index','trigger')",
      )
      .all() as { type: string; name: string }[]
  ).map((row) => `${row.type} ${row.name}`);
}

function rawChecks(db: DatabaseSync): Omit<DatabaseChecks, "recursiveTriggers"> {
  const pragma = (name: string) =>
    Number(Object.values(db.prepare(`pragma ${name}`).get() as object)[0]);
  return {
    foreignKeys: pragma("foreign_keys"),
    integrity: (db.prepare("pragma integrity_check").all() as Record<string, string>[]).map((row) =>
      String(Object.values(row)[0]),
    ),
    foreignKeyViolations: db.prepare("pragma foreign_key_check").all().length,
  };
}

function assertSound(label: string, checks: DatabaseChecks, product: boolean): void {
  const wrong: string[] = [];
  if (checks.foreignKeys !== 1) wrong.push(`foreign_keys=${checks.foreignKeys}`);
  if (product && checks.recursiveTriggers !== 1) {
    wrong.push(`recursive_triggers=${checks.recursiveTriggers}`);
  }
  if (checks.integrity.length !== 1 || checks.integrity[0] !== "ok") {
    wrong.push(`integrity_check=${JSON.stringify(checks.integrity)}`);
  }
  if (checks.foreignKeyViolations !== 0) {
    wrong.push(`foreign_key_check rows=${checks.foreignKeyViolations}`);
  }
  if (wrong.length > 0) throw new Error(`${label}: ${wrong.join(", ")}`);
}

function journalsOf(plan: readonly SetPlan[]): Record<string, unknown> {
  return Object.fromEntries(
    plan.map((set) => [set.name, set.journal.map(({ tag, when }) => ({ tag, when }))]),
  );
}

/** Applies each set's SQL files straight onto `node:sqlite`, one transaction per set. */
function buildSqlOnly(
  dir: string,
  plan: readonly SetPlan[],
): { owningSet: Record<string, string>; schema: Map<DatabaseName, BuiltPart> } {
  mkdirSync(dir, { recursive: true });
  const owningSet: Record<string, string> = {};
  const connections = new Map<DatabaseName, DatabaseSync>(
    DATABASES.map((name) => [name, new DatabaseSync(join(dir, `${name}.db`))]),
  );
  try {
    for (const db of connections.values()) db.exec("pragma foreign_keys = on");
    for (const set of plan) {
      const db = connections.get(set.database);
      if (db === undefined) throw new Error(`Set ${set.name} names an unknown database`);
      const before = new Set(objectKeys(db));
      db.exec("begin");
      try {
        for (const entry of set.journal) {
          const text = readFileSync(join(set.folder, `${entry.tag}.sql`), "utf8");
          for (const statement of text.split("--> statement-breakpoint")) {
            if (statement.trim() !== "") db.exec(statement);
          }
        }
        db.exec("commit");
      } catch (error) {
        db.exec("rollback");
        throw new Error(`sql-only: set ${set.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      for (const key of objectKeys(db)) if (!before.has(key)) owningSet[key] = set.name;
    }
    const schema = new Map<DatabaseName, BuiltPart>();
    for (const [name, db] of connections) {
      const { foreignKeys, integrity, foreignKeyViolations } = rawChecks(db);
      const recorded: DatabaseChecks = {
        foreignKeys,
        recursiveTriggers: null,
        integrity,
        foreignKeyViolations,
      };
      assertSound(`sql-only ${name}`, recorded, false);
      schema.set(name, { checks: recorded, read: readPart(db) });
    }
    return { owningSet, schema };
  } finally {
    for (const db of connections.values()) db.close();
  }
}

interface BuiltPart {
  readonly checks: DatabaseChecks;
  readonly read: Pick<SchemaListEntry, "schema" | "bookkeepingRows"> & { keys: string[] };
}

function readPart(db: DatabaseSync, plan: readonly SetPlan[] = []): BuiltPart["read"] {
  const tables = new Set(
    (
      db.prepare("select name from sqlite_schema where type = 'table'").all() as { name: string }[]
    ).map((row) => row.name),
  );
  const bookkeepingRows: Record<string, number> = {};
  for (const set of plan) {
    if (!tables.has(set.table)) continue;
    const row = db.prepare(`select count(*) as n from "${set.table}"`).get() as { n: number };
    bookkeepingRows[set.name] = Number(row.n);
  }
  return { schema: readSchema(db), bookkeepingRows, keys: objectKeys(db) };
}

/** Reads the pragmas on the connection the product writes through, then the file as a whole. */
async function readProduct(dir: string, plan: readonly SetPlan[], label: string) {
  const store = await openVenueDatabase(dir);
  const settings = new Map<DatabaseName, { foreignKeys: number; recursiveTriggers: number }>();
  try {
    for (const name of DATABASES) {
      const handle = store[name];
      const pragma = async (setting: string) =>
        handle.withWriteLock(async () => {
          const rows = handle.all(`pragma ${setting}`) as Record<string, unknown>[];
          return Number(Object.values(rows[0] ?? {})[0]);
        });
      settings.set(name, {
        foreignKeys: await pragma("foreign_keys"),
        recursiveTriggers: await pragma("recursive_triggers"),
      });
    }
  } finally {
    await store.close();
  }
  const parts = new Map<DatabaseName, BuiltPart>();
  for (const name of DATABASES) {
    const db = new DatabaseSync(join(dir, `${name}.db`), { readOnly: true });
    try {
      const { integrity, foreignKeyViolations } = rawChecks(db);
      const product = settings.get(name);
      if (product === undefined) throw new Error(`${label}: no settings read for ${name}`);
      const checks: DatabaseChecks = { ...product, integrity, foreignKeyViolations };
      assertSound(`${label} ${name}`, checks, true);
      parts.set(name, {
        checks,
        read: readPart(
          db,
          plan.filter((set) => set.database === name),
        ),
      });
    } finally {
      db.close();
    }
  }
  return parts;
}

function ownersFor(
  keys: readonly string[],
  sqlOwners: Readonly<Record<string, string>>,
  plan: readonly SetPlan[],
  installer: string,
): Record<string, string> {
  const bookkeeping = new Map(plan.map((set) => [`table ${set.table}`, set.name]));
  return Object.fromEntries(
    keys.map((key) => [key, sqlOwners[key] ?? bookkeeping.get(key) ?? installer]),
  );
}

/**
 * Builds every composition's databases under `workDir` and lists each phase's protections. The
 * change feed is installed from the composition's own modules' `changes`.
 */
export async function buildSchemaListFile(options: {
  migrationRoot: string | null;
  workDir: string;
}): Promise<BuiltSchemaListFile> {
  const entries: BuiltSchemaListEntry[] = [];
  for (const composition of COMPOSITIONS) {
    const {
      modules,
      options: migrationOptions,
      sets: plan,
    } = planFor(composition, options.migrationRoot);
    const common = {
      composition,
      setOrder: plan.map((set) => set.name),
      journals: journalsOf(plan),
    };
    const sqlOnly = buildSqlOnly(join(options.workDir, composition, "sql-only"), plan);
    const push = (
      phase: string,
      parts: Map<DatabaseName, BuiltPart>,
      owningSet: (keys: string[]) => Record<string, string>,
    ) => {
      for (const database of DATABASES) {
        const part = parts.get(database);
        if (part === undefined) throw new Error(`${composition} ${phase}: no ${database} read`);
        const { keys, ...read } = part.read;
        entries.push({
          ...common,
          phase,
          database,
          ...read,
          owningSet: owningSet(keys),
          checks: part.checks,
        });
      }
    };
    push("sql-only", sqlOnly.schema, (keys) => ownersFor(keys, sqlOnly.owningSet, [], "sql-only"));

    const productDir = join(options.workDir, composition, "product");
    await applyMigrations(productDir, migrationOptions);
    const migrated = await readProduct(productDir, plan, `${composition} migrated`);
    push("migrated", migrated, (keys) =>
      ownersFor(keys, sqlOnly.owningSet, plan, "applyMigrations"),
    );

    const sources = modules.flatMap((module) => module.changes ?? []);
    const store = await openVenueDatabase(productDir);
    try {
      await store.venue.withWriteLock(() => installChangeFeed(store.venue, sources));
    } finally {
      await store.close();
    }
    const feed = await readProduct(productDir, plan, `${composition} change-feed`);
    push("change-feed", feed, (keys) =>
      ownersFor(keys, sqlOnly.owningSet, plan, "installChangeFeed"),
    );
  }
  return { entries };
}
