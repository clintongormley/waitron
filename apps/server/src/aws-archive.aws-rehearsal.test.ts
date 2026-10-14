// An encrypted archive's round trip, and an archive upload cancelled part-way, against Amazon S3,
// in one bucket the rehearsal creates and then tries to remove; each scenario has its own prefix and
// both share the run's upload budget. Runs only under `test:aws-rehearsal` with
// WAITRON_RUN_AWS_REHEARSAL=1; the runbook is docs/developers/aws-backup-rehearsal.md.
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { ARCHIVE_APIS } from "./testing/aws-rehearsal-plans.js";
import { awsScenarioFixture } from "./testing/aws-s3-scenario-fixture.js";
import { runArchiveAbort, runArchiveRoundTrip } from "./testing/s3-archive-scenario.js";

describe("AWS rehearsal: archives in Amazon S3", () => {
  const rehearsal = rehearsalLifecycle({ apis: ARCHIVE_APIS });

  // A test that hit its time limit is still running: stop it and wait for its teardown and receipt.
  afterAll(async () => {
    await rehearsal?.stop();
  });

  it("an archive goes up and comes back, then an upload cancelled after its first part leaves nothing", async () => {
    await rehearsal.run(async (ctx) => {
      const folder = await ctx.scratch("archive");
      await runArchiveRoundTrip(awsScenarioFixture(ctx, "archive-roundtrip", folder));
      await runArchiveAbort(awsScenarioFixture(ctx, "archive-abort", folder));
    });
  });
});
