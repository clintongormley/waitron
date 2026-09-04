import type { MigrationSet } from "@waitron/migrations";

/**
 * A module descriptor: a plain object a domain package exports and the composition root collects.
 *
 * There is no global registry and no `register()` side effect — the composition root assembles the
 * descriptors into a list and derives each surface (migrations here; routes/workers/cards/… in later
 * slices) by mapping over that list.
 */
export interface WaitronModule {
  /** Stable id; equals the migration-set name (`migrations.name`). NOT the drizzle table suffix —
   * that is `migrations.table`, usually `__drizzle_migrations_<name>` but not always (e.g. the `core`
   * set's table is `__drizzle_migrations_db`). */
  readonly name: string;
  /** Module version. Every package is 0.0.0 today (workspace-locked); real once modules distribute. */
  readonly version: string;
  /** Compatibility — recorded now, enforced in SP-1c. Inert while everything is workspace-locked. */
  readonly requires?: {
    readonly core?: string;
    readonly modules?: Readonly<Record<string, string>>;
  };
  /** mandatory (core) | provision-only (fiscal) | toggleable (rest). Recorded now; acted on in SP-1b. */
  readonly tier: "mandatory" | "provision-only" | "toggleable";
  /** Manifest-shaped migration info — NOT an import.meta.url-derived folder (spec §4). */
  readonly migrations: MigrationSet;

  // --- Seats for later slices; declared now, unpopulated here. ---
  // Typed `unknown` on purpose: keeping @waitron/module from depending on sync/layouts/scheduler/
  // identity yet. Each slice tightens its own field's type when it lands. NOT sloppiness — the spec
  // (§3) records these as the deferred slices' seats.
  readonly sync?: unknown; // SP-2
  readonly cards?: unknown; // SP-4
  readonly vocabulary?: readonly string[];
  readonly permissions?: readonly string[];
  readonly duties?: unknown; // cronjobs
  readonly theme?: unknown;
  readonly provisioningSeeds?: unknown; // SP-1b
  readonly routes?: unknown; // incremental
}

/**
 * The migration sets to run, in the composition list's order.
 *
 * The list order IS the migration order for this slice (spec §4): SP-1c replaces it with a derived
 * dependency graph. The `from`-path resolution and the `set_missing` guard stay in
 * `@waitron/migrations`' `migrationOptionsFor` — this helper only supplies the ordered set list.
 */
export function orderedMigrationSets(modules: readonly WaitronModule[]): MigrationSet[] {
  return modules.map((m) => m.migrations);
}
