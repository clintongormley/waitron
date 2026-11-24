import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { loginWithPin } from "@waitron/identity";
import {
  billAdvances,
  deviceProfiles,
  diningTables,
  devices,
  floorZones,
  printJobs,
  saleLines,
  sales,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import {
  filedInvoicesOf,
  filedKindsBySale,
  invoiceRecords,
} from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { receiptLabelsFor } from "@waitron/country-packs";
import { payments } from "@waitron/payments";
import { computeDailyClose } from "@waitron/reporting";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import type { TrustedClock } from "@waitron/fiscal";
import { deviceId as brandDeviceId } from "@waitron/shared";
import { readBillAdvances } from "./bill-advances.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { readFindTransactions, resolveTransactionScope } from "./find-bill-transactions.js";
import { parseTransactionsQuery } from "./find-bill-query.js";
import { VENUE_SERVICE } from "./modules.js";
import { startClockState } from "./start-clock-check.js";
import { gateSeatOnStartClock, startClockGateHolds } from "./start-clock-gate.js";
import { readBillEditState } from "./bill-editing.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { parkOrder } from "./working-order.js";
import { printOrderForTest } from "./testing/issue-order.js";
import { createTable } from "./testing/live-table.js";
import { openPartyTab } from "./testing/serve-line.js";
import { printedLines } from "./testing/decode-ticket.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { systemClock } from "./till-backend.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  send,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// A part payment whose payer wants their own receipt (advances plan, Task 1.3), driven through the
// till's payment routes against a venue that files real Veri*Factu records. Every bill is €120.00
// at a table of its own, so whatever a case reads back about a bill is that case's alone.
let venue: BillVenue;
/** A till of its own, signed in, whose profile `serveOnly` limits to one zone. */
let zonedTill: { cookie: string; profileId: string };

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const [profile] = await inTx(venue, (tx) =>
      seedDeviceProfiles(tx, {
        name: "Zoned till",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS],
      }),
    );
    const device = await enrolDeviceForTest(db, venue.cfg, {
      name: "Zoned till",
      profileId: profile!.id,
    });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId: device.deviceId, personId: venue.operatorId, pin: "5555" }),
    );
    zonedTill = {
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
      profileId: profile!.id,
    };
  },
});

async function serveOnly(zoneId: string): Promise<void> {
  await inTx(venue, async (tx) => {
    const [zone] = await tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId));
    await setProfileServiceAccess(tx, zonedTill.profileId, {
      departmentId: zone!.departmentId,
      allowedZoneIds: [zoneId],
      startingZoneId: zoneId,
    });
  });
}

const MEAL = ["Seafood rice", "Steak", "Red wine bottle", "House salad", "Tarta"];

/** A €120.00 bill at a fresh table, its dishes sent. Tables are labelled with a bare number, as the
 * Spain demo floor labels them; a label no other table in the file has unless one is given. */
