import { assertVenueFirstSetupAllowed, inspectFirstSetupMarker } from "@waitron/provisioning";
import { lockVenueDatabase } from "@waitron/db";
import { chmod, copyFile, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError, isAppError } from "@waitron/shared";
import { packArchive, unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import type { DeploymentEnvironment } from "./config.js";
import { stagedPath, writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import {
  RESTORE_STAGING_DIR,
  restoreFromArtifactFile,
  validateDatabaseEntries,
  type EntryValidationDeps,
  type RestoreFileDeps,
  type RestoreOperationRunner,
} from "./restore.js";
import {
  confirmsVenue,
  prepareStreamRestore,
  writeStreamRestore,
  type PrepareStreamDeps,
  type WriteStreamArgs,
} from "./restore-stream.js";
import "./errors.js";
import {
  createRecoveryRestoreRunner,
  parseRecoveryOperationInput,
  readRecoveryOperationFile,
  type RecoveryOperationInput,
} from "./recovery-module-operation.js";
import { isUnset } from "./env-value.js";
import {
  recoveryArchiveSourceId,
  recoveryArchiveFileSourceId,
  recoveryStreamSourceId,
} from "./recovery-source.js";

const ARTIFACT = "restore-request.artifact";
const KEY = "restore-request.key";
const STREAM_DB = "restore-request.db";
const STREAM_ENTRIES = "restore-request.entries";
const STREAM_PLACEMENT = "restore-request.placement.db";
const MARKER = "restore-request.json";
const SETUP_OPERATION = "setup-operation.json";
const NODE_KEY = "restore-request.node-key";
const MAX_NODE_KEY_BYTES = 4096;

async function flushPath(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

async function clearNodeKey(stateDir: string): Promise<void> {
  const path = join(stateDir, NODE_KEY);
  await rm(path, { force: true });
  await rm(stagedPath(path), { force: true });
}

function invalidNodeKey(): never {
  throw new AppError("server.config_invalid", {
    variable: "WAITRON_NODE_RECOVERY_KEY",
    reason: "invalid_credential",
  });
}

function assertSource(operation: RecoveryOperationInput, sourceId: string): void {
  if (operation.binding.sourceId !== sourceId)
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_RECOVERY_OPERATION_FILE",
      reason: "source_mismatch",
    });
}

function nodeKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Buffer.byteLength(value) > MAX_NODE_KEY_BYTES
  )
    return invalidNodeKey();
  return value;
}

async function readStagedNodeKey(stateDir: string): Promise<string> {
  let file;
  try {
    file = await open(join(stateDir, NODE_KEY), "r");
    if (!(await file.stat()).isFile()) return invalidNodeKey();
    const buffer = Buffer.alloc(MAX_NODE_KEY_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > MAX_NODE_KEY_BYTES) return invalidNodeKey();
    return nodeKey(buffer.subarray(0, count).toString("utf8"));
  } catch {
    return invalidNodeKey();
  } finally {
    await file?.close();
  }
}

export interface ArchiveRestoreRequest {
  kind?: "archive";
  artifact: Uint8Array;
  recoveryKey: string;
  environment: DeploymentEnvironment;
  managedCloud?: { requestId: string; pointId: string };
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
}

