import {
  MONEY_SCALE,
  type Decimal,
  compareDecimal,
  decimal,
  divideDecimal,
  grossOf,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import { trimQuantity } from "../widgets/dish-format.js";
import { portionLineFacts } from "./portion-groups.js";
import type { TabLine } from "../api/client.js";
import type { AdjustTarget } from "../widgets/adjustment-dialog.js";
import type { StoredLines } from "../widgets/basket.js";
import type { WorkingOrderStore } from "./working-order.js";

export function storedListing(
  store: WorkingOrderStore,
  listing: StoredLines | null,
): StoredLines | null {
  return listing !== null && store.persisted && listing.orderId === store.id ? listing : null;
}

/** The listing, while the basket is exactly what it lists (unchanged since, and not being sent or
 * loaded again) and no pay, place or hold of it is out (`inFlight`). */
export function adjustableListing(
  store: WorkingOrderStore,
  listing: StoredLines | null,
  inFlight: boolean,
): StoredLines | null {
  const own = storedListing(store, listing);
  return own !== null &&
    !inFlight &&
    !store.dirty &&
    !store.sending &&
    !store.editsLocked &&
    own.revision === store.revision
    ? own
    : null;
}

/** The kitchen is making the line, or has made it. */
export function isStarted(line: TabLine): boolean {
  return line.state === "preparing" || line.state === "ready";
}

/** Such a line can be cancelled, or split, one unit at a time; a weighed line cannot. */
export function moreThanOneWholeUnit(line: TabLine): boolean {
  return line.unitPrecision === 0 && compareDecimal(decimal(line.quantity), decimal("1")) > 0;
}

export function tabLineGross(line: TabLine): Decimal {
  return grossOf(line.unitPriceGross, line.quantity);
}

/** The bill's total at its prices now. */
export function billGross(
  lines: readonly TabLine[],
  gross: (line: TabLine) => Decimal = tabLineGross,
): Decimal {
  return toScale(sumDecimals(lines.map(gross)), MONEY_SCALE);
}

/** The line's total before a give-away or a discount changed its price; its total now when none
 * has. */
export function listedGross(line: TabLine): Decimal {
  const listed = line.listUnitPriceGross;
  return listed === undefined ? tabLineGross(line) : grossOf(listed, line.quantity);
}

/** A dish with its extras (`lines` holds the order's rows, the dish's children among them), or an
 * extra on its own. Part of a dish can be adjusted when it is several whole units, taking each
 * unit's share of its extras; an extra is adjusted whole only, as the server allows. An extra of a
 * fired dish or with its own fired record is marked `kitchenTold`; one of a held dish whose HOLD
 * ticket was queued is not, as the till cannot see that the ticket was queued. */
export function lineAdjustTarget(
  line: TabLine,
  lines: readonly TabLine[],
  name: string,
  gross: (row: TabLine) => Decimal = tabLineGross,
): AdjustTarget {
  const extras = lines.filter((row) => row.parentLineNo === line.lineNo);
  const total = toScale(sumDecimals([line, ...extras].map(gross)), MONEY_SCALE);
  const isExtra = (line.parentLineNo ?? null) !== null;
  const dish = isExtra ? lines.find((row) => row.lineNo === line.parentLineNo) : undefined;
  return {
    lineId: line.id,
    name,
    quantity: trimQuantity(line.quantity),
    total,
    unitTotal:
      !isExtra && moreThanOneWholeUnit(line)
        ? divideDecimal(total, decimal(line.quantity), MONEY_SCALE)
        : null,
    started: isStarted(line) || extras.some(isStarted),
    ...((line.unitPrecision ?? 0) > 0 ? { weighed: true } : {}),
    ...(isExtra ? { extra: true } : {}),
    ...(isExtra && (line.firedAt !== null || dish?.firedAt != null) ? { kitchenTold: true } : {}),
  };
}

/**
 * What the till shows as one row of identical portions (`members`, from `state/portion-groups.ts`),
 * as one target: named by its first portion with every member in `lineIds`, counted in portions so
 * the dialog offers part of it, and totalled with every member's extras. `extras` holds one target
 * per extra product, naming that extra on each member (plan D31, D34).
 */
export function rowAdjustTarget(
  members: readonly TabLine[],
  lines: readonly TabLine[],
  name: string,
  extraName: (extra: TabLine) => string = (extra) => extra.name ?? "",
): AdjustTarget {
  const dishes = [...members].sort((a, b) => a.lineNo - b.lineNo);
  const each = dishes.map((dish) => lineAdjustTarget(dish, lines, name));
  const total = toScale(sumDecimals(each.map((one) => decimal(one.total))), MONEY_SCALE);
  const count = String(dishes.length);
  const extrasOf = dishes.map((dish) =>
    lines
      .filter((row) => row.parentLineNo === dish.lineNo)
      .sort((a, b) => extraOrder(a).localeCompare(extraOrder(b))),
  );
  const extras = extrasOf[0]!.map((first, i) => {
    const standing = extrasOf.map((list) => list[i]!);
    const one = standing.map((extra) => lineAdjustTarget(extra, lines, extraName(first)));
    return {
      ...one[0]!,
      lineIds: standing.map((extra) => extra.id),
      quantity: trimQuantity(sumDecimals(standing.map((extra) => decimal(extra.quantity)))),
      total: toScale(sumDecimals(one.map((target) => decimal(target.total))), MONEY_SCALE),
      started: one.some((target) => target.started === true),
    };
  });
  return {
    ...each[0]!,
    lineIds: dishes.map((dish) => dish.id),
    quantity: count,
    total,
    unitTotal: divideDecimal(total, decimal(count), MONEY_SCALE),
    started: each.some((one) => one.started === true),
    extras,
  };
}

/** The order identical portions' extras are paired in: every fact their grouping compares, so the
 * n-th extra of each portion is the same extra. */
function extraOrder(extra: TabLine): string {
  return JSON.stringify(portionLineFacts(extra));
}
