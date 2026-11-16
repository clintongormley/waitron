import "./errors.js";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Database } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import { csvCell } from "./attendance-export-csv.js";
import { TAX_OFFICE_EXPORT_WORDS } from "./i18n/tax-office-export.js";
import { uniquePdfPath } from "./invoice-customer-data.js";
import { copyOfSale, type SaleCopy } from "./orders-invoice-pdf.js";
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
  /** The person the first turn authorized; the last turn must authorize the same one. */
  authorizedBy: string;
  sessionId: string;
  at: Date;
}

export interface TaxOfficeExportDeps {
  db: Database;
  backend: FiscalBackend;
  tradingContext: TradingContext;
  render: (copy: SaleCopy) => Promise<Uint8Array>;
  /** Throws when the export must stop: the request was aborted or a handover closed the gate. */
  stopIfAsked: () => void;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Without the shared cell's formula guard, so a negative amount stays a number in a spreadsheet;
 * anything that is not a plain decimal goes through the guard. */
function numberCell(text: string): string {
  return DECIMAL.test(text) ? `"${text}"` : csvCell(text);
}

function timeOf(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function dayOf(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(instant));
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
          csvCell(timeOf(row.issuedAt, timeZone)),
          csvCell(row.operationDate ?? ""),
          csvCell(row.customerName ?? ""),
          csvCell(row.customerTaxId ?? ""),
          rate === null ? csvCell("") : numberCell(rate.rate),
          rate === null ? csvCell("") : numberCell(rate.base),
          rate === null ? csvCell("") : numberCell(rate.tax),
          numberCell(String(row.total)),
          csvCell(row.corrects.join(" ")),
          csvCell(row.cancelledAt === null ? "" : dayOf(row.cancelledAt, timeZone)),
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
 * thread. Authority is checked again after the last copy.
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
      date: dayOf(month.at.toISOString(), month.issued.timeZone),
    }),
  };
  yield {
    name: "invoices.csv",
    content: renderTaxOfficeCsv(rows, month.language, month.issued.timeZone),
  };
  const taken = new Set<string>();
  for (const row of rows) {
    deps.stopIfAsked();
    const copy = await deps.db.withWriteLock(() => copyOfSale(tx, deps, row.id));
    deps.stopIfAsked();
    const content = await deps.render(copy);
    await nextTurn();
    yield { name: uniquePdfPath(taken, copy.code, copy.number), content };
  }
  await deps.db.withWriteLock(async () => {
    const again = await authorizeManager(tx, {
      managementSessionId: month.sessionId,
      permission: "invoice.inspect",
      touch: false,
    });
    if (again.authorizedBy !== month.authorizedBy)
      throw new Error("tax office authorisation named a different person after building");
  });
}
