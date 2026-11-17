import "./errors.js";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Database } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { civilDateOf } from "@waitron/reporting";
import { codeOf, type Logger } from "@waitron/server-kit";
import { decimal } from "@waitron/shared";
import { csvCell } from "./attendance-export-csv.js";
import { amountCell } from "./deferred-payment-export.js";
import { TAX_OFFICE_EXPORT_WORDS } from "./i18n/tax-office-export.js";
import { uniquePdfPath } from "./invoice-customer-data.js";
import { copyOfSale, rememberedReceiptPrinters, type SaleCopy } from "./orders-invoice-pdf.js";
import {
  listTaxOfficeInvoices,
  TAX_OFFICE_PAGE_SIZE,
  type TaxOfficeCursor,
  type TaxOfficeFilter,
  type TaxOfficeInvoice,
} from "./tax-office-list.js";
import type { TradingContext } from "./trading-context.js";

export interface TaxOfficeMonth {
  month: string;
  issued: TaxOfficeFilter["issued"];
  language: "en" | "es";
  venue: string | null;
  at: Date;
}

export interface TaxOfficeExportDeps {
  db: Database;
  backend: FiscalBackend;
  tradingContext: TradingContext;
  render: (copy: SaleCopy) => Promise<Uint8Array>;
  /** Throws once the build's job is asked to stop. */
  stopIfAsked: () => void;
  log: Logger;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A rate as `amountCell` writes an amount, at its own scale; anything that is not a plain decimal
 * goes through the shared cell's formula guard. */
function rateCell(text: string, language: "en" | "es"): string {
  if (!DECIMAL.test(text)) return csvCell(text);
  return `"${language === "es" ? text.replace(".", ",") : text}"`;
}

export function renderTaxOfficeCsv(
  rows: readonly TaxOfficeInvoice[],
  language: "en" | "es",
  timeZone: string,
): Uint8Array {
  const w = TAX_OFFICE_EXPORT_WORDS[language].columns;
  const lines = [
    [
      w.number,
      w.kind,
      w.issueDate,
      w.issueTime,
      w.operationDate,
      w.customerName,
      w.customerTaxId,
      w.vatRate,
      w.base,
      w.vat,
      w.total,
      w.corrects,
      w.cancelledOn,
    ]
      .map(csvCell)
      .join(","),
  ];
  for (const row of rows) {
    const rates = row.vat.length === 0 ? [null] : row.vat;
    for (const rate of rates) {
      lines.push(
        [
          csvCell(row.number),
          csvCell(row.kind),
          csvCell(row.issueDate),
          csvCell(row.issueTime),
          csvCell(row.operationDate ?? ""),
          csvCell(row.customerName ?? ""),
          csvCell(row.customerTaxId ?? ""),
          rate === null ? csvCell("") : rateCell(rate.rate, language),
          rate === null ? csvCell("") : amountCell(decimal(rate.base), language),
          rate === null ? csvCell("") : amountCell(decimal(rate.tax), language),
          amountCell(row.total, language),
          csvCell(row.corrects.join(" ")),
          csvCell(row.cancelledAt === null ? "" : civilDateOf(new Date(row.cancelledAt), timeZone)),
        ].join(","),
      );
    }
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

/**
 * The month's ZIP entries, oldest invoice first. The rows are read one page per lock turn; each
 * copy is read in a lock turn of its own and rendered outside it, with a turn of the event loop
 * after each render, since a render resolves without one and renders back to back would hold the
 * thread. A copy that cannot be made is logged, left out and named in `failed.txt`, unless the
 * export was asked to stop. Whether to stop is checked again after the last copy.
 */
export async function* taxOfficeMonthEntries(
  deps: TaxOfficeExportDeps,
  month: TaxOfficeMonth,
): AsyncGenerator<{ name: string; content: string | Uint8Array }> {
  // Lock turns read through the database itself, as `invoice-customer-data-api.ts` explains.
  const tx = deps.db;
  const rows: TaxOfficeInvoice[] = [];
  let after: TaxOfficeCursor | undefined;
  do {
    deps.stopIfAsked();
    const page = await deps.db.withWriteLock(() =>
      listTaxOfficeInvoices(tx, {
        issued: month.issued,
        limit: TAX_OFFICE_PAGE_SIZE,
        ...(after === undefined ? {} : { after }),
      }),
    );
    rows.push(...page.rows);
    after = page.next ?? undefined;
    await nextTurn();
  } while (after !== undefined);
  rows.reverse();
  yield {
    name: "README.txt",
    content: TAX_OFFICE_EXPORT_WORDS[month.language].readme({
      venue: month.venue,
      month: month.month,
      timeZone: month.issued.timeZone,
      date: civilDateOf(month.at, month.issued.timeZone),
    }),
  };
  yield {
    name: "invoices.csv",
    content: renderTaxOfficeCsv(rows, month.language, month.issued.timeZone),
  };
  const taken = new Set<string>();
  const failed: string[] = [];
  const receiptPrinterOf = rememberedReceiptPrinters();
  for (const row of rows) {
    deps.stopIfAsked();
    let made: { copy: SaleCopy; content: Uint8Array };
    try {
      const copy = await deps.db.withWriteLock(() =>
        copyOfSale(tx, deps, row.id, receiptPrinterOf),
      );
      deps.stopIfAsked();
      made = { copy, content: await deps.render(copy) };
    } catch (error) {
      deps.stopIfAsked();
      deps.log("error", "tax_office.copy_failed", {
        saleId: row.id,
        invoiceNumber: row.number,
        errorCode: codeOf(error),
        errorClass: error instanceof Error ? error.name : typeof error,
      });
      failed.push(row.number);
      await nextTurn();
      continue;
    }
    await nextTurn();
    yield { name: uniquePdfPath(taken, made.copy.code, made.copy.number), content: made.content };
  }
  if (failed.length > 0)
    yield { name: "failed.txt", content: TAX_OFFICE_EXPORT_WORDS[month.language].failed(failed) };
  deps.stopIfAsked();
}
