import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  adjustmentLines,
  allergyLineTicks,
  billPayments,
  insertNodeSeriesTx,
  invoiceSeries,
  lineServiceCancellations,
  printJobs,
  sales,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { computeAdjustmentReport } from "@waitron/adjustments";
import { createExtraList, writeProductModifiers } from "@waitron/menu";
import {
  computeCategorySales,
  computeVatSummaryForPeriod,
  currentBusinessDay,
  resolveVenueClock,
} from "@waitron/reporting";
import { thousandthsToDecimal } from "@waitron/shared";
import {
  filedKindsBySale,
  invoiceRecords,
} from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { readPartyAllergy, setAllergyLineTicks, writePartyAllergy } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { copyBillDishes } from "./split-after-print.js";
import { cancelItemHttp, cancelReasonId, seedGivenAwayLine } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { createTable } from "./testing/live-table.js";
import {
  inTx,
  placedCounterBillMovedTo,
  send,
  statusOf,
  type Answer,
} from "./testing/bill-venue.js";
import {
  departed,
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
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
      await offerProducts(tx, venue.cfg, { zone: "tables" });
    });
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
  },
});

type Party = { partyId: string; tabId: string; tableId: string };
type Line = { name: string; extras?: unknown[] };

async function revisionOfBill(billId: string): Promise<number> {
  const [bill] = await inTx(venue, (tx) =>
    tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return bill!.revision;
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

/** A party seated at a fresh table with one guest, its dishes sent to the kitchen as one group. */
async function seat(...lines: (string | Line)[]): Promise<Party> {
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `S-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
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
            const { name, extras } = typeof line === "string" ? { name: line } : line;
            return {
              menuItemId: venue.offerFor(name),
              quantity: "1",
              ...(extras === undefined ? {} : { extras }),
            };
          }),
          release: "fire",
        },
      ],
    },
  );
  expect(ordered.status, JSON.stringify(ordered.json)).toBe(200);
  return party;
}

function dishesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
}

async function serve(party: Party, billId: string, ...names: string[]): Promise<Answer> {
  const dishes = (await dishesOf(billId)).filter(
    (line) => line.parentLineId === null && (names.length === 0 || names.includes(line.name)),
  );
  return send(venue.app, venue.cookie, "POST", `/api/parties/${party.partyId}/served`, {
    submissionId: randomUUID(),
    expectedPartyRevision: revisionOf(party.partyId),
    items: dishes.map((line) => ({
      lineId: line.id,
      quantity: thousandthsToDecimal(line.quantity),
    })),
  });
}

/** Print the bill on the first till, which has a receipt printer. */
async function printBill(party: Party, billId: string, printAnyway = false): Promise<Answer> {
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, billId),
  );
  return send(venue.app, venue.cookie, "POST", `/api/parties/${party.partyId}/end-meal`, {
    billId,
    expectedPartyRevision: revisionOf(party.partyId),
    expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
    submissionId: randomUUID(),
    ...(printAnyway ? { printAnyway: true } : {}),
  });
}

function split(billId: string, cookie = venue.supervisorTill, app = venue.app): Promise<Answer> {
  return send(app, cookie, "POST", `/api/working-orders/${billId}/split-after-print`, {});
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

function creditsOf(saleId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.correctsSaleId, saleId)));
}

async function invoiceOf(billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!;
}

function billsOf(partyId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: workingOrders.id, status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId)),
  );
}

/** Everything a split would write: the credit note and its record, and the copied bill and dishes. */
function written() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from ${invoiceRecords}) as records,
      (select count(*) from working_orders) as bills,
      (select count(*) from working_order_lines) as lines,
      (select count(*) from order_amendments) as amendments,
      (select group_concat(id || ':' || next_number, ',') from invoice_series) as series
  `)[0];
}

async function expectRefused(
  billId: string,
  answer: () => Promise<Answer>,
  refusal: { status: number; code: string },
): Promise<Answer> {
  const before = written();
  const answered = await answer();
  expect({ status: answered.status, code: answered.json.code }).toEqual(refusal);
  expect(written()).toEqual(before);
  expect(await statusOf(venue, billId)).toBe("placed");
  return answered;
}

/** Served dishes, printed: the bill holds its ticket and nothing is left to serve. */
async function printed(...lines: (string | Line)[]): Promise<Party> {
  const party = await seat(...lines);
  expect((await serve(party, party.tabId)).status).toBe(200);
  const answer = await printBill(party, party.tabId);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return party;
}

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
      creditNoteNumber: `R/${credits[0]!.invoiceNumber}`,
    });
    const newBill = answer.json.billId as string;
    expect(await filedKindsBySale(venue.db, [credits[0]!.id])).toEqual(
      new Map([[credits[0]!.id, "R5"]]),
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
    });
    expect((await serve(party, party.tabId, "Tarta")).status).toBe(200);
    expect((await split(party.tabId)).status).toBe(200);
  });

  it("needs sale.rectify, and names unserved dishes first", async () => {
    const party = await printed("Tarta");
    await expectRefused(party.tabId, () => split(party.tabId, venue.cookie), {
      status: 403,
      code: "authorization.not_permitted",
    });

    const unserved = await seat("Tarta");
    expect((await printBill(unserved, unserved.tabId, true)).status).toBe(200);
    await expectRefused(unserved.tabId, () => split(unserved.tabId, venue.cookie), {
      status: 409,
      code: "bill.unserved_dishes",
    });
  });

  it("refuses a part-paid bill before its unserved dishes", async () => {
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

    await expectRefused(party.tabId, () => split(party.tabId), {
      status: 409,
      code: "bill.payments_received",
    });
  });

  it("refuses a full invoice naming a customer before its unserved dishes or the permission", async () => {
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

  it("refuses a second request, filing one credit note", async () => {
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
    const waiting = venue.appWith({
      backend: gateSeatOnStartClock(venue.backend, () => true),
      clockUnconfirmed: () => true,
    });
    const cancel = await send(
      waiting,
      venue.supervisorTill,
      "POST",
      `/api/working-orders/${party.tabId}/cancel`,
      { reason: "Wrong" },
    );
    expect(cancel.status).not.toBe(200);

    await expectRefused(party.tabId, () => split(party.tabId, venue.supervisorTill, waiting), {
      status: cancel.status,
      code: cancel.json.code as string,
    });
  });

  it("refuses an operator without sale.rectify before looking for a rectificative series", async () => {
    const party = await printed("Tarta");
    const [live] = await inTx(venue, (tx) =>
      tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, venue.cfg.nodeId),
            eq(invoiceSeries.purpose, "rectificative"),
            isNull(invoiceSeries.retiredAt),
          ),
        ),
    );
    await inTx(venue, (tx) =>
      tx.update(invoiceSeries).set({ retiredAt: new Date() }).where(eq(invoiceSeries.id, live!.id)),
    );
    try {
      await expectRefused(party.tabId, () => split(party.tabId, venue.cookie), {
        status: 403,
        code: "authorization.not_permitted",
      });
    } finally {
      await inTx(venue, (tx) =>
        insertNodeSeriesTx(tx, venue.cfg.nodeId, [
          { code: `R${randomUUID().slice(0, 8)}`, purpose: "rectificative" },
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
      vatClass: line!.vatClass,
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
});

describe("copyBillDishes", () => {
  it("throws on a set-menu line, which no printed bill holds", async () => {
    const from = await parked(venue, "Tarta");
    const to = await parked(venue, "Croquettes");

    const copied = inTx(venue, async (tx) => {
      await tx.run(sql`pragma defer_foreign_keys = on`);
      const [line] = await tx
        .select()
        .from(workingOrderLines)
        .where(
          and(eq(workingOrderLines.workingOrderId, from), isNull(workingOrderLines.parentLineId)),
        );
      await tx.insert(workingOrderLines).values({
        ...line!,
        id: randomUUID(),
        lineNo: 2,
        productId: null,
        menuItemId: null,
        menuId: null,
        menuName: null,
        offerDepartmentId: null,
        departmentName: null,
        unitId: null,
        soldInEach: null,
        offerUnitName: null,
        offerUnitPrecision: null,
        offerVatClass: null,
        offerCategoryName: null,
        courseId: null,
        groupId: null,
        cohortId: null,
        cohortOrdinal: null,
        wholePortion: null,
        setMenuRole: "set_menu",
        setMenuId: randomUUID(),
        setMenuVersionId: randomUUID(),
      });
      return copyBillDishes(tx, from, to);
    });

    await expect(copied).rejects.toThrow(/set-menu/);
    expect(await dishesOf(to)).toHaveLength(1);
  });
});
