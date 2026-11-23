import {
  AppError,
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  shareByWeight,
  subtractDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
import type { VatBreakdownLine } from "@waitron/fiscal";
import "./errors.js";

const ZERO = decimal("0.00");
const MAX_MONEY = decimal("999999999999.99");

export interface CorrectionAmountLine {
  id: string;
  lineNo: number;
  rate: Decimal;
  gross: Decimal;
  base: Decimal;
  /** What the line cost at menu price: the weight an amount given back is shared by. */
  menu: Decimal;
}

export interface CorrectionAmountAllocation {
  saleLineId: string;
  rate: Decimal;
  gross: Decimal;
  base: Decimal;
  tax: Decimal;
}

export interface CorrectionAmountHistory {
  lines: CorrectionAmountLine[];
  vatBreakdown: VatBreakdownLine[];
  consumed: CorrectionAmountAllocation[];
}

export interface CorrectionAmountPreview {
  gross: Decimal;
  allocations: CorrectionAmountAllocation[];
  vatBreakdown: VatBreakdownLine[];
}

export function allocateCorrectionAmounts(
  history: CorrectionAmountHistory,
  selection: { gross: Decimal; lineIds?: readonly string[] },
): CorrectionAmountPreview {
  const remaining = remainingLines(history);
  const amount = selection.gross;
  if (!isMoney(amount) || compareDecimal(amount, ZERO) <= 0) {
    throw new AppError("sale.correction_amount_invalid", {});
  }
  const scope = selection.lineIds;
  const refuseScope = (reason: "empty" | "missing" | "duplicate") => {
    throw new AppError("sale.correction_scope_invalid", { reason });
  };
  if (scope !== undefined) {
    if (scope.length === 0) refuseScope("empty");
    if (new Set(scope).size !== scope.length) refuseScope("duplicate");
    if (scope.some((id) => !remaining.some((line) => line.id === id))) refuseScope("missing");
  }
  const lines = remaining.filter((line) => scope === undefined || scope.includes(line.id));
  if (compareDecimal(amount, sumDecimals(lines.map((line) => line.gross))) > 0) {
    throw new AppError("sale.correction_amount_invalid", {});
  }
  const grossByLine = shareByMenuPrice(amount, lines);
  const allocations: CorrectionAmountAllocation[] = lines
    .map((line, index) => ({
      saleLineId: line.id,
      rate: toScale(line.rate, 2),
      gross: grossByLine[index]!,
      base: ZERO,
      tax: ZERO,
    }))
    .filter((allocation) => compareDecimal(allocation.gross, ZERO) > 0);
  const vatBreakdown: VatBreakdownLine[] = [];
  for (const rate of [...new Set(allocations.map((allocation) => allocation.rate))].sort(
    compareDecimal,
  )) {
    const atRate = allocations.filter((allocation) => allocation.rate === rate);
    const gross = sumDecimals(atRate.map((allocation) => allocation.gross));
    const original = history.vatBreakdown.find((group) => compareDecimal(group.rate, rate) === 0)!;
    const prior = history.consumed.filter(
      (allocation) => compareDecimal(allocation.rate, rate) === 0,
    );
    const base = correctionBaseAtRate(
      rate,
      original,
      {
        gross: sumDecimals(prior.map((allocation) => allocation.gross)),
        base: sumDecimals(prior.map((allocation) => allocation.base)),
      },
      gross,
    );
    const tax = subtractDecimal(gross, base);
    if (!isMoney(base) || !isMoney(tax)) unusable();
    const bases = shareByWeight(
      base,
      atRate.map((allocation) => allocation.gross),
    );
    for (const [index, allocation] of atRate.entries()) {
      allocation.base = bases[index]!;
      allocation.tax = subtractDecimal(allocation.gross, allocation.base);
    }
    vatBreakdown.push({ rate, base: toScale(base, 2), tax: toScale(tax, 2) });
  }
  return { gross: toScale(amount, 2), allocations, vatBreakdown };
}

/**
 * `amount` shared by menu price over the lines with something left, no line taking more than is
 * left of it: a line whose share is over takes what is left, and the rest is shared again over the
 * others, until none is over. `amount` must not exceed what is left of `lines` together.
 */
function shareByMenuPrice(amount: Decimal, lines: readonly CorrectionAmountLine[]): Decimal[] {
  const shares = lines.map(() => ZERO);
  let open = lines.flatMap((line, index) => (compareDecimal(line.gross, ZERO) > 0 ? [index] : []));
  let left = amount;
  while (compareDecimal(left, ZERO) > 0) {
    const pass = shareByWeight(
      left,
      open.map((index) => lines[index]!.menu),
    );
    const over = open.filter(
      (index, position) => compareDecimal(pass[position]!, lines[index]!.gross) > 0,
    );
    if (over.length === 0) {
      for (const [position, index] of open.entries()) shares[index] = pass[position]!;
      break;
    }
    for (const index of over) {
      shares[index] = lines[index]!.gross;
      left = subtractDecimal(left, lines[index]!.gross);
    }
    open = open.filter((index) => !over.includes(index));
  }
  return shares;
}

/**
 * The base, at one rate, of a correction taking `gross` after earlier corrections took `prior`:
 * all amounts positive. Shared by the calculator and the correction writer's check.
 */
export function correctionBaseAtRate(
  rate: Decimal,
  original: { base: Decimal; tax: Decimal },
  prior: { gross: Decimal; base: Decimal },
  gross: Decimal,
): Decimal {
  const cumulativeGross = addDecimal(prior.gross, gross);
  let cumulativeBase = divideDecimal(
    cumulativeGross,
    addDecimal(decimal("1"), divideDecimal(rate, decimal("100"), 4)),
    2,
  );
  // Stored line rounding sets the rate's total budgets, including before its final return.
  const minimumBase = subtractDecimal(cumulativeGross, original.tax);
  if (compareDecimal(cumulativeBase, original.base) > 0) cumulativeBase = original.base;
  if (compareDecimal(cumulativeBase, minimumBase) < 0) cumulativeBase = minimumBase;
  return subtractDecimal(cumulativeBase, prior.base);
}

function unusable(): never {
  throw new AppError("sale.correction_history_unusable", {});
}

function isMoney(value: Decimal): boolean {
  return (
    compareDecimal(value, ZERO) >= 0 &&
    compareDecimal(value, MAX_MONEY) <= 0 &&
    compareDecimal(value, toScale(value, 2)) === 0
  );
}

function validRate(value: Decimal): boolean {
  return (
    compareDecimal(value, ZERO) >= 0 &&
    compareDecimal(value, decimal("100")) <= 0 &&
    compareDecimal(value, toScale(value, 2)) === 0
  );
}

/** The invoice's lines, each with `gross` cut to what earlier corrections left of it. */
export function remainingLines(history: CorrectionAmountHistory): CorrectionAmountLine[] {
  const ids = new Set<string>();
  const rates = new Set<string>();
  const remaining = history.lines
    .map((line) => {
      if (
        !line.id ||
        ids.has(line.id) ||
        !Number.isSafeInteger(line.lineNo) ||
        line.lineNo < 1 ||
        !validRate(line.rate) ||
        !isMoney(line.gross) ||
        !isMoney(line.base) ||
        !isMoney(line.menu) ||
        compareDecimal(line.base, line.gross) > 0
      )
        unusable();
      ids.add(line.id);
      return {
        ...line,
        rate: toScale(line.rate, 2),
        gross: toScale(line.gross, 2),
        base: toScale(line.base, 2),
      };
    })
    .sort(compareLines);
  for (const group of history.vatBreakdown) {
    if (!validRate(group.rate) || !isMoney(group.base) || !isMoney(group.tax)) unusable();
    const rate = toScale(group.rate, 2);
    const atRate = history.lines.filter((line) => compareDecimal(line.rate, rate) === 0);
    if (
      rates.has(rate) ||
      atRate.length === 0 ||
      compareDecimal(sumDecimals(atRate.map((line) => line.base)), group.base) !== 0 ||
      compareDecimal(
        sumDecimals(atRate.map((line) => line.gross)),
        addDecimal(group.base, group.tax),
      ) !== 0
    )
      unusable();
    rates.add(rate);
  }
  if (remaining.some((line) => !rates.has(line.rate))) unusable();
  for (const allocation of history.consumed) {
    const line = remaining.find((entry) => entry.id === allocation.saleLineId);
    if (
      line === undefined ||
      compareDecimal(line.rate, allocation.rate) !== 0 ||
      !isMoney(allocation.gross) ||
      !isMoney(allocation.base) ||
      !isMoney(allocation.tax) ||
      compareDecimal(addDecimal(allocation.base, allocation.tax), allocation.gross) !== 0
    )
      unusable();
    line.gross = subtractDecimal(line.gross, allocation.gross);
    if (compareDecimal(line.gross, ZERO) < 0) unusable();
  }
  for (const group of history.vatBreakdown) {
    const prior = history.consumed.filter(
      (allocation) => compareDecimal(allocation.rate, group.rate) === 0,
    );
    if (
      compareDecimal(sumDecimals(prior.map((allocation) => allocation.base)), group.base) > 0 ||
      compareDecimal(sumDecimals(prior.map((allocation) => allocation.tax)), group.tax) > 0
    )
      unusable();
  }
  return remaining;
}

function compareLines(left: CorrectionAmountLine, right: CorrectionAmountLine): number {
  return left.lineNo - right.lineNo || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
