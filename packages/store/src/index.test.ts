import { mkdtempSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";
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
