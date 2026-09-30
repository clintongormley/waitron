import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { printJobs, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import type { RefundAnswer } from "@waitron/payments";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { centsToDecimal } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import { printedLines } from "./testing/decode-ticket.js";
import { systemClock } from "./till-backend.js";
import { REASONS } from "./testing/adjustment-venue.js";
import "./errors.js";

// A comp on a bill that already holds money (bill payments design §6a, §8 tests 5, 11 and 23),
// proved with the bill payment suites' own venue, as Task 14 proved them with a void. Every case
// opens its own bill.
let venue: BillVenue;
let reasonId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    reasonId = await withTransaction(
      db,
      async (tx) => (await createAdjustmentReason(tx, REASONS.house)).id,
    );
  },
});

const LOST: RefundAnswer = { kind: "uncertain", reason: "timeout" };

async function linesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        lineTotal: workingOrderLines.lineTotal,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

async function revisionOf(billId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return row!.revision;
}

function recordedOn(billId: string) {
  return inTx(venue, (tx) =>
    tx.select().from(adjustments).where(eq(adjustments.workingOrderId, billId)),
  );
}

async function adjust(billId: string, lineNo: number, ask: Record<string, unknown>) {
  const line = (await linesOf(billId)).find((row) => row.lineNo === lineNo)!;
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/adjustments`, {
    submissionId: randomUUID(),
    expectedRevision: await revisionOf(billId),
    lineId: line.id,
    reasonId,
    note: null,
    ...ask,
  });
}

async function pay(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    tip: "0.00",
    ...body,
  });
}

/** A contribution of `amount`: cash tendered exactly, or a card on the device's reader. */
async function contribute(billId: string, method: "cash" | "card", amount: string) {
  const paid = await pay(billId, {
    kind: "contribution",
    amount,
    method,
    ...(method === "cash" ? { tendered: amount } : { entry: "reader" }),
    applied: amount,
  });
  expect(paid.status).toBe(200);
  return (paid.json.payment as { id: string }).id;
}

function refund(billId: string, paymentId: string, applied: string) {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
    {
      submissionId: randomUUID(),
      appliedAmount: applied,
      tipAmount: "0.00",
      reason: "El cliente pagó de más",
      override: { personId: venue.adminId, pin: "1234" },
    },
  );
}

function documentJobs() {
  return inTx(venue, (tx) =>
    tx
      .select({ id: printJobs.id, payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.kind, "document")),
  );
}

/** The ticket lines printed by document jobs made after `before`, for the one with a total. */
async function newTicket(before: Set<string>) {
  const tickets = (await documentJobs())
    .filter((job) => !before.has(job.id))
    .map((job) => printedLines(job.payload).map((line) => line.trim().replace(/\s+/g, " ")))
    .filter((printed) => printed.some((line) => line.startsWith("TOTAL")));
  expect(tickets).toHaveLength(1);
  return tickets[0]!;
}

describe("a paid line (design §8 test 5)", () => {
  it("refuses a comp and a discount of an item already paid for, changing nothing", async () => {
    const billId = await tabWith(venue, "Paella", "Chuletón", "Caña");
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
    });
    expect(paid.status).toBe(200);
    const before = { lines: await linesOf(billId), revision: await revisionOf(billId) };

    for (const ask of [{ action: "comp" }, { action: "discount_percent", percentBp: 1000 }]) {
      const refused = await adjust(billId, 2, ask);
      expect([refused.status, refused.json]).toEqual([
        409,
        { code: "bill.line_paid", params: { workingOrderId: billId, lineNo: 2 } },
      ]);
    }

    expect({ lines: await linesOf(billId), revision: await revisionOf(billId) }).toEqual(before);
    expect(await recordedOn(billId)).toEqual([]);
  });
});

describe("a bill discount over a paid line", () => {
  it("refuses a discount of the whole bill that would lower an item already paid for", async () => {
    const billId = await tabWith(venue, "Paella", "Chuletón");
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
    });
    expect(paid.status).toBe(200);

    const refused = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/adjustments`,
      {
        submissionId: randomUUID(),
        expectedRevision: await revisionOf(billId),
        lineId: null,
        reasonId,
        action: "discount_amount",
        amount: "6.00",
        note: null,
      },
    );

    expect([refused.status, refused.json]).toEqual([
      409,
      { code: "bill.line_paid", params: { workingOrderId: billId, lineNo: 2 } },
    ]);
    expect(await recordedOn(billId)).toEqual([]);
  });
});

