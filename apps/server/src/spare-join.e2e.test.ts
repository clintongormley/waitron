// A main box and a spare in this one process (`./testing/spare-join-scenario.ts`), with the real
// pinned Litestream streaming the main box to versitygw. Install both binaries with
// `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. Without them this case
// is reported SKIPPED, with the reason in its note. With CI=true or WAITRON_REQUIRE_TEST_TOOLS=1, a
// missing binary FAILS the case instead.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  resolveLitestream,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";
import { settleWithin } from "./testing/settle-within.js";
import {
  SPARE_JOIN_PHASES,
  SPARE_JOIN_SCENARIO_MS,
  runSpareJoinScenario,
  type SpareJoinEvent,
} from "./testing/spare-join-scenario.js";

const INSTALL = "node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_TEST_TOOLS === "1";

const JOIN_TIMEOUT_MS = S3_READY_MS + SPARE_JOIN_SCENARIO_MS;
const ABORT_SETTLE_MS = 60_000;

const litestream = await resolveLitestream(process.env);
const versitygw = await resolveVersitygw(process.env);
const missing = [litestream, versitygw].flatMap((lookup) => (lookup.ok ? [] : [lookup.reason]));
if (missing.length > 0 && !REQUIRED) {
  console.warn(`spare join test SKIPPED: ${missing.join("; ")}. Install with: ${INSTALL}`);
}

describe("a spare joins a main box that does not file with Veri*Factu", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;
  const stop = new AbortController();
  let running: Promise<void> | undefined;

  afterAll(async () => {
    const failures: unknown[] = [];
    stop.abort();
    if (running !== undefined && !(await settleWithin(running, ABORT_SETTLE_MS))) {
      failures.push(new Error(`the spare join did not stop within ${ABORT_SETTLE_MS} ms`));
    }
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
    if (failures.length > 0) throw new AggregateError(failures, "spare join teardown failed");
  });

  it(
    "a spare is refused while the main box copies to a bucket, then joins over the venue's network and starts as a mirror holding the main box's sale",
    async (ctx) => {
      if (!litestream.ok || !versitygw.ok) {
        if (REQUIRED) {
          throw new Error(
            `spare join test cannot run: ${missing.join("; ")}. CI installs both with: ${INSTALL}`,
          );
        }
        return ctx.skip(`${missing.join("; ")} — install with: ${INSTALL}`);
      }
      const folder = await mkdtemp(join(tmpdir(), "waitron-spare-join-"));
      scratch = folder;
      const server = await startS3TestServer({ bin: versitygw.bin, root: join(folder, "s3") });
      s3 = server;
      const events: SpareJoinEvent[] = [];
      running = runSpareJoinScenario({
        bucket: {
          endpoint: server.endpoint,
          region: server.region,
          bucket: server.bucket,
          prefix: "join/",
          accessKeyId: server.accessKeyId,
          secretAccessKey: server.secretAccessKey,
        },
        scratch: folder,
        litestreamBin: litestream.bin,
        versitygwBin: versitygw.bin,
        signal: stop.signal,
        record: (event) => {
          events.push(event);
          console.log(
            `spare join phase ${event.phase}: ${event.outcome}, ${Math.round(event.elapsedMs)} ms`,
          );
        },
      });
      await running;
      expect(events.map(({ phase, outcome }) => [phase, outcome])).toEqual(
        SPARE_JOIN_PHASES.map((phase) => [phase, "ok"]),
      );
    },
    JOIN_TIMEOUT_MS,
  );
});
