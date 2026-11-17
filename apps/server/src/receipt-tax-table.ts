import type { TableLine } from "./receipt-table.js";

export interface TaxTableRow {
  rate: string;
  base: string;
  tax: string;
  total: string;
}

const CELLS = ["rate", "base", "tax", "total"] as const;

/** The rate column on the left, each amount right-aligned under its heading, spread across `columns`. */
export function taxTableLines(
  header: TaxTableRow,
  rows: readonly TaxTableRow[],
  columns: number,
): TableLine[] {
  const all = [header, ...rows];
  const [rateWidth, ...amountWidths] = CELLS.map((cell) =>
    Math.max(...all.map((row) => row[cell].length)),
  );
  const spare = columns - rateWidth! - amountWidths.reduce((sum, width) => sum + width, 0);
  const gap = Math.max(1, Math.floor(spare / amountWidths.length));
  const firstGap = Math.max(gap, spare - gap * (amountWidths.length - 1));
  const line = (row: TaxTableRow): string =>
    row.rate.padEnd(rateWidth! + firstGap) +
    [row.base, row.tax, row.total]
      .map((amount, at) => amount.padStart(amountWidths[at]!))
      .join(" ".repeat(gap));
  return [
    { text: line(header), header: true },
    ...rows.map((row) => ({ text: line(row), header: false })),
  ];
}
