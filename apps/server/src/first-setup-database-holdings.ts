import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manifestSets } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import {
  executeTarget,
  openImmutableWhenWalEmpty,
  quoteIdent,
  type FirstSetupRoots,
} from "@waitron/provisioning";
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

// Reasons are log-only codes: they never carry a path or a value read from the database.
const notReady = (reason: string): never => {
  throw new AppError("setup.not_ready", {}, { reason });
};
const codeOf = (error: unknown) => {
  const { code, errcode } = (error ?? {}) as { code?: unknown; errcode?: unknown };
  return [code ?? "unknown", errcode].filter((part) => part !== undefined).join(" ");
};

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
  let failed = false;
  try {
    const journal = await lstat(`${database}-journal`).then(
      () => true,
      (error: unknown) =>
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? false
          : notReady(`journal check failed: ${codeOf(error)}`),
    );
    // Opening the original in place avoids the copy: Start again is the way out of a nearly full disk.
    const opened = journal ? ({ kind: "wal" } as const) : await openImmutableWhenWalEmpty(database);
    if (opened.kind === "failed")
      notReady(`database unreadable: ${opened.stage} ${codeOf(opened.error)}`);
    else if (opened.kind === "open") connection = opened.connection;
    else {
      scratch = await mkdtemp(join(tmpdir(), "waitron-setup-holdings-")).catch((error: unknown) =>
        notReady(`copy failed: ${codeOf(error)}`),
      );
      const present = await copyVenueFiles(roots.venueDir, scratch, () =>
        notReady("copy refused: not a plain file"),
      ).catch((error: unknown) =>
        error instanceof AppError
          ? Promise.reject(error)
          : notReady(`copy failed: ${codeOf(error)}`),
      );
      if (!present) notReady("database missing");
      // Read-write so SQLite can roll back a leftover -journal; `query_only` refuses any other write.
      connection = new DatabaseSync(join(scratch, "venue.db"));
      connection.exec("pragma query_only = 1");
    }
    return await readHoldings(connection!, modules);
  } catch (error) {
    failed = true;
    if (error instanceof AppError && error.code === "setup.not_ready") throw error;
    // A module seat's own reason is free text, so only its code is passed on.
    return notReady(`read failed: ${error instanceof AppError ? error.code : codeOf(error)}`);
  } finally {
    try {
      connection?.close();
    } finally {
      if (scratch !== undefined)
        // After a failed read, that failure stays the reason.
        await rm(scratch, { recursive: true, force: true }).catch((error: unknown) =>
          failed ? undefined : notReady(`copy not removed: ${codeOf(error)}`),
        );
    }
  }
}

async function readHoldings(
  connection: DatabaseSync,
  modules: readonly WaitronModule[],
): Promise<SetupDatabaseHoldings> {
  const target = executeTarget(connection);
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
      if (initialSetup.startAgainHistory === undefined)
        notReady(`history reader missing: ${module.name}`);
      history[module.name] = await initialSetup.startAgainHistory!(target);
    }
  }
  return { rows, kept, records, accepted, history };
}
