import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { diskFullIn } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { connectionPair } from "./connections.js";
import { openVenueStore } from "./index.js";
import { drizzleNodeSqlite } from "./node-sqlite-adapter.js";

const opened: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

const open = async () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-disk-full-"));
  const store = await openVenueStore({ directory, venueSchema: {}, nodeSchema: {} });
  opened.push(store);
  const db = store.venue;
  db.execute("create table sale (id integer primary key, body text unique, pad blob)");
  const insert = (body: string) => db.execute(sql`insert into sale (body) values (${body})`);
  const fill = () => db.execute("insert into sale (body, pad) values ('fill', zeroblob(65536))");
  const bodies = () =>
    db.execute<{ body: string }>("select body from sale order by id").rows.map((row) => row.body);
  /** A page limit is per connection (E6); with no body running this reaches the writer. */
  const limit = (headroom: number) => {
    const [{ page_count }] = db.execute<{ page_count: number }>("pragma page_count").rows;
    db.execute(`pragma max_page_count = ${page_count + headroom}`);
  };
  /** Its error, or `undefined` when it did not throw. */
  const errorOf = async (work: () => unknown): Promise<unknown> => {
    try {
      await work();
      return undefined;
    } catch (error) {
      return error;
    }
  };
  return { directory, store, db, insert, fill, bodies, limit, errorOf };
};

const DISK_FULL = { code: "storage.disk_full" };

