import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  engineErrorMessage,
  newId,
  removeChangeFeed,
  runMigrations,
  type Database,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { appendToChain, readChain } from "./chain.js";
import { computeEntryHash, verifyChain } from "./chain-hash.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const previousFolder = mkdtempSync(join(tmpdir(), "a1268-workforce-before-"));
mkdirSync(join(previousFolder, "meta"));
const journal = JSON.parse(
  readFileSync(join(WORKFORCE_MIGRATIONS.migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };
journal.entries = journal.entries.slice(0, 12);
writeFileSync(join(previousFolder, "meta/_journal.json"), JSON.stringify(journal));
for (const { tag } of journal.entries) {
  copyFileSync(
    join(WORKFORCE_MIGRATIONS.migrationsFolder, `${tag}.sql`),
    join(previousFolder, `${tag}.sql`),
  );
}
afterAll(() => rmSync(previousFolder, { recursive: true, force: true }));

const migrations = [
  CORE_MIGRATIONS,
  IDENTITY_MIGRATIONS,
  {
    ...WORKFORCE_MIGRATIONS,
    migrationsFolder: previousFolder,
    appendOnlyTables: ["time_entries"],
  },
];

/** Writes one chain's entries and its head by raw insert, hashed as the writer hashes them. */
async function seedChain(
  db: Database,
  chain: { personId: string; locationId: string; nodeId: string },
  kinds: readonly ("in" | "out")[],
) {
  let prevEntryHash: string | null = null;
  let lastId = "";
  let recordedAt = "";
  for (const [index, entryKind] of kinds.entries()) {
    const id = newId();
    recordedAt = `2026-01-05T17:00:0${index}.000Z`;
    const content = {
      ...chain,
      sequenceNo: index + 1,
      entryKind,
      eventAt: index === 0 ? "2026-01-05T09:00:00.000Z" : "2026-01-05T17:00:00.000Z",
      recordedAt,
      eventOffsetMinutes: 0,
      recordedByPersonId: chain.personId,
      capturedBySource: "dashboard" as const,
      capturedByDeviceId: null,
      correctsEntryId: null,
      correctionReason: null,
      correctionStatus: null,
      correctionActorId: null,
      prevEntryHash,
    };
    const entryHash = computeEntryHash(content);
    await db.execute(sql`
    insert into time_entries (
      id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id, captured_by_source, recorded_at, entry_hash, prev_entry_hash,
      sequence_no, is_first_entry
    ) values (
      ${id}, ${chain.personId}, ${chain.locationId}, ${chain.nodeId}, ${entryKind},
      ${content.eventAt}, 0, ${chain.personId}, 'dashboard', ${recordedAt}, ${entryHash},
      ${prevEntryHash}, ${index + 1}, ${index === 0 ? 1 : 0}
    )`);
    prevEntryHash = entryHash;
    lastId = id;
  }
  await db.execute(sql`
  insert into workforce_chains (
    node_id, location_id, sequence_no, last_entry_id, last_entry_hash, last_recorded_at, updated_at
  ) values (
    ${chain.nodeId}, ${chain.locationId}, ${kinds.length}, ${lastId}, ${prevEntryHash},
    ${recordedAt}, ${recordedAt}
  )`);
}

function rows(db: Database, table: "time_entries" | "workforce_chains") {
  return db.execute(sql.raw(`select * from ${table} order by rowid`)).rows;
}
function headColumns(db: Database) {
  return db.execute(sql`pragma table_info(workforce_chains)`).rows.map((row) => row.name);
}
/** What the migration must leave standing, or put back, whatever it does to the head table. */
function schemaFacts(db: Database) {
  return {
    rebuildTables: db
      .execute<{ name: string }>(sql`select name from sqlite_master where name like '__new_%'`)
      .rows.map((row) => row.name),
    timeEntryTriggers: db
      .execute<{ name: string }>(
        sql`select name from sqlite_master where type = 'trigger' and tbl_name = 'time_entries' order by name`,
      )
      .rows.map((row) => row.name),
    positionIndex: db
      .execute<{ name: string }>(sql`pragma index_info('time_entries_chain_position_uq')`)
      .rows.map((row) => row.name),
  };
}

describe("migrating a node whose entries are all at one location", () => {
  const suite = useVenueDb({ resetPerTest: false, migrations });

  it("migrates a node whose entries are all at one location in place", async () => {
    await seedTenant(suite.db);
    const personId = await seedPerson(suite.db);
    const place = await seedLocation(suite.db);
    const node = await seedNode(suite.db, brandLocationId(place));
    await seedChain(suite.db, { personId, locationId: place, nodeId: node }, ["in", "out"]);
    const entriesBefore = rows(suite.db, "time_entries");
    const [{ location_id: _, ...headBefore }] = rows(suite.db, "workforce_chains") as [
      Record<string, unknown>,
    ];
    const triggersBefore = schemaFacts(suite.db).timeEntryTriggers;
    expect(triggersBefore).not.toEqual([]);

    removeChangeFeed(suite.db);
    await runMigrations(suite.db, WORKFORCE_MIGRATIONS);

    expect(rows(suite.db, "time_entries")).toEqual(entriesBefore);
    expect(headColumns(suite.db)).not.toContain("location_id");
    expect(rows(suite.db, "workforce_chains")).toEqual([headBefore]);
    expect(schemaFacts(suite.db)).toEqual({
      rebuildTables: [],
      timeEntryTriggers: triggersBefore,
      positionIndex: ["node_id", "sequence_no"],
    });
    const appended = await suite.db.transaction((tx) =>
      appendToChain(
        tx,
        { nodeId: node },
        {
          personId,
          locationId: place,
          entryKind: "in",
          eventAt: "2026-01-06T09:00:00Z",
          eventOffsetMinutes: 0,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
        },
      ),
    );
    expect(appended.sequenceNo).toBe(3);
    expect(verifyChain(await readChain(suite.db, { nodeId: node }))).toEqual({ ok: true });
  });
});

describe("migrating a node with chains at two locations", () => {
  const suite = useVenueDb({ resetPerTest: false, migrations });

  it("refuses a node with chains at two locations and changes nothing", async () => {
    await seedTenant(suite.db);
    const personId = await seedPerson(suite.db);
    const place = await seedLocation(suite.db);
    const otherPlace = await seedLocation(suite.db);
    const node = await seedNode(suite.db, brandLocationId(place));
    await seedChain(suite.db, { personId, locationId: place, nodeId: node }, ["in"]);
    await seedChain(suite.db, { personId, locationId: otherPlace, nodeId: node }, ["in"]);
    const entriesBefore = rows(suite.db, "time_entries");
    const headsBefore = rows(suite.db, "workforce_chains");
    const factsBefore = schemaFacts(suite.db);
    expect(factsBefore.positionIndex).toEqual(["node_id", "location_id", "sequence_no"]);

    removeChangeFeed(suite.db);
    const error = await captureError(() => runMigrations(suite.db, WORKFORCE_MIGRATIONS));

    expect(engineErrorMessage(error)).toContain(
      "UNIQUE constraint failed: __new_workforce_chains.node_id",
    );
    expect(rows(suite.db, "time_entries")).toEqual(entriesBefore);
    expect(rows(suite.db, "workforce_chains")).toEqual(headsBefore);
    expect(headColumns(suite.db)).toContain("location_id");
    expect(schemaFacts(suite.db)).toEqual(factsBefore);
  });
});
