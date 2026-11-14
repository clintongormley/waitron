import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { MOVES, main, movedPath, run } from "./rename-catalogue-paths.mjs";

const roots = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "wt-a1308-paths-"));
  roots.push(root);
  git(root, "init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Path test",
    "-c",
    "user.email=paths@example.test",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  );
  return root;
}
const read = (root, path) => readFileSync(join(root, path), "utf8");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("moves tracked files with git while leaving untracked dependencies in place", () => {
  const root = fixture({ "packages/catalogue/src/a.ts": "export const value = 1;" });
  mkdirSync(join(root, "packages/catalogue/node_modules"));
  writeFileSync(join(root, "packages/catalogue/node_modules/x"), "untracked");
  expect(run({ root, moves: [["packages/catalogue/", "packages/menu/"]] })).toMatchObject({
    moved: 1,
    rewrote: 0,
  });
  expect(read(root, "packages/menu/src/a.ts")).toBe("export const value = 1;");
  expect(read(root, "packages/catalogue/node_modules/x")).toBe("untracked");
  expect(git(root, "status", "--porcelain")).toContain(
    "R  packages/catalogue/src/a.ts -> packages/menu/src/a.ts",
  );
});

it("preserves an import to an unmoved neighbour when the importer moves", () => {
  const root = fixture({
    "apps/server/src/catalogue-api.ts": 'import { log } from "./logger.js";',
    "apps/server/src/logger.ts": "export const log = 1;",
  });
  run({ root });
  expect(read(root, "apps/server/src/menu-api.ts")).toBe('import { log } from "./logger.js";');
});

it("resolves static, dynamic, mock and URL imports from the old targets", () => {
  const root = fixture({
    "packages/db/src/schema/index.ts": [
      'export * from "./catalogue/index.js";',
      'import("./catalogue.js");',
      'vi.mock("./catalogue.js");',
      'new URL("./catalogue/index.ts", import.meta.url);',
      'import "./catalogue/index.js";',
      'export * from "./catalogue";',
    ].join("\n"),
    "packages/db/src/schema/catalogue/index.ts": 'export * from "../catalogue.js";',
    "packages/db/src/schema/catalogue.ts": "export const value = 1;",
  });
  run({ root });
  expect(read(root, "packages/db/src/schema/index.ts")).toBe(
    [
      'export * from "./menu/index.js";',
      'import("./menus.js");',
      'vi.mock("./menus.js");',
      'new URL("./menu/index.ts", import.meta.url);',
      'import "./menu/index.js";',
      'export * from "./menus";',
    ].join("\n"),
  );
  expect(read(root, "packages/db/src/schema/menu/index.ts")).toBe('export * from "../menus.js";');
});

it("recalculates imports when the importer changes depth and the target stays", () => {
  const root = fixture({
    "apps/server/src/old.ts": 'import "./logger.js"; import("./missing.js");',
    "apps/server/src/logger.ts": "export {};",
  });
  run({ root, moves: [["apps/server/src/old.ts", "apps/server/src/nested/new.ts"]] });
  expect(read(root, "apps/server/src/nested/new.ts")).toBe(
    'import "../logger.js"; import("./missing.js");',
  );
});

it("rewrites package specifiers, subpaths and folder paths without matching longer names", () => {
  const root = fixture({
    "apps/server/src/a.ts": [
      "\"@waitron/catalogue\" '@waitron/catalogue/src/errors.js' `@waitron/catalogue`",
      '"@waitron/db/schema/catalogue.js" "@waitron/catalogue-x" "x@waitron/catalogue"',
      'see packages/catalogue. "packages/catalogue" packages/catalogue/src/a.ts',
      "packages/catalogue-x xpackages/catalogue packages/catalogues",
    ].join("\n"),
  });
  run({ root });
  expect(read(root, "apps/server/src/a.ts")).toBe(
    [
      "\"@waitron/menu\" '@waitron/menu/src/errors.js' `@waitron/menu`",
      '"@waitron/db/schema/menu.js" "@waitron/catalogue-x" "x@waitron/catalogue"',
      'see packages/menu. "packages/menu" packages/menu/src/a.ts',
      "packages/catalogue-x xpackages/catalogue packages/catalogues",
    ].join("\n"),
  );
});

it("rewrites package-relative paths and bare filenames only in the owning package", () => {
  const input = '"src/catalogue-api.test.ts" "catalogue-api.test.ts" "catalogue-api.test.ts-extra"';
  const root = fixture({
    "apps/server/src/catalogue-api.test.ts": "test();",
    "apps/server/test-durations.json": input,
    "apps/server/src/testing/m.ts": input,
    "packages/db/x.json": input,
    "README.md": "apps/server/src/catalogue-api.test.ts",
  });
  run({ root });
  const expected = '"src/menu-api.test.ts" "menu-api.test.ts" "catalogue-api.test.ts-extra"';
  expect(read(root, "apps/server/test-durations.json")).toBe(expected);
  expect(read(root, "apps/server/src/testing/m.ts")).toBe(expected);
  expect(read(root, "packages/db/x.json")).toBe(input);
  expect(read(root, "README.md")).toBe("apps/server/src/menu-api.test.ts");
});

it("rewrites the db export key and value without changing another package's key", () => {
  const input = '{"./schema/catalogue.js":"./src/schema/catalogue/index.ts"}';
  const root = fixture({ "packages/db/package.json": input, "packages/other/package.json": input });
  run({ root });
  expect(read(root, "packages/db/package.json")).toBe(
    '{"./schema/menu.js":"./src/schema/menu/index.ts"}',
  );
  expect(read(root, "packages/other/package.json")).toBe(input);
});

