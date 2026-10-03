import { DatabaseSync } from "node:sqlite";
import { closeQuietly } from "./venue-lock.js";

/** Holds a separate SQLite file until release, so a crashed holder cannot strand the lock. */
export function openLock(path: string, waitMs: number): { release(): void } {
  const connection = new DatabaseSync(path);
  try {
    // The timeout must precede the first statement that can wait for another holder.
    connection.exec(`pragma busy_timeout = ${waitMs}`);
    connection.exec("begin immediate");
  } catch (error) {
    closeQuietly(connection);
    throw error;
  }
  return {
    release: () => connection.close(),
  };
}
