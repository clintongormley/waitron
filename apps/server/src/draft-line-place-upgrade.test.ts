import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { parties, orderDrafts, runMigrations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { validateAllergens } from "@waitron/catalogue";

const options = migrationOptionsFor(manifestSets(), null);
const core = options.find((set) => set.migrationsFolder.endsWith("/db/drizzle"))!;
const journal = JSON.parse(
  readFileSync(join(core.migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };
const index = journal.entries.findIndex(({ tag }) => tag.endsWith("_draft_line_place"));
if (index < 0) throw new Error("draft placement migration is missing");

let previousFolder: string | undefined;
let targetFolder: string | undefined;
afterAll(() => {
  if (previousFolder) rmSync(previousFolder, { recursive: true, force: true });
});
try {
  previousFolder = mkdtempSync(join(tmpdir(), "waitron-draft-place-upgrade-"));
  cpSync(core.migrationsFolder, previousFolder, { recursive: true });
  targetFolder = join(previousFolder, "with-placement");
  cpSync(core.migrationsFolder, targetFolder, { recursive: true });
  writeFileSync(
    join(targetFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, index + 1) }),
  );
  writeFileSync(
    join(previousFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }),
  );
} catch (error) {
  if (previousFolder) rmSync(previousFolder, { recursive: true, force: true });
  throw error;
}

const suite = useVenueDb({
  migrations: options.map((set) =>
    set === core ? { ...set, migrationsFolder: previousFolder! } : set,
  ),
});

it("adds draft placement without deleting a guest's allergy ticks or changing existing lines", async () => {
  const db = suite.db;
  const operatorId = randomUUID();
  const lineId = randomUUID();
  const guestId = randomUUID();
  const tickId = randomUUID();
  const allergens = validateAllergens({ milk: {} });
  await withTransaction(db, async (tx) => {
    const [party] = await tx.insert(parties).values({ openedBy: operatorId }).returning();
    const [draft] = await tx
      .insert(orderDrafts)
      .values({ partyId: party!.id, ownerId: operatorId })
      .returning();
    // Today's column declaration includes placement, which the predecessor database does not have.
    await tx.run(sql`insert into order_draft_lines
      (id, draft_id, position, menu_item_id, options, extras, quantity, no_merge)
      values (${lineId}, ${draft!.id}, 1, ${randomUUID()}, '[]', '[]', 2000, 1)`);
    await tx.run(sql`insert into party_allergy (party_id, answer, changed_by, changed_at)
      values (${party!.id}, 'allergies', ${operatorId}, '2026-10-16T12:00:00.000Z')`);
    await tx.run(sql`insert into party_allergy_guests (id, party_id, position, who, allergens, note)
      values (${guestId}, ${party!.id}, 0, 'Guest in red', ${JSON.stringify(allergens)}, 'Severe')`);
    await tx.run(sql`insert into allergy_line_ticks (id, guest_id, draft_line_id)
      values (${tickId}, ${guestId}, ${lineId})`);
  });

  const beforeLines = db.all(sql`select * from order_draft_lines order by id`);
  const beforeTicks = db.all(sql`select * from allergy_line_ticks order by id`);
  const beforeGuests = db.all(sql`select * from party_allergy_guests order by id`);
  expect(beforeTicks).toEqual([
    { id: tickId, guest_id: guestId, draft_line_id: lineId, working_line_id: null },
  ]);

  await runMigrations(db, { ...core, migrationsFolder: targetFolder! });

  expect(db.all(sql`select * from allergy_line_ticks order by id`)).toEqual(beforeTicks);
  expect(db.all(sql`select * from party_allergy_guests order by id`)).toEqual(beforeGuests);
  expect(
    db
      .all<Record<string, unknown>>(sql`select * from order_draft_lines order by id`)
      .map(({ slot, join_group_id, after_group_id, ...row }) => {
        expect([slot, join_group_id, after_group_id]).toEqual([0, null, null]);
        return row;
      }),
  ).toEqual(beforeLines);
  expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
});
