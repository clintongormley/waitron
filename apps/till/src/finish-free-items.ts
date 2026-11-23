import type { UnservedDish } from "./api/finish-table-types.js";
import type { CancellationRead } from "./api/line-cancel-types.js";

/**
 * Each free item among a Finish table's dishes, with the paid dishes it comes back with (plan
 * 2026-11-19 §4.3.1): exactly its read's `comesBackWith` when every one of them is in the list, else
 * none, since Finish cannot bring it back without them.
 */
export function finishFreeItems(
  dishes: readonly UnservedDish[],
  consents: ReadonlyMap<string, CancellationRead>,
): Record<string, string[]> {
  const listed = new Set(dishes.map((dish) => dish.lineId));
  const free: Record<string, string[]> = {};
  for (const dish of dishes) {
    const consent = consents.get(dish.lineId);
    if (consent?.givenFree !== true) continue;
    const back = consent.comesBackWith ?? [];
    free[dish.lineId] = back.every((lineId) => listed.has(lineId)) ? [...back] : [];
  }
  return free;
}
