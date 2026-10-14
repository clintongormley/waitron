// The stream's pause at the side-file limit (`./testing/stream-pause-scenario.ts`) with the real
// pinned Litestream against a real S3-compatible server: versitygw, frozen with SIGSTOP.
//
// Binaries as in `stream-loop.e2e.test.ts`: without them this case is reported SKIPPED; with
// CI=true or WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS it.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  VERSITYGW_VERSION,
  resolveLitestream,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";
import {
  STREAM_PAUSE_SCENARIO_MS,
  runStreamPauseScenario,
} from "./testing/stream-pause-scenario.js";

const INSTALL = "node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";

// The helper enforces the S3 server's start; the scenario's own waits are in its sum.
const PAUSE_TIMEOUT_MS = S3_READY_MS + STREAM_PAUSE_SCENARIO_MS;

const litestream = await resolveLitestream(process.env);
const versitygw = await resolveVersitygw(process.env);
const missing = [litestream, versitygw].flatMap((lookup) => (lookup.ok ? [] : [lookup.reason]));
if (missing.length > 0 && !REQUIRED) {
  console.warn(`stream pause test SKIPPED: ${missing.join("; ")}. Install with: ${INSTALL}`);
}

describe("the stream's pause at the side-file limit, with sales on the server's own route", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const cleanup of [
      async () => {
        s3?.resume();
      },
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
    if (failures.length > 0) throw new AggregateError(failures, "stream pause teardown failed");
  });

  it(
    "folds the side file back behind live sales while the bucket is frozen, and resumes streaming once it answers",
    async (ctx) => {
      if (!litestream.ok || !versitygw.ok) {
        if (REQUIRED) {
          throw new Error(
            `stream pause test cannot run: ${missing.join("; ")}. CI installs both with: ${INSTALL}`,
          );
        }
        return ctx.skip(`${missing.join("; ")} — install with: ${INSTALL}`);
      }

      scratch = await mkdtemp(join(tmpdir(), "waitron-stream-pause-"));
      const server = await startS3TestServer({ bin: versitygw.bin, root: join(scratch, "s3") });
      s3 = server;
      await runStreamPauseScenario({
        bucket: {
          endpoint: server.endpoint,
          region: server.region,
          bucket: server.bucket,
          prefix: "pause/",
          accessKeyId: server.accessKeyId,
          secretAccessKey: server.secretAccessKey,
        },
        scratch,
        litestreamBin: litestream.bin,
        describeTransport: () => `versitygw ${VERSITYGW_VERSION}. Server log: ${server.log()}`,
        freeze: { pause: () => server.pause(), resume: () => server.resume() },
      });
    },
    PAUSE_TIMEOUT_MS,
  );
});
