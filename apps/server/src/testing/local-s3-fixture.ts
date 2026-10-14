import type {
  ListMultipartUploadsCommand,
  ListMultipartUploadsCommandOutput,
} from "@aws-sdk/client-s3";
import type { BucketConfig } from "@waitron/stream";
import {
  carriesKeyPair,
  isReceiptUploadId,
  sanitizeEvent,
  type AwsReceiptEvent,
} from "./aws-rehearsal-receipt.js";
import { fixtureBudget } from "./fixture-budget.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";
import { listUploads, type TrackedUpload } from "./s3-listing.js";

export interface LocalS3Fixture {
  fixture: S3ScenarioFixture;
  /** Every event recorded, each already through the receipt's own `sanitizeEvent`. */
  events: AwsReceiptEvent[];
  tracked: TrackedUpload[];
}

/**
 * A scenario fixture over a local S3 server, with the AWS rehearsal's own budget (`fixtureBudget`)
 * and its refusals of a prefix and an upload id, so a scenario the rehearsal would refuse fails here
 * first.
 */
export function localS3Fixture(opts: {
  bucket: BucketConfig;
  venueId: string;
  scratch: string;
  signal: AbortSignal;
  /** Sends one administrative command to the local server; used only by `ownedUploads`. */
  send(
    command: ListMultipartUploadsCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<Partial<ListMultipartUploadsCommandOutput>>;
}): LocalS3Fixture {
  const events: AwsReceiptEvent[] = [];
  const tracked: TrackedUpload[] = [];
  const record = (event: unknown): void => {
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
      if (!isReceiptUploadId(uploadId) || carriesKeyPair(uploadId, opts.bucket)) {
        throw new Error("upload-id-refused: an upload id the receipt could not carry");
      }
      tracked.push({ key, uploadId });
    },
    async ownedUploads(prefix) {
      if (!prefix.startsWith(opts.bucket.prefix)) {
        throw new Error(`prefix-not-issued: list under ${opts.bucket.prefix} or a path below it`);
      }
      const found: TrackedUpload[] = [];
      for await (const page of listUploads(
        async (command) => {
          try {
            return { output: await opts.send(command, { abortSignal: opts.signal }) };
          } catch (error) {
            return { error };
          }
        },
        {
          bucket: opts.bucket.bucket,
          prefix,
          failure: (message) => new Error(message),
          signal: opts.signal,
        },
      )) {
        if (page.error !== undefined) throw page.error;
        found.push(...page.uploads);
      }
      return found;
    },
  };
  return { fixture, events, tracked };
}
