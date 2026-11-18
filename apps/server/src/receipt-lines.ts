import { joinCustomerPresentationText } from "@waitron/menu";
import type { GrossLine } from "@waitron/menu";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  grossOf,
  multiplyDecimal,
  MONEY_SCALE,
  type Decimal,
} from "@waitron/shared";
import type { TillSaleLine } from "./till-sale.js";
import type { OrderLineIdentity } from "./working-order.js";

/** Display only: "2.000" reads "2" and "0.320" reads "0.32"; the filed figures are untouched. */
export function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/** What a receipt line prints; a filed line and a stored gross line both carry it. */
export type ReceiptSource = Pick<
  GrossLine,
  | "lineNo"
  | "descriptions"
  | "variantDescriptions"
  | "variantName"
  | "optionSnapshots"
  | "quantity"
  | "priceQuantity"
  | "unitName"
  | "unitPrecision"
  | "lineGross"
  | "parentLineNo"
> &
  // A stored order line holds the price it was sold at; a line rebuilt from a sale's rows does not.
  Partial<Pick<GrossLine, "grossUnitPrice">>;

/**
 * Project the FILED lines onto the receipt, so it prints the invoiced composition, never the
 * mutable client basket. `identities[i]` is the working-order line `priced.lines[i]` was priced
 * from, as a `GrossOrder` pairs them; a line whose total at its list price differs from its filed
 * total carries it as `listGross`.
 */
export function ticketLinesFrom(
  priced: { lines: readonly ReceiptSource[] },
  identities: readonly Pick<OrderLineIdentity, "listUnitGross">[],
): TillSaleLine[] {
  return priced.lines.map((line, i) => ({
    descriptions: joinCustomerPresentationText(
      line.descriptions,
      line.variantDescriptions ?? null,
      line.variantName ?? null,
    ),
    // Frozen at filing: the receipt never re-reads the menu for these names.
    optionSnapshots: line.optionSnapshots,
    quantity:
      line.parentLineNo != null && line.unitName != null && (line.unitPrecision ?? 0) > 0
        ? line.quantity
        : trimQuantityForDisplay(line.quantity),
    unitName: line.unitName ?? null,
    unitPrecision: line.unitPrecision ?? null,
    gross: line.lineGross,
    ...soldAt(line, identities[i]!.listUnitGross),
    parentLineNo: line.parentLineNo ?? null,
  }));
}

/** The list total, and the gross unit prices the line was sold and listed at, where recorded. */
function soldAt(
  line: ReceiptSource,
  listUnit: Decimal | null,
): Pick<TillSaleLine, "listGross" | "listUnitPriceGross" | "unitPriceGross" | "priceQuantity"> {
  const list = listGrossOf(line, listUnit);
  const prices = {
    ...(line.grossUnitPrice === undefined ? {} : { unitPriceGross: line.grossUnitPrice }),
    ...(list.listGross === undefined ? {} : { listUnitPriceGross: listUnit! }),
  };
  return {
    ...list,
    ...prices,
    ...(Object.keys(prices).length === 0 ||
    line.priceQuantity === undefined ||
    compareDecimal(decimal(line.priceQuantity), decimal("1")) === 0
      ? {}
      : { priceQuantity: line.priceQuantity }),
  };
}

export function withReceiptListPrices<T extends ReceiptSource>(
  lines: readonly T[],
  identities: readonly Pick<OrderLineIdentity, "listUnitGross">[],
): (T & { listGross?: string; listUnitPriceGross?: string })[] {
  return lines.map((line, i) => {
    const listUnit = identities[i]!.listUnitGross;
    const list = listGrossOf(line, listUnit);
    return list.listGross === undefined
      ? { ...line }
      : { ...line, ...list, listUnitPriceGross: listUnit! };
  });
}

/** The line's total at its list price, rounded as a line total is (`grossRows`), when it differs. */
function listGrossOf(
  line: Pick<GrossLine, "quantity" | "priceQuantity" | "lineGross">,
  listUnit: Decimal | null,
): { listGross?: string } {
  if (listUnit === null) return {};
  const listGross =
    line.priceQuantity === undefined
      ? grossOf(listUnit, line.quantity)
      : divideDecimal(
          multiplyDecimal(listUnit, decimal(line.quantity)),
          decimal(line.priceQuantity),
          MONEY_SCALE,
        );
  return compareDecimal(listGross, line.lineGross) === 0 ? {} : { listGross };
}

export interface LineGroup {
  dish: TillSaleLine;
  options: TillSaleLine[];
}

/** Parent numbers name positions in the unchanged filed list; an extra may follow other dishes.
 * Orphans stay visible. */
