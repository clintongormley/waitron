import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { readAdditiveControl } from "../src/additive-control.ts";

test("records SQLite corruption from an unreadable additive control", () => {
  const dir = mkdtempSync(join(tmpdir(), "waitron-additive-control-"));
  const path = join(dir, "control.db");
  try {
    const db = new DatabaseSync(path);
    try {
      db.exec(
        "PRAGMA page_size = 4096; CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('control')",
      );
    } finally {
      db.close();
    }
    const bytes = readFileSync(path);
    bytes[4096] = 0;
    writeFileSync(path, bytes);
    const result = readAdditiveControl(() => {
      const restored = new DatabaseSync(path);
      try {
        return restored.prepare("SELECT value FROM sample").all();
      } finally {
        restored.close();
      }
    });
    assert.deepEqual(result, {
      value: null,
      corruption: "database disk image is malformed",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps a readable control available to the original comparison", () => {
  const value = { records: [{ node_id: "box-b" }] };
  assert.deepEqual(
    readAdditiveControl(() => value),
    { value, corruption: null },
  );
});

for (const error of [
  new TypeError("broken reader"),
  Object.assign(new Error("not a database"), { code: "ERR_SQLITE_ERROR", errcode: 26 }),
  Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 }),
  Object.assign(new Error("unrelated system error"), { code: "EAGAIN", errcode: 11 }),
  new Error("litestream restore exited 1: no matching backup files available"),
]) {
  test(`propagates ${error.message}`, () => {
    assert.throws(
      () =>
        readAdditiveControl(() => {
          throw error;
        }),
      (actual) => actual === error,
    );
  });
}

test("records an extended SQLite corruption code", () => {
  const error = Object.assign(new Error("damaged index"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 779,
  });
  assert.deepEqual(
    readAdditiveControl(() => {
      throw error;
    }),
    {
      value: null,
      corruption: "damaged index",
    },
  );
});
