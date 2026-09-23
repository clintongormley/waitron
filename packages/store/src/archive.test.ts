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

/** A venue-shaped source file: on disk, in write-ahead mode, exactly as the store opens one. */
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

/** Reads an archive the way a restore would: a connection that knows nothing of the source. */
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

  /**
   * The case the write-ahead file makes non-obvious, and the plan's acceptance test
   * (`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, step 21).
   *
   * A committed row does not reach the main database file until something checkpoints: measured
   * here on the source, whose own bytes do NOT contain the value while its `-wal` sidecar does.
   * The control is in the assertion below — copying the main file alone yields a database that
   * answers `no such table: sales`, so this case fails loudly for an archive that took the file
   * rather than asking the engine.
   */
  it("carries rows that are committed but not yet checkpointed", async () => {
    const { directory, path, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    expect(readFileSync(path).includes(Buffer.from("sales"))).toBe(false);
    expect(readFileSync(`${path}-wal`).includes(Buffer.from("sales"))).toBe(true);

    await archiveTo(db, join(directory, "archive.db"));

    expect(readBack(join(directory, "archive.db")).all(sql`select id, total from sales`)).toEqual([
      { id: 1, total: 250 },
    ]);
    // The control, in the other direction: the same bytes taken by hand prove the case above is
    // discriminating rather than true of any copy.
    await copyFile(path, join(directory, "naive.db"));
    expect(() => readBack(join(directory, "naive.db")).all(sql`select id from sales`)).toThrow(
      /no such table: sales/,
    );
  });

  /**
   * A path no concatenated statement could carry. Built as text and pasted into the SQL,
   * `…/it's "an archive".db` is a syntax error (measured: `near "s": syntax error`, errcode 1), so
   * this case separates a bound path from an escaped or validated one — both of the shapes
   * `CLAUDE.md` §3 offers for a statement that cannot bind.
   */
  it("archives to a path that would break a statement built as text", async () => {
    const { directory, db } = open();
    db.run(sql`insert into sales (id, total) values (1, 250)`);
    const awkward = join(directory, `it's "an archive".db`);

    await archiveTo(db, awkward);

    expect(existsSync(awkward)).toBe(true);
    expect(readBack(awkward).all(sql`select id from sales`)).toEqual([{ id: 1 }]);
  });

  /**
   * Temp-then-rename: bytes land under a working name and reach the final one only when the whole
   * copy succeeded, so nothing a reader would take for a finished archive appears until there is
   * one. These cases are where that discipline is now proven — it used to be held (and tested)
   * beside the `pg_dump` shell-out in `apps/server`, which the storage switch deleted.
   *
   * The failure is forced at the rename by pointing the final path at a directory. That makes the
   * case discriminating in both directions: the copy has already written its bytes by then, so a
   * body that vacuumed straight to the final path fails EARLIER and with the engine's own error
   * (measured: `unable to open database: <path>`, errcode 14) rather than this one.
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
   * What an interrupted archive leaves behind must not block the next one, and `VACUUM INTO`
   * refuses every target that already holds bytes. Both refusals were measured while writing this
   * case, and which one a box meets depends on what the interrupted run got as far as writing: a
   * copy far enough along to be a database gives `output file already exists` (errcode 1), and one
   * holding anything else gives `file is not a database` (errcode 26). Either ends archiving to
   * that path for good, so the working file is cleared before the copy as well as after a failure.
   *
   * The leftover here is written the way a real interruption writes one — a completed copy that
   * never got renamed — so this case meets the first of those two.
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
   * A constraint of the engine, pinned here because `archive.ts` states it and because it decides
   * where a caller may put this call: not inside `withWriteLock`, whose body runs under
   * `begin immediate`. The refusal comes from SQLite, so this case characterises the engine rather
   * than driving our own code — it passed the moment it was written.
   *
   * The driver's own words are read off the cause, because Drizzle's wrapper message is
   * `Failed to run the query 'vacuum into ?'` and would match nothing about a transaction.
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

  /**
   * Re-archiving over yesterday's file. The engine refuses this on its own — `output file already
   * exists`, errcode 1 — and the rename is what makes it work: the copy goes to the working name,
   * which no finished archive occupies, and only then takes the final one.
   */
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
