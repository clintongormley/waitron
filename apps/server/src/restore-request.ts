import { SCRATCH_DIR, RESTORE_FLOW_DIR, SETUP_OPERATION_FILE } from "@waitron/store";
import {
  assertNoStartAgainDeletion,
  assertVenueFirstSetupAllowed,
  inspectFirstSetupMarker,
} from "@waitron/provisioning";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  VENUE_FILE,
  NODE_FILE,
  SIDE_FILE_SUFFIXES,
  TRADING_ENV_FILE,
  TRADING_ENV_REPLACED_SUFFIX,
} from "@waitron/store";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";
import { deleteBackupRoomNote } from "./backup-room-note.js";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { packArchive, unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import type { DeploymentEnvironment } from "./config.js";
import { syncFolderHolding, writeFileDurable } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { RESTORE_ENTRY_PREFIX, RESTORE_STAGING_DIR } from "./restore-staging-dirs.js";
import {
  lockRestoreTarget,
  INCOMING_SUFFIX,
  restoreFromArtifactFile,
  validateArtifactFile,
  validateDatabaseEntries,
  writeStagedNodeCopy,
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
import { currentBackupVerificationTarget } from "./backup-verification-target.js";
import { parseBackupVerificationJson } from "./backup-verification-protocol.js";
import {
  assertSnapshotRecoveryArchive,
  assertSnapshotRecoveryTarget,
  cloudRecoveryUnavailable,
  readSnapshotRecoveryBinding,
  type SnapshotRecoveryVerification,
} from "./cloud-recovery-v2.js";
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
import {
  createRecoveryEntryRunner,
  parseRecoveryEntryContext,
  type RecoveryEntryContext,
} from "./recovery-entry.js";

import { readRestoreFlowPhase } from "@waitron/provisioning";
import {
  attachmentPath,
  dropAttachments,
  publishRestoreFlow,
  readRestoreFlow,
  updateRestoreFlow,
  type RestoreFlowRecord,
} from "./restore-flow.js";
const ARTIFACT = "artifact";
const KEY = "key";
const STREAM_DB = "venue.db";
const STREAM_ENTRIES = "entries";
const STREAM_PLACEMENT = "placement.db";
const SETUP_OPERATION = SETUP_OPERATION_FILE;
const NODE_KEY = "node-key";
const MAX_NODE_KEY_BYTES = 4096;

async function flushPath(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
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

function recoveryContext(value: unknown): RecoveryEntryContext | undefined {
  if (value === undefined) return undefined;
  return parseRecoveryEntryContext(value) ?? invalidRecoveryContext();
}

function invalidRecoveryContext(): never {
  throw new AppError("server.config_invalid", {
    variable: "WAITRON_RECOVERY_OPERATION_FILE",
    reason: "invalid_operation",
  });
}

async function readStagedNodeKey(stateDir: string): Promise<string> {
  let file;
  try {
    file = await open(attachmentPath(stateDir, NODE_KEY), "r");
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
  snapshotVerification?: SnapshotRecoveryVerification;
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryEntryContext;
}

/** A rebuild from the bucket: the downloaded database and the unlocked secrets row's entries. */
export interface StreamRestoreRequest {
  kind: "stream";
  databasePath: string;
  entries: ArchiveEntry[];
  environment: DeploymentEnvironment;
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryEntryContext;
}

export type RestoreRequest = ArchiveRestoreRequest | StreamRestoreRequest;

export async function stageRestoreRequest<R extends RestoreRequest>(
  stateDir: string,
  request: R,
  validate?: (request: R) => Promise<void>,
): Promise<void> {
  if (request.kind === "stream" && "snapshotVerification" in request) cloudRecoveryUnavailable();
  const checkSnapshot = async () => {
    if (request.kind === "stream") return undefined;
    const binding = await readSnapshotRecoveryBinding(stateDir, request);
    if (binding) {
      if (request.environment !== "preproduction") cloudRecoveryUnavailable();
      try {
        assertSnapshotRecoveryTarget(binding.verification, currentBackupVerificationTarget());
      } catch {
        cloudRecoveryUnavailable();
      }
      assertSnapshotRecoveryArchive(
        binding.verification,
        recoveryArchiveSourceId(request.artifact),
        request.artifact.byteLength,
      );
    }
    return binding;
  };
  await checkSnapshot();
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
  const context = recoveryContext(request.recoveryContext);
  if (context !== undefined && (secret === undefined || recoveryOperation === undefined))
    invalidRecoveryContext();
  await validate?.(request);
  if (secret !== undefined && recoveryOperation !== undefined) {
    assertSource(
      recoveryOperation,
      request.kind === "stream"
        ? await recoveryStreamSourceId(request.databasePath, request.entries)
        : recoveryArchiveSourceId(request.artifact),
    );
  }
  const snapshot = await checkSnapshot();
  await publishRestoreFlow(
    stateDir,
    {
      version: 1,
      phase: "staged",
      request: {
        version: snapshot ? 2 : 1,
        environment: request.environment,
        ...(request.kind === "stream"
          ? { kind: "stream" }
          : request.managedCloud === undefined
            ? {}
            : { managedCloud: request.managedCloud }),
        ...(recoveryOperation === undefined ? {} : { recoveryOperation }),
        ...(secret === undefined ? {} : { nodeRecoveryKey: true }),
        ...(context === undefined ? {} : { recoveryContext: context }),
        ...(snapshot === undefined
          ? {}
          : {
              snapshotVerification: snapshot.verification,
              snapshotRequestKey: snapshot.publicKey,
            }),
      },
    },
    async (dir) => {
      if (request.kind === "stream") {
        await rename(request.databasePath, join(dir, STREAM_DB));
        await chmod(join(dir, STREAM_DB), 0o600);
        await flushPath(join(dir, STREAM_DB));
        await writeFileDurable(join(dir, STREAM_ENTRIES), packArchive(request.entries), 0o600);
      } else {
        await writeFileDurable(join(dir, ARTIFACT), request.artifact, 0o600);
        await writeFileDurable(join(dir, KEY), request.recoveryKey, 0o600);
      }
      if (secret !== undefined) await writeFileDurable(join(dir, NODE_KEY), secret, 0o600);
    },
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
      recoveryOperation?: RecoveryOperationInput;
      nodeRecoverySecret?: string;
      recoveryContext?: RecoveryEntryContext;
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
        recoveryContext: deps.recoveryContext,
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

/** Run a staged cold restore; the caller runs it before anything in this process opens the venue
 * database. Returns false when no request exists. */
export async function runStagedRestore(
  deps: StagedRestoreDeps,
  restore: Restore = restoreFromArtifactFile,
  restoreStream: RestoreStream = writeStreamRestore,
): Promise<boolean> {
  const phase = await readRestoreFlowPhase(deps.stateDir);
  if (phase === "unreadable") {
    deps.log("error", "restore.flow_unreadable", {});
    return false;
  }
  if (phase === null) return false;
  if (phase === "first-start") {
    const hold = await lockRestoreTarget(deps.venueDir);
    try {
      await dropAttachments(deps.stateDir);
    } finally {
      hold.release();
    }
    return false;
  }
  const raw = await readFile(join(deps.stateDir, RESTORE_FLOW_DIR, "record.json"), "utf8");
  const flow = (await readRestoreFlow(deps.stateDir))!;
  const candidate = flow.request ?? {};
  const snapshot =
    candidate.version === 1 &&
    candidate.kind === "stream" &&
    candidate.snapshotVerification === undefined &&
    candidate.snapshotRequestKey === undefined
      ? undefined
      : await readSnapshotRecoveryBinding(deps.stateDir, {
          managedCloud: candidate.managedCloud as ArchiveRestoreRequest["managedCloud"],
          snapshotVerification: candidate.snapshotVerification as
            SnapshotRecoveryVerification | undefined,
        });
  if (
    snapshot ||
    candidate.snapshotVerification !== undefined ||
    candidate.snapshotRequestKey !== undefined
  ) {
    try {
      parseBackupVerificationJson(raw, 65536);
      const allowed = [
        "version",
        "environment",
        "managedCloud",
        "recoveryOperation",
        "nodeRecoveryKey",
        "recoveryContext",
        "snapshotVerification",
        "snapshotRequestKey",
      ];
      if (
        !snapshot ||
        candidate.version !== 2 ||
        candidate.environment !== "preproduction" ||
        candidate.kind !== undefined ||
        candidate.snapshotRequestKey !== snapshot.publicKey ||
        (candidate.nodeRecoveryKey !== undefined &&
          (candidate.nodeRecoveryKey !== true || candidate.recoveryOperation === undefined)) ||
        Object.keys(candidate).some((key) => !allowed.includes(key))
      )
        cloudRecoveryUnavailable();
      assertSnapshotRecoveryTarget(snapshot.verification, currentBackupVerificationTarget());
      assertSnapshotRecoveryArchive(
        snapshot.verification,
        await recoveryArchiveFileSourceId(attachmentPath(deps.stateDir, ARTIFACT)),
        (await stat(attachmentPath(deps.stateDir, ARTIFACT))).size,
      );
    } catch {
      cloudRecoveryUnavailable();
    }
  }
  await assertNoStartAgainDeletion(deps.venueDir);
  // Held until this returns: another process's start removes restore working folders whenever it
  // can take this folder (`emptyScratch`), and this run makes them before placement's own hold.
  // Refused here, nothing is cleared, so the request stays staged.
  const hold = await lockRestoreTarget(deps.venueDir);
  try {
    if ((await inspectFirstSetupMarker(deps.venueDir)) !== null)
      await assertVenueFirstSetupAllowed(deps.venueDir);
    return await runHeld(deps, flow, snapshot, restore, restoreStream);
  } finally {
    hold.release();
  }
}

async function runHeld(
  deps: StagedRestoreDeps,
  flow: RestoreFlowRecord,
  snapshot: Awaited<ReturnType<typeof readSnapshotRecoveryBinding>>,
  restore: Restore,
  restoreStream: RestoreStream,
): Promise<boolean> {
  let record = flow;
  const saveRecord = async (next: RestoreFlowRecord) => {
    await updateRestoreFlow(deps.stateDir, next);
    record = next;
  };
  await rm(join(deps.stateDir, RESTORE_STAGING_DIR), { recursive: true, force: true });
  if (flow.phase === "placing") {
    await deleteBackupRoomNote(deps.stateDir);
    for (const name of [VENUE_FILE, NODE_FILE]) {
      const target = join(deps.venueDir, name);
      for (const suffix of ["", ...SIDE_FILE_SUFFIXES, INCOMING_SUFFIX])
        await rm(`${target}${suffix}`, { force: true });
    }
    await rm(litestreamMetaDir(join(deps.venueDir, VENUE_FILE)), { recursive: true, force: true });
    const identity = join(deps.stateDir, TRADING_ENV_FILE);
    try {
      await rename(`${identity}${TRADING_ENV_REPLACED_SUFFIX}`, identity);
      await syncFolderHolding(identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const marker = (flow.request ?? {}) as {
    version?: unknown;
    environment?: unknown;
    kind?: unknown;
    managedCloud?: unknown;
    recoveryOperation?: unknown;
    nodeRecoveryKey?: unknown;
    recoveryContext?: unknown;
  };
  if (
    (marker.version !== 1 && !(marker.version === 2 && snapshot)) ||
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
  const environment: DeploymentEnvironment = marker.environment;
  const operation =
    marker.recoveryOperation === undefined
      ? isUnset(deps.recoveryOperationPath)
        ? undefined
        : await readRecoveryOperationFile(deps.recoveryOperationPath)
      : parseRecoveryOperationInput(marker.recoveryOperation);
  if (operation === null) throw new Error("invalid staged restore request");
  const context = recoveryContext(marker.recoveryContext);
  if (context !== undefined && (operation === undefined || marker.nodeRecoveryKey !== true))
    invalidRecoveryContext();
  if (marker.nodeRecoveryKey === true && operation !== undefined) {
    assertSource(
      operation,
      marker.kind === "stream"
        ? await recoveryStreamSourceId(
            attachmentPath(deps.stateDir, STREAM_DB),
            unpackArchive(await readFile(attachmentPath(deps.stateDir, STREAM_ENTRIES))),
          )
        : await recoveryArchiveFileSourceId(attachmentPath(deps.stateDir, ARTIFACT)),
    );
  }
  // The file bridges the restart; the selected database and current outside source still
  // authenticate each attempt. A marker cannot substitute an environment key for a lost file.
  const secret =
    marker.nodeRecoveryKey === true ? await readStagedNodeKey(deps.stateDir) : deps.recoverySecret;
  let withModuleOperations =
    operation === undefined
      ? deps.withModuleOperations
      : createRecoveryRestoreRunner(ALL_MODULES, operation, secret);
  if (context !== undefined && operation !== undefined) {
    const validation = {
      ...deps,
      environment,
      modules: ALL_MODULES,
      stagingDir: join(deps.stateDir, RESTORE_STAGING_DIR),
    };
    const copy =
      marker.kind === "stream"
        ? await (async () => {
            const parent = join(deps.stateDir, SCRATCH_DIR);
            await mkdir(parent, { recursive: true, mode: 0o700 });
            const directory = await mkdtemp(join(parent, RESTORE_ENTRY_PREFIX));
            const discard = () => rm(directory, { recursive: true, force: true });
            try {
              const databasePath = join(directory, VENUE_FILE);
              await copyFile(attachmentPath(deps.stateDir, STREAM_DB), databasePath);
              const validated = await validateDatabaseEntries(
                unpackArchive(await readFile(attachmentPath(deps.stateDir, STREAM_ENTRIES))),
                databasePath,
                validation,
              );
              await writeStagedNodeCopy(databasePath, validated.nodeDump);
              return { ...validated, discard };
            } catch (error) {
              await discard();
              throw error;
            }
          })()
        : await validateArtifactFile({
            ...validation,
            artifactPath: attachmentPath(deps.stateDir, ARTIFACT),
            recoveryKey: await readFile(attachmentPath(deps.stateDir, KEY), "utf8"),
          });
    try {
      withModuleOperations = await createRecoveryEntryRunner({
        ...validation,
        copy,
        operation,
        secret,
        context,
      });
    } finally {
      await copy.discard();
    }
  }
  const common = {
    venueDir: deps.venueDir,
    stateDir: deps.stateDir,
    stagingDir: join(deps.stateDir, RESTORE_STAGING_DIR),
    migrationsRoot: deps.migrationsRoot,
    modules: ALL_MODULES,
    environment,
    log: deps.log,
    ...(withModuleOperations === undefined ? {} : { withModuleOperations }),
    recordFirstStart: (source: "archive" | "stream") =>
      saveRecord({ ...record, firstStart: { source } }),
    clearFirstStart: () => saveRecord({ ...record, firstStart: undefined }),
    beforeDatabaseMove: () => saveRecord({ ...record, phase: "placing" }),
  };
  let run: () => Promise<void>;
  if (marker.kind === "stream") {
    const packed = await readFile(attachmentPath(deps.stateDir, STREAM_ENTRIES));
    const databasePath = attachmentPath(deps.stateDir, STREAM_PLACEMENT);
    await copyFile(attachmentPath(deps.stateDir, STREAM_DB), databasePath);
    await chmod(databasePath, 0o600);
    run = () =>
      restoreStream({
        ...common,
        databasePath,
        entries: unpackArchive(packed),
      });
  } else {
    const recoveryKey = await readFile(attachmentPath(deps.stateDir, KEY), "utf8");
    run = () =>
      restore({
        ...common,
        artifactPath: attachmentPath(deps.stateDir, ARTIFACT),
        recoveryKey,
        ...(marker.managedCloud
          ? { managedCloud: marker.managedCloud as { requestId: string; pointId: string } }
          : {}),
        ...(snapshot === undefined
          ? {}
          : {
              snapshotVerification: snapshot.verification,
              snapshotRequestKey: snapshot.publicKey,
            }),
      });
  }
  const managedCloud = marker.managedCloud as { requestId: string; pointId: string } | undefined;
  await run();
  if (managedCloud) await deps.onManagedCloudRestored?.(managedCloud);
  await rm(join(deps.stateDir, SETUP_OPERATION), { force: true });
  await syncFolderHolding(join(deps.stateDir, SETUP_OPERATION));
  await saveRecord({
    version: 1,
    phase: "first-start",
    firstStart: record.firstStart ?? {
      source: flow.request?.kind === "stream" ? "stream" : "archive",
    },
  });
  await dropAttachments(deps.stateDir);
  return true;
}
