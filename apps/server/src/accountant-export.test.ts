import { strFromU8, unzipSync } from "fflate";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { recordReplacement, recordSale } from "@waitron/core";
import {
  CORE_MIGRATIONS,
  invoiceCorrectionRefunds,
  invoiceCorrections,
  invoiceSeries,
  sales,
  taxpayer,
  tenders,
  withTransaction,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedVenueWithSeries,
  seedNodeAndSeries,
  seedSale,
  seedVoid,
  seedSubstitution,
  seedPurchaseInvoice,
  seedTender,
  seedBillPayment,
  seedBillRefund,
  seedOpenOrder,
  type SeededVenue,
} from "@waitron/reporting/test/fixtures.js";
import {
  seedRefundableSale,
  seedTenderRefund,
} from "@waitron/reporting/test/tender-refund-fixtures.js";
import { computeVatCorrections, computeVatReturn, validatedRangeWindow } from "@waitron/reporting";
import {
  decimal,
  deviceOrigin,
  seriesId as brandSeriesId,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import {
  linkPaymentsOnAccount,
  listAccountantExport,
  partPaymentsAmong,
  refundsWithoutCorrectiveQuery,
  renderAccountantWorkbook,
} from "./accountant-export.js";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { row } from "./testing/xlsx-rows.js";

const invoice = {
  id: "sale-1",
  nodeId: "node-1",
  invoiceNumber: "A/000001",
  invoiceType: "F1" as const,
  issueDate: "2026-11-01",
  customerName: "Harbour Foods",
  customerTaxId: "B12345678",
  customerIdentifierType: null,
  customerIdentifierCountry: null,
  customerCountry: "ES",
  customerAddress: "12 Harbour Road",
  total: decimal("23.10"),
  correctsSaleId: null,
  originalInvoiceNumber: null,
  voidedAt: "2026-12-01T12:00:00Z",
  vatBreakdown: [
    { rate: "10.00", base: "10.00", tax: "1.00" },
    { rate: "21.00", base: "10.00", tax: "2.10" },
  ],
};

const purchase = {
  id: "purchase-1",
  supplierInvoiceNumber: "S-42",
  supplierName: "Harbour Supplier",
  supplierTaxId: "B87654321",
  issuedOn: "2026-10-31",
  receivedOn: "2026-11-02",
  regime: "general" as const,
  deductibleProportion: decimal("75.00"),
  total: decimal("-23.10"),
  note: "Check credit",
  lines: [
    {
      rate: decimal("10.00"),
      base: decimal("10.00"),
      tax: decimal("1.00"),
      kind: "ordinary" as const,
    },
    {
      rate: decimal("21.00"),
      base: decimal("10.00"),
      tax: decimal("2.10"),
      kind: "capital" as const,
    },
  ],
};

describe("accountant workbook", () => {
  it.each([
    ["en", "other", "Paid outside Waitron"],
    ["es", "other", "Cobrado fuera de Waitron"],
    ["en", "connected_account", "This SumUp account"],
    ["es", "connected_account", "Esta cuenta de SumUp"],
  ] as const)(
    "exports outside payments as literal detail cells (%s, %s)",
    async (language, externalProvider, sourceLabel) => {
      const files = unzipSync(
        await renderAccountantWorkbook(
          {
            invoices: [],
            purchases: [],
            outsidePayments: [
              {
                id: "payment-1",
                workingOrderId: "bill-1",
                orderNumber: 77,
                saleId: "sale-1",
                invoiceNumber: "A/1",
                nodeId: "box-1",
                amount: decimal("12.34"),
                refunded: decimal("3.03"),
                settledAt: "2026-11-03T12:00:00.000Z",
                externalProvider,
                externalMachine: "=Backup & 001",
                externalRef: "00042",
                state: "partially_refunded",
              },
            ],
            refundsWithoutCorrective: [],
          },
          language,
        ),
      );
      const sheetName = language === "en" ? "Other card machines" : "Otros terminales";
      const relationshipId = strFromU8(files["xl/workbook.xml"]!).match(
        new RegExp(`<sheet name="${sheetName}"[^>]*r:id="([^"]+)"`),
      )?.[1];
      const target = strFromU8(files["xl/_rels/workbook.xml.rels"]!).match(
        new RegExp(`<Relationship Id="${relationshipId}"[^>]*Target="([^"]+)"`),
      )?.[1];
      expect(files[`xl/${target}`]).toBeDefined();
      const xml = strFromU8(files[`xl/${target}`]!);
      expect(row(xml, 2)).toEqual([
        "payment-1",
        "bill-1",
        "sale-1",
        "A/1",
        "box-1",
        "2026-11-03T12:00:00.000Z",
        "12.34",
        sourceLabel,
        "=Backup &amp; 001",
        "00042",
        language === "en" ? "Partially refunded" : "Reembolsado parcialmente",
        "3.03",
      ]);
      expect(xml).not.toContain("<f>");
      expect(strFromU8(files["xl/workbook.xml"]!)).toContain(
        language === "en" ? 'name="Other card machines"' : 'name="Otros terminales"',
      );
      expect(strFromU8(files["[Content_Types].xml"]!)).toContain("/xl/worksheets/sheet3.xml");
      expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain("worksheets/sheet3.xml");
    },
  );
  it("yields to another event-loop turn before completing a large workbook", async () => {
    const encoding = Promise.resolve(
      renderAccountantWorkbook(
        {
          invoices: Array.from({ length: 10_000 }, () => invoice),
          purchases: [],
          outsidePayments: [],
          refundsWithoutCorrective: [],
        },
        "en",
      ),
    );
    const first = await Promise.race([
      encoding.then(() => "encoded"),
      nextTurn().then(() => "other request"),
    ]);
    await encoding;
    expect(first).toBe("other request");
  });
  it("keeps a zero-total invoice with no recorded VAT groups, leaving its missing VAT facts blank", async () => {
    const files = unzipSync(
      await renderAccountantWorkbook(
        {
          invoices: [{ ...invoice, vatBreakdown: [], total: decimal("0.00") }],
          purchases: [],
          outsidePayments: [],
          refundsWithoutCorrective: [],
        },
        "en",
      ),
    );
    const cells = row(strFromU8(files["xl/worksheets/sheet1.xml"]!), 2);
    expect(cells[0]).toBe("sale-1");
    expect(cells.slice(11, 15)).toEqual(["", "", "", "0.00"]);
  });
  it.each(["en", "es"] as const)(
    "opens four header-only sheets when the period is empty (%s)",
    async (language) => {
      const bytes = await renderAccountantWorkbook(
        { invoices: [], purchases: [], outsidePayments: [], refundsWithoutCorrective: [] },
        language,
      );
      expect([...bytes.subarray(0, 4)]).toEqual([80, 75, 3, 4]);
      const files = unzipSync(bytes);
      const workbook = strFromU8(files["xl/workbook.xml"]!);
      expect(workbook.match(/<sheet /g)).toHaveLength(4);
      expect(workbook).toContain(
        language === "en"
          ? 'name="Issued invoices"'
          : `name="${ACCOUNTANT_EXPORT_WORDS.es.invoiceSheet}"`,
      );
      expect(workbook).toContain(
        language === "en"
          ? 'name="Recorded purchases"'
          : `name="${ACCOUNTANT_EXPORT_WORDS.es.purchaseSheet}"`,
      );
      for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
        const sheet = strFromU8(files[name]!);
        expect(sheet.match(/<row /g)).toHaveLength(1);
        expect(sheet).toContain(
          language === "en" ? "Invoice number" : ACCOUNTANT_EXPORT_WORDS.es.purchaseColumns[0],
        );
      }
      expect(strFromU8(files["[Content_Types].xml"]!)).toContain("spreadsheetml.sheet.main+xml");
      expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain("worksheets/sheet2.xml");
    },
  );
  it.each(["en", "es"] as const)(
    "names every sheet within Excel's 31-character limit (%s)",
    async (language) => {
      const workbook = strFromU8(
        unzipSync(
          await renderAccountantWorkbook(
            { invoices: [], purchases: [], outsidePayments: [], refundsWithoutCorrective: [] },
            language,
          ),
        )["xl/workbook.xml"]!,
      );
      const names = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map(([, name]) =>
        name!
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&quot;", '"')
          .replaceAll("&apos;", "'")
          .replaceAll("&amp;", "&"),
      );
      expect(names).toHaveLength(4);
      for (const name of names) expect(name.length, name).toBeLessThanOrEqual(31);
    },
  );

  it("keeps invoice VAT groups, later voids and signed correction links, with gross only once", async () => {
    const files = unzipSync(
      await renderAccountantWorkbook(
        {
          invoices: [
            invoice,
            {
              ...invoice,
              id: "correction-1",
              invoiceNumber: "R/000001",
              invoiceType: "corrective",
              total: decimal("-11.00"),
              correctsSaleId: "original-outside-period",
              originalInvoiceNumber: "A/000099",
              voidedAt: null,
              vatBreakdown: [{ rate: "10.00", base: "-10.00", tax: "-1.00" }],
            },
          ],
          purchases: [],
          outsidePayments: [],
          refundsWithoutCorrective: [],
        },
        "en",
      ),
    );
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(row(xml, 2)).toEqual([
      "sale-1",
      "node-1",
      "A/000001",
      "F1",
      "2026-11-01",
      "Harbour Foods",
      "B12345678",
      "",
      "",
      "ES",
      "12 Harbour Road",
      "10.00",
      "10.00",
      "1.00",
      "23.10",
      "",
      "",
      "2026-12-01T12:00:00Z",
      "",
    ]);
    expect(row(xml, 3).slice(11, 19)).toEqual([
      "21.00",
      "10.00",
      "2.10",
      "",
      "",
      "",
      "2026-12-01T12:00:00Z",
      "",
    ]);
    expect(row(xml, 4).slice(11, 19)).toEqual([
      "10.00",
      "-10.00",
      "-1.00",
      "-11.00",
      "original-outside-period",
      "A/000099",
      "",
      "",
    ]);
    expect(row(xml, 4)[3]).toBe("Corrective");
    expect(xml).toContain('<c r="M2" t="n" s="1"><v>10.00</v></c>');
    expect(row(xml, 1)[17]).toBe("Voided at (UTC)");
    expect(row(xml, 1)[18]).toContain("original tickets retained");
    expect(strFromU8(files["xl/styles.xml"]!)).toContain('numFmtId="2"');
  });

  it.each([
    [
      "en",
      "Payment on account",
      ["Cash; taken off by A/45", "Card; taken off by A/45", "Card", "Takes off A/12, A/13"],
    ],
    [
      "es",
      ACCOUNTANT_EXPORT_WORDS.es.paymentOnAccountColumn,
      [
        "Efectivo; descontado en A/45",
        "Tarjeta; descontado en A/45",
        "Tarjeta",
        "Descuenta A/12, A/13",
      ],
    ],
  ] as const)(
    "links each part payment and the table's ticket that took it off, in %s",
    async (language, heading, cells) => {
      const plain = { ...invoice, invoiceType: "F2" as const, voidedAt: null, vatBreakdown: [] };
      const files = unzipSync(
        await renderAccountantWorkbook(
          {
            invoices: [
              {
                ...plain,
                id: "advance-12",
                advance: { paidBy: "cash", takenOffBy: "A/45" },
              },
              {
                ...plain,
                id: "advance-13",
                saleDate: "2026-10-31",
                advance: { paidBy: "card", takenOffBy: "A/45" },
              },
              {
                ...plain,
                id: "advance-14",
                advance: { paidBy: "card", takenOffBy: null },
              },
              { ...plain, id: "table-45", takesOff: ["A/12", "A/13"] },
              { ...plain, id: "credit-46", invoiceType: "corrective", correctsSaleId: "table-45" },
            ],
            purchases: [],
            outsidePayments: [],
            refundsWithoutCorrective: [],
          },
          language,
        ),
      );
      const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
      const header = row(xml, 1);
      const column = header.indexOf(heading);
      expect(column).toBe(header.indexOf(ACCOUNTANT_EXPORT_WORDS[language].saleDateColumn) + 1);
      expect([2, 3, 4, 5, 6].map((number) => row(xml, number)[column] ?? "")).toEqual([
        ...cells,
        "",
      ]);
      expect(row(xml, 3)[column - 1]).toBe("2026-10-31");
      expect(row(xml, 6)).toHaveLength(19);
    },
  );

  it("lists a table's ticket's part payments in the order they were issued, whatever order they were read in", () => {
    const table = { saleId: "table-45", invoiceNumber: "A/45" };
    const part = (saleId: string, number: number, issuedAt: string) => ({
      saleId,
      code: "A",
      number,
      issuedAt,
      method: "cash" as const,
    });
    // As two reads might return them: the later part payment's read first, and one part payment
    // found by both reads.
    const rows = [
      part("advance-3", 3, "2026-11-20T10:00:00.000Z"),
      part("advance-2", 2, "2026-11-20T09:00:00.000Z"),
      part("advance-1", 1, "2026-11-20T09:00:00.000Z"),
      part("advance-2", 2, "2026-11-20T09:00:00.000Z"),
    ];
    const linked = linkPaymentsOnAccount(rows, new Map(rows.map((row) => [row.saleId, table])));
    expect(linked.takesOff.get("table-45")).toEqual(["A/1", "A/2", "A/3"]);
    expect(linked.advances.get("advance-2")).toEqual({ paidBy: "cash", takenOffBy: "A/45" });
  });

  it.each([
    ["en", "Replacement corrective — do not add (repeats the original)"],
    ["es", ACCOUNTANT_EXPORT_WORDS.es.replacement],
  ] as const)(
    "types a replaced invoice as its ordinary type and tells the reader not to add its replacement, in %s",
    async (language, replacementType) => {
      const files = unzipSync(
        await renderAccountantWorkbook(
          {
            invoices: [
              { ...invoice, invoiceType: "F2", vatBreakdown: [] },
              { ...invoice, id: "replacement-1", invoiceType: "replacement", vatBreakdown: [] },
            ],
            purchases: [],
            outsidePayments: [],
            refundsWithoutCorrective: [],
          },
          language,
        ),
      );
      const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
      expect([row(xml, 2)[3], row(xml, 3)[3]]).toEqual(["F2", replacementType]);
    },
  );

  it("keeps entered purchase VAT and gross, marking negative and unreconciled totals independently", async () => {
    const files = unzipSync(
      await renderAccountantWorkbook(
        {
          invoices: [],
          outsidePayments: [],
          refundsWithoutCorrective: [],
          purchases: [
            purchase,
            { ...purchase, id: "purchase-2", total: decimal("23.10") },
            { ...purchase, id: "purchase-3", total: decimal("24.00") },
          ],
        },
        "en",
      ),
    );
    const xml = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(row(xml, 2)).toEqual([
      "S-42",
      "purchase-1",
      "Harbour Supplier",
      "B87654321",
      "2026-10-31",
      "2026-11-02",
      "General regime",
      "75.00",
      "Ordinary goods",
      "10.00",
      "10.00",
      "1.00",
      "-23.10",
      "Negative total; Total differs from VAT lines",
      "Check credit",
    ]);
    expect(row(xml, 3).slice(8, 15)).toEqual([
      "Capital goods",
      "21.00",
      "10.00",
      "2.10",
      "",
      "Negative total; Total differs from VAT lines",
      "Check credit",
    ]);
    expect(row(xml, 4)[13]).toBe("");
    expect(row(xml, 6)[13]).toBe("Total differs from VAT lines");
    expect(row(xml, 1)[13]).toContain("edited or deleted");
  });

  it("writes hostile names as literal XML-safe text and preserves identifiers and plain decimal cells", async () => {
    const files = unzipSync(
      await renderAccountantWorkbook(
        {
          invoices: [
            {
              ...invoice,
              invoiceNumber: "00123",
              customerName: "=2+3 & <\"'>\u0001\u000b\ud800😀",
              customerTaxId: "+00123",
              customerIdentifierType: "passport",
              customerAddress: "@SUM(A1:A2)\tRoad\nFlat 1\r",
            },
          ],
          outsidePayments: [],
          refundsWithoutCorrective: [],
          purchases: [
            {
              ...purchase,
              supplierInvoiceNumber: "-0042",
              supplierName: "A&B <supplier>",
              regime: "equivalence_surcharge",
            },
          ],
        },
        "es",
      ),
    );
    const sales = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const purchases = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(sales).toContain("=2+3 &amp; &lt;&quot;&apos;&gt;���😀");
    expect(sales).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">00123</t>');
    expect(sales).toContain('<c r="G2" t="inlineStr"><is><t xml:space="preserve">+00123</t>');
    expect(sales).toContain("@SUM(A1:A2)\tRoad\nFlat 1&#13;");
    expect(purchases).toContain("A&amp;B &lt;supplier&gt;");
    expect(row(purchases, 2)[6]).toBe(ACCOUNTANT_EXPORT_WORDS.es.regimes.equivalence_surcharge);
    expect(row(sales, 2)[7]).toBe(ACCOUNTANT_EXPORT_WORDS.es.identifierTypes.passport);
    expect(row(purchases, 2)[8]).toBe(ACCOUNTANT_EXPORT_WORDS.es.vatKinds.ordinary);
    expect(row(purchases, 3)[8]).toBe(ACCOUNTANT_EXPORT_WORDS.es.vatKinds.capital);
    expect(purchases).toContain('xml:space="preserve">-0042</t>');
    for (const sheet of [sales, purchases]) {
      expect(sheet).not.toMatch(/<f(?:\s|>)/);
      for (const invalid of ["\u0001", "\u000b", "\ud800"]) expect(sheet).not.toContain(invalid);
      expect(sheet).not.toMatch(/<v>[^<]*[eE+]/);
    }
  });
});

