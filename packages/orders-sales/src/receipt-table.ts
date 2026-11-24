import { wrapText } from "@waitron/printing";

import type { ReceiptTable, ReceiptTableRow } from "@waitron/shared";
export type { ReceiptTable, ReceiptTableRow } from "@waitron/shared";

export interface TableLine {
  text: string;
  header: boolean;
}

const MIN_ITEM_WIDTH = 10;

/** Each printed line, with `header: true` on the header row's lines so the caller can bold them. */
export function tableLines(table: ReceiptTable, columns: number): TableLine[] {
  const all = table.header ? [table.header, ...table.rows] : [...table.rows];
  const widest = (cell: (row: ReceiptTableRow) => string): number =>
    Math.max(0, ...all.map((row) => cell(row).length));
  const unitsRoom = Math.max(0, columns - 1 - MIN_ITEM_WIDTH);
  const unitsFit = (row: ReceiptTableRow): boolean => row.units.length <= unitsRoom;
  const unitsWidth = widest((row) => (unitsFit(row) ? row.units : ""));
  const priceWidth = widest((row) => row.price);
  const amountWidth = widest((row) => row.amount);
  const rateWidth = widest((row) => row.rate ?? "");

  type FigureCell = { width: number; cell: (row: ReceiptTableRow) => string };
  const figureCells: FigureCell[] = [
    { width: priceWidth, cell: (row) => row.price },
    { width: amountWidth, cell: (row) => row.amount },
    ...(table.withRate
      ? [{ width: rateWidth, cell: (row: ReceiptTableRow) => row.rate ?? "" }]
      : []),
  ];
  const figures = (row: ReceiptTableRow, cells = figureCells): string =>
    cells.map(({ width, cell }) => cell(row).padStart(width)).join(" ");
  const cellsWidth = (cells: readonly FigureCell[]): number =>
    cells.reduce((total, { width }) => total + width, cells.length - 1);
  const figuresWidth = cellsWidth(figureCells);
  const figureGroups: FigureCell[][] = [];
  for (const cell of figureCells) {
    const group = figureGroups.at(-1);
    if (group !== undefined && cellsWidth([...group, cell]) <= columns) group.push(cell);
    else figureGroups.push([cell]);
  }
  const figureLines = (row: ReceiptTableRow): string[] =>
    figureGroups.flatMap((group) => {
      const text = figures(row, group);
      if (text.trim() === "") return [];
      const lines = text.length <= columns ? [text] : wrapText(text.trim(), columns);
      return lines.map((line) => line.padStart(columns));
    });
  const oneLineItemWidth = columns - unitsWidth - 1 - 1 - figuresWidth;
  const twoLines = oneLineItemWidth < MIN_ITEM_WIDTH;
  const itemWidth = twoLines ? columns - unitsWidth - 1 : oneLineItemWidth;
  const itemColumn = " ".repeat(unitsWidth + 1);

  const rowLines = (row: ReceiptTableRow): string[] => {
    if (!unitsFit(row))
      return [...wrapText(row.units, columns), ...rowLines({ ...row, units: "" })];
    const indent = row.itemIndent ?? 0;
    const item = " ".repeat(indent) + row.item;
    const [first = "", ...rest] = wrapText(item, itemWidth, indent);
    const lead = row.units.padStart(unitsWidth) + " ";
    const itemAndPriceWidth = itemWidth + 1 + priceWidth;
    if (
      !twoLines &&
      table.withRate &&
      indent > 0 &&
      row.price === "" &&
      row.amount !== "" &&
      rest.length > 0 &&
      item.length <= itemAndPriceWidth
    ) {
      const caption = wrapText(item, itemAndPriceWidth, indent)[0]!;
      return [
        (
          lead +
          caption.padEnd(itemAndPriceWidth) +
          " " +
          figures(row, figureCells.slice(1))
        ).trimEnd(),
      ];
    }
    const continuation = rest.map((line) => itemColumn + line);
    if (!twoLines) {
      return [(lead + first.padEnd(itemWidth) + " " + figures(row)).trimEnd(), ...continuation];
    }
    return [lead + first, ...continuation, ...figureLines(row)];
  };

  return [
    ...(table.header ? rowLines(table.header).map((text) => ({ text, header: true })) : []),
    ...table.rows.flatMap((row) => rowLines(row).map((text) => ({ text, header: false }))),
  ];
}
