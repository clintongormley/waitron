import { AppError } from "@waitron/shared";
import type { BackupManifest } from "./backup-manifest.js";
import type { DeploymentEnvironment } from "./config.js";
import "./errors.js";

/**
 * What BR-3's restore consumer knows about the binary about to run `pg_restore` — the environment
 * it is deployed as, and the schema version each module it composes currently EXPECTS (the version
 * its own migrations bring a fresh database to), never a hardcoded or aspirational number. The
 * caller builds this the same way `buildManifest` builds a manifest's `modules` map, just read off
 * the target's own migration definitions rather than an applied database.
 */
export type RestoreCompat = {
  readonly environment: DeploymentEnvironment;
  readonly expectedVersions: Record<string, number>;
};

/**
 * Refuses to restore a {@link BackupManifest} onto a target this binary cannot safely read — pure
 * comparison, no fs/DB/crypto, so BR-3's restore command can call this FIRST, before `pg_restore`
 * touches the (already-decrypted) dump.
 *
 * Two refusals, checked in this order:
 *
 * 1. `restore.environment_mismatch` — the backup's `environment` differs from the target's. Checked
 *    before any module comparison: a cross-environment restore is refused outright regardless of
 *    schema versions, per CLAUDE.md §5's "one database per environment".
 * 2. `restore.schema_too_new` — for a module the target actually runs (present in
 *    `target.expectedVersions`), the manifest's applied version for that module is greater than what
 *    the target expects. This binary's migrations don't reach that far forward, so it cannot safely
 *    restore what the backup contains for that module.
 *
 * A manifest module ABSENT from `target.expectedVersions` — the target does not run that module at
 * all — is deliberately ignored, not refused: its tables restore inert (ADR: BR-3 task 1 brief).
 * Equal or older versions pass. Returns normally (no value) when the target is compatible.
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
