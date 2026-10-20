import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, nodes, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import {
  validateBackupModuleResult,
  validateBackupVerificationContribution,
} from "@waitron/module";
import { jobOrigin } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WORKFORCE_CLASSIFICATION } from "./classification.js";
import { WORKFORCE_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { appendToChain, type TimeEntryAppend } from "./chain.js";
import { closePayPeriod } from "./pay-period-close.js";
import { makeRuleset } from "../test/fixtures.js";
import { timeEntries } from "./schema/time-entries.js";
import { workforceChains } from "./schema/workforce-chains.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";
import { payPeriodSettings } from "./schema/pay-period-settings.js";

const migrations = [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const at = "2026-01-05T09:00:00.000Z";
const person = "10000000-0000-4000-8000-000000000001";
const place = "10000000-0000-4000-8000-000000000002";
const otherPlace = "10000000-0000-4000-8000-000000000003";
const node = "10000000-0000-4000-8000-000000000004";
const retired = "10000000-0000-4000-8000-000000000005";
const codes = ["data", "chain", "head", "history"] as const;
const passed = { status: "passed", checks: codes.map((code) => ({ code, status: "passed" })) };
let requestId: string;

beforeEach(async () => {
  for (const suite of [original, restored]) {
    await seedTenant(suite.db);
    await suite.db.insert(persons).values({ id: person, displayName: "Worker" });
    await suite.db.insert(locations).values([
      { id: place, name: "Main", invoiceLocales: ["en"], operationDescription: "Sale" },
      { id: otherPlace, name: "Archive", invoiceLocales: ["en"], operationDescription: "Sale" },
    ]);
    await suite.db.insert(nodes).values([
      { id: node, locationId: place, name: "Current" },
      { id: retired, locationId: place, name: "Retired" },
    ]);
  }
  const append = (nodeId: string, locationId: string, entry: Partial<TimeEntryAppend> = {}) =>
    original.db.transaction((tx) =>
      appendToChain(
        tx,
        { nodeId, locationId },
        {
          personId: person,
          entryKind: "in",
          eventAt: at,
          eventOffsetMinutes: 60,
          recordedByPersonId: person,
          origin: jobOrigin("dashboard"),
          extension: {
            authorKind: "worker",
            direction: null,
            missingEntryKind: null,
            respondsToEntryId: null,
            payPeriodClosureId: null,
          },
          ...entry,
        },
        () => new Date(at),
      ),
    );
  for (const [n, p] of [
    [node, place],
    [retired, place],
    [node, otherPlace],
  ]) {
    const first = await append(n!, p!);
    await append(n!, p!, { entryKind: "out", eventAt: "2026-01-05T17:00:00.000Z" });
    const request = await append(n!, p!, {
      entryKind: "correction",
      correctsEntryId: first.id,
      correctionReason: "Wrong time",
      correctionStatus: "requested",
      correctionActorId: person,
      extension: {
        authorKind: "worker",
        direction: "worker_request",
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    });
    requestId = request.id;
    await append(n!, p!, {
      entryKind: "correction",
      correctsEntryId: first.id,
      correctionReason: "Wrong time",
      correctionStatus: "approved",
      correctionActorId: person,
      extension: {
        selfApproved: true,
        authorKind: "manager",
        direction: "worker_request",
        missingEntryKind: null,
        respondsToEntryId: request.id,
        payPeriodClosureId: null,
      },
    });
    await append(n!, p!, {
      entryKind: "out",
      recordedByPersonId: null,
      eventAt: "2026-01-05T18:00:00.000Z",
      extension: {
        authorKind: "automatic",
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    });
  }
  for (const [index, start, end] of [
    [1, "2026-01-01", "2026-02-01"],
    [2, "2026-02-01", "2026-03-01"],
    [3, "2026-03-01", "2026-04-01"],
  ] as const) {
    await original.db.transaction((tx) =>
      closePayPeriod(tx, {
        nodeId: node,
        locationId: place,
        period: { start, end },
        clock: { timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] },
        now: `2026-0${index + 1}-01T00:00:01.000Z`,
        ruleset: makeRuleset(),
        origin: jobOrigin("dashboard"),
      }),
    );
  }
  await original.db.transaction((tx) =>
    closePayPeriod(tx, {
      nodeId: retired,
      locationId: otherPlace,
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock: { timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] },
      now: "2026-02-01T00:00:01.000Z",
      ruleset: makeRuleset(),
      origin: jobOrigin("dashboard"),
    }),
  );
  await original.db.insert(payPeriodSettings).values({ id: 1, frequency: "monthly" });
  const closures = await original.db.select().from(payPeriodClosures);
  await restored.db.insert(payPeriodClosures).values(closures);
  await restored.db.insert(timeEntries).values(await original.db.select().from(timeEntries));
  await restored.db
    .insert(workforceChains)
    .values(await original.db.select().from(workforceChains));
  await restored.db.insert(payPeriodSettings).values({ id: 1, frequency: "monthly" });
});

async function corrupt(db: Database, statement: string) {
  const triggers = db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_schema where type='trigger'`,
  );
  for (const row of triggers) db.run(sql.raw(`drop trigger "${row.name.replaceAll('"', '""')}"`));
  db.run(sql`pragma foreign_keys=off`);
  db.run(sql`pragma ignore_check_constraints=on`);
  try {
    for (const part of statement.split(";")) if (part.trim()) db.run(sql.raw(part));
  } finally {
    db.run(sql`pragma ignore_check_constraints=off`);
    db.run(sql`pragma foreign_keys=on`);
    for (const row of triggers) db.run(sql.raw(row.sql));
  }
}
async function both(statement: string) {
  await corrupt(original.db, statement);
  await corrupt(restored.db, statement);
}
async function run(
  beforeDb = original.db,
  afterDb = restored.db,
  fault?: { statement: string; field: string; error: Error },
) {
  const path = (db: Database) =>
    db.all<{ file: string }>(sql`pragma database_list`).find((r) => r.file.endsWith("venue.db"))!
      .file;
  const before = await openBackupQuery(path(beforeDb));
  try {
    const after = await openBackupQuery(path(afterDb));
    try {
      return await OWNER.verifyRestoredData({
        before:
          fault === undefined
            ? before.query
            : ({
                async *rows(statement, values) {
                  for await (const row of before.query.rows(statement, values)) {
                    if (statement !== fault.statement) {
                      yield row;
                      continue;
                    }
                    yield Object.defineProperty({ ...row }, fault.field, {
                      get() {
                        throw fault.error;
                      },
                    });
                  }
                },
              } satisfies BackupQuery),
        after: after.query,
        entries: {
          async read() {
            throw new Error("Undeclared non-database read");
          },
        },
        source: { nodeId: node, locationId: place, environment: "preproduction", createdAt: at },
        sourceSchema: 1,
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
function invalid(result: Awaited<ReturnType<typeof run>>, code: (typeof codes)[number]) {
  expect(result.status).toBe("invalid");
  expect(result.checks.find((c) => c.code === code)?.status).toBe("invalid");
}

describe("complete captured workforce backup evidence", () => {
  it("walks every node-location time chain and stored head including retired nodes", async () => {
    expect(await run()).toEqual(passed);
    expect(original.db.all(sql`select * from workforce_chains`)).toHaveLength(3);
  });
  it.each(["before", "after"])(
    "validates %s evidence independently of row comparison",
    async (side) => {
      await corrupt(
        side === "before" ? original.db : restored.db,
        `update time_entries set entry_hash='${"C".repeat(64)}' where sequence_no=2`,
      );
      invalid(await run(), "chain");
    },
  );
  it.each(["before", "after"])(
    "validates %s closure history independently of row comparison",
    async (side) => {
      await corrupt(
        side === "before" ? original.db : restored.db,
        `update pay_period_closures set closure_hash='${"C".repeat(64)}' where sequence_no=1`,
      );
      invalid(await run(), "history");
    },
  );
  it("checks retired-node closure history at another location", async () => {
    await both(
      `update pay_period_closures set closure_hash='${"C".repeat(64)}' where node_id='${retired}'`,
    );
    invalid(await run(), "history");
  });
  it("accepts legacy entries with no record extension", async () => {
    const added = await original.db.transaction((tx) =>
      appendToChain(
        tx,
        { nodeId: retired, locationId: place },
        {
          personId: person,
          entryKind: "in",
          eventAt: at,
          eventOffsetMinutes: 0,
          recordedByPersonId: person,
          origin: jobOrigin("dashboard"),
        },
        () => new Date(at),
      ),
    );
    const row = (await original.db.select().from(timeEntries)).find((r) => r.id === added.id)!;
    await restored.db.insert(timeEntries).values(row);
    const head = (await original.db.select().from(workforceChains)).find(
      (r) => r.nodeId === retired,
    )!;
    await restored.db
      .update(workforceChains)
      .set(head)
      .where(sql`node_id=${retired} and location_id=${place}`);
    expect(await run()).toEqual(passed);
  });
  it.each([
    "sequence_no=9007199254740992",
    "sequence_no=-9007199254740992",
    "event_offset_minutes=1.25",
    "is_first_entry=2",
    "self_approved=2",
    "person_id=x'01'",
    "node_id=x'01'",
    "correction_reason=x'01'",
    "event_at='not-a-time'",
    "event_at='2026-01-05T09:00:00Z'",
  ])("rejects invalid stored time representation %s", async (change) => {
    await both(`update time_entries set ${change} where node_id='${retired}' and sequence_no=1`);
    invalid(await run(), "chain");
  });
  it.each(["node_id=x'01'", "location_id=x'01'"])(
    "rejects malformed stored head scope %s",
    async (change) => {
      await both(`update workforce_chains set ${change} where node_id='${retired}'`);
      invalid(await run(), "head");
    },
  );
  it.each(["last_entry_id='orphan'", "last_entry_hash='orphan'", "last_recorded_at='orphan'"])(
    "rejects an empty head with %s",
    async (change) => {
      await both(
        "delete from time_entries; delete from pay_period_closures; update workforce_chains set sequence_no=0,last_entry_id=null,last_entry_hash=null,last_recorded_at=null",
      );
      await both(`update workforce_chains set ${change} where node_id='${retired}'`);
      invalid(await run(), "head");
    },
  );
  it.each(["snapshot=x'01'", "node_id=x'01'", "sequence_no=1.25", "closed_at='bad'"])(
    "rejects malformed closure representation %s",
    async (change) => {
      await both(`update pay_period_closures set ${change} where node_id='${retired}'`);
      invalid(await run(), "history");
    },
  );
  it.each([
    [
      "time decoder",
      "select * from time_entries order by node_id, location_id, sequence_no",
      "person_id",
    ],
    ["head decoder", "select * from workforce_chains", "node_id"],
    ["closure decoder", "select * from pay_period_closures", "snapshot"],
  ])(
    "does not classify an unexpected %s failure as corrupt data",
    async (_name, statement, field) => {
      const error = new Error("Unavailable private decoder");
      await expect(
        run(original.db, restored.db, { statement: statement!, field: field!, error }),
      ).rejects.toBe(error);
    },
  );
  it("registers explicit obligations for every classified table", () => {
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data.tables).toEqual(WORKFORCE_CLASSIFICATION.map((c) => c.table));
    expect(owner.data.immutableTables).toEqual([
      "time_entries",
      "pay_period_closures",
      "workforce_chains",
    ]);
    expect([owner.secrets, owner.entries, owner.effects]).toEqual([[], [], []]);
    expect(validateBackupModuleResult(passed, owner, false)).toEqual(passed);
  });
  it.each([node, retired])("detects old middle damage on node %s", async (n) => {
    await both(
      `update time_entries set event_offset_minutes=120 where node_id='${n}' and location_id='${place}' and sequence_no=2`,
    );
    invalid(await run(), "chain");
  });
  it("detects damage on another location", async () => {
    await both(
      `update time_entries set entry_hash='${"A".repeat(64)}' where location_id='${otherPlace}' and sequence_no=1`,
    );
    invalid(await run(), "chain");
  });
  it.each([
    "person_id",
    "entry_kind",
    "event_at",
    "recorded_at",
    "captured_by_source",
    "captured_by_device_id",
    "recorded_by_person_id",
    "corrects_entry_id",
    "correction_reason",
    "correction_status",
    "correction_actor_id",
    "author_kind",
    "correction_direction",
    "missing_entry_kind",
    "responds_to_entry_id",
    "pay_period_closure_id",
    "self_approved",
  ])("checks hashed %s in the captured source", async (column) => {
    const numeric = column === "self_approved";
    await both(
      `update time_entries set "${column}"=${numeric ? "0" : "'changed'"} where self_approved=1`,
    );
    invalid(await run(), "chain");
  });
  it.each(["sequence_no=7", "is_first_entry=1", "prev_entry_hash='wrong'"])(
    "rejects broken entry position %s",
    async (change) => {
      await both(`update time_entries set ${change} where node_id='${retired}' and sequence_no=2`);
      invalid(await run(), "chain");
    },
  );
  it("detects a lost old middle entry", async () => {
    await both(`delete from time_entries where id='${requestId}'`);
    invalid(await run(), "chain");
  });
  it("detects source tail loss against its stored head", async () => {
    await both(`delete from time_entries where node_id='${retired}' and sequence_no=5`);
    invalid(await run(), "head");
  });
  it.each([
    "sequence_no=0",
    "last_entry_id=null",
    "last_entry_hash='wrong'",
    "last_recorded_at='2026-01-06T09:00:00.000Z'",
  ])("checks stored head %s", async (change) => {
    await both(`update workforce_chains set ${change} where node_id='${retired}'`);
    invalid(await run(), "head");
  });
  it("rejects a missing stored head", async () => {
    await both(`delete from workforce_chains where node_id='${retired}'`);
    invalid(await run(), "head");
  });
  it("compares full time rows even when the altered chain is internally consistent", async () => {
    await corrupt(restored.db, `update time_entries set id='changed' where id='${requestId}'`);
    invalid(await run(), "data");
  });
  it("detects an internally consistent lost closure tail after migration", async () => {
    await corrupt(restored.db, "delete from pay_period_closures where sequence_no=3");
    invalid(await run(), "data");
  });
  it("detects closure old middle loss", async () => {
    await both("delete from pay_period_closures where sequence_no=2");
    invalid(await run(), "history");
  });
  it.each([
    "closure_hash='wrong'",
    "prev_closure_hash='wrong'",
    "period_start='2026-01-02'",
    "clock='{}'",
    "clock='bad'",
    "snapshot='{}'",
    "snapshot='bad'",
    "snapshot='null'",
  ])("checks captured pay closure %s", async (change) => {
    await both(`update pay_period_closures set ${change} where sequence_no=1`);
    invalid(await run(), "history");
  });
  it("checks snapshot entries and sessions without rerunning a projection", async () => {
    for (const db of [original.db, restored.db]) {
      const row = (await db.select().from(payPeriodClosures)).find((r) => r.sequenceNo === 1)!;
      expect(row.snapshot.entries.length).toBeGreaterThan(0);
      row.snapshot.entries[0]!.confirmedByWorker = !row.snapshot.entries[0]!.confirmedByWorker;
      await corrupt(
        db,
        `update pay_period_closures set snapshot='${JSON.stringify(row.snapshot).replaceAll("'", "''")}' where sequence_no=1`,
      );
    }
    invalid(await run(), "history");
  });
  it("preserves mutable payroll configuration", async () => {
    await restored.db.update(payPeriodSettings).set({ frequency: "weekly" });
    invalid(await run(), "data");
  });
  it("accepts a captured closure prefix without inventing external completeness evidence", async () => {
    await both("delete from pay_period_closures where sequence_no=3");
    expect(await run()).toEqual(passed);
  });
  it("never creates heads for honestly empty data", async () => {
    for (const db of [original.db, restored.db])
      await corrupt(
        db,
        "delete from workforce_chains; delete from time_entries; delete from pay_period_closures",
      );
    expect(await run()).toEqual(passed);
    expect(original.db.all(sql`select * from workforce_chains`)).toEqual([]);
    expect(restored.db.all(sql`select * from workforce_chains`)).toEqual([]);
  });
  it("accepts an explicit empty stored head without resetting it", async () => {
    for (const db of [original.db, restored.db]) {
      await corrupt(
        db,
        "delete from workforce_chains; delete from time_entries; delete from pay_period_closures",
      );
      await db
        .insert(workforceChains)
        .values({ nodeId: node, locationId: place, updatedAt: new Date(at) });
    }
    expect(await run()).toEqual(passed);
  });
  it("rejects an orphan nonempty stored head", async () => {
    await both("delete from time_entries; delete from pay_period_closures");
    invalid(await run(), "head");
  });
  it("admits absent source tables only into empty migrated state", async () => {
    for (const db of [original.db, restored.db])
      await corrupt(
        db,
        "delete from workforce_chains; delete from time_entries; delete from pay_period_closures; delete from pay_period_settings",
      );
    expect(await run(absent.db)).toEqual(passed);
    await restored.db.insert(payPeriodSettings).values({ frequency: "monthly" });
    invalid(await run(absent.db), "data");
  });
  it("rejects missing restored tables", async () => {
    invalid(await run(original.db, absent.db), "data");
  });
});
