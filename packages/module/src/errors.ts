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
    /** modules.json set `core: false`; `core` is mandatory and can never be disabled. */
    "module.core_not_disableable": Record<string, never>;
    /** Venue provisioning was attempted while a `provision-only` module (fiscal today) is disabled.
     * `module` is the disabled provision-only module. Refused before any chain is minted (spec §4). */
    "module.provision_only_disabled": { module: string };
  }
}
