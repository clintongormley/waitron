import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { locationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { runMigrations } from "../migrate.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedDevice, seedTenant } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { locations } from "./tenants.js";
import { printers } from "./printers.js";

async function beforeRefundDrawer(db: Database): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), "wt-refund-drawer-upgrade-"));
  try {
    cpSync(CORE_MIGRATIONS.migrationsFolder, folder, { recursive: true });
    const path = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string }[] };
    const index = journal.entries.findIndex(({ tag }) =>
      tag.endsWith("_tender_refund_drawer_target"),
    );
    expect(index).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, index);
    writeFileSync(path, JSON.stringify(journal));
    await runMigrations(db, { ...CORE_MIGRATIONS, migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
const suite = useVenueDb({ migrations: [], setup: beforeRefundDrawer, resetPerTest: false });

it("adds the refund drawer target without changing existing audit facts", async () => {
  const db = suite.db;
  await seedTenant(db);
  const [place] = await db
    .insert(locations)
    .values({ name: "Existing audit", invoiceLocales: ["en"], operationDescription: "Meals" })
    .returning();
  const { deviceId } = await seedDevice(db, { locationId: locationId(place!.id) });
  const [printer] = await db
    .insert(printers)
    .values({
      locationId: place!.id,
      name: "Existing drawer",
      transport: "cloud_poll",
      pollId: "existing",
    })
    .returning();
  await db.run(sql`insert into drawer_opens (id,device_id,printer_id,person_id,opened_at,reason,authorized_by,via_override)
    values ('original-manual',${deviceId},${printer!.id},'operator',1700000000000,'manual','approver',1),
    ('original-cash',${deviceId},${printer!.id},'cashier',1700000001000,'cash_sale',null,0),
    ('original-calibration',null,${printer!.id},'manager',1700000002000,'calibration','manager',0)`);
  const before = db.all<Record<string, unknown>>(sql`select * from drawer_opens order by id`);
  expect(before).toHaveLength(3);
  const inbound = db
    .all<{ name: string }>(sql`select name from sqlite_schema where type='table'`)
    .flatMap(({ name }) =>
      db
        .all<{ table: string }>(sql`select "table" from pragma_foreign_key_list(${name})`)
        .filter((key) => key.table === "drawer_opens"),
    );
  expect(inbound).toEqual([]);
  await runMigrations(db, CORE_MIGRATIONS);
  expect(db.all(sql`select * from drawer_opens order by id`)).toEqual(
    before.map((row) => ({ ...row, tender_refund_id: null })),
  );
  expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
});
