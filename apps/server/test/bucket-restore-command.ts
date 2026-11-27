import { encodeMasterKeyCode } from "@waitron/shared";
import type { BucketConfig } from "@waitron/stream";

export const TEST_MASTER_KEY = encodeMasterKeyCode(Buffer.alloc(16, 17));

export function bucketRestoreArgs(bucket: BucketConfig): string[] {
  return [
    "restore",
    "--from-bucket",
    "--bucket",
    bucket.bucket,
    "--region",
    bucket.region,
    "--prefix",
    bucket.prefix,
    ...(bucket.endpoint === undefined ? [] : ["--endpoint", bucket.endpoint]),
  ];
}

export function bucketRestoreEnv(bucket: BucketConfig, masterKey = TEST_MASTER_KEY) {
  return {
    WAITRON_MASTER_KEY: masterKey,
    WAITRON_RESTORE_BUCKET_ACCESS_KEY_ID: bucket.accessKeyId,
    WAITRON_RESTORE_BUCKET_SECRET_ACCESS_KEY: bucket.secretAccessKey,
  };
}
