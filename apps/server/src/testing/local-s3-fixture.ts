import {
  ListMultipartUploadsCommand,
  type ListMultipartUploadsCommandOutput,
} from "@aws-sdk/client-s3";
import type { BucketConfig } from "@waitron/stream";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { sanitizeEvent, type AwsReceiptEvent } from "./aws-rehearsal-receipt.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

export interface LocalS3Fixture {
  fixture: S3ScenarioFixture;
  /** Every event recorded, each already through the receipt's own `sanitizeEvent`. */
  events: AwsReceiptEvent[];
  tracked: { key: string; uploadId: string }[];
}

/**
 * A scenario fixture over a local S3 server. Its budgets are the AWS rehearsal's own
 * (`AWS_REHEARSAL_LIMITS`), refused the same way, so a scenario over budget fails here first.
 */
export function localS3Fixture(opts: {
  bucket: BucketConfig;
  venueId: string;
  scratch: string;
  signal: AbortSignal;
  /** Sends one administrative command to the local server; used only by `ownedUploads`. */
  send(command: ListMultipartUploadsCommand): Promise<Partial<ListMultipartUploadsCommandOutput>>;
}): LocalS3Fixture {
  const events: AwsReceiptEvent[] = [];
  const tracked: { key: string; uploadId: string }[] = [];
  const record = (event: object): void => {
    events.push(sanitizeEvent(event));
  };
  let uploaded = 0;
  let objects = 0;
  const fixture: S3ScenarioFixture = {
    bucket: opts.bucket,
    venueId: opts.venueId,
    scratch: opts.scratch,
    signal: opts.signal,
    record,
    reserveUpload(bytes, role) {
      const overTotal = uploaded + bytes > AWS_REHEARSAL_LIMITS.uploadedBytes;
      const overArchive = role === "archive" && bytes > AWS_REHEARSAL_LIMITS.archiveBytes;
      if (overTotal || overArchive) {
        record({
          scenario: "lifecycle",
          phase: "fixture-limit",
          objectRole: role,
          bytes,
          outcome: "refused",
        });
        throw new Error(
          `fixture-limit: ${overArchive ? "an archive fixture is over its byte limit" : "the upload budget is spent"}`,
        );
      }
      uploaded += bytes;
    },
    reserveObjects(count) {
      if (objects + count > AWS_REHEARSAL_LIMITS.deleteObjects) {
        record({ scenario: "lifecycle", phase: "fixture-limit", count, outcome: "refused" });
        throw new Error("fixture-limit: the object budget is spent");
      }
      objects += count;
    },
    trackUpload(key, uploadId) {
      tracked.push({ key, uploadId });
    },
    async ownedUploads(prefix) {
      const found: { key: string; uploadId: string }[] = [];
      let markers: { KeyMarker?: string; UploadIdMarker?: string } = {};
      for (;;) {
        const page = await opts.send(
          new ListMultipartUploadsCommand({
            Bucket: opts.bucket.bucket,
            Prefix: prefix,
            ...markers,
          }),
        );
        for (const { Key, UploadId } of page.Uploads ?? []) {
          if (Key !== undefined && UploadId !== undefined)
            found.push({ key: Key, uploadId: UploadId });
        }
        if (page.IsTruncated !== true) return found;
        markers = { KeyMarker: page.NextKeyMarker, UploadIdMarker: page.NextUploadIdMarker };
      }
    },
  };
  return { fixture, events, tracked };
}
