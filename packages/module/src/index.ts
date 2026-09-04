// The entire public surface of @waitron/module. Re-exports only — no logic here.
export type { WaitronModule } from "./module.js";
export { orderedMigrationSets } from "./module.js";
export type { ModuleConfig } from "./config.js";
export { disabledProvisionOnly, enabledModules, isEnabled, parseModuleConfig } from "./config.js";
import "./errors.js";
