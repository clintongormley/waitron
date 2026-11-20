import { testTradingAdmission } from "./testing/trading-admission.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  allocateInvoiceNumber,
  billPayments,
  drawerOpens,
  invoiceSeries,
  saleSettlements,
  sales,
  tenders,
  workingOrders,
} from "@waitron/db";
import { recordCorrection } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { parkOrder } from "./working-order.js";
import { collectOrderOrchestration as collectOrder } from "./testing/whole-payment-fixture.js";
import {
  closeZeroBill,
  takeBillPayment,
  type BillPaymentRequest,
} from "./testing/bill-payment-fixture.js";
import { openTillSession } from "./testing/session-device.js";
import { readBillEditState } from "./bill-editing.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  cashPayment,
  inTx,
  provisionBillVenue,
  fiscalRecordCount,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Collecting a presented bill follows its issuance history, not its zone's service mode (spec §9).
let venue: BillVenue;
let ticketThenPayZone: string;
let issueAtPaymentZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    ticketThenPayZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      )
    ).zoneId;
    issueAtPaymentZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "tables", orderStart: "counter" }),
      )
    ).zoneId;
  },
});

async function placedCake(zoneId: string, issued = false): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId,
    operatorId: venue.operatorId,
  });
  if (issued)
    await issueOrderInvoice(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
  await placeOrder({ ...deps, admission: testTradingAdmission() }, venue.cfg, id, venue.operatorId);
  return id;
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

async function retarget(billId: string, zoneId: string): Promise<void> {
  await inTx(venue, (tx) => VENUE_SERVICE.retargetOrderContext(tx, billId, zoneId));
  const context = await inTx(venue, (tx) => VENUE_SERVICE.findOrderContext(tx, billId));
  expect(context?.zoneId).toBe(zoneId);
}

const paymentDeps = () => ({
  admission: testTradingAdmission(),
  db: venue.db,
  backend: venue.backend,
  clock: venue.clock,
});

async function operator() {
  const personId = venue.operatorId;
  return {
    personId,
    sessionId: await openTillSession(venue.db, { personId, deviceId: venue.cfg.origin.deviceId }),
  };
}

async function collectCash(billId: string) {
  const paid = await cashPayment(venue, venue.cookie, billId, "20.00");
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  return paid.json;
}

async function closeWithoutPayment(billId: string, method: "cash" | "card") {
  return closeZeroBill(
    paymentDeps(),
    venue.cfg,
    billId,
    {
      expectedEdit: await readBillEditState(venue.db, billId),
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "0.00",
      method,
      ...(method === "cash" ? { tendered: "20.00" } : { entry: "manual" }),
      applied: "0.00",
      tip: "0.00",
    },
    await operator(),
  );
}

describe("collecting a presented bill follows its invoice, not its zone (spec §9)", () => {
  it("keeps outside-card details when settling an already-issued bill and replaying it", async () => {
    const id = await placedCake(ticketThenPayZone, true);
    const request: BillPaymentRequest = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "18.00",
      method: "card",
      entry: "manual",
      applied: "18.00",
      tip: "0.00",
      externalProvider: "connected_account",
      externalMachine: "Spare Solo",
      externalRef: "OP-73",
    };
    const staff = await operator();
    const paid = await takeBillPayment(paymentDeps(), venue.cfg, id, request, staff);
    expect(paid.invoice?.tender).toMatchObject({
      externalProvider: "connected_account",
      externalMachine: "Spare Solo",
      reference: "OP-73",
    });
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ source: payments.externalProvider, machine: payments.externalMachine })
          .from(payments)
          .where(eq(payments.workingOrderId, id)),
      ),
    ).toEqual([{ source: "connected_account", machine: "Spare Solo" }]);
    const replay = await takeBillPayment(paymentDeps(), venue.cfg, id, request, staff);
    expect(replay.invoice?.tender).toEqual(paid.invoice?.tender);
  });

  it("settles an already-issued invoice, even once the bill's zone says to issue at payment", async () => {
    const id = await placedCake(ticketThenPayZone, true);
    const issued = await salesOf(id);
    expect(issued).toEqual([{ id: expect.any(String), total: 1800, settledAt: null }]);
    await retarget(id, issueAtPaymentZone);

    await collectCash(id);

    const after = await salesOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(issued[0]!.id);
    expect(after[0]!.settledAt).not.toBeNull();
    expect(fiscalRecordCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("issues the invoice at payment for a bill placed without one, even once its zone says invoice first", async () => {
    const id = await placedCake(issueAtPaymentZone);
    expect(await salesOf(id)).toEqual([]);
    await retarget(id, ticketThenPayZone);

    await collectCash(id);

    const after = await salesOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.total).toBe(1800);
    expect(after[0]!.settledAt).not.toBeNull();
    expect(fiscalRecordCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });
});

describe("collecting an invoice that carries a corrective invoice", () => {
  // Tarta's 18.00 invoice (21% VAT), corrected by default by a credit note of -2.00 base (-2.42):
  // the customer owes 15.58.
  async function correctedCake(
    credit: { base: string; total: string } = { base: "2.00", total: "-2.42" },
  ): Promise<{ billId: string; saleId: string }> {
    const billId = await placedCake(ticketThenPayZone, true);
    return { billId, saleId: await correctBill(billId, credit) };
  }

  /** Records `credit` against the bill's issued invoice and returns that invoice's id. */
  async function correctBill(
    billId: string,
    credit: { base: string; total: string },
  ): Promise<string> {
    const [issued] = await salesOf(billId);
    await inTx(venue, async (tx) => {
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, venue.cfg.nodeId),
            eq(invoiceSeries.purpose, "rectificative"),
          ),
        );
      const session = await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: venue.adminId,
        pin: "1234",
      });
      await recordCorrection(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        correctsSaleId: brandSaleId(issued!.id),
        total: credit.total,
        lines: [
          {
            lineNo: 1,
            name: "Descuento",
            descriptions: { [venue.cfg.locale]: "Descuento" },
            quantity: "-1",
            unitPrice: credit.base,
            vatRate: "21.00",
            lineTotal: `-${credit.base}`,
          },
        ],
        clock: venue.clock,
        authz: { sessionId: session.id },
      });
    });
    return issued!.id;
  }

  function tendersOf(saleId: string) {
    return inTx(venue, (tx) =>
      tx
        .select({ method: tenders.method, amount: tenders.amount, cash: tenders.cashTendered })
        .from(tenders)
        .where(eq(tenders.saleId, saleId)),
    );
  }

  it("manual tip settles a corrected issued bill without changing its invoice, including replay", async () => {
    const { billId, saleId } = await correctedCake();
    const request: BillPaymentRequest = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "15.58",
      method: "card",
      entry: "manual",
      applied: "15.58",
      addedTip: "0.30",
      tip: "0.30",
    };
    const staff = await operator();
    const before = fiscalRecordCount(venue, billId);
    const paid = await takeBillPayment(
      paymentDeps(),
      { ...venue.cfg, tipsEnabled: true },
      billId,
      request,
      staff,
    );
    expect(paid.invoice).toMatchObject({
      total: "18.00",
      tender: { charged: "15.88", tip: "0.30" },
    });
    expect(await tendersOf(saleId)).toEqual([{ method: "card", amount: 1588, cash: null }]);
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ amount: payments.amount })
          .from(payments)
          .where(eq(payments.workingOrderId, billId)),
      ),
    ).toEqual([{ amount: 1588 }]);
    const replay = await takeBillPayment(
      paymentDeps(),
      { ...venue.cfg, tipsEnabled: false },
      billId,
      request,
      staff,
    );
    expect(replay.invoice?.tender).toEqual(paid.invoice?.tender);
    expect(fiscalRecordCount(venue, billId)).toBe(before);
  });

  it("refuses a manual tip on an issued bill while tips are off", async () => {
    const { billId, saleId } = await correctedCake();
    await expect(
      takeBillPayment(
        paymentDeps(),
        { ...venue.cfg, tipsEnabled: false },
        billId,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "15.58",
          method: "card",
          entry: "manual",
          applied: "15.58",
          addedTip: "0.30",
          tip: "0.30",
        },
        await operator(),
      ),
    ).rejects.toMatchObject({ code: "bill.tip_not_allowed", params: { chargeable: "15.58" } });
    expect(await tendersOf(saleId)).toEqual([]);
  });

  it.each([false, true])(
    "refuses a positive manual tip at zero due (tips enabled: %s)",
    async (tipsEnabled) => {
      const { billId } = await correctedCake({ total: "-18.00", base: "14.88" });
      await expect(
        closeZeroBill(
          paymentDeps(),
          { ...venue.cfg, tipsEnabled },
          billId,
          {
            expectedEdit: await readBillEditState(venue.db, billId),
            submissionId: randomUUID(),
            kind: "contribution",
            amount: "0.00",
            method: "card",
            entry: "manual",
            applied: "0.00",
            addedTip: "0.30",
            tip: "0.30",
          },
          await operator(),
        ),
      ).rejects.toMatchObject({ code: "bill.tip_not_allowed" });
      expect(await statusOf(venue, billId)).toBe("placed");
    },
  );

  it("settles a cash collection at the corrected amount the customer owes", async () => {
    const { billId, saleId } = await correctedCake();

    const ticket = await collectCash(billId);

    expect(await tendersOf(saleId)).toEqual([{ method: "cash", amount: 1558, cash: 2000 }]);
    expect(ticket.payment).toMatchObject({ method: "cash", change: "4.42" });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });

  it("settles a manual card collection, and its payment row, at the corrected amount", async () => {
    const { billId, saleId } = await correctedCake();

    await takeBillPayment(
      paymentDeps(),
      venue.cfg,
      billId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "15.58",
        method: "card",
        entry: "manual",
        applied: "15.58",
        tip: "0.00",
      },
      await operator(),
    );

    expect(await tendersOf(saleId)).toEqual([{ method: "card", amount: 1558, cash: null }]);
    const paid = await inTx(venue, (tx) =>
      tx
        .select({ amount: payments.amount, saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(paid).toEqual([{ amount: 1558, saleId }]);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });

  function drawerAudit() {
    return venue.db.select().from(drawerOpens);
  }

  async function collectedAtOf(billId: string): Promise<string | null> {
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ collectedAt: workingOrders.collectedAt })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    return row!.collectedAt;
  }

  // Tarta's 18.00 is a 14.88 base at 21%: a credit note of that base reverses the whole invoice.
  const wholeInvoice = { base: "14.88", total: "-18.00" };

  it("opens the cash drawer when a corrected bill is collected in cash", async () => {
    const { billId } = await correctedCake();
    await collectCash(billId);
    const [payment] = await venue.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, billId));
    expect(
      await venue.db.select().from(drawerOpens).where(eq(drawerOpens.billPaymentId, payment!.id)),
    ).toMatchObject([{ reason: "bill_payment", saleId: null }]);
  });

  it("closes a cash collection of a bill that owes nothing, with no tender and no drawer", async () => {
    const { billId, saleId } = await correctedCake(wholeInvoice);

    const before = await drawerAudit();
    const { invoice } = await closeWithoutPayment(billId, "cash");

    expect(await tendersOf(saleId)).toEqual([]);
    expect((await salesOf(billId))[0]!.settledAt).not.toBeNull();
    expect(await collectedAtOf(billId)).toBeNull();
    expect(await drawerAudit()).toEqual(before);
    expect(invoice.tender).toEqual({ method: "unpaid" });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });

  it("closes a card collection of a bill that owes nothing, with no tender and no payment row", async () => {
    const { billId, saleId } = await correctedCake(wholeInvoice);

    const before = await drawerAudit();
    await closeWithoutPayment(billId, "card");

    expect(await tendersOf(saleId)).toEqual([]);
    expect((await salesOf(billId))[0]!.settledAt).not.toBeNull();
    expect(await collectedAtOf(billId)).toBeNull();
    const paid = await inTx(venue, (tx) =>
      tx
        .select({ amount: payments.amount })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(paid).toEqual([]);
    expect(await drawerAudit()).toEqual(before);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });

  it("refuses a cash collection with a malformed amount on a bill that owes nothing, and leaves it open", async () => {
    const { billId, saleId } = await correctedCake(wholeInvoice);

    await expect(
      collectOrder(
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        venue.cfg,
        { id: billId, lines: [], tender: { method: "cash", amount: "not-money" } },
        venue.operatorId,
      ),
    ).rejects.toMatchObject({ code: "shared.invalid_decimal", params: { value: "not-money" } });

    expect(await tendersOf(saleId)).toEqual([]);
    expect((await salesOf(billId))[0]!.settledAt).toBeNull();
    expect(await collectedAtOf(billId)).toBeNull();
    expect(await statusOf(venue, billId)).toBe("placed");
  });

  it("refuses a correction that would take the bill below zero, and the bill still collects in full", async () => {
    const billId = await placedCake(ticketThenPayZone, true);
    const [issued] = await salesOf(billId);

    // A 16.53 base at 21% is 20.00, more than Tarta's 18.00 invoice.
    await expect(correctBill(billId, { base: "16.53", total: "-20.00" })).rejects.toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { saleId: issued!.id, remaining: "18.00", correction: "-20.00" },
    });

    expect(await salesOf(billId)).toEqual([{ id: issued!.id, total: 1800, settledAt: null }]);
    expect(fiscalRecordCount(venue, billId)).toBe(1);
    await collectCash(billId);
    expect(await tendersOf(issued!.id)).toEqual([{ method: "cash", amount: 1800, cash: 2000 }]);
    expect(await statusOf(venue, billId)).toBe("settled");
  });

  it("refuses to close a bill already corrected below zero, with the domain code, and leaves it open", async () => {
    const billId = await placedCake(ticketThenPayZone, true);
    const [issued] = await salesOf(billId);
    // Written straight to `sales`: `recordCorrection` refuses a correction this large, but a
    // bill below zero must still be refused at collection.
    await inTx(venue, async (tx) => {
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, venue.cfg.nodeId),
            eq(invoiceSeries.purpose, "rectificative"),
          ),
        );
      const now = venue.clock.now();
      // No fiscal record is written for this row: it bypasses recordCorrection on purpose.
      await tx.insert(sales).values({
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        nodeId: venue.cfg.nodeId,
        seriesId: series!.id,
        invoiceNumber: await allocateInvoiceNumber(tx, series!.id),
        issuedAt: now.instant.toISOString(),
        issuedOffsetMinutes: now.offsetMinutes,
        total: -2000,
        vatBreakdown: [{ rate: "21.00", base: "-16.53", tax: "-3.47" }],
        locale: venue.cfg.locale,
        invoiceLocales: [venue.cfg.locale],
        fiscalBackend: venue.backend.id,
        fiscalState: "recorded",
        correctsSaleId: issued!.id,
      });
    });

    await expect(
      collectOrder(
        paymentDeps(),
        venue.cfg,
        { id: billId, lines: [], tender: { method: "cash", amount: "20.00" } },
        venue.operatorId,
      ),
    ).rejects.toMatchObject({
      code: "sale.tender_shortfall",
      params: { due: "-2.00", charged: "0" },
    });

    expect(await tendersOf(issued!.id)).toEqual([]);
    expect(await salesOf(billId)).toEqual([{ id: issued!.id, total: 1800, settledAt: null }]);
    expect(await collectedAtOf(billId)).toBeNull();
    expect(await statusOf(venue, billId)).toBe("placed");
  });
});
