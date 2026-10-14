// The Amazon S3 rehearsal's scenarios run against versitygw (`./testing/s3-test-server.ts`), so each
// is proven locally before a rehearsal sends it to AWS. Install the server with
// `node scripts/setup-s3-test-server.mjs`. Without it each case is reported SKIPPED; with CI=true or
// WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS the case instead.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localS3Fixture } from "./testing/local-s3-fixture.js";
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

  it(
    "1,005 objects are deleted in batches of 1,000 and 5 and none remain",
    async (ctx) => {
      const { server, client: admin, scratch: root } = requireServer(ctx);
      const local = localS3Fixture({
        bucket: bucketFor(server, "delete-many"),
        venueId: "venue-1",
        scratch: await mkdtemp(join(root, "delete-many-")),
        signal: stop.signal,
        send: (command) => admin.send(command),
      });
      const summary = await runDeleteManyScenario(local.fixture);
      expect(summary).toEqual({ put: 1005, deleteBatches: [1000, 5], remaining: 0 });
      const tally: Record<string, number> = {};
      for (const { phase, api, httpStatus, outcome } of local.events) {
        if (phase !== "request") continue;
        const line = `${api} ${httpStatus} ${outcome}`;
        tally[line] = (tally[line] ?? 0) + 1;
      }
      console.info(`versitygw answers: ${JSON.stringify(tally)}`);
      expect(local.events.filter(({ phase }) => phase !== "request")).toEqual([
        { scenario: "delete-many", phase: "listed-before", count: 1005, outcome: "ok" },
        { scenario: "delete-many", phase: "deleted", count: 1005, outcome: "ok" },
        { scenario: "delete-many", phase: "listed-after", count: 0, outcome: "ok" },
      ]);
      await expect(local.fixture.ownedUploads(local.fixture.bucket.prefix)).resolves.toEqual([]);
    },
    DELETE_MANY_SCENARIO_MS,
  );
});
