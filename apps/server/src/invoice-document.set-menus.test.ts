import { eq } from "drizzle-orm";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, it } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import { readLiveSeriesIdTx, taxpayer, workingOrders } from "@waitron/db";
import { recordReplacement } from "@waitron/core";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  readCustomerInvoiceDocument,
  readInvoiceDocument,
  readReceiptEmailDocument,
} from "./invoice-document.js";
import { composeInvoiceEmail } from "./invoice-email.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import {
  sendSpecDishes,
  setSpecCount,
  setupSetMenuSpecVenue,
  specBill,
  specDeps,
  specSaleLines,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await inTx(venue, (tx) =>
      tx
        .update(taxpayer)
        .set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" })
        .where(eq(taxpayer.id, 1)),
    );
  },
});

async function asFullInvoice(billId: string) {
  const [order] = await inTx(venue, (tx) =>
    tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
  );
  await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
    revision: order!.revision,
    invoiceType: "F1",
    recipient: {
      taxId: "B12345674",
      legalName: "Client Ltd",
      address: "2 Main Street, 28013 Madrid, Madrid",
      countryCode: "ES",
    },
  });
}

async function payWhole(billId: string, amount: string) {
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    billId,
    {
      submissionId: crypto.randomUUID(),
      kind: "share",
      shareOf: 1,
      applied: amount,
      tip: "0.00",
      method: "cash",
      tendered: amount,
    },
    venue.operator,
  );
}

async function saleOf(billId: string) {
  return brandSaleId((await specSaleLines(spec, billId))[0]!.saleId);
}

/** The A4 document's item rows: name, unit price and amount before tax. */
function rows(input: ReceiptDocumentInput): [string, string, string][] {
  return buildReceiptDocument({ ...input, surface: "a4" }).elements.flatMap((element) =>
    element.kind === "table"
      ? element.table.rows.map(({ item, price, amount }): [string, string, string] => [
          item,
          price,
          amount,
        ])
      : [],
  );
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" "));
    }
    return pages.join(" ").replace(/\s+/g, " ");
  } finally {
    await loading.destroy();
  }
}

const COVERED = ["Soup", "Hake", "Sea bass"];

it.each([
  ["the PDF", readInvoiceDocument],
  ["the email", readReceiptEmailDocument],
] as const)("the full invoice lists set menus and surcharges: %s", async (surface, read) => {
  const { tabId } = await specBill(spec, "fire");
  await asFullInvoice(tabId);
  await payWhole(tabId, "73.00");
  const saleId = await saleOf(tabId);
  const document = await inTx(venue, (tx) => read(venue.backend, tx, venue.cfg, saleId));
  expect(document.result.invoiceType).toBe("F1");
  expect(rows(document)).toEqual([
    ["Daily menu", "12,73", "12,73"],
    ["Daily menu", "12,73", "12,73"],
    ["Special menu", "18,18", "18,18"],
    ["Special menu", "18,18", "18,18"],
    ["Sirloin", "4,55", "4,55"],
  ]);
  const pdf =
    surface === "the PDF"
      ? await renderInvoicePdf(document)
      : (await composeInvoiceEmail({ document })).attachments![0]!.content;
  const text = await pdfText(pdf as Uint8Array);
  expect(text).toContain("Daily menu");
  expect(text).toContain("4,55");
  expect(text).not.toContain("+4,55");
  for (const covered of COVERED) expect(text).not.toContain(covered);
  expect(text.match(/Sirloin/g)).toHaveLength(1);
  expect(text).toContain("73,00");
});

it("a covered soup with bread keeps its bread's figures on the full invoice", async () => {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, spec.daily, 2);
  await sendSpecDishes(
    spec,
    bill,
    [
      { dish: "Hake", from: spec.daily },
      { dish: "Soup", from: spec.daily, extras: [spec.bread] },
    ],
    "fire",
  );
  await asFullInvoice(bill.tabId);
  await payWhole(bill.tabId, "29.50");
  const saleId = await saleOf(bill.tabId);
  const document = await inTx(venue, (tx) =>
    readInvoiceDocument(venue.backend, tx, venue.cfg, saleId),
  );
  expect(rows(document)).toEqual([
    ["Daily menu", "12,73", "12,73"],
    ["Daily menu", "12,73", "12,73"],
    ["Soup", "", ""],
    ["Bread", "1,36", "1,36"],
  ]);
});

