import { wrapText } from "@waitron/printing";

export interface ReceiptTableRow {
  units: string;
  item: string;
  price: string;
  amount: string;
  rate?: string;
  /** Spaces before the item text: 2 for an extra, an option answer or a discount under its dish. */
  itemIndent?: number;
}

export interface ReceiptTable {
  /** Absent on a table continuing after a line printed outside it (Task 2.3b). */
  header?: ReceiptTableRow;
  rows: readonly ReceiptTableRow[];
  withRate: boolean;
}

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
  const unitsWidth = widest((row) => row.units);
  const priceWidth = widest((row) => row.price);
  const amountWidth = widest((row) => row.amount);
  const rateWidth = widest((row) => row.rate ?? "");

  const figures = (row: ReceiptTableRow): string => {
    const cells = [row.price.padStart(priceWidth), row.amount.padStart(amountWidth)];
    if (table.withRate) cells.push((row.rate ?? "").padStart(rateWidth));
    return cells.join(" ");
  };
  const figuresWidth = priceWidth + 1 + amountWidth + (table.withRate ? 1 + rateWidth : 0);
  const oneLineItemWidth = columns - unitsWidth - 1 - 1 - figuresWidth;
  const twoLines = oneLineItemWidth < MIN_ITEM_WIDTH;
  const itemWidth = twoLines ? columns - unitsWidth - 1 : oneLineItemWidth;
  const itemColumn = " ".repeat(unitsWidth + 1);

  const rowLines = (row: ReceiptTableRow): string[] => {
    const indent = row.itemIndent ?? 0;
    const [first = "", ...rest] = wrapText(" ".repeat(indent) + row.item, itemWidth, indent);
    const lead = row.units.padStart(unitsWidth) + " ";
    const continuation = rest.map((line) => itemColumn + line);
    if (!twoLines) {
      return [(lead + first.padEnd(itemWidth) + " " + figures(row)).trimEnd(), ...continuation];
    }
    const figureLine = figures(row);
    return [
      lead + first,
      ...continuation,
      ...(figureLine.trim() === "" ? [] : [figureLine.padStart(columns)]),
    ];
  };

  return [
    ...(table.header ? rowLines(table.header).map((text) => ({ text, header: true })) : []),
    ...table.rows.flatMap((row) => rowLines(row).map((text) => ({ text, header: false }))),
  ];
}
