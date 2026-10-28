import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { executeTarget, openImmutableWhenWalEmpty } from "./read-only-database.js";

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "read-only-database-"));
  path = join(dir, "venue.db");
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal; create table t (n integer); insert into t values (7);");
  db.close();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it.each([
  ["no -wal", async () => {}],
  ["an empty -wal", () => writeFile(`${path}-wal`, "")],
])("opens with %s and leaves no side file behind", async (_label, prepare) => {
  await prepare();
  const before = (await readdir(dir)).sort();
  const opened = await openImmutableWhenWalEmpty(path);
  if (opened.kind !== "open") throw new Error(opened.kind);
  try {
    expect(opened.connection.prepare("select n from t").all()).toEqual([{ n: 7 }]);
    expect(() => opened.connection.exec("insert into t values (8)")).toThrow();
  } finally {
    opened.connection.close();
  }
  expect((await readdir(dir)).sort()).toEqual(before);
});

it("does not open when the -wal holds pages", async () => {
  await writeFile(`${path}-wal`, "pages");
  expect(await openImmutableWhenWalEmpty(path)).toEqual({ kind: "wal" });
});

it("answers the stage that failed", async () => {
  expect(await openImmutableWhenWalEmpty(join(path, "venue.db"))).toMatchObject({
    kind: "failed",
    stage: "wal",
    error: expect.objectContaining({ code: "ENOTDIR" }),
  });
  expect(await openImmutableWhenWalEmpty(join(dir, "missing.db"))).toMatchObject({
    kind: "failed",
    stage: "open",
  });
});

it("runs text and bound statements through the execute target", async () => {
  const connection = new DatabaseSync(path, { readOnly: true });
  try {
    const target = executeTarget(connection);
    expect((await target.execute("select n from t")).rows).toEqual([{ n: 7 }]);
    expect((await target.execute(sql`select n + ${1} as n from t`)).rows).toEqual([{ n: 8 }]);
  } finally {
    connection.close();
  }
});