// An invoice naming a customer is never credited (`sale.correction_unsupported`); the corrective
// printed as a full invoice is a replacement (R4), made once AEAT has refused the original.
it("a replacement (R4) of a set-menu invoice follows the same rule", async () => {
  const { tabId } = await specBill(spec, "fire");
  await asFullInvoice(tabId);
  await payWhole(tabId, "73.00");
  const saleId = await saleOf(tabId);
  const document = await inTx(venue, async (tx) => {
    await refusedByAeat(tx, saleId);
    const { saleId: replacementId } = await recordReplacement(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "full_corrective")),
      correctsSaleId: saleId,
      authz: { sessionId: venue.operator.sessionId },
      clock: venue.clock,
    });
    return readCustomerInvoiceDocument(venue.backend, tx, venue.cfg, replacementId);
  });
  expect(document.result.invoiceType).toBe("R4");
  expect(rows(document)).toEqual([
    ["Daily menu", "12,73", "12,73"],
    ["Daily menu", "12,73", "12,73"],
    ["Special menu", "18,18", "18,18"],
    ["Special menu", "18,18", "18,18"],
    ["Sirloin", "4,55", "4,55"],
  ]);
  const text = await pdfText(await renderInvoicePdf(document));
  for (const covered of COVERED) expect(text).not.toContain(covered);
});

it("a discount placed under a covered dish keeps that dish on the full invoice", () => {
  const result: ReceiptDocumentInput["result"] = {
    ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
    total: "4.40",
    vatBreakdown: [{ rate: "10", base: "4.00", tax: "0.40" }],
    lines: [
      {
        descriptions: { "es-ES": "Soup", "en-GB": "Soup" },
        quantity: "1",
        gross: "0.00",
        parentLineNo: null,
        setMenuRole: "dish",
        dishFamily: 7,
        net: { unitPrice: "0.00", priceQuantity: "1.000", base: "0.00", tax: "0.00", rate: "10" },
      },
      {
        descriptions: { "es-ES": "Soup", "en-GB": "Soup" },
        quantity: "1",
        gross: "4.40",
        listGross: "5.50",
        listUnitPriceGross: "5.50",
        parentLineNo: null,
        dishFamily: 7,
        net: { unitPrice: "5.00", priceQuantity: "1.000", base: "4.00", tax: "0.40", rate: "10" },
      },
    ],
  };
  expect(rows({ ...FULL_INVOICE_DOCUMENT_FIXTURE, result })).toEqual([
    ["Soup", "", ""],
    ["Descuento", "", "-1,00"],
    ["Soup", "5,00", "5,00"],
  ]);
});

it("a full invoice without filed figures follows the same rule", () => {
  const dish = (name: string, gross: string, role?: "set_menu" | "dish") => ({
    descriptions: { "es-ES": name, "en-GB": name },
    quantity: "1",
    gross,
    parentLineNo: null,
    ...(role === undefined ? {} : { setMenuRole: role }),
  });
  const { elements } = buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    surface: "a4",
    result: {
      ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
      total: "20.50",
      vatBreakdown: [{ rate: "10", base: "18.64", tax: "1.86" }],
      lines: [
        dish("Daily menu", "14.00", "set_menu"),
        dish("Hake", "0.00", "dish"),
        dish("Soup", "0.00", "dish"),
        { ...dish("Bread", "1.50"), parentLineNo: 3 },
        dish("Sirloin", "5.00", "dish"),
      ],
    },
  });
  const amounts = elements.flatMap((element) =>
    element.kind === "amount" ? [[element.caption.trim(), element.amount]] : [],
  );
  const from = amounts.findIndex(([caption]) => caption.includes("Daily menu"));
  const included = receiptLabelsFor(FULL_INVOICE_DOCUMENT_FIXTURE.result.locale).vatIncluded;
  expect(amounts.slice(from, from + 4)).toEqual([
    [`1  Daily menu (${included})`, "14,00 €"],
    [`1  Soup (${included})`, ""],
    ["Bread 1", "1,50 €"],
    [`1  Sirloin (${included})`, "5,00 €"],
  ]);
  expect(JSON.stringify(elements)).not.toContain("Hake");
});
