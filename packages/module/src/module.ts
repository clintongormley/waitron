import semver from "semver";
import { AppError } from "@waitron/shared";
import type { MigrationSet } from "@waitron/migrations";
import type { EnrolledTable } from "@waitron/sync-enrolment";
import type { FiscalContribution } from "@waitron/fiscal";
import type { ModuleProvisioning } from "./provisioning.js";
import "./errors.js";

/** A reference to non-DB state a module owns, resolved to a path by the composition root. */
export type NonDbSource = { readonly kind: "content-addressed-dir"; readonly source: string };

/** A module's backup contribution: what non-DB state it owns and (later) how to restore it. */
export interface ModuleBackupContribution {
  readonly nonDbState?: readonly NonDbSource[];
  readonly restore?: unknown; // seat — a root-wired hook; body lands in BR-3/BR-4
}

/**
 * A module descriptor: a plain object the composition root collects into a list, deriving each surface
 * (migrations here; routes/workers/cards/… in later slices) by mapping over it. There is no global
 * registry and no `register()` side effect.
 *
 * The descriptors are assembled in one list, `@waitron/composition`'s `ALL_MODULES`; each owning
 * package exports the VALUES its seats carry (enrolment, vocabulary, provisioning, fiscal) and never
 * the descriptor itself.
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
  // Typed `unknown` on purpose: keeping @waitron/module from depending on layouts/scheduler/identity
  // yet. Each slice tightens its own field's type when it lands. NOT sloppiness — the spec
  // (§3) records these as the deferred slices' seats.
  /** SP-2a: the tables this module enrols into @waitron/sync, declared BY the owning package. The
   * first deferred seat to gain its real type; the composition root assembles every module's enrolment
   * and injects it, so @waitron/sync imports no domain schema (spec §2/§5). */
  readonly sync?: readonly EnrolledTable[];
  readonly cards?: unknown; // SP-4
  /** SP-3b: the domain terms this module OWNS — legitimate inside its own package (derived from
   * `migrations.from`, `../<pkg>/drizzle`), forbidden in every generic package. Tokens, not words:
   * lowercase ASCII, unaccented, singular and plural separately, nothing stemmed. Interpreted only
   * by the root english-only suite, which unions every declaration with the guard's base list and
   * asserts the two are disjoint; no runtime consumer. Omit the seat rather than declare `[]`. */
  readonly vocabulary?: readonly string[];
  readonly permissions?: readonly string[];
  readonly duties?: unknown; // cronjobs
  readonly theme?: unknown;
  /** What this module seeds per node at provisioning, and how it takes part in standing up a
   * standby. Run by `@waitron/provisioning` and the composition root inside their transactions. */
  readonly provisioning?: ModuleProvisioning;
  /** The module's contribution to the fiscal slot — `fiscalSlot` selects exactly one. */
  readonly fiscal?: FiscalContribution;
  readonly routes?: unknown; // incremental
  readonly backup?: ModuleBackupContribution; // BR-2: non-DB state a backup must capture
}

/** The dependencies a module declares — its `requires.core` (a dep on "core") plus every
 * `requires.modules` entry — each as `[dependencyName, semverRange]`. A module with no `requires`
 * declares no dependencies, so it starts ready to emit, nothing to wait on (e.g. core). */
function* requiredEdges(m: WaitronModule): Iterable<readonly [string, string]> {
  if (m.requires?.core !== undefined) yield ["core", m.requires.core];
  for (const [dep, range] of Object.entries(m.requires?.modules ?? {})) yield [dep, range];
}

/**
 * Resolve, validate, and order the migration sets (spec §5). Pure — no DB, no I/O.
 *
 * The list order is NO LONGER the migration order (SP-1a); the order is DERIVED from each module's
 * declared `requires` graph. This single entry point validates the set (version compatibility +
 * dependency presence + no cycle) and returns the sets in a stable topological order, so boot's one
 * call site cannot skip the check. Kahn's algorithm with the INPUT list order as the tie-break among
 * ready nodes reproduces today's manifest order for `ALL_MODULES` (spec §5 trace; the SP-1a pin holds
 * and now also proves the sort reproduces the manifest).
 *
 * Throws (loud, before any caller migrates): `module.requires_invalid` (a malformed range — a
 * descriptor bug), `module.dependency_missing` (a required module absent from the set — trippable
 * today via modules.json, spec §4), `module.incompatible_version` (present but version out of range),
 * `module.dependency_cycle` (the graph does not drain).
 */
