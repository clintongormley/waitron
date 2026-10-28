import type { TabLine } from "../api/client.js";
import { trimQuantity } from "../widgets/dish-format.js";
import type { SentSlice } from "./sent-panel.js";

/**
 * Rows of identical portions shown as one (spec §3.1): rows with the same key form one group at the
 * place of the first one met, its members ordered by line number. A row whose key is null stands
 * alone.
 */
export function portionGroups<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  lineNoOf: (row: T) => number,
): T[][] {
  const byKey = new Map<string, T[]>();
  const groups: T[][] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const found = key === null ? undefined : byKey.get(key);
    if (found !== undefined) {
      found.push(row);
      continue;
    }
    const group = [row];
    if (key !== null) byKey.set(key, group);
    groups.push(group);
  }
  for (const group of groups) group.sort((a, b) => lineNoOf(a) - lineNoOf(b));
  return groups;
}

const one = (value: string | undefined) => value === undefined || trimQuantity(value) === "1";

/** A sent line carries no measure flag, so a whole portion is read as a line of one in a unit with
 * no decimals, priced per one unit. */
function wholePortion(line: TabLine): boolean {
  return (
    (line.parentLineNo ?? null) === null &&
    line.unitPrecision === 0 &&
    trimQuantity(line.quantity) === "1" &&
    one(line.priceQuantity)
  );
}

function lineFacts(line: TabLine) {
  return [
    line.productId,
    line.parentProductId,
    line.menuItemId,
    line.name ?? null,
    line.listId,
    trimQuantity(line.quantity),
    trimQuantity(line.priceQuantity ?? "1"),
    line.unitPriceGross,
    line.listUnitPriceGross ?? null,
    trimQuantity(line.cancelledQuantity ?? "0"),
    (line.optionSnapshots ?? []).map((answer) => JSON.stringify(answer)).sort(),
    line.note,
  ];
}

/**
 * What makes two bill lines the same portion: the dish's product, offer, names, answers, note,
 * course, release group, station and kitchen state, served or not, cancellation, prices and
 * extras (compared as a set, each with its count), plus `shown` — whatever else the caller prints
 * for the line, such as its allergy mark or paid mark. Null for a line that is not a whole portion.
 */
export function tabLinePortionKey(
  dish: TabLine,
  lines: readonly TabLine[],
  shown: unknown = null,
): string | null {
  if (!wholePortion(dish)) return null;
  const extras = lines
    .filter((line) => line.parentLineNo === dish.lineNo)
    .map((extra) => JSON.stringify(lineFacts(extra)))
    .sort();
  return JSON.stringify([
    lineFacts(dish),
    dish.courseId,
    dish.groupId,
    dish.stationId,
    dish.state,
    dish.firedAt,
    dish.servedAt !== null,
    dish.movable,
    extras,
    shown,
  ]);
}

/**
 * {@link tabLinePortionKey} for a slice of the Sent panel, whose rows lack the product, answers
 * and prices: those come from the bill line of the same id and number. Null when the slice is not
 * the whole of a one-portion line, or when that bill line is not known.
 */
export function sentSlicePortionKey(
  slice: SentSlice,
  lines: readonly TabLine[],
  shown: unknown = null,
): string | null {
  const { row } = slice;
  const dish = lines.find((line) => line.id === row.lineId && line.lineNo === row.lineNo);
  if (dish === undefined || slice.quantity !== "1" || trimQuantity(row.quantity) !== "1")
    return null;
  const bill = tabLinePortionKey(dish, lines, shown);
  return bill === null
    ? null
    : JSON.stringify([
        bill,
        slice.kind,
        row.workingOrderId,
        row.netAmount,
        row.released,
        row.readyAt,
        row.firedAt,
        row.kitchen,
      ]);
}
