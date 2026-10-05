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
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedDevice, seedTenant } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceMadeHereStations } from "./device-made-here-stations.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { stationPrinters } from "./station-printers.js";
import { locations } from "./tenants.js";
import { watchers, watcherStations } from "./watchers.js";

const suite = useVenueDb({
  migrations: [],
  setup: async (db) => {
    const staged = mkdtempSync(join(tmpdir(), "wt-timing-upgrade-"));
    try {
      cpSync(CORE_MIGRATIONS.migrationsFolder, staged, { recursive: true });
      const path = join(staged, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string }[] };
      expect(journal.entries.at(-1)?.tag).toMatch(/_kitchen_timing_inheritance$/);
      journal.entries.pop();
      writeFileSync(path, JSON.stringify(journal));
      await runMigrations(db, { ...CORE_MIGRATIONS, migrationsFolder: staged });
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
  },
});

it("adds timing storage without rewriting populated stations, mappings, keys or triggers", async () => {
  const db = suite.db;
  await seedTenant(db);
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
  const [printer] = await db
    .insert(printers)
    .values({ locationId, name: "Grill printer", transport: "usb", localKey: "grill-fixture" })
    .returning();
  await db.insert(stationPrinters).values({ stationId, printerId: printer!.id });
  const [watcher] = await db.insert(watchers).values({ locationId, name: "Pass" }).returning();
  await db.insert(watcherStations).values({ watcherId: watcher!.id, stationId });
  const { deviceId } = await seedDevice(db, { locationId });
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

  await runMigrations(db, CORE_MIGRATIONS);

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