describe("accountant period selection", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
  let venue: SeededVenue;
  beforeEach(async () => {
    venue = await seedVenueWithSeries(suite.db);
  });
  const list = (from = "2026-11-01", to = "2026-11-30") =>
    withTransaction(suite.db, (tx) => listAccountantExport(tx, { from, to }));

  it("finds the period's part payments by key, and deducting lines through the deduction index rather than every line of the period's sales", async () => {
    const plan = await withTransaction(suite.db, async (tx) =>
      (
        await tx.execute<{ detail: string }>(
          sql`explain query plan ${partPaymentsAmong(tx, ["sale-1", "sale-2"]).getSQL()}`,
        )
      ).rows.map((step) => step.detail),
    );
    expect(plan).toContain(
      "SEARCH sale_lines USING INDEX sale_lines_deducts_sale_idx (deducts_sale_id>?)",
    );
    expect(plan).toContain(
      "SEARCH bill_advances USING INDEX bill_advances_advance_sale_key (advance_sale_id=?)",
    );
    expect(plan.filter((step) => step.startsWith("SCAN"))).toEqual([]);
  });

  it("finds the period's refunds through their completion index rather than every refund", async () => {
    const window = validatedRangeWindow({
      fromBusinessDay: "2026-11-01",
      toBusinessDay: "2026-11-30",
      timeZone: "Europe/Madrid",
      dayCutover: "00:00",
      cutoverChanges: [],
    });
    const plan = await withTransaction(suite.db, async (tx) =>
      (
        await tx.execute<{ detail: string }>(
          sql`explain query plan ${refundsWithoutCorrectiveQuery(tx, window).getSQL()}`,
        )
      ).rows.map((step) => step.detail),
    );
    expect(plan.find((step) => step.includes(" refunds "))).toMatch(
      /^SEARCH refunds USING INDEX refunds_completed_at_idx \(completed_at>\? AND completed_at<\?\)$/,
    );
    expect(plan.filter((step) => step.startsWith("SCAN"))).toEqual([]);
  });

  it("reads unpaid invoices across nodes by their inclusive recorded civil dates and keeps customer and VAT facts", async () => {
    const other = await seedNodeAndSeries(suite.db, "B");
    const [full] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId: venue.deviceId,
        nodeId: other.nodeId,
        seriesId: other.seriesId,
        invoiceNumber: 7,
        issuedAt: "2026-10-31T23:30:00.000Z",
        issuedOffsetMinutes: 60,
        total: 2310,
        vatBreakdown: [
          { rate: "10.00", base: "10.00", tax: "1.01" },
          { rate: "21.00", base: "10.00", tax: "2.09" },
        ],
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        fiscalBackend: "fake",
        fiscalState: "recorded",
        counterpartyLegalName: "Harbour Foods",
        counterpartyTaxId: "FR00123",
        counterpartyCountryCode: "FR",
        counterpartyIdentifierType: "vat-number",
        counterpartyIdentifierCountryCode: "FR",
        counterpartyAddress: "12 Harbour Road",
      })
      .returning({ id: sales.id });
    const last = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-12-01T00:30:00.000Z",
      issuedOffsetMinutes: -60,
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-01T00:30:00.000Z",
      issuedOffsetMinutes: -60,
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-11-30T23:30:00.000Z",
      issuedOffsetMinutes: 60,
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });

    expect((await list()).invoices).toEqual([
      {
        id: full!.id,
        nodeId: other.nodeId,
        invoiceNumber: "B/7",
        invoiceType: "F1",
        issueDate: "2026-11-01",
        customerName: "Harbour Foods",
        customerTaxId: "FR00123",
        customerIdentifierType: "vat-number",
        customerIdentifierCountry: "FR",
        customerCountry: "FR",
        customerAddress: "12 Harbour Road",
        total: "23.10",
        vatBreakdown: [
          { rate: "10.00", base: "10.00", tax: "1.01" },
          { rate: "21.00", base: "10.00", tax: "2.09" },
        ],
        correctsSaleId: null,
        originalInvoiceNumber: null,
        voidedAt: null,
      },
      {
        id: last,
        nodeId: venue.nodeId,
        invoiceNumber: "A/1",
        invoiceType: "F2",
        issueDate: "2026-11-30",
        customerName: null,
        customerTaxId: null,
        customerIdentifierType: null,
        customerIdentifierCountry: null,
        customerCountry: null,
        customerAddress: null,
        total: "12.10",
        vatBreakdown: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
        correctsSaleId: null,
        originalInvoiceNumber: null,
        voidedAt: null,
      },
    ]);
    expect(await list("2027-01-01", "2027-01-01")).toEqual({
      invoices: [],
      purchases: [],
      outsidePayments: [],
      refundsWithoutCorrective: [],
    });
  });

  it("links signed corrections outside the period, retains original tickets and flags later voids", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-10-10T12:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    const [series] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: venue.nodeId, code: "R", purpose: "corrective" })
      .returning({ id: invoiceSeries.id });
    const correction = await seedSale(
      suite.db,
      { ...venue, seriesId: series!.id as SeededVenue["seriesId"] },
      {
        invoiceNumber: 1,
        issuedAt: "2026-11-01T12:00:00.000Z",
        total: "-12.10",
        correctsSaleId: original,
        lines: [{ vatRate: "21.00", lineTotal: "-10.00" }],
      },
    );
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-02T12:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    const replacement = await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-11-03T12:00:00.000Z",
      total: "12.10",
      counterpartyTaxId: "B12345674",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await seedSubstitution(suite.db, {
      substitutionSaleId: replacement,
      substitutedSaleId: ticket,
    });
    await seedVoid(suite.db, { saleId: ticket }, "2026-12-05T12:34:56.789Z");

    const rows = (await list()).invoices;
    expect(rows.map((row) => row.id)).toEqual([correction, ticket]);
    expect(rows[0]).toMatchObject({
      invoiceType: "corrective",
      invoiceNumber: "R/1",
      total: "-12.10",
      correctsSaleId: original,
      originalInvoiceNumber: "A/1",
      vatBreakdown: [{ rate: "21.00", base: "-10.00", tax: "-2.10" }],
    });
    expect(rows[1]).toMatchObject({ total: "12.10", voidedAt: "2026-12-05T12:34:56.789Z" });
  });

  it("keeps a replaced ticket's own type and types its replacement `replacement`", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-01T12:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const [series] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: venue.nodeId, code: "R", purpose: "corrective" })
      .returning({ id: invoiceSeries.id });
    const replacement = await seedSale(
      suite.db,
      { ...venue, seriesId: series!.id as SeededVenue["seriesId"] },
      {
        invoiceNumber: 1,
        issuedAt: "2026-11-02T12:00:00.000Z",
        total: "12.10",
        correctsSaleId: original,
        replacesOriginal: true,
        lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
      },
    );
    const refund = await seedSale(
      suite.db,
      { ...venue, seriesId: series!.id as SeededVenue["seriesId"] },
      {
        invoiceNumber: 2,
        issuedAt: "2026-11-03T12:00:00.000Z",
        total: "-3.30",
        correctsSaleId: replacement,
        lines: [{ vatRate: "10.00", lineTotal: "-3.00" }],
      },
    );

    const rows = (await list()).invoices;
    expect(rows.map((row) => [row.id, row.invoiceType])).toEqual([
      [original, "F2"],
      [replacement, "replacement"],
      [refund, "corrective"],
    ]);
    expect(rows[1]).toMatchObject({
      invoiceNumber: "R/1",
      total: "12.10",
      correctsSaleId: original,
      originalInvoiceNumber: "A/1",
    });
  });

  it("exports a replaced full invoice's replacement under the replacement type, naming the original's customer", async () => {
    await FakeFiscalBackend.install(suite.db);
    const backend = new FakeFiscalBackend(suite.db);
    await suite.db.update(taxpayer).set({ taxpayerDomicile: "8 Tax Street, 28001 Madrid" });
    const [full, corrective] = await suite.db
      .insert(invoiceSeries)
      .values([
        { nodeId: venue.nodeId, code: "F", purpose: "full" },
        { nodeId: venue.nodeId, code: "R", purpose: "corrective" },
      ])
      .returning({ id: invoiceSeries.id });
    const [person] = await seedPersons(suite.db, {
      displayName: "Supervisor",
      pinHash: hashPin("1234"),
      role: "supervisor",
    });
    const clockOn = (day: string): TrustedClock => ({
      now: () => ({
        instant: new Date(`${day}T12:00:00.000Z`),
        offsetMinutes: 60,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
      anchor: () => {
        throw new Error("anchor() is not used here");
      },
      currentAnchor: () => null,
    });
    const { saleId: original } = await withTransaction(suite.db, async (tx) => {
      await backend.registerNode(tx, venue.nodeId);
      return recordSale(tx, backend, {
        operationDescription: "Test op",
        origin: deviceOrigin(venue.deviceId),
        nodeId: venue.nodeId,
        seriesId: brandSeriesId(full!.id),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        total: "12.10",
        lines: [
          {
            lineNo: 1,
            name: "Menu",
            descriptions: { "es-ES": "Menu" },
            quantity: "1",
            unitPrice: "12.10",
            vatRate: "21.00",
            lineTotal: "10.00",
            lineGross: "12.10",
          },
        ],
        settlement: {
          kind: "immediate",
          tenders: [{ method: "card", amount: "12.10", tipAmount: "0.00", settledAt: new Date() }],
        },
        counterparty: { taxId: "12345678Z", legalName: "Harbour Foods", countryCode: "ES" },
        recipientAddress: "2 Main Street, 28013 Madrid, Spain",
        clock: clockOn("2026-11-02"),
      });
    });
    const { saleId: replacement } = await withTransaction(suite.db, async (tx) =>
      recordReplacement(tx, backend, {
        operationDescription: "Test op",
        origin: deviceOrigin(venue.deviceId),
        nodeId: venue.nodeId,
        seriesId: brandSeriesId(corrective!.id),
        correctsSaleId: original,
        authz: {
          sessionId: (
            await loginWithPin(tx, { deviceId: venue.deviceId, personId: person!.id, pin: "1234" })
          ).id,
        },
        clock: clockOn("2026-11-05"),
      }),
    );

    const exported = await list();
    expect(exported.invoices.map((row) => [row.id, row.invoiceType])).toEqual([
      [original, "F1"],
      [replacement, "replacement"],
    ]);
    const xml = strFromU8(
      unzipSync(await renderAccountantWorkbook(exported, "en"))["xl/worksheets/sheet1.xml"]!,
    );
    expect([row(xml, 2).slice(3, 7), row(xml, 3).slice(3, 7)]).toEqual([
      ["F1", "2026-11-02", "Harbour Foods", "12345678Z"],
      [
        "Replacement corrective — do not add (repeats the original)",
        "2026-11-05",
        "Harbour Foods",
        "12345678Z",
      ],
    ]);
  });

  it("lists a sale with ordinary refunds once, under its own type", async () => {
    const [series] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: venue.nodeId, code: "R", purpose: "corrective" })
      .returning({ id: invoiceSeries.id });
    const refundSeries = { ...venue, seriesId: series!.id as SeededVenue["seriesId"] };
    const once = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-01T12:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const twice = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-01T13:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const refunds = [];
    for (const [number, correctsSaleId] of [once, twice, twice].entries()) {
      refunds.push(
        await seedSale(suite.db, refundSeries, {
          invoiceNumber: number + 1,
          issuedAt: `2026-11-0${number + 2}T12:00:00.000Z`,
          total: "-3.30",
          correctsSaleId,
          lines: [{ vatRate: "10.00", lineTotal: "-3.00" }],
        }),
      );
    }

    const rows = (await list()).invoices;
    expect(rows.map((row) => [row.id, row.invoiceType])).toEqual([
      [once, "F2"],
      [twice, "F2"],
      ...refunds.map((refund) => [refund, "corrective"]),
    ]);
  });

  it("shows the sale day of an invoice issued on a later day beside its issue date", async () => {
    const sale = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-04-01T10:00:00.000Z",
      supplyDay: "2026-03-31",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });

    const exported = await list("2026-03-31", "2026-03-31");
    expect(exported.invoices.map((row) => [row.id, row.issueDate, row.saleDate])).toEqual([
      [sale, "2026-04-01", "2026-03-31"],
    ]);
    for (const language of ["en", "es"] as const) {
      const xml = strFromU8(
        unzipSync(await renderAccountantWorkbook(exported, language))["xl/worksheets/sheet1.xml"]!,
      );
      const header = row(xml, 1);
      const cells = row(xml, 2);
      expect(cells[header.indexOf(ACCOUNTANT_EXPORT_WORDS[language].saleDateColumn)]).toBe(
        "2026-03-31",
      );
      expect(cells[4]).toBe("2026-04-01");
    }
  });

  it("selects a sale by its sale day when it has one, else by its issue date", async () => {
    const later = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-04-01T10:00:00.000Z",
      supplyDay: "2026-03-31",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const sameDay = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-04-01T11:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });

    const ids = async (from: string, to: string) =>
      (await list(from, to)).invoices.map((row) => row.id);
    expect(await ids("2026-01-01", "2026-03-31")).toEqual([later]);
    expect(await ids("2026-04-01", "2026-06-30")).toEqual([sameDay]);
  });

  it("puts every row in its sale's period, and over both quarters matches the returns and the corrections", async () => {
    const [series] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: venue.nodeId, code: "R", purpose: "corrective" })
      .returning({ id: invoiceSeries.id });
    const corrective = { ...venue, seriesId: series!.id as SeededVenue["seriesId"] };
    const later = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-04-01T10:00:00.000Z",
      supplyDay: "2026-03-31",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const futureDated = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-04-02T10:00:00.000Z",
      supplyDay: "2026-04-01",
      total: "24.20",
      lines: [{ vatRate: "10.00", lineTotal: "22.00" }],
    });
    const replacement = await seedSale(suite.db, corrective, {
      invoiceNumber: 1,
      issuedAt: "2026-04-03T10:00:00.000Z",
      total: "24.20",
      correctsSaleId: futureDated,
      replacesOriginal: true,
      supplyDay: "2026-03-30",
      lines: [{ vatRate: "10.00", lineTotal: "22.00" }],
    });
    const marchOriginal = await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-03-20T10:00:00.000Z",
      total: "36.30",
      lines: [{ vatRate: "10.00", lineTotal: "33.00" }],
    });
    const undatedReplacement = await seedSale(suite.db, corrective, {
      invoiceNumber: 3,
      issuedAt: "2026-04-05T10:00:00.000Z",
      total: "36.30",
      correctsSaleId: marchOriginal,
      replacesOriginal: true,
      lines: [{ vatRate: "10.00", lineTotal: "33.00" }],
    });
    const refund = await seedSale(suite.db, corrective, {
      invoiceNumber: 2,
      issuedAt: "2026-04-04T10:00:00.000Z",
      total: "-3.30",
      correctsSaleId: later,
      lines: [{ vatRate: "10.00", lineTotal: "-3.00" }],
    });

    const workbookTax = [];
    for (const [from, to, expected] of [
      [
        "2026-01-01",
        "2026-03-31",
        [marchOriginal, undatedReplacement, futureDated, replacement, later],
      ],
      ["2026-04-01", "2026-06-30", [refund]],
    ] as const) {
      const exported = (await list(from, to)).invoices;
      expect(exported.map((row) => row.id)).toEqual(expected);
      const counted = exported.filter((row) => row.invoiceType !== "replacement");
      workbookTax.push(
        ...counted.flatMap((row) => row.vatBreakdown.map((vat) => decimal(vat.tax))),
      );
    }

    const [first, second, secondCorrections] = await withTransaction(suite.db, async (tx) => [
      await computeVatReturn(tx, { year: 2026, period: { kind: "quarter", quarter: 1 } }),
      await computeVatReturn(tx, { year: 2026, period: { kind: "quarter", quarter: 2 } }),
      await computeVatCorrections(tx, { year: 2026, period: { kind: "quarter", quarter: 2 } }),
    ]);
    expect(first.taxTotal).toBe("3.30");
    expect(second.byRate).toEqual([]);
    expect(second.taxTotal).toBe("0.00");
    expect(toScale(sumDecimals(workbookTax), 2)).toBe("6.30");
    expect(
      toScale(
        sumDecimals([
          first.taxTotal,
          second.taxTotal,
          ...secondCorrections.rows.map((row) => row.tax),
        ]),
        2,
      ),
    ).toBe("6.30");
  });

  it("shows a sale date only when it is earlier than the issue date", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-02T10:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const earlierOriginal = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-02T11:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    const sameDay = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, original, { replaces: true, supplyDay: "2026-11-02" }),
    );
    const earlier = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, earlierOriginal, { replaces: true, supplyDay: "2026-11-01" }),
    );

    const exported = (await list()).invoices;
    const byId = new Map(exported.map((row) => [row.id, row]));
    expect(byId.get(sameDay)).toMatchObject({ issueDate: "2026-11-02" });
    expect(byId.get(sameDay)).not.toHaveProperty("saleDate");
    expect(byId.get(earlier)).toMatchObject({ issueDate: "2026-11-02", saleDate: "2026-11-01" });
    const xml = strFromU8(
      unzipSync(
        await renderAccountantWorkbook({ ...(await list()), invoices: [byId.get(sameDay)!] }, "en"),
      )["xl/worksheets/sheet1.xml"]!,
    );
    expect(row(xml, 2)).toHaveLength(19);
  });

  it("uses inclusive receipt dates for purchases and retains recorded scales and discrepancies", async () => {
    for (const [index, receivedOn] of [
      "2026-10-31",
      "2026-11-01",
      "2026-11-30",
      "2026-12-01",
    ].entries()) {
      await seedPurchaseInvoice(suite.db, {
        supplierInvoiceNumber: `P-${index}`,
        issuedOn: "2026-09-01",
        receivedOn,
        total: index === 1 ? "-24.00" : "24.00",
        deductibleProportion: "75.25",
        regime: "equivalence_surcharge",
        lines: [
          { rate: "10.00", base: "10.00", tax: "1.00" },
          { rate: "21.00", base: "10.00", tax: "2.10", kind: "capital" },
        ],
      });
    }
    expect((await list()).purchases).toEqual([
      expect.objectContaining({
        supplierInvoiceNumber: "P-1",
        supplierName: "Supplier",
        supplierTaxId: "B00000000",
        issuedOn: "2026-09-01",
        receivedOn: "2026-11-01",
        total: "-24.00",
        deductibleProportion: "75.25",
        regime: "equivalence_surcharge",
        note: null,
        lines: [
          { rate: "10.00", base: "10.00", tax: "1.00", kind: "ordinary" },
          { rate: "21.00", base: "10.00", tax: "2.10", kind: "capital" },
        ],
      }),
      expect.objectContaining({
        supplierInvoiceNumber: "P-2",
        receivedOn: "2026-11-30",
        total: "24.00",
      }),
    ]);
    expect(
      (await list("2026-11-30", "2026-11-30")).purchases.map((p) => p.supplierInvoiceNumber),
    ).toEqual(["P-2"]);
    expect((await list("2026-12-31", "2026-12-31")).purchases).toEqual([]);
  });
});

