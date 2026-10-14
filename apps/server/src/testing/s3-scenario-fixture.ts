import type { BucketConfig } from "@waitron/stream";

/**
 * What an S3 rehearsal scenario needs from whoever runs it: `s3-rehearsal-scenarios.e2e.test.ts`
 * supplies one over versitygw, an AWS rehearsal one over its owned bucket.
 */
export interface S3ScenarioFixture {
  /** Its prefix is this scenario's own; an AWS rehearsal takes it from `ctx.prefix(label)`. */
  bucket: BucketConfig;
  venueId: string;
  /** A private folder the scenario may write into; the caller removes it. */
  scratch: string;
  signal: AbortSignal;
  /**
   * One receipt event. The scenario names itself in every event's `scenario`, its request events
   * included; the fixture adds nothing and refuses what the receipt schema refuses.
   */
  record(event: object): void;
  /** Throws, before any request, once the run's byte budget would be spent. */
  reserveUpload(bytes: number, role: string): void;
  /** Throws, before any request, once the run's object budget would be spent. */
  reserveObjects(count: number): void;
  trackUpload(key: string, uploadId: string): void;
  /** The unfinished multipart uploads under `prefix`, which is `bucket.prefix` or a path below it. */
  ownedUploads(prefix: string): Promise<{ key: string; uploadId: string }[]>;
}
