import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { archiveTo } from "./archive.js";
import { drizzleNodeSqlite } from "./node-sqlite-adapter.js";
import { connectionPair } from "./connections.js";

const connections: DatabaseSync[] = [];
afterEach(() => {
  while (connections.length > 0) connections.pop()!.close();
});

/** A source file on disk in write-ahead mode, as the store opens one. */
const open = () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-archive-"));
  const path = join(directory, "venue.db");
  const connection = new DatabaseSync(path);
  connection.exec("pragma journal_mode = wal");
  connection.exec("create table sales (id integer primary key, total integer not null)");
  connections.push(connection);
  return {
    directory,
    path,
    db: drizzleNodeSqlite(connectionPair(connection, connection), { schema: {} }),
  };
};

const readBack = (path: string) => {
  const connection = new DatabaseSync(path);
  connections.push(connection);
  return drizzleNodeSqlite(connectionPair(connection, connection), { schema: {} });
};

describe("archiveTo", () => {
  it("copies the rows into the file it was given", async () => {
    const { directory, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);

    await archiveTo(db, join(directory, "archive.db"));

    expect(readBack(join(directory, "archive.db")).all(sql`select id, total from sales`)).toEqual([
      { id: 1, total: 250 },
    ]);
  });

  // A committed row stays in the `-wal` sidecar until something checkpoints. The hand copy of the
  // main file at the end is the control.
  it("carries rows that are committed but not yet checkpointed", async () => {
    const { directory, path, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    expect(readFileSync(path).includes(Buffer.from("sales"))).toBe(false);
    expect(readFileSync(`${path}-wal`).includes(Buffer.from("sales"))).toBe(true);

    await archiveTo(db, join(directory, "archive.db"));

    expect(readBack(join(directory, "archive.db")).all(sql`select id, total from sales`)).toEqual([
      { id: 1, total: 250 },
    ]);
    await copyFile(path, join(directory, "naive.db"));
    expect(() => readBack(join(directory, "naive.db")).all(sql`select id from sales`)).toThrow(
      /no such table: sales/,
    );
  });

  // Pasted unescaped into the SQL, this path is a syntax error.
  it("archives to a path that would break a statement built as text", async () => {
    const { directory, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    const awkward = join(directory, `it's "an archive".db`);

    await archiveTo(db, awkward);

    expect(existsSync(awkward)).toBe(true);
    expect(readBack(awkward).all(sql`select id from sales`)).toEqual([{ id: 1 }]);
  });

  /**
   * The failure is forced at the rename by pointing the final path at a directory, after the copy
   * has written its bytes. A body that vacuumed straight to the final path would fail earlier, with
   * the engine's `unable to open database` (errcode 14) rather than `EISDIR`.
   */
  it("removes the half-written file when the copy cannot be finished", async () => {
    const { directory, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    const occupied = join(directory, "occupied");
    mkdirSync(occupied);

    await expect(archiveTo(db, occupied)).rejects.toMatchObject({ code: "EISDIR" });

    expect(existsSync(`${occupied}.partial`)).toBe(false);
  });

  /**
   * `VACUUM INTO` refuses a target that is already a database, so without clearing it a leftover
   * working file would end archiving to that path for good. The leftover here is a completed copy
   * that was never renamed, which `VACUUM INTO` alone refuses with `output file already exists`.
   */
  it("archives again after an interrupted run left its working file behind", async () => {
    const { directory, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    const path = join(directory, "archive.db");
    db.run(sql.raw(`vacuum into '${path}.partial'`));
    expect(statSync(`${path}.partial`).size).toBeGreaterThan(0);

    await archiveTo(db, path);

    expect(readBack(path).all(sql`select id from sales`)).toEqual([{ id: 1 }]);
    expect(existsSync(`${path}.partial`)).toBe(false);
  });

  /**
   * Characterises the engine rather than our code: it is why an archive cannot be taken inside
   * `withWriteLock`, whose body runs under `begin immediate`. The driver's words are on the cause;
   * Drizzle's wrapper message says nothing about a transaction.
   */
  it("refuses to archive from inside an open transaction", async () => {
    const { directory, db } = open();
    const source = connections.at(-1)!;
    source.exec("begin immediate");
    db.run(sql`insert into sales (id, total) values (1, 250)`);

    const failure = await archiveTo(db, join(directory, "archive.db")).catch((error: unknown) => {
      return (error as { cause?: { message?: string; errcode?: number } }).cause;
    });

    expect(failure?.message).toBe("cannot VACUUM from within a transaction");
    expect(failure?.errcode).toBe(1);
    expect(existsSync(join(directory, "archive.db"))).toBe(false);
    expect(existsSync(join(directory, "archive.db.partial"))).toBe(false);
    source.exec("rollback");
  });

  // `VACUUM INTO` alone refuses an existing target (`output file already exists`); the copy goes
  // to the working name and only then takes the final one.
  it("replaces an archive already at that path", async () => {
    const { directory, db } = open();
    const path = join(directory, "archive.db");
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    await archiveTo(db, path);
    db.run(sql`insert into sales (id, total) values (2, 400)`);

    await archiveTo(db, path);

    expect(readBack(path).all(sql`select id, total from sales order by id`)).toEqual([
      { id: 1, total: 250 },
      { id: 2, total: 400 },
    ]);
  });
});
