export type { ListedObject, ObjectStore, PutCondition, StoredObject } from "./object-store.js";
export { CONFLICT_ATTEMPTS, bucketKey, createS3ObjectStore, normalisePrefix } from "./s3-store.js";
export type { BucketConfig, S3ObjectStoreOptions } from "./s3-store.js";
export { GENERATION_NAME, generationName, parseGenerationName, venuePrefix } from "./names.js";
export {
  pointerKey,
  pointerMessage,
  readPointer,
  signPointer,
  verifyPointer,
  writePointer,
} from "./pointer.js";
export type { SignedPointer, StreamPointer } from "./pointer.js";
export {
  PRUNE_CONCURRENCY,
  claimGeneration,
  generationPrefix,
  markerKey,
  pruneGenerations,
} from "./generations.js";
export { PROBE_PREFIX, probeBucket } from "./probe.js";
export type { ProbeFailure, ProbeResult } from "./probe.js";

// Side-effect only: keeps errors.ts's registry augmentation reachable from this barrel
// (guarded tree-wide by scripts/errors-reachable.test.ts).
import "./errors.js";
