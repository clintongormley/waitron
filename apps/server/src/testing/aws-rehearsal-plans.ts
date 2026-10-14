// The S3 APIs each Amazon S3 rehearsal's own clients send, besides the runner's lifecycle requests.
// The loop and pause lists are provisional until their local tests have been run in record mode.
import type { SCENARIO_APIS } from "./aws-request-plan.js";

type ScenarioApi = (typeof SCENARIO_APIS)[number];

/** The in-process servers' stream stores (`createS3ObjectStore`), the bucket probe, pruning and the restore. */
export const LOOP_APIS: readonly ScenarioApi[] = [
  "GetObject",
  "PutObject",
  "ListObjectsV2",
  "DeleteObject",
  "DeleteObjects",
];

/** As the loop, plus the scenario's own store and the listing-denial control's listing. */
export const PAUSE_APIS: readonly ScenarioApi[] = [
  "GetObject",
  "PutObject",
  "ListObjectsV2",
  "DeleteObject",
  "DeleteObjects",
];

/** A multipart upload, its abandonment, the listing, the download and a failed completion's delete. */
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
