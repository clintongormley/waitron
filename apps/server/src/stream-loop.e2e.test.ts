// The stream loop (`./testing/stream-loop-scenario.ts`) with the real pinned Litestream against a real
// S3-compatible server: versitygw, run as a plain child process (`./testing/s3-test-server.ts`) and
// frozen with SIGSTOP for stage 8b. Install both binaries with
// `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. Without them this case
// is reported SKIPPED, with the reason in its note. With CI=true (GitHub sets it on every job) or
// WAITRON_REQUIRE_STREAM_BINARIES=1, a missing binary FAILS the case instead.
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
import { STREAM_LOOP_SCENARIO_MS, runStreamLoopScenario } from "./testing/stream-loop-scenario.js";

const INSTALL = "node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";

// The helper enforces the S3 server's start; the scenario's own waits are in its sum.
const LOOP_TIMEOUT_MS = S3_READY_MS + STREAM_LOOP_SCENARIO_MS;

const litestream = await resolveLitestream(process.env);
const versitygw = await resolveVersitygw(process.env);
const missing = [litestream, versitygw].flatMap((lookup) => (lookup.ok ? [] : [lookup.reason]));
if (missing.length > 0 && !REQUIRED) {
  console.warn(`stream loop test SKIPPED: ${missing.join("; ")}. Install with: ${INSTALL}`);
}

describe("the stream loop: stream, rebuild from the bucket, sell under a fresh chain, stream again", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;

  afterAll(async () => {
    // Each cleanup runs even when an earlier one rejects, so a failed stop cannot leave scratch behind.
    const failures: unknown[] = [];
    for (const cleanup of [
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
    if (failures.length > 0) throw new AggregateError(failures, "stream loop teardown failed");
  });

  it(
    "box A streams, dies, box B is rebuilt from the kit, sells on a fresh chain and moves the pointer; B's generation restores to B's database",
    async (ctx) => {
      if (!litestream.ok || !versitygw.ok) {
        if (REQUIRED) {
          throw new Error(
            `stream loop test cannot run: ${missing.join("; ")}. CI installs both with: ${INSTALL}`,
          );
        }
        // `return` so TypeScript narrows both lookups below; `ctx.skip` throws either way.
        return ctx.skip(`${missing.join("; ")} — install with: ${INSTALL}`);
      }
      scratch = await mkdtemp(join(tmpdir(), "waitron-stream-loop-"));
      const server = await startS3TestServer({ bin: versitygw.bin, root: join(scratch, "s3") });
      s3 = server;
      await runStreamLoopScenario({
        bucket: {
          endpoint: server.endpoint,
          region: server.region,
          bucket: server.bucket,
          prefix: "loop/",
          accessKeyId: server.accessKeyId,
          secretAccessKey: server.secretAccessKey,
        },
        scratch,
        litestreamBin: litestream.bin,
        describeTransport: () => `versitygw ${VERSITYGW_VERSION}. Server log: ${server.log()}`,
        freeze: { pause: () => server.pause(), resume: () => server.resume() },
      });
    },
    LOOP_TIMEOUT_MS,
  );
});