async function bill120(
  tableLabel = `7${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
): Promise<{ billId: string; tableLabel: string }> {
  const billId = await withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, { label: tableLabel, zoneId: venue.zoneId });
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      lines: MEAL.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    });
    return tabId;
  });
  return { billId, tableLabel };
}

function pay(billId: string, body: Record<string, unknown>, app = venue.app): Promise<Answer> {
  return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    tip: "0.00",
    ...body,
  });
}

function cash(billId: string, amount: string, extra: Record<string, unknown> = {}) {
  return pay(billId, { amount, method: "cash", tendered: amount, applied: amount, ...extra });
}

function readerCard(billId: string, amount: string, extra: Record<string, unknown> = {}) {
  return pay(billId, { amount, method: "card", entry: "reader", applied: amount, ...extra });
}

function manualCard(billId: string, amount: string, extra: Record<string, unknown> = {}) {
  return pay(billId, {
    amount,
    method: "card",
    entry: "manual",
    externalRef: `OP-${randomUUID().slice(0, 8)}`,
    applied: amount,
    ...extra,
  });
}

const settle = () =>
  settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg: venue.cfg,
  });

function advancesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, billId)),
  );
}

function billSales(billId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId)));
}

async function onlyAdvance(billId: string) {
  const rows = await advancesOf(billId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function recordsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ saleId: invoiceRecords.saleId })
      .from(invoiceRecords)
      .where(eq(invoiceRecords.saleId, saleId)),
  );
}

const english = receiptLabelsFor("en-GB");
const spanish = receiptLabelsFor("es-ES");
/** The advance line `labels` words for a bill at table 7 (the label set's own wording). */
const atTable7 = (labels: typeof english) => labels.paymentOnAccountAtTable.replace("{table}", "7");
/** The advance line `labels` words for a bill with no table and order number `number`. */
const forOrder = (labels: typeof english, number: number) =>
  labels.paymentOnAccountForOrder.replace("{number}", String(number));

function jobsSince(before: number) {
  return inTx(venue, async (tx) =>
    (
      await tx
        .select()
        .from(printJobs)
        .orderBy(sql`rowid`)
    ).slice(before),
  );
}

async function jobCount(): Promise<number> {
  return (await inTx(venue, (tx) => tx.select({ id: printJobs.id }).from(printJobs))).length;
}

/** Lets the first till print receipts again and slips on request, as Find a bill's copy needs. */
async function allowPrintReceipt(): Promise<void> {
  await inTx(venue, async (tx) => {
    const [device] = await tx
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, venue.deviceId));
    const [profile] = await tx
      .select()
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, device!.profileId!));
    const capabilities = profile!.capabilities as string[];
    if (!capabilities.includes("print-receipt"))
      await tx
        .update(deviceProfiles)
        .set({ capabilities: [...capabilities, "print-receipt"] })
        .where(eq(deviceProfiles.id, profile!.id));
  });
}

const query = (values: Record<string, string> = {}) =>
  parseTransactionsQuery(new URLSearchParams({ preset: "any", ...values }));

describe("a part payment whose payer wants their own receipt", () => {
  it("a €30 cash payment that needs a receipt, on a €120 bill, issues an advance ticket with one line at 10%", async () => {
    const { billId } = await bill120("7");
    const before = await jobCount();

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.invoice).toBeUndefined();
    expect(paid.json).toMatchObject({ balance: { total: "120.00", outstanding: "90.00" } });
    const [payment] = await paymentRows(venue, billId);
    expect(payment).toMatchObject({ ownReceipt: true, state: "received" });
    expect(await billSales(billId)).toEqual([]);
    const advance = await onlyAdvance(billId);
    expect(advance).toMatchObject({ billPaymentId: payment!.id });
    const [sale] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.id, advance.advanceSaleId)),
    );
    expect(sale).toMatchObject({
      workingOrderId: null,
      total: 3000,
      vatBreakdown: [{ rate: "10.00", base: "27.27", tax: "2.73" }],
      correctsSaleId: null,
      counterpartyTaxId: null,
    });
    const lines = await inTx(venue, (tx) =>
      tx.select().from(saleLines).where(eq(saleLines.saleId, advance.advanceSaleId)),
    );
    expect(lines).toEqual([
      expect.objectContaining({
        lineNo: 1,
        advanceRole: "payment_on_account",
        deductsSaleId: null,
        name: atTable7(english),
        descriptions: { "es-ES": atTable7(spanish) },
        quantity: 1000,
        vatRate: 1000,
        lineTotal: 2727,
        lineGross: 3000,
      }),
    ]);
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({
            method: tenders.method,
            amount: tenders.amount,
            tip: tenders.tipAmount,
            billPaymentId: tenders.billPaymentId,
          })
          .from(tenders)
          .where(eq(tenders.saleId, advance.advanceSaleId)),
      ),
    ).toEqual([{ method: "cash", amount: 3000, tip: 0, billPaymentId: payment!.id }]);
    expect(await recordsOf(advance.advanceSaleId)).toHaveLength(1);
    expect(
      (await filedKindsBySale(venue.db, [advance.advanceSaleId])).get(advance.advanceSaleId),
    ).toBe("F2");
    const documents = (await jobsSince(before)).filter((job) => job.kind === "document");
    expect(documents).toEqual([
      expect.objectContaining({ saleId: advance.advanceSaleId, receiptCopy: false }),
    ]);
    const printed = printedLines(documents[0]!.payload).join(" ").replace(/\s+/g, " ");
    expect(printed).toContain(atTable7(spanish));
    expect(printed).toContain("10% 27,27 2,73 30,00");
    expect(printed).toMatch(new RegExp(` 7 ${spanish.order} \\d+`));
  });

  it("an advance on a bill with no table names the bill's order number", async () => {
    const billId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: billId,
      lines: MEAL.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
      zoneId: venue.zoneId,
      operatorId: venue.operatorId,
    });
    const before = await jobCount();

    const paid = await cash(billId, "30.00", {
      ownReceipt: true,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    const advance = await onlyAdvance(billId);
    const lines = await inTx(venue, (tx) =>
      tx.select().from(saleLines).where(eq(saleLines.saleId, advance.advanceSaleId)),
    );
    expect(lines).toEqual([
      expect.objectContaining({
        name: forOrder(english, order!.orderNumber),
        descriptions: { "es-ES": forOrder(spanish, order!.orderNumber) },
      }),
    ]);
    const [document] = (await jobsSince(before)).filter((job) => job.kind === "document");
    expect(printedLines(document!.payload).join(" ").replace(/\s+/g, " ")).toContain(
      forOrder(spanish, order!.orderNumber),
    );
  });

  it("the tip is on its tender, not its ticket", async () => {
    const { billId } = await bill120();

    const paid = await manualCard(billId, "30.00", {
      addedTip: "2.00",
      tip: "2.00",
      ownReceipt: true,
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const advance = await onlyAdvance(billId);
    const [sale] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.id, advance.advanceSaleId)),
    );
    expect(sale).toMatchObject({ total: 3000 });
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ amount: tenders.amount, tip: tenders.tipAmount })
          .from(tenders)
          .where(eq(tenders.saleId, advance.advanceSaleId)),
      ),
    ).toEqual([{ amount: 3200, tip: 200 }]);
  });

  it("the bill's payments name the advance's ticket on the payment that paid it, and on no other", async () => {
    const { billId } = await bill120();

    expect((await cash(billId, "30.00", { ownReceipt: true })).status).toBe(200);
    const plain = await cash(billId, "20.00");

    expect(plain.status, JSON.stringify(plain.json)).toBe(200);
    const advance = await onlyAdvance(billId);
    const shown = (plain.json.balance as { payments: Record<string, unknown>[] }).payments;
    expect(shown[0]).toMatchObject({
      id: advance.billPaymentId,
      hasTicket: true,
      saleId: advance.advanceSaleId,
    });
    expect(shown[1]).not.toHaveProperty("hasTicket");
    expect(shown[1]).not.toHaveProperty("saleId");
  });

  it("a payment that does not need a receipt issues nothing (cash and card)", async () => {
    const { billId } = await bill120();

    expect((await cash(billId, "30.00")).status).toBe(200);
    expect((await manualCard(billId, "20.00", { ownReceipt: false })).status).toBe(200);

    expect(await advancesOf(billId)).toEqual([]);
    expect(await billSales(billId)).toEqual([]);
    expect((await paymentRows(venue, billId)).map((row) => row.ownReceipt)).toEqual([false, false]);
  });

  it("a flagged payment that pays the bill off is part of the rest's invoice", async () => {
    const { billId } = await bill120();

    const paid = await cash(billId, "120.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.invoice).toMatchObject({ total: "120.00" });
    expect(await advancesOf(billId)).toEqual([]);
    expect(await billSales(billId)).toEqual([expect.objectContaining({ total: 12000 })]);
  });

  it("a flagged payment taken while another card is pending is still an advance when something is left", async () => {
    const { billId } = await bill120();
    venue.card.crashNextCollect("attempting");
    expect((await readerCard(billId, "50.00")).status).toBe(500);

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const advance = await onlyAdvance(billId);
    const [sale] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.id, advance.advanceSaleId)),
    );
    expect(sale).toMatchObject({ total: 3000 });
  });

  it("a flagged card captured, then recovered, issues its advance once", async () => {
    const { billId } = await bill120();
    venue.card.crashNextCollect("captured");
    expect((await readerCard(billId, "30.00", { ownReceipt: true })).status).toBe(500);
    expect(await advancesOf(billId)).toEqual([]);

    await settle();
    expect(await advancesOf(billId)).toHaveLength(1);
    await settle();

    const [payment] = await paymentRows(venue, billId);
    const advance = await onlyAdvance(billId);
    expect(advance.billPaymentId).toBe(payment!.id);
    expect(await recordsOf(advance.advanceSaleId)).toHaveLength(1);
    const [provided] = await inTx(venue, (tx) =>
      tx
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.billPaymentId, payment!.id)),
    );
    expect(provided!.saleId).toBe(advance.advanceSaleId);
    expect(await billSales(billId)).toEqual([]);
  });

  it("after the invoice a flagged payment issues no advance and prints no ticket", async () => {
    const { billId } = await bill120();
    await printOrderForTest(
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        admission: testTradingAdmission(),
      },
      venue.cfg,
      billId,
      venue.operatorId,
    );
    const [invoice] = await billSales(billId);
    const before = await jobCount();

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await advancesOf(billId)).toEqual([]);
    expect(await billSales(billId)).toEqual([invoice]);
    expect(
      (await jobsSince(before)).filter((job) => job.kind === "document" && job.saleId !== null),
    ).toEqual([]);
  });

  it("a flagged payment prints its advance ticket and no payment slip unless one is asked for", async () => {
    const { billId } = await bill120();
    const before = await jobCount();
    expect((await cash(billId, "30.00", { ownReceipt: true })).status).toBe(200);
    const [cashAdvance] = await advancesOf(billId);
    const cashJobs = await jobsSince(before);
    expect(cashJobs.filter((job) => job.kind === "document")).toEqual([
      expect.objectContaining({ saleId: cashAdvance!.advanceSaleId }),
    ]);

    const second = await bill120();
    const quiet = await jobCount();
    expect((await readerCard(second.billId, "30.00", { ownReceipt: true })).status).toBe(200);
    const [quietAdvance] = await advancesOf(second.billId);
    expect((await jobsSince(quiet)).filter((job) => job.kind === "document")).toEqual([
      expect.objectContaining({ saleId: quietAdvance!.advanceSaleId }),
    ]);

    await allowPrintReceipt();
    const third = await bill120();
    const asked = await jobCount();
    const slipped = await readerCard(third.billId, "30.00", {
      ownReceipt: true,
      printCardSlip: true,
    });
    expect(slipped.status).toBe(200);
    const [askedAdvance] = await advancesOf(third.billId);
    const documents = (await jobsSince(asked)).filter((job) => job.kind === "document");
    expect(documents).toHaveLength(2);
    expect(documents.filter((job) => job.saleId === askedAdvance!.advanceSaleId)).toHaveLength(1);
  });

  it("while the box waits for its time to be confirmed, the payment is refused", async () => {
    const { billId } = await bill120();

    const paid = await cash(billId, "30.00", { ownReceipt: true });
    const holds = startClockGateHolds(
      startClockState(),
      () => true,
      () => false,
    );
    const refused = await pay(
      billId,
      { amount: "30.00", method: "cash", tendered: "30.00", applied: "30.00", ownReceipt: true },
      venue.appWith({
        backend: gateSeatOnStartClock(venue.backend, holds),
        clockUnconfirmed: holds,
      }),
    );

    expect(paid.status).toBe(200);
    expect(refused).toMatchObject({ status: 409, json: { code: "clock.unconfirmed" } });
    expect(await paymentRows(venue, billId)).toHaveLength(1);
    expect(await advancesOf(billId)).toHaveLength(1);
  });

  it("a flagged payment on a bill set for a full invoice is refused with advance.full_invoice_unsupported", async () => {
    const { billId } = await bill120();
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    const chosen = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${billId}/invoice-choice`,
      {
        revision: order!.revision,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Customer SL",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
      },
    );
    expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);

    const refused = await cash(billId, "30.00", { ownReceipt: true });

    expect(refused).toMatchObject({
      status: 409,
      json: { code: "advance.full_invoice_unsupported", params: { workingOrderId: billId } },
    });
    expect(await paymentRows(venue, billId)).toEqual([]);
    expect(await advancesOf(billId)).toEqual([]);
  });

  it("a retry with a different ownReceipt is a different request", async () => {
    const { billId } = await bill120();
    const submissionId = randomUUID();

    expect((await cash(billId, "30.00", { submissionId })).status).toBe(200);
    const again = await cash(billId, "30.00", { submissionId, ownReceipt: false });
    const other = await cash(billId, "30.00", { submissionId, ownReceipt: true });

    expect(again.status).toBe(200);
    expect(other).toMatchObject({ status: 409, json: { code: "submission.id_reused" } });
    expect(await paymentRows(venue, billId)).toHaveLength(1);
    expect(await advancesOf(billId)).toEqual([]);
  });
});

