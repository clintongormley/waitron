import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  VENUE_FILE,
  INCOMING_SUFFIX,
  NODE_FILE,
  SIDE_FILE_SUFFIXES,
  VENUE_LOCK_FILE,
  MIGRATIONS_LOCK_FILE,
  REPLACED_DATABASE_PREFIX,
} from "@waitron/store";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";
import { lstatSync } from "node:fs";
import {
  rename,
  rm,
  rmdir,
  mkdir,
  lstat,
  realpath,
  chmod,
  copyFile,
  writeFile,
  mkdtemp,
  readdir,
} from "node:fs/promises";
import { join, dirname, basename, sep } from "node:path";
import { deleteBackupRoomNote } from "./backup-room-note.js";
import { errnoOf } from "./errno.js";
import { syncFolderHolding } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { clearShutdownMark } from "./admin-shutdown-hold.js";
import { clearSelectedCopy } from "./handover-copy-selection.js";
import { clearRestartMark } from "./stop-mark.js";
import { reachDisk } from "./sync-path.js";
import "./errors.js";

/** Holds a whole SQLite venue database, the file `archiveTo` (`packages/store/src/archive.ts`) writes. */
export const DB_DUMP_NAME = "db.dump";
/** The venue file holds the whole database, the same protected content the artifact carried. */
export const VENUE_FILE_MODE = 0o600;
/**
 * Consume a closed staging file. On EXDEV its owner retains the original for cleanup.
 * Move the old main and sidecars together: a committed row may exist only in the WAL.
 * Rollback puts the main back last so it cannot open without its committed tail.
 * With `nodeDump`, the old `node.db` set goes into the same set-aside folder and the copy takes its
 * place before `venue.db` does, so a placed `venue.db` always has its own `node.db` beside it.
 */