describe("a reduction after contributions (design §8 test 11)", () => {
  it("refuses a €20.00 comp by the €10.00 excess; after a €10.00 refund the comp issues the €40.00 invoice", async () => {
    const billId = await tabWith(venue, "Botella tinto", "Pulpo", "Croquetas");
    const paymentId = await contribute(billId, "cash", "50.00");
    const before = { lines: await linesOf(billId), revision: await revisionOf(billId) };

    const refused = await adjust(billId, 2, { action: "comp" });

    expect([refused.status, refused.json]).toEqual([
      409,
      { code: "bill.received_exceeds_total", params: { workingOrderId: billId, excess: "10.00" } },
    ]);
    expect({ lines: await linesOf(billId), revision: await revisionOf(billId) }).toEqual(before);
    expect(await recordedOn(billId)).toEqual([]);
    expect(registroCount(venue, billId)).toBe(0);

    expect((await refund(billId, paymentId, "10.00")).status).toBe(200);
    const jobsBefore = new Set((await documentJobs()).map((job) => job.id));
    const comped = await adjust(billId, 2, { action: "comp" });

    expect(comped.status).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
    expect(await tendersOfBill(venue, billId)).toEqual([
      expect.objectContaining({ method: "cash", amount: 4000, tip: 0, billPaymentId: paymentId }),
    ]);
    const printed = await newTicket(jobsBefore);
    // The comped line prints what it cost before the comp (ruling R13).
    expect(printed.filter((line) => line.endsWith(" 20,00 € -> 0,00 €"))).toHaveLength(1);
    const start = printed.findIndex((line) => line.startsWith("TOTAL"));
    expect(printed[start]).toBe("TOTAL 40,00 €");
    expect(
      printed
        .slice(start + 1)
        .filter((line) => line !== "")
        .slice(0, 2),
    ).toEqual(["Efectivo 50,00 €", "Devolución -10,00 €"]);
  });
});

describe("the invoice waits for the refund (design §8 test 23)", () => {
  it("refuses the comp that would issue it while a card refund is pending, then one cash payment issues it", async () => {
    const billId = await tabWith(venue, "Botella tinto", "Pulpo", "Croquetas");
    const card = await contribute(billId, "card", "30.00");
    await contribute(billId, "cash", "20.00");
    venue.card.scriptNextRefund({ made: "completed", answer: LOST });
    await refund(billId, card, "10.00");

    const refused = await adjust(billId, 3, { action: "comp" });

    expect([refused.status, refused.json]).toEqual([
      409,
      { code: "bill.refund_in_progress", params: { workingOrderId: billId } },
    ]);
    expect(registroCount(venue, billId)).toBe(0);
    expect(await recordedOn(billId)).toEqual([]);
    expect((await linesOf(billId)).map((line) => centsToDecimal(line.lineTotal))).toEqual([
      "30.00",
      "20.00",
      "10.00",
    ]);

    await settlePendingBillPayments({
      db: venue.db,
      backend: venue.backend,
      clock: systemClock(),
      cfg: venue.cfg,
      refundProviderFor: (name) => venue.pool.get(name),
    });
    const last = await pay(billId, {
      kind: "contribution",
      amount: "20.00",
      method: "cash",
      tendered: "20.00",
      applied: "20.00",
    });

    expect(last.status).toBe(200);
    expect(last.json).toMatchObject({ invoice: { total: "60.00" } });
    expect(registroCount(venue, billId)).toBe(1);
    const tenders = await tendersOfBill(venue, billId);
    expect(tenders.map((tender) => [tender.method, tender.amount]).sort()).toEqual(
      [
        ["card", 2000],
        ["cash", 2000],
        ["cash", 2000],
      ].sort(),
    );
  });
});
