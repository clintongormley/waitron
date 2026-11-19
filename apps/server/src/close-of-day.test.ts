import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  billPaymentRefunds,
  billPayments,
  invoiceDeliveries,
  invoiceSeries,
  parties,
  printers,
  printJobs,
  readVenueClock,
  sales,
  taxpayer,
  ticketItems,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { AppError, businessDayAt, businessDayBounds } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { endMeal } from "./meal-end.js";
import { closeOfDayConfig, issueBillAtClose, type CloseOfDayRule } from "./close-of-day.js";
import { giveAway } from "./testing/cancel-line.js";
import { clockAt } from "./testing/deferred-close-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import {
  fiscalRecordCount,
  inTx,
  provisionBillVenue,
  seatedHeldWith,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

const inFlightCheck = vi.hoisted(() => ({ refusal: undefined as Error | undefined }));
vi.mock("./till-sale.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./till-sale.js")>();
  return {
    ...original,
    refuseBillPaymentInFlight: (...args: Parameters<typeof original.refuseBillPaymentInFlight>) =>
      inFlightCheck.refusal === undefined
        ? original.refuseBillPaymentInFlight(...args)
        : Promise.reject(inFlightCheck.refusal),
  };
});

let venue: BillVenue;
let counterZone: string;
/** The business day that began after every bill in this file was opened. */
let rule: CloseOfDayRule;
let closeClock: ReturnType<typeof clockAt>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    counterZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      )
    ).zoneId;
    const dayClock = await inTx(venue, (tx) => readVenueClock(tx));
    const nextDayStart = businessDayBounds(dayClock, businessDayAt(dayClock, new Date())).endAt;
    rule = { dayStartedAt: new Date(nextDayStart) };
    closeClock = clockAt(Date.parse(nextDayStart) + 60_000);
  },
});

type Party = Awaited<ReturnType<typeof seatedWith>>;

function deps() {
  return {
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: closeClock,
  };
}

function close(billId: string, at: CloseOfDayRule = rule) {
  return withTransaction(venue.db, (tx) =>
    issueBillAtClose(tx, deps(), closeOfDayConfig(venue.cfg), billId, at),
  );
}

async function partyStateOf(partyId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ state: parties.state }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.state;
}

/** Print the bill through its own function, as a till does. */
async function printTheBill(party: Pick<Party, "partyId" | "tabId">) {
  const { billId, editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, party.tabId),
  );
  return inTx(venue, (tx) =>
    endMeal(
      tx,
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      party.partyId,
      {
        billId: party.tabId,
        expectedPartyRevision: revisionOf(party.partyId),
        expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
        submissionId: randomUUID(),
        printAnyway: true,
      },
      venue.operatorId,
      null,
    ),
  );
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        id: sales.id,
        total: sales.total,
        counterpartyTaxId: sales.counterpartyTaxId,
        source: sales.source,
        deviceId: sales.deviceId,
        operatorId: sales.operatorId,
      })
      .from(sales)
      .where(eq(sales.workingOrderId, billId)),
  );
}

function recordSources(billId: string) {
  return venue.db.all<{ source: string; deviceId: string | null }>(sql`
    select r.source as source, r.device_id as deviceId
    from registros_facturacion r join sales s on s.id = r.sale_id
    where s.working_order_id = ${billId}
  `);
}

function countOf(table: typeof printJobs | typeof ticketItems | typeof invoiceDeliveries) {
  return venue.db.all<{ n: number }>(sql`select count(*) as n from ${table}`)[0]!.n;
}

function owedOn(billId: string): string {
  const [row] = venue.db.all<{ owed: number }>(sql`
    select s.total - coalesce((select sum(p.applied) from bill_payments p
      where p.working_order_id = s.working_order_id and p.state = 'received'), 0) as owed
    from sales s where s.working_order_id = ${billId}
  `);
  return (row!.owed / 100).toFixed(2);
}

function deliveriesOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ medium: invoiceDeliveries.medium })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, saleId)),
  );
}

function deliveryRowsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        medium: invoiceDeliveries.medium,
        status: invoiceDeliveries.status,
        failureCode: invoiceDeliveries.failureCode,
      })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, saleId)),
  );
}

function jobsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ kind: printJobs.kind, page: printJobs.pageDocument })
      .from(printJobs)
      .where(eq(printJobs.saleId, saleId)),
  );
}

function payInCash(billId: string, amount: string) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  });
}

async function chooseFullInvoice(billId: string) {
  const [order] = await inTx(venue, (tx) =>
    tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
  );
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, billId),
  );
  const answer = await send(
    venue.app,
    venue.cookie,
    "PUT",
    `/api/working-orders/${billId}/invoice-choice`,
    {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Harbour Foods",
        address: "2 Main Street, 28013 Madrid, Madrid",
        countryCode: "ES",
      },
      expectedEdit: { billId, editorVersion, draftId, draftRevision },
    },
  );
  expect(answer.status).toBe(200);
}

/** Nothing written for the bill: no sale, no record, the same status and party revision. */
async function leftAlone(party: Pick<Party, "partyId" | "tabId">, run: () => Promise<unknown>) {
  const status = await statusOf(venue, party.tabId);
  const revision = revisionOf(party.partyId);
  const jobs = countOf(printJobs);
  const outcome = await run();
  expect(await salesOf(party.tabId)).toEqual([]);
  expect(fiscalRecordCount(venue, party.tabId)).toBe(0);
  expect(await statusOf(venue, party.tabId)).toBe(status);
  expect(revisionOf(party.partyId)).toBe(revision);
  expect(countOf(printJobs)).toBe(jobs);
  return outcome;
}

function insertPayment(billId: string, state: "pending" | "received", applied: number) {
  return inTx(venue, (tx) =>
    tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: randomUUID(),
        kind: "contribution",
        method: "cash",
        applied,
        tendered: applied,
        tip: 0,
        state,
        ...(state === "received" ? { receivedAt: new Date().toISOString() } : {}),
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
      })
      .returning({ id: billPayments.id }),
  );
}