export async function restoreDatabase(args: {
  databasePath: string;
  /** The backup's `node.db`; left out, the box keeps its own. */
  nodeDump?: Uint8Array;
  venueDir: string;
  /** The venue's own state folder, whose backup room note vouches for the `venue.db` replaced. */
  stateDir: string;
  log: Logger;
  /** Only disposable backup verification may skip flushing. */
  durable?: boolean;
  /** Tests inject failures here; production passes nothing. */
  fs?: PlacementFs;
}): Promise<string> {
  await deleteBackupRoomNote(args.stateDir);
  await clearSelectedCopy(args.stateDir);
  const fs: PlacementFs = args.fs ?? { rename, rm, rmdir };
  // The restore may be the first thing that ever writes here. An existing directory's permissions
  // belong to the operator and are not changed by mkdir.
  await mkdir(args.venueDir, { recursive: true, mode: 0o700 });
  const target = join(args.venueDir, VENUE_FILE);
  const incoming = `${target}${INCOMING_SUFFIX}`;
  const nodeTarget = join(args.venueDir, NODE_FILE);
  const nodeIncoming = `${nodeTarget}${INCOMING_SUFFIX}`;
  const source = await lstat(args.databasePath).catch((error: unknown) => {
    if (errnoOf(error) === "ENOENT") {
      throw new AppError("restore.unsafe_entry_path", { name: DB_DUMP_NAME });
    }
    throw error;
  });
  const sourceParent = await realpath(dirname(args.databasePath));
  const venueParent = await realpath(args.venueDir);
  const canonicalSource = join(sourceParent, basename(args.databasePath));
  const protectedPaths = [
    ...[target, nodeTarget].flatMap((file) =>
      ["", ...SIDE_FILE_SUFFIXES, INCOMING_SUFFIX].map((suffix) => `${file}${suffix}`),
    ),
    join(args.venueDir, VENUE_LOCK_FILE),
    join(args.venueDir, MIGRATIONS_LOCK_FILE),
  ];
  const protectedFolder =
    sourceParent === venueParent ? "" : sourceParent.slice(venueParent.length + 1).split(sep)[0];
  if (
    !source.isFile() ||
    source.nlink !== 1 ||
    (sourceParent.startsWith(`${venueParent}${sep}`) &&
      (protectedFolder === basename(litestreamMetaDir(target)) ||
        protectedFolder.startsWith(REPLACED_DATABASE_PREFIX))) ||
    protectedPaths.some((path) => {
      const info = lstatSync(path, { throwIfNoEntry: false });
      return (
        canonicalSource === join(venueParent, basename(path)) ||
        (info !== undefined && info.dev === source.dev && info.ino === source.ino)
      );
    })
  ) {
    throw new AppError("restore.unsafe_entry_path", { name: DB_DUMP_NAME });
  }
  await fs.rm(incoming, { force: true });
  if (args.nodeDump !== undefined) await fs.rm(nodeIncoming, { force: true });
  const removeIncomings = async () => {
    await removeIncoming(fs, incoming, args.log);
    if (args.nodeDump !== undefined) await removeIncoming(fs, nodeIncoming, args.log);
  };
  let aside: string;
  try {
    await (fs.chmod ?? chmod)(args.databasePath, VENUE_FILE_MODE);
    try {
      await fs.rename(args.databasePath, incoming);
    } catch (error) {
      if (errnoOf(error) !== "EXDEV") throw error;
      await (fs.copyFile ?? copyFile)(args.databasePath, incoming);
      await (fs.chmod ?? chmod)(incoming, VENUE_FILE_MODE);
    }
    if (args.durable !== false) await reachDisk(incoming);
    if (args.nodeDump !== undefined) {
      await writeFile(nodeIncoming, args.nodeDump, { mode: VENUE_FILE_MODE, flag: "wx" });
      if (args.durable !== false) await reachDisk(nodeIncoming);
    }
    await fs.rm(litestreamMetaDir(target), { recursive: true, force: true });
    await clearRestartMark(args.stateDir);
    await clearShutdownMark(args.stateDir);
    aside = await mkdtemp(join(args.venueDir, REPLACED_DATABASE_PREFIX));
  } catch (error) {
    await removeIncomings();
    throw error;
  }
  args.log("debug", "restore.db.staged");
  const replaced = args.nodeDump === undefined ? [target] : [target, nodeTarget];
  const moved: string[] = [];
  let nodePlaced = false;
  try {
    for (const member of replaced.flatMap((file) =>
      ["", ...SIDE_FILE_SUFFIXES].map((suffix) => `${file}${suffix}`),
    )) {
      const found = lstatSync(member, { throwIfNoEntry: false });
      if (found === undefined) continue;
      if (!found.isFile()) {
        // Not database content. A directory is refused here, before anything is replaced.
        await fs.rm(member, { force: true });
        continue;
      }
      await fs.rename(member, join(aside, basename(member)));
      moved.push(member);
    }
    args.log("debug", "restore.db.previous_moved");
    if (args.nodeDump !== undefined) {
      await fs.rename(nodeIncoming, nodeTarget);
      nodePlaced = true;
      args.log("debug", "restore.db.node_placed");
    }
    await fs.rename(incoming, target);
    args.log("debug", "restore.db.venue_placed");
  } catch (error) {
    // The backup's node.db never stays without its venue.db: the box's own goes back or none does.
    if (nodePlaced) await removeIncoming(fs, nodeTarget, args.log);
    const putBack = await putBackMoved(fs, moved, aside, args.log);
    await removeIncomings();
    if (moved.length === 0) throw error;
    const params =
      putBack === "all"
        ? ({ kept: "previous" } as const)
        : ({ kept: "set_aside", folder: basename(aside) } as const);
    args.log("error", "restore.db.placement_failed", {
      ...params,
      errorCode: codeOf(error),
      errno: errnoOf(error),
    });
    throw new AppError("restore.placement_failed", params);
  }
  // Publication has completed: refusing here would restore the old identity beside the new pair.
  // Keep the matching identity; durability is unconfirmed when the folder flush fails.
  if (args.durable !== false) {
    try {
      await syncFolderHolding(target);
    } catch (error) {
      args.log("error", "restore.db.folder_sync_failed", {
        folder: args.venueDir,
        errno: errnoOf(error),
      });
    }
  }
  try {
    await fs.rm(aside, { recursive: true, force: true });
  } catch (error) {
    args.log("warn", "restore.db.aside_kept", { folder: basename(aside), errno: errnoOf(error) });
  }
  args.log("info", "restore.db.placed", { bytes: source.size });
  return target;
}
/** The filesystem calls {@link restoreDatabase} makes whose failures its tests inject. */
export interface PlacementFs {
  readonly copyFile?: (from: string, to: string) => Promise<void>;
  readonly chmod?: (path: string, mode: number) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly rm: (path: string, options: { recursive?: boolean; force: boolean }) => Promise<void>;
  readonly rmdir: (path: string) => Promise<void>;
}
/**
 * Moves each member back from `aside`, the last one moved first, so the main file goes back last.
 * Stops at the first failure: a main file back WITHOUT a side file that holds committed rows opens
 * as an older database with no error, so what cannot go back keeps the main file company.
 */
