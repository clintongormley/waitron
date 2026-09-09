import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
}

/** Write payloads first and the marker last, so the entrypoint never observes a partial request. */
export async function stageRestoreRequest(
  stateDir: string,
  request: RestoreRequest,
): Promise<void> {
  await writeFileAtomic(join(stateDir, ARTIFACT), request.artifact, 0o600);
  await writeFileAtomic(join(stateDir, KEY), request.recoveryKey, 0o600);
  await writeFileAtomic(
    join(stateDir, MARKER),
    JSON.stringify({ version: 1, environment: request.environment }),
    0o600,
  );
}

export interface StagedRestoreDeps {
  stateDir: string;
  databaseUrl: string;
  mediaDir: string;
  migrationsRoot: string | null;
  log: Logger;
}

type Restore = (deps: RestoreDeps) => Promise<void>;

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
  const marker = JSON.parse(raw) as { version?: unknown; environment?: unknown };
  if (
    marker.version !== 1 ||
    (marker.environment !== "production" && marker.environment !== "preproduction")
  ) {
    throw new Error("invalid staged restore request");
  }
  const [artifact, recoveryKey] = await Promise.all([
    readFile(join(deps.stateDir, ARTIFACT)),
    readFile(join(deps.stateDir, KEY), "utf8"),
  ]);
  await restore({
    artifact,
    recoveryKey,
    databaseUrl: deps.databaseUrl,
    mediaDir: deps.mediaDir,
    stateDir: deps.stateDir,
    stagingDir: join(deps.stateDir, "restore-staging"),
    migrationsRoot: deps.migrationsRoot,
    modules: ALL_MODULES,
    environment: marker.environment,
    log: deps.log,
  });
  await rm(join(deps.stateDir, MARKER), { force: true });
  await rm(join(deps.stateDir, SETUP_OPERATION), { force: true });
  await Promise.all([
    rm(join(deps.stateDir, ARTIFACT), { force: true }),
    rm(join(deps.stateDir, KEY), { force: true }),
  ]);
  return true;
}