it("leaves prose without paths byte-identical when the package moves", () => {
  const root = fixture({
    "packages/catalogue/src/a.ts": "catalogue CatalogueScreen catalogues menu",
  });
  run({ root });
  expect(read(root, "packages/menu/src/a.ts")).toBe("catalogue CatalogueScreen catalogues menu");
});

it("leaves excluded, historical, out-of-scope and binary files alone", () => {
  const paths = [
    "packages/catalogue/drizzle/0000_baseline.sql",
    "scripts/migration-baseline-epoch.json",
    "pnpm-lock.yaml",
    "packages/country-es/test-fixtures/demo/x.json",
    "packages/country-es/src/data/sources/x.xml",
    "apps/server/src/testing/fixtures/x.json",
    "scripts/a1308/old.mjs",
    "docs/superpowers/x.md",
    "docs/operations/x.md",
    "docs/compliance/x.md",
    "docs/handoffs/x.md",
    "outside.txt",
  ];
  const input = "packages/catalogue/ @waitron/catalogue";
  const root = fixture({
    ...Object.fromEntries(paths.map((path) => [path, input])),
    "apps/binary.dat": Buffer.from(`${input}\0`),
  });
  run({ root });
  for (const path of paths) expect(read(root, movedPath(path) ?? path), path).toBe(input);
  expect(readFileSync(join(root, "apps/binary.dat"))).toEqual(Buffer.from(`${input}\0`));
});

it("keeps the guide and job inventory filenames and their imports", () => {
  const root = fixture({
    "apps/server/src/guide-catalogue.ts": "export {};",
    "apps/server/src/job-catalogue.ts": "export {};",
    "apps/server/src/x.ts": 'import "./guide-catalogue.js"; import "./job-catalogue.js";',
  });
  expect(run({ root })).toMatchObject({ moved: 0, rewrote: 0 });
  expect(read(root, "apps/server/src/x.ts")).toBe(
    'import "./guide-catalogue.js"; import "./job-catalogue.js";',
  );
});

it("runs twice without changing the first output or its git status", () => {
  const root = fixture({
    "packages/catalogue/src/catalogue-items.ts": 'import "@waitron/catalogue";',
  });
  expect(run({ root })).toMatchObject({ moved: 1, rewrote: 1 });
  const status = git(root, "status", "--porcelain");
  expect(read(root, "packages/menu/src/product-items.ts")).toBe('import "@waitron/menu";');
  expect(run({ root })).toMatchObject({ moved: 0, rewrote: 0 });
  expect(git(root, "status", "--porcelain")).toBe(status);
});

it("refuses an existing destination before moving any file", () => {
  const root = fixture({
    "packages/catalogue/src/a.ts": "first",
    "packages/catalogue/src/b.ts": "old",
    "packages/menu/src/b.ts": "new",
  });
  expect(() => run({ root })).toThrow(/packages\/catalogue\/src\/b.ts.*packages\/menu\/src\/b.ts/);
  expect(git(root, "status", "--porcelain")).toBe("");
  expect(existsSync(join(root, "packages/menu/src/a.ts"))).toBe(false);
});

it("previews all moves and rewritten files without writing", () => {
  const root = fixture({ "packages/catalogue/src/a.ts": 'import "@waitron/catalogue";' });
  const result = run({ root, dryRun: true });
  expect(result).toMatchObject({ moved: 1, rewrote: 1 });
  expect(result.planned).toContain("packages/catalogue/src/a.ts -> packages/menu/src/a.ts");
  expect(result.planned).toContain("rewrite packages/menu/src/a.ts (1 changed lines)");
  expect(git(root, "status", "--porcelain")).toBe("");
  expect(read(root, "packages/catalogue/src/a.ts")).toBe('import "@waitron/catalogue";');
});

it("maps each ordered row and does not match longer exact filenames", () => {
  for (const [from, to] of MOVES) {
    const suffix = from.endsWith("/") ? "x.ts" : from.endsWith("*") ? ".test.ts" : "";
    expect(movedPath(from.replace(/\*$/, "") + suffix)).toBe(to.replace(/\*$/, "") + suffix);
  }
  expect(movedPath("packages/db/src/schema/catalogue.ts-extra")).toBe(null);
});

it("prints its summary and dry-run details when executed directly", () => {
  const root = fixture({ "packages/catalogue/src/a.ts": 'import "@waitron/catalogue";' });
  const command = (args) =>
    execFileSync(
      process.execPath,
      [new URL("./rename-catalogue-paths.mjs", import.meta.url).pathname, ...args],
      { cwd: root, env, encoding: "utf8" },
    );
  expect(command(["--dry-run"])).toContain("packages/catalogue/src/a.ts -> packages/menu/src/a.ts");
  expect(git(root, "status", "--porcelain")).toBe("");
  expect(command([])).toBe("moved 1, rewrote 1\n");
  expect(command([])).toBe("moved 0, rewrote 0\n");
});

it("prints each preview entry before its summary", () => {
  const root = fixture({ "packages/catalogue/src/a.ts": 'import "@waitron/catalogue";' });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    main(["--dry-run"], root);
    expect(output.mock.calls.map(([line]) => line)).toEqual([
      "packages/catalogue/src/a.ts -> packages/menu/src/a.ts",
      "rewrite packages/menu/src/a.ts (1 changed lines)",
      "moved 1, rewrote 1",
    ]);
    expect(git(root, "status", "--porcelain")).toBe("");
    output.mockClear();
    main([], root);
    expect(read(root, "packages/menu/src/a.ts")).toBe('import "@waitron/menu";');
    expect(output.mock.calls).toEqual([["moved 1, rewrote 1"]]);
  } finally {
    output.mockRestore();
  }
});
