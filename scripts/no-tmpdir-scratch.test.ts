/** Weaker than its name: reads source text; aliases and other spellings escape it. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const root = join(import.meta.dirname, "..");

function forbidden(path: string, text: string): boolean {
  return (
    /^(?:apps|packages)\/[^/]+\/src\/.+\.ts$/.test(path) &&
    !/(?:\.test\.ts$|\/(?:test|testing)\/)/.test(path) &&
    path !== "packages/dashboard-modules/src/setup-assets.ts" &&
    /\btmpdir\s*\(/.test(text)
  );
}

it("production source makes no working folder in the system temporary folder", () => {
  expect(
    ["apps", "packages"]
      .flatMap((top) => sourceFilesIn(root, top))
      .filter((path) => forbidden(path, readFileSync(join(root, path), "utf8"))),
  ).toEqual([]);
});

it("refuses a temporary-folder call but accepts state paths, tests and the build plugin", () => {
  const call = 'mkdtemp(join(tmpdir(), "copy-"))';
  expect(forbidden("apps/server/src/example.ts", call)).toBe(true);
  expect(
    forbidden("apps/server/src/example.ts", 'mkdtemp(join(stateDir, SCRATCH_DIR, "copy-"))'),
  ).toBe(false);
  for (const path of [
    "apps/server/src/example.test.ts",
    "apps/server/src/testing/example.ts",
    "packages/db/src/testing/venue-db.ts",
    "packages/dashboard-modules/src/setup-assets.ts",
  ])
    expect(forbidden(path, call)).toBe(false);
});
