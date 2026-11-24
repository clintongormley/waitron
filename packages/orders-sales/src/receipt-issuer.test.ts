import { invoiceSeries, nodes, sales, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiledReceipt, FiscalBackend } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId } from "@waitron/shared";
import { expect, it, vi } from "vitest";
import { printsAsFullInvoice, readInvoiceTyping } from "./invoice-typing.js";
import { readReceiptIssuer } from "./receipt-issuer.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const filed = {
  verificationUrl: "https://fiscal-receipt.example/sale",
  vatBreakdown: [],
  issuer: { legalName: "Saved Venue", taxId: "B12345674" },
} satisfies FiledReceipt;
const evidence = {
  taxpayerId: "B12345674",
  environment: "preproduction",
  series: "F",
  invoiceNumber: "F/3",
  issuedDate: "2026-10-17",
  recordEvidence: "stored record evidence",
};
const customer = {
  counterpartyTaxId: "AB123456",
  counterpartyLegalName: "Saved Customer",
  counterpartyCountryCode: "FR",
  counterpartyIdentifierType: "passport",
  counterpartyIdentifierCountryCode: "GB",
  counterpartyAddress: "2 Main Street",
};

function backend(receipt: FiledReceipt | undefined): FiscalBackend {
  const fake = new FakeFiscalBackend(suite.db);
  vi.spyOn(fake, "filedReceiptFor").mockResolvedValue(receipt);
  return fake;
}

async function insertSales(tx: Transaction) {
  const [node] = await tx.insert(nodes).values({ name: "Receipt issuer" }).returning();
  const [full, standard, corrective] = await tx
    .insert(invoiceSeries)
    .values([
      { nodeId: node!.id, code: "F", purpose: "full" },
      { nodeId: node!.id, code: "T", purpose: "standard" },
      { nodeId: node!.id, code: "R", purpose: "corrective" },
    ])
    .returning();
  const header = {
    nodeId: node!.id,
    source: "operator_script" as const,
    issuedAt: "2026-10-16T23:30:00.000Z",
    issuedOffsetMinutes: 120,
    total: 1000,
    vatBreakdown: [],
    locale: "en",
    invoiceLocales: ["en"],
    fiscalBackend: "none",
    fiscalState: "not_applicable" as const,
  };
  const [invoice, ticket] = await tx
    .insert(sales)
    .values([
      {
        ...header,
        ...customer,
        seriesId: full!.id,
        invoiceNumber: 3,
        supplyDay: "2026-10-16",
        taxpayerDomicile: "8 Registered Street",
      },
      { ...header, seriesId: standard!.id, invoiceNumber: 2, supplyDay: "2026-10-17" },
    ])
    .returning();
  const correctiveHeader = {
    ...header,
    issuedAt: "2026-10-18T09:00:00.000Z",
    issuedOffsetMinutes: 60,
  };
  const [replacement, refund] = await tx
    .insert(sales)
    .values([
      {
        ...correctiveHeader,
        ...customer,
        seriesId: corrective!.id,
        invoiceNumber: 1,
        correctsSaleId: invoice!.id,
        replacesOriginal: true,
        supplyDay: "2026-10-17",
        taxpayerDomicile: "9 Registered Street",
      },
      {
        ...correctiveHeader,
        seriesId: corrective!.id,
        invoiceNumber: 2,
        correctsSaleId: ticket!.id,
        total: -1000,
      },
    ])
    .returning();
  return { invoice: invoice!, ticket: ticket!, replacement: replacement!, refund: refund! };
}

