import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPayments, invoiceSeries, parties, sales, taxpayer, workingOrders } from "@waitron/db";
import { recordSale } from "@waitron/core";
import {
  AppError,
  defaultGuestCount,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { completeBillPayment } from "./bill-payments.js";
import { mergeBills, transferItems } from "./testing/bill-action-fixture.js";
import { setPartyGuestCount } from "./parties.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import {
  readGuestCountChoice,
  readPrintedGuests,
  readReceiptGuests,
  saleReceiptFacts,
  type GuestCountChoice,
} from "./receipt-guests.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  counterOrder,
  floorRow,
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
  statusOf,
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

/** With `mergeInto`, Merge bills then merges `from` into `into` in the same transaction. */
async function joinOther(
  partyId: string,
  tableId: string,
  otherPartyId: string,
  mergeInto?: { into: string; from: string },
) {
  await nextMillisecond();
  const options = {
    expectedPartyRevision: await revisionOf(v, partyId),
    otherPartyId,
    expectedOtherPartyRevision: await revisionOf(v, otherPartyId),
    operatorId: OPERATOR,
  };
  await inTx(v, async (tx) => {
    await joinTables(tx, v.cfg, partyId, tableId, options);
    if (mergeInto === undefined) return;
    const [party] = await tx
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, partyId));
    await mergeBills(tx, v.cfg, mergeInto.into, mergeInto.from, {
      partyId,
      expectedPartyRevision: party!.revision,
      operatorId: OPERATOR,
    });
  });
}

