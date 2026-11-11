import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { renderAccountantWorkbook } from "./accountant-export.js";

function row(xml: string, number: number): string[] {
  const body = xml.match(new RegExp(`<row r="${number}">([\\s\\S]*?)</row>`))?.[1] ?? "";
  return [...body.matchAll(/<c [^>]*>([\s\S]*?)<\/c>/g)].map(
    (cell) => cell[1]!.match(/<(?:t(?: [^>]*)?|v)>([\s\S]*?)<\/(?:t|v)>/)?.[1] ?? "",
  );
}

const invoice = {
  id: "sale-1",
  nodeId: "node-1",
  invoiceNumber: "A/000001",
  invoiceType: "F1" as const,
  issueDate: "2026-11-01",
  operationDate: "2026-10-31",
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
  it("keeps a zero-total invoice with no recorded VAT groups, leaving its missing VAT facts blank", () => {
    const files = unzipSync(
      renderAccountantWorkbook(
        { invoices: [{ ...invoice, vatBreakdown: [], total: decimal("0.00") }], purchases: [] },
        "en",
      ),
    );
    const cells = row(strFromU8(files["xl/worksheets/sheet1.xml"]!), 2);
    expect(cells[0]).toBe("sale-1");
    expect(cells.slice(12, 16)).toEqual(["", "", "", "0.00"]);
  });
  it.each(["en", "es"] as const)(
    "opens two header-only sheets when the period is empty (%s)",
    (language) => {
      const bytes = renderAccountantWorkbook({ invoices: [], purchases: [] }, language);
      expect([...bytes.subarray(0, 4)]).toEqual([80, 75, 3, 4]);
      const files = unzipSync(bytes);
      const workbook = strFromU8(files["xl/workbook.xml"]!);
      expect(workbook.match(/<sheet /g)).toHaveLength(2);
      expect(workbook).toContain(
        language === "en" ? 'name="Issued invoices"' : 'name="Facturas emitidas"',
      );
      expect(workbook).toContain(
        language === "en" ? 'name="Recorded purchases"' : 'name="Compras registradas"',
      );
      for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
        const sheet = strFromU8(files[name]!);
        expect(sheet.match(/<row /g)).toHaveLength(1);
        expect(sheet).toContain(language === "en" ? "Invoice number" : "Número de factura");
      }
      expect(strFromU8(files["[Content_Types].xml"]!)).toContain("spreadsheetml.sheet.main+xml");
      expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain("worksheets/sheet2.xml");
    },
  );

  it("keeps invoice VAT groups, later voids and signed correction links, with gross only once", () => {
    const files = unzipSync(
      renderAccountantWorkbook(
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
      "2026-10-31",
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
    expect(row(xml, 3).slice(12, 20)).toEqual([
      "21.00",
      "10.00",
      "2.10",
      "",
      "",
      "",
      "2026-12-01T12:00:00Z",
      "",
    ]);
    expect(row(xml, 4).slice(12, 20)).toEqual([
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
    expect(xml).toContain('<c r="N2" t="n" s="1"><v>10.00</v></c>');
    expect(row(xml, 1)[18]).toBe("Voided at (UTC)");
    expect(row(xml, 1)[19]).toContain("original tickets retained");
    expect(strFromU8(files["xl/styles.xml"]!)).toContain('numFmtId="2"');
  });

  it("keeps entered purchase VAT and gross, marking negative and unreconciled totals independently", () => {
    const files = unzipSync(
      renderAccountantWorkbook(
        {
          invoices: [],
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
      "general",
      "75.00",
      "ordinary",
      "10.00",
      "10.00",
      "1.00",
      "-23.10",
      "Negative total; Total differs from VAT lines",
      "Check credit",
    ]);
    expect(row(xml, 3).slice(8, 15)).toEqual([
      "capital",
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

  it("writes hostile names as literal XML-safe text and preserves identifiers and plain decimal cells", () => {
    const files = unzipSync(
      renderAccountantWorkbook(
        {
          invoices: [
            {
              ...invoice,
              invoiceNumber: "00123",
              customerName: "=2+3 & <\"'>\u0001\u000b\ud800😀",
              customerTaxId: "+00123",
              customerAddress: "@SUM(A1:A2)\tRoad\nFlat 1\r",
            },
          ],
          purchases: [
            { ...purchase, supplierInvoiceNumber: "-0042", supplierName: "A&B <supplier>" },
          ],
        },
        "es",
      ),
    );
    const sales = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const purchases = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(sales).toContain("=2+3 &amp; &lt;&quot;&apos;&gt;���😀");
    expect(sales).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">00123</t>');
    expect(sales).toContain('<c r="H2" t="inlineStr"><is><t xml:space="preserve">+00123</t>');
    expect(sales).toContain("@SUM(A1:A2)\tRoad\nFlat 1&#13;");
    expect(purchases).toContain("A&amp;B &lt;supplier&gt;");
    expect(purchases).toContain('xml:space="preserve">-0042</t>');
    for (const sheet of [sales, purchases]) {
      expect(sheet).not.toMatch(/<f(?:\s|>)/);
      for (const invalid of ["\u0001", "\u000b", "\ud800"]) expect(sheet).not.toContain(invalid);
      expect(sheet).not.toMatch(/<v>[^<]*[eE+]/);
    }
  });
});
