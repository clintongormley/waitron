import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { executeTarget, openImmutable, openImmutableWhenWalEmpty } from "./read-only-database.js";

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

it("openImmutable reads the main file alone, past a row committed only in the -wal, and changes no file", async () => {
  const writer = new DatabaseSync(path);
  const aside = await mkdtemp(join(tmpdir(), "read-only-database-wal-"));
  try {
    writer.exec("pragma wal_autocheckpoint = 0; insert into t values (8)");
    // A clean close checkpoints the row into the main file; copies taken while open keep it in
    // the -wal.
    for (const name of ["venue.db", "venue.db-wal"])
      await copyFile(join(dir, name), join(aside, name));
  } finally {
    writer.close();
  }
  for (const name of ["venue.db", "venue.db-wal"])
    await copyFile(join(aside, name), join(dir, name));
  await rm(aside, { recursive: true, force: true });
  const withWal = new DatabaseSync(path, { readOnly: true });
  try {
    expect(withWal.prepare("select n from t order by n").all()).toEqual([{ n: 7 }, { n: 8 }]);
  } finally {
    withWal.close();
  }
  const before = await Promise.all(
    (await readdir(dir)).sort().map(async (name) => [name, await readFile(join(dir, name))]),
  );
  const connection = openImmutable(path);
  try {
    expect(connection.prepare("select n from t order by n").all()).toEqual([{ n: 7 }]);
  } finally {
    connection.close();
  }
  expect(
    await Promise.all(
      (await readdir(dir)).sort().map(async (name) => [name, await readFile(join(dir, name))]),
    ),
  ).toEqual(before);
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
