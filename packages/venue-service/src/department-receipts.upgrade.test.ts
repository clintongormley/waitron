import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  locations,
  tenantReceipts,
  withTransaction,
} from "@waitron/db";
import { applyMigrationSet, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { departments } from "./schema/service.js";
import { departmentReceipts } from "./schema/department-receipts.js";

const predecessor = mkdtempSync(join(tmpdir(), "receipt-predecessor-"));
afterAll(() => rmSync(predecessor, { recursive: true, force: true }));
cpSync(VENUE_SERVICE_MIGRATIONS.migrationsFolder, predecessor, { recursive: true });
const journalPath = join(predecessor, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
const candidate = journal.entries.pop()!;
rmSync(join(predecessor, `${candidate.tag}.sql`));
writeFileSync(journalPath, JSON.stringify(journal));
const suite = useVenueDb({
  // This single-case probe changes the schema after the opener captures its reset table set.
  resetPerTest: false,
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    { ...VENUE_SERVICE_MIGRATIONS, migrationsFolder: predecessor },
  ],
});

it("upgrades a populated predecessor with its installed change-feed and append-only triggers", async () => {
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: "Existing venue",
      invoiceLocales: ["es-ES"],
      operationDescription: "Hospitality",
    })
    .returning();
  const [dept] = await suite.db
    .insert(departments)
    .values({
      locationId: locationId(place!.id),
      name: "Existing department",
      tradingName: "Existing sign",
      isDefault: true,
    })
    .returning();
  const receipt = {
    logo: `${"a".repeat(64)}.png`,
    headerSubtitle: "Existing subtitle",
    footerMessage: "Existing footer",
    printAddress: false,
    logoRasters: {
      "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
      "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
    },
  };
  await suite.db.insert(tenantReceipts).values({ receipt });
  await installChangeFeed(
    suite.db,
    VENUE_SERVICE_CHANGE_SOURCES.filter((source) => source.table !== "department_receipts"),
  );
  const before = suite.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'trigger' order by name`,
  );
  expect(before.some((row) => row.name.startsWith("waitron_change_"))).toBe(true);
  expect(before.some((row) => row.name.includes("append_only"))).toBe(true);
  expect(
    suite.db.all(
      sql`select name from sqlite_master where type = 'table' and name = 'department_receipts'`,
    ),
  ).toEqual([]);
  await applyMigrationSet(suite.db, VENUE_SERVICE_MIGRATIONS);
  expect(
    suite.db.all(sql`select name from sqlite_master where type = 'trigger' order by name`),
  ).toEqual(before);
  expect(await suite.db.select().from(departments)).toContainEqual(
    expect.objectContaining({
      id: dept!.id,
      name: "Existing department",
      tradingName: "Existing sign",
    }),
  );
  expect((await suite.db.select().from(tenantReceipts))[0]!.receipt).toEqual(receipt);
  expect(await suite.db.select().from(departmentReceipts)).toEqual([]);
  const incoming = suite.db.all<{ child: string }>(
    sql`select m.name as child from sqlite_master m, pragma_foreign_key_list(m.name) f where m.type = 'table' and f."table" = 'department_receipts'`,
  );
  expect(incoming).toEqual([]);
  await expect(
    withTransaction(suite.db, async (tx) => {
      await tx.insert(departmentReceipts).values({ departmentId: "missing", receipt: {} });
    }),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(departmentReceipts)
      .values({ departmentId: dept!.id, receipt: { email: "existing@example.com" } });
  });
  await expect(
    withTransaction(suite.db, async (tx) => {
      await tx.insert(departmentReceipts).values({ departmentId: dept!.id, receipt: {} });
    }),
  ).rejects.toThrow("UNIQUE constraint failed: department_receipts.department_id");
  expect(await suite.db.select().from(departmentReceipts)).toHaveLength(1);
});
