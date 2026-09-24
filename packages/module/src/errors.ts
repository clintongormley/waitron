// A bare import so TypeScript AUGMENTS "@waitron/shared" rather than redeclaring it.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** `reason` is our own English description, never the file content. */
    "module.config_invalid": { reason: string };
    "module.config_unknown": { module: string };
    "module.mandatory_not_disableable": { module: string };
    /** Venue provisioning was attempted while a `provision-only` module is disabled. */
    "module.provision_only_disabled": { module: string };
    /** `module` requires `requires`, which is absent from the set being migrated. */
    "module.dependency_missing": { module: string; requires: string };
    /** `modules` names the members of the dependency graph that could not be ordered. */
    "module.dependency_cycle": { modules: readonly string[] };
    /** `module` requires `dependency` at `required`; `dependency` is at `actual`. */
    "module.incompatible_version": {
      module: string;
      dependency: string;
      required: string;
      actual: string;
    };
    /** `module`'s requirement on `dependency` is not a valid semver range. */
    "module.requires_invalid": { module: string; dependency: string; range: string };
    /** "No regime" is itself a module, never an empty slot. */
    "module.fiscal_slot_empty": Record<string, never>;
    "module.fiscal_slot_ambiguous": { candidates: readonly string[] };
    /** The node's stamped filing module (`stamped`) is not the enabled slot's id (`enabled`): a node
     * provisioned under one regime must not boot under another. */
    "module.fiscal_slot_mismatch": { stamped: string; enabled: string };
    "module.venue_service_empty": Record<string, never>;
    "module.venue_service_ambiguous": { candidates: readonly string[] };
  }
}
