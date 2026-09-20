import type { OptionSnapshot } from "@waitron/shared";

/**
 * One `<list>: <label>` line per options answer a dish froze, for a surface a COOK reads — the
 * kitchen ticket and the station queue. Each side prints its kitchen name and falls back to the
 * STAFF name, never to the customer text, which is `kitchenPresentationName`'s rule for a dish
 * (`packages/catalogue/src/product-presentation.ts`) applied to an answer.
 *
 * The staff names arrive as locale → text maps because the snapshot widened them on the way in
 * (`OptionSnapshot`, `packages/shared/src/option-selection.ts`); the widening puts the one plain
 * name under the venue's default content language, so any value in the map is that name.
 *
 * Extras are not here: each pick is its own priced child line, which the caller prints itself.
 */
export function optionSnapshotLabels(snapshots: readonly OptionSnapshot[]): string[] {
  const staff = (names: Record<string, string>) => Object.values(names)[0] ?? "";
  return snapshots.map(
    (snapshot) =>
      `${snapshot.listKitchenName?.trim() || staff(snapshot.listName)}: ` +
      `${snapshot.labelKitchenName?.trim() || staff(snapshot.labelName)}`,
  );
}
