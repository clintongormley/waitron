import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The file whose engine lock serialises every change to `recovery.json`, across processes. It
 * holds no data. Never unlink it: a process opening the path after an unlink locks a fresh file
 * beside a holder that still has the old one.
 */
export const RECOVERY_LOCK_FILE = "recovery.lock";

/** How long a caller waits for another holder before giving up. A holder keeps it for one read
 *  and one write of a small file. */
export const RECOVERY_LOCK_WAIT_MS = 10_000;

const POLL_MS = 25;

/** SQLite's `SQLITE_BUSY`, which `node:sqlite` puts on the thrown error's `errcode`. */
const SQLITE_BUSY = 5;

/**
 * Runs `body` holding `<stateDir>/recovery.lock`: a `begin immediate` on it, released when the
 * connection closes or the process dies — the technique `packages/store/src/venue-lock.ts` uses
 * for the venue folder.
 *
 * It polls rather than setting the engine's busy timeout, because that timeout sleeps the whole
 * thread: measured 2026-09-24 on Node v26.7.0, a second connection in the same process with
 * `busy_timeout = 1500` blocked for 4093 ms with a 50 ms interval firing 0 times, then failed
 * `SQLITE_BUSY`. A holder in the same process could not finish its asynchronous body meanwhile.
 * Past `waitMs` it rejects with the engine's busy error.
 */
export async function withRecoveryLock<T>(
  stateDir: string,
  body: () => Promise<T>,
  waitMs: number = RECOVERY_LOCK_WAIT_MS,
): Promise<T> {
  const connection = new DatabaseSync(join(stateDir, RECOVERY_LOCK_FILE));
  try {
    const deadline = performance.now() + waitMs;
    for (;;) {
      try {
        connection.exec("begin immediate");
        break;
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== SQLITE_BUSY) throw error;
        if (performance.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    return await body();
  } finally {
    connection.close();
  }
}