describe("a full disk that ends the transaction", () => {
  it("refuses the statements a body runs after catching a full disk, and keeps nothing", async () => {
    const { store, insert, fill, bodies, limit, errorOf } = await open();
    limit(4);
    let part2: unknown;
    await expect(
      store.venue.withWriteLock(async () => {
        insert("part 1");
        await errorOf(fill);
        part2 = await errorOf(() => insert("part 2"));
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(part2).toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
  });

  it("hands back storage.disk_full for a body that caught the full disk and returned", async () => {
    const { store, fill, bodies, limit, errorOf } = await open();
    limit(4);
    await expect(
      store.venue.withWriteLock(async () => {
        await errorOf(fill);
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
  });

  it("tells both the nested and the outer caller storage.disk_full, with a fresh error at the nested level", async () => {
    const { store, db, insert, fill, bodies, limit } = await open();
    limit(4);
    let bodyError: unknown;
    let nested: unknown;
    await expect(
      store.venue.withWriteLock(async () => {
        insert("outer");
        try {
          await db.transaction(async () => {
            insert("inner");
            try {
              fill();
            } catch (error) {
              bodyError = error;
              throw error;
            }
          });
        } catch (error) {
          nested = error;
          throw error;
        }
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(bodyError).toMatchObject(DISK_FULL);
    expect(nested).toMatchObject(DISK_FULL);
    expect(nested).not.toBe(bodyError);
    expect(bodies()).toEqual([]);
  });

  it("throws a fresh error from a nested transaction a RAISE(ROLLBACK) ended", async () => {
    const { store, db, insert, bodies } = await open();
    db.execute(
      "create trigger refuse_x before insert on sale when new.body = 'x' " +
        "begin select raise(rollback, 'refused x'); end",
    );
    let bodyError: unknown;
    let nested: unknown;
    await expect(
      store.venue.withWriteLock(async () => {
        insert("before");
        try {
          await db.transaction(async () => {
            try {
              insert("x");
            } catch (error) {
              bodyError = error;
              throw error;
            }
          });
        } catch (error) {
          nested = error;
          throw error;
        }
      }),
    ).rejects.toThrow("refused x");
    expect(bodyError).toBeDefined();
    expect(nested).not.toBe(bodyError);
    expect((nested as Error).cause).toBe(bodyError);
    expect(bodies()).toEqual([]);
  });

  it("refuses a nested transaction opened after a swallowed full disk", async () => {
    const { store, db, insert, fill, bodies, limit, errorOf } = await open();
    limit(4);
    let afterNested: unknown;
    let secondNested: unknown;
    await expect(
      store.venue.withWriteLock(async () => {
        await errorOf(() =>
          db.transaction(async () => {
            insert("inner");
            fill();
          }),
        );
        afterNested = await errorOf(() => insert("after nested"));
        secondNested = await errorOf(() =>
          db.transaction(async () => {
            insert("second nested");
          }),
        );
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(afterNested).toMatchObject(DISK_FULL);
    expect(secondNested).toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
  });

  it("hands back storage.disk_full from a top-level transaction opened without the queue", async () => {
    const { db, insert, fill, bodies, limit } = await open();
    limit(4);
    await expect(
      db.transaction(async () => {
        insert("x");
        fill();
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
    await expect(
      db.transaction(async () => {
        insert("y");
      }),
    ).resolves.toBeUndefined();
    expect(bodies()).toEqual(["y"]);
  });

  it("serves the next transaction after a full disk", async () => {
    const { store, insert, fill, bodies, limit, errorOf } = await open();
    limit(4);
    await expect(
      store.venue.withWriteLock(async () => {
        insert("part 1");
        await errorOf(fill);
        await errorOf(() => insert("part 2"));
      }),
    ).rejects.toMatchObject(DISK_FULL);
    await expect(
      store.venue.withWriteLock(async () => {
        insert("next");
      }),
    ).resolves.toBeUndefined();
    expect(bodies()).toEqual(["next"]);
  });

  it("answers a read and a write from outside a body that filled the disk, while that body still runs", async () => {
    const { store, db, insert, fill, bodies, limit, errorOf } = await open();
    await store.venue.withWriteLock(async () => {
      insert("seen");
    });
    limit(4);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let filled!: () => void;
    const hasFilled = new Promise<void>((resolve) => {
      filled = resolve;
    });
    const second = store.venue.withWriteLock(async () => {
      await errorOf(fill);
      filled();
      await released;
    });
    second.catch(() => undefined);
    await hasFilled;
    expect(db.execute("select body from sale").rows).toEqual([{ body: "seen" }]);
    expect(await errorOf(() => insert("outsider"))).toBeUndefined();
    release();
    await expect(second).rejects.toMatchObject(DISK_FULL);
    expect(bodies()).toEqual(["seen", "outsider"]);
  });
});

describe("an engine rollback that ends the transaction", () => {
  it("ends the transaction on RAISE(ROLLBACK), hands back the trigger's own refusal, and keeps nothing", async () => {
    const { store, db, insert, bodies, errorOf } = await open();
    db.execute(
      "create trigger refuse_x before insert on sale when new.body = 'x' " +
        "begin select raise(rollback, 'refused x'); end",
    );
    let after: unknown;
    let run: unknown;
    try {
      await store.venue.withWriteLock(async () => {
        insert("before");
        await errorOf(() => insert("x"));
        after = await errorOf(() => insert("after"));
      });
    } catch (error) {
      run = error;
    }
    expect((after as Error).message).toBe("refused x");
    expect(after).not.toMatchObject(DISK_FULL);
    expect((run as Error).message).toBe("refused x");
    expect(run).not.toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
  });
  it("tells a nested caller storage.disk_full when its body caught the full disk and returned", async () => {
    const { store, db, insert, fill, bodies, limit, errorOf } = await open();
    limit(4);
    let filled: unknown;
    let nested: unknown;
    await expect(
      store.venue.withWriteLock(async () => {
        nested = await errorOf(() =>
          db.transaction(async () => {
            insert("inner");
            filled = await errorOf(fill);
          }),
        );
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(filled).toBeDefined();
    expect(nested).toMatchObject(DISK_FULL);
    expect(nested).not.toBe(filled);
    expect(bodies()).toEqual([]);
  });

  it("hands back storage.disk_full from a top-level transaction whose body caught the full disk and returned", async () => {
    const { db, insert, fill, bodies, limit, errorOf } = await open();
    limit(4);
    await expect(
      db.transaction(async () => {
        insert("x");
        await errorOf(fill);
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
    await expect(
      db.transaction(async () => {
        insert("y");
      }),
    ).resolves.toBeUndefined();
    expect(bodies()).toEqual(["y"]);
  });

  it("keeps a running body's record of a full disk when a rollback is issued from outside it", async () => {
    const { store, db, fill, bodies, limit, errorOf } = await open();
    limit(4);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let filled!: () => void;
    const hasFilled = new Promise<void>((resolve) => {
      filled = resolve;
    });
    const run = store.venue.withWriteLock(async () => {
      await errorOf(fill);
      filled();
      await released;
    });
    run.catch(() => undefined);
    await hasFilled;
    const outside = await errorOf(() => db.execute("rollback"));
    expect((outside as Error).message).toBe("cannot rollback - no transaction is active");
    release();
    await expect(run).rejects.toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
  });
});

describe("a refused statement inside a nested transaction", () => {
  const refusals: [string, string[], string, RegExp][] = [
    [
      "a duplicate unique key",
      [],
      "insert into sale (body) values ('before')",
      /UNIQUE constraint failed/,
    ],
    [
      "a null into a not null column",
      ["create table nn (v text not null)"],
      "insert into nn values (null)",
      /NOT NULL constraint failed/,
    ],
    [
      "a failing check",
      ["create table ck (v integer check (v > 0))"],
      "insert into ck values (0)",
      /CHECK constraint failed/,
    ],
    [
      "an immediate foreign key",
      [
        "create table parent (id integer primary key)",
        "create table child (p integer references parent (id))",
      ],
      "insert into child values (99)",
      /FOREIGN KEY constraint failed/,
    ],
    [
      "RAISE(ABORT)",
      [
        "create trigger refuse_abort before insert on sale when new.body = 'abort' begin select raise(abort, 'refused abort'); end",
      ],
      "insert into sale (body) values ('abort')",
      /refused abort/,
    ],
    [
      "RAISE(FAIL)",
      [
        "create trigger refuse_fail before insert on sale when new.body = 'fail' begin select raise(fail, 'refused fail'); end",
      ],
      "insert into sale (body) values ('fail')",
      /refused fail/,
    ],
    ["a missing table", [], "insert into nowhere values (1)", /no such table/],
  ];

  it.each(refusals)(
    "leaves the transaction usable after each refusal the product can meet: %s",
    async (_name, setup, refused, message) => {
      const { store, db, insert, bodies, errorOf } = await open();
      for (const statement of setup) db.execute(statement);
      let nested: unknown;
      await expect(
        store.venue.withWriteLock(async () => {
          insert("before");
          nested = await errorOf(() =>
            db.transaction(async () => {
              db.execute(refused);
            }),
          );
          insert("after");
        }),
      ).resolves.toBeUndefined();
      expect((nested as Error).message).toMatch(message);
      expect(nested).not.toMatchObject(DISK_FULL);
      expect(bodies()).toEqual(["before", "after"]);
    },
  );
});

describe("a full disk that leaves the transaction open", () => {
  const openWithBigTrigger = async () => {
    const opened = await open();
    opened.db.execute("create table log (v blob)");
    opened.db.execute(
      "create trigger sale_big after insert on sale when new.body = 'big' " +
        "begin insert into log values (zeroblob(65536)); end",
    );
    opened.limit(4);
    return opened;
  };

  it("rolls back a full disk that left the transaction open, and serves the next one", async () => {
    const { store, db, insert, bodies } = await openWithBigTrigger();
    let nested: unknown;
    let run: unknown;
    try {
      await store.venue.withWriteLock(async () => {
        insert("outer");
        try {
          await db.transaction(async () => {
            insert("inner");
            insert("big");
          });
        } catch (error) {
          nested = error;
          throw error;
        }
      });
    } catch (error) {
      run = error;
    }
    expect(nested).toMatchObject(DISK_FULL);
    expect(run).toMatchObject(DISK_FULL);
    expect(bodies()).toEqual([]);
    await expect(
      store.venue.withWriteLock(async () => {
        insert("next");
      }),
    ).resolves.toBeUndefined();
    expect(bodies()).toEqual(["next"]);
  });

  it("lets a body that catches a full disk the engine backed out alone carry on", async () => {
    const { store, db, insert, bodies, errorOf } = await openWithBigTrigger();
    let nested: unknown;
    await expect(
      store.venue.withWriteLock(async () => {
        insert("outer");
        nested = await errorOf(() =>
          db.transaction(async () => {
            insert("inner");
            insert("big");
          }),
        );
        insert("after");
      }),
    ).resolves.toBeUndefined();
    expect(nested).toMatchObject(DISK_FULL);
    expect(bodies()).toEqual(["outer", "after"]);
  });
});

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

/**
 * Stands in for a disk that fills at `commit`, as E7 and K in
 * `docs/superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md` measured a real one: the
 * commit refused with errcode 13 and the whole transaction already rolled back by the engine.
 */
const fullAtCommit = (real: DatabaseSync) =>
  scriptExec(real, (text, target) => {
    if (text !== "commit") return target.exec(text);
    target.exec("rollback");
    throw Object.assign(new Error("database or disk is full"), {
      errcode: 13,
      code: "ERR_SQLITE_ERROR",
    });
  });

describe("a full disk at the adapter's own commit", () => {
  it("hands back storage.disk_full when a top-level transaction's commit fills the disk, and issues no rollback", async () => {
    const real = new DatabaseSync(":memory:");
    real.exec("create table t (who text)");
    const { db: w, execs } = fullAtCommit(real);
    const db = drizzleNodeSqlite(connectionPair(w, w), { schema: {} });
    await expect(
      db.transaction(async () => {
        db.execute("insert into t values ('x')");
      }),
    ).rejects.toMatchObject(DISK_FULL);
    expect(execs).toEqual(["begin deferred", "commit"]);
    expect(real.prepare("select who from t").all()).toEqual([]);
    expect(real.isTransaction).toBe(false);
  });
});

describe("a full disk on the read connection", () => {
  it("hands back storage.disk_full for a read from outside a running body", async () => {
    const write = new DatabaseSync(":memory:");
    write.exec("create table t (who text)");
    const read = new Proxy(new DatabaseSync(":memory:"), {
      get(target, property) {
        if (property === "prepare") {
          return () => {
            throw Object.assign(new Error("database or disk is full"), {
              errcode: 13,
              code: "ERR_SQLITE_ERROR",
            });
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const db = drizzleNodeSqlite(connectionPair(write, read), { schema: {} });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = db.transaction(async () => {
      await released;
    });
    let outside: unknown;
    try {
      db.execute("select who from t");
    } catch (error) {
      outside = error;
    }
    release();
    await body;
    expect(outside).toMatchObject(DISK_FULL);
  });
});

describe("a full disk while migrating", () => {
  it("reports a full disk while migrating as storage.disk_full", async () => {
    const { directory, store, db, limit } = await open();
    const migrationsFolder = join(directory, "migrations");
    mkdirSync(join(migrationsFolder, "meta"), { recursive: true });
    writeFileSync(
      join(migrationsFolder, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [
          { idx: 0, version: "6", when: 1700000000000, tag: "0000_fill", breakpoints: true },
        ],
      }),
    );
    writeFileSync(
      join(migrationsFolder, "0000_fill.sql"),
      "CREATE TABLE `filler` (`id` integer PRIMARY KEY, `pad` blob);\n" +
        "--> statement-breakpoint\n" +
        "INSERT INTO `filler` (`pad`) VALUES (zeroblob(262144));\n",
    );
    limit(8);
    let thrown: unknown;
    try {
      migrate(store.venue as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
    } catch (error) {
      thrown = error;
    }
    expect(diskFullIn(thrown)).toBe(true);
    const messages: string[] = [];
    for (let link = thrown; link instanceof Error; link = link.cause) messages.push(link.message);
    expect(messages.filter((message) => message.includes("cannot rollback"))).toEqual([]);
    expect(db.execute("select name from sqlite_master where name = 'filler'").rows).toEqual([]);
    expect(() => db.execute("rollback")).toThrow("cannot rollback - no transaction is active");
  });
});
