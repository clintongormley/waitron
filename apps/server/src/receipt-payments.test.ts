import { billRefundFields } from "./testing/bill-payment-fixture.js";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  refunds as refundTable,
  billPayments,
  readLiveSeriesIdTx,
  saleSettlements,
  sales,
  taxpayer,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordReplacement } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { thousandthsToDecimal, saleId as brandSaleId, seriesId } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { endMeal } from "./meal-end.js";
import { readReceiptPayments } from "./receipt-payments.js";
import { printOrderForTest } from "./testing/issue-order.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { readSettledTicket, settleIssuedOrder } from "./till-sale.js";
import { SESSION_COOKIE } from "./till-session.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { markServed } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    // A full invoice names the taxpayer's domicile.
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
  },
});

function deps() {
  return {
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
  };
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

async function saleOf(billId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!.id;
}

function read(saleId: string, billId: string | null) {
  return inTx(venue, async (tx: Transaction) => {
    const settlements = await tx
      .select({ id: saleSettlements.id })
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    return readReceiptPayments(tx, brandSaleId(saleId), billId, settlements.length > 0);
  });
}

/** A seated party's bill of Seafood rice and Steak (60.00), served, its ticket issued by Print the bill. */
async function printedBill(
  staged?: (billId: string) => Promise<void>,
): Promise<{ partyId: string; billId: string }> {
  const party = await seatedWith(venue, "Seafood rice", "Steak");
  await staged?.(party.tabId);
  const lines = venue.db.all<{ id: string; quantity: number }>(
    sql`select id, quantity from working_order_lines where working_order_id = ${party.tabId}`,
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
  const { billId, editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, party.tabId),
  );
  await inTx(venue, (tx) =>
    endMeal(
      tx,
      deps(),
      venue.cfg,
      party.partyId,
      {
        billId: party.tabId,
        expectedPartyRevision: revisionOf(party.partyId),
        expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
        submissionId: randomUUID(),
        printAnyway: false,
      },
      venue.operatorId,
      null,
    ),
  );
  return { partyId: party.partyId, billId: party.tabId };
}

/** A bill payment written as a card on a reader leaves it, with these completed refunds. */
async function receivedPayment(
  billId: string,
  money: { applied: number; tip?: number; pending?: true },
  refunds: { applied: number; tip?: number }[] = [],
): Promise<void> {
  await inTx(venue, async (tx) => {
    const [row] = await tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "card",
        applied: money.applied,
        tip: money.tip ?? 0,
        state: money.pending ? "pending" : "received",
        receivedAt: money.pending ? null : new Date().toISOString(),
        requestedBy: venue.operatorId,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
      })
      .returning({ id: billPayments.id });
    for (const refund of refunds) {
      await tx.insert(refundTable).values({
        billPaymentId: row!.id,
        ...billRefundFields(tx, venue.cfg.nodeId, row!.id),
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: refund.applied,
        tipAmount: refund.tip ?? 0,
        reason: "error",
        authorizedBy: venue.operatorId,
        requestedBy: venue.operatorId,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        state: "completed",
        completedAt: new Date().toISOString(),
      });
    }
  });
}

async function adminSessionId(tx: Transaction): Promise<{ id: string; token: string }> {
  return loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" });
}

it("an unpaid departure owes the whole amount due", async () => {
  const party = await seatedWith(venue, "Seafood rice", "Steak");
  const session = await inTx(venue, adminSessionId);
  const [, ...device] = venue.cookie.split("; ");
  const cookie = [`${SESSION_COOKIE}=${session.token}`, ...device].join("; ");
  const answer = await send(
    venue.app,
    cookie,
    "POST",
    `/api/parties/${party.partyId}/unpaid-departure`,
    {
      billId: party.tabId,
      expectedPartyRevision: revisionOf(party.partyId),
      reason: "Se marcharon sin pagar",
    },
  );
  expect(answer.status, JSON.stringify(answer)).toBe(200);

  expect(await read(await saleOf(party.tabId), party.tabId)).toEqual({ owed: "60.00" });
});

/** A hand-keyed card of 40.00 with a 2.00 tip, taken through the till's route. */
async function payFortyWithTip(billId: string): Promise<void> {
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      method: "card",
      entry: "manual",
      externalRef: "OP-77",
      amount: "40.00",
      addedTip: "2.00",
      applied: "40.00",
      tip: "2.00",
    },
  );
  expect(answer.status, JSON.stringify(answer)).toBe(200);
}

it("a part-paid bill issued unpaid lists its payment and owes the rest", async () => {
  const { billId } = await printedBill();
  await payFortyWithTip(billId);
  const [manual] = await inTx(venue, (tx) =>
    tx.select({ id: payments.id }).from(payments).where(eq(payments.workingOrderId, billId)),
  );
  await liftPaymentGuard(venue.db, () =>
    venue.db.execute(
      sql`update payments set provider = 'sumup', card_scheme = 'VISA', card_last4 = '4034', card_entry_mode = 'chip', card_auth_code = null where id = ${manual!.id}`,
    ),
  );
  const saleId = await saleOf(billId);

  expect(await read(saleId, billId)).toEqual({
    payments: [
      {
        method: "card",
        amount: "42.00",
        tip: "2.00",
        reference: null,
        card: { scheme: "VISA", last4: "4034", entryMode: "chip", authCode: null },
        refunds: [],
      },
    ],
    owed: "20.00",
  });
  const ticket = await inTx(venue, (tx) => readSettledTicket(venue.backend, tx, venue.cfg, billId));
  expect(ticket).toMatchObject({ tender: { method: "unpaid" }, owed: "20.00" });
  expect(ticket.payments).toHaveLength(1);
  const receipt = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
  );
  expect(receipt).toMatchObject({ owed: "20.00", payments: ticket.payments });
});

