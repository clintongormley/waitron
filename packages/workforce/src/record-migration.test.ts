import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  engineErrorMessage,
  installChangeFeed,
  newId,
  removeChangeFeed,
  runMigrations,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedPerson } from "../test/fixtures.js";

import { computeEntryHash } from "./chain-hash.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const previousFolder = mkdtempSync(join(tmpdir(), "a10-workforce-before-"));
mkdirSync(join(previousFolder, "meta"));
const journal = JSON.parse(
  readFileSync(join(WORKFORCE_MIGRATIONS.migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };
journal.entries = journal.entries.slice(0, 4);
writeFileSync(join(previousFolder, "meta/_journal.json"), JSON.stringify(journal));
for (const { tag } of journal.entries) {
  copyFileSync(
    join(WORKFORCE_MIGRATIONS.migrationsFolder, `${tag}.sql`),
    join(previousFolder, `${tag}.sql`),
  );
}
afterAll(() => rmSync(previousFolder, { recursive: true, force: true }));

describe("populated automatic-author upgrade", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [
      CORE_MIGRATIONS,
      IDENTITY_MIGRATIONS,
      {
        ...WORKFORCE_MIGRATIONS,
        migrationsFolder: previousFolder,
        appendOnlyTables: ["time_entries"],
      },
    ],
  });

  it("refuses a populated old record rebuild and rolls back its rows and head", async () => {
    await seedTenant(suite.db);
    const personId = await seedPerson(suite.db);
    const managerId = await seedPerson(suite.db, "Manager");
    const locationId = await seedLocation(suite.db);
    const nodeId = await seedNode(suite.db, brandLocationId(locationId));
    const ids = [newId(), newId(), newId(), newId()];
    let prevEntryHash: string | null = null;
    for (const [index, entryKind] of ["in", "out", "correction", "correction"].entries()) {
      const correction = entryKind === "correction";
      const content = {
        sequenceNo: index + 1,
        personId,
        locationId,
        nodeId,
        entryKind,
        eventAt: index === 0 ? "2026-01-05T09:00:00.000Z" : "2026-01-05T18:00:00.000Z",
        recordedAt: `2026-01-06T09:00:0${index}.000Z`,
        eventOffsetMinutes: 0,
        recordedByPersonId: index === 3 ? managerId : personId,
        capturedBySource: "dashboard" as const,
        capturedByDeviceId: null,
        correctsEntryId: correction ? ids[1]! : null,
        correctionReason: correction ? "Forgot the end" : null,
        correctionStatus: correction ? (index === 2 ? "requested" : "approved") : null,
        correctionActorId: correction ? (index === 2 ? personId : managerId) : null,
        prevEntryHash,
      };
      const entryHash = computeEntryHash(content);
      await suite.db.execute(sql`
      insert into time_entries (
        id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, captured_by_source, recorded_at, corrects_entry_id,
        correction_reason, correction_status, correction_actor_id, entry_hash,
        prev_entry_hash, sequence_no, is_first_entry
      ) values (
        ${ids[index]}, ${personId}, ${locationId}, ${nodeId}, ${entryKind}, ${content.eventAt}, 0,
        ${content.recordedByPersonId}, 'dashboard', ${content.recordedAt}, ${content.correctsEntryId},
        ${content.correctionReason}, ${content.correctionStatus}, ${content.correctionActorId},
        ${entryHash}, ${prevEntryHash}, ${index + 1}, ${index === 0 ? 1 : 0}
      )`);
      prevEntryHash = entryHash;
    }
    await suite.db.execute(sql`
    insert into workforce_chains (
      node_id, location_id, sequence_no, last_entry_id, last_entry_hash, last_recorded_at, updated_at
    ) values (
      ${nodeId}, ${locationId}, 4, ${ids[3]}, ${prevEntryHash},
      '2026-01-06T09:00:03.000Z', '2026-01-06T09:00:03.000Z'
    )`);
    const before = suite.db.execute(sql`select * from time_entries order by sequence_no`).rows;
    const headBefore = suite.db.execute(sql`select * from workforce_chains`).rows;
    await installChangeFeed(suite.db, [{ table: "time_entries", type: "time_entries" }]);
    removeChangeFeed(suite.db);
    const error = await captureError(() => runMigrations(suite.db, WORKFORCE_MIGRATIONS));
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
    expect((error as Error).message).toContain("DROP TABLE `time_entries`");
    expect(suite.db.execute(sql`select * from time_entries order by sequence_no`).rows).toEqual(
      before,
    );
    expect(suite.db.execute(sql`select * from workforce_chains`).rows).toEqual(headBefore);
    expect(
      suite.db.execute(sql`pragma table_info(time_entries)`).rows.map((row) => row.name),
    ).not.toContain("author_kind");
  });
});

describe("empty automatic-author upgrade", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [
      CORE_MIGRATIONS,
      IDENTITY_MIGRATIONS,
      {
        ...WORKFORCE_MIGRATIONS,
        migrationsFolder: previousFolder,
        appendOnlyTables: ["time_entries"],
      },
    ],
  });

  it("stores an explicit automatic author without attributing it to a person on an empty upgrade", async () => {
    removeChangeFeed(suite.db);
    await runMigrations(suite.db, WORKFORCE_MIGRATIONS);
    await seedTenant(suite.db);
    const personId = await seedPerson(suite.db);
    const locationId = await seedLocation(suite.db);
    const nodeId = await seedNode(suite.db, brandLocationId(locationId));
    suite.db.execute(sql`
      insert into time_entries (
        id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, captured_by_source, recorded_at, author_kind,
        entry_hash, sequence_no, is_first_entry
      ) values (
        ${newId()}, ${personId}, ${locationId}, ${nodeId}, 'out', '2026-01-05T18:00:00.000Z', 0,
        null, 'dashboard', '2026-01-06T09:00:00.000Z', 'automatic', ${"A".repeat(64)}, 1, true
      )`);
    expect(
      suite.db.execute(sql`select author_kind, recorded_by_person_id from time_entries`).rows,
    ).toEqual([{ author_kind: "automatic", recorded_by_person_id: null }]);
  });
});
