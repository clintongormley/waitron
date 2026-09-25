import { AsyncResource } from "node:async_hooks";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVenueStore } from "./index.js";
import { runningWatchdog } from "./venue-liveness.js";

// One table per file, to show each handle reaches its own file. The split is this suite's, not the
// product's.
const sales = sqliteTable("sales", { id: integer("id").primaryKey(), total: integer("total") });
const sessions = sqliteTable("sessions", { id: integer("id").primaryKey(), token: text("token") });

const venueSchema = { sales };
const nodeSchema = { sessions };

const opened: { close: () => Promise<void> }[] = [];

const open = async () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-store-"));
  const store = await openVenueStore({ directory, venueSchema, nodeSchema });
  opened.push(store);
  return { directory, store };
};

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

const tableNames = (db: { all: (query: ReturnType<typeof sql>) => unknown }) =>
  (
    db.all(sql`select name from sqlite_master where type = 'table' order by name`) as {
      name: string;
    }[]
  ).map((row) => row.name);

const pragma = (db: { get: (query: ReturnType<typeof sql>) => unknown }, name: string) =>
  Object.values(db.get(sql.raw(`pragma ${name}`)) as Record<string, unknown>)[0];

describe("openVenueStore", () => {
  it("puts each schema's tables in its own file", async () => {
    const { store } = await open();

    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    store.node.run(sql`create table sessions (id integer primary key, token text)`);

    // Exact lists: a store that pointed both handles at one file would report both tables on both
    // sides.
    expect(tableNames(store.venue)).toEqual(["sales"]);
    expect(tableNames(store.node)).toEqual(["sessions"]);
  });

  it("names the two files venue.db and node.db under the directory it was given", async () => {
    const { directory, store } = await open();
    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    store.node.run(sql`create table sessions (id integer primary key, token text)`);
    expect(
      readdirSync(directory)
        .filter((name) => name.endsWith(".db"))
        .sort(),
    ).toEqual(["node.db", "venue.db"]);
  });

  it("creates the directory when it does not exist yet", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "waitron-store-")), "nested", "data");
    const store = await openVenueStore({ directory, venueSchema, nodeSchema });
    opened.push(store);
    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    expect(tableNames(store.venue)).toEqual(["sales"]);
  });

  it("holds the engine settings on both connections", async () => {
    const { store } = await open();
    for (const db of [store.venue, store.node]) {
      expect(pragma(db, "journal_mode")).toBe("wal");
      expect(pragma(db, "busy_timeout")).toBe(5000);
      // Weaker than it looks: `node:sqlite` enables foreign keys by default, so this reads 1 even
      // with the store's `pragma foreign_keys` deleted.
      expect(pragma(db, "foreign_keys")).toBe(1);
      // SQLite's own default, deliberately not zero: with streaming off nothing else checkpoints,
      // so a zero here would let the write-ahead file grow without limit.
      expect(pragma(db, "wal_autocheckpoint")).toBe(1000);
      // SQLite's default is 0. The case below is what the setting buys.
      expect(pragma(db, "recursive_triggers")).toBe(1);
    }
  });

  // The delete inside `INSERT OR REPLACE` fires a `BEFORE DELETE` trigger only with
  // `recursive_triggers` on; with SQLite's default the row is silently rewritten.
  it("fires a before-delete trigger for the delete inside an insert or replace", async () => {
    const { store } = await open();
    store.venue.run(sql`create table ledger (id integer primary key, payload text not null)`);
    store.venue.run(
      sql.raw(
        "create trigger ledger_no_delete before delete on ledger for each row " +
          "begin select raise(abort, 'ledger is append-only'); end",
      ),
    );
    store.venue.run(sql`insert into ledger (id, payload) values (1, 'first')`);

    expect(() =>
      store.venue.run(sql`insert or replace into ledger (id, payload) values (1, 'rewritten')`),
    ).toThrow();
    expect(store.venue.get(sql`select payload from ledger where id = 1`)).toEqual({
      payload: "first",
    });
  });

  it("refuses a row whose foreign key points at nothing", async () => {
    const { store } = await open();
    for (const db of [store.venue, store.node]) {
      db.run(sql`create table parent (id integer primary key)`);
      db.run(
        sql`create table child (id integer primary key, parent_id integer references parent(id))`,
      );
      let refusal: unknown;
      try {
        db.run(sql`insert into child (id, parent_id) values (1, 99)`);
      } catch (error) {
        refusal = error;
      }
      // Drizzle wraps the driver's error, so the engine's own words are on the cause.
      expect((refusal as { cause?: Error } | undefined)?.cause?.message).toBe(
        "FOREIGN KEY constraint failed",
      );
    }
  });

  it("closes both files", async () => {
    const { store } = await open();
    await store.close();
    opened.pop();
    expect(() => store.venue.run(sql`select 1`)).toThrow();
    expect(() => store.node.run(sql`select 1`)).toThrow();
  });

  it("gives the node file a write queue of its own", async () => {
    const { store } = await open();
    store.node.run(sql`create table t (id integer primary key, who text)`);

    const write = (who: string, fail: boolean) =>
      store.node.withWriteLock(async () => {
        store.node.run(sql`insert into t (who) values (${who})`);
        await new Promise((resolve) => setImmediate(resolve));
        if (fail) throw new Error("deliberate");
      });

    await Promise.allSettled([write("A", true), write("B", false)]);

    expect(store.node.all(sql`select who from t`)).toEqual([{ who: "B" }]);
  });

  it("lets a node write run while the venue lock is held", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);
    store.node.run(sql`create table t (id integer primary key)`);

    let nodeWriteFinished = false;
    await store.venue.withWriteLock(async () => {
      await store.node.withWriteLock(async () => {
        store.node.run(sql`insert into t (id) values (1)`);
        nodeWriteFinished = true;
      });
    });

    expect(nodeWriteFinished).toBe(true);
    expect(store.node.all(sql`select id from t`)).toEqual([{ id: 1 }]);
  });

  it("closes one file through the handle that owns it", async () => {
    const { store } = await open();
    await store.node.close();
    expect(() => store.node.run(sql`select 1`)).toThrow();
    expect(store.venue.all(sql`select 1 as one`)).toEqual([{ one: 1 }]);
  });

  it("closes the store after one handle has already been closed", async () => {
    const { store } = await open();
    await store.node.close();
    // `node:sqlite` throws "database is not open" on a second close.
    await expect(store.close()).resolves.toBeUndefined();
    opened.pop();
  });

  // An archive of the node file would hold `sessions`, and one of a store that pointed both handles
  // at one file would hold both.
  it("archives the venue file, not the node file", async () => {
    const { directory, store } = await open();
    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    store.node.run(sql`create table sessions (id integer primary key, token text)`);
    store.venue.run(sql`insert into sales (id, total) values (1, 250)`);

    await store.archiveTo(join(directory, "archive.db"));

    const archive = new DatabaseSync(join(directory, "archive.db"));
    try {
      expect(
        (
          archive.prepare("select name from sqlite_master where type = 'table'").all() as {
            name: string;
          }[]
        ).map((row) => row.name),
      ).toEqual(["sales"]);
      expect(archive.prepare("select id, total from sales").all()).toEqual([{ id: 1, total: 250 }]);
    } finally {
      archive.close();
    }
  });

  it("archives the node file through the node handle", async () => {
    const { directory, store } = await open();
    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    store.node.run(sql`create table sessions (id integer primary key, token text)`);

    await store.node.archiveTo(join(directory, "node-archive.db"));

    const archive = new DatabaseSync(join(directory, "node-archive.db"));
    try {
      expect(
        (
          archive.prepare("select name from sqlite_master where type = 'table'").all() as {
            name: string;
          }[]
        ).map((row) => row.name),
      ).toEqual(["sessions"]);
    } finally {
      archive.close();
    }
  });

  /**
   * The read inside the body is the control: it must still see the body's own row.
   * `written.then(...)` is registered before the lock is taken, so its callback runs in the outer
   * context.
   */
  it("shows a read taken outside the write lock the committed rows only", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let rowWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      rowWritten = resolve;
    });
    const concurrent = written.then(() => store.venue.all(sql`select id from t`));

    let insideTheBody: unknown;
    await store.withWriteLock(async () => {
      store.venue.run(sql`insert into t (id) values (1)`);
      insideTheBody = store.venue.all(sql`select id from t`);
      rowWritten();
      await concurrent;
    });

    expect(insideTheBody).toEqual([{ id: 1 }]);
    expect(await concurrent).toEqual([]);
  });

  // A transaction the write queue did not open: `.transaction(...)` called on the handle directly,
  // as `packages/payments/src/simulator.ts` does.
  it("shows a transaction opened outside the write queue its own rows", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    const seen = await store.venue.transaction(async (tx) => {
      tx.run(sql`insert into t (id) values (1)`);
      await Promise.resolve();
      return tx.all(sql`select id from t`);
    });

    expect(seen).toEqual([{ id: 1 }]);
  });

  /**
   * A write from outside the body, while a transaction is open, is refused by the read connection
   * and re-run on the writer, where it joins the open transaction and goes with its rollback.
   * Weaker than its name: it passes with the routing deleted.
   */
  it("sends a write issued outside the lock to the writer rather than refusing it", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const outsider = held.then(() => store.venue.run(sql`insert into t (id) values (2)`));

    await expect(
      store.withWriteLock(async () => {
        store.venue.run(sql`insert into t (id) values (1)`);
        locked();
        await outsider;
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");

    expect(store.venue.all(sql`select id from t`)).toEqual([]);
  });

  /**
   * The other half of "shows a transaction opened outside the write queue its own rows", and the
   * half that discriminates: with the shim's marking deleted everything falls back to the writer,
   * where that case's read still sees its row.
   */
  it("hides a transaction opened outside the write queue from a reader outside it", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let written!: () => void;
    const rowWritten = new Promise<void>((resolve) => {
      written = resolve;
    });
    const concurrent = rowWritten.then(() => store.venue.all(sql`select id from t`));

    await store.venue.transaction(async (tx) => {
      tx.run(sql`insert into t (id) values (1)`);
      written();
      await concurrent;
    });

    expect(await concurrent).toEqual([]);
  });

  /**
   * The shim's mark has to outlast the BODY, until its `rollback`. Weaker than its name: as
   * shipped the read runs after the rollback, so it reads the committed state rather than having
   * uncommitted rows withheld, and it passes with the routing deleted. What it catches is the mark
   * wrapping `fn(...args)` alone, which sends the read to the writer before the rollback.
   */
  it("sends a read registered on a direct transaction's body promise to the reader", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let release!: (error: Error) => void;
    const gate = new Promise<void>((_, reject) => {
      release = reject;
    });

    // The body RETURNS the gate rather than awaiting it, so the shim's own handler and the
    // outsider's below are two handlers on the SAME promise.
    const opened = store.venue.transaction((tx) => {
      tx.run(sql`insert into t (id) values (1)`);
      return gate;
    });

    // Registered from outside the body, on the very rejection that ends it.
    let observed: unknown;
    const watcher = gate.catch(() => {
      observed = store.venue.all(sql`select id from t`);
    });

    release(new Error("deliberate"));
    await watcher;
    await expect(opened).rejects.toThrow("deliberate");

    expect(observed).toEqual([]);
  });

  /**
   * The same shape for the WRITE QUEUE, which issues its `rollback` after the body has settled.
   * Weaker than its name in the same way: as shipped the read runs after the rollback and passes
   * with the routing deleted. What it catches is the queue's mark wrapping the body alone.
   */
  it("sends a read registered on the write lock's body promise to the reader", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    let release!: (error: Error) => void;
    const gate = new Promise<void>((_, reject) => {
      release = reject;
    });

    // The body RETURNS its promise rather than awaiting it, which puts the two handlers on the SAME
    // promise, the queue's first. An `async` body would hide the gap behind an extra hop.
    const locked = store.withWriteLock(() => {
      store.venue.run(sql`insert into t (id) values (1)`);
      bodyStarted();
      return gate;
    });

    await started;
    // Registered from OUTSIDE the body, on the rejection that ends it.
    let observed: unknown;
    const watcher = gate.catch(() => {
      observed = store.venue.all(sql`select id from t`);
    });

    release(new Error("deliberate"));
    await watcher;
    await expect(locked).rejects.toThrow("deliberate");

    expect(observed).toEqual([]);
  });

  // Asynchronous context never expires, so routing that could not tell WHICH body a callback came
  // from would read this one as inside whatever transaction is open when it finally runs.
  it("does not let work detached from a finished transaction read a later one's rows", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let observed: unknown;
    let detached!: Promise<void>;

    await store.withWriteLock(async () => {
      // Deliberately not awaited: the continuation carries this body's context past its end.
      detached = gate.then(() => {
        observed = store.venue.all(sql`select id from t`);
      });
    });

    await expect(
      store.withWriteLock(async () => {
        store.venue.run(sql`insert into t (id) values (2)`);
        resume();
        await detached;
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");

    expect(observed).toEqual([]);
  });

  /**
   * `VACUUM INTO` is refused on a connection with a transaction open — errcode 1, not the read-only
   * refusal, so nothing would route it back. On the read connection it is allowed, and the copy
   * holds the committed state.
   */
  it("archives the committed state while another caller's transaction is open", async () => {
    const { directory, store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);
    store.venue.run(sql`insert into t (id) values (1)`);

    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const archived = running.then(() => store.archiveTo(join(directory, "archive.db")));

    await store.withWriteLock(async () => {
      store.venue.run(sql`insert into t (id) values (2)`);
      started();
      await archived;
    });

    const archive = new DatabaseSync(join(directory, "archive.db"));
    try {
      expect(archive.prepare("select id from t").all()).toEqual([{ id: 1 }]);
    } finally {
      archive.close();
    }
  });

  /**
   * The table exists only inside the open transaction, so the reader answers `no such table`, where
   * a retry on the writer would have returned no rows. The last line is the control: once
   * committed, the table is there.
   */
  it("hands back a refusal from the read connection rather than retrying it on the writer", async () => {
    const { store } = await open();

    let created!: () => void;
    const made = new Promise<void>((resolve) => {
      created = resolve;
    });
    const concurrent = made.then(() => store.venue.all(sql`select id from later`));

    await store.withWriteLock(async () => {
      store.venue.run(sql`create table later (id integer primary key)`);
      created();
      await concurrent.catch(() => undefined);
    });

    await expect(concurrent).rejects.toThrow("no such table: later");
    expect(store.venue.all(sql`select id from later`)).toEqual([]);
  });

  /**
   * Drizzle's migrator opens its transaction this way, bypassing the shim. It has to stay on the
   * writer: on the read connection its `rollback` is refused `cannot rollback - no transaction is
   * active`, errcode 1, which is not the read-only refusal and so could not be routed back.
   */
  it("keeps to the writer for a transaction opened as an ordinary statement", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    store.venue.run(sql`begin`);
    store.venue.run(sql`insert into t (id) values (1)`);
    store.venue.run(sql`rollback`);

    expect(store.venue.all(sql`select id from t`)).toEqual([]);
  });

  /**
   * A smoke test over the routed read, and no more. It discriminates nothing about routing: with
   * `forStatement` replaced by `return write;` it still passes. Nor does it reach a file with no
   * sidecars: `venue.db-wal` and `venue.db-shm` exist by the time it reads.
   */
  it("serves a read routed to the reader on a file with no tables in it", async () => {
    const { store } = await open();

    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const concurrent = running.then(() => store.venue.all(sql`select name from sqlite_master`));

    await store.withWriteLock(async () => {
      started();
      await concurrent;
    });

    expect(await concurrent).toEqual([]);
  });

  /**
   * Weaker than its name: 5000 (the driver's default is 0) shows the setting was applied, not which
   * connection served the read — both carry 5000, and this case passes with the routing deleted.
   */
  it("sets a busy timeout on the connection a concurrent read lands on", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key)`);

    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const onTheReader = held.then(() => pragma(store.venue, "busy_timeout"));

    await store.withWriteLock(async () => {
      locked();
      await onTheReader;
    });

    expect(await onTheReader).toBe(5000);
  });

  it("serialises writes through the write queue", async () => {
    const { store } = await open();
    store.venue.run(sql`create table t (id integer primary key, who text)`);

    const write = (who: string, fail: boolean) =>
      store.withWriteLock(async () => {
        store.venue.run(sql`insert into t (who) values (${who})`);
        await new Promise((resolve) => setImmediate(resolve));
        if (fail) throw new Error("deliberate");
      });

    await Promise.allSettled([write("A", true), write("B", false)]);

    expect(store.venue.all(sql`select who from t`)).toEqual([{ who: "B" }]);
  });
});

/**
 * Holds a write lock on the venue file from another process, leaving the file in rollback-journal
 * mode as a fresh venue directory is: only then does the switch into write-ahead mode need an
 * exclusive lock. Against a file already in write-ahead mode the pragma succeeds under a held
 * write transaction.
 */
const HOLDER_SCRIPT = `import { DatabaseSync } from "node:sqlite";
const [path, holdMs] = process.argv.slice(2);
const db = new DatabaseSync(path);
db.exec("pragma busy_timeout = 10000");
db.exec("create table if not exists holder (id integer primary key)");
db.exec("begin immediate");
db.exec("insert into holder (id) values (1)");
process.stdout.write("locked\\n");
setTimeout(() => {
  db.exec("commit");
  db.close();
  process.exit(0);
}, Number(holdMs));
`;

/** Resolves once the child says it holds the lock, rather than after a sleep. */
const untilLocked = (child: ChildProcess) =>
  new Promise<void>((resolve, reject) => {
    let seen = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      if (seen.includes("locked")) resolve();
    });
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("exit", (code) => reject(new Error(`holder exited early (${code}): ${stderr}`)));
  });

/**
 * Clears the sum of the waiting case's waits, with room: the holder process starting (the largest
 * and least predictable on a loaded machine), the hold, and one retry interval past it.
 */
const CONTENTION_TIMEOUT_MS = 20_000;

describe("openVenueStore under contention", () => {
  it(
    "waits for another process to release the file rather than refusing to open",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "waitron-store-"));
      const script = join(directory, "holder.mjs");
      writeFileSync(script, HOLDER_SCRIPT);
      const holdMs = 750;
      const child = spawn(process.execPath, [script, join(directory, "venue.db"), String(holdMs)], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        await untilLocked(child);

        const started = Date.now();
        const store = await openVenueStore({ directory, venueSchema, nodeSchema });
        opened.push(store);
        const waited = Date.now() - started;

        expect(pragma(store.venue, "journal_mode")).toBe("wal");
        // It opened by WAITING, not because the holder had already let go.
        expect(waited).toBeGreaterThan(holdMs / 4);
      } finally {
        child.kill("SIGKILL");
      }
    },
    CONTENTION_TIMEOUT_MS,
  );

  // A file that is not a database is refused errcode 26, not 5. A retry that looked only at
  // whether the pragma threw would sit on it for the whole budget and then report it anyway.
  it("re-throws a refusal that is not a lock, without waiting", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-store-"));
    writeFileSync(join(directory, "venue.db"), "these bytes are not a database".repeat(100));

    const started = Date.now();
    await expect(openVenueStore({ directory, venueSchema, nodeSchema })).rejects.toThrow(
      "file is not a database",
    );
    // The retry budget is five seconds.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  /**
   * Counted in open file descriptors, because the `-wal`/`-shm` sidecars cannot show a leak: a
   * never-written database in write-ahead mode has none whether its connection is open or closed.
   * The count is the whole process's, so the assertion is "no higher than before" — a leak can
   * only push it up.
   */
  it("leaves no connection behind when the NODE file cannot be opened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-store-"));
    // The venue file opens normally; the node file is what fails, so the venue connection is
    // already live and in write-ahead mode when the failure arrives.
    writeFileSync(join(directory, "node.db"), "these bytes are not a database".repeat(100));

    const before = readdirSync("/dev/fd").length;
    await expect(openVenueStore({ directory, venueSchema, nodeSchema })).rejects.toThrow(
      "file is not a database",
    );
    expect(readdirSync("/dev/fd").length).toBeLessThanOrEqual(before);
  });

  /**
   * The holder is a second connection in this process, which contends for the same file lock. Only
   * `Date` is faked, and a real interval pushes the mocked clock past the deadline within a few
   * ticks, wherever the retry loop computed it.
   */
  it("gives up when the holder never releases", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-store-"));
    const holder = new DatabaseSync(join(directory, "venue.db"));
    holder.exec("pragma busy_timeout = 10000");
    holder.exec("create table holder (id integer primary key)");
    holder.exec("begin immediate");
    holder.exec("insert into holder (id) values (1)");
    let pump: ReturnType<typeof setInterval> | undefined;
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      const opening = openVenueStore({ directory, venueSchema, nodeSchema });
      pump = setInterval(() => vi.setSystemTime(Date.now() + 1000), 1);
      await expect(opening).rejects.toThrow("database is locked");
    } finally {
      if (pump !== undefined) clearInterval(pump);
      vi.useRealTimers();
      holder.close();
    }
  });
});

describe("checkpointTruncate", () => {
  const sideFileBytes = (directory: string) => statSync(join(directory, "venue.db-wal")).size;

  // A hundred single-row commits: well under SQLite's 1000-page automatic checkpoint, so the side
  // file still holds frames a reader can be reading.
  const fill = (store: Awaited<ReturnType<typeof open>>["store"]) => {
    store.venue.run(sql`create table if not exists sales (id integer primary key, total integer)`);
    for (let i = 0; i < 100; i += 1) store.venue.run(sql`insert into sales (total) values (${i})`);
  };

  it("folds the side file back into the database and truncates it", async () => {
    const { directory, store } = await open();
    fill(store);
    expect(sideFileBytes(directory)).toBeGreaterThan(0);

    await expect(store.venue.checkpointTruncate()).resolves.toEqual({ reclaimed: true });

    expect(sideFileBytes(directory)).toBe(0);
    expect(store.venue.get(sql`select count(*) as n from sales`)).toEqual({ n: 100 });
  });

  // The failing case is a fold-back that WAITS on the busy handler, and on this synchronous engine
  // the whole process waits with it.
  it("answers at once, unreclaimed, while another connection is still reading the side file", async () => {
    const { directory, store } = await open();
    fill(store);
    const reader = new DatabaseSync(join(directory, "venue.db"), { readOnly: true });
    try {
      const rows = reader.prepare("select id from sales").iterate();
      rows.next();
      const started = performance.now();
      await expect(store.venue.checkpointTruncate()).resolves.toEqual({ reclaimed: false });
      expect(performance.now() - started).toBeLessThan(1_000);
      rows.return?.();
    } finally {
      reader.close();
    }
    // The zero wait was for that one statement only.
    expect(pragma(store.venue, "busy_timeout")).toBe(5000);
    await expect(store.venue.checkpointTruncate()).resolves.toEqual({ reclaimed: true });
  }, 30_000);

  it("waits for a running write transaction instead of failing inside it", async () => {
    const { store } = await open();
    fill(store);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sale = store.venue.withWriteLock(async () => {
      store.venue.run(sql`insert into sales (total) values (1)`);
      await gate;
    });
    let folded = false;
    const fold = store.venue.checkpointTruncate().then((result) => {
      folded = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(folded).toBe(false);
    release();
    await sale;
    await expect(fold).resolves.toEqual({ reclaimed: true });
    expect(store.venue.get(sql`select count(*) as n from sales`)).toEqual({ n: 101 });
  });

  // A transaction opened outside the queue, on the writer, makes the checkpoint statement throw.
  it("puts the busy timeout back when the checkpoint statement throws", async () => {
    const { store } = await open();
    fill(store);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = store.venue.transaction(async (tx) => {
      tx.run(sql`insert into sales (total) values (1)`);
      await gate;
    });
    await expect(store.venue.checkpointTruncate()).rejects.toThrow("database table is locked");
    release();
    await held;
    expect(pragma(store.venue, "busy_timeout")).toBe(5000);
  });

  it("refuses a fold-back asked for from inside a write transaction's body", async () => {
    const { store } = await open();
    fill(store);
    await expect(store.venue.withWriteLock(() => store.venue.checkpointTruncate())).rejects.toThrow(
      "write lock: a body asked for the lock it is already holding",
    );
  });
});

describe("close", () => {
  it("resolves once the watchdog thread of the last held folder has ended", async () => {
    const { store } = await open();
    const watchdog = runningWatchdog();
    expect(watchdog).toBeDefined();
    let ended = false;
    watchdog!.once("exit", () => (ended = true));
    await store.close();
    expect(ended).toBe(true);
  });
});

describe("onCommit", () => {
  const setUp = async () => {
    const { store, directory } = await open();
    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    const heard: true[] = [];
    const stop = store.venue.onCommit(() => heard.push(true));
    return { store, directory, heard, stop };
  };

  it("tells listeners once a write transaction has committed, and not when it rolled back", async () => {
    const { store, directory, heard } = await setUp();
    const outside = new DatabaseSync(join(directory, "venue.db"), { readOnly: true });
    const seenFromOutside: number[] = [];
    store.venue.onCommit(() => {
      const row = outside.prepare("select count(*) as n from sales").get() as { n: number };
      seenFromOutside.push(row.n);
    });
    await store.venue.withWriteLock(async () => {
      store.venue.run(sql`insert into sales (total) values (1)`);
    });
    expect(heard).toHaveLength(1);
    expect(seenFromOutside).toEqual([1]);
    await expect(
      store.venue.withWriteLock(async () => {
        store.venue.run(sql`insert into sales (total) values (2)`);
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    expect(heard).toHaveLength(1);
    outside.close();
  });

  // A transaction that only reads writes nothing to the side file, so there is nothing for a copy
  // of the file to catch up with.
  it("does not tell listeners about a write transaction that only reads", async () => {
    const { store, heard } = await setUp();
    await store.venue.withWriteLock(async () => {
      store.venue.all(sql`select * from sales`);
    });
    expect(heard).toHaveLength(0);
  });

  it("tells listeners about a direct transaction's commit once, and not about its savepoints", async () => {
    const { store, heard } = await setUp();
    store.venue.transaction((tx) => {
      tx.run(sql`insert into sales (total) values (1)`);
      tx.transaction((inner) => {
        inner.run(sql`insert into sales (total) values (2)`);
      });
    });
    expect(heard).toHaveLength(1);
  });

  it("does not tell listeners about a direct transaction that changed no row", async () => {
    const { store, heard } = await setUp();
    store.venue.transaction((tx) => {
      tx.all(sql`select * from sales`);
    });
    expect(heard).toHaveLength(0);
  });

  it("tells listeners about a write made outside any transaction, and not about a read", async () => {
    const { store, heard } = await setUp();
    store.venue.run(sql`insert into sales (total) values (1)`);
    store.venue.all(sql`select * from sales`);
    expect(heard).toHaveLength(1);
  });

  // The commit has already happened when listeners hear of it; a listener that throws must not
  // turn a sale that committed into one the caller is told failed.
  it("keeps a committed write reported as committed when a listener throws, and still tells the others", async () => {
    const { store, heard } = await setUp();
    store.venue.onCommit(() => {
      throw new Error("listener broke");
    });
    const later: true[] = [];
    store.venue.onCommit(() => later.push(true));
    await expect(
      store.venue.withWriteLock(async () => {
        store.venue.run(sql`insert into sales (total) values (1)`);
        return "sold";
      }),
    ).resolves.toBe("sold");
    expect(heard).toHaveLength(1);
    expect(later).toHaveLength(1);
    expect(store.venue.get(sql`select count(*) as n from sales`)).toEqual({ n: 1 });
  });

  // Between the queue's `commit` and the end of its body, a write from outside the body is sent to
  // the read connection, refused, and re-run on the writer, where no transaction is open any more.
  it("tells listeners about a write that the read connection refused and the writer committed by itself", async () => {
    const { store, heard } = await setUp();
    const fromOutside = AsyncResource.bind(() => {
      store.venue.run(sql`insert into sales (total) values (2)`);
    });
    let queued = false;
    store.venue.onCommit(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(fromOutside);
    });
    await store.venue.withWriteLock(async () => {
      store.venue.run(sql`insert into sales (total) values (1)`);
    });
    expect(store.venue.get(sql`select count(*) as n from sales`)).toEqual({ n: 2 });
    expect(heard).toHaveLength(2);
  });

  it("keeps an async listener's rejection from escaping as an unhandled rejection", async () => {
    const { store, heard } = await setUp();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      store.venue.onCommit(async () => {
        throw new Error("async listener broke");
      });
      store.venue.run(sql`insert into sales (total) values (1)`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(heard).toHaveLength(1);
  });

  // An UPDATE setting a value the row already holds moves `total_changes()` and writes nothing to
  // the side file, so a copy of the file never shows it (measured in commit b62ada502).
  it("does not tell listeners about an update that sets a value the row already holds, on any path", async () => {
    const { store, heard } = await setUp();
    store.venue.run(sql`insert into sales (id, total) values (1, 5)`);
    expect(heard).toHaveLength(1);
    store.venue.run(sql`update sales set total = 5 where id = 1`);
    await store.venue.withWriteLock(async () => {
      store.venue.run(sql`update sales set total = 5 where id = 1`);
    });
    store.venue.transaction((tx) => {
      tx.run(sql`update sales set total = 5 where id = 1`);
    });
    expect(heard).toHaveLength(1);
    store.venue.run(sql`update sales set total = 6 where id = 1`);
    await store.venue.withWriteLock(async () => {
      store.venue.run(sql`update sales set total = 7 where id = 1`);
    });
    store.venue.transaction((tx) => {
      tx.run(sql`update sales set total = 8 where id = 1`);
    });
    expect(heard).toHaveLength(4);
  });

  it("compares against the side file as it was when the first listener subscribed", async () => {
    const { store } = await open();
    store.venue.run(sql`create table sales (id integer primary key, total integer)`);
    store.venue.run(sql`insert into sales (id, total) values (1, 5)`);
    const heard: true[] = [];
    store.venue.onCommit(() => heard.push(true));
    store.venue.run(sql`update sales set total = 5 where id = 1`);
    expect(heard).toHaveLength(0);
  });

  // After a checkpoint the next commit writes the side file from its beginning, so while it fits
  // in the old length the file's size does not change; only its modification time does.
  it("tells listeners about a commit that rewrites the side file from its beginning at the same size", async () => {
    const { store, directory, heard } = await setUp();
    for (let i = 0; i < 20; i += 1) store.venue.run(sql`insert into sales (total) values (${i})`);
    store.venue.all(sql`pragma wal_checkpoint(passive)`);
    const wal = join(directory, "venue.db-wal");
    const before = statSync(wal).size;
    heard.length = 0;
    store.venue.run(sql`insert into sales (total) values (99)`);
    expect(statSync(wal).size).toBe(before);
    expect(heard).toHaveLength(1);
  });

  // The fold-back changes the side file without a commit; compared with the file as it was at the
  // last report, a same-value update right after it would read as a change.
  it("does not tell listeners about a same-value update right after the side file was folded back", async () => {
    const { store, heard } = await setUp();
    store.venue.run(sql`insert into sales (id, total) values (1, 5)`);
    store.venue.run(sql`update sales set total = 5 where id = 1`);
    expect(heard).toHaveLength(1);
    expect(await store.venue.checkpointTruncate()).toEqual({ reclaimed: true });
    store.venue.run(sql`update sales set total = 5 where id = 1`);
    expect(heard).toHaveLength(1);
    store.venue.run(sql`update sales set total = 6 where id = 1`);
    expect(heard).toHaveLength(2);
  });

  // Stated at `reportIfChanged` in ./connections.ts: the side file is only looked at once rows have moved.
  it("still tells listeners about a same-value update right after a commit that changed only the schema", async () => {
    const { store, heard } = await setUp();
    store.venue.run(sql`insert into sales (id, total) values (1, 5)`);
    store.venue.run(sql`create table other (id integer primary key)`);
    store.venue.run(sql`update sales set total = 5 where id = 1`);
    expect(heard).toHaveLength(2);
  });

  it("tells listeners about the first commit after the side file was folded back to nothing", async () => {
    const { store, heard } = await setUp();
    store.venue.run(sql`insert into sales (total) values (1)`);
    expect(await store.venue.checkpointTruncate()).toEqual({ reclaimed: true });
    store.venue.run(sql`insert into sales (total) values (2)`);
    expect(heard).toHaveLength(2);
  });

  it("stops telling a listener that unsubscribed", async () => {
    const { store, heard, stop } = await setUp();
    stop();
    store.venue.run(sql`insert into sales (total) values (1)`);
    expect(heard).toHaveLength(0);
  });
});
