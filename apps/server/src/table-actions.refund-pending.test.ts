import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import {
  provisionBillVenue,
  seatedWith,
  send,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";
import { createTable } from "./testing/live-table.js";
import { observedTableActionBody } from "./testing/table-action-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";

// Joining and unjoining tables while a card refund of a bill is pending (bill payments design §5.2):
// neither is refused, and neither changes what the bill charges.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

async function post(path: string, body: unknown): Promise<Answer> {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    path,
    await observedTableActionBody(
      venue.db,
      path,
      await observedBillActionBody(venue.db, path, body),
    ),
  );
}

function get(path: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "GET", path);
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function partyOfBill(billId: string): string {
  const [row] = venue.db.all<{ party_id: string }>(
    sql`select party_id from working_orders where id = ${billId}`,
  );
  return row!.party_id;
}

async function freeTable(): Promise<string> {
  const { id } = await withTransaction(venue.db, (tx) =>
    createTable(tx, venue.cfg, { label: `Mesa ${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  return id;
}

async function pay(billId: string, method: "cash" | "card", amount: string): Promise<Answer> {
  return post(`/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method,
    ...(method === "cash" ? { tendered: amount } : { entry: "reader" }),
    applied: amount,
    tip: "0.00",
  });
}

/** A €20.00 card payment of the bill and a €5.00 refund of it whose send timed out: pending. */
async function pendingRefundOn(billId: string) {
  const card = await pay(billId, "card", "20.00");
  expect(card.status).toBe(200);
  const paymentId = (card.json.payment as { id: string }).id;
  venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "timeout" } });
  const body = {
    submissionId: randomUUID(),
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "El cliente pagó de más",
    override: { personId: venue.adminId, pin: "1234" },
  };
  const path = `/api/working-orders/${billId}/payments/${paymentId}/refunds`;
  const asked = await post(path, body);
  expect(asked.json).toMatchObject({ refund: { state: "pending" } });
  return {
    /** The same refund asked again; its resend reaches the provider, which refunds it. */
    retry: () => {
      venue.card.scriptNextRefund({ made: "completed", answer: "made" });
      return post(path, body);
    },
  };
}

/**
 * What the bill charges, read through the till's routes. Left out: the bill's `revision` and
 * `partyId`, which a bill moving to another party changes by design (`takeIntoParty`). Each line is
 * read for its identity, quantity and price only; its kitchen fields, such as its group, are not
 * what the bill charges.
 */
async function charges(billId: string) {
  const bills = await get(`/api/parties/${partyOfBill(billId)}/bills`);
  expect(bills.status).toBe(200);
  const entry = (bills.json as unknown as Record<string, unknown>[]).find(
    (bill) => bill.workingOrderId === billId,
  );
  expect(entry).toBeDefined();
  const bill = { ...entry };
  delete bill.revision;
  delete bill.partyId;
  const payments = await get(`/api/working-orders/${billId}/payments`);
  expect(payments.status).toBe(200);
  const lines = await get(`/api/working-orders/${billId}/lines`);
  expect(lines.status).toBe(200);
  return {
    bill,
    payments: payments.json,
    lines: (lines.json.lines as Record<string, unknown>[]).map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      parentLineNo: line.parentLineNo,
      productId: line.productId,
      name: line.name,
      optionSnapshots: line.optionSnapshots,
      quantity: line.quantity,
      priceQuantity: line.priceQuantity,
      unitPriceGross: line.unitPriceGross,
    })),
  };
}

/** The pending refund still locks the bill: a cash payment on it is refused. */
async function expectLocked(billId: string) {
  const cash = await pay(billId, "cash", "5.00");
  expect({ status: cash.status, json: cash.json }).toEqual({
    status: 409,
    json: { code: "bill.refund_in_progress", params: { workingOrderId: billId } },
  });
}

