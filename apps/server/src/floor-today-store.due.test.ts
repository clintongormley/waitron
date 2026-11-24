import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  floorPlans,
  floorPlanTables,
  installChangeFeed,
  CORE_CHANGE_SOURCES,
  subscribeToChanges,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupPartyVenue, inTx } from "./testing/party-venue.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ensureToday, todayReconciliationDue } from "./floor-today-store.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const now = new Date("2026-10-10T12:00:00.000Z");
it("detects a due saved layout without changing rows, revisions or notifications", async () => {
  const v = await setupPartyVenue(suite.db);
  const zoneId = v.tables.zoneId;
  const due = () => v.db.withWriteLock(() => todayReconciliationDue(v.db, now));
  await inTx(v, (tx) => tx.insert(floorPlanTables).values({ zoneId, label: "Due table" }));
  expect(await due()).toBe(false);
  await inTx(v, async (tx) => {
    const ref = await defaultLayout(tx, zoneId);
    await tx.insert(floorPlans).values({ zoneId, setId: ref.setId, savedAt: now.toISOString() });
  });
  await installChangeFeed(v.db, CORE_CHANGE_SOURCES);
  const snapshot = () => ({
    zones: v.db.all(sql`select * from floor_zones order by id`),
    tables: v.db.all(sql`select * from dining_tables order by id`),
    rows: v.db.all(sql`select * from floor_reset_tables order by id`),
    changes: v.db.all(sql`select * from change_log order by id`),
  });
  const seen: unknown[] = [];
  const stop = subscribeToChanges((change) => seen.push(change));
  try {
    const before = snapshot();
    expect(await due()).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(seen).toEqual([]);
    await inTx(v, (tx) => ensureToday(tx, [], now));
    expect(seen.length).toBeGreaterThan(0);
    expect(await due()).toBe(false);
    const applied = snapshot();
    const count = seen.length;
    await inTx(v, (tx) => ensureToday(tx, [], now));
    expect(snapshot()).toEqual(applied);
    expect(seen).toHaveLength(count);
  } finally {
    stop();
  }
});
