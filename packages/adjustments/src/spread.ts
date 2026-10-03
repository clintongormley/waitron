import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  MONEY_SCALE,
  percentOf,
  QUANTITY_SCALE,
  thousandthsToDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
import { isPercentBp } from "./policy.js";
import "./errors.js";

/**
 * The arithmetic of taking money off lines whose amount is a whole-cent unit price times the
 * quantity, rounded half away from zero to the cent, as `grossRows` in
 * `packages/catalogue/src/pricing.ts` prices a line.
 */

/** One row of a line after an adjustment: `quantity` units at `unitGross` each. */
export interface PricedRow {
  quantity: Decimal;
  unitGross: Decimal;
}

/**
 * A line a bill discount is spread over.
 *
 * - `addedOrder` decides a tie between equal remainders, lower first: the line's `line_no`.
 * - `gross` must be `grossUnit × quantity ÷ priceQuantity` rounded to the cent.
 * - `exact` is true for a row the caller may split into at most two rows at whole-cent prices: a
 *   whole-number quantity on a dish with no extras. It is false for a weighed row, and for every row
 *   of a dish that has extras; such a row keeps one row and takes the nearest whole-cent unit price
 *   ({@link nearestWeighedUnitPrice}), so what it takes can differ from its share.
 */
export interface SpreadLine {
  lineId: string;
  addedOrder: number;
  gross: Decimal;
  quantity: string;
  /** Physical amount bought by one grossUnit; absent for ordinary per-unit lines. */
  priceQuantity?: string;
  grossUnit: Decimal;
  exact: boolean;
}

/**
 * What one line takes: `reduction` is the amount actually achieved, and `rows` the line's rows
 * afterwards, the higher price first. `newGrossUnit` is the first row's price.
 */
export interface SpreadResult {
  newGrossUnit: Decimal;
  reduction: Decimal;
  rows: PricedRow[];
}

const THOUSAND = 1000n;

function cents(value: Decimal, what: string): bigint {
  if (compareDecimal(toScale(value, MONEY_SCALE), value) !== 0) {
    throw new RangeError(`${what} is not a whole number of cents`);
  }
  return BigInt(decimalToCents(value));
}

function unitCents(value: Decimal): bigint {
  const count = cents(value, "grossUnit");
  if (count < 0n) throw new RangeError("grossUnit is negative");
  return count;
}

function thousandths(quantity: string): bigint {
  const value = decimal(quantity);
  if (compareDecimal(toScale(value, QUANTITY_SCALE), value) !== 0) {
    throw new RangeError("quantity is finer than a thousandth");
  }
  const count = BigInt(decimalToThousandths(value));
  if (count <= 0n) throw new RangeError("quantity is not positive");
  return count;
}

function money(count: bigint): Decimal {
  return centsToDecimal(Number(count));
}

function amount(count: bigint): Decimal {
  return thousandthsToDecimal(Number(count));
}

/** The line total in cents for `price` cents per `priceQuantity` thousandths, half up. */
function totalAt(price: bigint, quantity: bigint, priceQuantity = THOUSAND): bigint {
  const product = price * quantity;
  const whole = product / priceQuantity;
  return (product % priceQuantity) * 2n >= priceQuantity ? whole + 1n : whole;
}

/** The highest price in `[from, ceiling]` whose total is at most `total`; `from`'s must be. */
function highestAtMost(
  total: bigint,
  from: bigint,
  ceiling: bigint,
  quantity: bigint,
  priceQuantity = THOUSAND,
): bigint {
  let low = from;
  let high = ceiling;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (totalAt(middle, quantity, priceQuantity) <= total) low = middle;
    else high = middle - 1n;
  }
  return low;
}

/** `nearestWeighedUnitPrice` in counts; `target` lies within `[0, totalAt(ceiling)]`. */
function nearestPrice(
  ceiling: bigint,
  quantity: bigint,
  target: bigint,
  priceQuantity = THOUSAND,
): bigint {
  // The lowest price reaching the target; the total only rises with the price.
  let low = 0n;
  let high = ceiling;
  while (low < high) {
    const middle = (low + high) / 2n;
    if (totalAt(middle, quantity, priceQuantity) >= target) high = middle;
    else low = middle + 1n;
  }
  const reached = totalAt(low, quantity, priceQuantity);
  if (reached > target && low > 0n) {
    const below = low - 1n;
    if (target - totalAt(below, quantity, priceQuantity) < reached - target) return below;
  }
  return highestAtMost(reached, low, ceiling, quantity, priceQuantity);
}

