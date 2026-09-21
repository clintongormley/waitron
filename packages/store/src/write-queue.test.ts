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
