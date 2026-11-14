import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { SCRATCH_DIR, VENUE_FILE, appendOnlyTriggers, JOURNAL_SUFFIX } from "@waitron/store";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manifestSets } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import {
  executeTarget,
  openImmutable,
  openImmutableWhenWalEmpty,
  openWalInPlace,
  quoteIdent,
  type FirstSetupRoots,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";

import "./errors.js";
import { ALL_MODULES } from "./modules.js";
import { copyVenueFiles } from "./venue-private-copy.js";
import { SetupDatabaseReadFailed } from "./setup-database-read-failed.js";

export interface SetupDatabaseHoldings {
  /** Every row outside SQLite's own tables, the migration journals and Litestream's tables. */
  readonly rows: number;
  /** Rows in append-only tables that no module lists in `startAgainDeletable`, plus the rows each
   * module's `startAgainKept` counts in the tables it does list. */
  readonly kept: number;
  readonly records: number;
  readonly accepted: number;
}

type Damage = "errcode 11" | "errcode 26" | "no such table";
/** `damaged`: some step failed as damage; `seen` holds what every other step counted. */
export type SetupDatabaseRead =
  | { kind: "read"; holdings: SetupDatabaseHoldings }
  | { kind: "damaged"; code: Damage; seen: SetupDatabaseHoldings };

// Reasons are log-only codes: they never carry a path or a value read from the database.
const notReady = (reason: string, cause: "unexpected" | "unreadable" = "unreadable"): never => {
  throw new AppError("setup.not_ready", { cause }, { reason });
};
const copyFailed = (error: unknown): never => {
  if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOSPC")
    throw new AppError("storage.disk_full", {});
  return readFailed(`copy failed: ${codeOf(error)}`, error);
};
const readFailed = (reason: string, failure?: unknown): never => {
  throw new SetupDatabaseReadFailed(reason, failure);
};
/**
 * SQLite's primary code 11 (corrupt) or 26 (not a database), or a table a reader expects missing
 * (a part-applied setup, a 0-byte file); anything else is not damage.
 */
const damageOf = (error: unknown): Damage | undefined => {
  const { errcode, message } = (error ?? {}) as { errcode?: unknown; message?: unknown };
  if (typeof errcode !== "number") return undefined;
  const primary = errcode & 0xff;
  if (primary === 11 || primary === 26) return `errcode ${primary}`;
  return primary === 1 && typeof message === "string" && message.startsWith("no such table")
    ? "no such table"
    : undefined;
};
const codeOf = (error: unknown) => {
  const { code, errcode } = (error ?? {}) as { code?: unknown; errcode?: unknown };
  return [code ?? "unknown", errcode].filter((part) => part !== undefined).join(" ");
};

/**
 * What the setup database holds, read without writing to the venue folder. The caller holds the
 * venue exclusion and the coordinator turn. `modules` are the attempt's modules; which tables are
 * append-only, which may be deleted and which of their rows are still kept is taken from every
 * module, enabled or not.
 */
export async function readSetupDatabase(
  roots: Pick<FirstSetupRoots, "stateDir" | "venueDir">,
  modules: readonly WaitronModule[],
): Promise<SetupDatabaseRead> {
  const database = join(roots.venueDir, VENUE_FILE);
  let scratch: string | undefined;
  let connection: DatabaseSync | undefined;
  let failed = false;
  try {
    const journal = await lstat(`${database}${JOURNAL_SUFFIX}`).then(
      () => true,
      (error: unknown) =>
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? false
          : readFailed(`journal check failed: ${codeOf(error)}`, error),
    );
    // Opening the original in place avoids a copy, which a nearly full disk may have no room for.
    const opened = journal ? ({ kind: "wal" } as const) : await openImmutableWhenWalEmpty(database);
    if (opened.kind === "failed") {
      const damage = opened.stage === "open" ? damageOf(opened.error) : undefined;
      if (damage !== undefined)
        return {
          kind: "damaged",
          code: damage,
          seen: { rows: 0, kept: 0, records: 0, accepted: 0 },
        };
      readFailed(`database unreadable: ${opened.stage} ${codeOf(opened.error)}`, opened.error);
    } else if (opened.kind === "open") connection = opened.connection;
    else {
      // In place: a copy needs disk space that grows with the database, which a full disk lacks.
      const inPlace = journal
        ? undefined
        : await openWalInPlace(database).catch((error: unknown) =>
            readFailed(`database unreadable: in place ${codeOf(error)}`, error),
          );
      if (inPlace?.kind === "not-a-file")
        return notReady("read refused: not a plain file", "unexpected");
      if (inPlace?.kind === "missing") return readFailed("database missing");
      // A copy would read no database and drop the -wal, which may hold an invoice.
      if (inPlace?.kind === "short")
        return readFailed("database unreadable: shorter than its header beside a -wal");
      if (inPlace?.kind === "open") connection = inPlace.connection;
    }
    // A -journal needs rolling back, and SQLite cannot read some -wal shapes in place: both copy.
    if (connection === undefined) {
      const parent = join(roots.stateDir, SCRATCH_DIR);
      await mkdir(parent, { recursive: true, mode: 0o700 }).catch(copyFailed);
      scratch = await mkdtemp(join(parent, "waitron-setup-holdings-")).catch(copyFailed);
      const present = await copyVenueFiles(roots.venueDir, scratch, () =>
        notReady("copy refused: not a plain file", "unexpected"),
      ).catch((error: unknown) =>
        error instanceof AppError ? Promise.reject(error) : copyFailed(error),
      );
      if (!present) readFailed("database missing");
      // Read-write so SQLite can roll back a leftover -journal; `query_only` refuses any other write.
      connection = new DatabaseSync(join(scratch, VENUE_FILE));
      connection.exec("pragma query_only = 1");
    }
    const { holdings: read, damage } = await readHoldings(connection, modules);
    // What the -wal or journal adds can come from another database, so the main file is read alone
    // too.
    const holdings =
      opened.kind === "wal" ? larger(read, await readMainFile(database, modules)) : read;
    if (damage === undefined) return { kind: "read", holdings };
    // Another database's journal rolled into the copy fails an intact database in the same way.
    if (journal) notReady(`journal beside a damaged read: ${damage}`);
    // An invoice committed only into the -wal may be unreadable through the damaged main file. A
    // read that saw kept rows or records is left to Start again's kept-records refusal, which names
    // the cause.
    if (opened.kind === "wal" && holdings.kept === 0 && holdings.records === 0)
      readFailed(`database unreadable: damaged beside a -wal: ${damage}`);
    return { kind: "damaged", code: damage, seen: holdings };
  } catch (error) {
    failed = true;
    if (
      error instanceof AppError &&
      (error.code === "setup.not_ready" || error.code === "storage.disk_full")
    )
      throw error;
    // A module seat's own reason is free text, so only its code is passed on.
    return readFailed(
      `read failed: ${error instanceof AppError ? error.code : codeOf(error)}`,
      error,
    );
  } finally {
    try {
      connection?.close();
    } finally {
      if (scratch !== undefined)
        // After a failed read, that failure stays the reason.
        await rm(scratch, { recursive: true, force: true }).catch((error: unknown) =>
          failed ? undefined : readFailed(`copy not removed: ${codeOf(error)}`, error),
        );
    }
  }
}

// `rows` stays the first read's: a database with no rows is refused, so the main file's could offer it.
const larger = (a: SetupDatabaseHoldings, b: SetupDatabaseHoldings): SetupDatabaseHoldings => ({
  rows: a.rows,
  kept: Math.max(a.kept, b.kept),
  records: Math.max(a.records, b.records),
  accepted: Math.max(a.accepted, b.accepted),
});

/** What the main file holds, its `-wal` ignored; damage counts as nothing, as in `readHoldings`. */
async function readMainFile(
  database: string,
  modules: readonly WaitronModule[],
): Promise<SetupDatabaseHoldings> {
  let connection: DatabaseSync | undefined;
  try {
    connection = openImmutable(database);
    return (await readHoldings(connection, modules)).holdings;
  } catch (error) {
    return readFailed(
      `main file read failed: ${error instanceof AppError ? error.code : codeOf(error)}`,
      error,
    );
  } finally {
    connection?.close();
  }
}

/**
 * Each step runs on its own: one that fails as damage is skipped and the rest still count, so a
 * damaged table cannot hide a record kept elsewhere. Any other failure throws.
 */
async function readHoldings(
  connection: DatabaseSync,
  modules: readonly WaitronModule[],
): Promise<{ holdings: SetupDatabaseHoldings; damage: Damage | undefined }> {
  let damage: Damage | undefined;
  const step = async <T>(read: () => T | Promise<T>, otherwise: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      const found = damageOf(error);
      if (found === undefined) throw error;
      damage ??= found;
      return otherwise;
    }
  };
  const target = executeTarget(connection);
  const schema = await step(
    () =>
      connection.prepare("select type, name, tbl_name as tableName from sqlite_schema").all() as {
        type: string;
        name: string;
        tableName: string;
      }[],
    [],
  );
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
    // SQLite counts from the smallest index unless told not to; a damaged index alone must not
    // make a readable table count as empty.
    const n = await step(
      () =>
        (
          connection
            .prepare(`select count(*) as n from ${quoteIdent(table)} not indexed`)
            .get() as {
            n: number;
          }
        ).n,
      0,
    );
    rows += n;
    if (appendOnly.has(table) && !deletable.has(table)) kept += n;
  }
  let records = 0;
  let accepted = 0;
  for (const module of modules) {
    const seat = module.provisioning?.initialSetup?.startAgainHoldings;
    if (seat !== undefined) {
      const held = await step(() => seat(target), { records: 0, accepted: 0 });
      records += held.records;
      accepted += held.accepted;
    }
  }
  // Every module, as for `deletable`; each its own step, so damage failing the holdings count
  // cannot lose these kept rows. A module the attempt does not name may never have made its
  // tables, so for it a missing table holds nothing to keep rather than being damage.
  const named = new Set(modules.map((module) => module.name));
  for (const module of ALL_MODULES) {
    const keeps = module.provisioning?.initialSetup?.startAgainKept;
    if (keeps === undefined) continue;
    const count = named.has(module.name)
      ? () => keeps(target)
      : () =>
          keeps(target).catch((error: unknown) =>
            damageOf(error) === "no such table" ? 0 : Promise.reject(error),
          );
    kept += await step(count, 0);
  }
  return { holdings: { rows, kept, records, accepted }, damage };
}
