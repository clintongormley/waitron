import { strToU8, zipSync } from "fflate";
import type { PurchaseInvoice } from "@waitron/purchasing";
import { compareDecimal, decimal, sumDecimals, toScale, type Decimal } from "@waitron/shared";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface AccountantInvoice {
  id: string;
  nodeId: string;
  invoiceNumber: string;
  invoiceType: "F1" | "F2" | "corrective";
  issueDate: string;
  operationDate: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  customerIdentifierType: string | null;
  customerIdentifierCountry: string | null;
  customerCountry: string | null;
  customerAddress: string | null;
  total: Decimal;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  correctsSaleId: string | null;
  originalInvoiceNumber: string | null;
  voidedAt: string | null;
}

export interface AccountantExport {
  invoices: readonly AccountantInvoice[];
  purchases: readonly PurchaseInvoice[];
}

type Cell = string | null | { number: Decimal };
const numeric = (value: string): Cell => ({ number: toScale(decimal(value), 2) });

function xmlText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    return code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
      ? character
      : "�";
  })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;");
}

function worksheet(rows: readonly (readonly Cell[])[]): string {
  return `${XML}<worksheet xmlns="${SHEET}"><sheetData>${rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((cell, column) => {
            const reference = `${String.fromCharCode(65 + column)}${index + 1}`;
            return cell !== null && typeof cell === "object"
              ? `<c r="${reference}" t="n" s="1"><v>${cell.number}</v></c>`
              : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(cell ?? "")}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;
}

export function renderAccountantWorkbook(
  data: AccountantExport,
  language: "en" | "es",
): Uint8Array {
  const words = ACCOUNTANT_EXPORT_WORDS[language];
  const invoiceRows: Cell[][] = [];
  for (const invoice of data.invoices) {
    const groups = invoice.vatBreakdown.length === 0 ? [null] : invoice.vatBreakdown;
    for (const [index, vat] of groups.entries()) {
      invoiceRows.push([
        invoice.id,
        invoice.nodeId,
        invoice.invoiceNumber,
        invoice.invoiceType === "corrective" ? words.corrective : invoice.invoiceType,
        invoice.issueDate,
        invoice.operationDate,
        invoice.customerName,
        invoice.customerTaxId,
        invoice.customerIdentifierType,
        invoice.customerIdentifierCountry,
        invoice.customerCountry,
        invoice.customerAddress,
        vat === null ? null : numeric(vat.rate),
        vat === null ? null : numeric(vat.base),
        vat === null ? null : numeric(vat.tax),
        index === 0 ? numeric(invoice.total) : null,
        invoice.correctsSaleId,
        invoice.originalInvoiceNumber,
        invoice.voidedAt,
        null,
      ]);
    }
  }
  const purchaseRows: Cell[][] = [];
  for (const purchase of data.purchases) {
    const entered = sumDecimals(purchase.lines.flatMap((line) => [line.base, line.tax]));
    const flags = [
      ...(compareDecimal(purchase.total, decimal("0.00")) < 0 ? [words.negative] : []),
      ...(compareDecimal(purchase.total, entered) !== 0 ? [words.unreconciled] : []),
    ].join("; ");
    for (const [index, line] of purchase.lines.entries()) {
      purchaseRows.push([
        purchase.supplierInvoiceNumber,
        purchase.id,
        purchase.supplierName,
        purchase.supplierTaxId,
        purchase.issuedOn,
        purchase.receivedOn,
        purchase.regime,
        numeric(purchase.deductibleProportion),
        line.kind,
        numeric(line.rate),
        numeric(line.base),
        numeric(line.tax),
        index === 0 ? numeric(purchase.total) : null,
        flags,
        purchase.note,
      ]);
    }
  }
  const parts = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${SHEET}" xmlns:r="${REL}"><sheets><sheet name="${words.invoiceSheet}" sheetId="1" r:id="rId1"/><sheet name="${words.purchaseSheet}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${XML}<styleSheet xmlns="${SHEET}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": worksheet([words.invoiceColumns, ...invoiceRows]),
    "xl/worksheets/sheet2.xml": worksheet([words.purchaseColumns, ...purchaseRows]),
  };
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])),
  );
}
