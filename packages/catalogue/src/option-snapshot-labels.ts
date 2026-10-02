import { kitchenPresentationName, nonBlankTranslations } from "./product-presentation.js";
import { resolveSnapshotText } from "@waitron/shared";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * One `<list>: <label>` line per options answer a dish froze: {@link optionSnapshotLabels} is what a
 * COOK reads, {@link customerOptionSnapshotLabels} what a DINER reads, and
 * {@link staffOptionSnapshotLabels} what a SERVER reads on the till.
 *
 * A staff map holds exactly one entry, written from a plain name by whichever builder froze the
 * answer, so the kitchen and staff readers take the map's VALUE and never its key.
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
 * The DINER's wording. Each side takes its customer text in `locale`, then in the venue's default
 * content language, then in any other stored language, and falls back to the STAFF name only when
 * it has no customer text at all, never to the kitchen name, which is a cook's shorthand and
 * identifies the goods to nobody else.
 *
 * The default is read from the staff map's one key: both builders key it by the default content
 * language at the time the answer was frozen (`apps/server/src/modifier-selection.ts`,
 * `apps/till/src/state/held-options.ts`).
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
    return resolveSnapshotText(names, locale, Object.keys(staffNames)[0] ?? locale);
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
