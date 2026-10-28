import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { installAppendOnlyTriggers } from "@waitron/store";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { runMigrations } from "../migrate.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { TRIGGER_ABORT } from "../sql-state.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDevice, seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";

async function migrateBeforeRename(db: Database): Promise<void> {
  const staged = mkdtempSync(join(tmpdir(), "wt-guest-count-upgrade-"));
  try {
    cpSync(CORE_MIGRATIONS.migrationsFolder, staged, { recursive: true });
    const path = join(staged, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string }[] };
    const renameIndex = journal.entries.findIndex(({ tag }) =>
      tag.endsWith("_sale_receipt_guest_count"),
    );
    expect(renameIndex).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, renameIndex);
    writeFileSync(path, JSON.stringify(journal));
    await runMigrations(db, { ...CORE_MIGRATIONS, migrationsFolder: staged });
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

async function seedSales(db: Database, count: number): Promise<string[]> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture" });
  await db.insert(locations).values({
    id: LOCATION,
    name: "Fixture",
    invoiceLocales: ["es"],
    operationDescription: "Hostelería",
  });
  const nodeId = await seedNode(db, brandLocationId(LOCATION));
  const { deviceId } = await seedDevice(db, { locationId: LOCATION });
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const id = randomUUID();
    // Drizzle inserts include current columns that this predecessor does not have.
    await db.run(sql`insert into sales
      (id, source, device_id, node_id, series_id, invoice_number, issued_at,
       issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
       fiscal_backend, fiscal_state)
      values (${id}, 'device', ${deviceId}, ${nodeId}, ${series!.id}, ${n},
       '2026-10-02T09:00:00Z', 0, 100, '[]', 'es', '["es"]', 'verifactu', 'recorded')`);
    ids.push(id);
  }
  return ids;
}

const suite = useVenueDb({ migrations: [], setup: migrateBeforeRename, resetPerTest: false });

function appendOnlyTriggersOn(db: Database, table: string): string[] {
  return db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'trigger' and tbl_name = ${table} order by name`,
    )
    .map(({ name }) => name);
}

it("renames guests to guest_count on a database carrying the append-only triggers, keeping stored counts, the check and the refusal once they are reinstalled", async () => {
  const db = suite.db;
  const [first, second] = await seedSales(db, 2);
  const now = new Date().toISOString();
  await db.run(sql`insert into sale_receipt_guests (sale_id, guests, created_at)
    values (${first!}, 4, ${now}), (${second!}, null, ${now})`);
  const tables = db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
    .map(({ name }) => name);
  installAppendOnlyTriggers(
    db,
    CORE_MIGRATIONS.appendOnlyTables.filter((table) => tables.includes(table)),
  );
  expect(appendOnlyTriggersOn(db, "sale_receipt_guests")).toEqual([
    "sale_receipt_guests_append_only_delete",
    "sale_receipt_guests_append_only_update",
  ]);

  expect(
    db.all(
      sql`select m.name from sqlite_master m, pragma_foreign_key_list(m.name) f where m.type = 'table' and f."table" = 'sale_receipt_guests'`,
    ),
  ).toEqual([]);

  await runMigrations(db, CORE_MIGRATIONS);
  installAppendOnlyTriggers(db, CORE_MIGRATIONS.appendOnlyTables);

  expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);

  expect(db.all(sql`select sale_id, guest_count from sale_receipt_guests order by rowid`)).toEqual([
    { sale_id: first, guest_count: 4 },
    { sale_id: second, guest_count: null },
  ]);
  const columns = db
    .all<{ name: string }>(sql`pragma table_info(sale_receipt_guests)`)
    .map(({ name }) => name);
  expect(columns).toContain("guest_count");
  expect(columns).not.toContain("guests");
  const [stored] = db.all<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'table' and name = 'sale_receipt_guests'`,
  );
  expect(stored!.sql).toContain("sale_receipt_guests_guest_count_ck");

  const updated = await captureError(() =>
    db.run(sql`update sale_receipt_guests set guest_count = 3 where sale_id = ${first!}`),
  );
  expect(isRefusal(updated, TRIGGER_ABORT)).toBe(true);
  expect(engineErrorMessage(updated)).toBe("sale_receipt_guests is append-only");
  const deleted = await captureError(() =>
    db.run(sql`delete from sale_receipt_guests where sale_id = ${second!}`),
  );
  expect(isRefusal(deleted, TRIGGER_ABORT)).toBe(true);
  expect(engineErrorMessage(deleted)).toBe("sale_receipt_guests is append-only");
});
