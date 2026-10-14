// The stream loop against Amazon S3, in a bucket the rehearsal creates and then tries to remove. Runs only
// under `test:aws-rehearsal` with WAITRON_RUN_AWS_REHEARSAL=1; the runbook is
// docs/developers/aws-backup-rehearsal.md. This test passes no `freeze`, so stage 8b's bound is not
// checked here and its receipt event says `skipped`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { resolveLitestream } from "./testing/s3-test-server.js";
import { runStreamLoopScenario } from "./testing/stream-loop-scenario.js";

describe("AWS rehearsal: the stream loop against Amazon S3", () => {
  const rehearsal = rehearsalLifecycle();
  let scratch: string | undefined;

  // A test that hit its time limit is still running: stop it and wait for its teardown and receipt
  // before its working folder goes.
  afterAll(async () => {
    try {
      await rehearsal.stop();
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });

  it("box A streams, dies, box B is rebuilt from the kit and its generation restores to its database", async () => {
    const litestream = await resolveLitestream(process.env);
    if (!litestream.ok) {
      throw new Error(
        `the AWS stream loop rehearsal cannot run: ${litestream.reason}. Install with: node scripts/setup-litestream.mjs`,
      );
    }
    const folder = await mkdtemp(join(tmpdir(), "waitron-aws-stream-loop-"));
    scratch = folder;
    await rehearsal.run(async (ctx) =>
      runStreamLoopScenario({
        bucket: ctx.bucketConfig(ctx.prefix("loop")),
        scratch: folder,
        litestreamBin: litestream.bin,
        describeTransport: () => `Amazon S3, region ${ctx.region}`,
        signal: ctx.signal,
        record: (event) => ctx.record({ scenario: "loop", ...event }),
      }),
    );
  });
});
