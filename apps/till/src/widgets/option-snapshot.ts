// Deep-import the browser-safe catalogue LEAF, exactly as `state/as-served.ts` and
// `state/working-order.ts` do: a barrel `import { … } from "@waitron/catalogue"` pulls the package's
// runtime dependencies (drizzle, the DB layer) into the browser bundle, while
// `option-snapshot-labels.ts` in isolation imports only `product-presentation.ts` and
// `@waitron/shared`, both of which the till already bundles.
import {
  customerOptionSnapshotLabels,
  optionSnapshotLabels,
  staffOptionSnapshotLabels,
} from "@waitron/catalogue/src/option-snapshot-labels.js";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * Which reader a surface is written for. A list and its chosen label each carry three names, and the
 * three surfaces do NOT agree about which to show (spec §10): the kitchen rail and the pass read the
 * cook's shorthand, a settled receipt reads the diner's text in the invoice locale, and the basket
 * and the table screen read the plain staff name the venue typed in. Naming the reader at the call
 * site is what keeps a surface from quietly reading the wrong one.
 */
export type OptionReader =
  { reads: "kitchen" } | { reads: "staff" } | { reads: "customer"; locale: string };

/**
 * One `<list>: <label>` line per frozen options answer, in the wording `reader` asks for. The rules
 * for each wording — which name each side falls back to, and how a locale is resolved against a map
 * nothing re-keys — belong to `packages/catalogue/src/option-snapshot-labels.ts`, which the printed
 * kitchen ticket and the printed receipt call too, so a screen and its paper twin cannot disagree.
 *
 * Every wire type carrying answers declares them optional (`api/client.ts`), so an absent field is
 * the common no-answers case and yields no lines.
 *
 * Extras are not here: each pick is its own priced child line, which each surface renders itself.
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
