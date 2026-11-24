import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, sumDecimals } from "@waitron/shared";
import { filedInvoicesOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { readCustomerInvoiceDocument } from "./invoice-document.js";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { formatReceipt } from "./receipt-ticket.js";
import { readOrderRevision } from "./working-order-context.js";
import { readSettledTicket, type TillSaleLine, type TillSaleResult } from "./till-sale.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { RECIPIENT } from "./testing/deferred-close-fixture.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { createAdjustmentReason } from "@waitron/adjustments";
import { readBillEditState } from "./bill-editing.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import {
  advanceBills,
  entries,
  printed,
  provisionAdvanceVenue,
  spanish,
  type AdvanceVenue,
} from "./testing/advance-bills.js";
import { inTx, send } from "./testing/bill-venue.js";
import "./errors.js";

// What the rest's invoice prints once the bill's advances are taken off it (advances plan, Task
// 1.5), against a venue that files real Veri*Factu records. Each case's bill is at a table of its own.
let advanceVenue: AdvanceVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    advanceVenue = await provisionAdvanceVenue(db);
  },
});

const { seated, seatedTakeaway, advance, payRest, restId, advanceFacts, caption, readTicket } =
  advanceBills(() => advanceVenue);

function recordBreakdown(saleId: string): string[][] {
  const records = filedInvoicesOf(advanceVenue.venue.db, saleId, new Date());
  expect(records).toHaveLength(1);
  expect(records[0]!.errors).toEqual([]);
  return records[0]!.breakdown.map((row) => [...row]).sort();
}

/** The receipt's lines add up to its TOTAL, and its VAT table is the filed record's. */
function expectBalanced(invoice: TillSaleResult, record: string[][]): void {
  expect(sumDecimals(invoice.lines.map((line) => decimal(line.gross)))).toBe(invoice.total);
  expect(
    invoice.vatBreakdown.map((row) => [decimal(row.rate), row.base, row.tax].map(String)).sort(),
  ).toEqual(record.map(([rate, base, tax]) => [decimal(rate!), base, tax].map(String)));
}