describe("an advance in Find a bill (ruling L2)", () => {
  async function advanceAt(): Promise<{ billId: string; tableLabel: string; saleId: string }> {
    const bill = await bill120();
    expect((await cash(bill.billId, "30.00", { ownReceipt: true })).status).toBe(200);
    return { ...bill, saleId: (await onlyAdvance(bill.billId)).advanceSaleId };
  }

  async function otherZone(): Promise<string> {
    return inTx(venue, async (tx) => {
      const department = await createDepartment(tx, {
        name: `Terrace ${randomUUID()}`,
        tradingName: "Terrace",
        orderStart: "table",
      });
      return (
        await createServiceZone(tx, { name: `Zone ${randomUUID()}`, departmentId: department.id })
      ).id;
    });
  }

  it("Find a bill lists the advance under table 7, and a search for table 7 finds it", async () => {
    const { billId, tableLabel, saleId } = await advanceAt();

    const all = await inTx(venue, (tx) => readFindTransactions(tx, query()));
    const found = await inTx(venue, (tx) => readFindTransactions(tx, query({ q: tableLabel })));

    expect(all.rows.find((row) => row.saleId === saleId)).toMatchObject({
      type: "sale",
      tableName: tableLabel,
      scopeOrderIds: [billId],
      amount: "30.00",
    });
    expect(found.rows.map((row) => row.saleId)).toEqual([saleId]);
    expect(await inTx(venue, (tx) => resolveTransactionScope(tx, saleId))).toEqual({
      workingOrderIds: [billId],
    });
  });

  it("a device limited to another zone does not see the advance, and one limited to table 7's zone does", async () => {
    const { saleId } = await advanceAt();
    const elsewhere = await otherZone();
    const seen = async (zoneId: string) =>
      (
        await inTx(venue, (tx) =>
          readFindTransactions(tx, query(), (id) => VENUE_SERVICE.orderInZones(id, [zoneId])),
        )
      ).rows.map((row) => row.saleId);

    expect(await seen(elsewhere)).not.toContain(saleId);
    expect(await seen(venue.zoneId)).toContain(saleId);
  });

  it("a duplicate of the advance ticket prints as the original, with table 7", async () => {
    const before = await jobCount();
    const { tableLabel, saleId } = await advanceAt();
    await allowPrintReceipt();

    const reprinted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/reprint`,
      {},
    );

    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    const [original, copy] = (await jobsSince(before)).filter((job) => job.saleId === saleId);
    expect(copy).toMatchObject({ receiptCopy: true });
    const originalLines = printedLines(original!.payload);
    const copyLines = printedLines(copy!.payload);
    expect(copyLines.filter((line) => !originalLines.includes(line))).toEqual([
      expect.stringContaining("DUPLICADO"),
    ]);
    expect(originalLines.filter((line) => !copyLines.includes(line))).toEqual([]);
    expect(originalLines.join("\n")).toContain(tableLabel);
  });

  it("a duplicate printed after table 7 is renamed still heads the ticket with table 7, as its line does", async () => {
    const before = await jobCount();
    const { tableLabel, saleId } = await advanceAt();
    await allowPrintReceipt();
    const renamed = `Renamed ${randomUUID().slice(0, 8)}`;
    await inTx(venue, (tx) =>
      tx.update(diningTables).set({ label: renamed }).where(eq(diningTables.label, tableLabel)),
    );

    const reprinted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/reprint`,
      {},
    );

    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    const [original, copy] = (await jobsSince(before)).filter((job) => job.saleId === saleId);
    const originalLines = printedLines(original!.payload);
    const copyLines = printedLines(copy!.payload);
    expect(copyLines.filter((line) => !originalLines.includes(line))).toEqual([
      expect.stringContaining("DUPLICADO"),
    ]);
    expect(originalLines.filter((line) => !copyLines.includes(line))).toEqual([]);
    expect(copyLines.join("\n")).not.toContain(renamed);
  });

  const supervisor = () => ({ personId: venue.adminId, pin: "1234" });

  /** Opens a €10.00 correction of the advance `saleId` through the till's correction route. */
  async function openCorrection(saleId: string): Promise<string> {
    const [reason] = await inTx(venue, (tx) => listAdjustmentReasons(tx));
    const opened = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/corrections`,
      {
        submissionId: randomUUID(),
        gross: "10.00",
        reasonId: reason!.id,
        note: "Paid too much",
        expectedSplit: [{ rate: "10.00", base: "9.09", tax: "0.91" }],
        override: supervisor(),
      },
    );
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    return (opened.json as { correction: { id: string } }).correction.id;
  }

  it("a correction of the advance keeps table 7's zone", async () => {
    const { billId, saleId } = await advanceAt();
    const elsewhere = await otherZone();
    const correctionId = await openCorrection(saleId);
    const filed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/cash`,
      { submissionId: randomUUID(), amount: "10.00", override: supervisor() },
    );
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    expect(filed.json).toMatchObject({ correction: { state: "filed" } });
    const [corrective] = await inTx(venue, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, saleId)),
    );
    const correction = corrective!.id;

    expect(await inTx(venue, (tx) => resolveTransactionScope(tx, correction))).toEqual({
      workingOrderIds: [billId],
    });
    const seen = async (zoneId: string) =>
      (
        await inTx(venue, (tx) =>
          readFindTransactions(tx, query(), (id) => VENUE_SERVICE.orderInZones(id, [zoneId])),
        )
      ).rows.map((row) => row.saleId);
    expect(await seen(elsewhere)).not.toContain(correction);
    expect(await seen(venue.zoneId)).toContain(correction);
    expect((await inTx(venue, (tx) => readBillAdvances(tx, [billId]))).credits.get(billId)).toEqual(
      [
        expect.objectContaining({
          saleId,
          gross: "20.00",
          groups: [{ rate: "10.00", base: "18.18", tax: "1.82" }],
        }),
      ],
    );
  });

  /** Files a €10.00 cash correction of the advance `saleId`; answers the corrective sale's id. */
  async function fileCorrection(saleId: string): Promise<string> {
    const correctionId = await openCorrection(saleId);
    const filed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/cash`,
      { submissionId: randomUUID(), amount: "10.00", override: supervisor() },
    );
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    const [corrective] = await inTx(venue, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, saleId)),
    );
    return corrective!.id;
  }

  const renameTable = (tableLabel: string) => {
    const renamed = `Renamed ${randomUUID().slice(0, 8)}`;
    return inTx(venue, async (tx) => {
      await tx
        .update(diningTables)
        .set({ label: renamed })
        .where(eq(diningTables.label, tableLabel));
      return renamed;
    });
  };

  it("a correction of the advance printed after table 7 is renamed is headed with table 7, as its line is", async () => {
    const { tableLabel, saleId } = await advanceAt();
    const correction = await fileCorrection(saleId);
    const renamed = await renameTable(tableLabel);
    await allowPrintReceipt();
    const before = await jobCount();

    const printed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${correction}/reprint`,
      {},
    );

    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    const [job] = (await jobsSince(before)).filter((row) => row.saleId === correction);
    const lines = printedLines(job!.payload);
    expect(lines.join("\n")).not.toContain(renamed);
    expect(lines.find((line) => line.includes(spanish.order))).toContain(tableLabel);
    const [reason] = await inTx(venue, (tx) => listAdjustmentReasons(tx));
    const again = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${correction}/corrections`,
      {
        submissionId: randomUUID(),
        gross: "1.00",
        reasonId: reason!.id,
        note: "Correct the correction",
        expectedSplit: [{ rate: "10.00", base: "0.91", tax: "0.09" }],
        override: supervisor(),
      },
    );
    expect(again.json).toMatchObject({ code: "invoice_correction.not_settled" });
  });

  it("a copy of the advance's correction printed after table 7 is renamed is the original plus the copy mark", async () => {
    const { tableLabel, saleId } = await advanceAt();
    await allowPrintReceipt();
    const before = await jobCount();
    const correction = await fileCorrection(saleId);
    await renameTable(tableLabel);

    const reprinted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${correction}/reprint`,
      {},
    );

    expect(reprinted.status, JSON.stringify(reprinted.json)).toBe(200);
    const [original, copy] = (await jobsSince(before)).filter((job) => job.saleId === correction);
    expect(copy).toMatchObject({ receiptCopy: true });
    const originalLines = printedLines(original!.payload);
    const copyLines = printedLines(copy!.payload);
    expect(copyLines.filter((line) => !originalLines.includes(line))).toEqual([
      expect.stringContaining("DUPLICADO"),
    ]);
    expect(originalLines.filter((line) => !copyLines.includes(line))).toEqual([]);
  });

  it("an advance's open correction is listed to a device limited to table 7's zone, and not to one limited to another", async () => {
    const { saleId } = await advanceAt();
    const elsewhere = await otherZone();
    const correctionId = await openCorrection(saleId);
    const listed = async () => {
      const answer = await send(venue.app, zonedTill.cookie, "GET", "/api/invoice-corrections");
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      return (answer.json as { corrections: { id: string }[] }).corrections.map(({ id }) => id);
    };

    await serveOnly(elsewhere);
    const hidden = await listed();
    await serveOnly(venue.zoneId);
    const shown = await listed();

    expect(hidden).not.toContain(correctionId);
    expect(shown).toContain(correctionId);
  });
});

