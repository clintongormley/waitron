import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  openBackupQuery,
  type BackupQuery,
  type BackupRow,
  type BackupValue,
} from "./backup-query.js";

const directories: string[] = [];
const handles: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "waitron-backup-query-"));
  directories.push(directory);
  const path = join(directory, "venue.db");
  const db = new DatabaseSync(path);
  try {
    db.exec("create table evidence (id integer primary key, value text not null)");
    db.exec("insert into evidence values (1, 'original'), (2, 'second')");
  } finally {
    db.close();
  }
  return { path, directory };
}

async function open(path: string) {
  const handle = await openBackupQuery(path);
  handles.push(handle);
  return handle;
}

async function rows(query: BackupQuery, sql: string, values?: readonly BackupValue[]) {
  const result: BackupRow[] = [];
  for await (const row of query.rows(sql, values)) result.push(row);
  return result;
}

function originalRows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("select * from evidence order by id").all();
  } finally {
    db.close();
  }
}

describe("query-only backup reads", () => {
  it("serves bound SELECT and recursive reads", async () => {
    const { path } = fixture();
    const { query } = await open(path);
    expect(await rows(query, "select * from evidence where value = ?", ["original"])).toEqual([
      { id: 1n, value: "original" },
    ]);
    expect(await rows(query, "select * from evidence where value = ?", ["' or 1=1 --"])).toEqual(
      [],
    );
    expect(
      await rows(
        query,
        "with recursive n(value) as (select 1 union all select value+1 from n where value<3) select value from n",
      ),
    ).toEqual([{ value: 1n }, { value: 2n }, { value: 3n }]);
    expect(await rows(query, "select name from sqlite_schema where type = 'table'")).toEqual([
      { name: "evidence" },
    ]);
  });

  it("preserves integers real values text null and blobs without numeric loss", async () => {
    const { path } = fixture();
    const { query } = await open(path);
    expect(
      await rows(query, "select ? as big, ? as real, ? as text, ? as empty, ? as blob", [
        9007199254740993n,
        1.25,
        "1.00",
        null,
        new Uint8Array([0, 255]),
      ]),
    ).toEqual([
      {
        big: 9007199254740993n,
        real: 1.25,
        text: "1.00",
        empty: null,
        blob: new Uint8Array([0, 255]),
      },
    ]);
  });

  it("permits the declared pure functions", async () => {
    const { path } = fixture();
    const { query } = await open(path);
    expect(
      await rows(
        query,
        "select count(*) as count, max(id) as max, min(id) as min, length('abc') as length, hex(x'00ff') as hex, coalesce(null,'present') as value, json_valid('{}') as json from evidence",
      ),
    ).toEqual([
      { count: 2n, max: 2n, min: 1n, length: 3n, hex: "00FF", value: "present", json: 1n },
    ]);
  });

  it.each([
    ["UPDATE", "update evidence set value='changed'"],
    ["DELETE", "delete from evidence"],
    ["INSERT", "insert into evidence values (3,'new')"],
    ["RETURNING", "update evidence set value='changed' returning *"],
    ["DROP", "drop table evidence"],
    ["CREATE", "create table extra (id integer)"],
    ["ALTER", "alter table evidence add column extra text"],
    ["PRAGMA query_only OFF", "pragma query_only=off"],
    ["PRAGMA read", "pragma query_only"],
    ["transaction begin", "begin"],
    ["transaction commit", "commit"],
    ["savepoint", "savepoint example"],
  ])("refuses %s from a cast callback without changing whole rows", async (_name, sql) => {
    const { path } = fixture();
    const before = originalRows(path);
    const { query } = await open(path);
    const callback = query as { rows(sql: string): AsyncIterable<BackupRow> };
    await expect(rows(callback, sql)).rejects.toMatchObject({
      code: "ERR_SQLITE_ERROR",
      errcode: 23,
    });
    expect(originalRows(path)).toEqual(before);
  });

  it.each([
    ["select load_extension('example')", "load_extension"],
    ["select randomblob(10)", "randomblob"],
  ])("refuses unlisted functions through the authorizer: %s", async (sql, name) => {
    const { path } = fixture();
    const before = originalRows(path);
    const { query } = await open(path);
    await expect(rows(query, sql)).rejects.toMatchObject({
      code: "ERR_SQLITE_ERROR",
      errcode: 1,
      message: `not authorized to use function: ${name}`,
    });
    expect(originalRows(path)).toEqual(before);
  });

  it.each(["attach database ? as outside", "vacuum into ?"])(
    "refuses file creation through %s",
    async (sql) => {
      const { path, directory } = fixture();
      const outside = join(directory, "outside.db");
      const { query } = await open(path);
      await expect(rows(query, sql, [outside])).rejects.toMatchObject({
        code: "ERR_SQLITE_ERROR",
        errcode: 23,
      });
      expect(existsSync(outside)).toBe(false);
      expect(originalRows(path)).toEqual([
        { id: 1, value: "original" },
        { id: 2, value: "second" },
      ]);
    },
  );

  it("closes on iteration failure and allows repeated host cleanup", async () => {
    const { path } = fixture();
    const handle = await open(path);
    const failed = handle.query.rows("select * from missing");
    await expect(failed[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: "ERR_SQLITE_ERROR",
    });
    await expect(rows(handle.query, "select * from evidence")).rejects.toMatchObject({
      code: "ERR_INVALID_STATE",
    });
    await handle.close();
    await handle.close();
    expect(originalRows(path)).toEqual([
      { id: 1, value: "original" },
      { id: 2, value: "second" },
    ]);
  });

  it("releases a partially consumed iterator and keeps subsequent reads usable", async () => {
    const { path } = fixture();
    const handle = await open(path);
    for await (const row of handle.query.rows("select * from evidence order by id")) {
      expect(row).toEqual({ id: 1n, value: "original" });
      break;
    }
    expect(await rows(handle.query, "select count(*) as count from evidence")).toEqual([
      { count: 2n },
    ]);
    await handle.close();
    await expect(rows(handle.query, "select * from evidence")).rejects.toMatchObject({
      code: "ERR_INVALID_STATE",
    });
  });

  it("does not create a missing source database", async () => {
    const { directory } = fixture();
    const absent = join(directory, "absent.db");
    await expect(open(absent)).rejects.toMatchObject({ code: "ERR_SQLITE_ERROR" });
    expect(existsSync(absent)).toBe(false);
  });

  it("refuses an unreadable database before exposing a callback", async () => {
    const { path } = fixture();
    writeFileSync(path, "this is not SQLite");
    await expect(open(path)).rejects.toMatchObject({ code: "ERR_SQLITE_ERROR" });
  });
});