export function orderedMigrationSets(modules: readonly WaitronModule[]): MigrationSet[] {
  const byName = new Map(modules.map((m) => [m.name, m]));

  // 1. Validate every declared edge: range well-formed, dependency present, version satisfied.
  //    validRange first (a descriptor bug is independent of the set); presence before satisfies
  //    (an absent module has no version to compare — spec §5).
  for (const m of modules) {
    for (const [dep, range] of requiredEdges(m)) {
      if (semver.validRange(range) === null) {
        throw new AppError("module.requires_invalid", { module: m.name, dependency: dep, range });
      }
      const target = byName.get(dep);
      if (target === undefined) {
        throw new AppError("module.dependency_missing", { module: m.name, requires: dep });
      }
      if (!semver.satisfies(target.version, range)) {
        throw new AppError("module.incompatible_version", {
          module: m.name,
          dependency: dep,
          required: range,
          actual: target.version,
        });
      }
    }
  }

  // 2. Kahn topological sort. Edges point dependency → dependent, so a module's IN-DEGREE is the
  //    number of dependencies it still waits on; `dependents[d]` lists the modules that require `d`
  //    (the edges to decrement when `d` is emitted).
  const inDegree = new Map<string, number>(modules.map((m) => [m.name, 0]));
  const dependents = new Map<string, string[]>();
  for (const m of modules) {
    for (const [dep] of requiredEdges(m)) {
      // `m.name` is always a key: inDegree is seeded for every module above.
      inDegree.set(m.name, inDegree.get(m.name)! + 1);
      const list = dependents.get(dep) ?? [];
      list.push(m.name);
      dependents.set(dep, list);
    }
  }

  // Repeatedly emit the EARLIEST-in-input-order ready (in-degree 0) module, removing it from a
  // shrinking `remaining` list. `findIndex` over `remaining` — which preserves input order — is the
  // stable tie-break: it always picks the lowest input index among the ready set. O(V^2) scans for V
  // modules — V is the module count (≤ a dozen), so this is negligible. A scan that finds nothing
  // ready while modules remain means the graph has a cycle: those `remaining` modules are exactly the
  // ones that could not be ordered.
  const ordered: WaitronModule[] = [];
  const remaining = modules.slice();
  for (;;) {
    const idx = remaining.findIndex((m) => inDegree.get(m.name) === 0);
    if (idx === -1) break;
    const [next] = remaining.splice(idx, 1);
    ordered.push(next);
    for (const d of dependents.get(next.name) ?? []) {
      // `d` is a requiring module's name, so it is always a seeded inDegree key.
      inDegree.set(d, inDegree.get(d)! - 1);
    }
  }

  if (remaining.length > 0) {
    throw new AppError("module.dependency_cycle", { modules: remaining.map((m) => m.name) });
  }

  return ordered.map((m) => m.migrations);
}

/** `../<pkg>/drizzle` — the shape every descriptor's `migrations.from` has (spec §4). */
const MIGRATIONS_FROM = /^\.\.\/([^/]+)\/drizzle$/;

/**
 * The `packages/<dir>` a module's package lives in, derived from `migrations.from`. The one place
 * that PARSES that string to recover the package directory — the root guards (english-only,
 * module-graph-honesty) map descriptors to package dirs through it; `@waitron/migrations`'s
 * `resolveMigrationsFolder` resolves the same string as an opaque path. Throws on any other shape —
 * a derivation that silently skipped would exempt nothing and scan nothing.
 */
export function packageDirOf(module: WaitronModule): string {
  const match = MIGRATIONS_FROM.exec(module.migrations.from);
  if (match === null) {
    throw new Error(
      `module ${module.name}: migrations.from (${module.migrations.from}) is not ../<pkg>/drizzle`,
    );
  }
  return match[1]!;
}
