import type { DatabaseSync } from "node:sqlite";

/**
 * One write transaction at a time.
 *
 * SQLite admits a single writer whatever we do, so this matches the engine rather than working
 * around it. It is required, not prudent: two request-shaped transactions started without waiting
 * for each other share one connection, and the second one's `begin immediate` is refused —
 * "cannot start a transaction within a transaction" — so its writes never run at all, while the
 * first one rolls back and takes its own. Measured by removing the serialisation and running the
 * first case in `write-queue.test.ts`: the table comes back empty.
 *
 * `begin immediate` rather than `begin`: it takes the write lock up front, so a transaction cannot
 * get partway through and then fail to upgrade.
 */
export function createWriteQueue(db: DatabaseSync) {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async run<T>(body: () => Promise<T>): Promise<T> {
      const mine = tail.then(async () => {
        db.exec("begin immediate");
        try {
          const result = await body();
          db.exec("commit");
          return result;
        } catch (error) {
          db.exec("rollback");
          throw error;
        }
      });
      // The tail must not carry a rejection, or every later caller inherits it.
      tail = mine.catch(() => undefined);
      return mine;
    },
  };
}
