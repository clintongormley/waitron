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
    // queue, because two overlapping node writes share one connection exactly as two venue writes
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
