// A bare side-effect import so TypeScript treats "@waitron/shared" as a module to AUGMENT rather
// than redeclare — the same idiom packages/migrations/src/errors.ts uses.
import "@waitron/shared";

/**
 * The module system's contribution to the shared error registry, by declaration merging. The
 * convention is the DOMAIN CONCEPT (name the concept, not the throwing package —
 * packages/shared/src/errors.ts) — `module.*` because these are facts about the module-enablement
 * system. This package is generic (english-only-scanned): the codes name no specific module.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The on-box modules.json could not be parsed — not an object, `modules` not an object, or a
     * value that is not a boolean. `reason` is our own English description, never the file content. */
    "module.config_invalid": { reason: string };
    /** modules.json names a module that is not in the module list — a typo we refuse rather than
     * silently ignore. `module` is the offending key. */
    "module.config_unknown": { module: string };
    /** modules.json tried to disable a `mandatory`-tier module (core today); a mandatory module can
     * never be disabled. `module` is the one that was refused — named from the descriptor's `tier`,
     * so this generic code hardcodes no module. */
    "module.mandatory_not_disableable": { module: string };
    /** Venue provisioning was attempted while a `provision-only` module (fiscal today) is disabled.
     * `module` is the disabled provision-only module. Refused before any chain is minted (spec §4). */
    "module.provision_only_disabled": { module: string };
    /** A migrating module declares a dependency (its `requires.core` or a `requires.modules` entry)
     * that is not present in the set being migrated — e.g. `workforce` enabled while `identity`
     * (which owns `persons`, a table workforce FKs) is disabled. Refused before the first migration
     * runs (spec §4), turning a cryptic mid-run FK failure into a clear pre-migration refusal.
     * `module` requires `requires`. */
    "module.dependency_missing": { module: string; requires: string };
    /** The module dependency graph has a cycle; `modules` names the members that could not be
     * ordered. Unreachable with today's graph (a tree rooted at core), guarded against a future
     * cross-set edit that introduces one. */
    "module.dependency_cycle": { modules: readonly string[] };
    /** A dependency is present but its `version` does not satisfy the declared semver `range`.
     * Never tripped today (every range is `"*"` against `0.0.0`); real once modules distribute
     * independently. `module` requires `dependency` `required`; `dependency` is at `actual`. */
    "module.incompatible_version": {
      module: string;
      dependency: string;
      required: string;
      actual: string;
    };
    /** A `requires` range string is not a valid semver range — a descriptor (code) bug, failed loud
     * rather than silently treated as "any". `module`'s requirement on `dependency` used `range`. */
    "module.requires_invalid": { module: string; dependency: string; range: string };
    /** No enabled module contributes to the fiscal slot. A trading node needs one; "no regime" is
     * itself a module, never an absent slot. */
    "module.fiscal_slot_empty": Record<string, never>;
    /** More than one enabled module contributes to the fiscal slot; `candidates` names them. */
    "module.fiscal_slot_ambiguous": { candidates: readonly string[] };
    /** The node's stamped filing module (`stamped`) is not the enabled slot's id (`enabled`): a node
     * provisioned under one regime must not boot under another. */
    "module.fiscal_slot_mismatch": { stamped: string; enabled: string };
  }
}
