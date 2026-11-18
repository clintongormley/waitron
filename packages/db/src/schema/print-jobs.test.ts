import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedCashSale, seedCompletedCashRefund, seedPerson, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("refuses a print job linked to a refund that does not exist", async () => {
  const db = suite.db;
  await seedVenue(db);
  const sale = await seedCashSale(db);
  const personId = await seedPerson(db);
  const refundId = await seedCompletedCashRefund(db, { ...sale, personId });
  const [printer] = await db
    .insert(printers)
    .values({ name: "Receipts", transport: "network_tcp", host: "printer.test" })
    .returning();
  const insert = (tenderRefundId: string | null) => {
    const row = { printerId: printer!.id, payload: Uint8Array.of(1), tenderRefundId };
    return db.insert(printJobs).values(row).returning();
  };

  await expect(insert("absent-refund")).rejects.toThrow("FOREIGN KEY constraint failed");
  expect(await insert(refundId)).toMatchObject([{ tenderRefundId: refundId }]);
  expect(await insert(null)).toMatchObject([{ tenderRefundId: null }]);
});
