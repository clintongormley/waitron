import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import type { BucketConfig, StreamPointer } from "@waitron/stream";

import { heldBackupKey } from "../src/testing/backup-key.js";

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

export const TEST_BUCKET: BucketConfig = {
  bucket: "saved-copies",
  region: "local",
  prefix: "",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
};

export function bucketRecovery(
  signerPublicKey: string,
  masterKey = TEST_MASTER_KEY,
): NonNullable<StreamPointer["recovery"]> {
  const key = heldBackupKey(decodeMasterKeyCode(masterKey), 2);
  return { signerPublicKey, keyNumber: key.keyNumber, masterKeyId: key.masterKeyId };
}

export const TEST_BUCKET_KEY = heldBackupKey(decodeMasterKeyCode(TEST_MASTER_KEY), 2).key;
