import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beginHolding, endHolding } from "./venue-liveness.js";

/**
 * The file whose lock stands for the whole venue folder. It holds no data. Never unlink it: a
 * second process opening the path after an unlink takes a fresh lock beside the holder.
 */
export const VENUE_LOCK_FILE = "venue.lock";

/** SQLite's `SQLITE_BUSY`, which `node:sqlite` puts on the thrown error's `errcode`. */
const SQLITE_BUSY = 5;

/** Whether the engine refused because another connection holds the lock. */
export const isLocked = (error: unknown): boolean =>
  (error as { errcode?: number }).errcode === SQLITE_BUSY;

/** Closes a connection where the failure being handled is the one the caller has to see. */
export const closeQuietly = (connection: DatabaseSync): void => {
  try {
    connection.close();
  } catch {
    // Already closed, or closing is what failed; either way the original error is the useful one.
  }
};

/** Another process holds the venue folder. `@waitron/db` reports it as `provisioning.database_in_use`. */
export class VenueInUseError extends Error {
  readonly directory: string;
  constructor(directory: string) {
    super(`another process holds the venue folder ${directory}`);
    this.name = "VenueInUseError";
    this.directory = directory;
  }
}

export interface VenueLock {
  /** Gives up this holder's share. Idempotent. The last share closes the lock. */
  release(): void;
}

interface Holder {
  connection: DatabaseSync;
  shares: number;
}

/** One entry per folder this process holds, keyed by its real path. */
const holders = new Map<string, Holder>();

function takeFileLock(path: string, directory: string): DatabaseSync {
  let connection: DatabaseSync | undefined;
  try {
    connection = new DatabaseSync(path);
    connection.exec("pragma busy_timeout = 0");
    connection.exec("begin immediate");
    return connection;
  } catch (error) {
    if (connection !== undefined) closeQuietly(connection);
    if (isLocked(error)) throw new VenueInUseError(directory);
    throw error;
  }
}

/**
 * Holds the venue folder for this process: a second PROCESS asking is refused at once with
 * {@link VenueInUseError}; another caller in THIS process shares the hold.
 *
 * The hold is a `begin immediate` left open on `venue.lock`, which is released when the process
 * dies, however it dies. Shares are counted because the engine refuses a second connection in the
 * same process exactly as it refuses another process, and the server opens its own folder more than
 * once at a time. Measurements: `docs/developers/conventions-data.md`, "One process per venue folder".
 */
export async function lockVenueDirectory(directory: string): Promise<VenueLock> {
  await mkdir(directory, { recursive: true });
  const key = await realpath(directory);
  // Nothing from here to the return awaits, so two callers in this process cannot both find no
  // holder and both open the file.
  let holder = holders.get(key);
  if (holder === undefined) {
    const connection = takeFileLock(join(key, VENUE_LOCK_FILE), directory);
    try {
      beginHolding(key);
    } catch (error) {
      closeQuietly(connection);
      throw error;
    }
    holder = { connection, shares: 0 };
    holders.set(key, holder);
  }
  holder.shares += 1;
  const held = holder;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      held.shares -= 1;
      if (held.shares === 0) {
        holders.delete(key);
        // Before the close: once the lock is let go, the holder file may be a successor's.
        endHolding(key);
        closeQuietly(held.connection);
      }
    },
  };
}
