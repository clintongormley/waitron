import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { devices, printJobs, sales, taxpayer, workingOrders, workingOrderLines } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import { thousandthsToDecimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
import { markServed } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
/** The operator on a till allowed every action, printing on `firstPrinter`. */
let firstCookie: string;
let firstPrinter: string;
/** The operator on a second such till, printing on `secondPrinter`. */
let secondCookie: string;
let secondPrinter: string;
/** The operator on a till allowed every action, with no receipt printer at all. */
let noPrinterCookie: string;

async function printingTill(db: BillVenue["db"], printerName: string | null) {
  const deviceId = await seedSessionDevice(db);
  let printerId: string | null = null;
  if (printerName !== null) {
    printerId = (
      await inTx(venue, (tx) =>
        createPrinter(tx, {
          name: printerName,
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
          hasCashDrawer: false,
        }),
      )
    ).id;
    await db.update(devices).set({ receiptPrinterId: printerId }).where(eq(devices.id, deviceId));
  }
  const session = await inTx(venue, (tx) =>
    loginWithPin(tx, { deviceId, personId: venue.operatorId, pin: "5555" }),
  );
  return { cookie: await sessionCookieForTest(db, session.token), printerId };
}

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    const first = await printingTill(db, "First receipt printer");
    const second = await printingTill(db, "Second receipt printer");
    firstCookie = first.cookie;
    firstPrinter = first.printerId!;
    secondCookie = second.cookie;
    secondPrinter = second.printerId!;
    noPrinterCookie = (await printingTill(db, null)).cookie;
  },
});

type Party = Awaited<ReturnType<typeof seatedWith>>;

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

async function body(party: Party, extra: Record<string, unknown> = {}) {
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, party.tabId),
  );
  return {
    billId: party.tabId,
    expectedPartyRevision: revisionOf(party.partyId),
    expectedEdits: [{ billId: party.tabId, editorVersion, draftId, draftRevision }],
    submissionId: randomUUID(),
    ...extra,
  };
}

async function printBill(cookie: string, party: Party, extra: Record<string, unknown> = {}) {
  return send(
    venue.app,
    cookie,
    "POST",
    `/api/parties/${party.partyId}/end-meal`,
    await body(party, extra),
  );
}

async function serveAll(party: Party) {
  const lines = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, party.tabId)),
  );
  await inTx(venue, (tx) =>
    markServed(
      tx,
      venue.cfg,
      party.partyId,
      lines.map((line) => ({ lineId: line.id, quantity: thousandthsToDecimal(line.quantity) })),
      {
        operatorId: venue.operatorId,
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(party.partyId),
      },
    ),
  );
}

async function served(...names: string[]) {
  const party = await seatedWith(venue, ...names);
  await serveAll(party);
  return party;
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
}

function jobsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ printerId: printJobs.printerId, copy: printJobs.receiptCopy })
      .from(printJobs)
      .where(eq(printJobs.saleId, saleId)),
  );
}

/** The bill is still open, with no invoice, and the party's revision is where it was. */
async function nothingIssued(party: Party, revision: number) {
  expect(await salesOf(party.tabId)).toEqual([]);
  expect(await statusOf(venue, party.tabId)).toBe("open");
  expect(revisionOf(party.partyId)).toBe(revision);
}

