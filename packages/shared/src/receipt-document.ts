export interface ReceiptTableRow {
  units: string;
  item: string;
  price: string;
  amount: string;
  rate?: string;
  /** Spaces before the item text. */
  itemIndent?: number;
}

export interface ReceiptTable {
  /** Absent on a table continuing after a line printed outside it. */
  header?: ReceiptTableRow;
  rows: readonly ReceiptTableRow[];
  withRate: boolean;
}

export interface TaxTableRow {
  rate: string;
  base: string;
  tax: string;
  total: string;
}

// The roll renderer resolves an indent after this prefix against the columns the line is drawn in.
export type ReceiptIndent = number | { after: string };
export type ReceiptStyle = { bold?: true; double?: true };
export type ReceiptElement =
  | { kind: "text"; text: string; indent: ReceiptIndent; style?: ReceiptStyle }
  | {
      kind: "amount";
      caption: string;
      amount: string;
      indent: ReceiptIndent;
      style?: ReceiptStyle;
      /** The fewest spaces between caption and amount on one line; fewer, and the amount drops. */
      gap?: number;
    }
  | { kind: "rule" }
  | { kind: "align"; alignment: "left" | "center" }
  | { kind: "logo" }
  | { kind: "qr"; text: string }
  | { kind: "table"; table: ReceiptTable }
  | { kind: "taxTable"; header: TaxTableRow; rows: TaxTableRow[] };
