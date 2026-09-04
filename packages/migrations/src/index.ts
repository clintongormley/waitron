// The public surface of @waitron/migrations. Re-exports only — no logic here.
export { manifestSets, migrationOptionsFor, resolveMigrationsFolder } from "./manifest.js";
export type { MigrationSet } from "./manifest.js";
export { applyMigrations } from "./apply.js";
export { appliedSchemaVersion, expectedSchemaVersion } from "./schema-version.js";
import "./errors.js";
