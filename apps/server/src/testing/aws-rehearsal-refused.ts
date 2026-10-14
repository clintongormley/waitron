export type AwsRehearsalRefusalReason =
  | "opt-in-missing"
  | "profile-mismatch"
  | "variable-unset"
  | "file-not-absolute"
  | "file-inside-repository"
  | "file-unreadable"
  | "profile-section-missing"
  | "credentials-missing"
  | "session-token-unsupported"
  | "provider-unsupported"
  | "region-mismatch"
  | "supplied-bucket"
  | "receipt-dir-unsupported"
  | "fixture-limit"
  | "label-refused"
  | "prefix-not-issued"
  | "encryption-not-sse-s3"
  | "versioning-not-off"
  | "upload-id-refused"
  | "child-pid-refused"
  | "teardown-started"
  | "receipt-refused"
  | "ownership-unproven"
  | "region-unsupported"
  | "run-id-unsupported"
  | "policy-refused"
  | "plan-refused"
  | "request-unplanned"
  | "journal-refused"
  | "journal-unwritable"
  | "keeper-unavailable"
  | "endpoint-unsupported";

/** Its message names a rule and a variable or key, or a rehearsal bucket's name; never another value read from the environment or a file. */
export class AwsRehearsalRefused extends Error {
  constructor(
    readonly reason: AwsRehearsalRefusalReason,
    detail: string,
  ) {
    super(`AWS rehearsal refused (${reason}): ${detail}`);
    this.name = "AwsRehearsalRefused";
  }
}
