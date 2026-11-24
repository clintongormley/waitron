import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  sales,
  workingOrderLines,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { createProduct } from "@waitron/menu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { AppError, centsToDecimal, decimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { failBillPayment } from "./bill-payments.js";
import {
  cashPayment,
  inTx,
  partyRevisionOf,
  paymentRows,
  provisionBillVenue,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import type { Logger } from "./logger.js";
import { observedPaymentBody } from "./testing/bill-payment-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { createTable } from "./testing/live-table.js";
import { openPartyTab } from "./testing/serve-line.js";
import { offerProducts } from "./testing/zone-offers.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// Pay for items on the card reader (A1515 D2): the items move to a bill of their own before the
// card is asked, and go back to the table's bill when it charges nothing.
let venue: BillVenue;
let coffee: string;
let ham: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    // The end-meal route prints the bill only on a till allowed to print receipts.
    await inTx(venue, async (tx) => {
      const [device] = await tx
        .select({ profileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, venue.deviceId));
      const [profile] = await tx
        .select({ capabilities: deviceProfiles.capabilities })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, device!.profileId!));
      await tx
        .update(deviceProfiles)
        .set({ capabilities: [...(profile!.capabilities as string[]), "print-receipt"] })
        .where(eq(deviceProfiles.id, device!.profileId!));
    });
    [coffee, ham] = await inTx(venue, async (tx) => {
      const [{ categoryId }] = await tx.all<{ categoryId: string }>(
        sql`select category_id as categoryId from products where name = 'Tarta'`,
      );
      const product = (name: string, unitPrice: string, pricingUnit: "each" | "weight") =>
        createProduct(tx, {
          categoryId: categoryId!,
          name,
          customerName: { es: `${name} (customer)` },
          kitchenName: name.toUpperCase(),
          pricingUnit,
          unitPrice,
          vatClass: "general",
        });
      const coffeeProduct = await product("Coffee", "3.00", "each");
      // By the kilo: 0.050 kg is 1.01.
      const hamProduct = await product("Ham", "20.20", "weight");
      const offers = await offerProducts(tx, { zone: "tables" });
      return [offers.offerFor(coffeeProduct.id), offers.offerFor(hamProduct.id)];
    });
  },
});

/** A table's bill holding a coffee (3.00) and a Tarta (18.00). */
const coffeeAndTarta = () =>
  withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      lines: [coffee, venue.offerFor("Tarta")].map((menuItemId) => ({
        menuItemId,
        quantity: "1",
      })),
    });
    return tabId;
  });

/** A table's bill holding a coffee (3.00) and 0.050 kg of ham (1.01). */
const coffeeAndHam = () =>
  withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      lines: [
        { menuItemId: coffee, quantity: "1" },
        { menuItemId: ham, quantity: "0.050" },
      ],
    });
    return tabId;
  });

/** Pays for 0.020 kg of the ham (0.40) by reader. */
async function someHamByReader(sourceId: string) {
  const body = await tartaByReaderBody(sourceId);
  return sendItemsPayment(sourceId, {
    ...body,
    picks: [{ lineId: await lineIdOf(sourceId, 2), quantity: "0.020" }],
    applied: "0.40",
  });
}

async function lineIdOf(billId: string, lineNo: number): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      ),
  );
  return row!.id;
}

/** The request paying for the Tarta by reader, as the till would send it now. */
async function tartaByReaderBody(sourceId: string) {
  const [party] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, sourceId)),
  );
  return {
    submissionId: randomUUID(),
    picks: [{ lineId: await lineIdOf(sourceId, 2) }],
    partyId: party!.partyId,
    expectedPartyRevision: await partyRevisionOf(venue, sourceId),
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, sourceId))],
    method: "card",
    entry: "reader",
    applied: "18.00",
    tip: "0.00",
  };
}

/** Prints the bill through the till's end-meal route, which places it. */
async function printBill(billId: string) {
  const [bill] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return send(venue.app, venue.cookie, "POST", `/api/parties/${bill!.partyId}/end-meal`, {
    billId,
    expectedPartyRevision: await partyRevisionOf(venue, billId),
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, billId))],
    submissionId: randomUUID(),
    printAnyway: true,
  });
}

