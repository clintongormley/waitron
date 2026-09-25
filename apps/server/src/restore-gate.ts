import { AppError } from "@waitron/shared";
import type { BackupManifest } from "./backup-manifest.js";
import type { DeploymentEnvironment } from "./config.js";
import "./errors.js";

/**
 * The binary about to place the venue file: its environment, and the schema version each module's
 * own migrations bring a fresh database to.
 */
export type RestoreCompat = {
  readonly environment: DeploymentEnvironment;
  readonly expectedVersions: Record<string, number>;
};

/**
 * Pure, so a restore can call it before anything in the venue directory is unlinked. A
 * cross-environment restore is refused whatever the versions (CLAUDE.md §5: one database per
 * environment). A module the target does not run is deliberately ignored: its tables restore inert.
 */
export function checkRestoreCompatibility(manifest: BackupManifest, target: RestoreCompat): void {
  if (manifest.environment !== target.environment) {
    throw new AppError("restore.environment_mismatch", {
      backup: manifest.environment,
      target: target.environment,
    });
  }

  for (const [module, backupVersion] of Object.entries(manifest.modules)) {
    const targetVersion = target.expectedVersions[module];
    if (targetVersion !== undefined && backupVersion > targetVersion) {
      throw new AppError("restore.schema_too_new", {
        module,
        backup: backupVersion,
        target: targetVersion,
      });
    }
  }
}
