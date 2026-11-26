import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { RESTORE_STAGING_DIR } from "@waitron/store";
import { AppError } from "@waitron/shared";
import { placeBackupData } from "./backup-data-placement.js";
import { withDestinationCall } from "./backup-destination-call.js";
import type { SavedArchive } from "./backup-sweep.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import { digestFile } from "./handover-capture.js";
import { checkCopyIntegrity } from "./handover-integrity.js";
import type { Logger } from "./logger.js";
import { validateArtifactFile, type ValidationFileDeps } from "./restore.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import "./errors.js";

type RehearsalInput = Omit<ValidationFileDeps, "artifactPath" | "stagingDir"> & {
  destinationTimeoutMs: number;
  signal: AbortSignal;
  statfs?: Statfs;
  log: Logger;
};

export async function rehearseShutdownBackup(
  archive: SavedArchive,
  input: RehearsalInput,
): Promise<void> {
  const { signal } = input;
  signal.throwIfAborted();
  const staging = join(input.stateDir, RESTORE_STAGING_DIR);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(staging, "shutdown-"));
  try {
    // The read-back and compressed plaintext coexist with the decoded archive and its extraction.
    const neededBytes = START_FREE_SPACE_FLOOR + 2 * (archive.bytes + archive.plaintextBytes);
    const availableBytes = await freeBytes(root, input.statfs);
    if (availableBytes === null || availableBytes < neededBytes)
      throw new AppError("backup.staging_space_low", {
        neededBytes,
        availableBytes: availableBytes ?? 0,
      });
    const artifactPath = join(root, "saved");
    await withDestinationCall(signal, input.destinationTimeoutMs, (call) =>
      archive.backend.getFile(archive.key, artifactPath, call),
    );
    const read = await digestFile(artifactPath, signal);
    if (read.sha256 !== archive.sha256 || read.bytes !== archive.bytes)
      throw new AppError("backup.archive_invalid", { reason: "read_back_mismatch" });
    signal.throwIfAborted();
    const stateDir = join(root, "state");
    const copy = await validateArtifactFile({ ...input, artifactPath, stagingDir: root, stateDir });
    signal.throwIfAborted();
    if (!(await checkCopyIntegrity(copy.databasePath, { signal, immutable: true })))
      throw new AppError("backup.archive_invalid", { reason: "sqlite_integrity" });
    signal.throwIfAborted();
    await placeBackupData(copy, { ...input, stateDir, venueDir: join(root, "venue") });
    signal.throwIfAborted();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