describe("POST /api/parties/:id/end-meal", () => {
  it("issues the bill's ticket and prints it on the requesting till's receipt printer", async () => {
    const party = await served("Red wine bottle");

    const answer = await printBill(secondCookie, party);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const [sale] = await salesOf(party.tabId);
    expect(answer.json).toEqual({
      revision: revisionOf(party.partyId),
      workingOrderId: party.tabId,
      saleId: sale!.id,
      invoiceNumber: expect.any(String),
      total: expect.stringMatching(/^\d+\.\d{2}$/),
      owed: answer.json.total,
    });
    expect(await jobsOf(sale!.id)).toEqual([{ printerId: secondPrinter, copy: false }]);
    expect(secondPrinter).not.toBe(firstPrinter);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
  });

  it("answers a resend with the same submission id as it answered the first", async () => {
    const party = await served("Red wine bottle");
    const request = await body(party);
    const path = `/api/parties/${party.partyId}/end-meal`;

    const first = await send(venue.app, firstCookie, "POST", path, request);
    const second = await send(venue.app, firstCookie, "POST", path, request);

    expect(first.status).toBe(200);
    expect(second).toEqual(first);
    expect(await jobsOf(first.json.saleId as string)).toHaveLength(1);
  });

  it("refuses a second Print the bill on the same bill as 409 meal_end.already_issued", async () => {
    const party = await served("Red wine bottle");
    expect((await printBill(firstCookie, party)).status).toBe(200);

    const again = await printBill(firstCookie, party);

    expect(again).toEqual({
      status: 409,
      json: { code: "meal_end.already_issued", params: { workingOrderId: party.tabId } },
    });
    expect(await salesOf(party.tabId)).toHaveLength(1);
  });

  it("refuses a dish not marked served as 409 meal_end.unserved_dishes, and prints when told to print anyway", async () => {
    const party = await seatedWith(venue, "Tarta");
    const [tarta] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const revision = revisionOf(party.partyId);

    const warned = await printBill(firstCookie, party);

    expect(warned).toEqual({
      status: 409,
      json: {
        code: "meal_end.unserved_dishes",
        params: {
          workingOrderId: party.tabId,
          dishes: [{ lineId: tarta!.id, dishName: "Tarta", quantity: "1.000", released: true }],
        },
      },
    });
    await nothingIssued(party, revision);

    const printed = await printBill(firstCookie, party, { printAnyway: true });

    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    expect(await salesOf(party.tabId)).toHaveLength(1);
  });

  it("refuses a till whose receipts go to no printer as 409 meal_end.no_printer", async () => {
    const party = await served("Red wine bottle");
    const revision = revisionOf(party.partyId);

    expect(await printBill(noPrinterCookie, party)).toEqual({
      status: 409,
      json: { code: "meal_end.no_printer", params: { workingOrderId: party.tabId } },
    });
    await nothingIssued(party, revision);
  });

  it("refuses a till with no printer before warning of an unserved dish", async () => {
    const party = await seatedWith(venue, "Tarta");
    const revision = revisionOf(party.partyId);

    expect(await printBill(noPrinterCookie, party, { printAnyway: false })).toEqual({
      status: 409,
      json: { code: "meal_end.no_printer", params: { workingOrderId: party.tabId } },
    });
    await nothingIssued(party, revision);
  });

  it("refuses a till whose profile may not print receipts, issuing nothing, when the bill needs paper", async () => {
    const party = await served("Red wine bottle");
    const revision = revisionOf(party.partyId);

    // venue.cookie's profile lists the basic actions and payments, not print-receipt.
    expect(await printBill(venue.cookie, party)).toEqual({
      status: 403,
      json: { code: "device.forbidden_action", params: { action: "receipt" } },
    });
    await nothingIssued(party, revision);
  });

  it("issues a full invoice staged for email on a till whose profile may not print receipts", async () => {
    const party = await served("Red wine bottle");
    const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
      readBillEditState(tx, party.tabId),
    );
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    const chosen = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}/invoice-choice`,
      {
        revision: order!.revision,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
        expectedEdit: { billId: party.tabId, editorVersion, draftId, draftRevision },
      },
    );
    expect(chosen.status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );

    const answer = await printBill(venue.cookie, party);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await jobsOf(answer.json.saleId as string)).toEqual([]);
  });

  it.each([
    ["printAnyway", { printAnyway: "yes" }],
    ["printAnyway", { printAnyway: null }],
    ["billId", { billId: "not-a-uuid" }],
    ["expectedPartyRevision", { expectedPartyRevision: "1" }],
    ["submissionId", { submissionId: 7 }],
    ["expectedEdits", { expectedEdits: "x" }],
  ])("refuses a body whose %s is malformed, issuing nothing", async (field, extra) => {
    const party = await served("Red wine bottle");
    const revision = revisionOf(party.partyId);

    expect(await printBill(firstCookie, party, extra)).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
    await nothingIssued(party, revision);
  });
});