async function setFullInvoice(billId: string): Promise<void> {
  await setOrderInvoiceChoice(
    advanceVenue.venue.db,
    advanceVenue.venue.backend,
    advanceVenue.venue.cfg,
    billId,
    {
      revision: await inTx(advanceVenue.venue, (tx) => readOrderRevision(tx, billId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    },
  );
}

async function a4Of(saleId: string): Promise<ReturnType<typeof buildReceiptDocument>> {
  const input = await inTx(advanceVenue.venue, (tx) =>
    readCustomerInvoiceDocument(advanceVenue.venue.backend, tx, advanceVenue.venue.cfg, saleId),
  );
  return buildReceiptDocument(input);
}

describe("the rest's ticket prints each advance it takes off", () => {
  it("example 1: the dish, the advance line −30.00 with nothing under it, TOTAL 90.00 and VAT 81.82 / 8.18", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");

    const invoice = await payRest(billId, "90.00");

    const rest = await restId(billId);
    const words = await caption(advanceId);
    expect(invoice.lines.at(-1)).toMatchObject({
      gross: "-30.00",
      advance: await advanceFacts(advanceId),
    });
    const lines = printed(invoice);
    const at = lines.findIndex((line) => line.includes(words));
    expect(lines[at]).toBe(`1 ${words} -30,00`);
    expect(lines[at - 1]).toBe("1 Tasting menu (customer) 120,00");
    expect(lines[at + 1]).toMatch(new RegExp(`^${spanish.total} 90,00`));
    expect(lines).toContain("10% 81,82 8,18 90,00");
    expectBalanced(invoice, recordBreakdown(rest));
  });

  it("example 8: seven dishes, the advance line −3.00, TOTAL 4.35 and a VAT table equal to the record's", async () => {
    const billId = await seated(...Array<string>(7).fill("Bread roll"));
    const advanceId = await advance(billId, "3.00");

    const invoice = await payRest(billId, "4.35");

    const rest = await restId(billId);
    const lines = printed(invoice);
    const words = await caption(advanceId);
    expect(lines.filter((line) => line === "1 Bread roll (customer) 1,05")).toHaveLength(7);
    expect(lines).toContain(`1 ${words} -3,00`);
    expect(lines).toContain("10% 3,92 0,43 4,35");
    expect(recordBreakdown(rest)).toEqual([["10.00", "3.92", "0.43"]]);
    expectBalanced(invoice, recordBreakdown(rest));
  });

  it("example 2: the advance at 10% prints with its rate letter, and the VAT table's 10% row is negative", async () => {
    const billId = await seatedTakeaway("Salad bowl", "Wine case");
    const advanceId = await advance(billId, "50.00");

    const invoice = await payRest(billId, "50.00");

    const rest = await restId(billId);
    const lines = printed(invoice);
    const words = await caption(advanceId);
    const letter = lines
      .find((line) => line.startsWith("1 Salad bowl"))!
      .split(" ")
      .at(-1);
    expect(lines).toContain(`1 ${words} -50,00 ${letter}`);
    expect(lines.some((line) => line.endsWith("10% -27,27 -2,73 -30,00"))).toBe(true);
    expectBalanced(invoice, recordBreakdown(rest));
  });

  it("example 6: what is left rounds to nothing, and the ticket prints TOTAL 0.05 and VAT 0.04 / 0.01", async () => {
    const billId = await seated("Seafood platter");
    const advanceId = await advance(billId, "30.00");

    const invoice = await payRest(billId, "0.05");

    const rest = await restId(billId);
    const lines = printed(invoice);
    expect(lines).toContain(`1 ${await caption(advanceId)} -30,00`);
    expect(lines).toContain("10% 0,04 0,01 0,05");
    expectBalanced(invoice, recordBreakdown(rest));
  });

  it("two advances of the same amount print two lines and never merge", async () => {
    const billId = await seated("Tasting menu");
    const first = await advance(billId, "30.00");
    const second = await advance(billId, "30.00");

    await payRest(billId, "60.00");

    const lines = printed(await readTicket(await restId(billId)));
    expect(lines).toContain(`1 ${await caption(first)} -30,00`);
    expect(lines).toContain(`1 ${await caption(second)} -30,00`);
    expect(lines.some((line) => line.includes("-60,00"))).toBe(false);
  });

  it("a duplicate, from Find a bill or the bill's own reprint, prints the same as the original", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    const invoice = await payRest(billId, "90.00");
    const rest = await restId(billId);

    const settled = await inTx(advanceVenue.venue, (tx) =>
      readSettledTicket(advanceVenue.venue.backend, tx, advanceVenue.venue.cfg, billId),
    );
    const found = await readTicket(rest);

    const original = printed(invoice);
    const advanceLine = { gross: "-30.00", advance: await advanceFacts(advanceId) };
    for (const copy of [settled, found]) {
      expect(copy.lines.at(-1)).toEqual(expect.objectContaining(advanceLine));
      const copied = printed(copy, true);
      expect(copied.filter((line) => !original.includes(line))).toEqual([spanish.duplicate]);
      expect(original.filter((line) => !copied.includes(line))).toEqual([]);
    }
  });

  it("an advance's own ticket prints like any ticket, its line naming the meal it pays towards", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");

    const ticket = await readTicket(advanceId);

    expect(ticket.lines).toHaveLength(1);
    expect(ticket.lines[0]!.advance).toBeUndefined();
    const lines = printed(ticket);
    expect(lines.some((line) => line.includes(spanish.paymentOnAccount))).toBe(true);
    const words = await caption(advanceId);
    expect(lines.some((line) => line.includes(words))).toBe(false);
  });
});

