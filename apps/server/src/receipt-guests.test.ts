import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  invoiceSeries,
  saleReceiptGuests,
  sales,
  tenants,
  workingOrders,
} from "@waitron/db";
import { recordSale } from "@waitron/core";
import {
  AppError,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { completeBillPayment } from "./bill-payments.js";
import { mergeBills, transferItems } from "./testing/bill-action-fixture.js";
import { setPartyGuests } from "./parties.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import {
  readGuestsChoice,
  readPrintedGuests,
  readReceiptGuests,
  recordReceiptGuests,
  type RecordedSale,
} from "./receipt-guests.js";
import {
  OPERATOR,
  commandFor,
  counterOrder,
  inTx,
  join,
  linesOf,
  nextMillisecond,
  orderForParty,
  partyRow,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

/** Pays the bill in cash and answers the default guests (`readReceiptGuests`) read just after. */
async function guestsOnPaying(billId: string, amount: string): Promise<number | undefined> {
  await pay(v, billId, amount);
  return inTx(v, async (tx) => {
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, billId));
    return readReceiptGuests(tx, sale!.id);
  });
}

async function joinOther(
  partyId: string,
  tableId: string,
  otherPartyId: string,
  bills: "merge" | "separate",
) {
  await nextMillisecond();
  const options = {
    bills,
    expectedPartyRevision: await revisionOf(v, partyId),
    otherPartyId,
    expectedOtherPartyRevision: await revisionOf(v, otherPartyId),
    operatorId: OPERATOR,
  };
  await inTx(v, (tx) => joinTables(tx, v.cfg, partyId, tableId, options));
}

describe("the default guests (readReceiptGuests)", () => {
  it("prints a party's count on its one bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 1"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await guestsOnPaying(tabId, "12.00")).toBe(4);
  });

  it("prints nothing for a party seated with no count", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 2"));
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await guestsOnPaying(tabId, "12.00")).toBeUndefined();
  });

  it("prints nothing for a counter sale", async () => {
    const orderId = await counterOrder(v, "Burger");

    expect(await guestsOnPaying(orderId, "12.00")).toBeUndefined();
  });

  it("prints nothing on either bill of a party that split a dish onto a second bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 4"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);

    expect(await guestsOnPaying(second, "30.00")).toBeUndefined();
    expect(await guestsOnPaying(tabId, "12.00")).toBeUndefined();
  });

  it("prints the count again once the split bill is merged back", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 5"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));

    expect(await guestsOnPaying(tabId, "42.00")).toBe(4);
  });

  it("prints the sum on joined tables whose bills were merged", async () => {
    const mesa4 = await v.table("Invitados 6a 4");
    const mesa5 = await v.table("Invitados 6a 5");
    const four = await seat(v, mesa4, 2);
    const five = await seat(v, mesa5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, mesa5, five.partyId, "merge");

    expect(await guestsOnPaying(four.tabId, "32.00")).toBe(5);
  });

  it("prints nothing on joined tables whose bills were kept separate", async () => {
    const mesa4 = await v.table("Invitados 6b 4");
    const mesa5 = await v.table("Invitados 6b 5");
    const four = await seat(v, mesa4, 2);
    const five = await seat(v, mesa5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, mesa5, five.partyId, "separate");

    expect(await guestsOnPaying(five.tabId, "20.00")).toBeUndefined();
    expect(await guestsOnPaying(four.tabId, "12.00")).toBeUndefined();
  });

  it("prints nothing on a bill paid by a party afterwards merged into another", async () => {
    const xTable = await v.table("Invitados 7 X");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, await v.table("Invitados 7 Y"), 3);
    await joinOther(y.partyId, xTable, x.partyId, "merge");

    expect((await partyRow(v, x.partyId)).mergedIntoPartyId).toBe(y.partyId);
    const [sale] = await inTx(v, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, x.tabId)),
    );
    expect(await inTx(v, (tx) => readReceiptGuests(tx, sale!.id))).toBeUndefined();
  });

  it("prints a count changed after seating", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 8"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) => setPartyGuests(tx, { partyId, guestCount: 6, expectedPartyRevision }));

    expect(await guestsOnPaying(tabId, "12.00")).toBe(6);
  });

  it("prints nothing for a party that joined a table whose party had already paid", async () => {
    const xTable = await v.table("Invitados 9 X");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, await v.table("Invitados 9 Y"), 3);
    await orderForParty(v, y.partyId, ["Paella"], y.tabId);
    await joinOther(y.partyId, xTable, x.partyId, "merge");

    expect((await partyRow(v, y.partyId)).guestCount).toBe(5);
    expect(await guestsOnPaying(y.tabId, "20.00")).toBeUndefined();
  });

  it("prints each side's count after Split a table", async () => {
    const mesa4 = await v.table("Invitados 10 4");
    const mesa5 = await v.table("Invitados 10 5");
    const { partyId, tabId } = await seat(v, mesa4, 4);
    await join(v, partyId, mesa5);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      splitTable(tx, v.cfg, partyId, mesa5, second, {
        ...command,
        guests: { staying: 3, leaving: 1 },
      }),
    );

    expect(await guestsOnPaying(tabId, "12.00")).toBe(3);
    expect(await guestsOnPaying(second, "30.00")).toBe(1);
  });

  it("prints nothing while an emptied split bill stays open", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Invitados 11"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const [moved] = await linesOf(v, second);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      transferItems(tx, v.cfg, second, tabId, [{ lineNo: moved!.lineNo }], command),
    );

    expect(await guestsOnPaying(tabId, "42.00")).toBeUndefined();
  });
});