it("a refunded part payment counts net", async () => {
  const { billId } = await printedBill();
  await receivedPayment(billId, { applied: 3000, tip: 100 }, [{ applied: 1000, tip: 100 }]);
  await receivedPayment(billId, { applied: 1000 }, [{ applied: 1000 }]);

  expect(await read(await saleOf(billId), billId)).toEqual({
    payments: [
      {
        method: "card",
        amount: "20.00",
        tip: "0.00",
        reference: null,
        refunds: [{ amount: "10.00", tip: "1.00" }],
      },
    ],
    owed: "40.00",
  });
});

it("a payment still being taken is neither listed nor counted", async () => {
  const { billId } = await printedBill();
  await receivedPayment(billId, { applied: 2000 });
  await receivedPayment(billId, { applied: 1500, pending: true });

  expect(await read(await saleOf(billId), billId)).toEqual({
    payments: [{ method: "card", amount: "20.00", tip: "0.00", reference: null, refunds: [] }],
    owed: "40.00",
  });
});

it("a full invoice printed on A4 before it is paid carries its payment and what it owes", async () => {
  const pagePrinterId = randomUUID();
  await inTx(venue, (tx) =>
    insertA4Printer(tx, { id: pagePrinterId, name: "Office", host: pagePrinterId }),
  );
  const { billId } = await printedBill(async (id) => {
    const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
      readBillEditState(tx, id),
    );
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, id)),
    );
    const chosen = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${id}/invoice-choice`,
      {
        revision: order!.revision,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Harbour Foods",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
        expectedEdit: { billId: id, editorVersion, draftId, draftRevision },
      },
    );
    expect(chosen.status, JSON.stringify(chosen)).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "a4", pagePrinterId, personId: venue.operatorId } })
        .where(eq(workingOrders.id, id)),
    );
  });
  await payFortyWithTip(billId);

  const saleId = await saleOf(billId);
  const document = await inTx(venue, (tx) =>
    readInvoiceDocument(venue.backend, tx, venue.cfg, saleId),
  );
  expect(document.result).toMatchObject({
    invoiceType: "F1",
    tender: { method: "unpaid" },
    payments: [{ method: "card", amount: "42.00", tip: "2.00", refunds: [] }],
    owed: "20.00",
  });
  expect(document.result.payments).toHaveLength(1);
});

it("a settled sale owes nothing", async () => {
  const billId = await tabWith(venue, "Seafood rice", "Steak");
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "60.00",
      method: "cash",
      tendered: "60.00",
      applied: "60.00",
      tip: "0.00",
    },
  );
  expect(answer.status, JSON.stringify(answer)).toBe(200);

  expect(await read(await saleOf(billId), billId)).toEqual({
    payments: [
      {
        method: "cash",
        amount: "60.00",
        tip: "0.00",
        tendered: "60.00",
        change: "0.00",
        refunds: [],
      },
    ],
  });
});

it("a deferred close owes nothing", async () => {
  const billId = await tabWith(venue, "Seafood rice", "Steak");
  await printOrderForTest(deps(), venue.cfg, billId, venue.operatorId);
  const saleId = await saleOf(billId);
  // The tender and settlement a deferred close (`closeBillDeferredTx`) writes.
  await inTx(venue, (tx) =>
    settleIssuedOrder(
      tx,
      { workingOrderId: billId, saleId: brandSaleId(saleId) },
      [
        {
          method: "deferred",
          amount: "60.00",
          tipAmount: "0.00",
          cashTendered: null,
          settledAt: new Date(),
        },
      ],
      new Date(),
      undefined,
    ),
  );

  expect(await read(saleId, billId)).toEqual({});
});

it("a replacement of a paid ticket owes nothing", async () => {
  const billId = await tabWith(venue, "Seafood rice", "Steak");
  await send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "60.00",
    method: "cash",
    tendered: "60.00",
    applied: "60.00",
    tip: "0.00",
  });
  const original = await saleOf(billId);
  const replacement = await inTx(venue, async (tx) => {
    await refusedByAeat(tx, original);
    const session = await adminSessionId(tx);
    return (
      await recordReplacement(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: seriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "corrective")),
        correctsSaleId: brandSaleId(original),
        authz: { sessionId: session.id },
        clock: venue.clock,
      })
    ).saleId;
  });

  const receipt = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, replacement),
  );
  expect(receipt.invoiceType).toMatch(/^R[45]$/);
  expect(receipt.owed).toBeUndefined();
  expect(await read(replacement, null)).toEqual({});
});
