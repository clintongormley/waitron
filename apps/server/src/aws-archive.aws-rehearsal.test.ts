// An encrypted archive's round trip, and an archive upload cancelled part-way, against Amazon S3,
// in one bucket the rehearsal creates and then tries to remove; each scenario has its own prefix and
// both share the run's upload budget. Runs only under `test:aws-rehearsal` with
// WAITRON_RUN_AWS_REHEARSAL=1; the runbook is docs/developers/aws-backup-rehearsal.md.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { awsScenarioFixture } from "./testing/aws-s3-scenario-fixture.js";
import { runArchiveAbort, runArchiveRoundTrip } from "./testing/s3-archive-scenario.js";

describe("AWS rehearsal: archives in Amazon S3", () => {
  const rehearsal = rehearsalLifecycle();
  let scratch: string | undefined;

  // A test that hit its time limit is still running: stop it and wait for its teardown and receipt
  // before its working folder goes.
  afterAll(async () => {
    try {
      await rehearsal?.stop();
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });

  it("an archive goes up and comes back, then an upload cancelled after its first part leaves nothing", async () => {
    const folder = await mkdtemp(join(tmpdir(), "waitron-aws-archive-"));
    scratch = folder;
    await rehearsal.run(async (ctx) => {
      const roundTrip = await mkdtemp(join(folder, "archive-roundtrip-"));
      await runArchiveRoundTrip(awsScenarioFixture(ctx, "archive-roundtrip", roundTrip));
      const abort = await mkdtemp(join(folder, "archive-abort-"));
      await runArchiveAbort(awsScenarioFixture(ctx, "archive-abort", abort));
    });
  });
});
