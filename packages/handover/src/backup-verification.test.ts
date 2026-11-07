import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, nodes, type Database, handoverActivations } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { validateBackupVerificationContribution } from "@waitron/module";
import { openBackupQuery } from "@waitron/store";
import * as api from "./index.js";
import { HANDOVER_TABLES } from "./tables.js";

const original = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const restored = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const absent = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  // A source from before these tables existed: core's set now creates them, so they are dropped.
  setup: async (db) => {
    for (const table of [...HANDOVER_TABLES].reverse()) db.run(sql.raw(`drop table "${table}"`));
  },
});
const passed = { status: "passed", checks: [{ code: "data", status: "passed" }] };
const invalid = { status: "invalid", checks: [{ code: "data", status: "invalid" }] };
const NODE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NODE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// The table refuses every update and delete, so a differing restored copy is one given a different
// row from the start, and an emptied one is one that never received any.
async function activate(db: Database, activatedAt = "2026-10-20T08:00:00.000Z"): Promise<void> {
  await seedVenue(db);
  const [venue] = await db.select({ id: locations.id }).from(locations);
  await db.insert(nodes).values([
    { id: NODE_A, locationId: venue!.id, name: "Source" },
    { id: NODE_B, locationId: venue!.id, name: "Destination" },
  ]);
  await db.insert(handoverActivations).values({
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    scenario: "controlled",
    sourceNodeId: NODE_A,
    destinationNodeId: NODE_B,
    evidence: {
      purpose: "waitron.handover.relinquishment.v1",
      body: { operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      signerNodeId: NODE_A,
      signature: "signature",
    },
    personId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    activatedAt,
  });
}

beforeEach(async () => {
  await activate(original.db);
});

async function run(
  options: { absentBefore?: boolean; emptyAfter?: boolean; sourceSchema?: number | null } = {},
) {
  const path = (db: Database) =>
    db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
  const before = await openBackupQuery(path(options.absentBefore ? absent.db : original.db));
  try {
    const after = await openBackupQuery(path(options.emptyAfter ? absent.db : restored.db));
    try {
      return await api.HANDOVER_BACKUP_VERIFICATION.verifyRestoredData({
        before: before.query,
        after: after.query,
        entries: {
          async read() {
            throw new Error("No private entries declared");
          },
        },
        source: {
          nodeId: "source",
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

it("declares exactly its real table, as one that never changes, and no private inputs or restore effects", () => {
  const owner = validateBackupVerificationContribution(api.HANDOVER_BACKUP_VERIFICATION);
  expect(owner.data).toEqual({
    kind: "custom",
    tables: ["handover_activations"],
    immutableTables: ["handover_activations"],
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

it("passes a restored copy holding the same activation", async () => {
  await activate(restored.db);
  expect(await run()).toEqual(passed);
});

it("detects a restored activation with a different value", async () => {
  await activate(restored.db, "2026-10-20T09:00:00.000Z");
  expect(await run()).toEqual(invalid);
});

it("detects a captured activation missing from the restored copy", async () => {
  expect(await run()).toEqual(invalid);
});

it("refuses a missing restored table", async () => {
  expect(await run({ emptyAfter: true })).toEqual(invalid);
});

it.each([0, null])(
  "refuses declared absence over captured activations (schema %s)",
  async (sourceSchema) => {
    await activate(restored.db);
    expect(await run({ sourceSchema })).toEqual(invalid);
  },
);

it.each([0, null])("admits an absent source and a newly empty target (schema %s)", async (s) => {
  expect(await run({ absentBefore: true, sourceSchema: s })).toEqual(passed);
});

it.each([0, null])("refuses restored rows when the source was absent (schema %s)", async (s) => {
  await activate(restored.db);
  expect(await run({ absentBefore: true, sourceSchema: s })).toEqual(invalid);
});

it("refuses an applied source schema whose table is absent", async () => {
  expect(await run({ absentBefore: true })).toEqual(invalid);
});
