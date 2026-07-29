import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MigrationOptions } from "@waitron/db";
import { AppError } from "@waitron/shared";
import manifest from "../migrations.manifest.json" with { type: "json" };
import "./errors.js";

export interface MigrationSet {
  name: string;
  table: string;
  /** Source folder, relative to this package — used when running from source (tests, dev). */
  from: string;
}

export function manifestSets(): MigrationSet[] {
  // A fresh array of fresh objects on every call: `manifest` is the parsed JSON module's own
  // array, shared across every import of this module. Returning it directly would let one
  // caller's mutation (a test fixture doing `sets[0].table = "x"`, say) leak into every other
  // caller's view of the manifest.
  return (manifest as MigrationSet[]).map((set) => ({ ...set }));
}

/**
 * Where each set's SQL actually lives.
 *
 * `root === null` means "running from source": resolve each `from` against this package. Otherwise
 * every set lives at `<root>/<name>` — an ABSOLUTE `root` is used as-is; a RELATIVE one resolves
 * against this package's own directory (`packages/migrations`), the same base the from-source branch
 * uses, never the process's current working directory. Which shape a caller passes is that caller's
 * own choice, not something this package can assume from its one existing consumer: a caller that
 * builds an absolute path beside its own bundle (`apps/server`'s `scripts/copy-migrations.mjs` does
 * this) never exercises the relative case, while a caller relaying an operator-supplied value —
 * `apps/server`'s `WAITRON_MIGRATIONS_DIR` is one such value — may be relaying a relative one,
 * supported deliberately, not rejected. Worth stating precisely regardless of who exercises it: a
 * wrong assumption about the resolution base fails silently into the wrong folder rather than
 * failing loud.
 *
 * The indirection is not taste. Every `*_MIGRATIONS` descriptor computes `migrationsFolder` from its
 * own `import.meta.url`; esbuild collapses all five modules into one file, so all five resolve to
 * `dist/../drizzle` — a folder that does not exist. Using the descriptors directly therefore works
 * in development and fails at boot in the shipped artefact, which is the worst available failure
 * mode. Only the `migrationsTable` names come from the packages, and `manifest.test.ts` pins them.
 */
export function migrationOptionsFor(
  sets: readonly MigrationSet[],
  root: string | null,
): MigrationOptions[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return sets.map((set) => {
    const migrationsFolder =
      root === null
        ? resolve(here, "..", set.from)
        : join(isAbsolute(root) ? root : resolve(here, "..", root), set.name);
    // One check collapses two distinct filesystem states into the same rejection: the folder is
    // absent, or the folder exists but carries no `meta/_journal.json` (empty, or populated with
    // something else). That collapse is deliberate — Drizzle's own migrator only rejects the
    // absent case on its own; an empty folder reads to it as "zero migrations", which would boot
    // clean against an unmigrated database and fail later, somewhere else. This check refuses both
    // up front, before Drizzle ever sees either.
    if (!existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
      throw new AppError("server.migrations_missing", { name: set.name, folder: migrationsFolder });
    }
    return { migrationsFolder, migrationsTable: set.table };
  });
}