describe("refunds without a corrective invoice", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
  let venue: SeededVenue;
  beforeEach(async () => {
    venue = await seedVenueWithSeries(suite.db);
  });
  const list = (from = "2026-11-01", to = "2026-11-30") =>
    withTransaction(suite.db, (tx) => listAccountantExport(tx, { from, to }));
  const refund = (
    target: Awaited<ReturnType<typeof seedRefundableSale>>,
    applied: string,
    at: string,
  ) =>
    seedTenderRefund(suite.db, target, {
      applied,
      tip: "0.00",
      state: "completed",
      createdAt: at,
      at,
    });

  it("lists a part payment's plain refund with the table's ticket that took it off and the VAT it leaves declared", async () => {
    const advance = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "30.00",
      tip: "0.00",
      at: "2026-11-02T12:00:00.000Z",
      invoiceNumber: 1,
      vatRate: "10.00",
      base: "27.27",
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-02T14:00:00.000Z",
      total: "90.00",
      lines: [
        { vatRate: "10.00", lineTotal: "109.09" },
        {
          vatRate: "10.00",
          lineTotal: "-27.27",
          advanceRole: "deduction",
          deductsSaleId: advance.saleId,
        },
      ],
    });
    const id = await refund(advance, "20.00", "2026-11-03T12:00:00.000Z");

    expect((await list()).refundsWithoutCorrective).toEqual([
      {
        id,
        refundedAt: "2026-11-03T12:00:00.000Z",
        amount: "20.00",
        tip: "0.00",
        method: "cash",
        reason: "Money returned after the invoice",
        requestedBy: "Refund operator",
        authorizedBy: "Refund authorizer",
        saleId: advance.saleId,
        invoiceNumber: "A/1",
        takenOffBy: "A/2",
        vat: [{ rate: "10.00", base: "18.18", tax: "1.82" }],
      },
    ]);
  });

  it("lists a plain refund of an ordinary card payment, but not a Correct invoice's refund nor one completed outside the period", async () => {
    const card = await seedRefundableSale(suite.db, venue, {
      method: "card",
      applied: "12.10",
      tip: "0.00",
      at: "2026-11-02T12:00:00.000Z",
      invoiceNumber: 1,
      vatRate: "21.00",
      base: "10.00",
    });
    const plain = await refund(card, "6.05", "2026-11-04T12:00:00.000Z");
    await refund(card, "1.00", "2026-12-01T12:00:00.000Z");
    const corrected = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "11.00",
      tip: "0.00",
      at: "2026-11-02T13:00:00.000Z",
      invoiceNumber: 2,
      vatRate: "10.00",
      base: "10.00",
    });
    const correctionRefund = await refund(corrected, "5.50", "2026-11-05T12:00:00.000Z");
    const corrective = await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-11-05T12:00:00.000Z",
      total: "-5.50",
      correctsSaleId: corrected.saleId,
      lines: [{ vatRate: "10.00", lineTotal: "-5.00" }],
    });
    const [correction] = await suite.db
      .insert(invoiceCorrections)
      .values({
        originalSaleId: corrected.saleId,
        submissionId: "correction-1",
        fingerprint: "fixture",
        gross: 550,
        reason: "Overcharged",
        requestedBy: "cccccccc-0000-4000-8000-000000000010",
        authorizedBy: "cccccccc-0000-4000-8000-000000000011",
        viaOverride: false,
        source: "device",
        deviceId: venue.deviceId,
        nodeId: venue.nodeId,
        state: "filed",
        correctiveSaleId: corrective,
        endedAt: "2026-11-05T12:00:00.000Z",
      })
      .returning({ id: invoiceCorrections.id });
    await suite.db.insert(invoiceCorrectionRefunds).values({
      invoiceCorrectionId: correction!.id,
      tenderRefundId: correctionRefund,
      requestId: "request-1",
    });

    expect((await list()).refundsWithoutCorrective).toEqual([
      expect.objectContaining({
        id: plain,
        method: "card",
        amount: "6.05",
        invoiceNumber: "A/1",
        takenOffBy: null,
        vat: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
      }),
    ]);
    expect(
      (await list("2026-12-01", "2026-12-01")).refundsWithoutCorrective.map((row) => row.amount),
    ).toEqual(["1.00"]);
  });

  it("shares a refund over a two-rate ticket by gross, the last rate taking the remainder, so the rows sum to the refund", async () => {
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-02T12:00:00.000Z",
      total: "22.00",
      lines: [
        { vatRate: "10.00", lineTotal: "10.00" },
        { vatRate: "21.00", lineTotal: "9.09" },
      ],
      vatBreakdown: [
        { rate: "10.00", base: "10.00", tax: "1.00" },
        { rate: "21.00", base: "9.09", tax: "1.91" },
      ],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "cash", amount: "22.00", settledAt: "2026-11-02T12:00:00.000Z" },
    );
    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    const ticket = { saleId, tenderId: tender!.id, method: "cash" as const, venue };
    await refund(ticket, "10.01", "2026-11-03T12:00:00.000Z");

    const [row] = (await list()).refundsWithoutCorrective;
    expect(row!.vat).toEqual([
      { rate: "10.00", base: "4.55", tax: "0.46" },
      { rate: "21.00", base: "4.13", tax: "0.87" },
    ]);
    expect(toScale(sumDecimals(row!.vat.flatMap((vat) => [vat.base, vat.tax])), 2)).toBe("10.01");
  });

  it("shares a refund of a table's ticket only over the rates it sold at, not over the part payment it took off", async () => {
    const advance = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "30.00",
      tip: "0.00",
      at: "2026-11-02T12:00:00.000Z",
      invoiceNumber: 1,
      vatRate: "10.00",
      base: "27.27",
    });
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-02T14:00:00.000Z",
      total: "50.00",
      lines: [
        { vatRate: "21.00", lineTotal: "66.12" },
        {
          vatRate: "10.00",
          lineTotal: "-27.27",
          advanceRole: "deduction",
          deductsSaleId: advance.saleId,
        },
      ],
      vatBreakdown: [
        { rate: "21.00", base: "66.12", tax: "13.88" },
        { rate: "10.00", base: "-27.27", tax: "-2.73" },
      ],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "cash", amount: "50.00", settledAt: "2026-11-02T14:00:00.000Z" },
    );
    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    await refund(
      { saleId, tenderId: tender!.id, method: "cash" as const, venue },
      "10.00",
      "2026-11-03T12:00:00.000Z",
    );

    const [row] = (await list()).refundsWithoutCorrective;
    expect(row).toMatchObject({ saleId, invoiceNumber: "A/2", takenOffBy: null });
    expect(row!.vat).toEqual([{ rate: "21.00", base: "8.26", tax: "1.74" }]);
  });

  it("leaves out a bill refund, even of a payment on a bill whose ticket was already issued", async () => {
    const { orderId } = await seedOpenOrder(suite.db, venue, 1);
    const payment = await seedBillPayment(
      suite.db,
      { workingOrderId: orderId, deviceId: venue.deviceId },
      { method: "cash", applied: "20.00", state: "received", at: "2026-11-02T13:00:00.000Z" },
    );
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-02T12:00:00.000Z",
      total: "22.00",
      workingOrderId: orderId,
      lines: [{ vatRate: "10.00", lineTotal: "20.00" }],
    });
    await seedBillRefund(
      suite.db,
      { billPaymentId: payment, deviceId: venue.deviceId, nodeId: venue.nodeId },
      { applied: "5.00", state: "completed", at: "2026-11-03T12:00:00.000Z" },
    );
    const control = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "11.00",
      tip: "0.00",
      at: "2026-11-02T12:00:00.000Z",
      invoiceNumber: 2,
      vatRate: "10.00",
      base: "10.00",
    });
    const plain = await refund(control, "1.00", "2026-11-03T12:00:00.000Z");

    expect((await list()).refundsWithoutCorrective.map((row) => row.id)).toEqual([plain]);
  });

  it("lists a refund in the period it completed in, not the one it was asked for in", async () => {
    const ticket = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "11.00",
      tip: "0.00",
      at: "2026-10-30T12:00:00.000Z",
      invoiceNumber: 1,
      vatRate: "10.00",
      base: "10.00",
    });
    const intoNovember = await seedTenderRefund(suite.db, ticket, {
      applied: "1.00",
      tip: "0.00",
      state: "completed",
      createdAt: "2026-10-31T12:00:00.000Z",
      at: "2026-11-01T12:00:00.000Z",
    });
    const intoDecember = await seedTenderRefund(suite.db, ticket, {
      applied: "2.00",
      tip: "0.00",
      state: "completed",
      createdAt: "2026-11-30T12:00:00.000Z",
      at: "2026-12-01T12:00:00.000Z",
    });
    const ids = async (from: string, to: string) =>
      (await list(from, to)).refundsWithoutCorrective.map((row) => row.id);

    expect(await ids("2026-10-01", "2026-10-31")).toEqual([]);
    expect(await ids("2026-11-01", "2026-11-30")).toEqual([intoNovember]);
    expect(await ids("2026-12-01", "2026-12-31")).toEqual([intoDecember]);
  });

  it.each(["en", "es"] as const)(
    "writes one row per VAT rate under a note that the VAT stays declared (%s)",
    async (language) => {
      const words = ACCOUNTANT_EXPORT_WORDS[language];
      const files = unzipSync(
        await renderAccountantWorkbook(
          {
            invoices: [],
            purchases: [],
            outsidePayments: [],
            refundsWithoutCorrective: [
              {
                id: "refund-1",
                refundedAt: "2026-11-03T12:00:00.000Z",
                amount: decimal("10.01"),
                tip: decimal("0.50"),
                method: "card",
                reason: "Goodwill",
                requestedBy: "Ana",
                authorizedBy: "Luis",
                saleId: "sale-1",
                invoiceNumber: "A/1",
                takenOffBy: "A/2",
                vat: [
                  { rate: "10.00", base: decimal("4.55"), tax: decimal("0.46") },
                  { rate: "21.00", base: decimal("4.13"), tax: decimal("0.87") },
                ],
              },
            ],
          },
          language,
        ),
      );
      expect(strFromU8(files["xl/workbook.xml"]!)).toContain(
        `name="${language === "en" ? "Refunds, no corrective invoice" : ACCOUNTANT_EXPORT_WORDS.es.refundSheet}"`,
      );
      const xml = strFromU8(files["xl/worksheets/sheet4.xml"]!);
      expect(row(xml, 1)).toEqual([
        language === "en"
          ? "Note: no corrective invoice was filed for these refunds, so the VAT shown stays declared until the accountant acts"
          : ACCOUNTANT_EXPORT_WORDS.es.refundNote,
      ]);
      expect(row(xml, 2)).toEqual(words.refundColumns);
      expect(row(xml, 2)).toHaveLength(14);
      const card = words.paymentMethods.card;
      const shared = ["refund-1", "2026-11-03T12:00:00.000Z"];
      const tail = [card, "Goodwill", "Ana", "Luis", "sale-1", "A/1", "A/2"];
      expect(row(xml, 3)).toEqual([...shared, "10.01", "0.50", ...tail, "10.00", "4.55", "0.46"]);
      expect(row(xml, 4)).toEqual([...shared, "", "", ...tail, "21.00", "4.13", "0.87"]);
    },
  );
});
