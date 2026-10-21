import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueStore } from "./index.js";

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
  const insert = (body: string) => db.execute(`insert into sale (body) values ('${body}')`);
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
  return { store, db, insert, fill, bodies, limit, errorOf };
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
});
