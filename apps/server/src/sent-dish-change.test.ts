import { updateOrderLine } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenNotices,
  parties,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { readBillEditState } from "./bill-editing.js";
import { readDrafts, saveDraft } from "./order-drafts.js";
import { attachPrinterToStation } from "./station-printers.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { fireAll } from "./testing/serve-line.js";
import { inTx, provisionBillVenue, send, groupedTabWith, type BillVenue } from "./testing/bill-venue.js";

let venue: BillVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

/** A party's bill with a sent Steak at line 1, its station printing to a printer of its own. */
async function billWithSentDish(quantity = "1") {
  const billId = await groupedTabWith(venue, "Steak");
  if (quantity !== "1") await inTx(venue, (tx) =>
    updateOrderLine(tx, venue.cfg, billId, 1, { quantity }, 0, venue.operatorId));
  await inTx(venue, (tx) => fireAll(tx, venue.cfg, billId));
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  const dish = await kitchenItemOf(billId, 1);
  const printerId = await inTx(venue, async (tx) => {
    const { id } = await createPrinter(tx, {
      name: `Kitchen ${randomUUID().slice(0, 8)}`,
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, { stationId: dish!.stationId!, printerId: id });
    return id;
  });
  return { billId, partyId: order!.partyId!, dish: dish!, printerId };
}
type Bill = Awaited<ReturnType<typeof billWithSentDish>>;

async function kitchenItemOf(billId: string, lineNo: number) {
  const [row] = await venue.db
    .select({
      id: ticketItems.id,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
      note: ticketItems.note,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)));
  return row ?? null;
}

/** `operatorId`'s New order on the bill, holding a Caña. */
async function saveNewOrder(bill: Bill, operatorId: string) {
  const expectedEdit = await inTx(venue, (tx) => readBillEditState(tx, bill.billId));
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, bill.partyId, operatorId, {
      billId: bill.billId,
      expectedEdit,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    }),
  );
}

async function revisionOf(billId: string) {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return order!.revision;
}

it("does not mount the retired Recall routes", async () => {
  for (const path of [`/api/parties/${randomUUID()}/lines/${randomUUID()}/recall`, `/api/working-orders/${randomUUID()}/lines/recall`]) {
    const response = await venue.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await response.text();
    expect(response.status).toBe(404);
  }
});

it("requires the whole row observation before Change dish can lower a sent count", async () => {
  const bill = await billWithSentDish("2");
  const answer = await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${bill.billId}/lines/1`, { revision: await revisionOf(bill.billId), expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)), quantity: "1" });
  expect(answer).toMatchObject({ status: 400, json: { code: "management.request_invalid", params: { field: "portionLineNos" } } });
  const [line] = await venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, bill.billId));
  expect(line!.quantity).toBe(2000);
});

const changeNote = async (bill: Bill) =>
  send(venue.app, venue.cookie, "PUT", `/api/working-orders/${bill.billId}/lines/1`, {
    revision: await revisionOf(bill.billId),
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
    note: "no onions",
    portionLineNos: [],
  });

const noticesOf = (billId: string) =>
  venue.db
    .select({ kind: kitchenNotices.kind })
    .from(kitchenNotices)
    .where(eq(kitchenNotices.workingOrderId, billId));

const slipsAt = async (printerId: string) =>
  (
    await venue.db
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
  ).map((job) => decodeTicket(job.payload));

function frozen() {
  return Object.fromEntries(
    venue.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        venue.db
          .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
          .map((row) => (name === "devices" ? { ...row, last_seen_at: null } : row)),
      ]),
  );
}

describe("changing a sent dish while a New order waits on the bill", () => {
  it("recalls and re-sends the dish, leaves the New order as it was, and still sends it after", async () => {
    const bill = await billWithSentDish();
    const saved = await saveNewOrder(bill, venue.operatorId);
    const draftsBefore = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, bill.partyId));

    const answer = await changeNote(bill);

    expect(answer.status).toBe(200);
    expect(await noticesOf(bill.billId)).toEqual([{ kind: "recalled" }]);
    // The venue's kitchen reads Spanish: a RECALLED slip heads "RETIRADO".
    const recalledSlips = (await slipsAt(bill.printerId)).filter((slip) =>
      slip.includes("*** RETIRADO ***"),
    );
    expect(recalledSlips).toHaveLength(1);
    expect(recalledSlips[0]).toContain("CHULETA");
    const fresh = await kitchenItemOf(bill.billId, 1);
    expect(fresh).toMatchObject({ note: "no onions" });
    expect(fresh!.id).not.toBe(bill.dish.id);
    expect(fresh!.firedAt).not.toBeNull();

    const draftsAfter = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, bill.partyId));
    expect(draftsAfter).toEqual(draftsBefore);
    expect(draftsAfter).toEqual([
      expect.objectContaining({ id: saved.edit.draftId, revision: saved.edit.draftRevision }),
    ]);

    const [party] = await venue.db.select().from(parties).where(eq(parties.id, bill.partyId));
    const expectedEdit = await inTx(venue, (tx) => readBillEditState(tx, bill.billId));
    const submitted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bill.partyId}/drafts/${saved.edit.draftId}/submit`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        expectedEdit,
        draftRevision: expectedEdit.draftRevision,
        groups: [{ release: "fire", lineIds: draftsAfter[0]!.lines.map((line) => line.id) }],
      },
    );

    expect(submitted.status).toBe(200);
    const lines = await venue.db
      .select({
        lineNo: workingOrderLines.lineNo,
        kitchenName: workingOrderLines.kitchenName,
        sentAt: workingOrderLines.sentAt,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, bill.billId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toEqual([
      expect.objectContaining({ lineNo: 1, kitchenName: "CHULETA" }),
      { lineNo: 2, kitchenName: "CANA", sentAt: expect.any(String) },
    ]);
    expect((await kitchenItemOf(bill.billId, 2))!.firedAt).not.toBeNull();
  });

  it("refuses the change while another person's New order is on the bill, changing nothing", async () => {
    const bill = await billWithSentDish();
    const owned = await saveNewOrder(bill, venue.adminId);
    const before = frozen();

    const answer = await changeNote(bill);

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { billId: bill.billId, draftId: owned.edit.draftId, ownerId: venue.adminId },
    });
    expect(frozen()).toEqual(before);
  });
});
