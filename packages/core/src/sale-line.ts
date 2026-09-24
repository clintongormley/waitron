import type { OptionSnapshot } from "@waitron/shared";

/** One line of a sale as the caller hands it in. Declared here, apart from `record-sale.ts`, so a
 * browser consumer can name the type without its program gaining that file's database imports. */
export interface RecordSaleLine {
  lineNo: number;
  /** The staff-facing product name, frozen onto the line at add time. Never a catalogue reference. */
  name: string;
  /** locale -> text, snapshotted at line-add time. Never a catalogue reference. */
  descriptions: Record<string, string>;
  /** Unit label and accepted precision frozen when the item was selected. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  quantity: string;
  unitPrice: string;
  /** A percentage literal, e.g. "21.00" meaning 21%. `sale_lines.vat_rate` stores the same rate
   * as a count of basis points; `saleLineRows` is where the two forms meet. */
  vatRate: string;
  /** The line's tax-exclusive base, so `buildVatBreakdown` derives the tax by plain
   * multiplication rather than reversing it out of a gross price. */
  lineTotal: string;
  /** Snapshotted analytics label, copied onto `sale_lines.category`; never a catalogue reference. */
  category?: string | null;
  /** The `lineNo` of this line's parent dish; `null` for a top-level line. Presentation only,
   * never hashed. */
  parentLineNo?: number | null;
  /** The diner's answers to this dish's options lists, each frozen as the list's three names and
   * the chosen label's three names. Copied onto `sale_lines.option_snapshots`; presentation only,
   * never part of the fiscal hash. */
  optionSnapshots?: OptionSnapshot[];
  /** The variant's staff-facing name (the mirror of `name`); `null` when the line names no variant. */
  variantName?: string | null;
  /** The variant's customer-facing text, locale -> text (the mirror of `descriptions`), snapshotted
   * with the line; `null` when it names no variant. */
  variantDescriptions?: Record<string, string> | null;
  /** The variant's kitchen-facing name; `null` when the line names no variant. */
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}
