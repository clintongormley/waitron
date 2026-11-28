import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  adjustmentLines,
  allergyLineTicks,
  billAdvances,
  billPayments,
  insertNodeSeriesTx,
  invoiceSeries,
  kitchenStations,
  lineServiceCancellations,
  printJobs,
  readLiveSeriesIdTx,
  sales,
  workingOrders,
} from "@waitron/db";
import { recordReplacement } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { adjustments, computeAdjustmentReport, listAdjustmentReasons } from "@waitron/adjustments";
import { createExtraList, writeProductModifiers } from "@waitron/menu";
import {
  computeCategorySales,
  computeVatSummaryForPeriod,
  currentBusinessDay,
  resolveVenueClock,
} from "@waitron/reporting";
import {
  correctiveRecordsOf,
  filedRecordsOf,
  filedSales,
} from "@waitron/fiscal-verifactu/test/invoice-records.js";
import {
  acceptedByAeat,
  refusedByAeat,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import {
  clearRoutingCell,
  readPartyAllergy,
  setAllergyLineTicks,
  setRoutingCell,
  writePartyAllergy,
} from "@waitron/venue-service";
import { createPrinter } from "@waitron/printing";
import { readBillEditState } from "./bill-editing.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { createStation } from "./kitchen.js";
import { fireGroup } from "./order-group-release.js";
import { attachPrinterToStation } from "./station-printers.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { takeOver } from "./testing/taken-over.js";
import { servedOrCharged } from "./served-dishes.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { listFreeItems } from "./free-items.js";
import {
  cancelBody,
  cancelItemHttp,
  cancelReasonId,
  GIVE_AWAY_REASON,
  reasonIdOf,
  seedGivenAwayLine,
} from "./testing/cancel-line.js";
import { openedCorrection, previewedSplit } from "./testing/invoice-correction.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { createTable } from "./testing/live-table.js";
import {
  inTx,
  paymentRows,
  placedCounterBillMovedTo,
  send,
  statusOf,
  type Answer,
} from "./testing/bill-venue.js";
import {
  departed,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

let venue: OrderVenue;
/** Steak's extras list, offering Croquettes at 1.00. */
let extraListId: string;
let croquettesId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      const ids = new Map(
        db
          .all<{ id: string; name: string }>(sql`select id, name from products`)
          .map((row) => [row.name, row.id]),
      );
      croquettesId = ids.get("Croquettes")!;
      const extras = await createExtraList(
        tx,
        {
          name: "Sides",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: croquettesId, maxQuantity: 1, preselected: false, price: "1.00" }],
        },
        venue.cfg.locale,
      );
      extraListId = extras.id;
      await writeProductModifiers(tx, ids.get("Steak")!, [{ kind: "extras", id: extras.id }]);
      await offerProducts(tx, { zone: "tables" });
    });
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
  },
});

type Party = { partyId: string; tabId: string; tableId: string };
type Line = { name: string; extras?: unknown[]; quantity?: string };

/** Fiscal filing's Send the replacement on the ticket `saleId`; answers the replacement's id. */
function sendReplacement(saleId: string): Promise<string> {
  return inTx(venue, async (tx) => {
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    const replaced = await recordReplacement(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "corrective")),
      correctsSaleId: brandSaleId(saleId),
      authz: { sessionId: session.id },
      clock: venue.clock,
    });
    return replaced.saleId;
  });
}

