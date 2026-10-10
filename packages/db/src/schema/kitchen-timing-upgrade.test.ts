import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { installAppendOnlyTriggers } from "@waitron/store";
import { assertSafeIdentifier } from "../testing/identifiers.js";
import { CORE_CHANGE_SOURCES } from "../classification.js";
import { installChangeFeed } from "../change-feed.js";
import { runMigrations } from "../migrate.js";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { freshNif } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceMadeHereStations } from "./device-made-here-stations.js";
import { kitchenStations } from "./kitchen-stations.js";
import { stationPrinters } from "./station-printers.js";
import { locations } from "./tenants.js";

async function migrateThroughTiming(db: Database, includeTiming: boolean): Promise<void> {
  const staged = mkdtempSync(join(tmpdir(), "wt-timing-upgrade-"));
  try {
    cpSync(CORE_MIGRATIONS.migrationsFolder, staged, { recursive: true });
    const path = join(staged, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string }[] };
    const timingIndex = journal.entries.findIndex(({ tag }) =>
      tag.endsWith("_kitchen_timing_inheritance"),
    );
    expect(timingIndex).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, timingIndex + 1);
    expect(journal.entries.at(-1)?.tag).toMatch(/_kitchen_timing_inheritance$/);
    if (!includeTiming) journal.entries.pop();
    writeFileSync(path, JSON.stringify(journal));
    await runMigrations(db, { ...CORE_MIGRATIONS, migrationsFolder: staged });
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

const suite = useVenueDb({
  migrations: [],
  setup: (db) => migrateThroughTiming(db, false),
});

it("adds timing storage without rewriting populated stations, mappings, keys or triggers", async () => {
  const db = suite.db;
  await db.run(sql`insert into tenants (id, country, tax_id, legal_name, created_at)
    values (1, 'ES', ${freshNif()}, 'Test SL', ${new Date().toISOString()})`);
  const [location] = await db
    .insert(locations)
    .values({
      name: "Populated kitchen",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    })
    .returning();
  const locationId = location!.id;
  const [station] = await db
    .insert(kitchenStations)
    .values({
      locationId,
      name: "Grill",
      warmAfterMinutes: 2,
      overdueAfterMinutes: 4,
      forgottenAfterMinutes: 8,
    })
    .returning();
  const stationId = station!.id;
  // By hand, like `device_profiles` and `devices` below: the table definition names `printers`
  // columns later migrations add.
  const printerId = randomUUID();
  await db.run(sql`insert into printers (id, location_id, name, transport, local_key)
    values (${printerId}, ${locationId}, 'Grill printer', 'usb', 'grill-fixture')`);
  await db.insert(stationPrinters).values({ stationId, printerId });
  // By hand: no schema object names `watchers` or `watcher_stations` any more, and the table
  // definitions name `device_profiles` and `devices` columns later migrations add.
  const now = new Date().toISOString();
  const watcherId = randomUUID();
  await db.run(sql`insert into watchers (id, location_id, name, created_at)
    values (${watcherId}, ${locationId}, 'Pass', ${now})`);
  await db.run(sql`insert into watcher_stations (watcher_id, station_id)
    values (${watcherId}, ${stationId})`);
  const profileId = randomUUID();
  await db.run(sql`insert into device_profiles (id, name, form_factor, capabilities, created_at, updated_at)
    values (${profileId}, 'Till', 'till', '[]', ${now}, ${now})`);
  const deviceId = randomUUID();
  await db.run(sql`insert into devices
    (id, location_id, device_profile_id, label, token_hash, enrolled_at, created_at)
    values (${deviceId}, ${locationId}, ${profileId}, 'Device', 'seeded', ${now}, ${now})`);
  await db.insert(deviceMadeHereStations).values({ deviceId, stationId });

  const tables = db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' and name not glob '__drizzle_migrations*' order by name`,
    )
    .map(({ name }) => name);
  await installChangeFeed(
    db,
    CORE_CHANGE_SOURCES.filter((source) => tables.includes(source.table)),
  );
  installAppendOnlyTriggers(db, CORE_MIGRATIONS.appendOnlyTables);
  const beforeRows = Object.fromEntries(
    tables.map((name) => [
      name,
      db.all(sql.raw(`select * from "${assertSafeIdentifier("table", name)}" order by rowid`)),
    ]),
  );
  const beforeSchema = db.all<{ name: string; tbl_name: string; sql: string }>(
    sql`select name, tbl_name, sql from sqlite_master where type in ('trigger', 'index', 'table') and name not glob 'sqlite_*' and name not glob '__drizzle_migrations*' order by name`,
  );
  const beforeKeys = Object.fromEntries(
    tables.map((name) => [
      name,
      db.all(sql.raw(`pragma foreign_key_list("${assertSafeIdentifier("table", name)}")`)),
    ]),
  );

  await migrateThroughTiming(db, true);

  expect(
    Object.fromEntries(
      tables.map((name) => [
        name,
        db.all(sql.raw(`select * from "${assertSafeIdentifier("table", name)}" order by rowid`)),
      ]),
    ),
  ).toEqual(beforeRows);
  const afterSchema = db.all<{ name: string; tbl_name: string; sql: string }>(
    sql`select name, tbl_name, sql from sqlite_master where type in ('trigger', 'index', 'table') and name not glob 'sqlite_*' and name not glob '__drizzle_migrations*' order by name`,
  );
  expect(afterSchema.filter(({ tbl_name }) => tables.includes(tbl_name))).toEqual(beforeSchema);
  expect(
    Object.fromEntries(
      tables.map((name) => [
        name,
        db.all(sql.raw(`pragma foreign_key_list("${assertSafeIdentifier("table", name)}")`)),
      ]),
    ),
  ).toEqual(beforeKeys);
  expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
  expect(
    db.all<{ name: string }>(
      sql`select name from sqlite_master where name in ('kitchen_station_timing', 'kitchen_timing_defaults') order by name`,
    ),
  ).toEqual([{ name: "kitchen_station_timing" }, { name: "kitchen_timing_defaults" }]);
});
