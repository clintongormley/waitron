// The S3 APIs each Amazon S3 rehearsal's own clients send, besides the runner's lifecycle requests.
// Each scenario's local test runs under the same list (`runUnderPlan`), so a new API fails there first.
import type { SCENARIO_APIS } from "./aws-request-plan.js";

type ScenarioApi = (typeof SCENARIO_APIS)[number];

/**
 * The in-process servers' stream stores, the bucket probe and the restore. No `DeleteObjects`: pruning
 * deletes only generations older than `PRUNE_WINDOW_MS` (seven days), which a new bucket never holds.
 */
export const LOOP_APIS: readonly ScenarioApi[] = [
  "GetObject",
  "PutObject",
  "ListObjectsV2",
  "DeleteObject",
];

/** As the loop, plus the scenario's own store and the listing-denial control's listing. */
export const PAUSE_APIS: readonly ScenarioApi[] = [
  "GetObject",
  "PutObject",
  "ListObjectsV2",
  "DeleteObject",
];

/** A multipart upload, its abandonment, the listing and the download; `DeleteObject` only after a failed completion. */
export const ARCHIVE_APIS: readonly ScenarioApi[] = [
  "CreateMultipartUpload",
  "UploadPart",
  "CompleteMultipartUpload",
  "AbortMultipartUpload",
  "DeleteObject",
  "ListObjectsV2",
  "GetObject",
];

/** Whole puts, the listings and the batch delete; `DeleteObject` for an uncertain put's clean-up. */
export const DELETE_APIS: readonly ScenarioApi[] = [
  "PutObject",
  "ListObjectsV2",
  "DeleteObjects",
  "DeleteObject",
];
