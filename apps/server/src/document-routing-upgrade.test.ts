import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, runMigrations, venueLocationId, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedVenue } from "@waitron/db/testing/seed.js";

async function migratePredecessor(db: Database) {
  const folder = mkdtempSync(join(tmpdir(), "waitron-routing-upgrade-"));
  try {
    cpSync(CORE_MIGRATIONS.migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    const added = journal.entries.findIndex(({ tag }) => tag.endsWith("_a790_document_routing"));
    const kept = added === -1 ? journal.entries : journal.entries.slice(0, added);
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: kept }));
    await runMigrations(db, { ...CORE_MIGRATIONS, migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
const suite = useVenueDb({ migrations: [], setup: migratePredecessor });

it("routing upgrade preserves populated predecessor rows", async () => {
  const db = suite.db;
  await seedVenue(db, {
    name: "Oak Room",
    invoiceLocales: ["es"],
    operationDescription: "Restaurant",
  });
  const venue = await venueLocationId(db);
  const node = await seedNode(db);
  const { deviceId } = await seedDevice(db);
  const series = randomUUID();
  const sale = randomUUID();
  const printer = randomUUID();
  const job = randomUUID();
  const delivery = randomUUID();
  const copy = randomUUID();
  const person = randomUUID();
  await db.execute(
    sql`insert into invoice_series (id, node_id, code) values (${series}, ${node}, 'A')`,
  );
  await db.execute(sql`insert into sales (id, source, device_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state)
    values (${sale}, 'device', ${deviceId}, ${node}, ${series}, 1, '2026-11-04T12:00:00.000Z', 0, 1450, '[]', 'es', '["es"]', 'none', 'recorded')`);
  await db.execute(
    sql`insert into printers (id, location_id, name, transport, host) values (${printer}, ${venue}, 'Bar', 'network_tcp', '10.0.0.7')`,
  );
  await db.execute(
    sql`insert into print_jobs (id, location_id, printer_id, payload, created_at) values (${job}, ${venue}, ${printer}, x'0102', '2026-11-04T12:00:00.000Z')`,
  );
  await db.execute(
    sql`insert into invoice_deliveries (id, sale_id, print_job_id, request_key, medium, designation, generation, person_id, created_at, next_attempt_at) values (${delivery}, ${sale}, ${job}, ${randomUUID()}, 'receipt', 'duplicate', 1, ${person}, '2026-11-04T12:00:00.000Z', '2026-11-04T12:00:00.000Z')`,
  );
  await db.execute(
    sql`insert into receipt_reprints (id, sale_id, print_job_id, person_id, requested_at) values (${copy}, ${sale}, ${job}, ${person}, '2026-11-04T12:00:00.000Z')`,
  );
  const preserved = ["sales", "invoice_deliveries", "print_jobs", "devices", "receipt_reprints"];
  const before = preserved.map((table) =>
    db.all(sql`select * from ${sql.identifier(table)} order by id`),
  );
  expect(before.map((rows) => rows.length)).toEqual([1, 1, 1, 1, 1]);
  await runMigrations(db, CORE_MIGRATIONS);
  expect(
    preserved.map((table) => db.all(sql`select * from ${sql.identifier(table)} order by id`)),
  ).toEqual(before);
  for (const table of [
    "document_delivery_requests",
    "document_delivery_sequences",
    "device_invoice_save_operations",
    "device_invoice_revisions",
    "document_page_jobs",
    "document_page_reprints",
  ]) {
    expect(db.all(sql`select * from ${sql.identifier(table)}`)).toEqual([]);
  }
  expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
});
