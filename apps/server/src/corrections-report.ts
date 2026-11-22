import { formatInvoiceNumber } from "@waitron/core";
import type { VatCorrections } from "@waitron/reporting";
import type { FreeItem } from "./free-items.js";
import { CORRECTIONS_REPORT_WORDS } from "./i18n/corrections-report.js";
import { numeric, renderWorkbook, type Cell } from "./xlsx-workbook.js";

export function renderCorrectionsWorkbook(
  corrections: VatCorrections,
  free: readonly FreeItem[],
  language: "en" | "es",
): Promise<Uint8Array<ArrayBuffer>> {
  const words = CORRECTIONS_REPORT_WORDS[language];
  const summary: Cell[][] =
    corrections.summary.length === 0
      ? [[words.nothing]]
      : corrections.summary.map((line) => [
          corrections.madeIn,
          line.belongsTo,
          numeric(line.rate),
          words.directions[line.direction],
          numeric(line.base),
          numeric(line.tax),
        ]);
  const rows: Cell[][] = corrections.rows.map((row) => [
    row.madeDay,
    words.kinds[row.kind],
    formatInvoiceNumber(row.invoice.seriesCode, row.invoice.number),
    row.corrects === null
      ? null
      : formatInvoiceNumber(row.corrects.seriesCode, row.corrects.number),
    row.corrects?.issueDate ?? null,
    row.belongsTo,
    numeric(row.rate),
    numeric(row.base),
    numeric(row.tax),
    words.directions[row.direction],
  ]);
  const given: Cell[][] = free.map((item) => [
    item.date,
    item.invoice === null
      ? null
      : formatInvoiceNumber(item.invoice.seriesCode, item.invoice.number),
    item.item ?? words.wholeBill,
    item.quantity === null ? null : { number: item.quantity },
    words.freeKinds[item.kind],
    item.department,
    numeric(item.menuPrice),
    numeric(item.amountTakenOff),
    item.estimatedCost === null ? null : numeric(item.estimatedCost),
    item.reason,
    item.note,
  ]);
  return renderWorkbook([
    { name: words.summarySheet, rows: [words.summaryColumns, ...summary] },
    { name: words.rowsSheet, rows: [words.rowColumns, ...rows] },
    { name: words.freeSheet, rows: [words.freeColumns, ...given] },
  ]);
}
