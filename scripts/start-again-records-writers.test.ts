/**
 * Only the allowed files name the Keep-or-Move choice records or the set-aside folder, so nothing else in the product can delete them (A1042, A1098: only
 * `waitron.sh reset --all` removes them).
 *
 * Weaker than its name: it reads TEXT in the `.ts`, `.mjs` and `.sh` files `git ls-files` lists,
 * skipping test files, so a path built from pieces escapes it; it never checks what an allowed
 * file does with the name, nor code that removes the whole state folder, or everything in it,
 * without naming the file. It does not see RECORDS_DIR joined with a sub-name.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const GIT_SPAWN_TIMEOUT_MS = 30_000;

const ALLOWED = [
  "packages/handover/src/manifest.ts", // Declares names; writes nothing.
  "packages/provisioning/src/first-setup-start-again-choice.ts",
  "packages/provisioning/src/first-setup-start-again-names.ts",
  "packages/provisioning/src/first-setup-start-again-set-aside.ts",
  "packages/provisioning/src/index.ts",
  "packages/store/src/state-layout.ts",
];

const NAMES =
  /\bSTART_AGAIN_CHOICES_DIR\b|\bSTART_AGAIN_SET_ASIDE_DIR\b|["'`]records\/|first-setup-set-aside/;

function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ]) {
    delete env[name];
  }
  return env;
}

function trackedSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    env: isolatedGitEnv(),
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => /\.(ts|mjs|sh)$/.test(file) && !/\.test\.(ts|mjs)$/.test(file))
    .filter((file) => {
      // A tracked file deleted in the working tree, or a directory a failing browser test names
      // `*.test.ts`, is not a file to read.
      try {
        return statSync(join(ROOT, file)).isFile();
      } catch {
        return false;
      }
    });
}

test("only the allowed files name the choice records or the set-aside folder", () => {
  const naming = trackedSourceFiles()
    .filter((file) => NAMES.test(readFileSync(join(ROOT, file), "utf8")))
    .sort();
  expect(naming).toEqual(ALLOWED);
}, 60_000);
