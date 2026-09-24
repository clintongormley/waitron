import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MigrationOptions } from "@waitron/db";
import { AppError } from "@waitron/shared";
import manifest from "../migrations.manifest.json" with { type: "json" };
import "./errors.js";

/**
 * This module's own directory. From source it is `packages/migrations/src`; inside a bundle esbuild
 * collapses `import.meta.url` to the bundle's own URL, so it is the bundle's directory.
 */
const MANIFEST_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * What `applyMigrations` needs for one set: drizzle's own two fields, plus the tables it must make
 * append-only once that set has run.
 *
 * Declared here rather than beside `MigrationOptions` in `@waitron/db` because `MigrationOptions`
 * is drizzle's migrator config and nothing else — `runMigrations` passes its two fields through by
 * name, so a third would be a field that looks like configuration and is read by nobody. A plain
 * `MigrationOptions[]` is still accepted everywhere this type is asked for; such a caller migrates
 * and installs nothing.
 */
export interface VenueMigrationOptions extends MigrationOptions {
  readonly appendOnlyTables?: readonly string[];
}

/**
 * Where one migration set's SQL lives. What a module DESCRIPTOR declares — everything a caller
 * needs to find and journal a set, and nothing about what the set's tables mean.
 */
export interface MigrationSetSource {
  name: string;
  table: string;
  /** Source folder, relative to this package — used when running from source (tests, dev). */
  from: string;
}

export interface MigrationSet extends MigrationSetSource {
  /**
   * Every table this set creates that its owning module declared with `appendOnly()`, in the order
   * the module declares them. {@link migrationOptionsFor} carries them to `applyMigrations`, which
   * puts the refusal trigger pair on each one after the set has migrated. Not the `ledger` CLASS:
   * `ClassifiedTable.appendOnly` records why those are different sets.
   *
   * Two producers fill it and both have to, because the product reaches `applyMigrations` two ways:
   * `orderedMigrationSets` derives it from the descriptor's `classification` seat, and the manifest
   * JSON repeats it for the callers that have no descriptors to hand (`rejoin-command`, `dev-setup`,
   * `dev-onboard`). `composition.test.ts`'s `toEqual` of those two is what keeps
   * them in step.
   *
   * **Required, so a hand-built set has to state it**, and an empty list is a set that says it owns
   * nothing unrepairable. The type reaches only as far as TypeScript does: `manifestSets()` casts
   * parsed JSON, so a hand-edited entry that drops the key gets a `TypeError` from the copy below
   * rather than a quiet `undefined`. What catches a list that is merely WRONG is that `toEqual` pin,
   * plus `scripts/append-only-triggers.test.ts`, which migrates a real database through
   * `applyMigrations` and tries an update and a delete against every table the modules declare.
   */
  appendOnlyTables: readonly string[];
}

export function manifestSets(): MigrationSet[] {
  // A fresh array of fresh objects on every call: `manifest` is the parsed JSON module's own
  // array, shared across every import of this module, so one caller's mutation would otherwise leak
  // into every other caller's view. `appendOnlyTables` is copied for the same reason one level down.
  return (manifest as MigrationSet[]).map((set) => ({
    ...set,
    appendOnlyTables: [...set.appendOnlyTables],
  }));
}

/** Where a single set's SQL lives; the resolution rules are documented on {@link migrationOptionsFor}. */
export function resolveMigrationsFolder(set: MigrationSetSource, root: string | null): string {
  return root === null
    ? resolve(MANIFEST_DIR, "..", set.from)
    : join(isAbsolute(root) ? root : resolve(MANIFEST_DIR, "..", root), set.name);
}

/**
 * {@link resolveMigrationsFolder} plus the guard that the resolved folder carries a real drizzle
 * journal (`meta/_journal.json`), throwing the classified `migrations.set_missing` when it does not.
 * Package-internal: not on the barrel.
 */
export function resolveExistingMigrationsFolder(
  set: MigrationSetSource,
  root: string | null,
): string {
  const folder = resolveMigrationsFolder(set, root);
  if (!existsSync(join(folder, "meta", "_journal.json"))) {
    throw new AppError("migrations.set_missing", { name: set.name, folder });
  }
  return folder;
}

/**
 * Where each set's SQL actually lives, plus a guard that the folder carries a real journal.
 *
 * `root === null` means "running from source": resolve each `from` against this module's parent
 * directory. Otherwise every set lives at `<root>/<name>` — an ABSOLUTE `root` is used as-is; a
 * RELATIVE one resolves against that same base, never the process's current working directory.
 *
 * That base comes from `import.meta.url`, so it moves: from source a relative root resolves under
 * `packages/migrations`, but inside a bundle it resolves under the bundle's parent directory (for
 * the server bundle, `apps/server`). A relative root is supported deliberately, because
 * `apps/server`'s operator-supplied `WAITRON_MIGRATIONS_DIR` may be one.
 *
 * The `*_MIGRATIONS` descriptors' own `migrationsFolder`s are not used: each is computed from its
 * own `import.meta.url`, which the bundle collapses too, so in the shipped artefact they all resolve
 * to one folder that does not exist. Only the `migrationsTable` names come from the packages, and
 * `packages/composition/src/composition.test.ts` pins them.
 */
export function migrationOptionsFor(
  sets: readonly MigrationSet[],
  root: string | null,
): VenueMigrationOptions[] {
  return sets.map((set) => {
    const migrationsFolder = resolveExistingMigrationsFolder(set, root);
    return { migrationsFolder, migrationsTable: set.table, appendOnlyTables: set.appendOnlyTables };
  });
}
