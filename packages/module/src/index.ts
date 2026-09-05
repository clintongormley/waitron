// The entire public surface of @waitron/module. Re-exports only — no logic here.
export type { WaitronModule, NonDbSource, ModuleBackupContribution } from "./module.js";
export { orderedMigrationSets, packageDirOf } from "./module.js";
export type { VocabularyOwner } from "./vocabulary.js";
export { forbiddenVocabulary, vocabularyOwners } from "./vocabulary.js";
export type { ModuleConfig } from "./config.js";
export {
  disabledProvisionOnly,
  enabledModules,
  isEnabled,
  parseModuleConfig,
  parseModuleOverrides,
  serializeModuleConfig,
} from "./config.js";
export type { Reconciliation } from "./reconcile.js";
export { reconcile } from "./reconcile.js";
import "./errors.js";
