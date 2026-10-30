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
 * header and the schema. A table's own page alone is not enough: counts are answered from an index.
 */
export function damagePages(database: string, table: string | null): void {
  checkpointed(database);
  const db = new DatabaseSync(database, { readOnly: true });
  let size: number;
  let pages: number[];
  try {
    size = (db.prepare("pragma page_size").get() as { page_size: number }).page_size;
    pages =
      table === null
        ? [1]
        : (
            db
              .prepare("select rootpage from sqlite_schema where tbl_name = ? and rootpage > 0")
              .all(table) as { rootpage: number }[]
          ).map(({ rootpage }) => rootpage);
  } finally {
    db.close();
  }
  expect(pages.length, `root pages of ${table ?? "page 1"}`).toBeGreaterThan(0);
  const fd = openSync(database, "r+");
  try {
    for (const page of pages) writeSync(fd, Buffer.alloc(size, 0xab), 0, size, size * (page - 1));
  } finally {
    closeSync(fd);
  }
}
