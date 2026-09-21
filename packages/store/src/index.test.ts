import { mkdtempSync, readdirSync } from "node:fs";
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
    }
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
