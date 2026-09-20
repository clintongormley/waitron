/** One diner answer on the wire: which options list was asked, and which of its labels was chosen. */
export type OptionSelection = { listId: string; labelId: string };

/**
 * The answer as it is frozen onto an order line — the list's three names and the chosen label's
 * three names, copied by value. Nothing here points back at the list or label by id, so editing or
 * deleting a list cannot rewrite a saved order.
 *
 * The staff names widen on the way in: `OptionList.name` and `OptionLabel.name` are a plain
 * `string`, while `listName` and `labelName` here are locale → text maps. The map is the shape the
 * design's sample line shows (`"listName": { "en": "Cooked" }`,
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.3), and the field shape the
 * snapshot this replaces already used (`ModifierSnapshot.name` and `choiceName`,
 * `packages/shared/src/modifier-snapshots.ts`) — though there it was a straight copy, the old
 * model's single name being a map column itself (`option_groups.name`,
 * `packages/db/src/schema/catalogue.ts:129`). The widening is performed on the order path, by
 * `buildLineExtras` (`apps/server/src/modifier-selection.ts`), under the venue's default content
 * language — so each of these maps holds exactly one entry.
 */
export type OptionSnapshot = {
  listName: Record<string, string>;
  listCustomerName: Record<string, string> | null;
  listKitchenName: string | null;
  labelName: Record<string, string>;
  labelCustomerName: Record<string, string> | null;
  labelKitchenName: string | null;
};
