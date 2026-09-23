import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVenueStore } from "./index.js";

// Two one-table schemas standing in for the real split: a `ledger`/`state` table belongs in the
// venue file, a `local` one in the node file.
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

/** The tables SQLite itself reports for whichever file this handle is connected to. */
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

    // The discriminating assertion: each file holds ONLY its own table. A store that pointed both
    // handles at one file would report both tables on both sides. Asserting only that the venue
    // file lacks `sessions` would pass on an empty file, which is every fresh store.
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
      // `node:sqlite` enables foreign keys by default, unlike the SQLite library it wraps, so this
      // number stays 1 with the store's `pragma foreign_keys` deleted — measured 2026-09-21 on
      // Node v26.7.0, where a bare `new DatabaseSync(":memory:")` reads 1 and one opened with
      // `{ enableForeignKeyConstraints: false }` reads 0. The pragma is still doing work: with that
      // option passed AND the pragma kept, this case passes; with both gone, it reads 0.
      expect(pragma(db, "foreign_keys")).toBe(1);
      // SQLite's own default, deliberately not zero: nothing else checkpoints until Litestream
      // arrives, so a zero here would let the write-ahead file grow without limit.
      expect(pragma(db, "wal_autocheckpoint")).toBe(1000);
      // SQLite's default is 0, so this one is a real setting rather than a restated default. The
      // case below is what it buys.
      expect(pragma(db, "recursive_triggers")).toBe(1);
    }
  });

  // Recursive triggers, proven by what they change rather than by reading the pragma back. The
  // delete `INSERT OR REPLACE` performs internally fires a `BEFORE DELETE` trigger only with the
  // pragma on; with SQLite's default the row is rewritten and nothing is raised. That is the whole
  // reason append-only enforcement on this engine needs the setting (`./append-only.ts`).
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

    // The same reading the venue case takes, on the other file: the node connection needs its own
    // queue, because two overlapping node writes share one WRITE connection exactly as two venue writes
    // do. Sharing the venue's queue would serialise the two files against each other instead.
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

    // One queue over both files would deadlock here: the inner call would wait for the outer one
    // to release, which cannot happen until the inner one returns.
    expect(nodeWriteFinished).toBe(true);
    expect(store.node.all(sql`select id from t`)).toEqual([{ id: 1 }]);
  });

  it("closes one file through the handle that owns it", async () => {
    const { store } = await open();
    await store.node.close();
    // The venue file is untouched, so a handle's `close` is that file's and not the store's.
    expect(() => store.node.run(sql`select 1`)).toThrow();
    expect(store.venue.all(sql`select 1 as one`)).toEqual([{ one: 1 }]);
  });

  it("closes the store after one handle has already been closed", async () => {
    const { store } = await open();
    await store.node.close();
    // `node:sqlite` throws "database is not open" on a second close, so a store that closed its
    // connections directly would fail its own teardown after a handle was closed.
    await expect(store.close()).resolves.toBeUndefined();
    opened.pop();
  });

  /**
   * The store-level archive is the venue file's, which is the interface the slice-1 plan names
   * (step 21). Each file's tables are the discriminating reading: an archive of the node file
   * would come back holding `sessions`, and one of a store that pointed both handles at one file
   * would hold both.
   */
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
   * A read taken while someone else's write transaction is open.
   *
   * The distinction this turns on is asynchronous context, never a flag: a read written INSIDE the
   * transaction body must still see that body's own rows (the control in the same case), while a
   * read whose context began outside the body is a concurrent request and must see committed rows
   * only. `written.then(...)` is registered before the lock is taken, so its callback runs in the
   * outer context however it is resumed.
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

  /**
   * The same rule for a transaction the write queue did not open. `packages/payments/src/simulator.ts`
   * and several testing helpers call `.transaction(...)` on the handle directly, so the body's own
   * reads have to see its own rows there too — which is why the shim in `./node-sqlite-adapter.ts`
   * marks the context as well as the queue does.
   */
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
   * The case in the other direction, without which the routing could be too wide.
   *
   * A write issued from outside the body, while a transaction is open, is what the read connection
   * refuses — so it is re-run on the writer instead. All three outcomes are visible here and they
   * differ: on the read connection it would THROW; on a second read-write connection it would
   * survive the rollback; on the writer it joins the open transaction and goes with it, which is
   * what one connection did, and it is the only one of the three this case RAN: the other two are
   * named to say what the assertion separates, not offered as measurements.
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
   * The other half of the case above it: the same direct transaction must be HIDDEN from a reader
   * whose context began outside it. Without this half the pair does not discriminate — with the
   * shim's marking deleted nothing is registered, everything falls back to the writer, and the
   * body's own read still sees its row.
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
   * The shim's mark has to outlast the BODY, the same way the queue's does below.
   *
   * The body RETURNS the gate, so the shim's own handler and the outsider's are two handlers on
   * one promise and the mark decides which connection the second one is sent to.
   *
   * Instrumented 2026-09-23 on Node v26.7.0, printing `forStatement`'s answer and the shim's
   * `rollback`: as shipped, that read is sent to the READER, and it runs after the rollback — so
   * what it reads back is the committed state rather than uncommitted rows being withheld from
   * it. What it separates is the other shape. With `connections.asTransactionBody` moved to wrap
   * `fn(...args)` alone, the same read prints the WRITER with the mark already dropped and runs
   * BEFORE the rollback, reading the row the rollback is about to remove:
   * `pnpm --filter @waitron/store test` then reports this case failing
   * `expected [ { id: 1 } ] to deeply equal []`, and every other case in the package passing.
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
   * The same shape for the WRITE QUEUE: its mark has to outlast the body too, because it issues
   * the `rollback` after the body has settled.
   *
   * Instrumented 2026-09-23 on Node v26.7.0, printing `forStatement`'s answer,
   * `DatabaseSync.isTransaction` and the queue's `rollback`: as shipped, the outsider's read is
   * sent to the reader with `isTransaction` already false — the rollback has run — so it reads the
   * committed state. With `asTransactionBody` moved to wrap the body alone, the same read prints
   * the WRITER with `isTransaction` true and runs before the `rollback`, reading the uncommitted
   * row, and this case fails `expected [ { id: 1 } ] to deeply equal []`.
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

    // The body RETURNS its promise rather than awaiting it, which `withTransaction` explicitly
    // allows (`packages/db/src/tenancy.ts`) — and it is what puts the two handlers on the SAME
    // promise, the queue's first and the outsider's second. An `async` body would hand back a
    // promise of its own and hide the gap behind an extra hop.
    const locked = store.withWriteLock(() => {
      store.venue.run(sql`insert into t (id) values (1)`);
      bodyStarted();
      return gate;
    });

    await started;
    // Registered from OUTSIDE the body, on the very rejection that ends it, so it runs in the gap
    // between the body finishing and the queue undoing its work.
    let observed: unknown;
    const watcher = gate.catch(() => {
      observed = store.venue.all(sql`select id from t`);
    });

    release(new Error("deliberate"));
    await watcher;
    await expect(locked).rejects.toThrow("deliberate");

    expect(observed).toEqual([]);
  });

  /**
   * Work detached inside one transaction body and settling after it has ended.
   *
   * The context says "a transaction body of mine is around you", and without a way to tell WHICH
   * body, a callback whose own transaction committed long ago is read as being inside whatever
   * transaction happens to be open when it finally runs — so it sees a stranger's uncommitted
   * rows. `./write-queue.ts` records the same shape for its own re-entrancy marking.
   */
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
      // Detached INSIDE this body and deliberately not awaited, so its continuation carries this
      // body's asynchronous context into a moment when this body is long gone.
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
   * An archive taken while someone else's transaction is open, which the read connection CHANGES.
   *
   * `VACUUM INTO` is refused on a connection with a transaction open — `cannot VACUUM from within a
   * transaction`, errcode 1, and errcode 1 is not the read-only refusal, so nothing would route it
   * back. On the read connection it is allowed, and the copy holds the committed state. Measured
   * 2026-09-23 on Node v26.7.0, both ways round: from the read connection the copy is written and
   * holds the committed row alone; from the write connection, at the same moment, it is refused.
   *
   * This retires the reason `apps/server/src/backup-supervisor.ts` gave for opening its own venue
   * handle — a backup firing mid-sale no longer fails on the shared one. It still opens its own,
   * for the other reasons its header states.
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
   * A refusal the read connection gives for any reason OTHER than being read-only is the caller's,
   * and is not retried on the writer.
   *
   * The two answers differ here, which is what makes this a measurement: the table exists only
   * inside the open transaction, so on the read connection the select is `no such table` — and on
   * the writer, where a retry would send it, it would have SUCCEEDED and returned no rows. The
   * control afterwards shows the table is genuinely there once the transaction has committed, so
   * the refusal was about visibility and not about a name nothing ever creates.
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
   * A transaction opened by RUNNING `begin`, which is not a shape only a test writes: Drizzle's
   * migrator opens and closes its own transaction that way, through the session rather than
   * through the transaction shim. Nothing tells this pair about it, so nothing about it changes —
   * and it must not, because its `rollback` on the read connection is refused
   * `cannot rollback - no transaction is active`, errcode 1, which is not the read-only refusal
   * and so could not be routed back.
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
   * A smoke test over the routed read, and no more than that — both halves of what it is NOT were
   * measured 2026-09-23 rather than argued.
   *
   * It does not reach a file with no sidecars: logging the directory, straight after `open()` it
   * holds `venue.db` and `node.db` alone, and by the moment this read runs `venue.db-wal` and
   * `venue.db-shm` are there too, put there by the `begin immediate` the lock takes. And it
   * discriminates nothing about routing: with `forStatement` replaced by `return write;` — the
   * routing deleted outright — eight cases in this package fail and this is not one of them.
   *
   * What the read-only connection can and cannot do on a bare file is recorded where it is opened
   * (`openReadConnection`, `./index.ts`).
   */
  it("serves a read routed to the reader on a file with no tables in it", async () => {
    const { store } = await open();

    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const concurrent = running.then(() => store.venue.all(sql`select name from sqlite_master`));

    // The body writes no rows. What HAS run on this file by now is the pragmas the two
    // connections are opened with, and the `begin immediate` the lock takes.
    await store.withWriteLock(async () => {
      started();
      await concurrent;
    });

    expect(await concurrent).toEqual([]);
  });

  /**
   * The read connection's own settings, read through it.
   *
   * `busy_timeout` defaults to 0 on this driver (measured 2026-09-23 on Node v26.7.0 against a
   * bare `new DatabaseSync(":memory:")`), so 5000 separates a setting that was applied from one
   * inherited. It does not separate the two connections — both carry the same number — and the
   * case above it is what does that.
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

    // Both halves of the queue are needed to reach this one row, measured by replacing
    // `withWriteLock` twice: with a bare `body()` — no transaction at all — the table holds BOTH
    // rows, because A's throw rolls nothing back; with a transaction per body but no
    // serialisation, the table is EMPTY, because B's `begin immediate` is refused on the shared
    // connection and A's rollback then takes its own row.
    expect(store.venue.all(sql`select who from t`)).toEqual([{ who: "B" }]);
  });
});

/**
 * The file is opened while ANOTHER PROCESS holds a write lock on it.
 *
 * A child process is what makes this a real reading. `openVenueStore` issues its pragmas without
 * yielding, so nothing in this process could take the lock and release it again in between; and
 * the lock SQLite refuses on is a file lock, which a second connection in one process would
 * contend for in the same way but under a holder this suite controls too directly to be evidence
 * about two boxes.
 *
 * The child leaves the file in SQLite's default rollback-journal mode deliberately. That is the
 * state a fresh venue directory is in, and it is the only state in which the switch into
 * write-ahead mode has to take an exclusive lock — against a file already in write-ahead mode the
 * same pragma is a no-op that succeeds under a held write transaction.
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

/** Resolves once the child says it holds the lock — never on a sleep that hopes it does. */
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
 * The sum of the waiting case's waits: the holder process starting (node's own startup, which on
 * a loaded machine is the largest and least predictable term), the hold below, and one retry
 * interval past it. The bound clears all three with room rather than sitting just above them.
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

        // Opening at all is the reading the defect failed: with the switch into write-ahead mode
        // attempted once, this line threw `database is locked` (errcode 5) in about a
        // millisecond, before any statement of the store's own had run.
        expect(pragma(store.venue, "journal_mode")).toBe("wal");
        // And it opened by WAITING, not because the holder had already let go. Without this floor
        // a child that failed to take the lock would look exactly like a fix.
        expect(waited).toBeGreaterThan(holdMs / 4);
      } finally {
        child.kill("SIGKILL");
      }
    },
    CONTENTION_TIMEOUT_MS,
  );

  /**
   * The other side of the same condition: a refusal waiting cannot fix is re-thrown at once. A
   * file of bytes that is not a database reads errcode 26 rather than 5, measured on Node v26.7.0
   * — so a retry that looked only at whether the pragma threw would sit on this for the whole
   * budget and then report it anyway.
   */
  it("re-throws a refusal that is not a lock, without waiting", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-store-"));
    writeFileSync(join(directory, "venue.db"), "these bytes are not a database".repeat(100));

    const started = Date.now();
    await expect(openVenueStore({ directory, venueSchema, nodeSchema })).rejects.toThrow(
      "file is not a database",
    );
    // The discriminating half: it came back at once rather than after the whole retry budget,
    // which is five seconds. A second is far below that and far above what this path costs.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  /**
   * The budget is bounded, so a holder that never lets go ends in the engine's own refusal rather
   * than a hang. The holder here is a second connection in THIS process, which contends for the
   * same file lock — measured, errcode 5, exactly as the child process produces.
   *
   * Only `Date` is faked, and a real interval pushes the mocked clock forward. That reaches the
   * give-up in milliseconds instead of the budget's five seconds, and it does not depend on
   * catching the retry loop at a particular moment: whenever the deadline was computed, the mocked
   * clock overtakes it within a few real ticks.
   */
  /**
   * A failed open must not leave a connection behind.
   *
   * `new DatabaseSync(path)` and `pragma busy_timeout` both SUCCEED on a file whose bytes are not a
   * database — measured on Node v26.7.0, the refusal comes from the switch into write-ahead mode,
   * with the handle still open. So three connections are live when the node file fails: the venue
   * file's two, and the node file's own writer. TWO of them reach the cleanup list — measured
   * 2026-09-23 by printing `standing.length` in `openVenueStore`'s catch, which prints 2 for this
   * case — because the node writer is closed by `openConnection`'s own `closeQuietly` before it is
   * ever pushed onto that list.
   *
   * **The measurement is the process's open file descriptors, and the reason is that the obvious
   * observable does not discriminate.** A leaked connection was first looked for in the `-wal` and
   * `-shm` sidecars, on the grounds that SQLite keeps them while a connection is open. It does —
   * but only once something has been WRITTEN: measured on Node v26.7.0, a freshly opened,
   * never-written database in write-ahead mode has no sidecars whether its connection is open or
   * closed, so that test passed with the leak still there. Descriptor count separates the two, in
   * both directions — measured on Node v26.7.0, opening one connection raises the count by exactly
   * one, closing it returns the count, and the leak shape above leaves it raised.
   *
   * The assertion is "no higher than before" rather than an equality, and deliberately: the count
   * is the whole PROCESS's, and this suite does not own every descriptor in the worker, so an
   * equality would fail on unrelated churn — a flake, not a leak. A leak can only push the number
   * UP, so the inequality catches it without the false failure.
   *
   * What the leak costs is a descriptor per failed open, which a boot that retries repeats. It is
   * NOT contention: an idle SQLite connection holds no lock, so a later attempt is not blocked by
   * an earlier one's leftover.
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
