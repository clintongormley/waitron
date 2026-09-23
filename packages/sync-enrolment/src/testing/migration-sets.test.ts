import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { filesUnder, headSnapshot, migrationSets, migrationSqlFiles } from "./migration-sets.js";

/** A throwaway repository root holding exactly the files a case writes into it. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "migration-sets-"));
  fixtureRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

const journal = (...idx: number[]): string =>
  JSON.stringify({ entries: idx.map((i) => ({ idx: i, tag: `${i}_x` })) });

describe("filesUnder", () => {
  it("lists regular files in nested directories, relative to the root and sorted", () => {
    const root = fixtureRoot({ "b.txt": "", "a/z.sql": "", "a/deeper/y.json": "" });
    expect(filesUnder(root)).toEqual([join("a", "deeper", "y.json"), join("a", "z.sql"), "b.txt"]);
  });

  // A socket is neither a directory nor a regular file: listing it would hand a reader a path that
  // cannot be read as a file.
  it("skips an entry that is neither a directory nor a regular file", async () => {
    const root = fixtureRoot({ "kept.sql": "" });
    const server = createServer();
    await new Promise<void>((done) => server.listen(join(root, "s.sock"), done));
    try {
      expect(filesUnder(root)).toEqual(["kept.sql"]);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe("migrationSets", () => {
  it("finds a drizzle directory under packages and under apps, repo-relative and sorted", () => {
    const root = fixtureRoot({
      "packages/zeta/drizzle/meta/_journal.json": journal(),
      "packages/alpha/drizzle/0000_x.sql": "",
      "apps/server/drizzle/0000_x.sql": "",
      "packages/no-set/src/index.ts": "",
    });
    expect(migrationSets(root)).toEqual([
      join("apps", "server", "drizzle"),
      join("packages", "alpha", "drizzle"),
      join("packages", "zeta", "drizzle"),
    ]);
  });

  it("does not count a FILE named drizzle as a migration set", () => {
    const root = fixtureRoot({
      "packages/fake/drizzle": "not a directory",
      "apps/real/drizzle/meta/_journal.json": journal(),
    });
    expect(migrationSets(root)).toEqual([join("apps", "real", "drizzle")]);
  });
});

describe("headSnapshot", () => {
  const set = join("packages", "p", "drizzle");

  it("reports a set with no journal as missing", () => {
    const root = fixtureRoot({ "packages/p/drizzle/0000_x.sql": "" });
    expect(headSnapshot(root, set)).toEqual({ kind: "missing" });
  });

  it("reports a journal with no entries as empty", () => {
    const root = fixtureRoot({ "packages/p/drizzle/meta/_journal.json": journal() });
    expect(headSnapshot(root, set)).toEqual({ kind: "empty" });
  });

  it("reports a head whose snapshot is not on disk as missing", () => {
    const root = fixtureRoot({
      "packages/p/drizzle/meta/_journal.json": journal(0, 1),
      "packages/p/drizzle/meta/0000_snapshot.json": "{}",
    });
    expect(headSnapshot(root, set)).toEqual({ kind: "missing" });
  });

  // The entries are written out of order, so a reader taking the LAST entry would answer 0000.
  it("names the snapshot of the HIGHEST idx, not of the last entry, repo-relative", () => {
    const root = fixtureRoot({
      "packages/p/drizzle/meta/_journal.json": journal(0, 11, 2),
      "packages/p/drizzle/meta/0000_snapshot.json": "{}",
      "packages/p/drizzle/meta/0002_snapshot.json": "{}",
      "packages/p/drizzle/meta/0011_snapshot.json": "{}",
    });
    expect(headSnapshot(root, set)).toEqual({
      kind: "file",
      path: join(set, "meta", "0011_snapshot.json"),
    });
  });
});

describe("migrationSqlFiles", () => {
  it("walks nested directories, keeps only .sql files, and sorts repo-relative paths", () => {
    const root = fixtureRoot({
      "packages/p/drizzle/0001_b.sql": "",
      "packages/p/drizzle/0000_a.sql": "",
      "packages/p/drizzle/nested/0002_c.sql": "",
      "packages/p/drizzle/meta/_journal.json": journal(0),
      "packages/p/drizzle/notes.txt": "",
    });
    const set = join("packages", "p", "drizzle");
    expect(migrationSqlFiles(root, set)).toEqual([
      join(set, "0000_a.sql"),
      join(set, "0001_b.sql"),
      join(set, "nested", "0002_c.sql"),
    ]);
  });
});
