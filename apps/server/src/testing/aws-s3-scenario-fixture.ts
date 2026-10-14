import type { AwsRehearsal } from "./aws-rehearsal.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

/** A scenario fixture over the AWS rehearsal's bucket, under `ctx.prefix(label)`. */
export function awsScenarioFixture(
  ctx: AwsRehearsal,
  label: string,
  scratch: string,
): S3ScenarioFixture {
  return {
    bucket: ctx.bucketConfig(ctx.prefix(label)),
    venueId: "rehearsal-venue",
    scratch,
    signal: ctx.signal,
    record: (event) => ctx.record(event),
    reserveUpload: (bytes, role) => ctx.reserveUpload(bytes, role),
    reserveObjects: (count) => ctx.reserveObjects(count),
    trackUpload: (key, uploadId) => ctx.trackUpload(key, uploadId),
    ownedUploads: (prefix) => ctx.ownedUploads(prefix),
  };
}
