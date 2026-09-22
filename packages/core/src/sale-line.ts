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
  /** The line's tax-EXCLUSIVE base amount. `buildVatBreakdown` below groups lines by `vatRate`
   * and derives each group's tax from this figure via `@waitron/shared`'s `percentOf` — plain
   * multiplication, because this is already the base rather than a customer-facing gross price
   * that would need reversing out of. */
  lineTotal: string;
  /** Snapshotted analytics label, copied onto `sale_lines.category` at insert; never a catalogue
   * reference. Optional: when absent the line inserts `null`, exactly as before this field existed. */
  category?: string | null;
  /** The `lineNo` of this line's parent dish; `null` for a top-level line. Resolved to the parent's
   * generated id at the `sale_lines` insert (Task 5); presentation metadata only, NEVER hashed. */
  parentLineNo?: number | null;
  /** The diner's answers to this dish's options lists, each frozen as the list's three names and
   * the chosen label's three names. Copied onto `sale_lines.option_snapshots`; presentation only,
   * never part of the fiscal hash. */
  optionSnapshots?: OptionSnapshot[];
  /** Selected product variant and its presentation facts, frozen with the line. */
  variantId?: string | null;
  /** The variant's staff-facing name (the mirror of `name`); `null` when the line names no variant. */
  variantName?: string | null;
  /** The variant's customer-facing text, locale -> text (the mirror of `descriptions`), snapshotted
   * with the line; `null` when it names no variant. */
  variantDescriptions?: Record<string, string> | null;
  /** The variant's kitchen-facing name; `null` when the line names no variant. */
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}
