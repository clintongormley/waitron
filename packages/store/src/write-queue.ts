import { AsyncLocalStorage } from "node:async_hooks";
import type { Connections } from "./connections.js";
import { asDiskFull } from "./disk-full.js";

/**
 * One write transaction at a time.
 *
 * Required, not prudent: two transactions started without waiting for each other share one
 * connection, and the second one's `begin immediate` is refused — "cannot start a transaction
 * within a transaction".
 *
 * `begin immediate` rather than `begin`: it takes the write lock up front, so a transaction cannot
 * get partway through and then fail to upgrade.
 *
 * The queue rolls back only a transaction that is still open. A full disk at a statement or at
 * `commit` can end the transaction inside the engine, which rolls the whole of it back itself (E1
 * and E7 in `docs/superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md`); a `rollback`
 * issued then is refused "cannot rollback - no transaction is active", and that refusal would hide
 * the full disk. A full disk that leaves the transaction open (E13, E14) is still rolled back here,
 * or the next `begin immediate` would be refused. A body that returns after its transaction was
 * ended is not reported as a success.
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
  async function enqueue<T>(work: () => T | PromiseLike<T>): Promise<T> {
    // Re-entering from inside a running body waits on a tail that cannot settle until that body
    // returns, while the body waits on this call — so it hangs with no error, no stack and no
    // timeout. Refusing makes the failure say so.
    if (inBody.getStore() === true) {
      throw new Error("write lock: a body asked for the lock it is already holding");
    }
    const mine = tail.then(() => inBody.run(true, work));
    // The tail must not carry a rejection, or every later caller inherits it.
    tail = mine.catch(() => undefined);
    return mine;
  }
  return {
    async run<T>(body: () => Promise<T>): Promise<T> {
      // The store's marking wraps the WHOLE transaction, `commit` and `rollback` included, not
      // just the body: a handler registered on the body's own promise can run after the body
      // settles and before the transaction finishes, and must not read the writer's uncommitted
      // rows.
      //
      // Two markings, and they answer different questions: `inBody` refuses a body that asks for
      // the lock it holds; `asTransactionBody` routes a read from here to the write connection
      // (`./connections.ts`).
      return enqueue(() =>
        connections.asTransactionBody(async () => {
          try {
            connections.write.exec("begin immediate");
          } catch (error) {
            connections.clearEnded();
            throw asDiskFull(error) ?? error;
          }
          connections.clearEnded();
          let result: T;
          let mark: number | null;
          try {
            mark = connections.changeMark();
            result = await body();
            const ended = connections.endedBy();
            if (ended !== undefined || !connections.write.isTransaction) {
              throw (
                ended?.error ??
                new Error("write queue: the engine ended this transaction before its body finished")
              );
            }
            try {
              connections.write.exec("commit");
            } catch (error) {
              const mapped = asDiskFull(error) ?? error;
              if (!connections.write.isTransaction) connections.noteEnded(mapped);
              throw mapped;
            }
          } catch (error) {
            if (connections.write.isTransaction) {
              try {
                connections.write.exec("rollback");
              } catch {
                // The failure that brought us here is the one the caller needs.
              }
            }
            throw connections.endedBy()?.error ?? asDiskFull(error) ?? error;
          } finally {
            connections.clearEnded();
          }
          connections.reportIfChanged(mark);
          return result;
        }),
      );
    },
    /**
     * Runs `body` in the queue's order with no transaction the QUEUE opened still open, and opens
     * none itself: for work such as a checkpoint (`./index.ts`, `checkpointTruncate`). A transaction
     * opened on the writer some other way is not waited for.
     */
    async exclusive<T>(body: () => T): Promise<T> {
      return enqueue(body);
    },
  };
}
