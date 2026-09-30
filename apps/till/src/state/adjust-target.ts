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
import type { TabLine } from "../api/client.js";
import type { AdjustKind, AdjustTarget } from "../widgets/adjustment-dialog.js";
import type { StringKey } from "../i18n/strings.js";
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

export const LINE_ADJUSTMENTS = [
  { kind: "comp", label: "table.comp_line" },
  { kind: "discount", label: "table.discount_line" },
] as const satisfies readonly { kind: AdjustKind; label: StringKey }[];

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
 * unit's share of its extras; an extra is adjusted whole only, as the server allows. */
export function lineAdjustTarget(
  line: TabLine,
  lines: readonly TabLine[],
  name: string,
  gross: (row: TabLine) => Decimal = tabLineGross,
): AdjustTarget {
  const extras = lines.filter((row) => row.parentLineNo === line.lineNo);
  const total = toScale(sumDecimals([line, ...extras].map(gross)), MONEY_SCALE);
  const isExtra = (line.parentLineNo ?? null) !== null;
  return {
    lineId: line.id,
    name,
    quantity: trimQuantity(line.quantity),
    total,
    unitTotal:
      !isExtra && moreThanOneWholeUnit(line)
        ? divideDecimal(total, decimal(line.quantity), MONEY_SCALE)
        : null,
    started: isStarted(line),
    ...((line.unitPrecision ?? 0) > 0 ? { weighed: true } : {}),
    ...(isExtra ? { extra: true } : {}),
  };
}
