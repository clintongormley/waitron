// The stream loop (`./testing/stream-loop-scenario.ts`) with the real pinned Litestream against a real
// S3-compatible server: versitygw, run as a plain child process (`./testing/s3-test-server.ts`) and
// frozen with SIGSTOP for stage 8b. Install both binaries with
// `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. Without them this case
// is reported SKIPPED, with the reason in its note. With CI=true (GitHub sets it on every job) or
// WAITRON_REQUIRE_STREAM_BINARIES=1, a missing binary FAILS the case instead.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LOOP_APIS } from "./testing/aws-rehearsal-plans.js";
import { endLocalPlans, runUnderPlan } from "./testing/local-request-plan.js";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  VERSITYGW_VERSION,
  resolveLitestream,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";
import { settleWithin } from "./testing/settle-within.js";
import { trackedSpawn } from "./testing/transport-gate.js";
import {
  STREAM_LOOP_PHASES,
  STREAM_LOOP_SCENARIO_MS,
  runStreamLoopScenario,
  type StreamLoopEvent,
} from "./testing/stream-loop-scenario.js";

const INSTALL = "node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";

// The helper enforces the S3 server's start; the scenario's own waits are in its sum.
const LOOP_TIMEOUT_MS = S3_READY_MS + STREAM_LOOP_SCENARIO_MS;
// After an abort the scenario may still be inside one restore, which its abort cannot cut short.
const ABORT_SETTLE_MS = 60_000;

/** Signal 0 checks the process exists without sending it anything. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const litestream = await resolveLitestream(process.env);
const versitygw = await resolveVersitygw(process.env);
const missing = [litestream, versitygw].flatMap((lookup) => (lookup.ok ? [] : [lookup.reason]));
if (missing.length > 0 && !REQUIRED) {
  console.warn(`stream loop test SKIPPED: ${missing.join("; ")}. Install with: ${INSTALL}`);
}

describe("the stream loop: stream, rebuild from the bucket, sell under a fresh chain, stream again", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;
  const stop = new AbortController();
  let running: Promise<void> | undefined;

  afterAll(async () => {
    const failures: unknown[] = [];
    // A test that hit its time limit is still running: its servers close before versitygw stops.
    stop.abort();
    if (running !== undefined && !(await settleWithin(running, ABORT_SETTLE_MS))) {
      failures.push(new Error(`the stream loop did not stop within ${ABORT_SETTLE_MS} ms`));
    }
    // Each cleanup runs even when an earlier one rejects, so a failed stop cannot leave scratch behind.
    for (const cleanup of [
      async () => {
        if (s3 !== undefined) await s3.stop();
      },
      async () => {
        if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
      },
      endLocalPlans,
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
      const folder = await mkdtemp(join(tmpdir(), "waitron-stream-loop-"));
      scratch = folder;
      const server = await startS3TestServer({ bin: versitygw.bin, root: join(folder, "s3") });
      s3 = server;
      const events: StreamLoopEvent[] = [];
      // Which box's `replicate` children the seam was told of.
      const replicating: Array<{ box: string; pid: number }> = [];
      running = runUnderPlan({ bucket: server.bucket, apis: LOOP_APIS, prefixes: ["loop/"] }, () =>
        runStreamLoopScenario({
          bucket: {
            endpoint: server.endpoint,
            region: server.region,
            bucket: server.bucket,
            prefix: "loop/",
            accessKeyId: server.accessKeyId,
            secretAccessKey: server.secretAccessKey,
          },
          scratch: folder,
          litestreamBin: litestream.bin,
          describeTransport: () => `versitygw ${VERSITYGW_VERSION}. Server log: ${server.log()}`,
          freeze: { pause: () => server.pause(), resume: () => server.resume() },
          signal: stop.signal,
          record: (event) => events.push(event),
          serverSeams: {
            spawn: trackedSpawn((pid, args) => {
              if (args[0] !== "replicate") return;
              const box = /[/\\](box-[ab])[/\\]/.exec(args.at(-1) ?? "")?.[1] ?? "unknown";
              replicating.push({ box, pid });
            }),
          },
        }),
      );
      await running;
      expect(events.map(({ phase, outcome }) => [phase, outcome])).toEqual(
        STREAM_LOOP_PHASES.map((phase) => [phase, "ok"]),
      );
      expect([...new Set(replicating.map(({ box }) => box))].sort()).toEqual(["box-a", "box-b"]);
      // The scenario's closes stopped every Litestream it started.
      expect(replicating.filter(({ pid }) => isRunning(pid))).toEqual([]);
    },
    LOOP_TIMEOUT_MS,
  );
});
