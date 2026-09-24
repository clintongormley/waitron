import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isAppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { restoreFromArtifact, type RestoreDeps } from "./restore.js";

const ARTIFACT = "restore-request.artifact";
const KEY = "restore-request.key";
const MARKER = "restore-request.json";
const SETUP_OPERATION = "setup-operation.json";

export interface RestoreRequest {
  artifact: Uint8Array;
  recoveryKey: string;
  environment: DeploymentEnvironment;
  managedCloud?: { requestId: string; pointId: string };
}

/** Write payloads first and the marker last, so the entrypoint never observes a partial request. */
export async function stageRestoreRequest(
  stateDir: string,
  request: RestoreRequest,
  validate?: (request: RestoreRequest) => Promise<void>,
): Promise<void> {
  await validate?.(request);
  await writeFileAtomic(join(stateDir, ARTIFACT), request.artifact, 0o600);
  await writeFileAtomic(join(stateDir, KEY), request.recoveryKey, 0o600);
  await writeFileAtomic(
    join(stateDir, MARKER),
    JSON.stringify({
      version: 1,
      environment: request.environment,
      ...(request.managedCloud ? { managedCloud: request.managedCloud } : {}),
    }),
    0o600,
  );
}

export interface StagedRestoreDeps {
  stateDir: string;
  /** The directory holding `venue.db` and `node.db` — what the restore places the archive into. */
  venueDir: string;
  migrationsRoot: string | null;
  log: Logger;
  onManagedCloudRestored?: (binding: { requestId: string; pointId: string }) => Promise<void>;
}

type Restore = (deps: RestoreDeps) => Promise<void>;

async function clearStagedRestore(stateDir: string): Promise<void> {
  await Promise.all([
    rm(join(stateDir, MARKER), { force: true }),
    rm(join(stateDir, SETUP_OPERATION), { force: true }),
    rm(join(stateDir, ARTIFACT), { force: true }),
    rm(join(stateDir, KEY), { force: true }),
  ]);
}

/** Run a staged cold restore before any server pool opens. Returns false when no request exists. */
export async function runStagedRestore(
  deps: StagedRestoreDeps,
  restore: Restore = restoreFromArtifact,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(join(deps.stateDir, MARKER), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const marker = JSON.parse(raw) as {
    version?: unknown;
    environment?: unknown;
    managedCloud?: unknown;
  };
  if (
    marker.version !== 1 ||
    (marker.environment !== "production" && marker.environment !== "preproduction") ||
    (marker.managedCloud !== undefined &&
      (marker.environment !== "preproduction" ||
        typeof marker.managedCloud !== "object" ||
        marker.managedCloud === null ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          String((marker.managedCloud as { requestId?: unknown }).requestId),
        ) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          String((marker.managedCloud as { pointId?: unknown }).pointId),
        )))
  ) {
    throw new Error("invalid staged restore request");
  }
  const [artifact, recoveryKey] = await Promise.all([
    readFile(join(deps.stateDir, ARTIFACT)),
    readFile(join(deps.stateDir, KEY), "utf8"),
  ]);
  try {
    await restore({
      artifact,
      recoveryKey,
      venueDir: deps.venueDir,
      stateDir: deps.stateDir,
      stagingDir: join(deps.stateDir, "restore-staging"),
      migrationsRoot: deps.migrationsRoot,
      modules: ALL_MODULES,
      environment: marker.environment,
      ...(marker.managedCloud
        ? { managedCloud: marker.managedCloud as { requestId: string; pointId: string } }
        : {}),
      log: deps.log,
    });
  } catch (error) {
    // The lock refuses before the restore places the database or touches the identity, so the
    // request stays for a boot that gets the folder.
    if (!(isAppError(error) && error.code === "provisioning.database_in_use")) {
      await clearStagedRestore(deps.stateDir);
    }
    throw error;
  }
  await clearStagedRestore(deps.stateDir);
  if (marker.managedCloud)
    await deps
      .onManagedCloudRestored?.(marker.managedCloud as { requestId: string; pointId: string })
      .catch(() => {});
  return true;
}