/** A rebuild from the bucket: the downloaded database and the unlocked secrets row's entries. */
export interface StreamRestoreRequest {
  kind: "stream";
  databasePath: string;
  entries: ArchiveEntry[];
  environment: DeploymentEnvironment;
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
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
  const recoveryOperation =
    request.recoveryOperation === undefined
      ? undefined
      : parseRecoveryOperationInput(request.recoveryOperation);
  if (
    recoveryOperation === null ||
    (recoveryOperation !== undefined && recoveryOperation.binding.action !== "restore")
  )
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_RECOVERY_OPERATION_FILE",
      reason: "invalid_operation",
    });
  const secret =
    request.nodeRecoverySecret === undefined ? undefined : nodeKey(request.nodeRecoverySecret);
  if (secret !== undefined && recoveryOperation === undefined) invalidNodeKey();
  await validate?.(request);
  if (secret !== undefined && recoveryOperation !== undefined) {
    assertSource(
      recoveryOperation,
      request.kind === "stream"
        ? await recoveryStreamSourceId(request.databasePath, request.entries)
        : recoveryArchiveSourceId(request.artifact),
    );
  }
  await rm(join(stateDir, MARKER), { force: true });
  await clearNodeKey(stateDir);
  try {
    if (request.kind === "stream") {
      await rename(request.databasePath, join(stateDir, STREAM_DB));
      await chmod(join(stateDir, STREAM_DB), 0o600);
      await writeFileAtomic(join(stateDir, STREAM_ENTRIES), packArchive(request.entries), 0o600);
    } else {
      await writeFileAtomic(join(stateDir, ARTIFACT), request.artifact, 0o600);
      await writeFileAtomic(join(stateDir, KEY), request.recoveryKey, 0o600);
    }
    if (secret !== undefined) await writeFileAtomic(join(stateDir, NODE_KEY), secret, 0o600);
    await writeFileAtomic(
      join(stateDir, MARKER),
      JSON.stringify({
        version: 1,
        environment: request.environment,
        ...(request.kind === "stream"
          ? { kind: "stream" }
          : request.managedCloud === undefined
            ? {}
            : { managedCloud: request.managedCloud }),
        ...(recoveryOperation === undefined ? {} : { recoveryOperation }),
        ...(secret === undefined ? {} : { nodeRecoveryKey: true }),
      }),
      0o600,
    );
  } catch (error) {
    await clearNodeKey(stateDir);
    throw error;
  }
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
      recoveryOperation?: RecoveryOperationInput;
      nodeRecoverySecret?: string;
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
        recoveryOperation: deps.recoveryOperation,
        nodeRecoverySecret: deps.nodeRecoverySecret,
      },
      async (request) => {
        const validated = await validateDatabaseEntries(
          request.entries,
          request.databasePath,
          deps,
        );
        await validated.discard();
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
  withModuleOperations?: RestoreOperationRunner;
  recoverySecret?: unknown;
  recoveryOperationPath?: string;
  onManagedCloudRestored?: (binding: { requestId: string; pointId: string }) => Promise<void>;
}

type Restore = (deps: RestoreFileDeps) => Promise<void>;
type RestoreStream = (args: WriteStreamArgs) => Promise<void>;

async function clearStagedRestore(stateDir: string): Promise<void> {
  await Promise.all([
    rm(join(stateDir, MARKER), { force: true }),
    rm(join(stateDir, SETUP_OPERATION), { force: true }),
    rm(join(stateDir, ARTIFACT), { force: true }),
    rm(join(stateDir, KEY), { force: true }),
    clearNodeKey(stateDir),
    rm(join(stateDir, STREAM_DB), { force: true }),
    rm(join(stateDir, STREAM_ENTRIES), { force: true }),
    rm(join(stateDir, STREAM_PLACEMENT), { force: true }),
  ]);
}

/** Run a staged cold restore; the caller runs it before anything in this process opens the venue
 * database. Returns false when no request exists. */
