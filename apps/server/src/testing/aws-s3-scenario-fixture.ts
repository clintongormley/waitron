import type { AwsRehearsal } from "./aws-rehearsal.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

/** A scenario fixture over the AWS rehearsal's bucket, under `ctx.prefix(label)`. */
export function awsScenarioFixture(
  ctx: AwsRehearsal,
  label: string,
  scratch: string,
): S3ScenarioFixture {
  const { signal, record, reserveUpload, reserveObjects, trackUpload, ownedUploads } = ctx;
  return {
    bucket: ctx.bucketConfig(ctx.prefix(label)),
    venueId: "rehearsal-venue",
    scratch,
    signal,
    record,
    reserveUpload,
    reserveObjects,
    trackUpload,
    ownedUploads,
  };
}
