import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { adaptNodeSqlite, drizzleNodeSqlite } from "./node-sqlite-adapter.js";

const rows = sqliteTable("t", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  doc: blob("doc", { mode: "json" }),
});

const open = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("create table t (id integer primary key, name text not null, doc blob)");
  return { raw, db: drizzleNodeSqlite(raw, { schema: { rows } }) };
};

const rowCount = (raw: DatabaseSync) =>
  (raw.prepare("select count(*) as n from t").get() as { n: number }).n;

describe("the node:sqlite adapter", () => {
  it("reads back what it writes", () => {
    const { db } = open();
    db.insert(rows)
      .values({ id: 1, name: "a", doc: { k: 1 } })
      .run();
    // A selection Drizzle maps itself: the rows arrive as arrays and are named by the column list,
    // so a client that cannot switch to array mode returns every column undefined.
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

  it("offers a transaction in each mode SQLite names", () => {
    const { raw } = open();
    const client = adaptNodeSqlite(raw);
    // Drizzle picks the mode by property name rather than calling the wrapper
    // (drizzle-orm/better-sqlite3/session.js:40), so a missing mode is a type error, not a
    // query error.
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
    // The shape every write path in `@waitron/db` reads: `execute` exists so that a caller
    // written against `{ rows }` does not have to change when the engine does.
    expect(db.execute(sql`select id, name from t`)).toEqual({ rows: [{ id: 1, name: "a" }] });
  });

  it("hands back no rows for a statement that returns none", () => {
    const { db, raw } = open();
    expect(db.execute(sql`insert into t (id, name) values (1, 'a')`)).toEqual({ rows: [] });
    expect(rowCount(raw)).toBe(1);
  });

  it("closes the database it was handed", () => {
    const { raw } = open();
    adaptNodeSqlite(raw).close();
    expect(() => raw.prepare("select 1")).toThrow();
  });
});
