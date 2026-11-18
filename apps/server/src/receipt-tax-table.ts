import type { TableLine } from "./receipt-table.js";

import type { TaxTableRow } from "@waitron/shared";
export type { TaxTableRow } from "@waitron/shared";

const amountsOf = (row: TaxTableRow): string[] => [row.base, row.tax, row.total];

/**
 * The rate column on the left, each amount right-aligned under its heading, spread across
 * `columns`. Where a row does not fit, every rate goes on its own line above its amounts; where
 * the amounts alone do not fit, the rate and each amount go on a line of their own beside their
 * heading, or under it when the two do not fit side by side. No figure is cut.
 */
export function taxTableLines(
  header: TaxTableRow,
  rows: readonly TaxTableRow[],
  columns: number,
): TableLine[] {
  const all = [header, ...rows];
  const rateWidth = Math.max(...all.map((row) => row.rate.length));
  const widths = amountsOf(header).map((_, at) =>
    Math.max(...all.map((row) => amountsOf(row)[at]!.length)),
  );
  // A one-space gap would merge with a space inside a figure, such as Galician "1 234,56".
  const minGap = all.some((row) => amountsOf(row).some((amount) => amount.includes(" "))) ? 2 : 1;
  const amountsWidth = widths.reduce((sum, width) => sum + width, 0);
  const spread = (room: number): ((row: TaxTableRow) => string) => {
    const spare = room - amountsWidth;
    const gap = Math.max(minGap, Math.floor(spare / widths.length));
    const lead = spare - gap * (widths.length - 1);
    return (row) =>
      " ".repeat(lead) +
      amountsOf(row)
        .map((amount, at) => amount.padStart(widths[at]!))
        .join(" ".repeat(gap));
  };

  if (rateWidth + amountsWidth + minGap * widths.length <= columns) {
    const amounts = spread(columns - rateWidth);
    return all.map((row, at) => ({
      text: row.rate.padEnd(rateWidth) + amounts(row),
      header: at === 0,
    }));
  }
  if (amountsWidth + minGap * (widths.length - 1) <= columns) {
    const amounts = spread(columns);
    return all.flatMap((row, at) => [
      { text: row.rate, header: at === 0 },
      { text: amounts(row), header: at === 0 },
    ]);
  }
  const beside = (heading: string, value: string): TableLine[] =>
    heading.length + 1 + value.length <= columns
      ? [{ text: heading.padEnd(columns - value.length) + value, header: false }]
      : [
          { text: heading, header: false },
          { text: value.padStart(columns), header: false },
        ];
  return rows.flatMap((row) => [
    ...beside(header.rate, row.rate),
    ...amountsOf(row).flatMap((amount, at) => beside(amountsOf(header)[at]!, amount)),
  ]);
}
