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
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.3). TWO places widen, each under one content language, so
 * each of these maps holds exactly one entry whichever built it — found by grepping every non-test
 * `listName:` under `apps/` and `packages/`:
 *
 *  - `buildLineExtras` (`apps/server/src/modifier-selection.ts`) on the ORDER PATH, under the
 *    venue's default content language. Its output is what is stored and filed.
 *  - `#selectedSnapshots` (`apps/till/src/widgets/modifier-picker.ts`) at the till, under the
 *    content language the browser resolved, so the basket draws a line the operator has just
 *    answered through the reader a retrieved line uses. That copy is display-only: `SaleLine`
 *    (`apps/till/src/api/client.ts`) declares `options` ids and no snapshot, `toWireModifiers`
 *    (`apps/till/src/state/order-line.ts`) is what builds the two keys a line sends, and grepping
 *    `optionSnapshots` across `apps/till/src` finds every other mention to be a render-time read.
 */
export type OptionSnapshot = {
  listName: Record<string, string>;
  listCustomerName: Record<string, string> | null;
  listKitchenName: string | null;
  labelName: Record<string, string>;
  labelCustomerName: Record<string, string> | null;
  labelKitchenName: string | null;
};
