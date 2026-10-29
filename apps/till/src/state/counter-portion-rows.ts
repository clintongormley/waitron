import type { SaleLine } from "../api/client.js";
import type { StoredLines } from "../widgets/basket.js";
import { portionGroups, tabLinePortionKey } from "./portion-groups.js";
import type { OrderLine } from "./working-order.js";

/**
 * A retrieved counter order's identical portions as one basket row each (A1208, plan D7): lines
 * whose listed dishes share a {@link tabLinePortionKey} become the first member's line at the
 * group's count, naming every member. The lines as given when the listing is unknown or the order
 * holds money, so a paid portion is never folded into a row it could be lowered out of.
 */
export function foldRetrievedPortions(
  lines: readonly OrderLine[],
  listed: StoredLines | null,
  holdsMoney: boolean,
): OrderLine[] {
  if (listed === null || holdsMoney) return [...lines];
  const dishOf = (line: OrderLine) =>
    line.workingOrderLineId === undefined
      ? undefined
      : listed.lines.find(
          (dish) => dish.id === line.workingOrderLineId && (dish.parentLineNo ?? null) === null,
        );
  const groups = portionGroups(
    lines,
    (line) => {
      const dish = dishOf(line);
      // An unsent dish's station choice lives only on the basket line: the listing reads its
      // station from the kitchen record, which an unsent dish does not have yet.
      return dish === undefined ? null : tabLinePortionKey(dish, listed.lines, line.makeAt ?? null);
    },
    (line) => dishOf(line)?.lineNo ?? 0,
  );
  return groups.map(([first, ...rest]) =>
    rest.length === 0
      ? first!
      : {
          ...first!,
          quantity: String(rest.length + 1),
          portionLineIds: [first!, ...rest].map((member) => member.workingOrderLineId!),
        },
  );
}

/**
 * The wire lines a basket row is saved as (plan D8): one per member at "1", in line order. Raised
 * past its members, the last member carries the added dishes; lowered, the last members are left
 * out, which removes them.
 */
export function portionWireLines(line: OrderLine, wire: SaleLine): SaleLine[] {
  const members = line.portionLineIds;
  if (members === undefined) return [wire];
  const quantity = Number(wire.quantity);
  return members.slice(0, Math.min(members.length, quantity)).map((id, index) => ({
    ...wire,
    workingOrderLineId: id,
    quantity:
      quantity > members.length && index === members.length - 1
        ? String(quantity - members.length + 1)
        : "1",
  }));
}
