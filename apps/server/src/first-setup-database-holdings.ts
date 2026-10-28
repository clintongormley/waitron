import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Database } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { quoteIdent, type FirstSetupRoots } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { appendOnlyTriggers } from "@waitron/store";
import "./errors.js";
import { ALL_MODULES } from "./modules.js";
import { copyVenueFiles } from "./venue-private-copy.js";

export interface SetupDatabaseHoldings {
  /** Every row outside SQLite's own tables, the migration journals and Litestream's tables. */
  readonly rows: number;
  /** Rows in append-only tables that no module lists in `startAgainDeletable`. */
  readonly kept: number;
  readonly records: number;
  readonly accepted: number;
  /** Each module that sets Start again's floor, with what its `startAgainHistory` read. */
  readonly history: Readonly<Record<string, readonly unknown[]>>;
}

const notReady = (): never => {
  throw new AppError("setup.not_ready", {});
};

async function size(path: string): Promise<number | null> {
  try {
    return (await lstat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * What the setup database holds, read without writing to the venue folder. The caller holds the
 * venue exclusion and the coordinator turn. `modules` are the attempt's modules; which tables are
 * append-only and which may be deleted is taken from every module, enabled or not.
 */
export async function readSetupDatabaseHoldings(
  roots: Pick<FirstSetupRoots, "venueDir">,
  modules: readonly WaitronModule[],
): Promise<SetupDatabaseHoldings> {
  const database = join(roots.venueDir, "venue.db");
  let scratch: string | undefined;
  let connection: DatabaseSync | undefined;
  try {
    const wal = await size(`${database}-wal`);
    const journal = await size(`${database}-journal`);
    if ((wal === null || wal === 0) && journal === null) {
      // An immutable open ignores the -wal, so it is only taken when the -wal holds nothing. It
      // avoids the copy: Start again is the way out of a nearly full disk.
      const url = pathToFileURL(database);
      url.searchParams.set("immutable", "1");
      connection = new DatabaseSync(url, { readOnly: true });
    } else {
      scratch = await mkdtemp(join(tmpdir(), "waitron-setup-holdings-"));
      if (!(await copyVenueFiles(roots.venueDir, scratch, notReady))) notReady();
      connection = new DatabaseSync(join(scratch, "venue.db"), { readOnly: true });
    }
    return await readHoldings(connection, modules);
  } catch {
    return notReady();
  } finally {
    try {
      connection?.close();
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function readHoldings(
  connection: DatabaseSync,
  modules: readonly WaitronModule[],
): Promise<SetupDatabaseHoldings> {
  const dialect = new SQLiteSyncDialect();
  const target: Pick<Database, "execute"> = {
    execute<Row extends Record<string, unknown>>(query: SQLWrapper | string) {
      const compiled =
        typeof query === "string" ? { sql: query, params: [] } : dialect.sqlToQuery(query.getSQL());
      return {
        rows: connection
          .prepare(compiled.sql)
          .all(...(compiled.params as SQLInputValue[])) as Row[],
      };
    },
  };
  const schema = connection
    .prepare("select type, name, tbl_name as tableName from sqlite_schema")
    .all() as { type: string; name: string; tableName: string }[];
  const sets = manifestSets();
  const journals = new Set(sets.map((set) => set.table));
  const tables = schema
    .filter(({ type }) => type === "table")
    .map(({ name }) => name)
    .filter(
      (name) =>
        !name.startsWith("sqlite_") && !name.startsWith("_litestream_") && !journals.has(name),
    );
  const triggers = new Set(
    schema
      .filter(({ type }) => type === "trigger")
      .map(({ name, tableName }) => `${tableName}/${name}`),
  );
  const appendOnly = new Set(sets.flatMap((set) => set.appendOnlyTables));
  for (const table of tables) {
    let names: string[];
    try {
      names = appendOnlyTriggers([table]).map(({ name }) => name);
    } catch {
      // Not a plain name, so no append-only trigger was ever installed under it.
      continue;
    }
    if (names.some((name) => triggers.has(`${table}/${name}`))) appendOnly.add(table);
  }
  const deletable = new Set(ALL_MODULES.flatMap((module) => module.startAgainDeletable ?? []));
  let rows = 0;
  let kept = 0;
  for (const table of tables) {
    const { n } = connection.prepare(`select count(*) as n from ${quoteIdent(table)}`).get() as {
      n: number;
    };
    rows += n;
    if (appendOnly.has(table) && !deletable.has(table)) kept += n;
  }
  let records = 0;
  let accepted = 0;
  const history: Record<string, readonly unknown[]> = {};
  for (const module of modules) {
    const initialSetup = module.provisioning?.initialSetup;
    if (initialSetup?.startAgainHoldings !== undefined) {
      const held = await initialSetup.startAgainHoldings(target);
      records += held.records;
      accepted += held.accepted;
    }
    if (initialSetup?.startAgainFloor !== undefined) {
      if (initialSetup.startAgainHistory === undefined) notReady();
      history[module.name] = await initialSetup.startAgainHistory!(target);
    }
  }
  return { rows, kept, records, accepted, history };
}
