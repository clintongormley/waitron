// The Amazon S3 rehearsal's scenarios run against versitygw (`./testing/s3-test-server.ts`), so each
// is proven locally before a rehearsal sends it to AWS. Install the server with
// `node scripts/setup-s3-test-server.mjs`. Without it each case is reported SKIPPED; with CI=true or
// WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS the case instead.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CreateMultipartUploadCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveNamespace } from "./archive-settings.js";
import { localS3Fixture, type LocalS3Fixture } from "./testing/local-s3-fixture.js";
import {
  ARCHIVE_SCENARIO_MS,
  runArchiveAbort,
  runArchiveRoundTrip,
} from "./testing/s3-archive-scenario.js";
import { DELETE_MANY_SCENARIO_MS, runDeleteManyScenario } from "./testing/s3-delete-scenario.js";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";

const INSTALL = "node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";

const versitygw = await resolveVersitygw(process.env);
if (!versitygw.ok && !REQUIRED) {
  console.warn(`S3 rehearsal scenarios SKIPPED: ${versitygw.reason}. Install with: ${INSTALL}`);
}

describe("the S3 rehearsal scenarios, against versitygw", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;
  let client: S3Client | undefined;
  const stop = new AbortController();

  beforeAll(async () => {
    if (!versitygw.ok) return;
    scratch = await mkdtemp(join(tmpdir(), "waitron-s3-scenarios-"));
    s3 = await startS3TestServer({ bin: versitygw.bin, root: join(scratch, "s3") });
    client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }, S3_READY_MS + 10_000);

  afterAll(async () => {
    stop.abort();
    const failures: unknown[] = [];
    for (const cleanup of [
      () => client?.destroy(),
      async () => {
        if (s3 !== undefined) await s3.stop();
      },
      async () => {
        if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "S3 scenario teardown failed");
  });

  function requireServer(ctx: { skip(note: string): never }): {
    server: S3TestServer;
    client: S3Client;
    scratch: string;
  } {
    if (!versitygw.ok) {
      if (REQUIRED) {
        throw new Error(
          `S3 scenarios cannot run: ${versitygw.reason}. CI installs it with: ${INSTALL}`,
        );
      }
      return ctx.skip(`${versitygw.reason} — install with: ${INSTALL}`);
    }
    if (s3 === undefined || client === undefined || scratch === undefined) {
      throw new Error("the S3 test server did not start");
    }
    return { server: s3, client, scratch };
  }

  function bucketFor(server: S3TestServer, label: string) {
    return {
      endpoint: server.endpoint,
      region: server.region,
      bucket: server.bucket,
      prefix: `local-${randomUUID()}/${label}/`,
      accessKeyId: server.accessKeyId,
      secretAccessKey: server.secretAccessKey,
    };
  }

  async function scenarioFixture(
    ctx: { skip(note: string): never },
    label: string,
  ): Promise<LocalS3Fixture> {
    const { server, client: admin, scratch: root } = requireServer(ctx);
    return localS3Fixture({
      bucket: bucketFor(server, label),
      venueId: "venue-1",
      scratch: await mkdtemp(join(root, `${label}-`)),
      signal: stop.signal,
      send: (command) => admin.send(command),
    });
  }

  function deleteManyFixture(ctx: { skip(note: string): never }): Promise<LocalS3Fixture> {
    return scenarioFixture(ctx, "delete-many");
  }

  /** What versitygw answered, as `api status outcome` with a count of each. */
  function answers(local: LocalS3Fixture): Record<string, number> {
    const tally: Record<string, number> = {};
    for (const { phase, api, httpStatus, outcome } of local.events) {
      if (phase !== "request") continue;
      const line = `${api} ${httpStatus} ${outcome}`;
      tally[line] = (tally[line] ?? 0) + 1;
    }
    return tally;
  }

  /** The fixture, with `record` throwing `failure` after recording the `nth` request to `api`. */
  function failingAt(local: LocalS3Fixture, api: string, nth: number, failure: Error) {
    let seen = 0;
    return {
      ...local.fixture,
      record(event: object) {
        local.fixture.record(event);
        if ((event as { api?: unknown }).api === api && ++seen === nth) throw failure;
      },
    };
  }

  /** A refusal the bucket client does not retry, so the request fails at once. */
  function injected(): Error {
    return Object.assign(new Error("injected for the test"), {
      $metadata: { httpStatusCode: 403 },
    });
  }

  it(
    "1,005 objects are deleted in batches of 1,000 and 5 and none remain",
    async (ctx) => {
      const local = await deleteManyFixture(ctx);
      const summary = await runDeleteManyScenario(local.fixture);
      expect(summary).toEqual({ put: 1005, deleteBatches: [1000, 5], remaining: 0 });
      console.info(`versitygw answers: ${JSON.stringify(answers(local))}`);
      expect(local.events.filter(({ phase }) => phase !== "request")).toEqual([
        { scenario: "delete-many", phase: "listed-before", count: 1005, outcome: "ok" },
        { scenario: "delete-many", phase: "deleted", count: 1005, outcome: "ok" },
        { scenario: "delete-many", phase: "listed-after", count: 0, outcome: "ok" },
      ]);
      await expect(local.fixture.ownedUploads(local.fixture.bucket.prefix)).resolves.toEqual([]);
    },
    DELETE_MANY_SCENARIO_MS,
  );

  it("refuses a 1,006th object before it sends any request", async (ctx) => {
    const local = await deleteManyFixture(ctx);
    local.fixture.reserveObjects(1);
    await expect(runDeleteManyScenario(local.fixture)).rejects.toThrow(/fixture-limit/);
    expect(local.events).toEqual([
      { scenario: "lifecycle", phase: "fixture-limit", count: 1005, outcome: "refused" },
    ]);
  });

  it(
    "stops every upload once one fails, so no request follows the rejection",
    async (ctx) => {
      const local = await deleteManyFixture(ctx);
      const failure = injected();
      await expect(
        runDeleteManyScenario(failingAt(local, "PutObject", 50, failure)),
      ).rejects.toMatchObject({ params: { operation: "put", status: 403 } });
      const atRejection = local.events.length;
      await delay(1000);
      expect(local.events.length).toBe(atRejection);
      expect(local.events.filter(({ api }) => api === "PutObject").length).toBeLessThan(100);
      expect(local.events.filter(({ phase }) => phase !== "request")).toEqual([
        { scenario: "delete-many", phase: "put", outcome: "failed", errorName: "AppError" },
      ]);
    },
    DELETE_MANY_SCENARIO_MS,
  );

  it(
    "records a listing that fails as a failed phase",
    async (ctx) => {
      const local = await deleteManyFixture(ctx);
      const failure = injected();
      await expect(
        runDeleteManyScenario(failingAt(local, "ListObjectsV2", 1, failure)),
      ).rejects.toMatchObject({ params: { operation: "list", status: 403 } });
      expect(local.events.filter(({ phase }) => phase !== "request")).toEqual([
        {
          scenario: "delete-many",
          phase: "listed-before",
          outcome: "failed",
          errorName: "AppError",
        },
      ]);
    },
    DELETE_MANY_SCENARIO_MS,
  );

  it(
    "a 32 MiB archive goes up in four parts and comes back through its saved pack alone",
    async (ctx) => {
      const local = await scenarioFixture(ctx, "archive-roundtrip");
      const summary = await runArchiveRoundTrip(local.fixture);
      console.info(`versitygw answers (archive round trip): ${JSON.stringify(answers(local))}`);
      expect(summary).toEqual({ bytes: 32 * 1024 * 1024, parts: 4, partBytes: 8 * 1024 * 1024 });
      expect(local.events.filter(({ phase }) => phase !== "request")).toEqual([
        {
          scenario: "archive-roundtrip",
          phase: "uploaded",
          count: 4,
          bytes: 33554432,
          outcome: "ok",
        },
        {
          scenario: "archive-roundtrip",
          phase: "listed",
          count: 1,
          bytes: 33554432,
          outcome: "ok",
        },
        { scenario: "archive-roundtrip", phase: "downloaded", bytes: 33554432, outcome: "ok" },
        { scenario: "archive-roundtrip", phase: "decrypted-match", outcome: "ok" },
        { scenario: "archive-roundtrip", phase: "wrong-key-refused", outcome: "ok" },
        { scenario: "archive-roundtrip", phase: "tamper-refused", outcome: "ok" },
      ]);
      expect(local.tracked).toHaveLength(1);
      await expect(local.fixture.ownedUploads(local.fixture.bucket.prefix)).resolves.toEqual([]);
      expect(await readdir(local.fixture.scratch)).toEqual([]);
    },
    ARCHIVE_SCENARIO_MS,
  );

  it(
    "an upload cancelled after its first part is abandoned, leaving no upload and no object",
    async (ctx) => {
      const local = await scenarioFixture(ctx, "archive-abort");
      const summary = await runArchiveAbort(local.fixture);
      console.info(`versitygw answers (archive abort): ${JSON.stringify(answers(local))}`);
      console.info(`archive abort: ${JSON.stringify(summary)}`);
      expect(summary.partsBeforeAbort).toBeGreaterThanOrEqual(1);
      expect(summary.uploadsAfter).toBe(0);
      expect(local.events.filter(({ phase }) => phase !== "request")).toEqual([
        { scenario: "archive-abort", phase: "aborted", errorName: "AbortError", outcome: "ok" },
        { scenario: "archive-abort", phase: "uploads-after", count: 0, outcome: "ok" },
        { scenario: "archive-abort", phase: "listed-after", count: 0, outcome: "ok" },
      ]);
      expect(local.tracked).toHaveLength(1);
      expect(await readdir(local.fixture.scratch)).toEqual([]);
    },
    ARCHIVE_SCENARIO_MS,
  );

  it.for([
    {
      left: "an unfinished upload",
      leave: (admin: S3Client, bucket: string, folder: string) =>
        admin.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: `${folder}stray.bin` })),
      after: { phase: "uploads-after", count: 1 },
    },
    {
      left: "an object in a deeper folder",
      leave: (admin: S3Client, bucket: string, folder: string) =>
        admin.send(
          new PutObjectCommand({ Bucket: bucket, Key: `${folder}nested/stray.bin`, Body: "x" }),
        ),
      after: { phase: "listed-after", count: 1 },
    },
  ])(
    "the abort fails when $left is under its archive folder at another key",
    { timeout: ARCHIVE_SCENARIO_MS },
    async ({ leave, after }, ctx) => {
      const local = await scenarioFixture(ctx, "archive-abort");
      const { client: admin } = requireServer(ctx);
      const { bucket, prefix } = local.fixture.bucket;
      const folder = archiveNamespace(prefix, local.fixture.venueId);
      await leave(admin, bucket, folder);
      await expect(runArchiveAbort(local.fixture)).rejects.toThrow();
      expect(local.events).toContainEqual({ scenario: "archive-abort", ...after, outcome: "ok" });
    },
  );
});
