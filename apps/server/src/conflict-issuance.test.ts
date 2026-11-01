import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { billPaymentRefunds, tenderRefunds, tenders, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { openFilingCase } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: BillVenue;
beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
});

function part(method: "cash" | "card", amount = "10.00") {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method,
    ...(method === "cash" ? { tendered: amount } : { entry: "reader" }),
    applied: amount,
    tip: "0.00",
  };
}
const pay = (billId: string, body: Record<string, unknown>) =>
  send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, body);
async function markConflict() {
  const [record] = suite.db.all<{ id: string }>(
    sql`select id from registros_facturacion order by secuencia limit 1`,
  );
  await withTransaction(suite.db, (tx) =>
    openFilingCase(tx, {
      registroId: record!.id,
      cause: "fiscal.huella_divergente",
      evidence: { codigo: 3000, mensaje: "Invoice identity conflict", csv: null },
      now: venue.clock.now().instant,
    }),
  );
}
async function issued() {
  const billId = await tabWith(venue, "Paella");
  expect((await pay(billId, part("card", "35.00"))).status).toBe(200);
  const [tender] = await suite.db
    .select({ saleId: tenders.saleId, tenderId: tenders.id })
    .from(tenders)
    .innerJoin(sales, eq(sales.id, tenders.saleId))
    .where(eq(sales.workingOrderId, billId));
  return tender!;
}
const refundBody = () => ({
  submissionId: randomUUID(),
  appliedAmount: "5.00",
  tipAmount: "0.00",
  reason: "Overcharged",
  override: { personId: venue.adminId, pin: "1234" },
});
async function refundable(kind: "bill" | "tender") {
  if (kind === "tender") {
    const { saleId, tenderId } = await issued();
    return { path: `/api/transactions/${saleId}/refunds`, body: { ...refundBody(), tenderId } };
  }
  await issued();
  const billId = await tabWith(venue, "Paella");
  const paid = await pay(billId, part("card"));
  expect(paid.status).toBe(200);
  const paymentId = (paid.json.payment as { id: string }).id;
  return {
    path: `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
    body: refundBody(),
  };
}
const refusal = {
  code: "sif.allocation_invalid",
  params: { reason: "conflict_requires_administrator" },
};

describe("conflict issuance preflights over real routes", () => {
  it("keeps a bill card capture recoverable when its invoice is refused by a later conflict", async () => {
    await issued();
    const billId = await tabWith(venue, "Paella");
    const collect = venue.card.collect.bind(venue.card);
    venue.card.collect = async (input) => {
      const result = await collect(input);
      await markConflict();
      return result;
    };
    const body = part("card", "35.00");
    const charged = await pay(billId, body);
    expect(charged.json).toMatchObject({
      code: "sale.charged_not_recorded",
      params: { reason: "issuance_refused" },
    });
    expect(charged.json).toMatchObject({
      params: { recoveryUrl: "/manage/recovery/fiscal-conflict" },
    });
    expect(
      suite.db.all(
        sql`select state, amount, sale_id from payments where working_order_id = ${billId}`,
      ),
    ).toEqual([{ state: "captured", amount: 3500, sale_id: null }]);
    expect(suite.db.all(sql`select id from sales where working_order_id = ${billId}`)).toEqual([]);
    const collects = venue.card.collectCalls.length;
    const retry = await pay(billId, body);
    expect(retry.json).toMatchObject({ payment: { state: "pending" } });
    expect(venue.card.collectCalls).toHaveLength(collects);
  });

  it.each(["cash", "card"] as const)("refuses a new %s bill contribution", async (method) => {
    await issued();
    const billId = await tabWith(venue, "Paella");
    await markConflict();
    const sends = venue.card.collectCalls.length;
    const answer = await pay(billId, part(method));
    expect(answer.json).toMatchObject(refusal);
    expect(answer.json).toMatchObject({
      params: { recoveryUrl: "/manage/recovery/fiscal-conflict" },
    });
    expect(venue.card.collectCalls).toHaveLength(sends);
    expect(
      suite.db.all(sql`select id from bill_payments where working_order_id = ${billId}`),
    ).toEqual([]);
  });

  for (const kind of ["bill", "tender"] as const) {
    it(`replays the completed ${kind} refund after a conflict without another send`, async () => {
      const request = await refundable(kind);
      const first = await send(venue.app, venue.cookie, "POST", request.path, request.body);
      expect(first.status).toBe(200);
      await markConflict();
      const replay = await send(venue.app, venue.cookie, "POST", request.path, request.body);
      expect(replay).toEqual(first);
      expect(venue.card.refundCalls).toHaveLength(1);
    });

    it(`refuses a new ${kind} refund before sending money`, async () => {
      const request = await refundable(kind);
      await markConflict();
      const answer = await send(venue.app, venue.cookie, "POST", request.path, request.body);
      expect(answer.json).toMatchObject(refusal);
      expect(venue.card.refundCalls).toEqual([]);
      expect(await suite.db.select().from(billPaymentRefunds)).toEqual([]);
      expect(await suite.db.select().from(tenderRefunds)).toEqual([]);
    });

    it(`checks the active conflict again after the ${kind} refund's provider read`, async () => {
      const request = await refundable(kind);
      venue.card.existingRefundRefs = async () => {
        await markConflict();
        return [];
      };
      const answer = await send(venue.app, venue.cookie, "POST", request.path, request.body);
      expect(answer.json).toMatchObject(
        kind === "bill" ? { refund: { state: "pending" } } : { state: "pending" },
      );
      expect(venue.card.refundCalls).toEqual([]);
      const table = kind === "bill" ? billPaymentRefunds : tenderRefunds;
      expect(
        await suite.db.select({ sentAt: table.sentAt, sendCount: table.sendCount }).from(table),
      ).toEqual([{ sentAt: null, sendCount: 0 }]);
    });

    it(`records a completed ${kind} refund even if the conflict arrives during its send`, async () => {
      const request = await refundable(kind);
      const sendRefund = venue.card.sendRefund.bind(venue.card);
      venue.card.sendRefund = async (input) => {
        const result = await sendRefund(input);
        await markConflict();
        return result;
      };
      const answer = await send(venue.app, venue.cookie, "POST", request.path, request.body);
      expect(answer.json).toMatchObject(
        kind === "bill" ? { refund: { state: "completed" } } : { state: "completed" },
      );
      expect(venue.card.refundCalls).toHaveLength(1);
      expect(suite.db.all(sql`select amount from payment_refunds`)).toEqual([{ amount: 500 }]);
    });

    it(`pauses the ${kind} refund recovery loop while the active identity conflicts`, async () => {
      const request = await refundable(kind);
      venue.card.scriptNextRefund({
        answer: { kind: "uncertain", reason: "timeout" },
        made: false,
      });
      const answer = await send(venue.app, venue.cookie, "POST", request.path, request.body);
      expect(answer.json).toMatchObject(
        kind === "bill" ? { refund: { state: "pending" } } : { state: "pending" },
      );
      await markConflict();
      const table = kind === "bill" ? billPaymentRefunds : tenderRefunds;
      const before = await suite.db.select().from(table);
      const lookups = venue.card.lookupCalls.length;
      const deps = {
        admission: testTradingAdmission(),
        db: suite.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        refundProviderFor: (name: string) => venue.pool.get(name),
      };
      if (kind === "bill") await settlePendingBillPayments(deps);
      else await recoverTenderRefunds(deps);
      expect(venue.card.lookupCalls).toHaveLength(lookups);
      expect(venue.card.refundCalls).toHaveLength(1);
      expect(await suite.db.select().from(table)).toEqual(before);
    });
  }
});
