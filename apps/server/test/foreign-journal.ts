import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

const MAGIC = "d9d505f920a163d7";
const fill = (n: number) =>
  `insert into filler select randomblob(4000) from
    (with recursive c(x) as (select 1 union all select x + 1 from c where x < ${n}) select x from c)`;

/**
 * Puts at `dest` a hot rollback journal copied mid-transaction from a scratch database, so a
 * read-write open beside it rolls the wrong pages into the database there.
 * `"rolls-back"`: the scratch database held 50 committed rows. `"empty-original"`: it held nothing,
 * so rolling back empties the database.
 */
export function foreignHotJournal(dest: string, shape: "rolls-back" | "empty-original"): void {
  const scratch = mkdtempSync(join(tmpdir(), "foreign-journal-"));
  try {
    const db = new DatabaseSync(join(scratch, "scratch.db"));
    db.exec("pragma journal_mode = delete");
    if (shape === "rolls-back") {
      db.exec("create table filler (b blob)");
      db.exec(fill(50));
      // Without it, inside the server's test files the journal is written with a zeroed header.
      db.exec("pragma synchronous = off; pragma cache_size = 2; begin");
      db.exec("update filler set b = randomblob(4000)");
    } else {
      db.exec("pragma synchronous = off; pragma cache_size = 2; begin");
      db.exec("create table filler (b blob)");
      db.exec(fill(200));
    }
    copyFileSync(join(scratch, "scratch.db-journal"), dest);
    db.exec("rollback");
    db.close();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const header = readFileSync(dest);
  expect(header.subarray(0, 8).toString("hex"), "journal magic").toBe(MAGIC);
  // Unsigned: SQLite writes 0xffffffff for "count the records to the end of the file".
  const records = header.readUInt32BE(8);
  const originalPages = header.readUInt32BE(16);
  if (shape === "rolls-back") {
    expect(records, "journal records").toBeGreaterThan(0);
    expect(originalPages, "original size in pages").toBeGreaterThan(0);
  } else {
    // No page is written past the header's sector, whatever `records` says.
    expect(header.length, "journal size").toBe(header.readUInt32BE(20));
    expect(originalPages, "original size in pages").toBe(0);
  }
}