describe("the rest's full invoice prints each advance it takes off", () => {
  it("example 1 on A4: the advance's base −27.27 in the base column, and Base imponible 10% 81.82", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    await setFullInvoice(billId);

    await payRest(billId, "90.00");

    const document = await a4Of(await restId(billId));
    const rows = document.elements.flatMap((e) => (e.kind === "table" ? e.table.rows : []));
    const words = await caption(advanceId);
    expect(rows.find((row) => row.item === words)).toMatchObject({
      units: "1",
      price: "-27,27",
      amount: "-27,27",
    });
    expect(rows.at(-1)!.item).toBe(words);
    const amounts = document.elements.flatMap((e) => (e.kind === "amount" ? [e] : []));
    expect(amounts.find((row) => row.caption.startsWith(spanish.taxableBase))?.amount).toMatch(
      /^81,82/,
    );
  });

  it("example 8 on A4: the advance's base −2.73, and Base imponible 10% 3.92", async () => {
    const billId = await seated(...Array<string>(7).fill("Bread roll"));
    const advanceId = await advance(billId, "3.00");
    await setFullInvoice(billId);

    await payRest(billId, "4.35");

    const document = await a4Of(await restId(billId));
    const rows = document.elements.flatMap((e) => (e.kind === "table" ? e.table.rows : []));
    expect(rows.find((row) => row.item === "Bread roll (customer)")).toBeDefined();
    const words = await caption(advanceId);
    expect(rows.find((row) => row.item === words)).toMatchObject({
      amount: "-2,73",
    });
    const amounts = document.elements.flatMap((e) => (e.kind === "amount" ? [e] : []));
    expect(amounts.find((row) => row.caption.startsWith(spanish.taxableBase))?.amount).toMatch(
      /^3,92/,
    );
  });
});

/** A ticket of one €120 dish less the advance lines `advances`, formatted on 80mm paper. */
function ticketWith(advances: TillSaleLine[], total: string): string[] {
  const input: ReceiptDocumentInput = {
    result: {
      locale: "es-ES",
      orderLabel: null,
      orderNumber: 0,
      invoiceNumber: "T/40",
      issuedAt: "2026-12-05T22:00:00.000Z",
      issuedOffsetMinutes: 60,
      total,
      vatBreakdown: [{ rate: "10.00", base: "0.00", tax: "0.00" }],
      lines: [
        { descriptions: { "es-ES": "Tasting menu" }, quantity: "1", gross: "800.00" },
        ...advances,
      ],
      tender: { method: "cash", change: "0.00" },
      qr: "",
    },
    issuer: { venueName: "Venue", nif: "B12345678" },
    receipt: {},
    invoiceLocale: "es-ES",
  };
  return entries(
    formatReceipt({ ...input, printer: { paperWidth: "80mm", resolution: "180dpi" } }),
  );
}

const advanceLine = (gross: string, advance: TillSaleLine["advance"]): TillSaleLine => ({
  descriptions: { "es-ES": spanish.paymentOnAccount },
  quantity: "1",
  gross,
  vatRate: "10.00",
  advance,
});

describe("the advance line as the ticket draws it", () => {
  it("two lines with the same words and amount never merge, even with the same advance", () => {
    const same = { invoiceNumber: "A/12", issuedOn: "2026-11-19" };
    const printed = ticketWith(
      [advanceLine("-30.00", same), advanceLine("-30.00", same)],
      "740.00",
    );

    expect(printed.filter((line) => line.endsWith(" -30,00"))).toHaveLength(2);
    expect(printed.some((line) => line.startsWith("2 "))).toBe(false);
  });

  it("no base or VAT, and no price each, is printed under an advance line", () => {
    const printed = ticketWith(
      [advanceLine("-30.00", { invoiceNumber: "A/12", issuedOn: "2026-11-19" })],
      "770.00",
    );

    const at = printed.findIndex((line) => line.endsWith(" -30,00"));
    expect(printed[at + 1]).toMatch(new RegExp(`^${spanish.total} `));
  });
});

