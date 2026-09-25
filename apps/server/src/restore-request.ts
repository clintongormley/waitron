import { chmod, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError, isAppError } from "@waitron/shared";
import { packArchive, unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import type { DeploymentEnvironment } from "./config.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import {
  RESTORE_STAGING_DIR,
  restoreFromArtifact,
  validateEntries,
  type EntryValidationDeps,
  type RestoreDeps,
} from "./restore.js";
import {
  confirmsVenue,
  prepareStreamRestore,
  writeStreamRestore,
  type PrepareStreamDeps,
  type WriteStreamArgs,
} from "./restore-stream.js";
import "./errors.js";

const ARTIFACT = "restore-request.artifact";
const KEY = "restore-request.key";
const STREAM_DB = "restore-request.db";
const STREAM_ENTRIES = "restore-request.entries";
const MARKER = "restore-request.json";
const SETUP_OPERATION = "setup-operation.json";

export interface ArchiveRestoreRequest {
  kind?: "archive";
  artifact: Uint8Array;
  recoveryKey: string;
  environment: DeploymentEnvironment;
  managedCloud?: { requestId: string; pointId: string };
}

/** A rebuild from the bucket: the downloaded database and the unlocked secrets row's entries. */
export interface StreamRestoreRequest {
  kind: "stream";
  /** Moved, not copied, into the state folder, so it must be on the same filesystem. */
  databasePath: string;
  entries: ArchiveEntry[];
  environment: DeploymentEnvironment;
}

export type RestoreRequest = ArchiveRestoreRequest | StreamRestoreRequest;

/**
 * Remove any earlier marker, write the payloads, then the marker last, so the entrypoint never
 * observes a partial request, nor one request's payload beside another's.
 */
export async function stageRestoreRequest<R extends RestoreRequest>(
  stateDir: string,
  request: R,
  validate?: (request: R) => Promise<void>,
): Promise<void> {
  await validate?.(request);
  await rm(join(stateDir, MARKER), { force: true });
  if (request.kind === "stream") {
    await rename(request.databasePath, join(stateDir, STREAM_DB));
    await chmod(join(stateDir, STREAM_DB), 0o600);
    await writeFileAtomic(join(stateDir, STREAM_ENTRIES), packArchive(request.entries), 0o600);
    await writeFileAtomic(
      join(stateDir, MARKER),
      JSON.stringify({ version: 1, environment: request.environment, kind: "stream" }),
      0o600,
    );
    return;
  }
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

/**
 * The setup wizard's bucket rebuild: prepare the copy, refuse it unless the owner confirmed its tax
 * id, run the entrypoint's own validation over it so a wrong environment is refused before the
 * restart, then stage it. The download's scratch folder is removed however it ends.
 */
export async function stageStreamRestore(
  deps: PrepareStreamDeps &
    Omit<EntryValidationDeps, "skipSecrets"> & {
      /** The tax id the owner confirmed; null until they have seen one. */
      venueConfirmed: string | null;
    },
): Promise<void> {
  const prepared = await prepareStreamRestore(deps);
  try {
    if (!confirmsVenue(prepared.venue, deps.venueConfirmed)) {
      throw new AppError("restore.stream_venue_unconfirmed", { ...prepared.venue });
    }
    await stageRestoreRequest(
      deps.stateDir,
      {
        kind: "stream",
        databasePath: prepared.databasePath,
        entries: prepared.entries,
        environment: deps.environment,
      },
      async (request) => {
        await validateEntries(
          [...request.entries, { name: "db.dump", bytes: await readFile(request.databasePath) }],
          deps,
        );
      },
    );
  } finally {
    await prepared.discard();
  }
}

export interface StagedRestoreDeps {
  stateDir: string;
  /** The directory holding `venue.db` and `node.db`. */
  venueDir: string;
  migrationsRoot: string | null;
  log: Logger;
  onManagedCloudRestored?: (binding: { requestId: string; pointId: string }) => Promise<void>;
}

type Restore = (deps: RestoreDeps) => Promise<void>;
type RestoreStream = (args: WriteStreamArgs) => Promise<void>;

async function clearStagedRestore(stateDir: string): Promise<void> {
  await Promise.all([
    rm(join(stateDir, MARKER), { force: true }),
    rm(join(stateDir, SETUP_OPERATION), { force: true }),
    rm(join(stateDir, ARTIFACT), { force: true }),
    rm(join(stateDir, KEY), { force: true }),
    rm(join(stateDir, STREAM_DB), { force: true }),
    rm(join(stateDir, STREAM_ENTRIES), { force: true }),
  ]);
}

/** Run a staged cold restore; the caller runs it before anything in this process opens the venue
 * database. Returns false when no request exists. */
export async function runStagedRestore(
  deps: StagedRestoreDeps,
  restore: Restore = restoreFromArtifact,
  restoreStream: RestoreStream = writeStreamRestore,
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
    kind?: unknown;
    managedCloud?: unknown;
  };
  if (
    marker.version !== 1 ||
    (marker.environment !== "production" && marker.environment !== "preproduction") ||
    (marker.kind !== undefined && marker.kind !== "stream") ||
    (marker.kind === "stream" && marker.managedCloud !== undefined) ||
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
  const environment: DeploymentEnvironment = marker.environment;
  const common = {
    venueDir: deps.venueDir,
    stateDir: deps.stateDir,
    stagingDir: join(deps.stateDir, RESTORE_STAGING_DIR),
    migrationsRoot: deps.migrationsRoot,
    modules: ALL_MODULES,
    environment,
    log: deps.log,
  };
  let run: () => Promise<void>;
  if (marker.kind === "stream") {
    const [databaseBytes, packed] = await Promise.all([
      readFile(join(deps.stateDir, STREAM_DB)),
      readFile(join(deps.stateDir, STREAM_ENTRIES)),
    ]);
    run = () => restoreStream({ ...common, databaseBytes, entries: unpackArchive(packed) });
  } else {
    const [artifact, recoveryKey] = await Promise.all([
      readFile(join(deps.stateDir, ARTIFACT)),
      readFile(join(deps.stateDir, KEY), "utf8"),
    ]);
    run = () =>
      restore({
        ...common,
        artifact,
        recoveryKey,
        ...(marker.managedCloud
          ? { managedCloud: marker.managedCloud as { requestId: string; pointId: string } }
          : {}),
      });
  }
  try {
    await run();
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
