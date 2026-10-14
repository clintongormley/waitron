import type { BucketConfig } from "@waitron/stream";
import type { AwsRehearsal } from "./aws-rehearsal.js";

/**
 * What an S3 rehearsal scenario needs from whoever runs it: `s3-rehearsal-scenarios.e2e.test.ts`
 * supplies one over versitygw, an AWS rehearsal one over its owned bucket. `record` is given the
 * scenario's own events, each naming the scenario; the fixture adds nothing to them.
 */
export type S3ScenarioFixture = Pick<
  AwsRehearsal,
  "signal" | "record" | "reserveUpload" | "reserveObjects" | "trackUpload" | "ownedUploads"
> & {
  /** Its prefix is this scenario's own; an AWS rehearsal takes it from `ctx.prefix(label)`. */
  bucket: BucketConfig;
  venueId: string;
  /** A private folder the scenario may write into; the caller removes it. */
  scratch: string;
};
