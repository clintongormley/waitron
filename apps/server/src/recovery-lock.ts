import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isLocked } from "@waitron/db";

/**
 * Serialises every change to `recovery.json` across processes. Never unlink it: a process opening
 * the path after an unlink locks a fresh file beside a holder that still has the old one.
 */
export const RECOVERY_LOCK_FILE = "recovery.lock";

export const RECOVERY_LOCK_WAIT_MS = 10_000;

const POLL_MS = 25;

/**
 * A `begin immediate` on `recovery.lock`, released when the connection closes or the process dies.
 * It polls rather than setting the engine's busy timeout, because that timeout sleeps the whole
 * thread (receipt: docs/developers/conventions-data.md). Past `waitMs` it rejects with the engine's
 * busy error.
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
        if (!isLocked(error)) throw error;
        if (performance.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    return await body();
  } finally {
    connection.close();
  }
}