/**
 * The whole-cent unit price whose rounded line total comes nearest `targetGross`, never above
 * `grossUnit`. A tie between a total below the target and one above takes the higher total (the
 * smaller discount); among the prices giving the chosen total, the highest is used (the smallest cut
 * to the per-unit price).
 */
export function nearestWeighedUnitPrice(
  grossUnit: Decimal,
  quantity: string,
  targetGross: Decimal,
): Decimal {
  const ceiling = unitCents(grossUnit);
  const count = thousandths(quantity);
  const target = cents(targetGross, "targetGross");
  if (target < 0n || target > totalAt(ceiling, count)) {
    throw new RangeError("targetGross lies outside the line");
  }
  return money(nearestPrice(ceiling, count, target));
}

function splitRows(units: bigint, target: bigint): PricedRow[] {
  const base = target / units;
  const extra = target % units;
  const rows: PricedRow[] = [];
  if (extra > 0n) rows.push({ quantity: amount(extra * THOUSAND), unitGross: money(base + 1n) });
  rows.push({ quantity: amount((units - extra) * THOUSAND), unitGross: money(base) });
  return rows;
}

function wholeUnits(quantity: string): bigint {
  const count = thousandths(quantity);
  if (count % THOUSAND !== 0n) throw new RangeError("quantity is not a whole number of units");
  return count / THOUSAND;
}

/**
 * A discrete line's rows once its total becomes `targetGross`: one row when the total divides into
 * whole cents a unit, else two, the extra cents going one each to the units of the first row.
 */
export function splitDiscreteLine(
  grossUnit: Decimal,
  quantity: string,
  targetGross: Decimal,
): PricedRow[] {
  const price = unitCents(grossUnit);
  const units = wholeUnits(quantity);
  const target = cents(targetGross, "targetGross");
  if (target < 0n || target > price * units) {
    throw new RangeError("targetGross lies outside the line");
  }
  return splitRows(units, target);
}

/** `percentBp` of `gross`, rounded to whole cents half up: the reduction a percentage asks for. */
export function percentReduction(gross: Decimal, percentBp: number): Decimal {
  if (!isPercentBp(percentBp)) {
    throw new RangeError("percentBp is not in 1..10000");
  }
  return percentOf(gross, basisPointsToDecimal(percentBp));
}

function descending(a: bigint, b: bigint): number {
  return a === b ? 0 : a > b ? -1 : 1;
}

interface Item {
  line: SpreadLine;
  gross: bigint;
  price: bigint;
  quantity: bigint;
  priceQuantity: bigint;
  share: bigint;
}

/** Checks the request and works out each line's share, before any line takes it. */
function sharesOf(lines: readonly SpreadLine[], discount: Decimal): Item[] {
  const wanted = cents(discount, "discount");
  if (wanted < 0n) throw new RangeError("discount is negative");
  const ids = new Set<string>();
  const orders = new Set<number>();
  const items: Item[] = lines.map((line) => {
    if (ids.has(line.lineId) || orders.has(line.addedOrder)) {
      throw new RangeError(`line ${line.lineId} repeats an id or an addedOrder`);
    }
    ids.add(line.lineId);
    orders.add(line.addedOrder);
    const price = unitCents(line.grossUnit);
    const quantity = line.exact ? wholeUnits(line.quantity) * THOUSAND : thousandths(line.quantity);
    const priceQuantity =
      line.priceQuantity === undefined ? THOUSAND : thousandths(line.priceQuantity);
    if (line.exact && priceQuantity !== THOUSAND) {
      throw new RangeError(`line ${line.lineId}'s exact quantity needs a unit price basis`);
    }
    const gross = cents(line.gross, "gross");
    if (gross !== totalAt(price, quantity, priceQuantity)) {
      throw new RangeError(`line ${line.lineId}'s gross is not its unit price times its quantity`);
    }
    return { line, gross, price, quantity, priceQuantity, share: 0n };
  });
  const bill = items.reduce((sum, item) => sum + item.gross, 0n);
  if (wanted > bill) {
    throw new AppError("adjustment.exceeds_amount", {
      requested: money(wanted),
      available: money(bill),
    });
  }
  if (wanted === 0n) return items;
  const remainders = new Map<Item, bigint>();
  let placed = 0n;
  for (const item of items) {
    item.share = (wanted * item.gross) / bill;
    remainders.set(item, (wanted * item.gross) % bill);
    placed += item.share;
  }
  const byRemainder = [...items].sort(
    (a, b) =>
      descending(remainders.get(a)!, remainders.get(b)!) || a.line.addedOrder - b.line.addedOrder,
  );
  for (const item of byRemainder.slice(0, Number(wanted - placed))) item.share += 1n;
  return items;
}