describe("an advance in the day's cash count", () => {
  /** Noon in Madrid (CET, UTC+1) on `day`, well past the venue's 05:00 cutover. */
  function noonOn(day: string): TrustedClock {
    const base = systemClock();
    const instant = new Date(`${day}T11:00:00.000Z`);
    return { ...base, now: () => ({ ...base.now(), instant }) };
  }

  it("the day's cash count counts an advance's cash once", async () => {
    const day = "2026-04-14";
    const { billId } = await bill120();

    const paid = await pay(
      billId,
      { amount: "30.00", method: "cash", tendered: "30.00", applied: "30.00", ownReceipt: true },
      venue.appAt(noonOn(day)),
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await advancesOf(billId)).toHaveLength(1);
    const close = await withTransaction(venue.db, (tx) =>
      computeDailyClose(tx, {
        cutoverChanges: [],
        nodeIds: [venue.cfg.nodeId],
        businessDay: day,
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      }),
    );
    expect(close.cash).toEqual({
      byOrigin: [
        {
          source: "device",
          deviceId: brandDeviceId(venue.deviceId),
          byMethod: [{ method: "cash", amount: "30.00", tip: "0.00" }],
          cashTakings: "30.00",
        },
      ],
      tenderTotal: "30.00",
      tipTotal: "0.00",
    });
  });
});

