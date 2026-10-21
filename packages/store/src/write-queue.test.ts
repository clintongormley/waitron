import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createWriteQueue } from "./write-queue.js";
import { connectionPair } from "./connections.js";

const open = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("create table t (id integer primary key, who text)");
  return db;
};

/** Caps the file a few pages past what it holds now, so one 64 KiB row cannot fit. */
const full = (db: DatabaseSync) => {
  const { page_count } = db.prepare("pragma page_count").get() as { page_count: number };
  db.exec(`pragma max_page_count = ${page_count + 4}`);
  return db;
};

const fill = (db: DatabaseSync) => db.exec("insert into t (who) values (zeroblob(65536))");

/** `real`, with `exec` answered by `exec` instead; every `exec` text is recorded in `execs`. */
const scriptExec = (
  real: DatabaseSync,
  exec: (text: string, target: DatabaseSync) => void,
): { db: DatabaseSync; execs: string[] } => {
  const execs: string[] = [];
  const db = new Proxy(real, {
    get(target, property) {
      if (property === "exec") {
        return (text: string) => {
          execs.push(text);
          exec(text, target);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { db, execs };
};

const diskFullError = () =>
  Object.assign(new Error("database or disk is full"), { errcode: 13, code: "ERR_SQLITE_ERROR" });

/**
 * Stands in for a disk that fills at `commit`. E7 and K in
 * `docs/superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md` measured a real full disk
 * answering this way: the commit refused with errcode 13 and the engine had already rolled the
 * whole transaction back, leaving none open. `endsTransaction: false` is a commit refused with
 * errcode 13 that leaves the transaction open, which no measurement produced.
 */
const fullAtCommit = (real: DatabaseSync, { endsTransaction = true } = {}) =>
  scriptExec(real, (text, target) => {
    if (text !== "commit") return target.exec(text);
    if (endsTransaction) target.exec("rollback");
    throw diskFullError();
  });

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

describe("when the engine ends the queue's transaction itself", () => {
  it("hands back storage.disk_full, not the queue's own failed rollback, when a statement fills the disk", async () => {
    const db = full(open());
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run("A");
        fill(db);
      }),
    ).rejects.toMatchObject({ code: "storage.disk_full" });
    expect(who(db)).toEqual([]);
  });

  it("refuses to report success for a body that caught the full disk and returned", async () => {
    const db = full(open());
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run("A");
        try {
          fill(db);
        } catch {
          // Deliberately swallowed.
        }
        return "done";
      }),
    ).rejects.toThrow("write queue: the engine ended this transaction before its body finished");
    expect(who(db)).toEqual([]);
  });

  it("hands back storage.disk_full when the disk fills at commit, and issues no rollback of its own", async () => {
    const real = open();
    const { db, execs } = fullAtCommit(real);
    const c = connectionPair(db, db);
    const queue = createWriteQueue(c);
    await expect(
      queue.run(async () => {
        real.prepare("insert into t (who) values (?)").run("A");
      }),
    ).rejects.toMatchObject({ code: "storage.disk_full" });
    expect(execs).toEqual(["begin immediate", "commit"]);
    expect(who(real)).toEqual([]);
    expect(real.isTransaction).toBe(false);
    expect(c.endedBy()).toBeUndefined();
  });

  it("rolls back a commit refused for a full disk that left the transaction open", async () => {
    const real = open();
    const { db, execs } = fullAtCommit(real, { endsTransaction: false });
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.run(async () => {
        real.prepare("insert into t (who) values (?)").run("A");
      }),
    ).rejects.toMatchObject({ code: "storage.disk_full" });
    expect(execs).toEqual(["begin immediate", "commit", "rollback"]);
    expect(real.isTransaction).toBe(false);
    expect(who(real)).toEqual([]);
  });

  it("passes a refused begin through unchanged and clears a stale record of an ended transaction", async () => {
    const refusal = new Error("begin refused");
    const { db } = scriptExec(open(), (text, target) => {
      if (text === "begin immediate") throw refusal;
      target.exec(text);
    });
    const c = connectionPair(db, db);
    c.noteEnded(new Error("stale"));
    const queue = createWriteQueue(c);
    await expect(queue.run(async () => "never")).rejects.toBe(refusal);
    expect(c.endedBy()).toBeUndefined();
  });

  it("still rolls back a commit the engine refused and left open", async () => {
    const db = open();
    db.exec("create table parent (id integer primary key)");
    db.exec("create table child (id integer primary key, parent_id integer references parent(id))");
    db.exec("pragma foreign_keys = on");
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.run(async () => {
        db.exec("pragma defer_foreign_keys = on");
        db.exec("insert into child (id, parent_id) values (1, 999)");
      }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect((db.prepare("select count(*) as n from child").get() as { n: number }).n).toBe(0);
    expect(db.isTransaction).toBe(false);
    await expect(
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run("after");
      }),
    ).resolves.toBeUndefined();
    expect(who(db)).toEqual([{ who: "after" }]);
  });

  it("serves the caller queued behind a body that filled the disk", async () => {
    const db = full(open());
    const queue = createWriteQueue(connectionPair(db, db));
    const first = queue.run(async () => {
      fill(db);
    });
    const second = queue.run(async () => {
      db.prepare("insert into t (who) values (?)").run("B");
    });
    await expect(first).rejects.toMatchObject({ code: "storage.disk_full" });
    await expect(second).resolves.toBeUndefined();
    expect(who(db)).toEqual([{ who: "B" }]);
  });

  it("rolls back a full disk that left the transaction open, and serves the next transaction", async () => {
    const db = full(open());
    db.exec("create table log (v blob)");
    db.exec(
      "create trigger t_big after insert on t when new.who = 'big' begin insert into log values (zeroblob(65536)); end",
    );
    const queue = createWriteQueue(connectionPair(db, db));
    await expect(
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run("A");
        db.prepare("insert into t (who) values (?)").run("big");
      }),
    ).rejects.toMatchObject({ code: "storage.disk_full" });
    expect(db.isTransaction).toBe(false);
    expect(who(db)).toEqual([]);
    await expect(
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run("next");
      }),
    ).resolves.toBeUndefined();
    expect(who(db)).toEqual([{ who: "next" }]);
  });
});
