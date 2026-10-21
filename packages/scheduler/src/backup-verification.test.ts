import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { scheduledRuns } from "./schema/scheduled-runs.js";
import * as api from "./index.js";

const original = useVenueDb({ migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS] });
const restored = useVenueDb({ migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS] });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const passed = { status: "passed", checks: [{ code: "data", status: "passed" }] };
const invalid = { status: "invalid", checks: [{ code: "data", status: "invalid" }] };
beforeEach(async () => {
  for (const suite of [original, restored]) {
    await suite.db.insert(scheduledRuns).values({
      id: "record",
      duty: "archived-duty",
      periodFrom: "2026-10-19T00:00:00.000Z",
      periodTo: "2026-10-20T00:00:00.000Z",
      state: "running",
      attempts: 3,
      generation: 2,
      nextAttemptAt: "2026-10-20T08:00:00.000Z",
      startedAt: "2026-10-20T07:59:00.000Z",
      finishedAt: null,
      summary: { retained: true },
      errorCode: "unknown",
      createdAt: "2026-10-19T23:00:00.000Z",
      updatedAt: "2026-10-20T07:59:00.000Z",
    });
  }
});
async function run(
  options: { absentBefore?: boolean; emptyAfter?: boolean; sourceSchema?: number | null } = {},
) {
  expect(api.SCHEDULER_BACKUP_VERIFICATION).toBeDefined();
  const path = (db: Database) =>
    db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
  const before = await openBackupQuery(path(options.absentBefore ? absent.db : original.db));
  try {
    const after = await openBackupQuery(path(options.emptyAfter ? absent.db : restored.db));
    try {
      return await api.SCHEDULER_BACKUP_VERIFICATION.verifyRestoredData({
        before: before.query,
        after: after.query,
        entries: {
          async read() {
            throw new Error("No private entries declared");
          },
        },
        source: {
          nodeId: "source",
          locationId: "location",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema: options.sourceSchema === undefined ? 1 : options.sourceSchema,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
it("preserves all captured values without running any duty or action", async () => {
  const before = original.db.all(sql`select * from scheduled_runs`);
  const after = restored.db.all(sql`select * from scheduled_runs`);
  expect(await run()).toEqual(passed);
  expect(original.db.all(sql`select * from scheduled_runs`)).toEqual(before);
  expect(restored.db.all(sql`select * from scheduled_runs`)).toEqual(after);
});
it("declares exactly its real table and no private inputs or restore effects", () => {
  const owner = validateBackupVerificationContribution(api.SCHEDULER_BACKUP_VERIFICATION);
  expect(owner.data).toEqual({
    kind: "custom",
    tables: ["scheduled_runs"],
    immutableTables: [],
    checks: ["data"],
  });
  expect([
    owner.secrets,
    owner.entries,
    owner.effects,
    owner.publicEvidenceDigest,
    owner.zeroSchema,
    owner.targetOnly,
  ]).toEqual([[], [], [], null, "absent_tables_and_entries", "empty_after_migration"]);
});
it.each([
  "update scheduled_runs set summary = '{\"retained\":false}'",
  "update scheduled_runs set attempts = 4",
  "update scheduled_runs set generation = 3",
  "update scheduled_runs set state = 'failed'",
  "update scheduled_runs set duty = 'changed-duty'",
  "update scheduled_runs set period_from = '2026-10-18T00:00:00.000Z'",
  "update scheduled_runs set period_to = '2026-10-21T00:00:00.000Z'",
  "update scheduled_runs set next_attempt_at = null",
  "update scheduled_runs set started_at = null",
  "update scheduled_runs set finished_at = '2026-10-20T08:00:00.000Z'",
  "update scheduled_runs set error_code = null",
  "update scheduled_runs set created_at = '2026-10-18T23:00:00.000Z'",
  "update scheduled_runs set updated_at = '2026-10-20T08:00:00.000Z'",
  "update scheduled_runs set id = 'replacement'",
])("detects a retained value replaced: %s", async (change) => {
  expect(await run()).toEqual(passed);
  restored.db.run(sql.raw(change));
  expect(await run()).toEqual(invalid);
});
it("detects a deleted captured row", async () => {
  restored.db.run(sql`delete from scheduled_runs`);
  expect(await run()).toEqual(invalid);
});
it("detects a new restored-only row", async () => {
  original.db.run(sql`delete from scheduled_runs`);
  expect(await run()).toEqual(invalid);
});
it("refuses a missing restored table", async () => {
  expect(await run({ emptyAfter: true })).toEqual(invalid);
});
it.each([0, null])(
  "refuses declared absence over captured owned state (schema %s)",
  async (sourceSchema) => {
    expect(await run({ sourceSchema })).toEqual(invalid);
  },
);
it.each([0, null])(
  "admits absent source and newly empty target (schema %s)",
  async (sourceSchema) => {
    restored.db.run(sql`delete from scheduled_runs`);
    expect(await run({ absentBefore: true, sourceSchema })).toEqual(passed);
  },
);
it.each([0, null])(
  "refuses target rows when the source was absent (schema %s)",
  async (sourceSchema) => {
    expect(await run({ absentBefore: true, sourceSchema })).toEqual(invalid);
  },
);

it("refuses an applied source schema whose owned table is absent", async () => {
  restored.db.run(sql`delete from scheduled_runs`);
  expect(await run({ absentBefore: true })).toEqual(invalid);
});
