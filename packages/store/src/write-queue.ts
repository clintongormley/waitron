import { AsyncLocalStorage } from "node:async_hooks";
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
  /**
   * Whether THIS call is running inside one of this queue's own bodies.
   *
   * It has to be asynchronous context and not a plain flag, and the difference is the whole point:
   * a plain `held` boolean cannot tell a caller nested INSIDE a running body from a caller merely
   * waiting BEHIND one, and waiting behind one is the normal case this queue exists to serve.
   * Measured — with a flag, `packages/payments/src/reconcile.concurrency.test.ts` went red, because
   * its two sweeps arrive while the first body is running and are exactly the callers that must be
   * allowed to queue.
   */
  const inBody = new AsyncLocalStorage<true>();
  return {
    async run<T>(body: () => Promise<T>): Promise<T> {
      // Re-entering from inside a running body waits on a tail that cannot settle until that body
      // returns, while the body waits on this call — so it hangs with no error, no stack and no
      // timeout, which is the one failure nothing can diagnose from outside. It is reachable by
      // ordinary code rather than by misuse: `withTransaction` hands its body the database handle,
      // and several `packages/db` functions take a plain `Database` and open their own lock, so a
      // body calling one of them type-checks. Refusing does not make that code correct — it has to
      // pass its transaction down — but it makes the failure say so. Pinned by the re-entrancy case
      // in ./write-queue.test.ts, whose control is the ordinary queued-callers case beside it.
      if (inBody.getStore() === true) {
        throw new Error("write lock: a body asked for the lock it is already holding");
      }
      const mine = tail.then(async () => {
        db.exec("begin immediate");
        try {
          const result = await inBody.run(true, body);
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
