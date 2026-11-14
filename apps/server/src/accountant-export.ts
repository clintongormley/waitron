import { listOutsidePayments, type OutsidePayment } from "./outside-payments-report.js";
import { validatedRangeWindow } from "@waitron/reporting";
import { readVenueClock } from "@waitron/db";
import { and, asc, between, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { invoiceSeries, sales, saleSubstitutions, saleVoids, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { listPurchaseInvoices } from "@waitron/purchasing";
import { setImmediate as nextTurn } from "node:timers/promises";
import { strToU8, zip } from "fflate";
import type { PurchaseInvoice } from "@waitron/purchasing";
import {
  centsToDecimal,
  compareDecimal,
  decimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
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
  outsidePayments: readonly OutsidePayment[];
}

type Cell = string | null | { number: Decimal };
const numeric = (value: string): Cell => ({ number: toScale(decimal(value), 2) });

function xmlText(value: string): string {
  return value
    .replace(/[^\t\n\r\x20-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "�")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;");
}

async function worksheet(rows: readonly (readonly Cell[])[]): Promise<string> {
  const parts = [`${XML}<worksheet xmlns="${SHEET}"><sheetData>`];
  for (const [index, row] of rows.entries()) {
    if (index % 250 === 0) await nextTurn();
    parts.push(
      `<row r="${index + 1}">${row
        .map((cell, column) => {
          const reference = `${String.fromCharCode(65 + column)}${index + 1}`;
          return cell !== null && typeof cell === "object"
            ? `<c r="${reference}" t="n" s="1"><v>${cell.number}</v></c>`
            : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(cell ?? "")}</t></is></c>`;
        })
        .join("")}</row>`,
    );
  }
  parts.push("</sheetData></worksheet>");
  return parts.join("");
}

export async function renderAccountantWorkbook(
  data: AccountantExport,
  language: "en" | "es",
): Promise<Uint8Array<ArrayBuffer>> {
  const words = ACCOUNTANT_EXPORT_WORDS[language];
  const invoiceRows: Cell[][] = [];
  for (const [position, invoice] of data.invoices.entries()) {
    if (position % 250 === 0) await nextTurn();
    const groups = invoice.vatBreakdown.length === 0 ? [null] : invoice.vatBreakdown;
    for (const [index, vat] of groups.entries()) {
      invoiceRows.push([
        invoice.id,
        invoice.nodeId,
        invoice.invoiceNumber,
        invoice.invoiceType === "corrective" ? words.corrective : invoice.invoiceType,
        invoice.issueDate,
        invoice.customerName,
        invoice.customerTaxId,
        invoice.customerIdentifierType === null
          ? null
          : words.identifierTypes[
              invoice.customerIdentifierType as keyof typeof words.identifierTypes
            ],
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
  for (const [position, purchase] of data.purchases.entries()) {
    if (position % 250 === 0) await nextTurn();
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
        words.regimes[purchase.regime],
        numeric(purchase.deductibleProportion),
        words.vatKinds[line.kind],
        numeric(line.rate),
        numeric(line.base),
        numeric(line.tax),
        index === 0 ? numeric(purchase.total) : null,
        flags,
        purchase.note,
      ]);
    }
  }
  const outsideRows: Cell[][] = data.outsidePayments.map((payment) => [
    payment.id,
    payment.workingOrderId,
    payment.saleId,
    payment.invoiceNumber,
    payment.nodeId,
    payment.settledAt,
    numeric(payment.amount),
    payment.externalProvider === null ? null : words.outsideSources[payment.externalProvider],
    payment.externalMachine,
    payment.externalRef,
    words.paymentStates[payment.state],
    numeric(payment.refunded),
  ]);
  const parts = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${SHEET}" xmlns:r="${REL}"><sheets><sheet name="${words.invoiceSheet}" sheetId="1" r:id="rId1"/><sheet name="${words.purchaseSheet}" sheetId="2" r:id="rId2"/><sheet name="${words.outsideSheet}" sheetId="3" r:id="rId4"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId4" Type="${REL}/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${XML}<styleSheet xmlns="${SHEET}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": await worksheet([words.invoiceColumns, ...invoiceRows]),
    "xl/worksheets/sheet3.xml": await worksheet([words.outsideColumns, ...outsideRows]),
    "xl/worksheets/sheet2.xml": await worksheet([words.purchaseColumns, ...purchaseRows]),
  };
  const entries = Object.fromEntries(
    Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)]),
  );
  return new Promise((resolve, reject) => {
    zip(entries, (error, bytes) => {
      if (error) reject(error);
      else resolve(bytes);
    });
  });
}

export async function listAccountantExport(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<AccountantExport> {
  const original = alias(sales, "original_invoice");
  const originalSeries = alias(invoiceSeries, "original_series");
  const civilDate = sql<string>`date(${sales.issuedAt}, printf('%+d minutes', ${sales.issuedOffsetMinutes}))`;
  const rows = await tx
    .select({
      id: sales.id,
      nodeId: sales.nodeId,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issueDate: civilDate,
      customerName: sales.counterpartyLegalName,
      customerTaxId: sales.counterpartyTaxId,
      customerIdentifierType: sales.counterpartyIdentifierType,
      customerIdentifierCountry: sales.counterpartyIdentifierCountryCode,
      customerCountry: sales.counterpartyCountryCode,
      customerAddress: sales.counterpartyAddress,
      total: sales.total,
      vatBreakdown: sales.vatBreakdown,
      correctsSaleId: sales.correctsSaleId,
      originalCode: originalSeries.code,
      originalNumber: original.invoiceNumber,
      voidedAt: saleVoids.voidedAt,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(original, eq(original.id, sales.correctsSaleId))
    .leftJoin(originalSeries, eq(originalSeries.id, original.seriesId))
    .leftJoin(saleVoids, eq(saleVoids.saleId, sales.id))
    .leftJoin(saleSubstitutions, eq(saleSubstitutions.substitutionSaleId, sales.id))
    .where(and(between(civilDate, range.from, range.to), isNull(saleSubstitutions.id)))
    .orderBy(asc(civilDate), asc(sales.issuedAt), asc(sales.id));
  const invoices: AccountantInvoice[] = rows.map(
    ({ code, number, originalCode, originalNumber, ...row }) => ({
      ...row,
      invoiceNumber: formatInvoiceNumber(code, number),
      invoiceType:
        row.correctsSaleId !== null ? "corrective" : row.customerTaxId === null ? "F2" : "F1",
      originalInvoiceNumber:
        originalCode === null || originalNumber === null
          ? null
          : formatInvoiceNumber(originalCode, originalNumber),
      total: centsToDecimal(row.total),
    }),
  );
  const nextDay = new Date(`${range.to}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const purchases = await listPurchaseInvoices(tx, {
    from: range.from,
    to: nextDay.toISOString().slice(0, 10),
  });
  const clock = await readVenueClock(tx);
  const outsidePayments = await listOutsidePayments(
    tx,
    validatedRangeWindow({
      fromBusinessDay: range.from,
      toBusinessDay: range.to,
      timeZone: clock.timeZone,
      dayCutover: "00:00",
      cutoverChanges: [],
    }),
  );
  return { invoices, purchases, outsidePayments };
}