describe("issueBillAtClose", () => {
  it("issues an unprinted, unpaid table bill for its total, with no print or kitchen job", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const revision = revisionOf(party.partyId);
    const jobs = countOf(printJobs);
    const kitchen = countOf(ticketItems);
    const [seatedBy] = venue.db.all<{ id: string }>(
      sql`select opened_by as id from parties where id = ${party.partyId}`,
    );

    const outcome = await close(party.tabId);

    const issued = await salesOf(party.tabId);
    expect(issued).toEqual([
      {
        id: expect.any(String),
        total: 3000,
        counterpartyTaxId: null,
        source: "trading_day_close",
        deviceId: null,
        operatorId: seatedBy!.id,
      },
    ]);
    expect(outcome).toEqual({ kind: "issued", saleId: issued[0]!.id });
    expect(fiscalRecordCount(venue, party.tabId)).toBe(1);
    expect(recordSources(party.tabId)).toEqual([{ source: "trading_day_close", deviceId: null }]);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    expect(revisionOf(party.partyId)).toBeGreaterThan(revision);
    expect(await partyStateOf(party.partyId)).toBe("open");
    expect(countOf(printJobs)).toBe(jobs);
    expect(countOf(ticketItems)).toBe(kitchen);
  });

  it("a part-paid bill's ticket is for the whole bill, the paid part kept against it", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await payInCash(party.tabId, "5.00")).status).toBe(200);

    const outcome = await close(party.tabId);

    expect(outcome).toMatchObject({ kind: "issued" });
    expect(await salesOf(party.tabId)).toMatchObject([{ total: 3000 }]);
    expect(owedOn(party.tabId)).toBe("25.00");
  });

  it("charges a dish never marked served", async () => {
    const party = await seatedWith(venue, "Red wine bottle", "Tarta");

    expect(await close(party.tabId)).toMatchObject({ kind: "issued" });
    expect(await salesOf(party.tabId)).toMatchObject([{ total: 4800 }]);
  });

  it("leaves open a bill holding a held course", async () => {
    const party = await seatedHeldWith(venue, "Tarta");

    expect(await leftAlone(party, () => close(party.tabId))).toEqual({
      kind: "left_open",
      reason: "dish_not_made",
    });
  });

  it("issues a full invoice staged for email, queuing its delivery and no receipt", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await chooseFullInvoice(party.tabId);
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

    const outcome = await close(party.tabId);

    const [sale] = await salesOf(party.tabId);
    expect(outcome).toEqual({ kind: "issued", saleId: sale!.id });
    expect(sale).toMatchObject({
      counterpartyTaxId: "B12345674",
      source: "trading_day_close",
      deviceId: null,
    });
    expect(await deliveriesOf(sale!.id)).toEqual([{ medium: "email" }]);
    expect(await jobsOf(sale!.id)).toEqual([]);
  });

  it("issues a full invoice staged for A4, queuing the page and no receipt", async () => {
    const pagePrinterId = randomUUID();
    await inTx(venue, (tx) =>
      insertA4Printer(tx, { id: pagePrinterId, name: "Office", host: pagePrinterId }),
    );
    const party = await seatedWith(venue, "Red wine bottle");
    await chooseFullInvoice(party.tabId);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "a4", pagePrinterId, personId: venue.operatorId } })
        .where(eq(workingOrders.id, party.tabId)),
    );

    await close(party.tabId);

    const [sale] = await salesOf(party.tabId);
    expect(sale).toMatchObject({
      counterpartyTaxId: "B12345674",
      source: "trading_day_close",
      deviceId: null,
    });
    expect(await deliveriesOf(sale!.id)).toEqual([{ medium: "a4" }]);
    expect(await jobsOf(sale!.id)).toEqual([{ kind: "a4", page: "invoice" }]);
  });

  it("still issues a full invoice staged for an A4 printer switched off since, printing no receipt", async () => {
    const pagePrinterId = randomUUID();
    await inTx(venue, (tx) =>
      insertA4Printer(tx, { id: pagePrinterId, name: "Office", host: pagePrinterId }),
    );
    const party = await seatedWith(venue, "Red wine bottle");
    await chooseFullInvoice(party.tabId);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "a4", pagePrinterId, personId: venue.operatorId } })
        .where(eq(workingOrders.id, party.tabId)),
    );
    await inTx(venue, (tx) =>
      tx.update(printers).set({ active: false }).where(eq(printers.id, pagePrinterId)),
    );

    const outcome = await close(party.tabId);

    const [sale] = await salesOf(party.tabId);
    expect(outcome).toEqual({ kind: "issued", saleId: sale!.id });
    expect(sale).toMatchObject({ counterpartyTaxId: "B12345674", source: "trading_day_close" });
    expect(await jobsOf(sale!.id)).toEqual([]);
    expect(await deliveryRowsOf(sale!.id)).toEqual([
      { medium: "a4", status: "failed", failureCode: "printer_disabled" },
    ]);
  });

  it("still issues a full invoice staged for an A4 printer that no longer exists, queuing nothing", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await chooseFullInvoice(party.tabId);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "a4",
            pagePrinterId: randomUUID(),
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );

    const outcome = await close(party.tabId);

    const [sale] = await salesOf(party.tabId);
    expect(outcome).toEqual({ kind: "issued", saleId: sale!.id });
    expect(sale).toMatchObject({ counterpartyTaxId: "B12345674", source: "trading_day_close" });
    expect(await deliveryRowsOf(sale!.id)).toEqual([]);
    expect(await jobsOf(sale!.id)).toEqual([]);
  });

  it("issues and settles a €0.00 bill", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await giveAway(venue, party.tabId, 1);

    expect(await close(party.tabId)).toMatchObject({ kind: "issued" });

    expect(await salesOf(party.tabId)).toMatchObject([{ total: 0 }]);
    expect(await statusOf(venue, party.tabId)).toBe("settled");
  });

  it("skips a bill whose payment is pending, and issues it once that payment is received", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const [payment] = await insertPayment(party.tabId, "pending", 500);

    expect(await leftAlone(party, () => close(party.tabId))).toEqual({ kind: "money_moving" });

    await inTx(venue, (tx) =>
      tx
        .update(billPayments)
        .set({ state: "received", receivedAt: new Date().toISOString() })
        .where(eq(billPayments.id, payment!.id)),
    );
    expect(await close(party.tabId)).toMatchObject({ kind: "issued" });
    expect(await salesOf(party.tabId)).toMatchObject([{ total: 3000 }]);
    expect(owedOn(party.tabId)).toBe("25.00");
  });

  it("skips a bill with a refund still pending", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const [payment] = await insertPayment(party.tabId, "received", 500);
    await inTx(venue, (tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: payment!.id,
        submissionId: randomUUID(),
        fingerprint: randomUUID(),
        appliedAmount: 500,
        reason: "error",
        authorizedBy: venue.operatorId,
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        state: "pending",
      }),
    );

    expect(await leftAlone(party, () => close(party.tabId))).toEqual({ kind: "money_moving" });
  });

  it("lets any other refusal from the payment-in-flight check through", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    inFlightCheck.refusal = new AppError("bill.nothing_outstanding", {
      workingOrderId: party.tabId,
    });
    try {
      await leftAlone(party, () =>
        expect(close(party.tabId)).rejects.toMatchObject({ code: "bill.nothing_outstanding" }),
      );
    } finally {
      inFlightCheck.refusal = undefined;
    }
  });

  describe("leaves alone, writing nothing", () => {
    it("a bill already printed", async () => {
      const party = await seatedWith(venue, "Red wine bottle");
      const printed = await printTheBill(party);
      const records = fiscalRecordCount(venue);
      const jobs = countOf(printJobs);
      const revision = revisionOf(party.partyId);

      expect(await close(party.tabId)).toEqual({ kind: "not_due" });

      expect(await salesOf(party.tabId)).toMatchObject([{ id: printed.saleId, source: "device" }]);
      expect(fiscalRecordCount(venue)).toBe(records);
      expect(revisionOf(party.partyId)).toBe(revision);
      expect(countOf(printJobs)).toBe(jobs);
    });

    it("a Counter order not handed over", async () => {
      const id = randomUUID();
      const orderDeps = { db: venue.db, backend: venue.backend, clock: venue.clock };
      await parkOrder(orderDeps, venue.cfg, {
        id,
        lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
        zoneId: counterZone,
        operatorId: venue.operatorId,
      });
      await placeOrder(
        { ...orderDeps, admission: testTradingAdmission() },
        venue.cfg,
        id,
        venue.operatorId,
      );
      const records = fiscalRecordCount(venue);

      expect(await close(id)).toEqual({ kind: "not_due" });

      expect(await salesOf(id)).toEqual([]);
      expect(fiscalRecordCount(venue)).toBe(records);
      expect(await statusOf(venue, id)).toBe("placed");
    });

    it("a bill opened after the day began", async () => {
      const party = await seatedWith(venue, "Red wine bottle");
      const startedEarlier = { dayStartedAt: new Date(Date.now() - 60_000) };

      expect(await leftAlone(party, () => close(party.tabId, startedEarlier))).toEqual({
        kind: "not_due",
      });
    });

    it("a bill counted as opened after the day began, whatever its stored time", async () => {
      const party = await seatedWith(venue, "Red wine bottle");
      const late = new Date(rule.dayStartedAt.getTime() + 1);
      const counted: CloseOfDayRule = {
        ...rule,
        openedAt: (billId) => (billId === party.tabId ? late : undefined),
      };

      expect(await leftAlone(party, () => close(party.tabId, counted))).toEqual({
        kind: "not_due",
      });
    });

    it("a bill fully paid but held by an open draft", async () => {
      const party = await seatedWith(venue, "Red wine bottle");
      await insertPayment(party.tabId, "received", 3000);
      await inTx(venue, (tx) =>
        saveDraft(tx, venue.cfg, party.partyId, venue.operatorId, {
          billId: party.tabId,
          draftId: null,
          revision: 0,
          lines: [
            {
              menuItemId: venue.offerFor("Tarta"),
              quantity: "1",
              options: [],
              extras: [],
              note: null,
              courseId: null,
              makeAt: null,
            },
          ],
        }),
      );

      expect(await leftAlone(party, () => close(party.tabId))).toEqual({
        kind: "left_open",
        reason: "owes_nothing",
      });
    });

    it("a bill opened by another node", async () => {
      const party = await seatedWith(venue, "Red wine bottle");
      const other = await seedNode(venue.db);
      await inTx(venue, (tx) =>
        tx.update(workingOrders).set({ nodeId: other }).where(eq(workingOrders.id, party.tabId)),
      );

      expect(await leftAlone(party, () => close(party.tabId))).toEqual({ kind: "not_due" });
    });

    it("a bill opened before this node's latest series retirement", async () => {
      const party = await seatedWith(venue, "Red wine bottle");
      const [retired] = await inTx(venue, (tx) =>
        tx
          .insert(invoiceSeries)
          .values({
            nodeId: venue.cfg.nodeId,
            code: `OLD-${randomUUID().slice(0, 8)}`,
            retiredAt: new Date(Date.now() + 1000),
          })
          .returning({ id: invoiceSeries.id }),
      );
      try {
        expect(await leftAlone(party, () => close(party.tabId))).toEqual({ kind: "not_due" });
      } finally {
        await inTx(venue, (tx) =>
          tx.delete(invoiceSeries).where(eq(invoiceSeries.id, retired!.id)),
        );
      }
    });
  });

  it("issues a bill stored as opened before the latest series retirement but counted as opened after it", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const retiredAt = new Date(Date.now() + 1000);
    const [retired] = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values({ nodeId: venue.cfg.nodeId, code: `OLD-${randomUUID().slice(0, 8)}`, retiredAt })
        .returning({ id: invoiceSeries.id }),
    );
    const counted: CloseOfDayRule = {
      ...rule,
      openedAt: (billId) =>
        billId === party.tabId ? new Date(retiredAt.getTime() + 1000) : undefined,
    };
    try {
      expect(await close(party.tabId, counted)).toMatchObject({ kind: "issued" });
    } finally {
      await inTx(venue, (tx) => tx.delete(invoiceSeries).where(eq(invoiceSeries.id, retired!.id)));
    }
  });

  it("called twice, issues one sale and one record", async () => {
    const party = await seatedWith(venue, "Red wine bottle");

    await close(party.tabId);
    await close(party.tabId);

    expect(await salesOf(party.tabId)).toHaveLength(1);
    expect(fiscalRecordCount(venue, party.tabId)).toBe(1);
  });

  it("refuses a full invoice once the venue's address is removed, rolling everything back", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await chooseFullInvoice(party.tabId);
    await inTx(venue, (tx) => tx.update(taxpayer).set({ taxpayerDomicile: null }));
    try {
      await leftAlone(party, () =>
        expect(close(party.tabId)).rejects.toMatchObject({
          code: "fiscal.taxpayer_domicile_missing",
        }),
      );
    } finally {
      await inTx(venue, (tx) =>
        tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
      );
    }
  });
});
