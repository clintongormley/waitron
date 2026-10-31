import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

/** Moves every committed page into the database file, so damage written there is what a reader sees. */
export function checkpointed(database: string): void {
  const db = new DatabaseSync(database);
  try {
    db.exec("pragma wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  expect(() => statSync(`${database}-wal`)).toThrow(/ENOENT/);
}

/**
 * Overwrites the root pages of `table` and of its indexes with junk; `null` overwrites page 1, the
 * header and the schema. Its indexes too, so no read can answer from an index instead.
 */
export function damagePages(database: string, table: string | null): void {
  damageRoots(
    database,
    table === null
      ? null
      : ["select rootpage from sqlite_schema where tbl_name = ? and rootpage > 0", table],
    table ?? "page 1",
  );
}

/** Overwrites the root page of every index with junk, leaving every table's own pages whole. */
export function damageIndexes(database: string): void {
  damageRoots(
    database,
    ["select rootpage from sqlite_schema where type = 'index' and rootpage > 0"],
    "indexes",
  );
}

function damageRoots(database: string, query: [string, ...string[]] | null, what: string): void {
  checkpointed(database);
  const db = new DatabaseSync(database, { readOnly: true });
  let size: number;
  let pages: number[];
  try {
    size = (db.prepare("pragma page_size").get() as { page_size: number }).page_size;
    pages =
      query === null
        ? [1]
        : (db.prepare(query[0]).all(...query.slice(1)) as { rootpage: number }[]).map(
            ({ rootpage }) => rootpage,
          );
  } finally {
    db.close();
  }
  expect(pages.length, `root pages of ${what}`).toBeGreaterThan(0);
  const fd = openSync(database, "r+");
  try {
    for (const page of pages) writeSync(fd, Buffer.alloc(size, 0xab), 0, size, size * (page - 1));
  } finally {
    closeSync(fd);
  }
}