/**
 * Each line's share of `discount`: `discount × line gross ÷ bill gross` in whole cents rounded
 * down, then the cents left over one at a time to the largest remainders, a tie to the line added
 * earlier. `adjustment.exceeds_amount` when the discount is larger than the bill.
 */
export function discountShares(
  lines: readonly SpreadLine[],
  discount: Decimal,
): Map<string, Decimal> {
  return new Map(sharesOf(lines, discount).map((item) => [item.line.lineId, money(item.share)]));
}

/**
 * Moves one cent per line per pass, in `order`, until `cents` are placed or no line can move. A line
 * able to move at the start of a pass can still move once in it, because one cent never takes it
 * past the bound `canMove` tests.
 */
function handOut(
  order: readonly Item[],
  cents: bigint,
  canMove: (item: Item) => boolean,
  move: (item: Item) => void,
): void {
  let left = cents;
  while (left > 0n) {
    const movable = order.filter(canMove);
    if (movable.length === 0) return;
    for (const item of movable.slice(0, Number(left))) move(item);
    left -= BigInt(Math.min(movable.length, Number(left)));
  }
}

/**
 * Spreads a discount over a bill's lines. Each line's share comes from {@link discountShares}. An
 * exact line takes its share exactly; any other line takes the nearest total a whole-cent unit
 * price gives, and the difference moves to the exact lines one cent at a time, largest gross first:
 * a line that took less leaves cents to ADD to exact lines, each only while it stays at or above
 * zero, and a line that took more leaves cents to TAKE BACK from exact lines, only from those still
 * taking something, so no price ever rises. What cannot be placed is left unplaced, so the sum of
 * the reductions is what the bill actually loses, and it can differ from `discount`.
 *
 * Called with one line, it is a line discount by the same rules.
 */
export function spreadBillDiscount(
  lines: readonly SpreadLine[],
  discount: Decimal,
): Map<string, SpreadResult> {
  const items = sharesOf(lines, discount);
  const taken = new Map<Item, bigint>();
  const nearest = new Map<Item, bigint>();
  let overshoot = 0n;
  for (const item of items) {
    if (item.line.exact) {
      taken.set(item, item.share);
      continue;
    }
    const price = nearestPrice(
      item.price,
      item.quantity,
      item.gross - item.share,
      item.priceQuantity,
    );
    const took = item.gross - totalAt(price, item.quantity, item.priceQuantity);
    nearest.set(item, price);
    taken.set(item, took);
    overshoot += took - item.share;
  }
  const exact = items
    .filter((item) => item.line.exact)
    .sort((a, b) => descending(a.gross, b.gross) || a.line.addedOrder - b.line.addedOrder);
  if (overshoot < 0n) {
    handOut(
      exact,
      -overshoot,
      (item) => taken.get(item)! < item.gross,
      (item) => taken.set(item, taken.get(item)! + 1n),
    );
  } else {
    handOut(
      exact,
      overshoot,
      (item) => taken.get(item)! > 0n,
      (item) => taken.set(item, taken.get(item)! - 1n),
    );
  }
  return new Map(
    items.map((item) => {
      const took = taken.get(item)!;
      const rows = item.line.exact
        ? splitRows(item.quantity / THOUSAND, item.gross - took)
        : [{ quantity: amount(item.quantity), unitGross: money(nearest.get(item)!) }];
      return [item.line.lineId, { newGrossUnit: rows[0]!.unitGross, reduction: money(took), rows }];
    }),
  );
}
