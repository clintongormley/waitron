import { kitchenPresentationName, nonBlankTranslations } from "./product-presentation.js";
import { resolveSnapshotText } from "@waitron/shared";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * One `<list>: <label>` line per options answer a dish froze: {@link optionSnapshotLabels} is what a
 * COOK reads, {@link customerOptionSnapshotLabels} what a DINER reads, and
 * {@link staffOptionSnapshotLabels} what a SERVER reads on the till.
 *
 * A staff map holds exactly one entry, written from a plain name by whichever builder froze the
 * answer, so every reader here takes the map's VALUE and never its key.
 */

/**
 * The KITCHEN's wording. Each side prints its kitchen name and falls back to the STAFF name, never
 * to the customer text.
 */
export function optionSnapshotLabels(snapshots: readonly OptionSnapshot[]): string[] {
  const side = (kitchenName: string | null, staffNames: Record<string, string>) =>
    kitchenPresentationName({
      name: Object.values(staffNames)[0] ?? "",
      kitchenName,
      variantName: null,
      variantKitchenName: null,
    });
  return snapshots.map(
    (snapshot) =>
      `${side(snapshot.listKitchenName, snapshot.listName)}: ` +
      `${side(snapshot.labelKitchenName, snapshot.labelName)}`,
  );
}

/**
 * The DINER's wording. Each side takes its customer text and falls back to the STAFF name, never to
 * the kitchen name, which is a cook's shorthand and identifies the goods to nobody else.
 *
 * `resolveSnapshotText` rather than an exact-key lookup, because `locale` is normally a full tag
 * ("es-ES") while both maps are keyed by bare language codes, and because a map blank in the
 * requested language must still print a name on a legal receipt.
 */
export function customerOptionSnapshotLabels(
  snapshots: readonly OptionSnapshot[],
  locale: string,
): string[] {
  const side = (
    customerNames: Record<string, string> | null,
    staffNames: Record<string, string>,
  ) => {
    const names = nonBlankTranslations(customerNames) ?? staffNames;
    return resolveSnapshotText(names, locale, locale);
  };
  return snapshots.map(
    (snapshot) =>
      `${side(snapshot.listCustomerName, snapshot.listName)}: ` +
      `${side(snapshot.labelCustomerName, snapshot.labelName)}`,
  );
}

/** The STAFF wording — each side's plain staff name. */
export function staffOptionSnapshotLabels(snapshots: readonly OptionSnapshot[]): string[] {
  const side = (staffNames: Record<string, string>) => Object.values(staffNames)[0] ?? "";
  return snapshots.map((snapshot) => `${side(snapshot.listName)}: ${side(snapshot.labelName)}`);
}
