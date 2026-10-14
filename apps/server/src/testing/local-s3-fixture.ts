import {
  ListMultipartUploadsCommand,
  type ListMultipartUploadsCommandOutput,
} from "@aws-sdk/client-s3";
import type { BucketConfig } from "@waitron/stream";
import { sanitizeEvent, type AwsReceiptEvent } from "./aws-rehearsal-receipt.js";
import { fixtureBudget } from "./fixture-budget.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

export interface LocalS3Fixture {
  fixture: S3ScenarioFixture;
  /** Every event recorded, each already through the receipt's own `sanitizeEvent`. */
  events: AwsReceiptEvent[];
  tracked: { key: string; uploadId: string }[];
}

/**
 * A scenario fixture over a local S3 server, with the AWS rehearsal's own budget (`fixtureBudget`),
 * so a scenario over budget fails here first.
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
  const budget = fixtureBudget(record, (detail) => new Error(`fixture-limit: ${detail}`));
  const fixture: S3ScenarioFixture = {
    bucket: opts.bucket,
    venueId: opts.venueId,
    scratch: opts.scratch,
    signal: opts.signal,
    record,
    reserveUpload: budget.reserveUpload,
    reserveObjects: budget.reserveObjects,
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
