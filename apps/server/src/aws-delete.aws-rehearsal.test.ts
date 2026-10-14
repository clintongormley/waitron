// Deleting 1,005 objects against Amazon S3, in a bucket the rehearsal creates and then tries to
// remove. Runs only under `test:aws-rehearsal` with WAITRON_RUN_AWS_REHEARSAL=1; the runbook is
// docs/developers/aws-backup-rehearsal.md.
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { DELETE_APIS } from "./testing/aws-rehearsal-plans.js";
import { awsScenarioFixture } from "./testing/aws-s3-scenario-fixture.js";
import { runDeleteManyScenario } from "./testing/s3-delete-scenario.js";

describe("AWS rehearsal: deleting many objects in Amazon S3", () => {
  const rehearsal = rehearsalLifecycle({ apis: DELETE_APIS });

  // A test that hit its time limit is still running: stop it and wait for its teardown and receipt.
  afterAll(async () => {
    await rehearsal?.stop();
  });

  it("1,005 objects are deleted in batches and none remain", async () => {
    await rehearsal.run(async (ctx) => {
      const folder = await ctx.scratch("delete");
      await runDeleteManyScenario(awsScenarioFixture(ctx, "delete-many", folder));
    });
  });
});