describe("an advance's clock", () => {
  /** Reads 11:00:00Z on 14 April 2026 first, and one second later on every read after. */
  function steppingClock(): TrustedClock {
    const base = systemClock();
    let next = Date.parse("2026-04-14T11:00:00.000Z");
    return {
      ...base,
      now: () => {
        const instant = new Date(next);
        next += 1000;
        return { ...base.now(), instant };
      },
    };
  }

  async function heldCounterOrder(): Promise<string> {
    const billId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: billId,
      lines: MEAL.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
      zoneId: venue.zoneId,
      operatorId: venue.operatorId,
    });
    return billId;
  }

  it.each(["a table's bill", "a held counter order"])(
    "a cash advance on %s is issued at the one reading its payment was received at",
    async (kind) => {
      const held = kind === "a held counter order";
      const billId = held ? await heldCounterOrder() : (await bill120()).billId;

      const paid = await pay(
        billId,
        {
          amount: "30.00",
          method: "cash",
          tendered: "30.00",
          applied: "30.00",
          ownReceipt: true,
          ...(held
            ? { expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)) }
            : {}),
        },
        venue.appAt(steppingClock()),
      );

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      const [payment] = await paymentRows(venue, billId);
      const [sale] = await inTx(venue, (tx) =>
        tx
          .select({ issuedAt: sales.issuedAt })
          .from(sales)
          .innerJoin(billAdvances, eq(billAdvances.advanceSaleId, sales.id))
          .where(eq(billAdvances.workingOrderId, billId)),
      );
      expect(new Date(sale!.issuedAt).toISOString()).toBe(
        new Date(payment!.receivedAt!).toISOString(),
      );
    },
  );
});