async function saleOf(billId: string): Promise<string> {
  const [sale] = await inTx(v, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return sale!.id;
}

/**
 * A sale of one dish (a Burger at 12,00 € unless another is named) paid in cash on the bill,
 * recorded straight through `recordSale` so that no guests row is written beside it, as the till's
 * payment paths write one for a simplified sale.
 */
async function saleWithNoRow(
  billId: string,
  { name = "Burger", price = "12.00", vatRate = "10.00" } = {},
): Promise<string> {
  return inTx(v, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, v.cfg.nodeId), eq(invoiceSeries.purpose, "standard")));
    const { saleId } = await recordSale(tx, v.backend, {
      origin: v.cfg.origin,
      nodeId: v.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      workingOrderId: brandWorkingOrderId(billId),
      locale: v.cfg.locale,
      invoiceLocales: v.cfg.invoiceLocales,
      total: price,
      lines: [
        {
          lineNo: 1,
          name,
          descriptions: { [v.cfg.locale]: name },
          quantity: "1",
          unitPrice: price,
          vatRate,
          lineTotal: price,
        },
      ],
      clock: v.clock,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: price, tipAmount: "0.00", settledAt: new Date() }],
      },
    });
    return saleId;
  });
}

/** The sale, with no guests row, of a party of 4 that paid one Burger at 12,00 € on its one bill. */
async function paidPartyOfFour(
  label: string,
): Promise<{ partyId: string; tabId: string; saleId: string }> {
  const { partyId, tabId } = await seat(v, await v.table(label), 4);
  await orderForParty(v, partyId, ["Burger"], tabId);
  return { partyId, tabId, saleId: await saleWithNoRow(tabId) };
}

/**
 * A party of 4's one bill issued as a full invoice. No till route files one, so the bill is saved
 * as F1 and a bill payment covering it is inserted by hand and completed.
 */
async function fullInvoiceOfFour(label: string): Promise<{ billId: string; saleId: string }> {
  const { partyId, tabId } = await seat(v, await v.table(label), 4);
  await orderForParty(v, partyId, ["Burger"], tabId);
  await inTx(v, async (tx) => {
    await tx.update(tenants).set({ taxpayerDomicile: "Carrer 1, 08001 Barcelona" });
    await tx
      .update(workingOrders)
      .set({
        invoiceType: "F1",
        recipientTaxId: "B12345674",
        recipientLegalName: "Client SL",
        recipientAddress: "Calle Mayor 2, 08001 Barcelona, Barcelona, España",
        recipientCountryCode: "ES",
      })
      .where(eq(workingOrders.id, tabId));
    const [payment] = await tx
      .insert(billPayments)
      .values({
        workingOrderId: tabId,
        submissionId: randomUUID(),
        fingerprint: `receipt-guests-full-invoice-${label}`,
        kind: "contribution",
        method: "cash",
        applied: 1200,
        tendered: 1200,
        state: "pending",
        requestedBy: v.operator.personId,
        source: v.cfg.origin.source,
        deviceId: v.cfg.origin.deviceId,
      })
      .returning();
    const { invoice } = await completeBillPayment(
      tx,
      { db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      payment!.id,
      new Date(),
    );
    expect(invoice?.invoiceType).toBe("F1");
  });
  return { billId: tabId, saleId: await saleOf(tabId) };
}

/** A sale `recordSale` filed with no counterparty, as {@link saleWithNoRow} files one. */
function simplifiedSale(saleId: string, workingOrderId: string): RecordedSale {
  return { saleId, workingOrderId, counterparty: null };
}

async function storedRows(saleId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ guests: saleReceiptGuests.guests })
      .from(saleReceiptGuests)
      .where(eq(saleReceiptGuests.saleId, saleId)),
  );
}

