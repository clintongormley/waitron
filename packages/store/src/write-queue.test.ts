import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createWriteQueue } from "./write-queue.js";

const open = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("create table t (id integer primary key, who text)");
  return db;
};

const who = (db: DatabaseSync) =>
  db.prepare("select who from t order by id").all() as { who: string }[];

describe("the write queue", () => {
  it("does not let one transaction's rollback take another's row", async () => {
    const db = open();
    const queue = createWriteQueue(db);

    const txn = (name: string, fail: boolean) =>
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run(name);
        await new Promise((resolve) => setImmediate(resolve));
        if (fail) throw new Error("deliberate");
      });

    await Promise.allSettled([txn("A", true), txn("B", false)]);

    // Without the queue the table ends up EMPTY, and not for the reason it looks like. Both
    // transactions share the one connection, so the second one's `begin immediate` is refused
    // outright — "cannot start a transaction within a transaction" — and its insert never runs.
    // The first one then rolls back and takes its own row. So the failing write is the one that
    // never got a transaction, not the one that was rolled back.
    expect(who(db)).toEqual([{ who: "B" }]);
  });

  it("runs queued work in the order it arrived", async () => {
    const db = open();
    const queue = createWriteQueue(db);
    await Promise.all(
      ["A", "B", "C"].map((name) =>
        queue.run(async () => {
          db.prepare("insert into t (who) values (?)").run(name);
        }),
      ),
    );
    expect(who(db).map((row) => row.who)).toEqual(["A", "B", "C"]);
  });

  /**
   * Re-entering the queue from inside a running body used to HANG, with no error and no timeout —
   * the tail this call waits on cannot settle until the body returns, and the body is waiting on
   * this call. It is reachable by ordinary code: `withTransaction` hands its body the database
   * handle, and several `packages/db` functions take a plain `Database` and open their own write
   * lock, so a body that calls one of them type-checks and stops the process.
   *
   * A refusal is not a fix for that shape — the caller still has to pass its transaction down — but
   * a hang is the one failure nothing can diagnose from the outside: no stack, no log line, no
   * timeout. This turns it into an error naming what happened.
   */
  it("refuses a second lock taken from inside a running body, rather than hanging", async () => {
    const db = open();
    const queue = createWriteQueue(db);
    await expect(
      queue.run(async () => {
        await queue.run(async () => {
          db.prepare("insert into t (who) values (?)").run("inner");
        });
      }),
    ).rejects.toThrow("write lock: a body asked for the lock it is already holding");
    // The queue is still usable afterwards, so one caller's mistake does not end writing.
    await queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("after");
    });
    expect(who(db)).toEqual([{ who: "after" }]);
  });

  /**
   * The control for the case above, and it is not decoration — it is the case that was MISSING.
   *
   * The first version of the re-entrancy guard was a plain `held` boolean, and every case in this
   * file passed with it, including "runs queued work in the order it arrived" — because those three
   * callers are dispatched in ONE synchronous tick, before any body has started, so the flag is
   * still false when each of them checks it. What the flag actually refused was any caller arriving
   * AFTER a body had begun, which is the ordinary queued caller this whole file exists to serve. It
   * went red in `packages/payments/src/reconcile.concurrency.test.ts` and nowhere here.
   *
   * So this case starts its second caller from the test's own context, once the first body is
   * already running. That is the distinction the guard has to make: not "is a body running" but "am
   * I inside one".
   */
  it("serves a caller that arrives after another body has already started", async () => {
    const db = open();
    const queue = createWriteQueue(db);
    let firstBodyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      firstBodyStarted = resolve;
    });
    let releaseFirst: () => void = () => {};
    const finish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("first");
      firstBodyStarted();
      await finish;
    });
    await started;

    // Called here, from the test — outside any body's asynchronous context, but with the first
    // body open. The flag version refused this.
    const second = queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("second");
    });
    releaseFirst();
    await Promise.all([first, second]);

    expect(who(db).map((row) => row.who)).toEqual(["first", "second"]);
  });

  it("hands the body's result back to the caller", async () => {
    const db = open();
    const queue = createWriteQueue(db);
    await expect(queue.run(async () => "value")).resolves.toBe("value");
  });

  it("carries the body's failure to the caller and keeps the queue usable", async () => {
    const db = open();
    const queue = createWriteQueue(db);
    await expect(queue.run(async () => Promise.reject(new Error("deliberate")))).rejects.toThrow(
      "deliberate",
    );
    await queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("after");
    });
    expect(who(db)).toEqual([{ who: "after" }]);
  });
});
