import type { Database } from "@waitron/db";
import { appliedSchemaVersion } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import type { DeploymentEnvironment } from "./config.js";

/**
 * What a restore checks before it applies an archive (`checkRestoreCompatibility`). A module's
 * version is its applied-migration count, not its package semver.
 */
export type BackupManifest = {
  readonly manifestVersion: 1;
  readonly createdAt: string;
  readonly environment: DeploymentEnvironment;
  /** 0 for a module in the list that was never migrated here, never omitted. */
  readonly modules: Record<string, number>;
};

/** Each module's applied schema version as read off `db`, never an expected count. */
export async function schemaVersionsByModule(
  db: Pick<Database, "execute">,
  modules: readonly WaitronModule[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    modules.map(async (m) => [m.name, await appliedSchemaVersion(db, m.migrations)] as const),
  );
  return Object.fromEntries(entries);
}

export async function buildManifest(deps: {
  readonly db: Database;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  readonly now: Date;
}): Promise<BackupManifest> {
  return {
    manifestVersion: 1,
    createdAt: deps.now.toISOString(),
    environment: deps.environment,
    modules: await schemaVersionsByModule(deps.db, deps.modules),
  };
}
