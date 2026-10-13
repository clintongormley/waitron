// The stream loop against Amazon S3, in a bucket the rehearsal creates and always removes. Runs only
// under `test:aws-rehearsal` with WAITRON_RUN_AWS_REHEARSAL=1; the runbook is
// docs/developers/aws-backup-rehearsal.md. Amazon S3 cannot be frozen, so stage 8b's bound is not
// checked here and its receipt event says `skipped`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAwsRehearsal } from "./testing/aws-rehearsal.js";
import { resolveLitestream } from "./testing/s3-test-server.js";
import { runStreamLoopScenario } from "./testing/stream-loop-scenario.js";

describe("AWS rehearsal: the stream loop against Amazon S3", () => {
  it("box A streams, dies, box B is rebuilt from the kit and its generation restores to its database", async () => {
    const litestream = await resolveLitestream(process.env);
    if (!litestream.ok) {
      throw new Error(
        `the AWS stream loop rehearsal cannot run: ${litestream.reason}. Install with: node scripts/setup-litestream.mjs`,
      );
    }
    const scratch = await mkdtemp(join(tmpdir(), "waitron-aws-stream-loop-"));
    try {
      await withAwsRehearsal(async (ctx) =>
        runStreamLoopScenario({
          bucket: ctx.bucketConfig(ctx.prefix("loop")),
          scratch,
          litestreamBin: litestream.bin,
          describeTransport: () => `Amazon S3, region ${ctx.region}`,
          record: (event) => ctx.record({ scenario: "loop", ...event }),
        }),
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