async function revisionOfBill(billId: string): Promise<number> {
  const [bill] = await inTx(venue, (tx) =>
    tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return bill!.revision;
}

const revisionOf = (partyId: string) => fixture.revisionOf(venue, partyId);
const dishesOf = (billId: string) => fixture.dishesOf(venue, billId);
const serve = (party: Party, billId: string, ...names: string[]) =>
  fixture.serve(venue, party, billId, ...names);
const printBill = (party: Party, billId: string, printAnyway = false) =>
  fixture.printBill(venue, party, billId, printAnyway);
const split = (billId: string, cookie = venue.supervisorTill, app = venue.app) =>
  fixture.split(venue, billId, cookie, app);
const creditsOf = (saleId: string) => fixture.creditsOf(venue, saleId);
const invoiceOf = (billId: string) => fixture.invoiceOf(venue, billId);
const written = () => fixture.written(venue);
const expectRefused = (
  billId: string,
  answer: () => Promise<Answer>,
  refusal: { status: number; code: string },
) => fixture.expectRefused(venue, billId, answer, refusal);

/** A party seated at a fresh table with one guest, its dishes sent to the kitchen as one group. */
const seat = (...lines: (string | Line)[]): Promise<Party> => seatWith("fire", ...lines);

async function seatWith(release: "fire" | "hold", ...lines: (string | Line)[]): Promise<Party> {
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, { label: `S-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seated = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  expect(seated.status).toBe(200);
  const party = {
    partyId: seated.json.partyId as string,
    tabId: seated.json.tabId as string,
    tableId,
  };
  await inTx(venue, (tx) =>
    writePartyAllergy(
      tx,
      party.partyId,
      { answer: "allergies", guests: [{ who: "Window seat", allergens: { milk: {} } }] },
      venue.operatorId,
    ),
  );
  if (lines.length === 0) return party;
  const ordered = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${party.partyId}/groups`,
    {
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      groups: [
        {
          lines: lines.map((line) => {
            const { name, extras, quantity } = typeof line === "string" ? { name: line } : line;
            return {
              menuItemId: venue.offerFor(name),
              quantity: quantity ?? "1",
              ...(extras === undefined ? {} : { extras }),
            };
          }),
          release,
        },
      ],
    },
  );
  expect(ordered.status, JSON.stringify(ordered.json)).toBe(200);
  return party;
}

/** Move the named dishes of `fromBillId` onto a new bill of the party. */
async function moveToNewBill(party: Party, fromBillId: string, ...names: string[]) {
  const lineIds = (await dishesOf(fromBillId))
    .filter((line) => line.parentLineId === null && names.includes(line.name))
    .map((line) => line.id);
  const moved = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/bills/${fromBillId}/move-dishes`,
    {
      partyId: party.partyId,
      expectedPartyRevision: revisionOf(party.partyId),
      lineIds,
      toBillId: null,
      expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, fromBillId))],
    },
  );
  expect(moved.status, JSON.stringify(moved.json)).toBe(200);
  return moved.json.billId as string;
}

function billsOf(partyId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: workingOrders.id, status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId)),
  );
}

/** Served dishes, printed: the bill holds its ticket and nothing is left to serve. */
const printed = async (...lines: (string | Line)[]): Promise<Party> =>
  fixture.printed(venue, await seat(...lines));

describe("POST /api/working-orders/:id/split-after-print", () => {
  it("prints, splits, and each guest gets a ticket", async () => {
    const party = await printed("Red wine bottle", "Tarta");
    const original = await invoiceOf(party.tabId);
    expect(original.total).toBe(4800);
    const before = await dishesOf(party.tabId);

    const answer = await split(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const credits = await creditsOf(original.id);
    expect(credits.map((credit) => credit.total)).toEqual([-4800]);
    expect(answer.json).toEqual({
      billId: expect.any(String),
      correctiveNumber: `R/${credits[0]!.invoiceNumber}`,
    });
    const newBill = answer.json.billId as string;
    expect(await filedSales(venue.db, [credits[0]!.id])).toEqual(
      new Map([[credits[0]!.id, { kind: "R5", total: "-48.00" }]]),
    );
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    expect(await dishesOf(party.tabId)).toEqual(before);
    expect(await statusOf(venue, newBill)).toBe("open");
    const copies = await dishesOf(newBill);
    expect(copies.map((line) => [line.name, line.unitPriceGross, line.lineNo])).toEqual([
      ["Red wine bottle", 3000, 1],
      ["Tarta", 1800, 2],
    ]);
    expect(copies.map((line) => line.id)).not.toContain(before[0]!.id);
    expect(copies.every((line) => line.servedAt !== null)).toBe(true);
    const [bill] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, newBill)),
    );
    expect(
      venue.db.all(sql`select kind, reason from order_amendments
      where working_order_id = ${party.tabId} order by sequence_no desc limit 1`),
    ).toEqual([
      { kind: "order_cancelled", reason: `Bill split after printing to bill ${bill!.billNumber}` },
    ]);

    const third = await moveToNewBill(party, newBill, "Tarta");
    const wine = await printBill(party, newBill);
    const tarta = await printBill(party, third);

    expect([wine.status, tarta.status]).toEqual([200, 200]);
    expect([wine.json.total, tarta.json.total]).toEqual(["30.00", "18.00"]);
  });

  it("the credited ticket still reprints its dishes", async () => {
    const party = await printed("Red wine bottle", "Tarta");
    expect((await split(party.tabId)).status).toBe(200);

    const ticket = await send(venue.app, venue.cookie, "GET", `/api/sales/${party.tabId}`);
    const reprint = await send(
      venue.orders,
      venue.adminDashboard,
      "POST",
      `/management-api/orders/${party.tabId}/reprint`,
      { printerId: venue.printerId },
    );

    expect(ticket.status).toBe(200);
    expect(ticket.json).toMatchObject({
      total: "48.00",
      lines: [
        expect.objectContaining({ gross: "30.00" }),
        expect.objectContaining({ gross: "18.00" }),
      ],
    });
    expect(reprint.status).toBe(202);
    const [job] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(printJobs)
        .where(eq(printJobs.id, reprint.json.jobId as string)),
    );
    const text = decodeTicket(job!.payload);
    expect(text).toContain("Rioja crianza");
    expect(text).toContain("Tarta de queso");
    expect(text).toContain("48,00");
  });

  it("refuses a dish printed with Print anyway, then splits once it is marked served", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    expect((await serve(party, party.tabId, "Red wine bottle")).status).toBe(200);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const tarta = (await dishesOf(party.tabId)).find((line) => line.name === "Tarta")!;

    const refused = await expectRefused(party.tabId, () => split(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });

    expect(refused.json.params).toEqual({
      workingOrderId: party.tabId,
      dishes: [{ lineId: tarta.id, dishName: "Tarta", quantity: "1.000", released: true }],
      canStop: true,
    });
    expect((await serve(party, party.tabId, "Tarta")).status).toBe(200);
    expect((await split(party.tabId)).status).toBe(200);
  });

  it("needs no sale.rectify, and names unserved dishes first", async () => {
    const party = await printed("Tarta");
    const original = await invoiceOf(party.tabId);
    const answer = await split(party.tabId, venue.cookie);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const credits = await creditsOf(original.id);
    expect(credits.map((credit) => [credit.total, credit.authorizedBy])).toEqual([
      [-original.total, venue.operatorId],
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");

    const unserved = await seat("Tarta");
    expect((await printBill(unserved, unserved.tabId, true)).status).toBe(200);
    await expectRefused(unserved.tabId, () => split(unserved.tabId, venue.cookie), {
      status: 409,
      code: "bill.unserved_dishes",
    });
  });

  it("the new bill names the printed one", async () => {
    const party = await printed("Tarta");
    const answer = await split(party.tabId, venue.cookie);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const [reopened] = await inTx(venue, (tx) =>
      tx
        .select({ status: workingOrders.status, reopenedFrom: workingOrders.reopenedFrom })
        .from(workingOrders)
        .where(eq(workingOrders.id, answer.json.billId as string)),
    );
    expect(reopened).toEqual({ status: "open", reopenedFrom: party.tabId });
  });

  it("the party's bills read names the bill each one was reopened from", async () => {
    const party = await printed("Tarta");
    const answer = await split(party.tabId, venue.cookie);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const bills = await send(venue.app, venue.cookie, "GET", `/api/parties/${party.partyId}/bills`);
    expect(bills.status, JSON.stringify(bills.json)).toBe(200);
    const byId = new Map(
      (bills.json as unknown as { workingOrderId: string; reopenedFrom?: string }[]).map((bill) => [
        bill.workingOrderId,
        bill,
      ]),
    );
    expect(byId.get(answer.json.billId as string)?.reopenedFrom).toBe(party.tabId);
    expect(byId.get(party.tabId)).not.toHaveProperty("reopenedFrom");
  });

  it("a part-paid bill names its unserved dishes, its money moving nowhere", async () => {
    const party = await seat("Tarta");
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: party.tabId,
        submissionId: randomUUID(),
        fingerprint: "test",
        kind: "contribution",
        method: "cash",
        applied: 100,
        tendered: 100,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: venue.operatorId,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
      }),
    );

    const refused = await expectRefused(party.tabId, () => split(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });

    expect(refused.json.params).toMatchObject({ workingOrderId: party.tabId });
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ id: billPayments.id })
          .from(billPayments)
          .where(eq(billPayments.workingOrderId, party.tabId)),
      ),
    ).toHaveLength(1);
  });

  it("reopens a bill that has had an advance, whose ticket takes the advance off, and the advance counts on the new bill", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "30.00",
        method: "cash",
        tendered: "30.00",
        applied: "30.00",
        tip: "0.00",
        ownReceipt: true,
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const advancesOf = () =>
      inTx(venue, (tx) =>
        tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, party.tabId)),
      );
    const [advance] = await advancesOf();
    expect(advance).toBeDefined();
    expect((await serve(party, party.tabId)).status).toBe(200);
    const ticket = await printBill(party, party.tabId);
    expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
    const invoice = await invoiceOf(party.tabId);
    const salesOf = () =>
      inTx(venue, (tx) =>
        tx
          .select({ id: sales.id, total: sales.total })
          .from(sales)
          .where(inArray(sales.id, [advance!.advanceSaleId, invoice.id]))
          .orderBy(sales.total),
      );
    const issued = await salesOf();
    expect(issued).toEqual([
      { id: invoice.id, total: 1800 },
      { id: advance!.advanceSaleId, total: 3000 },
    ]);

    const reopened = await split(party.tabId);

    expect(reopened.status, JSON.stringify(reopened.json)).toBe(200);
    expect(await salesOf()).toEqual(issued);
    expect((await creditsOf(invoice.id)).map((credit) => credit.total)).toEqual([-1800]);
    expect(await advancesOf()).toEqual([advance]);
    expect((await fixture.balanceOf(venue, reopened.json.billId as string)).json).toMatchObject({
      status: "open",
      total: "48.00",
      received: "30.00",
      outstanding: "18.00",
    });
  });

  it("reopens a bill that has had an advance given back in full, which counts nothing on the new bill", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "30.00",
        method: "cash",
        tendered: "30.00",
        applied: "30.00",
        tip: "0.00",
        ownReceipt: true,
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [advance] = await inTx(venue, (tx) =>
      tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, party.tabId)),
    );
    const override = { personId: venue.adminId, pin: "1234" };
    const expectedSplit = await previewedSplit(venue, advance!.advanceSaleId, { gross: "30.00" });
    const [reason] = await inTx(venue, (tx) => listAdjustmentReasons(tx));
    const correctionId = await openedCorrection(
      venue,
      advance!.advanceSaleId,
      {
        submissionId: randomUUID(),
        gross: "30.00",
        reasonId: reason!.id,
        note: "Given back",
        expectedSplit,
        override,
      },
      venue.cookie,
    );
    const givenBack = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/cash`,
      { submissionId: randomUUID(), amount: "30.00", override },
    );
    expect(givenBack.status, JSON.stringify(givenBack.json)).toBe(200);
    expect((await creditsOf(advance!.advanceSaleId)).map((credit) => credit.total)).toEqual([
      -3000,
    ]);
    expect((await serve(party, party.tabId)).status).toBe(200);
    const ticket = await printBill(party, party.tabId);
    expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
    const invoice = await invoiceOf(party.tabId);
    expect(invoice.total).toBe(4800);

    const reopened = await split(party.tabId);

    expect(reopened.status, JSON.stringify(reopened.json)).toBe(200);
    expect((await creditsOf(invoice.id)).map((credit) => credit.total)).toEqual([-4800]);
    expect((await creditsOf(advance!.advanceSaleId)).map((credit) => credit.total)).toEqual([
      -3000,
    ]);
    expect((await fixture.balanceOf(venue, reopened.json.billId as string)).json).toMatchObject({
      status: "open",
      total: "48.00",
      received: "0.00",
      outstanding: "48.00",
    });
  });

  it("refuses a full invoice naming a customer before its unserved dishes", async () => {
    venue.db.run(sql`update taxpayer set taxpayer_domicile = 'Calle Fiscal 8, Madrid'`);
    onTestFinished(() => {
      venue.db.run(sql`update taxpayer set taxpayer_domicile = null`);
    });
    const party = await seat("Tarta");
    const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
      readBillEditState(tx, party.tabId),
    );
    const chosen = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}/invoice-choice`,
      {
        revision: await revisionOfBill(party.tabId),
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Harbour Foods",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
        expectedEdit: { billId: party.tabId, editorVersion, draftId, draftRevision },
      },
    );
    expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
    const printedAnyway = await printBill(party, party.tabId, true);
    expect(printedAnyway.status, JSON.stringify(printedAnyway.json)).toBe(200);
    expect((await invoiceOf(party.tabId)).counterpartyTaxId).not.toBeNull();

    await expectRefused(party.tabId, () => split(party.tabId, venue.cookie), {
      status: 409,
      code: "sale.correction_unsupported",
    });
  });

  it("refuses a bill its party left unpaid", async () => {
    const party = await departed(venue, "Tarta");
    await expectRefused(party.tabId, () => split(party.tabId), {
      status: 409,
      code: "bill.left_unpaid",
    });
  });

  it("refuses a counter order", async () => {
    const id = await placedIssuedBill(venue, "Tarta");
    await expectRefused(id, () => split(id), { status: 409, code: "bill.not_at_table" });
  });

  it("refuses a placed bill with no ticket", async () => {
    const party = await seat();
    const id = await placedCounterBillMovedTo(venue, venue.counterZone, party);
    await expectRefused(id, () => split(id), { status: 409, code: "bill.not_issued" });
  });

  it("reopens a ticket AEAT refused that nothing replaced, crediting it; Send the replacement then replaces it at its whole amount, once", async () => {
    const party = await printed("Tarta");
    const ticket = await invoiceOf(party.tabId);
    const saleId = ticket.id;
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));

    const answer = await split(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await creditsOf(saleId)).toHaveLength(1);
    expect(await filedRecordsOf(venue.db, saleId)).toEqual([
      { kind: "invoice", state: "rechazado" },
    ]);

    const replacementId = await sendReplacement(saleId);

    expect(correctiveRecordsOf(venue.db, saleId)).toEqual([
      expect.objectContaining({ type: "R5", by: "differences", total: -ticket.total }),
      expect.objectContaining({ type: "R5", by: "replacement", total: ticket.total }),
    ]);
    expect(await filedRecordsOf(venue.db, replacementId)).toEqual([
      { kind: "invoice", state: "pendiente" },
    ]);
    await expect(sendReplacement(saleId)).rejects.toMatchObject({
      code: "sale.replacement_not_first",
      params: { saleId },
    });
  });

  it("stops a ticket AEAT refused at its unserved dishes, then reopens it stopping them", async () => {
    const party = await seat("Steak", "Tarta");
    expect((await serve(party, party.tabId, "Tarta")).status).toBe(200);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const saleId = (await invoiceOf(party.tabId)).id;
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));

    await expectRefused(
      party.tabId,
      () => fixture.split(venue, party.tabId, venue.supervisorTill, venue.app, {}),
      { status: 409, code: "bill.unserved_dishes" },
    );
    expect(await creditsOf(saleId)).toEqual([]);
    const reopened = await fixture.split(venue, party.tabId, venue.supervisorTill, venue.app, {
      stopUnserved: true,
    });

    expect(reopened.status, JSON.stringify(reopened.json)).toBe(200);
    expect(await creditsOf(saleId)).toHaveLength(1);
  });

  it("refuses a ticket AEAT refused on a bill where nothing was served for its unserved dishes", async () => {
    const party = await seat("Tarta");
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const saleId = (await invoiceOf(party.tabId)).id;
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));

    const answer = await expectRefused(party.tabId, () => split(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });
    expect(answer.json.params).toMatchObject({ canStop: false });
    expect(await creditsOf(saleId)).toEqual([]);
  });

  it("reopens a ticket another box issued that AEAT has not answered, crediting it at once", async () => {
    const party = await printed("Tarta");
    const saleId = (await invoiceOf(party.tabId)).id;
    await takeOver(venue);
    const app = venue.appWith({});

    const reopened = await split(party.tabId, venue.supervisorTill, app);

    expect(reopened.status, JSON.stringify(reopened.json)).toBe(200);
    expect(await creditsOf(saleId)).toHaveLength(1);
  });

  it("reopens a ticket AEAT accepted", async () => {
    const party = await printed("Tarta");
    const saleId = (await invoiceOf(party.tabId)).id;
    await inTx(venue, (tx) => acceptedByAeat(tx, saleId));

    const answer = await split(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await creditsOf(saleId)).toHaveLength(1);
  });

  it("reopens a ticket AEAT refused once it was replaced, crediting the replacement", async () => {
    const party = await printed("Tarta");
    const saleId = (await invoiceOf(party.tabId)).id;
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const replacementId = await sendReplacement(saleId);

    const answer = await split(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await creditsOf(replacementId)).toHaveLength(1);
  });

  it("refuses a second request, filing one corrective", async () => {
    const party = await printed("Tarta");
    expect((await split(party.tabId)).status).toBe(200);
    const before = written();

    const again = await split(party.tabId);

    expect({ status: again.status, code: again.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
    expect(written()).toEqual(before);
    expect(await creditsOf((await invoiceOf(party.tabId)).id)).toHaveLength(1);
  });

  it("refuses on a box waiting for its time as the cancel does, copying nothing", async () => {
    const party = await printed("Tarta");
    const unserved = await seat("Tarta");
    expect((await printBill(unserved, unserved.tabId, true)).status).toBe(200);
    const waiting = venue.appWith({
      backend: gateSeatOnStartClock(venue.backend, () => true),
      clockUnconfirmed: () => true,
    });
    const cancel = await send(
      waiting,
      venue.supervisorTill,
      "POST",
      `/api/working-orders/${unserved.tabId}/cancel`,
      { reason: "Wrong" },
    );
    expect({ status: cancel.status, code: cancel.json.code }).toEqual({
      status: 409,
      code: "clock.unconfirmed",
    });

    await expectRefused(party.tabId, () => split(party.tabId, venue.supervisorTill, waiting), {
      status: cancel.status,
      code: cancel.json.code as string,
    });
  });

  it("refuses on a box with no corrective series, copying nothing", async () => {
    const party = await printed("Tarta");
    const [live] = await inTx(venue, (tx) =>
      tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, venue.cfg.nodeId),
            eq(invoiceSeries.purpose, "corrective"),
            isNull(invoiceSeries.retiredAt),
          ),
        ),
    );
    await inTx(venue, (tx) =>
      tx.update(invoiceSeries).set({ retiredAt: new Date() }).where(eq(invoiceSeries.id, live!.id)),
    );
    try {
      await expectRefused(party.tabId, () => split(party.tabId, venue.cookie), {
        status: 409,
        code: "series.no_corrective_for_node",
      });
      expect((await billsOf(party.partyId)).map((bill) => bill.status)).toEqual(["placed"]);
    } finally {
      await inTx(venue, (tx) =>
        insertNodeSeriesTx(tx, venue.cfg.nodeId, [
          { code: `R${randomUUID().slice(0, 8)}`, purpose: "corrective" },
        ]),
      );
    }
  });

  it("copies a comped dish with its extra and allergy tick, and the new ticket prints the comp", async () => {
    const party = await seat(
      {
        name: "Steak",
        extras: [{ listId: extraListId, picks: [{ productId: croquettesId, quantity: 1 }] }],
      },
      "Tarta",
    );
    await seedGivenAwayLine(venue, party.tabId, 1);
    const [steak] = await dishesOf(party.tabId);
    const allergy = await inTx(venue, (tx) => readPartyAllergy(tx, party.partyId));
    await inTx(venue, (tx) =>
      setAllergyLineTicks(tx, party.partyId, [
        { guestId: allergy.guests[0]!.id, workingLineId: steak!.id },
      ]),
    );
    expect((await serve(party, party.tabId)).status).toBe(200);
    expect((await printBill(party, party.tabId)).status).toBe(200);
    const first = await send(venue.app, venue.cookie, "GET", `/api/sales/${party.tabId}`);

    const answer = await split(party.tabId);

    expect(answer.status).toBe(200);
    const newBill = answer.json.billId as string;
    const [original, originalExtra] = await dishesOf(party.tabId);
    const [copy, extra] = await dishesOf(newBill);
    const priced = (line: typeof copy) => ({
      name: line!.name,
      productId: line!.productId,
      quantity: line!.quantity,
      unitPriceGross: line!.unitPriceGross,
      listUnitPriceGross: line!.listUnitPriceGross,
      lineTotal: line!.lineTotal,
      optionSnapshots: line!.optionSnapshots,
      unitName: line!.unitName,
    });
    expect(priced(copy)).toEqual(priced(original));
    expect(priced(extra)).toEqual(priced(originalExtra));
    expect(extra!.parentLineId).toBe(copy!.id);
    const reductions = (lineIds: string[]) =>
      inTx(venue, (tx) =>
        tx
          .select({
            adjustmentId: adjustmentLines.adjustmentId,
            reduction: adjustmentLines.reduction,
          })
          .from(adjustmentLines)
          .where(inArray(adjustmentLines.lineId, lineIds))
          .orderBy(adjustmentLines.reduction),
      );
    expect(await reductions([copy!.id, extra!.id])).toEqual(
      await reductions([original!.id, originalExtra!.id]),
    );
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ lineId: allergyLineTicks.workingLineId })
          .from(allergyLineTicks)
          .where(eq(allergyLineTicks.workingLineId, copy!.id)),
      ),
    ).toEqual([{ lineId: copy!.id }]);
    const billOf = async (billId: string) =>
      (
        await inTx(venue, (tx) =>
          tx
            .select({ receiptLocale: workingOrders.receiptLocale, dining: workingOrders.dining })
            .from(workingOrders)
            .where(eq(workingOrders.id, billId)),
        )
      )[0];
    expect(await billOf(newBill)).toEqual(await billOf(party.tabId));

    expect((await printBill(party, newBill)).status).toBe(200);
    const second = await send(venue.app, venue.cookie, "GET", `/api/sales/${newBill}`);
    const shape = (ticket: Answer) => ({
      total: ticket.json.total,
      lines: ticket.json.lines as Record<string, unknown>[],
    });
    expect(shape(first).lines[0]).toMatchObject({ adjustments: [{ kind: "comp" }] });
    expect(shape(second)).toEqual(shape(first));
  });

  it("keeps the bill's receipt language on the new bill", async () => {
    const party = await seat("Tarta");
    const chosen = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}/receipt-language`,
      {
        revision: await revisionOfBill(party.tabId),
        language: "es-ES",
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      },
    );
    expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
    expect((await serve(party, party.tabId)).status).toBe(200);
    expect((await printBill(party, party.tabId)).status).toBe(200);

    const answer = await split(party.tabId);

    expect(answer.status).toBe(200);
    const [bill] = await inTx(venue, (tx) =>
      tx
        .select({ receiptLocale: workingOrders.receiptLocale })
        .from(workingOrders)
        .where(eq(workingOrders.id, answer.json.billId as string)),
    );
    expect(bill).toEqual({ receiptLocale: "es-ES" });
  });

  it("copies a dish taken off service but charged, so the new bill prints without Print anyway", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    const cancelled = await cancelItemHttp(
      venue.db,
      venue.app,
      venue.supervisorTill,
      party.tabId,
      2,
      undefined,
      {
        outcome: "keep_charge",
        preparationStarted: true,
        reasonId: await inTx(venue, cancelReasonId),
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    expect((await serve(party, party.tabId, "Red wine bottle")).status).toBe(200);
    expect((await printBill(party, party.tabId)).status).toBe(200);

    const answer = await split(party.tabId);

    expect(answer.status).toBe(200);
    const newBill = answer.json.billId as string;
    const tarta = (await dishesOf(newBill)).find((line) => line.name === "Tarta")!;
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ quantity: lineServiceCancellations.quantity })
          .from(lineServiceCancellations)
          .where(eq(lineServiceCancellations.lineId, tarta.id)),
      ),
    ).toEqual([{ quantity: 1000 }]);
    const reprinted = await printBill(party, newBill);
    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    expect(reprinted.json.total).toBe("48.00");
  });

  it("counts each dish and comp once in the VAT, category and adjustments reports", async () => {
    const reports = () =>
      inTx(venue, async (tx) => {
        const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
        const day = currentBusinessDay(clock);
        const range = { ...clock, fromBusinessDay: day, toBusinessDay: day };
        const vat = await computeVatSummaryForPeriod(tx, range);
        const categories = await computeCategorySales(tx, { ...range, mode: "at_time_of_sale" });
        const adjustments = await computeAdjustmentReport(tx, range);
        return {
          gross: Number(vat.grossTotal),
          categories: Number(categories.gross),
          comps: adjustments.overall.count,
          reduction: Number(adjustments.overall.reduction),
        };
      });
    const before = await reports();
    const party = await seat("Red wine bottle", "Steak", "Tarta");
    await seedGivenAwayLine(venue, party.tabId, 1);
    expect((await serve(party, party.tabId)).status).toBe(200);
    expect((await printBill(party, party.tabId)).status).toBe(200);
    const answer = await split(party.tabId);
    expect(answer.status).toBe(200);
    const newBill = answer.json.billId as string;
    const third = await moveToNewBill(party, newBill, "Tarta");
    expect((await printBill(party, newBill)).json.total).toBe("25.00");
    expect((await printBill(party, third)).json.total).toBe("18.00");

    const after = await reports();

    expect({
      gross: after.gross - before.gross,
      categories: after.categories - before.categories,
      comps: after.comps - before.comps,
      reduction: after.reduction - before.reduction,
    }).toEqual({ gross: 43, categories: 43, comps: 1, reduction: 30 });
  });

  it("lists each dish once in Current orders", async () => {
    const party = await printed("Red wine bottle", "Tarta");
    const answer = await split(party.tabId);
    expect(answer.status).toBe(200);

    const current = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${party.partyId}/current-orders`,
    );

    expect(current.status).toBe(200);
    const rows = (current.json.groups as { rows: { name: string; workingOrderId: string }[] }[])
      .flatMap((group) => group.rows)
      .map((row) => [row.name, row.workingOrderId]);
    expect(rows).toEqual([
      ["Red wine bottle", answer.json.billId],
      ["Tarta", answer.json.billId],
    ]);
    expect((await billsOf(party.partyId)).map((bill) => bill.status).sort()).toEqual([
      "abandoned",
      "open",
    ]);
  });

  it("lists each dish once in the party's groups", async () => {
    const party = await printed("Red wine bottle", "Tarta");
    const groups = () =>
      send(venue.app, venue.cookie, "GET", `/api/parties/${party.partyId}/groups`).then(
        (answer) => answer.json.groups as { summary: string; lineIds: string[] }[],
      );
    const before = await groups();
    expect(before.map((group) => group.summary)).toEqual(["1 × Red wine bottle, 1 × Tarta"]);

    const answer = await split(party.tabId);

    expect(answer.status).toBe(200);
    const copies = (await dishesOf(answer.json.billId as string)).map((line) => line.id);
    expect(
      (await groups()).map(({ summary, lineIds }) => ({ summary, lineIds: [...lineIds].sort() })),
    ).toEqual([{ summary: "1 × Red wine bottle, 1 × Tarta", lineIds: copies.sort() }]);
  });
});

describe("Nothing was served on a printed table bill", () => {
  it("takes the bill's dishes, and a kitchen-ready one's Ready, out of the party's groups", async () => {
    const party = await seat("Tarta");
    venue.db.run(sql`update ticket_items set state = 'ready' where working_order_line_id in
      (select id from working_order_lines where working_order_id = ${party.tabId})`);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const groups = () =>
      send(venue.app, venue.cookie, "GET", `/api/parties/${party.partyId}/groups`).then((answer) =>
        (answer.json.groups as { lineIds: string[]; ready?: true }[]).map(({ lineIds, ready }) => ({
          lines: lineIds.length,
          ready: ready ?? false,
        })),
      );
    expect(await groups()).toEqual([{ lines: 1, ready: true }]);

    const cancelled = await send(
      venue.app,
      venue.supervisorTill,
      "POST",
      `/api/working-orders/${party.tabId}/cancel`,
      { reason: "Wrong table" },
    );

    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    expect(await groups()).toEqual([{ lines: 0, ready: false }]);
  });
});

describe("the Given free sheet for a printed bill", () => {
  async function freeOn(billId: string) {
    const ids = new Set(
      (
        await inTx(venue, (tx) =>
          tx
            .select({ id: adjustments.id })
            .from(adjustments)
            .where(eq(adjustments.workingOrderId, billId)),
        )
      ).map(({ id }) => id),
    );
    const listed = await inTx(venue, async (tx) => {
      const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
      const day = currentBusinessDay(clock);
      return listFreeItems(tx, clock, {
        year: Number(day.slice(0, 4)),
        period: { kind: "month", month: Number(day.slice(5, 7)) },
      });
    });
    return listed
      .filter((one) => ids.has(one.adjustmentId))
      .map(({ item, quantity, invoice, menuPrice, amountTakenOff }) => ({
        item,
        quantity,
        invoice: invoice === null ? null : `${invoice.seriesCode}/${invoice.number}`,
        menuPrice,
        amountTakenOff,
      }));
  }

  async function removeFrom(billId: string, lineNo: number) {
    const cancelled = await cancelItemHttp(
      venue.db,
      venue.app,
      venue.supervisorTill,
      billId,
      lineNo,
      undefined,
      { outcome: "remove_charge", reasonId: await inTx(venue, cancelReasonId) },
    );
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
  }

  /** A party's printed bill with its wine comped, split after printing; answers the new bill. */
  async function splitWithWineComped(party: Party): Promise<string> {
    await seedGivenAwayLine(venue, party.tabId, 1);
    expect((await serve(party, party.tabId)).status).toBe(200);
    expect((await printBill(party, party.tabId)).status).toBe(200);
    const answer = await split(party.tabId);
    expect(answer.status).toBe(200);
    return answer.json.billId as string;
  }

  it("names the invoice of the bill a comped dish was copied to, not the credited one", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    const newBill = await splitWithWineComped(party);
    const credited = await invoiceOf(party.tabId);
    expect((await printBill(party, newBill)).status).toBe(200);
    const copy = await invoiceOf(newBill);
    expect(copy.invoiceNumber).not.toBe(credited.invoiceNumber);
    const [series] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, copy.seriesId)),
    );
    expect(await freeOn(party.tabId)).toEqual([
      {
        item: "Red wine bottle",
        quantity: "1.000",
        invoice: `${series!.code}/${copy.invoiceNumber}`,
        menuPrice: "30.00",
        amountTakenOff: "30.00",
      },
    ]);
  });

  it("leaves out a comped dish taken off the bill it was copied to", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    const newBill = await splitWithWineComped(party);

    await removeFrom(newBill, 1);

    expect((await dishesOf(newBill)).map((line) => line.name)).toEqual(["Tarta"]);
    expect(await freeOn(party.tabId)).toEqual([]);
  });

  it("leaves out a comped dish on a printed bill that was cancelled", async () => {
    const party = await seat("Red wine bottle", "Tarta");
    await seedGivenAwayLine(venue, party.tabId, 1);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    expect(await freeOn(party.tabId)).toHaveLength(1);

    const cancelled = await send(
      venue.app,
      venue.supervisorTill,
      "POST",
      `/api/working-orders/${party.tabId}/cancel`,
      { reason: "Wrong table" },
    );

    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    expect(await freeOn(party.tabId)).toEqual([]);
  });
});

describe("Reopen bill stopping the dishes that never came", () => {
  const stop = (billId: string) =>
    fixture.split(venue, billId, venue.supervisorTill, venue.app, { stopUnserved: true });

  /** Marks `quantity` of the bill's dish `name` served. */
  async function serveSome(party: Party, name: string, quantity: string) {
    const dish = (await dishesOf(party.tabId)).find(
      (line) => line.parentLineId === null && line.name === name,
    )!;
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/served`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(party.partyId),
        items: [{ lineId: dish.id, quantity }],
      },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  }

  function kitchenNotices(billId: string) {
    return venue.db.all<{ kind: string; lineName: string; quantity: number }>(sql`
      select kind, line_name as lineName, quantity from kitchen_notices
      where working_order_id = ${billId} and kind = 'void' order by rowid`);
  }

  function keptCharges(lineIds: string[]) {
    return inTx(venue, (tx) =>
      tx
        .select({
          lineId: lineServiceCancellations.lineId,
          quantity: lineServiceCancellations.quantity,
        })
        .from(lineServiceCancellations)
        .where(inArray(lineServiceCancellations.lineId, lineIds)),
    );
  }

  /** What every kitchen screen shows of the bill. */
  async function onKitchenScreens(billId: string) {
    const shown: unknown[] = [];
    for (const { id } of venue.db.all<{ id: string }>(sql`select id from kitchen_stations`)) {
      const queue = await send(venue.app, venue.cookie, "GET", `/api/stations/${id}/queue`);
      expect(queue.status, JSON.stringify(queue.json)).toBe(200);
      for (const group of queue.json.items as { orderId: string; items: unknown[] }[])
        if (group.orderId === billId) shown.push(...group.items);
    }
    return shown;
  }

  /** The lines of the party's groups, as the till's course list reads them. */
  async function groupedLines(party: Party) {
    const answer = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${party.partyId}/groups`,
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    return (answer.json.groups as { lineIds: string[] }[]).flatMap(({ lineIds }) => lineIds);
  }

  /** Steak never came, the beer was served, and the bill printed anyway. */
  async function steakAndBeer(): Promise<Party> {
    const party = await seat("Steak", "Small beer");
    await serveSome(party, "Small beer", "1");
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    return party;
  }

  it("refuses without the flag, saying the dishes can be stopped", async () => {
    const party = await steakAndBeer();
    const steak = (await dishesOf(party.tabId)).find((line) => line.name === "Steak")!;

    const refused = await expectRefused(party.tabId, () => split(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });

    expect(refused.json.params).toEqual({
      workingOrderId: party.tabId,
      dishes: [{ lineId: steak.id, dishName: "Steak", quantity: "1.000", released: true }],
      canStop: true,
    });
  });

  it("credits the receipt, stops the steak in the kitchen and leaves only the beer to charge", async () => {
    const party = await steakAndBeer();
    const original = await invoiceOf(party.tabId);
    const before = kitchenNotices(party.tabId);
    expect(await onKitchenScreens(party.tabId)).toHaveLength(1);

    const answer = await stop(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const credits = await creditsOf(original.id);
    expect(credits.map((credit) => credit.total)).toEqual([-original.total]);
    expect(kitchenNotices(party.tabId).slice(before.length)).toEqual([
      { kind: "void", lineName: "CHULETA", quantity: 1000 },
    ]);
    expect(await onKitchenScreens(party.tabId)).toEqual([]);
    const newBill = answer.json.billId as string;
    const [{ billNumber }] = venue.db.all<{ billNumber: number }>(
      sql`select bill_number as billNumber from working_orders where id = ${newBill}`,
    );
    expect(
      venue.db.all(sql`select reason from order_amendments where working_order_id = ${party.tabId}
        and kind = 'order_cancelled'`),
    ).toEqual([
      { reason: `Bill split after printing to bill ${billNumber}; dishes not served were stopped` },
    ]);
    const copies = await dishesOf(newBill);
    expect(copies.map((line) => [line.name, line.quantity])).toEqual([["Small beer", 1000]]);
    expect(await keptCharges(copies.map((line) => line.id))).toEqual([]);
    const reprinted = await printBill(party, newBill);
    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    expect(reprinted.json.total).toBe("3.00");
  });

  it("takes off the unserved portion of a dish and its extras, keeping the served one", async () => {
    const party = await seat(
      {
        name: "Steak",
        quantity: "2",
        extras: [{ listId: extraListId, picks: [{ productId: croquettesId, quantity: 1 }] }],
      },
      "Small beer",
    );
    await serveSome(party, "Steak", "1");
    expect((await printBill(party, party.tabId, true)).status).toBe(200);

    const answer = await stop(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const copies = await dishesOf(answer.json.billId as string);
    expect(copies.map((line) => [line.name, line.quantity, line.servedQuantity])).toEqual([
      ["Steak", 1000, 1000],
      ["Croquettes", 1000, 1000],
    ]);
    expect(kitchenNotices(party.tabId)).toEqual([
      { kind: "void", lineName: "CHULETA", quantity: 1000 },
      { kind: "void", lineName: "BEER SMALL", quantity: 1000 },
    ]);
  });

  it("refuses the flag on a bill handed over at the counter before it was moved to the table", async () => {
    const party = await steakAndBeer();
    venue.db.run(
      sql`update working_orders set collected_at = ${new Date().toISOString()} where id = ${party.tabId}`,
    );

    const refused = await expectRefused(party.tabId, () => stop(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });

    expect(refused.json.params).toMatchObject({ canStop: false });
  });

  it("refuses the flag when nothing was served, as Reopen does today", async () => {
    const party = await seat("Steak");
    expect((await printBill(party, party.tabId, true)).status).toBe(200);

    const refused = await expectRefused(party.tabId, () => stop(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });

    expect(refused.json.params).toMatchObject({ canStop: false });
  });

  it("stops the dishes when only a charge was kept", async () => {
    const party = await seat("Tarta", "Steak");
    const cancelled = await cancelItemHttp(
      venue.db,
      venue.app,
      venue.supervisorTill,
      party.tabId,
      1,
      undefined,
      {
        outcome: "keep_charge",
        preparationStarted: true,
        reasonId: await inTx(venue, cancelReasonId),
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const refused = await split(party.tabId);
    expect(refused.json).toMatchObject({ code: "bill.unserved_dishes", params: { canStop: true } });

    const answer = await stop(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const copies = await dishesOf(answer.json.billId as string);
    expect(copies.map((line) => line.name)).toEqual(["Tarta"]);
    expect(await keptCharges(copies.map((line) => line.id))).toEqual([
      { lineId: copies[0]!.id, quantity: 1000 },
    ]);
  });

  it("stops a held dish, which never reached the kitchen", async () => {
    const party = await seatWith("hold", "Steak");
    const moved = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(party.partyId),
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Small beer"), quantity: "1" }], release: "fire" },
        ],
      },
    );
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    await serveSome(party, "Small beer", "1");
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const refused = await split(party.tabId);
    expect(refused.json.params).toMatchObject({
      dishes: [expect.objectContaining({ dishName: "Steak", released: false })],
      canStop: true,
    });
    const steak = (await dishesOf(party.tabId)).find((line) => line.name === "Steak")!;
    expect(await groupedLines(party)).toContain(steak.id);

    const answer = await stop(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const copies = await dishesOf(answer.json.billId as string);
    expect(copies.map((line) => line.name)).toEqual(["Small beer"]);
    expect(kitchenNotices(party.tabId)).toEqual([
      { kind: "void", lineName: "CHULETA", quantity: 1000 },
    ]);
    expect(await groupedLines(party)).toEqual([copies[0]!.id]);
  });

  it("stops a dish the kitchen started but keeps its charge on the reopened bill", async () => {
    const party = await seat("Steak", "Tarta", "Small beer");
    await serveSome(party, "Small beer", "1");
    venue.db.run(sql`update ticket_items set state = 'ready' where working_order_line_id in
      (select id from working_order_lines where working_order_id = ${party.tabId} and name = 'Steak')`);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const notices = () =>
      venue.db.all<{ lineName: string; quantity: number; wasStarted: number }>(sql`
        select line_name as lineName, quantity, was_started as wasStarted from kitchen_notices
        where working_order_id = ${party.tabId} and kind = 'void' order by rowid`);
    const before = notices();

    const answer = await stop(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(notices().slice(before.length)).toEqual([
      { lineName: "CHULETA", quantity: 1000, wasStarted: 1 },
      { lineName: "TARTA", quantity: 1000, wasStarted: 0 },
    ]);
    const newBill = answer.json.billId as string;
    const copies = await dishesOf(newBill);
    expect(copies.map((line) => [line.name, line.quantity, line.servedQuantity])).toEqual([
      ["Steak", 1000, 0],
      ["Small beer", 1000, 1000],
    ]);
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({
            lineId: lineServiceCancellations.lineId,
            quantity: lineServiceCancellations.quantity,
            wasStarted: lineServiceCancellations.wasStarted,
          })
          .from(lineServiceCancellations)
          .where(
            inArray(
              lineServiceCancellations.lineId,
              copies.map((line) => line.id),
            ),
          ),
      ),
    ).toEqual([{ lineId: copies[0]!.id, quantity: 1000, wasStarted: true }]);
    const reprinted = await printBill(party, newBill);
    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    expect(reprinted.json.total).toBe("28.00");
  });

  /**
   * Croquettes routed to a new Fryer station that prints held work and waits for the pass, and a
   * party whose steak with a croquette extra, and a beer, fire as one group: the steak and beer
   * reach the kitchen while the croquettes wait at the Fryer, held. The beer is served. With
   * `croquettesHeld: false` the Fryer does not wait for the pass, so the croquettes are sent too.
   */
  async function steakFiredCroquettesHeld(
    run: (party: Party, slips: () => Promise<(string | undefined)[]>) => Promise<void>,
    { steaks = "1", croquettesHeld = true }: { steaks?: string; croquettesHeld?: boolean } = {},
  ) {
    const fryer = await inTx(venue, async (tx) => {
      const stationId = (await createStation(tx, { name: `Fryer ${randomUUID()}` })).id;
      const printer = await createPrinter(tx, {
        name: `Fryer ${randomUUID()}`,
        transport: "cloud_poll",
        pollId: randomUUID(),
      });
      await attachPrinterToStation(tx, { stationId, printerId: printer.id });
      const cell = { row: { kind: "product" as const, productId: croquettesId }, zoneId: null };
      await setRoutingCell(tx, cell, { kind: "station", stationId });
      await setStationPrinting(tx, { printHeldWork: true }, [stationId]);
      return { stationId, printerId: printer.id, cell };
    });
    const slips = async () =>
      (
        await inTx(venue, (tx) =>
          tx
            .select({ payload: printJobs.payload })
            .from(printJobs)
            .where(eq(printJobs.printerId, fryer.printerId))
            .orderBy(sql`rowid`),
        )
      ).map((job) => printedLines(job.payload)[0]);
    try {
      const party = await seatWith(
        "hold",
        {
          name: "Steak",
          quantity: steaks,
          extras: [{ listId: extraListId, picks: [{ productId: croquettesId, quantity: 1 }] }],
        },
        "Small beer",
      );
      const words = kitchenTicketWords("es");
      expect(await slips()).toEqual([`*** ${words.hold} ***`]);
      const [steak] = await dishesOf(party.tabId);
      await inTx(venue, async (tx) => {
        if (croquettesHeld) await setStationsWaitForPass(tx, true, [fryer.stationId]);
        await fireGroup(tx, venue.cfg, party.partyId, steak!.groupId!, {
          submissionId: randomUUID(),
          expectedPartyRevision: revisionOf(party.partyId),
          operatorId: venue.operatorId,
        });
      });
      const kitchen = venue.db.all<{ name: string; fired: number; requested: number }>(sql`
        select l.name, t.fired_at is not null as fired, t.requested_at is not null as requested
        from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
        where l.working_order_id = ${party.tabId} order by l.line_no`);
      expect(kitchen).toEqual([
        ...Array.from({ length: Number(steaks) }, () => [
          { name: "Steak", fired: 1, requested: 1 },
          { name: "Croquettes", fired: croquettesHeld ? 0 : 1, requested: 1 },
        ]).flat(),
        { name: "Small beer", fired: 1, requested: 1 },
      ]);
      await serveSome(party, "Small beer", "1");
      await run(party, slips);
    } finally {
      await inTx(venue, async (tx) => {
        await clearRoutingCell(tx, fryer.cell);
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, fryer.stationId));
      });
    }
  }

  it("cancels a held extra at a station waiting for the pass, and voids its fired dish, once each", async () => {
    await steakFiredCroquettesHeld(async (party, slips) => {
      const words = kitchenTicketWords("es");
      expect((await printBill(party, party.tabId, true)).status).toBe(200);
      const before = kitchenNotices(party.tabId).length;

      const answer = await stop(party.tabId);

      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(kitchenNotices(party.tabId).slice(before)).toEqual([
        { kind: "void", lineName: "CROQ", quantity: 1000 },
        { kind: "void", lineName: "CHULETA", quantity: 1000 },
      ]);
      expect(await slips()).toEqual([`*** ${words.hold} ***`, `*** ${words.holdCancelled} ***`]);
      const copies = await dishesOf(answer.json.billId as string);
      expect(copies.map((line) => line.name)).toEqual(["Small beer"]);
    });
  });

  it("keeps a started dish's charge but takes off its extra the kitchen was told not to make", async () => {
    await steakFiredCroquettesHeld(async (party, slips) => {
      const words = kitchenTicketWords("es");
      venue.db.run(sql`update ticket_items set state = 'preparing' where working_order_line_id in
        (select id from working_order_lines where working_order_id = ${party.tabId} and name = 'Steak')`);
      const printedBill = await printBill(party, party.tabId, true);
      expect(printedBill.status).toBe(200);
      expect(printedBill.json.total).toBe("29.00");
      const before = kitchenNotices(party.tabId).length;

      const answer = await stop(party.tabId);

      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(kitchenNotices(party.tabId).slice(before)).toEqual([
        { kind: "void", lineName: "CROQ", quantity: 1000 },
        { kind: "void", lineName: "CHULETA", quantity: 1000 },
      ]);
      expect(await slips()).toEqual([`*** ${words.hold} ***`, `*** ${words.holdCancelled} ***`]);
      const newBill = answer.json.billId as string;
      const reprinted = await printBill(party, newBill);
      expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
      expect(reprinted.json.total).toBe("28.00");
      const copies = await dishesOf(newBill);
      expect(copies.map((line) => [line.name, line.quantity])).toEqual([
        ["Steak", 1000],
        ["Small beer", 1000],
      ]);
      expect(await keptCharges(copies.map((line) => line.id))).toEqual([
        { lineId: copies[0]!.id, quantity: 1000 },
      ]);
    });
  });

  it("keeps a started dish's charge but takes off its extra sent to the kitchen and not started", async () => {
    await steakFiredCroquettesHeld(
      async (party) => {
        venue.db.run(sql`update ticket_items set state = 'preparing' where working_order_line_id in
          (select id from working_order_lines where working_order_id = ${party.tabId} and name = 'Steak')`);
        expect((await printBill(party, party.tabId, true)).status).toBe(200);
        const notices = () =>
          venue.db.all<{ lineName: string; quantity: number; wasStarted: number }>(sql`
            select line_name as lineName, quantity, was_started as wasStarted from kitchen_notices
            where working_order_id = ${party.tabId} and kind = 'void' order by rowid`);
        const before = notices().length;

        const answer = await stop(party.tabId);

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(notices().slice(before)).toEqual([
          { lineName: "CHULETA", quantity: 1000, wasStarted: 1 },
          { lineName: "CROQ", quantity: 1000, wasStarted: 0 },
        ]);
        const newBill = answer.json.billId as string;
        const copies = await dishesOf(newBill);
        expect(copies.map((line) => line.name)).toEqual(["Steak", "Small beer"]);
        const reprinted = await printBill(party, newBill);
        expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
        expect(reprinted.json.total).toBe("28.00");
      },
      { croquettesHeld: false },
    );
  });

  it("takes off the extra of a started portion left unserved, keeping its served portion's", async () => {
    await steakFiredCroquettesHeld(
      async (party) => {
        const [, , stopped] = await dishesOf(party.tabId);
        await serveSome(party, "Steak", "1");
        venue.db.run(sql`update ticket_items set state = 'preparing'
        where working_order_line_id = ${stopped!.id}`);
        expect((await printBill(party, party.tabId, true)).status).toBe(200);

        const answer = await stop(party.tabId);

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        const newBill = answer.json.billId as string;
        const copies = await dishesOf(newBill);
        expect(copies.map((line) => [line.name, line.servedQuantity])).toEqual([
          ["Steak", 1000],
          ["Croquettes", 1000],
          ["Steak", 0],
          ["Small beer", 1000],
        ]);
        expect(await keptCharges(copies.map((line) => line.id))).toEqual([
          { lineId: copies[2]!.id, quantity: 1000 },
        ]);
        const reprinted = await printBill(party, newBill);
        expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
        expect(reprinted.json.total).toBe("54.00");
      },
      { steaks: "2" },
    );
  });

  it("a started dish's kept charge comes off the reopened bill with a Comp and its reason", async () => {
    const party = await seat("Steak", "Small beer");
    await serveSome(party, "Small beer", "1");
    venue.db.run(sql`update ticket_items set state = 'ready' where working_order_line_id in
      (select id from working_order_lines where working_order_id = ${party.tabId} and name = 'Steak')`);
    expect((await printBill(party, party.tabId, true)).status).toBe(200);
    const answer = await stop(party.tabId);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const newBill = answer.json.billId as string;
    const [steak] = await dishesOf(newBill);
    expect(steak).toMatchObject({ name: "Steak", lineNo: 1, lineTotal: 2500 });
    const reasonId = await inTx(venue, (tx) => reasonIdOf(tx, GIVE_AWAY_REASON));

    const comped = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${newBill}/adjustments`,
      { ...(await cancelBody(venue.db, newBill, 1)), action: "comp", reasonId },
    );

    expect(comped.status, JSON.stringify(comped.json)).toBe(200);
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ reduction: adjustmentLines.reduction, reasonId: adjustments.reasonId })
          .from(adjustmentLines)
          .innerJoin(adjustments, eq(adjustments.id, adjustmentLines.adjustmentId))
          .where(eq(adjustmentLines.lineId, steak!.id)),
      ),
    ).toEqual([{ reduction: 2500, reasonId }]);
    const reprinted = await printBill(party, newBill);
    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    expect(reprinted.json.total).toBe("3.00");
  });

  it("does not stop the dishes on a bill already part-paid, writing nothing", async () => {
    // 10.00 paid of 28.00: without the steak the bill would owe 3.00, less than it has received.
    const party = await steakAndBeer();
    const paymentId = await fixture.payInCash(venue, party.tabId, "10.00");
    const kitchen = () =>
      venue.db.all(sql`select
        (select count(*) from kitchen_notices) as notices,
        (select count(*) from line_service_cancellations) as stops,
        (select count(*) from ticket_items) as tickets`)[0];
    const before = kitchen();
    const unflagged = await split(party.tabId);
    expect(unflagged.json).toMatchObject({
      code: "bill.unserved_dishes",
      params: { canStop: false },
    });

    const refused = await expectRefused(party.tabId, () => stop(party.tabId), {
      status: 409,
      code: "bill.unserved_dishes",
    });

    expect(refused.json.params).toMatchObject({ canStop: false });
    expect(kitchen()).toEqual(before);
    expect(await paymentRows(venue, party.tabId)).toEqual([
      expect.objectContaining({ id: paymentId, state: "received" }),
    ]);
  });

  it("refuses a flag that is neither true nor false", async () => {
    const party = await steakAndBeer();
    for (const stopUnserved of ["yes", null, 1]) {
      const refused = await expectRefused(
        party.tabId,
        () => fixture.split(venue, party.tabId, venue.supervisorTill, venue.app, { stopUnserved }),
        { status: 400, code: "management.request_invalid" },
      );
      expect(refused.json.params).toEqual({ field: "stopUnserved" });
    }
  });

  it("takes stopUnserved false as an ordinary Reopen", async () => {
    const party = await steakAndBeer();

    const refused = await expectRefused(
      party.tabId,
      () =>
        fixture.split(venue, party.tabId, venue.supervisorTill, venue.app, {
          stopUnserved: false,
        }),
      { status: 409, code: "bill.unserved_dishes" },
    );

    expect(refused.json.params).toMatchObject({ canStop: true });
  });

  it("refuses a body that is not an object before writing anything", async () => {
    const party = await printed("Small beer");
    for (const body of [true, "stop", 1, [{ stopUnserved: true }]]) {
      const refused = await expectRefused(
        party.tabId,
        () =>
          send(
            venue.app,
            venue.supervisorTill,
            "POST",
            `/api/working-orders/${party.tabId}/split-after-print`,
            body,
          ),
        { status: 400, code: "management.request_invalid" },
      );
      expect(refused.json.params).toEqual({ field: "body" });
    }
    const absent = await send(
      venue.app,
      venue.supervisorTill,
      "POST",
      `/api/working-orders/${party.tabId}/split-after-print`,
    );
    expect(absent.status, JSON.stringify(absent.json)).toBe(200);
  });
});