describe("a bill with a whole-bill discount and an advance", () => {
  const advanceTaken = { invoiceNumber: "A/12", issuedOn: "2026-11-19" };
  const words = spanish.advanceTakenOff
    .replace("{paymentOnAccount}", spanish.paymentOnAccount)
    .replace("{number}", "A/12")
    .replace("{date}", "19/11/2026");

  it("prints the dishes, the discount, then the advance, then TOTAL, on the ticket and on A4", () => {
    const ticket: ReceiptDocumentInput = {
      result: {
        locale: "es-ES",
        orderLabel: null,
        orderNumber: 0,
        invoiceNumber: "T/40",
        issuedAt: "2026-12-05T22:00:00.000Z",
        issuedOffsetMinutes: 60,
        total: "78.00",
        vatBreakdown: [{ rate: "10.00", base: "70.91", tax: "7.09" }],
        lines: [
          {
            descriptions: { "es-ES": "Tasting menu" },
            quantity: "1",
            gross: "108.00",
            listGross: "120.00",
          },
          advanceLine("-30.00", advanceTaken),
        ],
        billAdjustments: [{ kind: "discount", percentBp: 1000, amount: "12.00" }],
        tender: { method: "cash", change: "0.00" },
        qr: "",
      },
      issuer: { venueName: "Venue", nif: "B12345678" },
      receipt: {},
      invoiceLocale: "es-ES",
    };
    const lines = entries(
      formatReceipt({ ...ticket, printer: { paperWidth: "80mm", resolution: "180dpi" } }),
    );
    const at = (found: (line: string) => boolean) => lines.findIndex(found);
    const dish = at((line) => line.includes("Tasting menu"));
    const discount = at((line) => line.startsWith(`${spanish.discount} 10%`));
    const advance = at((line) => line.includes(words));
    const total = at((line) => line.startsWith(`${spanish.total} `));
    expect([dish, discount, advance, total].every((index) => index >= 0)).toBe(true);
    expect(dish).toBeLessThan(discount);
    expect(discount).toBeLessThan(advance);
    expect(advance).toBeLessThan(total);

    const a4 = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    a4.result.lines = [
      {
        descriptions: { "es-ES": "Pan de pueblo" },
        quantity: "1",
        gross: "108.00",
        listGross: "120.00",
        listUnitPriceGross: "120.00",
        net: {
          unitPrice: "98.18",
          priceQuantity: "1.000",
          base: "98.18",
          tax: "9.82",
          rate: "10.00",
        },
      },
      {
        ...advanceLine("-30.00", advanceTaken),
        net: {
          unitPrice: "-27.27",
          priceQuantity: "1.000",
          base: "-27.27",
          tax: "-2.73",
          rate: "10.00",
        },
      },
    ];
    a4.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "12.00" }];
    a4.result.vatBreakdown = [{ rate: "10.00", base: "70.91", tax: "7.09" }];
    a4.result.total = "78.00";
    const rows = buildReceiptDocument(a4).elements.flatMap((element) =>
      element.kind === "table" ? element.table.rows : [],
    );
    expect(rows.map((row) => row.item)).toEqual([
      "Pan de pueblo",
      `${spanish.discount} 10%`,
      words,
    ]);
  });

  it("an issued bill: the discount, then the advance, the lines summing to TOTAL and the VAT table the filed record's", async () => {
    const billId = await seated("Tasting menu");
    const reasonId = await inTx(
      advanceVenue.venue,
      async (tx) => (await createAdjustmentReason(tx, REASONS.house)).id,
    );
    const discounted = await send(
      advanceVenue.venue.app,
      advanceVenue.venue.cookie,
      "POST",
      `/api/working-orders/${billId}/adjustments`,
      {
        expectedEdit: await readBillEditState(advanceVenue.venue.db, billId),
        submissionId: randomUUID(),
        expectedRevision: await inTx(advanceVenue.venue, (tx) => readOrderRevision(tx, billId)),
        lineId: null,
        reasonId,
        action: "discount_amount",
        amount: "12.00",
        note: null,
        override: { personId: advanceVenue.venue.adminId, pin: "1234" },
      },
    );
    expect(discounted.status, JSON.stringify(discounted.json)).toBe(200);
    const advanceId = await advance(billId, "30.00");

    const invoice = await payRest(billId, "78.00");

    const lines = printed(invoice);
    const dish = lines.indexOf("1 Tasting menu (customer) 120,00");
    expect(lines.slice(dish, dish + 4)).toEqual([
      "1 Tasting menu (customer) 120,00",
      `${spanish.discount} 10% -12,00`,
      `1 ${await caption(advanceId)} -30,00`,
      `${spanish.total} 78,00 €`,
    ]);
    const record = recordBreakdown(await restId(billId));
    expect(record).toEqual([["10.00", "70.91", "7.09"]]);
    expect(lines).toContain("10% 70,91 7,09 78,00");
    expectBalanced(invoice, record);
  });
});
