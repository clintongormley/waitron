import { formatInvoiceNumber } from "@waitron/core";
import type { VatCorrections, VatMovementKind } from "@waitron/reporting";
import { CORRECTIONS_REPORT_WORDS } from "./i18n/corrections-report.js";
import { numeric, renderWorkbook, type Cell } from "./xlsx-workbook.js";

type CorrectionKind = Exclude<VatMovementKind, "invoice">;

/** `madeIn` names the asked period as the rows' `belongsTo` names theirs: `"2026-3T"`, `"2026-08"`. */
export function renderCorrectionsWorkbook(
  corrections: VatCorrections,
  madeIn: string,
  language: "en" | "es",
): Promise<Uint8Array<ArrayBuffer>> {
  const words = CORRECTIONS_REPORT_WORDS[language];
  const summary: Cell[][] =
    corrections.summary.length === 0
      ? [[words.nothing]]
      : corrections.summary.map((line) => [
          madeIn,
          line.belongsTo,
          numeric(line.rate),
          words.directions[line.direction],
          numeric(line.base),
          numeric(line.tax),
        ]);
  const rows: Cell[][] = corrections.rows.map((row) => [
    row.madeDay,
    words.kinds[row.kind as CorrectionKind],
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
  return renderWorkbook([
    { name: words.summarySheet, rows: [words.summaryColumns, ...summary] },
    { name: words.rowsSheet, rows: [words.rowColumns, ...rows] },
  ]);
}