/** The €40.00 bill with its €20.00 card payment and pending €5.00 refund, as the routes answer it. */
function expectPendingFigures(read: Awaited<ReturnType<typeof charges>>) {
  expect(read.bill).toMatchObject({ status: "open", total: "40.00", outstanding: "20.00" });
  expect(read.payments).toMatchObject({ total: "40.00", received: "20.00", outstanding: "20.00" });
  const [payment] = (read.payments as { payments: { refunds: { state: string }[] }[] }).payments;
  expect(payment!.refunds.map((refund) => refund.state)).toEqual(["pending"]);
}

/** A party at one table with the €40.00 bill, its card payment and its pending refund. */
async function refundParty() {
  const party = await seatedWith(venue, "Pulpo", "Croquetas", "Croquetas");
  const refund = await pendingRefundOn(party.tabId);
  return { ...party, refund };
}

/** What a join of another party's table asks of the two bills. */
const asking = [
  ["asking to merge the bills", "merge"],
  ["keeping the bills separate", "separate"],
] as const;

describe("a pending card refund and the table actions", () => {
  it("joins a free table: the bill charges the same and stays locked", async () => {
    const ana = await refundParty();
    const before = await charges(ana.tabId);

    const joined = await post(`/api/parties/${ana.partyId}/join`, {
      tableId: await freeTable(),
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect(joined.status).toBe(200);
    expect(joined.json).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
    const after = await charges(ana.tabId);
    expect(after).toEqual(before);
    expectPendingFigures(after);
    await expectLocked(ana.tabId);
  });

  it.each(asking)(
    "joins another party's table %s: neither bill changes, and they stay apart",
    async (_asking, bills) => {
      const ana = await refundParty();
      const luis = await seatedWith(venue, "Caña");
      const before = await charges(ana.tabId);
      const luisBefore = await charges(luis.tabId);

      const joined = await post(`/api/parties/${ana.partyId}/join`, {
        tableId: luis.tableId,
        bills,
        expectedPartyRevision: revisionOf(ana.partyId),
        otherPartyId: luis.partyId,
        expectedOtherPartyRevision: revisionOf(luis.partyId),
      });

      expect(joined.status).toBe(200);
      expect(joined.json).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
      const after = await charges(ana.tabId);
      expect(after).toEqual(before);
      expectPendingFigures(after);
      expect(partyOfBill(luis.tabId)).toBe(ana.partyId);
      const luisAfter = await charges(luis.tabId);
      expect(luisAfter).toEqual(luisBefore);
      expect(luisAfter.bill).toMatchObject({ status: "open", total: "3.00", outstanding: "3.00" });
      await expectLocked(ana.tabId);
    },
  );

  it.each(asking)(
    "has its table joined by another party %s: the bill moves across whole and stays locked",
    async (_asking, bills) => {
      const ana = await refundParty();
      const luis = await seatedWith(venue, "Caña");
      const before = await charges(ana.tabId);

      const joined = await post(`/api/parties/${luis.partyId}/join`, {
        tableId: ana.tableId,
        bills,
        expectedPartyRevision: revisionOf(luis.partyId),
        otherPartyId: ana.partyId,
        expectedOtherPartyRevision: revisionOf(ana.partyId),
      });

      expect(joined.status).toBe(200);
      expect(joined.json).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: false });
      expect(partyOfBill(ana.tabId)).toBe(luis.partyId);
      const after = await charges(ana.tabId);
      expect(after).toEqual(before);
      expectPendingFigures(after);
      await expectLocked(ana.tabId);
    },
  );

  it("has its table joined while another bill holds the refund: the main bills merge, the refund's bill does not change", async () => {
    const ana = await seatedWith(venue, "Caña", "Pulpo", "Croquetas", "Croquetas");
    const splitBill = await post(`/api/bills/${ana.tabId}/split`, {
      transfers: [{ lineNo: 2 }, { lineNo: 3 }, { lineNo: 4 }],
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    expect(splitBill.status).toBe(200);
    const billId = splitBill.json.billId as string;
    await pendingRefundOn(billId);
    const luis = await seatedWith(venue, "Caña");
    const before = await charges(billId);
    expectPendingFigures(before);

    const joined = await post(`/api/parties/${luis.partyId}/join`, {
      tableId: ana.tableId,
      bills: "merge",
      expectedPartyRevision: revisionOf(luis.partyId),
      otherPartyId: ana.partyId,
      expectedOtherPartyRevision: revisionOf(ana.partyId),
    });

    expect(joined.status).toBe(200);
    expect(joined.json).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: true });
    expect((await charges(luis.tabId)).bill).toMatchObject({
      status: "open",
      total: "6.00",
      outstanding: "6.00",
    });
    expect(partyOfBill(billId)).toBe(luis.partyId);
    expect(await charges(billId)).toEqual(before);
    await expectLocked(billId);
  });

  it("unjoins a table taking no bill: the bill charges the same and stays locked", async () => {
    const ana = await seatedWith(venue, "Pulpo", "Croquetas", "Croquetas");
    const second = await freeTable();
    const joined = await post(`/api/parties/${ana.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    expect(joined.status).toBe(200);
    await pendingRefundOn(ana.tabId);
    const before = await charges(ana.tabId);

    const split = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second,
      billId: null,
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect(split.status).toBe(200);
    expect(partyOfBill(ana.tabId)).toBe(ana.partyId);
    const after = await charges(ana.tabId);
    expect(after).toEqual(before);
    expectPendingFigures(after);
    await expectLocked(ana.tabId);
  });

  it("unjoins a table taking the bill: it moves to the new party whole and stays locked", async () => {
    const ana = await seatedWith(venue, "Caña", "Pulpo", "Croquetas", "Croquetas");
    const second = await freeTable();
    const joined = await post(`/api/parties/${ana.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    expect(joined.status).toBe(200);
    const splitBill = await post(`/api/bills/${ana.tabId}/split`, {
      transfers: [{ lineNo: 2 }, { lineNo: 3 }, { lineNo: 4 }],
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    expect(splitBill.status).toBe(200);
    const billId = splitBill.json.billId as string;
    await pendingRefundOn(billId);
    const before = await charges(billId);
    expectPendingFigures(before);

    const split = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second,
      billId,
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect(split.status).toBe(200);
    expect(split.json.mainBillId).toBe(billId);
    expect(partyOfBill(billId)).toBe(split.json.partyId);
    const after = await charges(billId);
    expect(after).toEqual(before);
    await expectLocked(billId);
  });

  it("completes the refund after a join and an unjoin to the same balance as a bill never joined", async () => {
    const ana = await refundParty();
    const control = await refundParty();
    const second = await freeTable();
    const joined = await post(`/api/parties/${ana.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    expect(joined.status).toBe(200);
    const split = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second,
      billId: null,
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    expect(split.status).toBe(200);

    const retried = await ana.refund.retry();
    const controlRetried = await control.refund.retry();

    expect(retried.json).toMatchObject({ refund: { state: "completed" } });
    expect(controlRetried.json).toMatchObject({ refund: { state: "completed" } });
    const figures = (read: Awaited<ReturnType<typeof charges>>) => ({
      bill: { total: read.bill.total, outstanding: read.bill.outstanding },
      payments: {
        total: (read.payments as { total: string }).total,
        received: (read.payments as { received: string }).received,
        outstanding: (read.payments as { outstanding: string }).outstanding,
      },
    });
    const after = figures(await charges(ana.tabId));
    expect(after).toEqual({
      bill: { total: "40.00", outstanding: "25.00" },
      payments: { total: "40.00", received: "15.00", outstanding: "25.00" },
    });
    expect(after).toEqual(figures(await charges(control.tabId)));
    const cash = await pay(ana.tabId, "cash", "5.00");
    expect(cash.status).toBe(200);
  });
});
