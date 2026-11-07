import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, newId } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });

it("stores an explicit automatic author without attributing it to a person", async () => {
  await seedTenant(suite.db);
  const personId = await seedPerson(suite.db);
  const locationId = await seedLocation(suite.db);
  const nodeId = await seedNode(suite.db, locationId);
  suite.db.execute(sql`
  insert into time_entries (
    id, person_id, node_id, entry_kind, event_at, event_offset_minutes,
    recorded_by_person_id, captured_by_source, recorded_at, author_kind,
    entry_hash, sequence_no, is_first_entry
  ) values (
    ${newId()}, ${personId}, ${nodeId}, 'out', '2026-01-05T18:00:00.000Z', 0,
    null, 'dashboard', '2026-01-06T09:00:00.000Z', 'automatic', ${"A".repeat(64)}, 1, true
  )`);
  expect(
    suite.db.execute(sql`select author_kind, recorded_by_person_id from time_entries`).rows,
  ).toEqual([{ author_kind: "automatic", recorded_by_person_id: null }]);
});
