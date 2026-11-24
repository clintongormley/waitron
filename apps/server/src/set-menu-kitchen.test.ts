import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { kitchenPrintJobs, printJobs, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import { openDishCount } from "./station-closing.js";
import { readStationDeleteImpact } from "./station-delete.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { inTx } from "./testing/party-venue.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";
import { listStationQueue } from "./working-order-station-queue.js";
import { fireLines, fireableLineColumns } from "./working-order-kitchen-fire.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
let stationId: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    stationId = await inTx(fixture.venue, async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printer = await createPrinter(tx, {
        name: "Kitchen paper",
        transport: "cloud_poll",
        pollId: "set-menu-kitchen",
      });
      await attachPrinterToStation(tx, { stationId: station.id, printerId: printer.id });
      return station.id;
    });
  },
});

it("keeps the set menu off kitchen paper and the station queue while showing its dish", async () => {
  const { billId, menuLineId, dishId } = await setMenuBill(fixture, { send: false });
  const { venue } = fixture;
  await inTx(venue, async (tx) => {
    const [{ lineId: ordinaryId }] = await addPortionRound(tx, venue.cfg, billId, [
      { menuItemId: venue.item("Burger"), quantity: "1" },
    ]);
    const lines = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(inArray(workingOrderLines.id, [menuLineId, dishId, ordinaryId]));
    await fireLines(tx, venue.cfg, billId, lines);
  });
  const jobs = await venue.db
    .select({ payload: printJobs.payload })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .where(eq(kitchenPrintJobs.workingOrderId, billId));
  const paper = jobs.flatMap((job) => printedLines(job.payload)).join(" ");
  expect(paper).toContain("FLAN");
  expect(paper).toContain("BURG");
  expect(paper).not.toContain("Daily menu");
  const queue = await inTx(venue, (tx) => listStationQueue(tx, stationId));
  expect(queue.find((group) => group.orderId === billId)?.items.map((item) => item.name)).toEqual([
    "FLAN",
    "BURG",
  ]);
  expect(
    await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, menuLineId)),
  ).toEqual([]);
  expect(await inTx(venue, (tx) => openDishCount(tx, stationId))).toBe(2);
  const impact = await inTx(venue, (tx) => readStationDeleteImpact(tx, stationId));
  expect(
    impact.refusals.find((refusal) => refusal.code === "station.work_in_progress")?.params,
  ).toEqual({ stationId, count: 2 });
});
