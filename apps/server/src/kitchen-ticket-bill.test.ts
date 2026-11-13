import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { kitchenStations, printJobs, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { computeOverdueOrders } from "@waitron/reporting";
import { createPrinter } from "@waitron/printing";
import { inTx, provisionBillVenue, seatedWith, send } from "./testing/bill-venue.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { createStation } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { listStationQueue, readPassRows } from "./working-order.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { printedLines } from "./testing/decode-ticket.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
afterEach(() => vi.useRealTimers());
it("a moved dish shows under its new bill on every kitchen read", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T12:00:00Z") });
  const v = await provisionBillVenue(suite.db);
  const station = await inTx(v, async (tx) => {
    const station = await createStation(tx, { name: "Kitchen", isDefault: true });
    const printer = await createPrinter(tx, {
      name: "Kitchen paper",
      transport: "cloud_poll",
      pollId: "kitchen-bill",
    });
    await attachPrinterToStation(tx, { stationId: station.id, printerId: printer.id });
    await tx
      .update(kitchenStations)
      .set({ overdueAfterMinutes: 2, warmAfterMinutes: 1 })
      .where(eq(kitchenStations.id, station.id));
    return station;
  });
  const party = await seatedWith(v, "Paella", "Tarta");
  const lines = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, party.tabId))
    .orderBy(workingOrderLines.lineNo);
  const path = `/api/bills/${party.tabId}/move-dishes`;
  const answer = await send(
    v.app,
    v.cookie,
    "POST",
    path,
    await observedBillActionBody(v.db, path, {
      lineIds: [lines[1]!.id],
      toBillId: null,
      partyId: party.partyId,
      expectedPartyRevision: party.revision,
    }),
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  const newBill = answer.json.billId as string;
  expect(
    Object.fromEntries(
      (await ticketItemsWithBill(v.db)).map((row) => [row.workingOrderLineId, row.workingOrderId]),
    ),
  ).toEqual({ [lines[0]!.id]: party.tabId, [lines[1]!.id]: newBill });
  const bills = await v.db
    .select({ id: workingOrders.id, number: workingOrders.orderNumber })
    .from(workingOrders);
  vi.setSystemTime(new Date("2026-11-01T12:10:00Z"));
  await inTx(v, async (tx) => {
    const queue = await listStationQueue(tx, station.id);
    expect(queue.map((group) => group.orderId).sort()).toEqual([party.tabId, newBill].sort());
    const pass = await readPassRows(tx, sql`1 = 1`, Date.now());
    expect(Object.fromEntries(pass.map((row) => [row.lineId, row.orderId]))).toEqual({
      [lines[0]!.id]: party.tabId,
      [lines[1]!.id]: newBill,
    });
    expect((await computeOverdueOrders(tx)).map((row) => row.orderId).sort()).toEqual(
      [party.tabId, newBill].sort(),
    );
  });
  for (const [id, wanted, absent] of [
    [party.tabId, "PAELLA", "TARTA"],
    [newBill, "TARTA", "PAELLA"],
  ] as const) {
    const before = new Set(
      (await v.db.select({ id: printJobs.id }).from(printJobs)).map((job) => job.id),
    );
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, id));
    const paper = (
      await v.db.select({ id: printJobs.id, payload: printJobs.payload }).from(printJobs)
    )
      .filter((job) => !before.has(job.id))
      .flatMap((job) => printedLines(job.payload));
    expect(paper).toContain(String(bills.find((bill) => bill.id === id)!.number));
    expect(paper.join(" ")).toContain(wanted);
    expect(paper.join(" ")).not.toContain(absent);
  }
});
