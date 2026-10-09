import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { captureError, openVenueDatabase, triggerRaised, type Database } from "@waitron/db";
import { applyMigrations } from "./apply.js";
import { manifestSets, migrationOptionsFor, type VenueMigrationOptions } from "./manifest.js";

const PARTY = "cccccccc-0000-4000-8000-000000000001";
const EVENT = "cccccccc-0000-4000-8000-000000000002";
const PERSON = "cccccccc-0000-4000-8000-000000000003";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** Core's set, its journal cut after the migration that adds the firer columns, as a box had it. */
function coreBeforeRebuild(core: VenueMigrationOptions): VenueMigrationOptions {
  const staged = scratchDir("wt-order-group-events-core-");
  cpSync(core.migrationsFolder, staged, { recursive: true });
  const path = join(staged, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string }[] };
  const columns = journal.entries.findIndex(({ tag }) =>
    tag.endsWith("_order_group_firer_columns"),
  );
  expect(columns).toBeGreaterThanOrEqual(0);
  expect(journal.entries[columns + 1]?.tag).toMatch(/_order_group_firer_checks$/);
  journal.entries = journal.entries.slice(0, columns + 1);
  writeFileSync(path, JSON.stringify(journal));
  return { ...core, migrationsFolder: staged };
}

async function inVenue<T>(directory: string, body: (db: Database) => Promise<T> | T): Promise<T> {
  const store = await openVenueDatabase(directory);
  try {
    return await body(store.venue);
  } finally {
    await store.close();
  }
}

it("keeps an event written before the rebuild, and a start's migrate still refuses its update and delete", async () => {
  const sets = migrationOptionsFor(manifestSets(), null);
  const core = sets.find((set) => set.migrationsTable === "__drizzle_migrations_db")!;
  const directory = scratchDir("wt-order-group-events-venue-");
  await applyMigrations(directory, [coreBeforeRebuild(core)]);
  const now = new Date().toISOString();
  await inVenue(directory, (db) => {
    db.run(sql`insert into parties (id, state, opened_at, opened_by)
      values (${PARTY}, 'open', ${now}, ${PERSON})`);
    // No group: `group_id` keys into `order_groups`, whose own rebuild a party's groups refuse.
    db.run(sql`insert into order_group_events
      (id, party_id, group_id, kind, actor_id, detail, created_at)
      values (${EVENT}, ${PARTY}, null, 'reordered', ${PERSON}, '{}', ${now})`);
  });

  await applyMigrations(directory, sets);

  await inVenue(directory, async (db) => {
    const read = () =>
      db.all(sql`select id, actor_id, actor_device_id from order_group_events where id = ${EVENT}`);
    expect(read()).toEqual([{ id: EVENT, actor_id: PERSON, actor_device_id: null }]);
    const update = await captureError(async () => {
      await db.run(sql`update order_group_events set kind = 'fired' where id = ${EVENT}`);
    });
    expect(triggerRaised(update, "order_group_events is append-only")).toBe(true);
    const remove = await captureError(async () => {
      await db.run(sql`delete from order_group_events where id = ${EVENT}`);
    });
    expect(triggerRaised(remove, "order_group_events is append-only")).toBe(true);
    expect(read()).toEqual([{ id: EVENT, actor_id: PERSON, actor_device_id: null }]);
  });
});
