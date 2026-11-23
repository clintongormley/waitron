import { unzipSync } from "fflate";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { appendDrawerEntry, billPayments, tableExists, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedPerson } from "@waitron/identity/test/fixtures.js";
import { createPrinter } from "@waitron/printing";
import {
  seedOpenOrder,
  seedVenueWithSeries,
  type SeededVenue,
} from "@waitron/reporting/test/fixtures.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { buildOldBoxWorkbook } from "./old-box-data-workbook.js";
import { row, sheetNamed } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => set.name !== "payments"),
    null,
  ),
  timeoutMs: 60_000,
});

const AT = "2026-11-20T10:00:00.000Z";

let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

it("lists part payments and drawer entries, and no card payments, when the payments table does not exist", async () => {
  expect(await tableExists(suite.db, "payments")).toBe(false);
  const personId = await seedPerson(suite.db, "manager");
  await suite.db.run(sql`update persons set display_name = 'Marta Ruiz' where id = ${personId}`);
  const { orderId } = await seedOpenOrder(suite.db, venue, 3);
  const [part] = await suite.db
    .insert(billPayments)
    .values({
      workingOrderId: orderId,
      submissionId: crypto.randomUUID(),
      fingerprint: "fixture",
      kind: "contribution",
      method: "cash",
      applied: 500,
      tendered: 500,
      state: "received",
      requestedBy: personId,
      source: "device",
      deviceId: venue.deviceId,
      createdAt: AT,
      receivedAt: AT,
    })
    .returning({ id: billPayments.id });
  const drawer = await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Bar",
      transport: "network_tcp",
      host: "bar.test",
      hasCashDrawer: true,
    });
    return appendDrawerEntry(tx, {
      printerId: printer.id,
      nodeId: venue.nodeId,
      recordedAt: AT,
      personId,
      kind: "cash_payment",
      amount: 500,
      billPaymentId: part!.id,
    });
  });
  const bytes = await buildOldBoxWorkbook({
    db: suite.db,
    modules: [],
    mainHoldings: null,
    madeAt: new Date(AT),
    language: "en",
    since: { kind: "all" },
  });
  const xml = sheetNamed(unzipSync(bytes), OLD_BOX_DATA_WORDS.en.paymentsSheet)!;
  expect([3, 4, 5].map((n) => row(xml, n).slice(0, 2))).toEqual([
    ["Payment", AT],
    ["Cash drawer", AT],
    [],
  ]);
  expect(row(xml, 4).at(-1)).toBe(drawer.id);
});
