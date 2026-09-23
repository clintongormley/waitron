import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MigrationOptions } from "@waitron/db";
import { AppError } from "@waitron/shared";
import manifest from "../migrations.manifest.json" with { type: "json" };
import "./errors.js";

/**
 * This module's own directory, computed once. From source it is `packages/migrations/src`; inside a
 * bundle esbuild collapses `import.meta.url` to the bundle's own URL, so it is the bundle's
 * directory — the same value the resolution logic used when it was computed per-call, just hoisted
 * to compute-once (it was recomputed once per set inside `migrationOptionsFor`'s `.map()`).
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
 * and installs nothing, which is what the package's own suites do.
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
  // array, shared across every import of this module. Returning it directly would let one
  // caller's mutation (a test fixture doing `sets[0].table = "x"`, say) leak into every other
  // caller's view of the manifest. `appendOnlyTables` is copied rather than spread along, for the
  // same reason one level down.
  return (manifest as MigrationSet[]).map((set) => ({
    ...set,
    appendOnlyTables: [...set.appendOnlyTables],
  }));
}

/**
 * Where a single set's SQL lives, resolved exactly as {@link migrationOptionsFor} resolves it — the
 * `root === null` from-source branch and the bundle-root branch both live here so a second consumer
 * (`expectedSchemaVersion`, which reads `<folder>/meta/_journal.json`) shares one implementation
 * rather than copy-pasting the path logic. The resolution rules — and why the base is
 * `import.meta.url`'s parent, not `process.cwd()` — are documented on {@link migrationOptionsFor}.
 */
export function resolveMigrationsFolder(set: MigrationSetSource, root: string | null): string {
  return root === null
    ? resolve(MANIFEST_DIR, "..", set.from)
    : join(isAbsolute(root) ? root : resolve(MANIFEST_DIR, "..", root), set.name);
}

/**
 * {@link resolveMigrationsFolder} plus the guard that the resolved folder carries a real drizzle
 * journal (`meta/_journal.json`), throwing the classified `migrations.set_missing` when it does not.
 * Shared by {@link migrationOptionsFor} and `expectedSchemaVersion` (`schema-version.ts`) so both use
 * one journal-existence check with one error code and param shape. Package-internal — deliberately
 * NOT on the barrel, same as `resolveMigrationsFolder`.
 *
 * One check collapses two distinct filesystem states into the same rejection: the folder is absent,
 * or the folder exists but carries no `meta/_journal.json` (empty, or populated with something else).
 * That collapse is deliberate — Drizzle's own migrator only rejects the absent case on its own; an
 * empty folder reads to it as "zero migrations", which would boot clean against an unmigrated
 * database and fail later, somewhere else. This refuses both up front, before Drizzle ever sees
 * either.
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
 * `root === null` means "running from source": resolve each `from` against `here`'s parent.
 * Otherwise every set lives at `<root>/<name>` — an ABSOLUTE `root` is used as-is; a RELATIVE one
 * resolves against that same `here`-derived base, never the process's current working directory.
 * The path resolution plus the journal-existence guard live in
 * {@link resolveExistingMigrationsFolder}, shared with `expectedSchemaVersion`; this function maps
 * each resolved folder to its `MigrationOptions`.
 *
 * What that base IS is not a constant, because `here` comes from `import.meta.url`:
 *
 * - **From source** (tests, dev) `here` is `packages/migrations/src`, so a relative root resolves
 *   under `packages/migrations`. `manifest.test.ts`'s "resolves a relative root against this
 *   package" asserts exactly that, against `import.meta.dirname`.
 * - **Inside a bundle** `esbuild --bundle` collapses `import.meta.url` to the BUNDLE's own URL, so
 *   `here` is whatever directory the bundle sits in and a relative root resolves under ITS parent.
 *   Verified against the real artefact rather than reasoned about: `pnpm --filter @waitron/server
 *   build`, then `WAITRON_MIGRATIONS_DIR=relative-migrations-root node dist/server.js` threw
 *   `migrations.set_missing` with
 *   `folder: '<repo>/apps/server/relative-migrations-root/core'` — under `apps/server`, because the
 *   bundle is `apps/server/dist/server.js`. An earlier version of this comment named
 *   `packages/migrations` unconditionally; before the extraction the same sentence named
 *   `apps/server`, which was true of the bundle and false of the source tree. Today's only SHIPPED
 *   form is the bundle, so a reader who takes "`packages/migrations`" literally is wrong about
 *   production.
 *
 * Which shape a caller passes is that caller's own choice, not something this package can assume
 * from its one existing consumer: a caller that
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
 * mode. Only the `migrationsTable` names come from the packages, and `packages/composition/src/composition.test.ts` pins them.
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