export function groupByParent(lines: readonly TillSaleLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  const byPosition = new Map<number, LineGroup>();
  for (const [index, line] of lines.entries()) {
    const parent = line.parentLineNo == null ? undefined : byPosition.get(line.parentLineNo);
    if (parent === undefined) {
      const group = { dish: line, options: [] as TillSaleLine[] };
      groups.push(group);
      byPosition.set(index + 1, group);
    } else {
      parent.options.push(line);
    }
  }
  return groups;
}

/**
 * A set lunch stays with its diner. Ordinary identical dishes may share a simplified receipt row.
 * A group joins an earlier one
 * when its dish and each extra print the same at the same unit price and VAT rate, counted not
 * measured, with no list price and no comp or discount; counts and amounts add.
 */
export function mergeIdenticalGroups(groups: readonly LineGroup[], oneRate: boolean): LineGroup[] {
  const merged: LineGroup[] = [];
  for (const group of groups) {
    const at = merged.findIndex((earlier) => samePrinting(earlier, group, oneRate));
    if (at === -1) {
      merged.push(group);
      continue;
    }
    const earlier = merged[at]!;
    merged[at] = {
      dish: summed(earlier.dish, group.dish),
      options: earlier.options.map((option, i) => summed(option, group.options[i]!)),
    };
  }
  return merged;
}

function summed(left: TillSaleLine, right: TillSaleLine): TillSaleLine {
  const merged = {
    ...left,
    quantity: String(Number(left.quantity) + Number(right.quantity)),
    gross: addDecimal(decimal(left.gross), decimal(right.gross)),
  };
  if (!samePrice(left, right)) {
    delete merged.unitPriceGross;
    delete merged.priceQuantity;
  }
  return merged;
}

function samePrice(a: TillSaleLine, b: TillSaleLine): boolean {
  if (a.unitPriceGross === undefined || b.unitPriceGross === undefined) return false;
  return (
    compareDecimal(decimal(a.unitPriceGross), decimal(b.unitPriceGross)) === 0 &&
    compareDecimal(decimal(a.priceQuantity ?? "1"), decimal(b.priceQuantity ?? "1")) === 0
  );
}

function samePrinting(a: LineGroup, b: LineGroup, oneRate: boolean): boolean {
  const lines = (group: LineGroup) => [group.dish, ...group.options];
  if (a.dish.setLunch || b.dish.setLunch) return false;
  if (a.options.length !== b.options.length) return false;
  if (![...lines(a), ...lines(b)].every(groupable)) return false;
  if (answersKey(a.dish) !== answersKey(b.dish)) return false;
  const [aDishes, bDishes] = [decimal(a.dish.quantity), decimal(b.dish.quantity)];
  return lines(a).every((left, i) => {
    const right = lines(b)[i]!;
    const [aCount, bCount] = [decimal(left.quantity), decimal(right.quantity)];
    return (
      sameNames(left.descriptions, right.descriptions) &&
      sameRate(left, right, oneRate) &&
      // The same count per dish, and the same price each: compared crosswise, so nothing divides.
      compareDecimal(multiplyDecimal(aCount, bDishes), multiplyDecimal(bCount, aDishes)) === 0 &&
      compareDecimal(
        multiplyDecimal(decimal(left.gross), bCount),
        multiplyDecimal(decimal(right.gross), aCount),
      ) === 0
    );
  });
}

function answersKey(dish: TillSaleLine): string {
  return optionAnswersKey(dish.optionSnapshots);
}

/** A dish's answers by value: neither their order nor any key order tells two dishes apart. */
export function optionAnswersKey(answers: readonly unknown[] | null | undefined): string {
  const sorted = (value: unknown): unknown =>
    value === null || typeof value !== "object"
      ? value
      : Object.fromEntries(
          Object.entries(value)
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([key, inner]) => [key, sorted(inner)]),
        );
  return JSON.stringify((answers ?? []).map((answer) => JSON.stringify(sorted(answer))).sort());
}

function groupable(line: TillSaleLine): boolean {
  return (
    line.unitName == null &&
    /^[1-9]\d*$/.test(line.quantity) &&
    line.listGross === undefined &&
    (line.adjustments ?? []).length === 0
  );
}

function sameNames(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameRate(a: TillSaleLine, b: TillSaleLine, oneRate: boolean): boolean {
  if (a.net === undefined && b.net === undefined) return oneRate;
  return (
    a.net !== undefined &&
    b.net !== undefined &&
    compareDecimal(decimal(a.net.rate), decimal(b.net.rate)) === 0
  );
}
