export type { ListedObject, ObjectStore, PutCondition, StoredObject } from "./object-store.js";
export { CONFLICT_ATTEMPTS, createS3ObjectStore } from "./s3-store.js";
export type { BucketConfig, S3ObjectStoreOptions } from "./s3-store.js";
export {
  GENERATION_NAME,
  bucketKey,
  generationName,
  normalisePrefix,
  parseGenerationName,
  venuePrefix,
} from "./names.js";
export {
  pointerKey,
  pointerMessage,
  readPointer,
  SentPointers,
  signPointer,
  verifyPointer,
  writePointer,
} from "./pointer.js";
export type { SignedPointer, StreamPointer } from "./pointer.js";
export { claimGeneration, generationPrefix, markerKey, pruneGenerations } from "./generations.js";
export { PROBE_PREFIX, probeBucket } from "./probe.js";
export type { ProbeFailure, ProbeResult } from "./probe.js";
export {
  ENV_ACCESS_KEY_ID,
  ENV_SECRET_ACCESS_KEY,
  LITESTREAM_VERSION,
  checkLitestreamSettings,
  resolveLitestreamBin,
} from "./litestream.js";
export { readBucketConfig } from "./bucket-config.js";
export type { ChildHandle, SpawnFn } from "./litestream-process.js";
export { DEFAULT_WAL_LIMIT_BYTES, L0_RETENTION_MS, StreamSupervisor } from "./supervisor.js";
export type {
  StreamLog,
  StreamNotStarted,
  StreamState,
  StreamStatus,
  StreamView,
  SupervisorDeps,
} from "./supervisor.js";
export { COMMIT_GRANULARITY_MS, CommitLog, computeLag } from "./freshness.js";
export type { LagInput } from "./freshness.js";
export { KIT_PREFIX, encodeRecoveryKit, parseRecoveryKit } from "./kit.js";
export type { RecoveryKit } from "./kit.js";
export { RESTORE_CEILING_MS, RESTORE_STALL_MS, restoreGeneration } from "./restore.js";
export type { RestoreGenerationArgs } from "./restore.js";

// Side-effect only: keeps errors.ts's registry augmentation reachable from this barrel
// (guarded tree-wide by scripts/errors-reachable.test.ts).
import "./errors.js";