async function putBackMoved(
  fs: PlacementFs,
  moved: readonly string[],
  aside: string,
  log: Logger,
): Promise<"all" | "some_left"> {
  for (const member of [...moved].reverse()) {
    try {
      await fs.rename(join(aside, basename(member)), member);
    } catch (error) {
      log("warn", "restore.db.put_back_failed", { file: basename(member), errno: errnoOf(error) });
      return "some_left";
    }
  }
  try {
    await fs.rmdir(aside);
  } catch {
    // An empty folder left behind costs nothing; the old database is back either way.
  }
  return "all";
}
/**
 * Logged, not thrown, so the error that stopped the placement is the one reported. The next
 * {@link restoreDatabase} removes a leftover incoming file, or stops, before writing its own.
 */
async function removeIncoming(fs: PlacementFs, incoming: string, log: Logger): Promise<void> {
  try {
    await fs.rm(incoming, { force: true });
  } catch (error) {
    log("warn", "restore.db.incoming_kept", { file: basename(incoming), errno: errnoOf(error) });
  }
}
/**
 * Removes the folders {@link restoreDatabase} set an old database aside into and did not remove.
 *
 * Safe only while the caller holds the venue folder: every placement holds it for its whole run
 * ({@link writeValidated}), so no placement that could still put its folder's contents back is in
 * progress. With a `venue.db` beside it, a folder's contents are a database a placement replaced:
 * {@link putBackMoved} moves the main file back last, so a folder still holding anything beside a
 * main file is one whose placement put the new file in. With no `venue.db`, a folder holding
 * anything may be the only copy of the venue's database, so it is kept and the start refused with
 * `restore.database_set_aside`; an empty one is removed.
 *
 * Only the box's entry (`node-entry.ts`) calls it, before the server opens `venue.db`; a server
 * started from `bin.ts` (the dev stack) does not. Boot cannot call it instead: boot's first open
 * creates `venue.db`, which would hide the missing-database case above.
 */
export async function clearReplacedDatabases(
  venueDir: string,
  log: Logger,
  /** Tests inject failures here; production passes nothing. */
  fs: Pick<PlacementFs, "rm"> = { rm },
): Promise<void> {
  const folders = await replacedDatabaseFolders(venueDir);
  const main = lstatSync(join(venueDir, VENUE_FILE), { throwIfNoEntry: false });
  if (main === undefined || !main.isFile()) {
    for (const folder of folders) {
      if ((await readdir(join(venueDir, folder))).length > 0) {
        throw new AppError("restore.database_set_aside", { folder });
      }
    }
  }
  for (const folder of folders) {
    try {
      await fs.rm(join(venueDir, folder), { recursive: true, force: true });
      log("info", "restore.db.aside_removed", { folder });
    } catch (error) {
      log("warn", "restore.db.aside_kept", { folder, errno: errnoOf(error) });
    }
  }
}

async function replacedDatabaseFolders(venueDir: string): Promise<string[]> {
  return (await readdir(venueDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(REPLACED_DATABASE_PREFIX))
    .map((entry) => entry.name);
}

export async function discardRestoreSetAside(venueDir: string): Promise<void> {
  for (const name of await replacedDatabaseFolders(venueDir))
    await rm(join(venueDir, name), { recursive: true, force: true });
  await syncFolderHolding(join(venueDir, VENUE_FILE));
}
