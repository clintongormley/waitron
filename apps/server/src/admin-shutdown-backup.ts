import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { RESTORE_STAGING_DIR } from "@waitron/store";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import type { ShutdownArchive } from "./admin-shutdown.js";
import { placeBackupData } from "./backup-data-placement.js";
import { withDestinationCall } from "./backup-destination-call.js";
import type { SavedArchive } from "./backup-sweep.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import { digestFile } from "./handover-capture.js";
import { checkCopyIntegrity } from "./handover-integrity.js";
import type { Logger } from "./logger.js";
import { validateArtifactFile, type ValidationFileDeps } from "./restore.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import { MAX_ARCHIVE_UPLOAD_BYTES } from "./setup-archive-upload.js";
import "./errors.js";

type RehearsalInput = Omit<ValidationFileDeps, "artifactPath" | "stagingDir"> & {
  signal: AbortSignal;
  statfs?: Statfs;
  log: Logger;
};

async function shutdownScratch(stateDir: string): Promise<string> {
  const staging = join(stateDir, RESTORE_STAGING_DIR);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  return mkdtemp(join(staging, "shutdown-"));
}

async function requireSpace(root: string, neededBytes: number, statfs?: Statfs): Promise<void> {
  const availableBytes = await freeBytes(root, statfs);
  if (availableBytes === null || availableBytes < neededBytes)
    throw new AppError("backup.staging_space_low", {
      neededBytes,
      availableBytes: availableBytes ?? 0,
    });
}

async function checkAndPlace(
  artifactPath: string,
  root: string,
  input: RehearsalInput,
): Promise<void> {
  const { signal } = input;
  signal.throwIfAborted();
  const stateDir = join(root, "state");
  const copy = await validateArtifactFile({ ...input, artifactPath, stagingDir: root, stateDir });
  signal.throwIfAborted();
  if (!(await checkCopyIntegrity(copy.databasePath, { signal, immutable: true })))
    throw new AppError("backup.archive_invalid", { reason: "sqlite_integrity" });
  signal.throwIfAborted();
  await placeBackupData(copy, { ...input, stateDir, venueDir: join(root, "venue") });
  signal.throwIfAborted();
}

export async function rehearseShutdownBackup(
  archive: SavedArchive,
  input: RehearsalInput & {
    destinationTimeoutMs: number;
    onReadBackFailure?: (id: string) => void;
  },
): Promise<void> {
  const { signal } = input;
  for (const [index, backend] of archive.backends.entries()) {
    signal.throwIfAborted();
    const root = await shutdownScratch(input.stateDir);
    try {
      // The first read also needs space for decryption and extraction during the rehearsal.
      const neededBytes =
        index === 0 ? 2 * (archive.bytes + archive.plaintextBytes) : archive.bytes;
      await requireSpace(root, START_FREE_SPACE_FLOOR + neededBytes, input.statfs);
      const artifactPath = join(root, "saved");
      await withDestinationCall(signal, input.destinationTimeoutMs, (call) =>
        backend.getFile(archive.key, artifactPath, call),
      ).catch((error: unknown) => {
        input.onReadBackFailure?.(backend.id);
        throw error;
      });
      const read = await digestFile(artifactPath, signal);
      if (read.sha256 !== archive.sha256 || read.bytes !== archive.bytes) {
        input.onReadBackFailure?.(backend.id);
        throw new AppError("backup.archive_invalid", { reason: "read_back_mismatch" });
      }
      // Identical ciphertext gives the same restore input at every destination.
      if (index === 0) await checkAndPlace(artifactPath, root, input);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
}

export async function prepareShutdownDownload(
  name: string,
  capture: (path: string) => Promise<number>,
  input: RehearsalInput,
): Promise<ShutdownArchive> {
  input.signal.throwIfAborted();
  const root = await shutdownScratch(input.stateDir);
  const path = join(root, name);
  const remove = () => rm(root, { recursive: true, force: true });
  try {
    const plaintextBytes = await capture(path);
    const { size: bytes } = await stat(path);
    if (bytes > MAX_ARCHIVE_UPLOAD_BYTES) throw new AppError("restore.archive_resource_limit", {});
    await requireSpace(root, START_FREE_SPACE_FLOOR + bytes + 2 * plaintextBytes, input.statfs);
    const rehearsal = await mkdtemp(join(root, "rehearsal-"));
    try {
      await checkAndPlace(path, rehearsal, input);
    } finally {
      await rm(rehearsal, { recursive: true, force: true });
    }
    input.signal.throwIfAborted();
    return { name, path, bytes, remove };
  } catch (error) {
    await remove();
    if (isAppError(error) && hasCode(error, "backup.artifact_invalid"))
      throw new AppError("backup.archive_invalid", { reason: "ciphertext_invalid" });
    throw error;
  }
}
