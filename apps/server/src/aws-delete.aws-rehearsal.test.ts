// Deleting 1,005 objects against Amazon S3, in a bucket the rehearsal creates and then tries to
// remove. Runs only under `test:aws-rehearsal` with WAITRON_RUN_AWS_REHEARSAL=1; the runbook is
// docs/developers/aws-backup-rehearsal.md.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { awsScenarioFixture } from "./testing/aws-s3-scenario-fixture.js";
import { runDeleteManyScenario } from "./testing/s3-delete-scenario.js";

describe("AWS rehearsal: deleting many objects in Amazon S3", () => {
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

  it("1,005 objects are deleted in batches and none remain", async () => {
    const folder = await mkdtemp(join(tmpdir(), "waitron-aws-delete-"));
    scratch = folder;
    await rehearsal.run(async (ctx) => {
      await runDeleteManyScenario(awsScenarioFixture(ctx, "delete-many", folder));
    });
  });
});
