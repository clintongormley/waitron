import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  kitchenStations,
  kitchenStationTiming,
  stationPrinters,
  printers,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seasons } from "@waitron/venue-service";
import { shifts } from "@waitron/workforce";
import { ALL_MODULES } from "./modules.js";
import { createStation, listStations } from "./kitchen.js";
import { provisionBillVenue, seatedWith } from "./testing/bill-venue.js";

const prefix = mkdtempSync(join(tmpdir(), "waitron-station-order-prefix-"));
afterAll(() => rmSync(prefix, { recursive: true, force: true }));
cpSync(CORE_MIGRATIONS.migrationsFolder, prefix, { recursive: true });
const journalPath = join(prefix, "meta/_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: { tag: string }[];
};
const retirement = journal.entries.findIndex(({ tag }) => tag.endsWith("_retire_station_order"));
writeFileSync(
  journalPath,
  JSON.stringify({
    ...journal,
    entries: retirement < 0 ? journal.entries : journal.entries.slice(0, retirement),
  }),
);
const options = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({
  migrations: options.map((set) =>
    set.migrationsTable === CORE_MIGRATIONS.migrationsTable
      ? { ...set, migrationsFolder: prefix }
      : set,
  ),
  resetPerTest: false,
});

function snapshot(db: Database) {
  return Object.fromEntries(
    db
      .all<{ name: string }>(
        sql`
    select name from sqlite_master where type = 'table'
    and name not glob 'sqlite_*' and name not glob '__drizzle_migrations*' order by name
  `,
      )
      .map(({ name }) => [
        name,
        db
          .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)}`)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
  );
}

it("A725 drops only station order with populated cascading and restrictive children", async () => {
  const db = suite.db;
  const v = await provisionBillVenue(db);
  const [station] = await db.select().from(kitchenStations);
  const stationId = station!.id;
  await db.update(kitchenStations).set({ name: "Zulu" }).where(eq(kitchenStations.id, stationId));
  await withTransaction(db, async (tx) => {
    await createStation(tx, v.cfg, { name: "Bar" });
    await createStation(tx, v.cfg, { name: "Alpha" });
    await tx.insert(kitchenStationTiming).values({ stationId, warmAfterMinutes: 3 });
    const [printer] = await tx.select().from(printers);
    await tx.insert(stationPrinters).values({ stationId, printerId: printer!.id });
    const [season] = await tx
      .insert(seasons)
      .values({
        locationId: v.cfg.locationId,
        name: "Retained season",
        startsOn: "01-01",
      })
      .returning();
    await tx.execute(
      sql`insert into staff_roles (id, location_id, name) values ('retained-role', ${v.cfg.locationId}, 'Retained cook')`,
    );
    await tx.execute(
      sql`insert into staffing_days (id, station_id, season_id, weekday) values ('retained-day', ${stationId}, ${season!.id}, 1)`,
    );
    const [shift] = await tx
      .insert(shifts)
      .values({
        locationId: v.cfg.locationId,
        personId: v.operatorId,
        startsAt: "2026-10-17T10:00:00.000Z",
        endsAt: "2026-10-17T12:00:00.000Z",
        startsOffsetMinutes: 120,
        endsOffsetMinutes: 120,
      })
      .returning();
    await tx.execute(
      sql`insert into shift_assignments (shift_id, station_id, staff_role_id) values (${shift!.id}, ${stationId}, 'retained-role')`,
    );
  });
  await seatedWith(v, "Tarta");
  await db.execute(
    sql`update kitchen_stations set display_order = case name when 'Zulu' then 0 when 'Bar' then 1 else 2 end`,
  );
  const incoming = db.all<{ child: string; column: string; on_delete: string }>(sql`
    select m.name as child, f."from" as column, f.on_delete
    from sqlite_master m join pragma_foreign_key_list(m.name) f
    where m.type = 'table' and f."table" = 'kitchen_stations' order by child, column
  `);
  const triggers = db.all(sql`select name, tbl_name, sql from sqlite_master
    where type = 'trigger' and sql like '%kitchen_stations%' order by name`);
  const before = snapshot(db);
  for (const table of [
    "ticket_items",
    "station_printers",
    "kitchen_station_timing",
    "staffing_days",
    "shift_assignments",
  ])
    expect(before[table]!.length, table).toBeGreaterThan(0);
  await installChangeFeed(
    db,
    ALL_MODULES.flatMap((module) => module.changes ?? []),
  );
  const [file] = db.all<{ file: string }>(sql`pragma database_list`);
  await applyMigrations(dirname(file!.file), options);
  const after = snapshot(db);
  const receipt = process.env.WAITRON_STATION_ORDER_RECEIPT;
  if (receipt)
    writeFileSync(
      receipt,
      JSON.stringify(
        {
          node: process.version,
          sqlite: db.all(sql`select sqlite_version() as version`),
          incoming,
          triggers,
          before,
          after,
        },
        null,
        2,
      ),
    );
  expect(
    db.all<{ name: string }>(sql`pragma table_info(kitchen_stations)`).map(({ name }) => name),
  ).not.toContain("display_order");
  expect(after).toEqual({
    ...before,
    kitchen_stations: before.kitchen_stations!.map((station) =>
      Object.fromEntries(Object.entries(station).filter(([column]) => column !== "display_order")),
    ),
  });
  expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
  expect(db.all(sql`pragma integrity_check`)).toEqual([{ integrity_check: "ok" }]);
  expect((await listStations(db, v.cfg)).map(({ name }) => name)).toEqual(["Alpha", "Bar", "Zulu"]);
});
