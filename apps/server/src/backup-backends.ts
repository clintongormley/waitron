import { createS3FileStore, type BucketConfig } from "@waitron/stream";
import { LocalFsBackend } from "./local-fs-backend.js";
import { S3Backend } from "./s3-backend.js";
import type { BackupDestination, StorageBackend } from "./storage-backend.js";

/** A destination with everything needed to reach it, secrets included; never sent to a browser. */
export type ResolvedBackupDestination =
  BackupDestination | { kind: "s3"; id: string; bucket: BucketConfig };

export function buildBackupBackend(dest: ResolvedBackupDestination): StorageBackend {
  switch (dest.kind) {
    case "local-fs":
      return new LocalFsBackend(dest.id, dest.dir);
    case "s3":
      return new S3Backend(dest.id, createS3FileStore(dest.bucket));
  }
}
