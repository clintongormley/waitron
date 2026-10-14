import { RECEIPT_APIS, REHEARSAL_BUCKET_PATTERN } from "./aws-rehearsal-receipt.js";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";

/** The ownership nonce, at the bucket root; deleted only just before the bucket itself. */
export const AWS_REHEARSAL_NONCE_KEY = ".waitron-rehearsal-owner";

/** The object-level APIs a scenario may declare; no bucket-level API is among them. */
export const SCENARIO_APIS = [
  "GetObject",
  "PutObject",
  "ListObjectsV2",
  "DeleteObject",
  "DeleteObjects",
  "HeadObject",
  "GetBucketLocation",
  "CreateMultipartUpload",
  "UploadPart",
  "CompleteMultipartUpload",
  "AbortMultipartUpload",
  "ListMultipartUploads",
] as const;

/** The runner's own APIs, all on the run's bucket; `PutObject` and `GetObject` of the marker only. */
export const LIFECYCLE_APIS = [
  "CreateBucket",
  "PutObject",
  "GetObject",
  "GetBucketEncryption",
  "GetBucketVersioning",
  "PutBucketPolicy",
  "DeleteBucketPolicy",
  "ListMultipartUploads",
  "AbortMultipartUpload",
  "ListObjectsV2",
  "DeleteObjects",
  "DeleteObject",
  "DeleteBucket",
] as const;

export type RequestSender = "runner" | "scenario";

export interface RequestPlan {
  readonly bucket: string;
  readonly apis: ReadonlySet<string>;
  readonly prefixes: () => ReadonlySet<string>;
}

export interface RequestPlanInput {
  bucket: string;
  apis: readonly string[];
  /** Read on every check, so a prefix issued after the plan is made counts. */
  prefixes: () => ReadonlySet<string>;
}

const LISTING_APIS: ReadonlySet<string> = new Set(["ListObjectsV2", "ListMultipartUploads"]);
const UNKEYED_APIS: ReadonlySet<string> = new Set([...LISTING_APIS, "GetBucketLocation"]);
const MARKER_ONLY_APIS: ReadonlySet<string> = new Set(["PutObject", "GetObject"]);
// Refused whatever a server makes of them: the SDK sends `.` and `..` segments as written.
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/;
const hasDotSegment = (value: unknown): boolean =>
  typeof value === "string" && DOT_SEGMENT.test(value);

export function createRequestPlan(input: RequestPlanInput): RequestPlan {
  for (const api of input.apis) {
    if (!(SCENARIO_APIS as readonly string[]).includes(api)) {
      const known = (RECEIPT_APIS as readonly string[]).includes(api);
      throw new AwsRehearsalRefused(
        "plan-refused",
        known
          ? `a scenario may not declare ${api}, which is not an object-level API`
          : "a scenario may declare only object-level S3 APIs",
      );
    }
  }
  return { bucket: input.bucket, apis: new Set(input.apis), prefixes: input.prefixes };
}

function bucketPhrase(bucket: unknown): string {
  return typeof bucket === "string" && REHEARSAL_BUCKET_PATTERN.test(bucket)
    ? `the bucket ${bucket}, which this run did not create`
    : "a bucket this run did not create";
}

function keysOf(api: string, input: Record<string, unknown>): unknown[] | undefined {
  if (api === "DeleteObjects") {
    const objects = (input.Delete as { Objects?: unknown } | undefined)?.Objects;
    if (!Array.isArray(objects) || objects.length === 0) return undefined;
    return objects.map((object) => (object as { Key?: unknown } | null)?.Key);
  }
  return [input.Key];
}

/** Null when `plan` allows the request; otherwise a detail naming the API and the rule, never a key or prefix. */
export function planRefusal(
  plan: RequestPlan,
  sender: RequestSender,
  api: string,
  input: Record<string, unknown>,
): string | null {
  if (!(RECEIPT_APIS as readonly string[]).includes(api)) {
    return `${api} is not an S3 API the rehearsal knows`;
  }
  if (input.Bucket !== plan.bucket) return `${api} was sent to ${bucketPhrase(input.Bucket)}`;

  if (sender === "runner") {
    if (!(LIFECYCLE_APIS as readonly string[]).includes(api)) {
      return `${api} is not a lifecycle API the runner may send`;
    }
    if (MARKER_ONLY_APIS.has(api) && input.Key !== AWS_REHEARSAL_NONCE_KEY) {
      return `the runner may send ${api} only for the ownership marker`;
    }
    return null;
  }

  if (!plan.apis.has(api)) return `${api} is not among the scenario's declared APIs`;
  const issued = [...plan.prefixes()];
  const underIssued = (value: unknown): boolean =>
    typeof value === "string" && issued.some((prefix) => value.startsWith(prefix));

  if (LISTING_APIS.has(api)) {
    if (hasDotSegment(input.Prefix)) {
      return `no prefix in a scenario's ${api} may have a . or .. path segment`;
    }
    return underIssued(input.Prefix)
      ? null
      : `a scenario's ${api} must list under a prefix this run issued`;
  }
  if (UNKEYED_APIS.has(api)) return null;
  const keys = keysOf(api, input);
  if (keys?.some(hasDotSegment) === true) {
    return `no key in a scenario's ${api} may have a . or .. path segment`;
  }
  if (keys === undefined || !keys.every(underIssued)) {
    return `every key in a scenario's ${api} must be under a prefix this run issued`;
  }
  return null;
}
