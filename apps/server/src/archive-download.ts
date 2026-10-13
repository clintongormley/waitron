import { mkdir, mkdtemp, rm, statfs as nodeStatfs } from "node:fs/promises";
import { join } from "node:path";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { createS3FileStore, type BucketConfig, type S3FileStore } from "@waitron/stream";
import type { ArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { parseBackupArchiveKey } from "./backup-keys.js";
import "./errors.js";

export interface DownloadedArchive {
  path: string;
  /** Removes the folder the archive was downloaded into; safe to call again. */
  dispose(): Promise<void>;
}

const OWN_CODES = [
  "restore.archive_missing",
  "restore.archive_disk_full",
  "restore.archive_download_failed",
] as const;

function safeFailure(error: unknown, signal: AbortSignal): AppError {
  if (isAppError(error) && OWN_CODES.some((code) => hasCode(error, code))) return error;
  if ((error as { code?: unknown } | null)?.code === "ENOSPC") {
    return new AppError("restore.archive_disk_full", {});
  }
  if (signal.aborted)
    return new AppError("restore.archive_download_failed", { reason: "timed_out" });
  if (isAppError(error) && hasCode(error, "backup.destination_request_failed")) {
    if (error.params.status === 404 || error.params.name === "NoSuchKey") {
      return new AppError("restore.archive_missing", {});
    }
    return new AppError("restore.archive_download_failed", { reason: "request_failed" });
  }
  return new AppError("restore.archive_download_failed", { reason: "failed" });
}

/** Free bytes at `dir`, or null where the platform cannot say. */
async function freeBytes(
  dir: string,
  statfs: (path: string) => Promise<{ bavail: number; bsize: number }>,
): Promise<number | null> {
  try {
    const stats = await statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/**
 * Downloads one archive named by `key` from the pack's archive folder into a fresh folder under
 * `stagingDir`. Every failure removes that folder and is one of the `restore.archive_*` codes,
 * carrying no key, path or bucket text.
 */
export async function downloadArchive(deps: {
  pack: ArchiveRecoveryPack;
  key: string;
  stagingDir: string;
  signal: AbortSignal;
  openFiles?: (bucket: BucketConfig) => S3FileStore;
  statfs?: (path: string) => Promise<{ bavail: number; bsize: number }>;
}): Promise<DownloadedArchive> {
  const { pack, key, stagingDir, signal } = deps;
  if (parseBackupArchiveKey(key) === null) throw new AppError("restore.archive_key_invalid", {});
  const files = (deps.openFiles ?? createS3FileStore)({
    ...pack.bucket,
    prefix: pack.archivePrefix,
  });
  let scratch: string | undefined;
  try {
    const listed = await files.list(key, { signal });
    const found = listed.find((file) => file.key === key);
    if (found === undefined) throw new AppError("restore.archive_missing", {});
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });
    // Advisory: the download's own ENOSPC is what is relied on.
    const free = await freeBytes(stagingDir, deps.statfs ?? nodeStatfs);
    if (free !== null && free < found.size) throw new AppError("restore.archive_disk_full", {});
    scratch = await mkdtemp(join(stagingDir, "archive-download-"));
    const path = join(scratch, "archive.backup.enc");
    await files.getFile(key, path, { signal });
    const folder = scratch;
    return {
      path,
      dispose: () => rm(folder, { recursive: true, force: true }),
    };
  } catch (error) {
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    throw safeFailure(error, signal);
  } finally {
    files.close();
  }
}