export async function runStagedRestore(
  deps: StagedRestoreDeps,
  restore: Restore = restoreFromArtifactFile,
  restoreStream: RestoreStream = writeStreamRestore,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(join(deps.stateDir, MARKER), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await clearNodeKey(deps.stateDir);
      return false;
    }
    await clearNodeKey(deps.stateDir);
    throw error;
  }
  if ((await inspectFirstSetupMarker(deps.venueDir)) !== null) {
    const claimHold = await lockVenueDatabase(deps.venueDir);
    try {
      await assertVenueFirstSetupAllowed(deps.venueDir);
    } finally {
      claimHold.release();
    }
  }
  let managedCloud: { requestId: string; pointId: string } | undefined;
  let resuming = false;
  let markedStarted = false;
  try {
    const marker = JSON.parse(raw) as {
      version?: unknown;
      environment?: unknown;
      kind?: unknown;
      managedCloud?: unknown;
      recoveryOperation?: unknown;
      nodeRecoveryKey?: unknown;
      placementStarted?: unknown;
    };
    if (
      marker.version !== 1 ||
      (marker.placementStarted !== undefined &&
        (marker.placementStarted !== true || marker.nodeRecoveryKey !== true)) ||
      (marker.nodeRecoveryKey !== undefined &&
        (marker.nodeRecoveryKey !== true || marker.recoveryOperation === undefined)) ||
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
    resuming = marker.placementStarted === true;
    const environment: DeploymentEnvironment = marker.environment;
    const operation =
      marker.recoveryOperation === undefined
        ? isUnset(deps.recoveryOperationPath)
          ? undefined
          : await readRecoveryOperationFile(deps.recoveryOperationPath)
        : parseRecoveryOperationInput(marker.recoveryOperation);
    if (operation === null) throw new Error("invalid staged restore request");
    if (marker.nodeRecoveryKey === true && operation !== undefined) {
      assertSource(
        operation,
        marker.kind === "stream"
          ? await recoveryStreamSourceId(
              join(deps.stateDir, STREAM_DB),
              unpackArchive(await readFile(join(deps.stateDir, STREAM_ENTRIES))),
            )
          : await recoveryArchiveFileSourceId(join(deps.stateDir, ARTIFACT)),
      );
    }
    // The file bridges the restart; the selected database and current outside source still
    // authenticate each attempt. A marker cannot substitute an environment key for a lost file.
    const secret =
      marker.nodeRecoveryKey === true
        ? await readStagedNodeKey(deps.stateDir)
        : deps.recoverySecret;
    const withModuleOperations =
      operation === undefined
        ? deps.withModuleOperations
        : createRecoveryRestoreRunner(ALL_MODULES, operation, secret);
    const common = {
      venueDir: deps.venueDir,
      stateDir: deps.stateDir,
      stagingDir: join(deps.stateDir, RESTORE_STAGING_DIR),
      migrationsRoot: deps.migrationsRoot,
      modules: ALL_MODULES,
      environment,
      log: deps.log,
      ...(withModuleOperations === undefined ? {} : { withModuleOperations }),
      ...(resuming && operation !== undefined ? { resumeOperation: operation.binding } : {}),
    };
    let run: () => Promise<void>;
    if (marker.kind === "stream") {
      const packed = await readFile(join(deps.stateDir, STREAM_ENTRIES));
      let databasePath = join(deps.stateDir, STREAM_DB);
      if (marker.nodeRecoveryKey === true && !resuming) {
        databasePath = join(deps.stateDir, STREAM_PLACEMENT);
        await copyFile(join(deps.stateDir, STREAM_DB), databasePath);
        await chmod(databasePath, 0o600);
      }
      run = () =>
        restoreStream({
          ...common,
          databasePath,
          entries: unpackArchive(packed),
        });
    } else {
      const recoveryKey = await readFile(join(deps.stateDir, KEY), "utf8");
      run = () =>
        restore({
          ...common,
          artifactPath: join(deps.stateDir, ARTIFACT),
          recoveryKey,
          ...(marker.managedCloud
            ? { managedCloud: marker.managedCloud as { requestId: string; pointId: string } }
            : {}),
        });
    }
    managedCloud = marker.managedCloud as typeof managedCloud;
    if (marker.nodeRecoveryKey === true && !resuming) {
      if (marker.kind === "stream") await flushPath(join(deps.stateDir, STREAM_DB));
      await writeFileAtomic(
        join(deps.stateDir, MARKER),
        JSON.stringify({ ...marker, placementStarted: true }),
        0o600,
      );
      await flushPath(join(deps.stateDir, MARKER));
      await flushPath(deps.stateDir);
      markedStarted = true;
    }
    await run();
  } catch (error) {
    // The lock refuses before the restore places the database or touches the identity, so the
    // request stays for a boot that gets the folder.
    if (!resuming && isAppError(error) && error.code === "provisioning.database_in_use") {
      if (markedStarted) await writeFileAtomic(join(deps.stateDir, MARKER), raw, 0o600);
    } else if (!resuming && !markedStarted) {
      // A later file error can follow a committed activation; started requests need checked replay.
      await clearStagedRestore(deps.stateDir);
    }
    throw error;
  }
  await clearStagedRestore(deps.stateDir);
  if (managedCloud) await deps.onManagedCloudRestored?.(managedCloud).catch(() => {});
  return true;
}
