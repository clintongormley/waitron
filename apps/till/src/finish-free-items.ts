import { compareDecimal, decimal } from "@waitron/shared";
import type { UnservedDish } from "./api/finish-table-types.js";
import type { CancellationRead } from "./api/line-cancel-types.js";

/**
 * Each free item among a Finish table's dishes, with the paid dishes of its sale it comes back with
 * (plan 2026-11-19 §4.3.1). It comes back only when nothing paid on its bill is left after Finish:
 * no paid dish keeps a served portion, and every paid one is in the list. A sale with one paid dish
 * listed has its consent say so through `withFree`; with several, each consent asks only about its
 * own dish, so a paid dish served whole, and so missing from the list, is not seen, and the server
 * refuses that request (`tab.free_item_with_dish`, reason `free_item`).
 */
export function finishFreeItems(
  dishes: readonly UnservedDish[],
  consents: ReadonlyMap<string, CancellationRead>,
): Record<string, string[]> {
  const free: Record<string, string[]> = {};
  for (const dish of dishes) {
    const consent = consents.get(dish.lineId);
    if (consent?.givenFree !== true) continue;
    const paid = dishes.filter((other) => {
      const read = consents.get(other.lineId);
      return (
        read !== undefined &&
        read.givenFree !== true &&
        read.saleId === consent.saleId &&
        read.refundValue !== undefined &&
        compareDecimal(decimal(read.refundValue.gross), decimal("0")) > 0
      );
    });
    const served = paid.some((other) =>
      other.context.components.some(
        (row) =>
          row.lineId === other.lineId &&
          compareDecimal(decimal(row.servedQuantity), decimal("0")) > 0,
      ),
    );
    const named =
      paid.length !== 1 ||
      consents.get(paid[0]!.lineId)!.withFree?.some((item) => item.lineId === dish.lineId) === true;
    free[dish.lineId] = paid.length > 0 && !served && named ? paid.map((row) => row.lineId) : [];
  }
  return free;
}
