import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manifestSets } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import {
  executeTarget,
  openImmutable,
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
}

type Damage = "errcode 11" | "errcode 26" | "no such table";
/** `damaged`: some step failed as damage; `seen` holds what every other step counted. */
export type SetupDatabaseRead =
  | { kind: "read"; holdings: SetupDatabaseHoldings }
  | { kind: "damaged"; code: Damage; seen: SetupDatabaseHoldings };

// Reasons are log-only codes: they never carry a path or a value read from the database.
const notReady = (reason: string): never => {
  throw new AppError("setup.not_ready", {}, { reason });
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
 * append-only and which may be deleted is taken from every module, enabled or not.
 */
export async function readSetupDatabase(
  roots: Pick<FirstSetupRoots, "venueDir">,
  modules: readonly WaitronModule[],
): Promise<SetupDatabaseRead> {
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
      notReady(`database unreadable: ${opened.stage} ${codeOf(opened.error)}`);
    } else if (opened.kind === "open") connection = opened.connection;
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
    const { holdings: read, damage } = await readHoldings(connection!, modules);
    // What the copy shows can come from another database's -wal or journal, so the main file is
    // read alone too.
    const holdings =
      opened.kind === "wal" ? larger(read, await readMainFile(database, modules)) : read;
    if (damage === undefined) return { kind: "read", holdings };
    // Another database's journal rolled into the copy fails an intact database in the same way.
    if (journal) notReady(`journal beside a damaged read: ${damage}`);
    return { kind: "damaged", code: damage, seen: holdings };
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

const larger = (a: SetupDatabaseHoldings, b: SetupDatabaseHoldings): SetupDatabaseHoldings => ({
  rows: Math.max(a.rows, b.rows),
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
    return notReady(
      `main file read failed: ${error instanceof AppError ? error.code : codeOf(error)}`,
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
  return { holdings: { rows, kept, records, accepted }, damage };
}