it("combines a preloaded full sale with the filed issuer and its evidence", async () => {
  const fiscal = backend(filed);
  await withTransaction(suite.db, async (tx) => {
    const { invoice } = await insertSales(tx);
    const id = saleId(invoice.id);
    fiscal.invoiceEvidenceFor = async (_tx, requested) => (requested === id ? evidence : undefined);
    expect(await readReceiptIssuer(fiscal, tx, id, invoice)).toEqual({
      invoiceEvidence: evidence,
      issuedOffsetMinutes: 120,
      invoiceType: "F1",
      saleDay: "2026-10-16",
      recipient: {
        taxId: "AB123456",
        legalName: "Saved Customer",
        countryCode: "FR",
        identifierType: "passport",
        identifierCountryCode: "GB",
        address: "2 Main Street",
      },
      issuer: { venueName: "Saved Venue", nif: "B12345674", domicile: "8 Registered Street" },
    });
    expect(fiscal.filedReceiptFor).toHaveBeenCalledExactlyOnceWith(tx, id);
  });
});

it("reads saved ticket and corrective types by sale id", async () => {
  const fiscal = backend(filed);
  await withTransaction(suite.db, async (tx) => {
    const { ticket, replacement, refund } = await insertSales(tx);
    const replacementId = saleId(replacement.id);
    const replacementEvidence = {
      ...evidence,
      series: "R",
      invoiceNumber: "R/1",
      issuedDate: "2026-10-18",
      recordEvidence: "stored corrective evidence",
    };
    fiscal.invoiceEvidenceFor = async (_tx, requested) =>
      requested === replacementId ? replacementEvidence : undefined;
    const issuer = { venueName: "Saved Venue", nif: "B12345674" };
    expect(await readReceiptIssuer(fiscal, tx, saleId(ticket.id))).toEqual({
      issuedOffsetMinutes: 120,
      invoiceType: "F2",
      issuer,
    });
    expect(await readReceiptIssuer(fiscal, tx, replacementId)).toEqual({
      issuedOffsetMinutes: 60,
      invoiceEvidence: replacementEvidence,
      invoiceType: "R4",
      saleDay: "2026-10-17",
      corrects: {
        invoiceNumber: "F/3",
        issuedAt: "2026-10-16T23:30:00.000Z",
        issuedOffsetMinutes: 120,
        inFull: true,
      },
      recipient: {
        taxId: "AB123456",
        legalName: "Saved Customer",
        countryCode: "FR",
        identifierType: "passport",
        identifierCountryCode: "GB",
        address: "2 Main Street",
      },
      issuer: { ...issuer, domicile: "9 Registered Street" },
    });
    expect(await readReceiptIssuer(fiscal, tx, saleId(refund.id))).toEqual({
      issuedOffsetMinutes: 60,
      invoiceType: "R5",
      corrects: {
        invoiceNumber: "T/2",
        issuedAt: "2026-10-16T23:30:00.000Z",
        issuedOffsetMinutes: 120,
      },
      issuer,
    });
  });
});

it("returns the saved offset alone when the filing has no issuer", async () => {
  const fiscal = backend({ verificationUrl: "", vatBreakdown: [] });
  await withTransaction(suite.db, async (tx) => {
    const { ticket } = await insertSales(tx);
    expect(await readReceiptIssuer(fiscal, tx, saleId(ticket.id))).toEqual({
      issuedOffsetMinutes: 120,
    });
  });
});

it("returns no issuer facts when neither source has the sale", async () => {
  await withTransaction(suite.db, async (tx) => {
    const missing = saleId("00000000-0000-4000-8000-000000000001");
    expect(await readReceiptIssuer(backend(undefined), tx, missing)).toEqual({});
  });
});

it.each(["counterpartyLegalName", "counterpartyCountryCode", "counterpartyAddress"] as const)(
  "rejects a named recipient without %s",
  async (field) => {
    await withTransaction(suite.db, async (tx) => {
      const { invoice } = await insertSales(tx);
      await expect(readInvoiceTyping(tx, { ...invoice, [field]: null })).rejects.toThrow(
        "without their name, country or address",
      );
    });
  },
);

it.each([
  ["F1", true],
  ["F2", false],
  ["R4", true],
  ["R5", false],
  [undefined, false],
] as const)("selects full invoice layout for %s as %s", (type, expected) => {
  expect(printsAsFullInvoice(type)).toBe(expected);
});