async function storeRow(saleId: string, guests: number | null): Promise<void> {
  await inTx(v, (tx) => tx.insert(saleReceiptGuests).values({ saleId, guests }));
}

async function printed(saleId: string): Promise<number | undefined> {
  return inTx(v, (tx) => readPrintedGuests(tx, saleId));
}

describe("a payment request's guests", () => {
  it.each([undefined, null, 1, 4, 999])("accepts %s as itself", (value) => {
    expect(readGuestsChoice(value)).toBe(value);
  });

  it.each([[0], [1000], [2.5], [-1], ["4"], [true], [{}], [[]]])("refuses %j", (value) => {
    let thrown: unknown;
    try {
      readGuestsChoice(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("management.request_invalid");
    expect((thrown as AppError).params).toEqual({ field: "guests" });
  });
});

describe("the guests row written beside a recorded sale", () => {
  it("writes the count the request chose", async () => {
    const { tabId, saleId } = await paidPartyOfFour("Fila 1");
    await inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, tabId), 5));
    expect(await storedRows(saleId)).toEqual([{ guests: 5 }]);
  });

  it("writes no line when the request chose none", async () => {
    const { tabId, saleId } = await paidPartyOfFour("Fila 2");
    await inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, tabId), null));
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("writes the party's count when the request sent none", async () => {
    const { tabId, saleId } = await paidPartyOfFour("Fila 3");
    await inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, tabId), undefined));
    expect(await storedRows(saleId)).toEqual([{ guests: 4 }]);
  });

  it("writes no line when the request sent none and the party's count is above 999", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Fila 1000"), 1000);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const saleId = await saleWithNoRow(tabId);
    await inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, tabId), undefined));
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("writes no line by default for a party that split a dish onto a second bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Fila 4"), 4);
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const saleId = await saleWithNoRow(second, { name: "Vino", price: "30.00", vatRate: "21.00" });
    await inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, second), undefined));
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("writes no line by default for a counter sale", async () => {
    const orderId = await counterOrder(v, "Burger");
    const saleId = await saleWithNoRow(orderId);
    await inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, orderId), undefined));
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("never clamps a sent count: 1000 is refused by the table's rule and writes nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Fila 1001"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const saleId = await saleWithNoRow(tabId);
    await expect(
      inTx(v, (tx) => recordReceiptGuests(tx, simplifiedSale(saleId, tabId), 1000)),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await storedRows(saleId)).toEqual([]);
  });

  it("writes nothing for a full invoice", async () => {
    const { billId, saleId } = await fullInvoiceOfFour("Fila 6");
    const counterparty = { taxId: "B12345674", legalName: "Client SL", countryCode: "ES" };
    await inTx(v, (tx) =>
      recordReceiptGuests(tx, { saleId, workingOrderId: billId, counterparty }, 5),
    );
    expect(await storedRows(saleId)).toEqual([]);
  });
});

describe("the guests a paper receipt of a sale prints", () => {
  it("prints the party's count for a sale with no row", async () => {
    const { saleId } = await paidPartyOfFour("Papel 1");
    expect(await printed(saleId)).toBe(4);
  });

  it("prints the stored count", async () => {
    const { saleId } = await paidPartyOfFour("Papel 2");
    await storeRow(saleId, 5);
    expect(await printed(saleId)).toBe(5);
  });

  it("prints no line when the row says none", async () => {
    const { saleId } = await paidPartyOfFour("Papel 3");
    await storeRow(saleId, null);
    expect(await printed(saleId)).toBeUndefined();
  });

  it("keeps the stored count after the party's count changes", async () => {
    const { partyId, saleId } = await paidPartyOfFour("Papel 4");
    await storeRow(saleId, 5);
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) => setPartyGuests(tx, { partyId, guestCount: 6, expectedPartyRevision }));
    expect((await partyRow(v, partyId)).guestCount).toBe(6);
    expect(await printed(saleId)).toBe(5);
  });

  it("prints a counter sale's stored count", async () => {
    const orderId = await counterOrder(v, "Burger");
    const saleId = await saleWithNoRow(orderId);
    await storeRow(saleId, 3);
    expect(await printed(saleId)).toBe(3);
  });

  // A probe of the read: no product path writes a row for a full invoice.
  it("prints a full invoice's party count even beside a row", async () => {
    const { saleId } = await fullInvoiceOfFour("Papel 6");
    await storeRow(saleId, 5);
    expect(await printed(saleId)).toBe(4);
  });
});
