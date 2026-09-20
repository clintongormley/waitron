import { kitchenPresentationName } from "@waitron/catalogue";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * One `<list>: <label>` line per options answer a dish froze, for a surface a COOK reads — the
 * printed kitchen ticket, its correction slip and its reprint, all built by `buildTicketItems`
 * (`apps/server/src/kitchen-print.ts`), the one caller. Each side prints its kitchen name and
 * falls back to the STAFF name, never to the customer text, which is why each side goes through
 * `kitchenPresentationName` (`packages/catalogue/src/product-presentation.ts`) rather than
 * restating that rule: a list and a label carry no variant, so the two variant fields are null and
 * the helper collapses to exactly `<kitchen name> or else <staff name>`.
 *
 * The staff names arrive as locale → text maps because the snapshot widened them on the way in
 * (`OptionSnapshot`, `packages/shared/src/option-selection.ts`); the widening puts the one plain
 * name under the venue's default content language, so the map holds exactly one entry and any
 * value in it is that name. That is why there is no locale parameter here and no call to
 * `resolveSnapshotText` (`packages/shared/src/content-languages.ts`): it needs a requested
 * language and a default language to choose BETWEEN entries, and there is nothing to choose.
 *
 * Extras are not here: each pick is its own priced child line, which the caller prints itself.
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
