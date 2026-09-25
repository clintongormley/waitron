// Deep-import the catalogue leaf: the `@waitron/catalogue` barrel would pull drizzle and the DB layer
// into the browser bundle.
import {
  customerOptionSnapshotLabels,
  optionSnapshotLabels,
  staffOptionSnapshotLabels,
} from "@waitron/catalogue/src/option-snapshot-labels.js";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * Which of the three names a surface reads: the kitchen rail and the pass read the kitchen name, a
 * settled receipt the customer-facing text in the invoice locale, the basket and table screen the
 * staff name.
 */
export type OptionReader =
  { reads: "kitchen" } | { reads: "staff" } | { reads: "customer"; locale: string };

/**
 * One `<list>: <label>` line per frozen options answer. The wording rules live in
 * `packages/catalogue/src/option-snapshot-labels.ts`, which the printed kitchen ticket and receipt
 * call too, so a screen and its paper twin cannot disagree.
 *
 * Extras are not here: each pick is its own priced child line.
 */
export function optionAnswers(
  snapshots: readonly OptionSnapshot[] | undefined,
  reader: OptionReader,
): string[] {
  if (snapshots === undefined) return [];
  switch (reader.reads) {
    case "kitchen":
      return optionSnapshotLabels(snapshots);
    case "customer":
      return customerOptionSnapshotLabels(snapshots, reader.locale);
    case "staff":
      return staffOptionSnapshotLabels(snapshots);
  }
}
