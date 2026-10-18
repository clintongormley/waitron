import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  kitchenStationTiming,
  kitchenTimingDefaults,
  locations,
  stationPrinters,
  withTransaction,
  type Database,
} from "@waitron/db";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import {
  applyMigrations,
  manifestSets,
  migrationOptionsFor,
  type VenueMigrationOptions,
} from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { locationId as brandLocationId } from "@waitron/shared";
import { shifts } from "@waitron/workforce";
import { ALL_MODULES } from "./modules.js";
import { createStation, listStations } from "./kitchen.js";
import { predecessorAppendOnly } from "./testing/predecessor-append-only.js";
import type { TillConfig } from "./till-config.js";

type Journal = { entries: { tag: string; when: number }[] };
const readJournal = (folder: string) =>
  JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as Journal;
const scratch = mkdtempSync(join(tmpdir(), "waitron-station-order-prefix-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const retirement = readJournal(CORE_MIGRATIONS.migrationsFolder).entries.find(({ tag }) =>
  tag.endsWith("_retire_station_order"),
);
if (retirement === undefined) throw new Error("the station-order retirement is missing");

// Every set cut at the same moment, so no set references a table a later core migration made.
function setsAsOf(name: string, keep: (when: number) => boolean): VenueMigrationOptions[] {
  return migrationOptionsFor(manifestSets(), null).map((set, index) => {
    const journal = readJournal(set.migrationsFolder);
    const kept = journal.entries.filter(({ when }) => keep(when));
    if (kept.length === journal.entries.length) return set;
    const folder = join(scratch, name, String(index));
    cpSync(set.migrationsFolder, folder, { recursive: true });
    writeFileSync(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: kept }),
    );
    const tags = journal.entries.map(({ tag }) => tag);
    return {
      ...set,
      migrationsFolder: folder,
      appendOnlyTables: predecessorAppendOnly(
        set.appendOnlyTables,
        folder,
        tags.slice(0, kept.length),
        tags.slice(kept.length),
      ),
    };
  });
}
const options = setsAsOf("retired", (when) => when <= retirement.when);
const suite = useVenueDb({
  migrations: setsAsOf("predecessor", (when) => when < retirement.when),
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

// Written in the predecessor's own columns: today's seating and period code names columns this
// schema does not have yet.
async function populate(db: Database) {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: ["es-ES"], operationDescription: "Restaurante" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  const nodeId = await seedNode(db, locationId);
  await db.insert(kitchenTimingDefaults).values({ locationId });
  const cfg: TillConfig = {
    nodeId,
    locationId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const stationId = await seedKitchenStation(db, { locationId, name: "Zulu" });
  await withTransaction(db, async (tx) => {
    await createStation(tx, cfg, { name: "Bar" });
    await createStation(tx, cfg, { name: "Alpha" });
    await tx.insert(kitchenStationTiming).values({ stationId, warmAfterMinutes: 3 });
    const printer = await createPrinter(
      tx,
      { locationId },
      { name: "Cocina", transport: "network_tcp", host: "10.0.0.9" },
    );
    await tx.insert(stationPrinters).values({ stationId, printerId: printer.id });
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", role: "staff" })
      .returning({ id: persons.id });
    await tx.execute(
      sql`insert into seasons (id, location_id, name, starts_on) values ('retained-season', ${locationId}, 'Retained season', '01-01')`,
    );
    await tx.execute(
      sql`insert into staff_roles (id, location_id, name) values ('retained-role', ${locationId}, 'Retained cook')`,
    );
    await tx.execute(
      sql`insert into staffing_days (id, station_id, season_id, weekday) values ('retained-day', ${stationId}, 'retained-season', 1)`,
    );
    const [shift] = await tx
      .insert(shifts)
      .values({
        locationId,
        personId: person!.id,
        startsAt: "2026-10-17T10:00:00.000Z",
        endsAt: "2026-10-17T12:00:00.000Z",
        startsOffsetMinutes: 120,
        endsOffsetMinutes: 120,
      })
      .returning();
    await tx.execute(
      sql`insert into shift_assignments (shift_id, station_id, staff_role_id) values (${shift!.id}, ${stationId}, 'retained-role')`,
    );
    await tx.execute(
      sql`insert into working_orders (id, source, location_id, node_id, order_number, opened_at) values ('retained-order', 'dashboard', ${locationId}, ${nodeId}, 1, '2026-10-17T10:00:00.000Z')`,
    );
    await tx.execute(
      sql`insert into working_order_lines (id, working_order_id, line_no, name, descriptions, quantity, unit_price_gross, vat_class, line_total, make_at_station_id) values ('retained-line', 'retained-order', 1, 'Tarta', '{"es-ES":"Tarta de queso"}', 1000, 1800, 'general', 1800, ${stationId})`,
    );
    await tx.execute(
      sql`insert into ticket_items (id, node_id, working_order_id, working_order_line_id, station_id, queued_at) values ('retained-ticket', ${nodeId}, 'retained-order', 'retained-line', ${stationId}, '2026-10-17T10:00:00.000Z')`,
    );
    await tx.execute(
      sql`insert into print_jobs (id, location_id, printer_id, payload, created_at) values ('retained-print', ${locationId}, ${printer.id}, x'1b40', '2026-10-17T10:00:00.000Z')`,
    );
    await tx.execute(
      sql`insert into kitchen_print_jobs (id, print_job_id, working_order_id, station_id, reprint, created_at) values ('retained-kitchen-print', 'retained-print', 'retained-order', ${stationId}, 0, '2026-10-17T10:00:00.000Z')`,
    );
    await tx.execute(
      sql`insert into kitchen_print_job_lines (id, print_job_id, working_order_line_id) values ('retained-print-line', 'retained-print', 'retained-line')`,
    );
  });
  return cfg;
}

it("A725 drops only station order with populated cascading and restrictive children", async () => {
  const db = suite.db;
  const cfg = await populate(db);
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
  const tables = new Set(Object.keys(before));
  await installChangeFeed(
    db,
    ALL_MODULES.flatMap((module) => module.changes ?? []).filter(({ table }) => tables.has(table)),
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
  expect((await listStations(db, cfg)).map(({ name }) => name)).toEqual(["Alpha", "Bar", "Zulu"]);
});