describe("the default guests (readReceiptGuests)", () => {
  it("prints a party's count on its one bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Guests 1"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await guestsOnPaying(tabId, "12.00")).toBe(4);
  });

  it("prints nothing for a party seated with no count", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Guests 2"));
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await guestsOnPaying(tabId, "12.00")).toBeUndefined();
  });

  it("prints nothing for a counter sale", async () => {
    const orderId = await counterOrder(v, "Burger");

    expect(await guestsOnPaying(orderId, "12.00")).toBeUndefined();
  });

  it("prints nothing on either bill of a party that split a dish onto a second bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Guests 4"), 4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const second = await split(v, partyId, tabId, [2]);

    expect(await guestsOnPaying(second, "30.00")).toBeUndefined();
    expect(await guestsOnPaying(tabId, "12.00")).toBeUndefined();
    expect([await statusOf(v, second), await statusOf(v, tabId)]).toEqual(["settled", "settled"]);
  });

  it("prints the count again once the split bill is merged back", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Guests 5"), 4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));

    expect(await guestsOnPaying(tabId, "42.00")).toBe(4);
  });

  it("prints the sum on joined tables whose bills were merged", async () => {
    const table4 = await v.table("Guests 6a 4");
    const table5 = await v.table("Guests 6a 5");
    const four = await seat(v, table4, 2);
    const five = await seat(v, table5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, table5, five.partyId, {
      into: four.tabId,
      from: five.tabId,
    });

    expect(await guestsOnPaying(four.tabId, "32.00")).toBe(5);
  });

  it("prints nothing on joined tables, each keeping its bill", async () => {
    const table4 = await v.table("Guests 6b 4");
    const table5 = await v.table("Guests 6b 5");
    const four = await seat(v, table4, 2);
    const five = await seat(v, table5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, table5, five.partyId);

    expect(await guestsOnPaying(five.tabId, "20.00")).toBeUndefined();
    expect(await guestsOnPaying(four.tabId, "12.00")).toBeUndefined();
  });

  it("prints nothing on a bill paid by a party afterwards merged into another", async () => {
    const xTable = await v.table("Guests 7 X");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, await v.table("Guests 7 Y"), 3);
    await joinOther(y.partyId, xTable, x.partyId);

    expect((await partyRow(v, x.partyId)).mergedIntoPartyId).toBe(y.partyId);
    const [sale] = await inTx(v, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, x.tabId)),
    );
    expect(await inTx(v, (tx) => readReceiptGuests(tx, sale!.id))).toBeUndefined();
  });

  it("prints a count changed after seating", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Guests 8"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      setPartyGuestCount(tx, { partyId, guestCount: 6, expectedPartyRevision }),
    );

    expect(await guestsOnPaying(tabId, "12.00")).toBe(6);
  });

  it("prints nothing for a party that joined a table whose party had already paid", async () => {
    const xTable = await v.table("Guests 9 X");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, await v.table("Guests 9 Y"), 3);
    await orderForParty(v, y.partyId, ["Paella"], y.tabId);
    await joinOther(y.partyId, xTable, x.partyId);

    expect((await partyRow(v, y.partyId)).guestCount).toBe(5);
    expect(await guestsOnPaying(y.tabId, "20.00")).toBeUndefined();
  });

  it("prints each side's count after Split a table", async () => {
    const table4 = await v.table("Guests 10 4");
    const table5 = await v.table("Guests 10 5");
    const { partyId, tabId } = await seat(v, table4, 4);
    await join(v, partyId, table5);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) =>
      splitTable(tx, v.cfg, partyId, table5, second, {
        ...command,
        guestCounts: { staying: 3, leaving: 1 },
      }),
    );
    expect(await activeTablesOf(v, partyId)).toEqual([table4]);
    expect(await activeTablesOf(v, (await billRow(v, second)).partyId!)).toEqual([table5]);

    expect(await guestsOnPaying(tabId, "12.00")).toBe(3);
    expect(await guestsOnPaying(second, "30.00")).toBe(1);
  });

  it("prints nothing while an emptied split bill stays open", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Guests 11"), 4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
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

async function recordFixtureSale(
  billId: string,
  { name = "Burger", price = "12.00", vatRate = "10.00" } = {},
  receipt?: { choice: GuestCountChoice },
): Promise<string> {
  return inTx(v, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, v.cfg.nodeId), eq(invoiceSeries.purpose, "standard")));
    const { saleId } = await recordSale(tx, v.backend, {
      ...(receipt && { receipt: await saleReceiptFacts(tx, billId, null, receipt.choice) }),
      operationDescription: "Restaurante",
      origin: v.cfg.origin,
      nodeId: v.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      workingOrderId: brandWorkingOrderId(billId),
      locale: v.cfg.locale,
      invoiceLocales: [v.cfg.locale],
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

/** The sale, of a party of 4 that paid one Burger at 12,00 € on its one bill. */
async function paidPartyOfFour(
  label: string,
  receipt?: { choice: GuestCountChoice },
): Promise<{ partyId: string; tabId: string; saleId: string }> {
  const { partyId, tabId } = await seat(v, await v.table(label), 4);
  await orderForParty(v, partyId, ["Burger"], tabId);
  return { partyId, tabId, saleId: await recordFixtureSale(tabId, undefined, receipt) };
}

/**
 * A party of 4's one bill issued as a full invoice. No till route files one, so the bill is saved
 * as F1 and a bill payment covering it is inserted by hand and completed.
 */
async function fullInvoiceOfFour(label: string): Promise<{ billId: string; saleId: string }> {
  const { partyId, tabId } = await seat(v, await v.table(label), 4);
  await orderForParty(v, partyId, ["Burger"], tabId);
  await inTx(v, async (tx) => {
    await tx.update(taxpayer).set({ taxpayerDomicile: "Carrer 1, 08001 Barcelona" });
    await tx
      .update(workingOrders)
      .set({
        invoiceType: "F1",
        recipientTaxId: "B12345674",
        recipientLegalName: "Client SL",
        recipientAddress: "2 Main Street, 08001 Barcelona, Barcelona",
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
      { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      payment!.id,
      new Date(),
    );
    expect(invoice?.invoiceType).toBe("F1");
  });
  return { billId: tabId, saleId: await saleOf(tabId) };
}

async function storedRows(saleId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ guests: sales.receiptGuestCount })
      .from(sales)
      .where(and(eq(sales.id, saleId), isNotNull(sales.receiptTradingName))),
  );
}

async function printed(saleId: string): Promise<number | undefined> {
  return inTx(v, (tx) => readPrintedGuests(tx, saleId));
}

describe("a payment request's guests", () => {
  it.each([undefined, null, 1, 4, 999])("accepts %s as itself", (value) => {
    expect(readGuestCountChoice(value)).toBe(value);
  });

  it.each([[0], [1000], [2.5], [-1], ["4"], [true], [{}], [[]]])("refuses %j", (value) => {
    let thrown: unknown;
    try {
      readGuestCountChoice(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("management.request_invalid");
    expect((thrown as AppError).params).toEqual({ field: "guestCount" });
  });
});

describe("the guests stored when a sale is recorded", () => {
  it("writes the count the request chose", async () => {
    const { saleId } = await paidPartyOfFour("Row 1", { choice: 5 });
    expect(await storedRows(saleId)).toEqual([{ guests: 5 }]);
  });

  it("writes no line when the request chose none", async () => {
    const { saleId } = await paidPartyOfFour("Row 2", { choice: null });
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("writes the party's count when the request sent none", async () => {
    const { saleId } = await paidPartyOfFour("Row 3", { choice: undefined });
    expect(await storedRows(saleId)).toEqual([{ guests: 4 }]);
  });

  it("writes no line when the request sent none and the party's count is above 999", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Row 1000"), 1000);
    await orderForParty(v, partyId, ["Burger"], tabId);
    const saleId = await recordFixtureSale(tabId, undefined, { choice: undefined });
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("writes no line by default for a party that split a dish onto a second bill", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Row 4"), 4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const second = await split(v, partyId, tabId, [2]);
    const saleId = await recordFixtureSale(
      second,
      { name: "Vino", price: "30.00", vatRate: "21.00" },
      { choice: undefined },
    );
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("writes no line by default for a counter sale", async () => {
    const orderId = await counterOrder(v, "Burger");
    const saleId = await recordFixtureSale(orderId, undefined, { choice: undefined });
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });

  it("never clamps a sent count: 1000 is refused by the table's rule and writes nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Row 1001"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    await expect(recordFixtureSale(tabId, undefined, { choice: 1000 })).rejects.toThrow(
      "CHECK constraint failed: sales_receipt_guest_count_ck",
    );
    expect(await v.db.select().from(sales).where(eq(sales.workingOrderId, tabId))).toEqual([]);
  });

  it("records a header but no guest count for a full invoice", async () => {
    const { saleId } = await fullInvoiceOfFour("Row 6");
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
  });
});

/**
 * The guests the till's payment screen fills in for the party seated at `tableId`, as the floor read
 * hands it over, beside the guests stored for a simplified sale of `billId` paid with no count sent.
 */
async function tillAndStoredDefaults(
  tableId: string,
  billId: string,
  sale?: Parameters<typeof recordFixtureSale>[1],
): Promise<{ till: number | null; stored: number | null | undefined }> {
  const { party } = await floorRow(v, tableId);
  const till = defaultGuestCount(party!);
  const saleId = await recordFixtureSale(billId, sale, { choice: undefined });
  const [row] = await storedRows(saleId);
  return { till, stored: row?.guests };
}

describe("the default the till shows and the default stored for a sale paid with none", () => {
  it("are both the party's count on its one bill", async () => {
    const table = await v.table("Same 1");
    const { partyId, tabId } = await seat(v, table, 4);
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await tillAndStoredDefaults(table, tabId)).toEqual({ till: 4, stored: 4 });
  });

  it("are both no line for a party that split a dish onto a second bill", async () => {
    const table = await v.table("Same 2");
    const { partyId, tabId } = await seat(v, table, 4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const second = await split(v, partyId, tabId, [2]);

    expect(
      await tillAndStoredDefaults(table, second, {
        name: "Vino",
        price: "30.00",
        vatRate: "21.00",
      }),
    ).toEqual({ till: null, stored: null });
  });

  it("are both the sum on joined tables whose bills were merged", async () => {
    const table4 = await v.table("Same 3 4");
    const table5 = await v.table("Same 3 5");
    const four = await seat(v, table4, 2);
    const five = await seat(v, table5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, table5, five.partyId, { into: four.tabId, from: five.tabId });

    expect(await tillAndStoredDefaults(table5, four.tabId, { price: "32.00" })).toEqual({
      till: 5,
      stored: 5,
    });
  });

  it("are both no line on joined tables, each keeping its bill", async () => {
    const table4 = await v.table("Same 4 4");
    const table5 = await v.table("Same 4 5");
    const four = await seat(v, table4, 2);
    const five = await seat(v, table5, 3);
    await orderForParty(v, four.partyId, ["Burger"], four.tabId);
    await orderForParty(v, five.partyId, ["Paella"], five.tabId);
    await joinOther(four.partyId, table5, five.partyId);

    expect(await tillAndStoredDefaults(table4, four.tabId)).toEqual({ till: null, stored: null });
  });

  it("are both no line for a party that joined a table whose party had already paid", async () => {
    const xTable = await v.table("Same 5 X");
    const yTable = await v.table("Same 5 Y");
    const x = await seat(v, xTable, 2);
    await orderForParty(v, x.partyId, ["Burger"], x.tabId);
    await pay(v, x.tabId, "12.00");
    const y = await seat(v, yTable, 3);
    await orderForParty(v, y.partyId, ["Paella"], y.tabId);
    await joinOther(y.partyId, xTable, x.partyId);

    expect((await partyRow(v, y.partyId)).guestCount).toBe(5);
    expect(
      await tillAndStoredDefaults(yTable, y.tabId, { name: "Paella", price: "20.00" }),
    ).toEqual({ till: null, stored: null });
  });
});

describe("the guests a paper receipt of a sale prints", () => {
  it("prints the party's count for a sale with no recorded receipt facts", async () => {
    const { saleId } = await paidPartyOfFour("Paper 1");
    expect(await printed(saleId)).toBe(4);
  });

  it("prints the stored count", async () => {
    const { saleId } = await paidPartyOfFour("Paper 2", { choice: 5 });
    expect(await printed(saleId)).toBe(5);
  });

  it("prints no line when the stored choice says none", async () => {
    const { saleId } = await paidPartyOfFour("Paper 3", { choice: null });
    expect(await printed(saleId)).toBeUndefined();
  });

  it("keeps the stored count after the party's count changes", async () => {
    const { partyId, saleId } = await paidPartyOfFour("Paper 4", { choice: 5 });
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      setPartyGuestCount(tx, { partyId, guestCount: 6, expectedPartyRevision }),
    );
    expect((await partyRow(v, partyId)).guestCount).toBe(6);
    expect(await printed(saleId)).toBe(5);
  });

  it("prints a counter sale's stored count", async () => {
    const orderId = await counterOrder(v, "Burger");
    const saleId = await recordFixtureSale(orderId, undefined, { choice: 3 });
    expect(await printed(saleId)).toBe(3);
  });

  it("prints a full invoice's live party count even with a recorded header", async () => {
    const { saleId } = await fullInvoiceOfFour("Paper 6");
    expect(await storedRows(saleId)).toEqual([{ guests: null }]);
    expect(await printed(saleId)).toBe(4);
  });
});
