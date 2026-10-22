/**
 * Only the files the CLAUDE.md rule names touch `<state>/backup-staging`: the start's clean-up,
 * which runs before any backup run exists, the backup supervisor, which hands the folder to the
 * sweep whose runs take the staging turn, and the free-space deletion, inside `ifNoBackup`.
 *
 * Weaker than its name: it reads TEXT — a non-test `.ts` file under `apps/<app>/src` or
 * `packages/<package>/src` naming `BACKUP_STAGING_DIR` or the literal `"backup-staging"` — so a
 * path built another way escapes it, and it never checks that a listed file takes the turn.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const ALLOWED = [
  "apps/server/src/backup-supervisor.ts",
  "apps/server/src/free-space-now.ts",
  "apps/server/src/start-space.ts",
];

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function srcRoots(): string[] {
  const roots: string[] = [];
  for (const top of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, entry, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // A package with no src folder has nothing to scan.
      }
    }
  }
  return roots;
}

test("only the allowed files name backup staging", () => {
  const touchers = srcRoots()
    .flatMap(sourceFilesIn)
    .filter((file) => /\bBACKUP_STAGING_DIR\b|"backup-staging"/.test(readFileSync(file, "utf8")))
    .map((file) => relative(ROOT, file))
    .sort();
  expect(touchers).toEqual(ALLOWED);
});
