import { AsyncLocalStorage } from "node:async_hooks";
import type { Connections } from "./connections.js";

/**
 * One write transaction at a time.
 *
 * Required, not prudent: two transactions started without waiting for each other share one
 * connection, and the second one's `begin immediate` is refused — "cannot start a transaction
 * within a transaction".
 *
 * `begin immediate` rather than `begin`: it takes the write lock up front, so a transaction cannot
 * get partway through and then fail to upgrade.
 */
export function createWriteQueue(connections: Connections) {
  let tail: Promise<unknown> = Promise.resolve();
  /**
   * Whether THIS call is running inside one of this queue's own bodies.
   *
   * Asynchronous context, not a plain flag: a flag cannot tell a caller nested INSIDE a running
   * body from a caller merely waiting BEHIND one, and waiting behind one is the normal case this
   * queue exists to serve.
   *
   * **What it answers precisely is "was this call SPAWNED from inside a body", which stops being
   * the same question once work outlives the body that started it**: a task detached inside a body
   * and settling after that body returned still reads the store, so it is refused with the lock
   * free.
   */
  const inBody = new AsyncLocalStorage<true>();
  return {
    async run<T>(body: () => Promise<T>): Promise<T> {
      // Re-entering from inside a running body waits on a tail that cannot settle until that body
      // returns, while the body waits on this call — so it hangs with no error, no stack and no
      // timeout. Refusing makes the failure say so.
      if (inBody.getStore() === true) {
        throw new Error("write lock: a body asked for the lock it is already holding");
      }
      // The store's marking wraps the WHOLE transaction, `commit` and `rollback` included, not
      // just the body: a handler registered on the body's own promise runs after the body settles
      // and before the transaction finishes, and must not read the writer's uncommitted rows.
      //
      // Two markings, and they answer different questions: `inBody` refuses a body that asks for
      // the lock it holds; `asTransactionBody` routes a read from here to the write connection
      // (`./connections.ts`).
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
