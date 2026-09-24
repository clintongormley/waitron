import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createWriteQueue } from "./write-queue.js";
import { connectionPair } from "./connections.js";

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
    const queue = createWriteQueue(connectionPair(db, db));

    const txn = (name: string, fail: boolean) =>
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run(name);
        await new Promise((resolve) => setImmediate(resolve));
        if (fail) throw new Error("deliberate");
      });

    await Promise.allSettled([txn("A", true), txn("B", false)]);

    // Without serialisation the table ends up EMPTY: B's `begin immediate` is refused on the
    // shared connection, so B's insert never runs, and A's rollback takes A's row.
    expect(who(db)).toEqual([{ who: "B" }]);
  });

  it("runs queued work in the order it arrived", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await Promise.all(
      ["A", "B", "C"].map((name) =>
        queue.run(async () => {
          db.prepare("insert into t (who) values (?)").run(name);
        }),
      ),
    );
    expect(who(db).map((row) => row.who)).toEqual(["A", "B", "C"]);
  });

  // Unrefused, this would hang with no error: the tail the inner call waits on cannot settle until
  // the body returns, and the body is waiting on the inner call.
  it("refuses a second lock taken from inside a running body, rather than hanging", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.run(async () => {
        await queue.run(async () => {
          db.prepare("insert into t (who) values (?)").run("inner");
        });
      }),
    ).rejects.toThrow("write lock: a body asked for the lock it is already holding");
    await queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("after");
    });
    expect(who(db)).toEqual([{ who: "after" }]);
  });

  /**
   * The control for the case above: the re-entrancy guard must ask "am I inside a body", not "is a
   * body running". "runs queued work in the order it arrived" cannot tell the two apart, because
   * its callers are all dispatched in one tick, before any body starts.
   */
  it("serves a caller that arrives after another body has already started", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
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

    // Outside any body's asynchronous context, but with the first body open.
    const second = queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("second");
    });
    releaseFirst();
    await Promise.all([first, second]);

    expect(who(db).map((row) => row.who)).toEqual(["first", "second"]);
  });

  it("hands the body's result back to the caller", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(queue.run(async () => "value")).resolves.toBe("value");
  });

  it("carries the body's failure to the caller and keeps the queue usable", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(queue.run(async () => Promise.reject(new Error("deliberate")))).rejects.toThrow(
      "deliberate",
    );
    await queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("after");
    });
    expect(who(db)).toEqual([{ who: "after" }]);
  });

  it("runs exclusive work after the transaction ahead of it, with no transaction open", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ahead = queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("sale");
      await gate;
    });
    const seen: boolean[] = [];
    const exclusive = queue.exclusive(() => {
      seen.push(db.isTransaction);
      return "done";
    });
    await new Promise((resolve) => setImmediate(resolve));
    // Still behind the open transaction: running now would put it INSIDE that transaction.
    expect(seen).toEqual([]);
    release();
    await ahead;
    await expect(exclusive).resolves.toBe("done");
    expect(seen).toEqual([false]);
  });

  it("refuses exclusive work asked for from inside a running body, rather than hanging", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(queue.run(async () => queue.exclusive(() => "inner"))).rejects.toThrow(
      "write lock: a body asked for the lock it is already holding",
    );
    await expect(queue.exclusive(() => "after")).resolves.toBe("after");
  });

  it("refuses the lock asked for from inside exclusive work, rather than hanging", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(queue.exclusive(() => queue.run(async () => "inner"))).rejects.toThrow(
      "write lock: a body asked for the lock it is already holding",
    );
    await expect(
      queue.exclusive(async () => {
        await Promise.resolve();
        return queue.exclusive(() => "inner");
      }),
    ).rejects.toThrow("write lock: a body asked for the lock it is already holding");
    await expect(queue.exclusive(() => "after")).resolves.toBe("after");
  });

  it("keeps the queue usable after exclusive work throws", async () => {
    const db = open();
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.exclusive(() => {
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    await queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("after");
    });
    expect(who(db)).toEqual([{ who: "after" }]);
  });
});