function sendItemsPayment(sourceId: string, body: unknown, app = venue.app) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${sourceId}/item-payments`, body);
}

async function payTartaByReader(sourceId: string) {
  return sendItemsPayment(sourceId, await tartaByReaderBody(sourceId));
}

/** Starts paying for the Tarta with the reader's collect held; answers the request, its release and
 * the new bill. */
async function heldTartaPayment(sourceId: string) {
  const release = venue.card.holdNextCollect();
  const calls = venue.card.collectCalls.length;
  const answer = payTartaByReader(sourceId);
  await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
  return { answer, release, newBill: await billNaming(sourceId) };
}

async function billNaming(sourceId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.itemsPaidFrom, sourceId)),
  );
  return row!.id;
}

async function lineTotals(billId: string): Promise<string[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ lineTotal: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  return rows.map(({ lineTotal }) => centsToDecimal(lineTotal));
}

async function invoiceCount(billId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return rows.length;
}

/** A cash contribution of `amount` to the bill, as the till sends it. */
async function contribute(billId: string, amount: string) {
  const path = `/api/working-orders/${billId}/payments`;
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    path,
    await observedPaymentBody(venue.db, path, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    }),
  );
  expect(answer.status).toBe(200);
}

function balance(billId: string) {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

const settle = (cfg = venue.cfg) =>
  settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg,
  });

/** A card left pending by a reader that stopped answering, whose provider then said, unasked by a
 * person, that it charged nothing. */
async function stuckThenFailed(sourceId: string): Promise<{ newBill: string; paymentId: string }> {
  venue.card.stallNextCollect();
  const answer = await payTartaByReader(sourceId);
  expect(answer.json).toMatchObject({ payment: { outcome: "timeout" } });
  const newBill = await billNaming(sourceId);
  const [payment] = await paymentRows(venue, newBill);
  await inTx(venue, (tx) =>
    tx
      .update(payments)
      .set({
        state: "failed",
        resolvedBy: null,
        resolutionOutcome: "failed",
        resolutionCancelledAtProvider: true,
        resolutionProviderStatus: "canceled",
        resolvedAt: venue.clock.now().instant.toISOString(),
      })
      .where(eq(payments.billPaymentId, payment!.id)),
  );
  return { newBill, paymentId: payment!.id };
}

describe("A1515 pay for items on the card reader", () => {
  it("a captured card issues the new bill's ticket", async () => {
    const sourceId = await coffeeAndTarta();

    const paid = await payTartaByReader(sourceId);

    expect(paid.status).toBe(200);
    const newBill = paid.json.billId as string;
    expect(paid.json.payment).toMatchObject({
      outcome: "received",
      invoice: { total: "18.00" },
      balance: { workingOrderId: newBill, status: "settled" },
    });
    expect(await lineTotals(sourceId)).toEqual(["3.00"]);
    expect(await statusOf(venue, sourceId)).toBe("open");
    expect(await invoiceCount(newBill)).toBe(1);
  });

  it("a declined card puts the items back", async () => {
    const sourceId = await coffeeAndTarta();
    const { answer, release, newBill } = await heldTartaPayment(sourceId);
    const partyDuring = await partyRevisionOf(venue, sourceId);
    venue.card.failNextCollect();
    release();

    const paid = await answer;

    expect(paid.status).toBe(200);
    expect(paid.json.billId).toBe(newBill);
    expect(paid.json.payment).toMatchObject({
      outcome: "declined",
      payment: { state: "failed" },
    });
    expect(await lineTotals(sourceId)).toEqual(["3.00", "18.00"]);
    expect((await balance(sourceId)).json).toMatchObject({ total: "21.00", outstanding: "21.00" });
    expect(await statusOf(venue, newBill)).toBe("abandoned");
    expect(await lineTotals(newBill)).toEqual([]);
    expect(await invoiceCount(newBill)).toBe(0);
    expect(await partyRevisionOf(venue, sourceId)).toBeGreaterThan(partyDuring);
  });

  it("a declined card leaves a source the move left paid open, with no invoice", async () => {
    const sourceId = await coffeeAndTarta();
    await contribute(sourceId, "3.00");
    venue.card.failNextCollect();

    const paid = await payTartaByReader(sourceId);

    expect(paid.json.payment).toMatchObject({ outcome: "declined" });
    expect(await invoiceCount(sourceId)).toBe(0);
    expect(await statusOf(venue, sourceId)).toBe("open");
    expect(await lineTotals(sourceId)).toEqual(["3.00", "18.00"]);
    expect((await balance(sourceId)).json).toMatchObject({ total: "21.00", outstanding: "18.00" });
    expect(await statusOf(venue, paid.json.billId as string)).toBe("abandoned");
  });

  it("a captured card issues a source the move left paid, and the new bill, once each", async () => {
    const sourceId = await coffeeAndTarta();
    await contribute(sourceId, "3.00");

    const paid = await payTartaByReader(sourceId);

    expect(paid.json.payment).toMatchObject({ outcome: "received" });
    expect(await invoiceCount(sourceId)).toBe(1);
    expect(await invoiceCount(paid.json.billId as string)).toBe(1);
    expect(await statusOf(venue, sourceId)).toBe("settled");
  });

  it("a stuck card settled later as charged issues a source the move left paid", async () => {
    const sourceId = await coffeeAndTarta();
    await contribute(sourceId, "3.00");
    venue.card.stallNextCollect();
    const answer = await payTartaByReader(sourceId);
    expect(answer.json).toMatchObject({ payment: { outcome: "timeout" } });
    expect(await invoiceCount(sourceId)).toBe(0);
    const newBill = await billNaming(sourceId);
    const [payment] = await paymentRows(venue, newBill);
    await inTx(venue, (tx) =>
      tx
        .update(payments)
        .set({ state: "captured", settledAt: venue.clock.now().instant.toISOString() })
        .where(eq(payments.billPaymentId, payment!.id)),
    );

    await settle();

    expect(await invoiceCount(newBill)).toBe(1);
    expect(await invoiceCount(sourceId)).toBe(1);
    expect(await statusOf(venue, sourceId)).toBe("settled");
  });

  it("a captured card for part of a weighed line charges the part and leaves the source the rest", async () => {
    const sourceId = await coffeeAndHam();

    const paid = await someHamByReader(sourceId);

    expect(paid.json.payment).toMatchObject({ outcome: "received", invoice: { total: "0.40" } });
    expect(await lineTotals(sourceId)).toEqual(["3.00", "0.61"]);
    expect((await balance(sourceId)).json).toMatchObject({ total: "3.61", outstanding: "3.61" });
  });

  it("a declined card for part of a weighed line leaves the source costing what it did", async () => {
    const sourceId = await coffeeAndHam();
    venue.card.failNextCollect();

    const paid = await someHamByReader(sourceId);

    expect(paid.json.payment).toMatchObject({ outcome: "declined" });
    expect(await lineTotals(sourceId)).toEqual(["3.00", "0.61", "0.40"]);
    expect((await balance(sourceId)).json).toMatchObject({ total: "4.01", outstanding: "4.01" });
  });

  it("part of a weighed line whose part and rest would cost more than it is refused", async () => {
    const sourceId = await coffeeAndHam();
    const body = await tartaByReaderBody(sourceId);
    const calls = venue.card.collectCalls.length;

    const paid = await sendItemsPayment(sourceId, {
      ...body,
      picks: [{ lineId: await lineIdOf(sourceId, 2), quantity: "0.025" }],
      applied: "0.51",
    });

    expect(paid.status).toBe(400);
    expect(paid.json).toMatchObject({ code: "tab.transfer_quantity_invalid" });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect((await balance(sourceId)).json).toMatchObject({ total: "4.01" });
  });

  it("a declined card is logged as a failed collection", async () => {
    const log = vi.fn<Logger>();
    const sourceId = await coffeeAndTarta();
    venue.card.failNextCollect();

    await sendItemsPayment(sourceId, await tartaByReaderBody(sourceId), venue.appWith({ log }));

    expect(log).toHaveBeenCalledWith(
      "warn",
      "payment.collection_failed",
      expect.objectContaining({ orderId: sourceId, outcome: "declined" }),
    );
  });

  it("while the card is awaited the items are on the new bill", async () => {
    const sourceId = await coffeeAndTarta();
    const { answer, release, newBill } = await heldTartaPayment(sourceId);

    const during = await balance(sourceId);
    const [numbered] = await inTx(venue, (tx) =>
      tx
        .select({ billNumber: workingOrders.billNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, newBill)),
    );
    const write = inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, newBill, [{ menuItemId: coffee, quantity: "1" }]),
    );
    await expect(write).rejects.toMatchObject({ code: "order.payment_in_flight" });
    release();
    await answer;

    expect(during.json).toMatchObject({
      total: "3.00",
      beingPaidOn: { billId: newBill, billNumber: numbered!.billNumber },
    });
    expect((await balance(sourceId)).json).not.toHaveProperty("beingPaidOn");
  });

  it("a stuck card settled later as failed puts the items back", async () => {
    const sourceId = await coffeeAndTarta();
    const { newBill, paymentId } = await stuckThenFailed(sourceId);

    await settle();

    expect((await paymentRows(venue, newBill)).find((row) => row.id === paymentId)).toMatchObject({
      state: "failed",
    });
    expect(await lineTotals(sourceId)).toEqual(["3.00", "18.00"]);
    expect(await statusOf(venue, newBill)).toBe("abandoned");
    expect(await invoiceCount(newBill)).toBe(0);
  });

  it.each([
    [
      "printed",
      async (sourceId: string) => {
        const printed = await printBill(sourceId);
        expect(printed.status).toBe(200);
        return "placed";
      },
    ],
    [
      "paid",
      async (sourceId: string) => {
        expect((await cashPayment(venue, venue.cookie, sourceId, "3.00")).status).toBe(200);
        return "settled";
      },
    ],
  ])(
    "a source %s while the card is awaited keeps the items on their own bill",
    async (_, close) => {
      const sourceId = await coffeeAndTarta();
      const { answer, release, newBill } = await heldTartaPayment(sourceId);
      venue.card.failNextCollect();
      const closed = await close(sourceId);
      release();
      const paid = await answer;

      expect(paid.json.payment).toMatchObject({ outcome: "declined" });
      expect(await statusOf(venue, sourceId)).toBe(closed);
      expect(await lineTotals(sourceId)).toEqual(["3.00"]);
      expect(await paymentRows(venue, newBill)).toMatchObject([{ state: "failed" }]);
      expect(await statusOf(venue, newBill)).toBe("open");
      expect(await lineTotals(newBill)).toEqual(["18.00"]);
    },
  );

  it("the same request sent again after an accepted card answers the same bill, charged once", async () => {
    const sourceId = await coffeeAndTarta();
    const body = await tartaByReaderBody(sourceId);
    const calls = venue.card.collectCalls.length;

    const first = await sendItemsPayment(sourceId, body);
    const again = await sendItemsPayment(sourceId, body);

    expect(first.json.payment).toMatchObject({ outcome: "received" });
    expect(again.status).toBe(200);
    expect(again.json.billId).toBe(first.json.billId);
    expect(again.json.payment).toMatchObject({ outcome: "received", invoice: { total: "18.00" } });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await invoiceCount(first.json.billId as string)).toBe(1);
    expect(await lineTotals(sourceId)).toEqual(["3.00"]);
  });

  it("the same request sent again after a declined card answers the same bill, charged once", async () => {
    const sourceId = await coffeeAndTarta();
    const body = await tartaByReaderBody(sourceId);
    const calls = venue.card.collectCalls.length;
    venue.card.failNextCollect();

    const first = await sendItemsPayment(sourceId, body);
    const again = await sendItemsPayment(sourceId, body);

    expect(first.json.payment).toMatchObject({ outcome: "declined" });
    expect(again.status).toBe(200);
    expect(again.json.billId).toBe(first.json.billId);
    expect(again.json.payment).toMatchObject({
      outcome: "declined",
      payment: { state: "failed" },
    });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await lineTotals(sourceId)).toEqual(["3.00", "18.00"]);
    const named = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(eq(workingOrders.itemsPaidFrom, sourceId)),
    );
    expect(named).toHaveLength(1);
  });

  it("a refused put-back still fails the payment", async () => {
    const sourceId = await coffeeAndTarta();
    const { newBill, paymentId } = await stuckThenFailed(sourceId);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let warned: unknown[][] = [];
    await settle({ ...venue.cfg, simplifiedInvoiceLimit: decimal("20.00") }).finally(() => {
      warned = [...warn.mock.calls];
      warn.mockRestore();
    });

    expect(warned).toContainEqual([
      "payment.items_put_back_refused",
      {
        billPaymentId: paymentId,
        workingOrderId: newBill,
        itemsPaidFrom: sourceId,
        code: "sale.total_exceeds_simplified_limit",
      },
    ]);

    expect((await paymentRows(venue, newBill)).find((row) => row.id === paymentId)).toMatchObject({
      state: "failed",
    });
    expect(await statusOf(venue, newBill)).toBe("open");
    expect(await lineTotals(newBill)).toEqual(["18.00"]);
    expect(await lineTotals(sourceId)).toEqual(["3.00"]);
  });

  it("a refused put-back issues a source its own payments already cover", async () => {
    const sourceId = await coffeeAndTarta();
    await contribute(sourceId, "3.00");
    const { newBill } = await stuckThenFailed(sourceId);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await settle({ ...venue.cfg, simplifiedInvoiceLimit: decimal("20.00") }).finally(() =>
      warn.mockRestore(),
    );

    expect(await lineTotals(newBill)).toEqual(["18.00"]);
    expect(await statusOf(venue, sourceId)).toBe("settled");
    expect(await invoiceCount(sourceId)).toBe(1);
    expect(await invoiceCount(newBill)).toBe(0);
  });

  it("a later payment on the items' own bill that fails moves nothing back", async () => {
    const sourceId = await coffeeAndTarta();
    const { newBill } = await stuckThenFailed(sourceId);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await settle({ ...venue.cfg, simplifiedInvoiceLimit: decimal("20.00") }).finally(() =>
      warn.mockRestore(),
    );
    expect(await lineTotals(newBill)).toEqual(["18.00"]);
    await inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, newBill, [{ menuItemId: coffee, quantity: "1" }]),
    );
    const path = `/api/working-orders/${newBill}/payments`;
    venue.card.failNextCollect();

    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedPaymentBody(venue.db, path, {
        submissionId: randomUUID(),
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        applied: "21.00",
        tip: "0.00",
      }),
    );

    expect(paid.json).toMatchObject({ outcome: "declined" });
    expect(await statusOf(venue, newBill)).toBe("open");
    expect(await lineTotals(newBill)).toEqual(["18.00", "3.00"]);
    expect(await lineTotals(sourceId)).toEqual(["3.00"]);
  });

  it("a full disk during the put-back escapes, never absorbed as a refusal", async () => {
    const sourceId = await coffeeAndTarta();
    const { newBill, paymentId } = await stuckThenFailed(sourceId);

    const failing = inTx(venue, (tx) => {
      let inSavepoint = false;
      const full = new Proxy(tx, {
        get(target, prop) {
          if (prop === "transaction")
            return (...args: Parameters<Transaction["transaction"]>) => {
              inSavepoint = true;
              return target.transaction(...args);
            };
          if (prop === "update" && inSavepoint)
            return () => {
              throw new AppError("storage.disk_full", {});
            };
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return failBillPayment(
        full,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        venue.cfg,
        paymentId,
        venue.clock.now().instant,
      );
    });

    await expect(failing).rejects.toMatchObject({ code: "storage.disk_full" });
    expect((await paymentRows(venue, newBill)).find((row) => row.id === paymentId)).toMatchObject({
      state: "pending",
    });
    expect(await lineTotals(newBill)).toEqual(["18.00"]);
  });
});
