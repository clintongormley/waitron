import type { Database } from "@waitron/db";
import { appliedSchemaVersion } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import type { DeploymentEnvironment } from "./config.js";

/**
 * The archive's index/compatibility record: which modules this backup carries and the SCHEMA
 * VERSION each was migrated to (a plain applied-migration count, `appliedSchemaVersion`'s row count
 * of the module's own drizzle journal table — not the module's semver `version`, which is
 * workspace-locked at `0.0.0` for every module and carries no per-database information). Plaintext
 * JSON inside the (encrypted) archive: it names no secrets, only which schema shapes exist, so BR-3's
 * restore can read it FIRST — before touching the ciphertext it sits beside — to refuse restoring
 * onto an incompatible target (a different environment, or a target missing a module the dump
 * expects).
 */
export type BackupManifest = {
  readonly manifestVersion: 1;
  /** ISO 8601, stamped from the caller's `now` — never `Date.now()` directly, so a test can pin it. */
  readonly createdAt: string;
  readonly environment: DeploymentEnvironment;
  /** Module name → applied schema version (0 for a module present in the list but never migrated). */
  readonly modules: Record<string, number>;
};

/**
 * Builds a {@link BackupManifest} by reading each module's ACTUAL applied schema version off `db` —
 * never a hardcoded or expected count — so the manifest reflects what this database really carries,
 * including a module that shipped in `modules` but was never migrated here (version 0, not omitted:
 * BR-3 needs to see every module the running composition knows about, not just the ones already
 * applied).
 */
export async function buildManifest(deps: {
  readonly db: Database;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  readonly now: Date;
}): Promise<BackupManifest> {
  const entries = await Promise.all(
    deps.modules.map(
      async (m) => [m.name, await appliedSchemaVersion(deps.db, m.migrations)] as const,
    ),
  );
  return {
    manifestVersion: 1,
    createdAt: deps.now.toISOString(),
    environment: deps.environment,
    modules: Object.fromEntries(entries),
  };
}
