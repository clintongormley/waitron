import { AsyncLocalStorage } from "node:async_hooks";
import type { Connections } from "./connections.js";

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
export function createWriteQueue(connections: Connections) {
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
   *
   * **What it answers precisely is "was this call SPAWNED from inside a body", which stops being
   * the same question once work outlives the body that started it.** Measured on Node v26.7.0 with
   * a control: a task detached inside a body and settling after that body returned still reads the
   * store, so it would be refused with the lock free. No caller does that today — the detached
   * sites in this tree are an SSE stream's interval and the setup restart timers, none of them
   * inside a write lock — and whoever writes the first one needs to know this refuses it.
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
      // The store's marking wraps the WHOLE transaction, `commit` and `rollback` included, not
      // just the body. The queue finishes the transaction after the body has settled, and a
      // handler registered on the body's own promise runs in between — so a window that closed
      // with the body would let that handler read the writer's still-uncommitted rows. Pinned by
      // the `a read registered on the write lock's body promise` case in ./index.test.ts.
      //
      // Two markings, and they answer different questions. `inBody` is this queue's own, and
      // refuses a body that asks for the lock it holds. `asTransactionBody` is the store's, and
      // says a read from here belongs on the write connection rather than on the read one
      // (`./connections.ts`). Merging them would refuse a caller that only needs routing.
      const mine = tail.then(() =>
        connections.asTransactionBody(async () => {
          connections.write.exec("begin immediate");
          try {
            const result = await inBody.run(true, body);
            connections.write.exec("commit");
            return result;
          } catch (error) {
            connections.write.exec("rollback");
            throw error;
          }
        }),
      );
      // The tail must not carry a rejection, or every later caller inherits it.
      tail = mine.catch(() => undefined);
      return mine;
    },
  };
}
