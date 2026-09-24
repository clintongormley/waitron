import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { adaptNodeSqlite, drizzleNodeSqlite } from "./node-sqlite-adapter.js";
import { connectionPair } from "./connections.js";

const rows = sqliteTable("t", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  doc: blob("doc", { mode: "json" }),
});

const open = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("create table t (id integer primary key, name text not null, doc blob)");
  return { raw, db: drizzleNodeSqlite(connectionPair(raw, raw), { schema: { rows } }) };
};

const rowCount = (raw: DatabaseSync) =>
  (raw.prepare("select count(*) as n from t").get() as { n: number }).n;

describe("the node:sqlite adapter", () => {
  it("reads back what it writes", () => {
    const { db } = open();
    db.insert(rows)
      .values({ id: 1, name: "a", doc: { k: 1 } })
      .run();
    // A selection Drizzle maps itself: the rows must arrive as arrays, named by the column list.
    expect(db.select().from(rows).all()).toEqual([{ id: 1, name: "a", doc: { k: 1 } }]);
    expect(db.select().from(rows).get()).toEqual({ id: 1, name: "a", doc: { k: 1 } });
  });

  it("hands back named rows for a statement Drizzle does not map", () => {
    const { db } = open();
    db.insert(rows).values({ id: 1, name: "a" }).run();
    // No column list to map against, so this path wants objects — the opposite of the one above.
    expect(db.all(sql`select id, name from t`)).toEqual([{ id: 1, name: "a" }]);
  });

  it("keeps the writes of a transaction that returns", () => {
    const { raw, db } = open();
    expect(
      db.transaction((tx) => {
        tx.insert(rows).values({ id: 9, name: "x" }).run();
        return "done";
      }),
    ).toBe("done");
    expect(rowCount(raw)).toBe(1);
  });

  it("rolls back a transaction whose body throws", () => {
    const { raw, db } = open();
    expect(() =>
      db.transaction((tx) => {
        tx.insert(rows).values({ id: 9, name: "x" }).run();
        throw new Error("deliberate");
      }),
    ).toThrow("deliberate");
    expect(rowCount(raw)).toBe(0);
  });

  it("rolls back only the inner part of a nested transaction", () => {
    const { raw, db } = open();
    db.transaction((tx) => {
      tx.insert(rows).values({ id: 1, name: "outer" }).run();
      try {
        tx.transaction((inner) => {
          inner.insert(rows).values({ id: 2, name: "inner" }).run();
          throw new Error("deliberate");
        });
      } catch {
        // The savepoint is what this case is about; swallowing keeps the outer commit.
      }
    });
    expect(raw.prepare("select name from t").all()).toEqual([{ name: "outer" }]);
  });

  it("rolls back only the inner work when a transaction is already open on the connection", () => {
    const { raw, db } = open();
    // What the write queue leaves open before a request's first Drizzle call.
    raw.exec("begin immediate");
    db.insert(rows).values({ id: 1, name: "outer" }).run();
    expect(() =>
      db.transaction((tx) => {
        tx.insert(rows).values({ id: 2, name: "inner" }).run();
        throw new Error("deliberate");
      }),
    ).toThrow("deliberate");
    // The enclosing transaction is still usable, which is the whole point of the savepoint.
    db.insert(rows).values({ id: 3, name: "after" }).run();
    raw.exec("commit");
    expect(raw.prepare("select name from t order by id").all()).toEqual([
      { name: "outer" },
      { name: "after" },
    ]);
  });

  it("keeps the work of a nested transaction that returns", () => {
    const { raw, db } = open();
    raw.exec("begin immediate");
    expect(
      db.transaction((tx) => {
        tx.insert(rows).values({ id: 1, name: "inner" }).run();
        return "done";
      }),
    ).toBe("done");
    raw.exec("commit");
    expect(rowCount(raw)).toBe(1);
  });

  it("gives each depth its own savepoint, so releasing an inner one leaves the outer standing", () => {
    const { raw, db } = open();
    raw.exec("begin immediate");
    db.insert(rows).values({ id: 1, name: "outer" }).run();
    expect(() =>
      db.transaction(() => {
        db.insert(rows).values({ id: 2, name: "depth one" }).run();
        // Depth two, released normally. If that release also discarded depth one's savepoint, the
        // rollback below would be refused `no such savepoint` and this case would throw that
        // instead of "deliberate".
        db.transaction(() => {
          db.insert(rows).values({ id: 3, name: "depth two" }).run();
        });
        throw new Error("deliberate");
      }),
    ).toThrow("deliberate");
    raw.exec("commit");
    expect(raw.prepare("select name from t order by id").all()).toEqual([{ name: "outer" }]);
  });

  it("emits begin at the top and a separately named savepoint at each depth below it", () => {
    const { raw, db } = open();
    const emitted: string[] = [];
    const exec = raw.exec.bind(raw);
    raw.exec = (statement: string): void => {
      emitted.push(statement);
      exec(statement);
    };
    expect(() =>
      // Every call here is on the database, so each depth below the top finds the level above
      // open and takes a savepoint of this client's.
      db.transaction(() => {
        db.transaction(() => {
          db.transaction(() => {
            throw new Error("deliberate");
          });
        });
      }),
    ).toThrow("deliberate");
    const names = emitted
      .filter((statement) => statement.startsWith("savepoint "))
      .map((statement) => statement.slice("savepoint ".length));
    // One name per depth. A single name for every depth still passes the behavioural cases above,
    // because SQLite resolves a repeated name to the most recent savepoint.
    expect(new Set(names).size).toBe(2);
    expect(emitted).toEqual([
      "begin deferred",
      `savepoint ${names[0]}`,
      `savepoint ${names[1]}`,
      // `rollback to` leaves the savepoint on the stack; `release` takes it off, so a retrying
      // caller does not grow the stack by one per failed attempt.
      `rollback to ${names[1]}`,
      `release ${names[1]}`,
      `rollback to ${names[0]}`,
      `release ${names[0]}`,
      "rollback",
    ]);
  });

  it("undoes the work of an async nested body that rejects, and keeps the work around it", async () => {
    const { raw, db } = open();
    raw.exec("begin immediate");
    db.insert(rows).values({ id: 1, name: "outer" }).run();
    // A wrapper that finished the transaction when the body RETURNS would finish it at the first
    // `await`, before the later work and the throw.
    await expect(
      db.transaction(async (tx) => {
        tx.insert(rows).values({ id: 2, name: "before the await" }).run();
        await Promise.resolve();
        tx.insert(rows).values({ id: 3, name: "after the await" }).run();
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    db.insert(rows).values({ id: 4, name: "after" }).run();
    raw.exec("commit");
    expect(raw.prepare("select name from t order by id").all()).toEqual([
      { name: "outer" },
      { name: "after" },
    ]);
  });

  it("keeps the work of an async nested body that resolves", async () => {
    const { raw, db } = open();
    raw.exec("begin immediate");
    expect(
      await db.transaction(async (tx) => {
        await Promise.resolve();
        tx.insert(rows).values({ id: 1, name: "inner" }).run();
        return "done";
      }),
    ).toBe("done");
    raw.exec("commit");
    expect(rowCount(raw)).toBe(1);
  });

  it("undoes the work of an async top-level body that rejects", async () => {
    const { raw, db } = open();
    await expect(
      db.transaction(async (tx) => {
        await Promise.resolve();
        tx.insert(rows).values({ id: 1, name: "x" }).run();
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    expect(rowCount(raw)).toBe(0);
  });

  it("keeps the work of an async top-level body that resolves", async () => {
    const { raw, db } = open();
    await db.transaction(async (tx) => {
      await Promise.resolve();
      tx.insert(rows).values({ id: 1, name: "x" }).run();
    });
    expect(rowCount(raw)).toBe(1);
  });

  it("waits for an async body before releasing its savepoint", async () => {
    const { raw, db } = open();
    const emitted: string[] = [];
    const exec = raw.exec.bind(raw);
    raw.exec = (statement: string): void => {
      emitted.push(statement);
      exec(statement);
    };
    raw.exec("begin immediate");
    let sawReleaseEarly = false;
    await db.transaction(async () => {
      await Promise.resolve();
      sawReleaseEarly = emitted.some((statement) => statement.startsWith("release "));
    });
    expect(sawReleaseEarly).toBe(false);
    expect(emitted.at(-1)).toMatch(/^release /);
    raw.exec("commit");
  });

  it("offers a transaction in each mode SQLite names", () => {
    const { raw } = open();
    const client = adaptNodeSqlite(connectionPair(raw, raw));
    // Drizzle indexes the wrapper by mode name rather than calling it
    // (drizzle-orm/better-sqlite3/session.js:40), so a missing mode is a type error.
    for (const mode of ["deferred", "immediate", "exclusive"] as const) {
      client
        .transaction((name: string) => {
          client.prepare("insert into t (name) values (?)").run(name);
        })
        [mode](mode);
    }
    client.transaction((name: string) => {
      client.prepare("insert into t (name) values (?)").run(name);
    })("called");
    expect(raw.prepare("select name from t order by id").all()).toEqual([
      { name: "deferred" },
      { name: "immediate" },
      { name: "exclusive" },
      { name: "called" },
    ]);
  });

  it("hands back a rows object for a statement written as raw SQL", () => {
    const { db } = open();
    db.insert(rows).values({ id: 1, name: "a" }).run();
    expect(db.execute(sql`select id, name from t`)).toEqual({ rows: [{ id: 1, name: "a" }] });
  });

  it("hands back no rows for a statement that returns none", () => {
    const { db, raw } = open();
    expect(db.execute(sql`insert into t (id, name) values (1, 'a')`)).toEqual({ rows: [] });
    expect(rowCount(raw)).toBe(1);
  });

  it("hands a rows object to a statement written as raw SQL inside a transaction", () => {
    const { db } = open();
    db.insert(rows).values({ id: 1, name: "a" }).run();
    // Drizzle builds a FRESH transaction object for the body, so `execute` has to be put on that
    // object too.
    expect(db.transaction((tx) => tx.execute(sql`select id, name from t`))).toEqual({
      rows: [{ id: 1, name: "a" }],
    });
  });

  it("hands a rows object to raw SQL inside a NESTED transaction", () => {
    const { db } = open();
    db.insert(rows).values({ id: 1, name: "a" }).run();
    expect(
      db.transaction((tx) => tx.transaction((inner) => inner.execute(sql`select id from t`))),
    ).toEqual({ rows: [{ id: 1 }] });
  });

  it("writes through a transaction's execute, and rolls it back with the transaction", () => {
    const { db, raw } = open();
    // A write through the decorated `execute` is the transaction's, and goes with it.
    expect(() =>
      db.transaction((tx) => {
        tx.execute(sql`insert into t (id, name) values (7, 'g')`);
        expect(rowCount(raw)).toBe(1);
        throw new Error("deliberate");
      }),
    ).toThrow("deliberate");
    expect(rowCount(raw)).toBe(0);
  });

  /**
   * A deferred foreign key is checked AT COMMIT, so the refusal comes from `commit` itself, after
   * the body succeeded. Afterwards the work must be gone and no transaction left open.
   * `apps/server/src/configuration-transfer.ts` runs under this pragma.
   */
  const deferred = () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("create table parent (id integer primary key)");
    raw.exec(
      "create table child (id integer primary key, parent_id integer references parent(id))",
    );
    raw.exec("pragma foreign_keys = on");
    return { raw, db: drizzleNodeSqlite(connectionPair(raw, raw), { schema: { rows } }) };
  };

  it("undoes the work of a transaction whose COMMIT is refused", () => {
    const { db, raw } = deferred();
    expect(() =>
      db.transaction((tx) => {
        tx.execute(sql`pragma defer_foreign_keys = on`);
        // Accepted here and refused at commit. The control, below, is refused on this line.
        tx.execute(sql`insert into child (id, parent_id) values (1, 999)`);
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect((raw.prepare("select count(*) as n from child").get() as { n: number }).n).toBe(0);
  });

  it("leaves no transaction open on the connection after a refused COMMIT", () => {
    const { db, raw } = deferred();
    expect(() =>
      db.transaction((tx) => {
        tx.execute(sql`pragma defer_foreign_keys = on`);
        tx.execute(sql`insert into child (id, parent_id) values (1, 999)`);
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    // Asked of the CONNECTION: a second `db.transaction(...)` would succeed either way, because
    // the wrapper opens a savepoint inside a leaked transaction rather than a `begin`.
    expect(raw.isTransaction).toBe(false);
  });

  it("refuses the same insert at the STATEMENT when the key is not deferred", () => {
    // The control for the two cases above: without the pragma the insert itself is refused.
    const { db, raw } = deferred();
    expect(() =>
      db.transaction((tx) => {
        tx.execute(sql`insert into child (id, parent_id) values (1, 999)`);
        expect.unreachable("the insert should have been refused");
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect((raw.prepare("select count(*) as n from child").get() as { n: number }).n).toBe(0);
  });

  /**
   * Left to Drizzle, a transaction opened on a transaction object releases its savepoint when the
   * body RETURNS — for an `async` body, at its first `await`, before the throw.
   */
  it("undoes an awaiting body's earlier writes when a transaction opened ON A TRANSACTION throws", async () => {
    const { db, raw } = open();
    await db.transaction(async (tx) => {
      await expect(
        tx.transaction(async (inner) => {
          inner.execute(sql`insert into t (id, name) values (1, 'before')`);
          await Promise.resolve();
          inner.execute(sql`insert into t (id, name) values (2, 'after')`);
          throw new Error("the attempt lost");
        }),
      ).rejects.toThrow("the attempt lost");
    });
    expect(rowCount(raw)).toBe(0);
    expect(raw.isTransaction).toBe(false);
  });

  it("keeps an awaiting body's writes when a transaction opened ON A TRANSACTION returns", async () => {
    // The control: the same shape without the throw.
    const { db, raw } = open();
    await db.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        inner.execute(sql`insert into t (id, name) values (1, 'kept')`);
        await Promise.resolve();
        inner.execute(sql`insert into t (id, name) values (2, 'kept too')`);
      });
    });
    expect(rowCount(raw)).toBe(2);
    expect(raw.isTransaction).toBe(false);
  });

  it("closes the write connection it was handed", () => {
    const { raw } = open();
    adaptNodeSqlite(connectionPair(raw, raw)).close();
    expect(() => raw.prepare("select 1")).toThrow();
  });
});
