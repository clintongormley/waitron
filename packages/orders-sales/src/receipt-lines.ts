import type { GrossLine } from "@waitron/menu";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  grossOf,
  isZeroDecimal,
  joinCustomerPresentationText,
  multiplyDecimal,
  MONEY_SCALE,
  type Decimal,
  type OptionSnapshot,
} from "@waitron/shared";

/**
 * One line of the FILED composition, for the receipt's goods-identification list (RD 1619/2012
 * art. 7.1.e). It comes from the lines the server filed, never a client basket, so the printed line
 * list cannot diverge from the invoice.
 */
export interface TillSaleLine {
  /** F1 figures read from the filed sale line; unitPrice is per priceQuantity, base is the line total. */
  net?: { unitPrice: string; priceQuantity: string; base: string; rate: string; tax?: string };
  /** locale → text: the line's goods descriptions, snapshotted at add-time and filed verbatim. */
  descriptions: Record<string, string>;
  /** Unit label frozen with the filed line, including a weighted extra child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** Presentation marker derived from the working line's stored unit identity. */
  soldInEach?: true;
  /** The filed quantity; weighted extra children retain the saved fractional scale for display. */
  quantity: string;
  /** The filed line's VAT rate, as a percentage. */
  vatRate?: string;
  /** The GROSS (VAT-inclusive) line total the line was filed at, as a decimal string. */
  gross: string;
  /**
   * The line's total at its price before a comp or a discount lowered it, present only when that
   * differs from `gross`. F1 replay reads it from the saved sale line.
   */
  listGross?: string;
  /**
   * The unit price with VAT per price quantity before any comp or discount; present only with
   * listGross. A full invoice reads it from the filed sale line, a simplified one from the order line.
   */
  listUnitPriceGross?: string;
  /**
   * Simplified receipts only: the unit price with VAT per price quantity the line was sold at, from
   * the stored order line; absent when no stored order line of the same number still has the line's
   * quantity, price quantity and total, and on a printed row merging lines sold at different prices.
   */
  unitPriceGross?: string;
  /**
   * Simplified receipts only: what `unitPriceGross` and `listUnitPriceGross` are priced per; absent
   * means one. A full invoice's line keeps its price quantity in `net.priceQuantity`.
   */
  priceQuantity?: string;
  /**
   * Presentation only. On a full invoice's line whose order line an adjustment on this bill split
   * into several dish rows: the index in lines of the family's first row. The family shares its
   * own discount.
   */
  dishFamily?: number;
  /** The comps and discounts printed beneath this row's dish; absent when there are none. */
  adjustments?: ReceiptAdjustment[];
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line, else `null`/absent.
   *  Presentation only: it groups already-filed lines and is no fiscal figure. */
  parentLineNo?: number | null;
  /** The diner's answers to this dish's OPTIONS lists, copied by value so a later menu edit
   *  cannot rewrite what a completed sale says was ordered. An extras pick is a child line instead. */
  optionSnapshots?: OptionSnapshot[];
  /** On a line taking an advance off this invoice: the advance as its own ticket names it, read
   *  through the line's `deducts_sale_id`. `issuedOn` is its issue day in the venue's zone. */
  advance?: { invoiceNumber: string; issuedOn: string };
  /** The filed line's set-menu role; absent on a line with none. */
  setMenuRole?: "set_menu" | "dish";
  /** Presentation only. On a correction's set-menu dish filed with a list price, which a
   * whole-invoice credit copies from the line it corrects, though the receipt shows none: the set
   * menu did not cover it. */
  correctsPricedDish?: true;
}

/** An amount taken off, printed as its own line: presentation only, nothing is filed from it. */
export interface ReceiptAdjustment {
  /** `comp`: a full comp, printed as the discount word with 100%. */
  kind: "comp" | "discount";
  percentBp?: number;
  /** The positive amount taken off, as a decimal string. */
  amount: string;
}

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
  | "setMenuRole"
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
  identities: readonly { listUnitGross: Decimal | null }[],
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
    ...(line.setMenuRole == null ? {} : { setMenuRole: line.setMenuRole }),
  }));
}

/** The list total, and the gross unit prices the line was sold and listed at, where recorded. */
function soldAt(
  line: ReceiptSource,
  listUnit: Decimal | null,
): Pick<TillSaleLine, "listGross" | "listUnitPriceGross" | "unitPriceGross" | "priceQuantity"> {
  const list = listGrossOf(line, listUnit);
  // A filed row whose total is its total at list price was sold at that price each, even when the
  // bill's line it came from was given free and its share of the price paid is the whole of it.
  const sold =
    line.grossUnitPrice ??
    (list.listGross === undefined && listUnit !== null ? listUnit : undefined);
  const prices = {
    ...(sold === undefined ? {} : { unitPriceGross: sold }),
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
  identities: readonly { listUnitGross: Decimal | null }[],
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
export function listGrossOf(
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

/** A set menu's dish at no extra cost: a dish comped to 0.00 keeps a list price, so is not one. */
export function isCoveredDish(line: TillSaleLine): boolean {
  return line.setMenuRole === "dish" && !isPriced(line);
}

/** A dish placed in a set menu that costs more than the set menu covers; the simplified ticket prints its amount with a plus. */
export function isSurcharge(line: TillSaleLine, amount: Decimal): boolean {
  return line.setMenuRole === "dish" && compareDecimal(amount, decimal("0")) > 0;
}

function isPriced(line: TillSaleLine): boolean {
  return (
    !isZeroDecimal(decimal(line.gross)) ||
    line.listGross !== undefined ||
    line.correctsPricedDish === true ||
    (line.adjustments ?? []).length > 0
  );
}

/** A ticket or full invoice leaves out a covered dish whose extras all came free, with its answers. */
export function printsOnTicket({ dish, options }: LineGroup): boolean {
  return !isCoveredDish(dish) || options.some(isPriced);
}

/**
 * A group joins an earlier one
 * when its dish and each extra print the same at the same unit price and VAT rate, counted not
 * measured, with no list price and no comp or discount; counts and amounts add. A line taking an
 * advance off never joins (two advances of one amount store the same words).
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
  if (a.options.length !== b.options.length) return false;
  if (a.dish.setMenuRole !== b.dish.setMenuRole) return false;
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
    line.advance === undefined &&
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