describe("an advance's record to AEAT", () => {
  async function filedDescription(billId: string): Promise<string> {
    const { advanceSaleId } = await onlyAdvance(billId);
    const records = filedInvoicesOf(venue.db, advanceSaleId, new Date());
    expect(records).toHaveLength(1);
    expect(records[0]!.errors).toEqual([]);
    return records[0]!.description;
  }

  async function orderNumberOf(billId: string): Promise<number> {
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    return order!.orderNumber;
  }

  it("describes the operation in its line's Spanish words", async () => {
    const { billId, tableLabel } = await bill120();

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await filedDescription(billId)).toBe(
      spanish.paymentOnAccountAtTable.replace("{table}", tableLabel),
    );
  });

  it("names a table whose name holds a dollar sign as it is written", async () => {
    const tableLabel = `Terraza $& 2 ${randomUUID().slice(0, 8)}`;
    const { billId } = await bill120(tableLabel);

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [before, after] = spanish.paymentOnAccountAtTable.split("{table}");
    expect(await filedDescription(billId)).toBe(`${before}${tableLabel}${after}`);
  });

  it("on a bill with no table, describes it by the bill's order number", async () => {
    const billId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: billId,
      lines: MEAL.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
      zoneId: venue.zoneId,
      operatorId: venue.operatorId,
    });

    const paid = await cash(billId, "30.00", {
      ownReceipt: true,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await filedDescription(billId)).toBe(forOrder(spanish, await orderNumberOf(billId)));
  });

  it("at a table whose name would take the description past AEAT's 500 characters, describes it by the bill's order number", async () => {
    const { billId } = await bill120(`7${"x".repeat(480)}${randomUUID()}`);

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await filedDescription(billId)).toBe(forOrder(spanish, await orderNumberOf(billId)));
  });

  // The words count in code points: each 🍷 is one code point but two UTF-16 units, and it and the
  // em dash are more than one UTF-8 byte, so a copy counting either misplaces the edge.
  it.each([
    { points: 500, describedBy: "table" },
    { points: 501, describedBy: "order" },
  ])(
    "at a table whose name makes the description $points code points, describes it by the $describedBy, and AEAT's record check refuses nothing",
    async ({ points, describedBy }) => {
      const words = (table: string) => spanish.paymentOnAccountAtTable.replace("{table}", table);
      const suffix = `7${randomUUID()}`;
      const fill = points - [...words(suffix)].length;
      const tableLabel = `${"🍷".repeat(fill)}${suffix}`;
      expect([...words(tableLabel)]).toHaveLength(points);
      const { billId } = await bill120(tableLabel);

      const paid = await cash(billId, "30.00", { ownReceipt: true });

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(await filedDescription(billId)).toBe(
        describedBy === "table"
          ? words(tableLabel)
          : forOrder(spanish, await orderNumberOf(billId)),
      );
    },
  );

  it("at a table whose name holds a control character AEAT refuses, describes it by the bill's order number", async () => {
    // Written straight to the table's row; the floor plan's save only trims a label.
    const { billId } = await bill120(`7\u0007${randomUUID()}`);

    const paid = await cash(billId, "30.00", { ownReceipt: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await filedDescription(billId)).toBe(forOrder(spanish, await orderNumberOf(billId)));
  });
});
