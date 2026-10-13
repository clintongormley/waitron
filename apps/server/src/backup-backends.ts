import { createS3FileStore, type S3FileStoreOptions } from "@waitron/stream";
import { archiveNamespace } from "./archive-settings.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { S3Backend } from "./s3-backend.js";
import type { BackupDestination, StorageBackend } from "./storage-backend.js";

export function buildBackupBackend(
  dest: BackupDestination,
  s3Options?: S3FileStoreOptions,
): StorageBackend {
  switch (dest.kind) {
    case "local-fs":
      return new LocalFsBackend(dest.id, dest.dir);
    case "s3":
      return new S3Backend(
        dest.id,
        createS3FileStore(
          { ...dest.bucket, prefix: archiveNamespace(dest.bucket.prefix, dest.venueId) },
          s3Options,
        ),
      );
  }
}