describe("servedOrCharged", () => {
  it("leaves out the rows an unpaid departure wrote for the dishes it stopped", async () => {
    const party = await departed(venue, "Tarta");
    const [tarta] = await dishesOf(party.tabId);
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ quantity: lineServiceCancellations.quantity })
          .from(lineServiceCancellations)
          .where(eq(lineServiceCancellations.lineId, tarta!.id)),
      ),
    ).toEqual([{ quantity: 1000 }]);

    expect(await inTx(venue, (tx) => servedOrCharged(tx, party.tabId))).toEqual([]);
  });

  it("leaves out a departure's row written at its very time, and counts one kept before it", async () => {
    const party = await departed(venue, "Tarta");
    const [tarta] = await dishesOf(party.tabId);
    const keptAt = (at: SQL) =>
      venue.db.run(
        sql`update line_service_cancellations set cancelled_at = ${at} where line_id = ${tarta!.id}`,
      );

    keptAt(
      sql`(select recorded_at from unpaid_departures where working_order_id = ${party.tabId})`,
    );
    expect(await inTx(venue, (tx) => servedOrCharged(tx, party.tabId))).toEqual([]);
    keptAt(sql`${"2000-01-01T00:00:00.000Z"}`);
    expect(await inTx(venue, (tx) => servedOrCharged(tx, party.tabId))).toEqual([
      { lineId: tarta!.id, dishName: "Tarta", quantity: "1.000" },
    ]);
  });

  it("names a served row and a kept charge", async () => {
    const party = await seat("Tarta", "Small beer");
    const cancelled = await cancelItemHttp(
      venue.db,
      venue.app,
      venue.supervisorTill,
      party.tabId,
      1,
      undefined,
      {
        outcome: "keep_charge",
        preparationStarted: true,
        reasonId: await inTx(venue, cancelReasonId),
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    await serve(party, party.tabId, "Small beer");
    const [tarta, beer] = await dishesOf(party.tabId);

    expect(await inTx(venue, (tx) => servedOrCharged(tx, party.tabId))).toEqual([
      { lineId: tarta!.id, dishName: "Tarta", quantity: "1.000" },
      { lineId: beer!.id, dishName: "Small beer", quantity: "1.000" },
    ]);
  });
});
