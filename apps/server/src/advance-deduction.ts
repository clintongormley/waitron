import "./errors.js";
import {
  AppError,
  addDecimal,
  compareDecimal,
  decimal,
  isZeroDecimal,
  negateDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
  MONEY_SCALE,
  type Decimal,
} from "@waitron/shared";
import { splitGross, vatSignRefused, type PricedLine, type PricedLines } from "@waitron/menu";
import { receiptLabelsFor } from "@waitron/country-packs";
import type { VatBreakdownLine } from "@waitron/fiscal/src/vat-breakdown.js";

/** An advance's invoice as it stands, its correctives included, at one rate. */
export interface AdvanceGroup {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
}

export interface AdvanceCredit {
  saleId: string;
  invoiceNumber: string;
  issuedAt: string;
  groups: readonly AdvanceGroup[];
  gross: Decimal;
}

export interface DeductionOptions {
  /** The sale's invoice languages, for the stored words of each deduction line. */
  languages: readonly string[];
}

export interface DeductionLine extends PricedLine {
  advanceRole: "deduction";
  deductsSaleId: string;
}

interface Take {
  advance: AdvanceCredit;
  rate: Decimal;
  base: Decimal;
  gross: Decimal;
  lineTotal?: Decimal;
}

const ZERO = decimal("0.00");
const sameRate = (a: Decimal, b: Decimal) => compareDecimal(a, b) === 0;

function takesOf(advances: readonly AdvanceCredit[]): Take[] {
  const takes: Take[] = [];
  for (const advance of advances) {
    for (const group of advance.groups) {
      if (isZeroDecimal(group.base) && isZeroDecimal(group.tax)) continue;
      takes.push({
        advance,
        rate: toScale(group.rate, MONEY_SCALE),
        base: group.base,
        gross: addDecimal(group.base, group.tax),
      });
    }
  }
  return takes;
}

/**
 * The rest's invoice of a bill on which advances were taken: what is left at each rate, and one
 * line per advance and rate taking it off. At each rate the rest files the meal's base and VAT less
 * each advance's own filed figures (ruling L1), unless AEAT's sign rule would refuse that pair;
 * there what is left is worked out from its gross and the last deduction line at that rate takes
 * the difference. Each rate's line bases then sum to its filed
 * base, and its line grosses to its base plus VAT.
 */
export function deductAdvances(
  priced: PricedLines,
  advances: readonly AdvanceCredit[],
  options: DeductionOptions,
): { priced: PricedLines; deductionLines: DeductionLine[] } {
  const takes = takesOf(advances);
  if (takes.length === 0) return { priced, deductionLines: [] };

  const credit = sumDecimals(takes.map((take) => take.gross));
  const total = subtractDecimal(priced.total, credit);
  if (compareDecimal(total, ZERO) < 0) {
    throw new AppError("advance.exceeds_bill", { mealTotal: priced.total, advances: credit });
  }

  const vatBreakdown: VatBreakdownLine[] = [...priced.vatBreakdown];
  const rates: Decimal[] = [];
  for (const take of takes) {
    if (!rates.some((rate) => sameRate(rate, take.rate))) rates.push(take.rate);
  }
  for (const rate of rates) {
    const at = takes.filter((take) => sameRate(take.rate, rate));
    const index = vatBreakdown.findIndex((row) => sameRate(row.rate, rate));
    const meal = index === -1 ? { rate, base: ZERO, tax: ZERO } : vatBreakdown[index]!;
    const left = {
      base: subtractDecimal(meal.base, sumDecimals(at.map((take) => take.base))),
      tax: subtractDecimal(
        meal.tax,
        sumDecimals(at.map((take) => subtractDecimal(take.gross, take.base))),
      ),
    };
    let row = left;
    for (const take of at) take.lineTotal = negateDecimal(take.base);
    if (vatSignRefused(left.base, left.tax, rate)) {
      const mealGross = addDecimal(meal.base, meal.tax);
      row = splitGross(subtractDecimal(mealGross, sumDecimals(at.map((t) => t.gross))), rate);
      const mealLineBases = sumDecimals(
        priced.lines
          .filter((line) => sameRate(decimal(line.vatRate), rate))
          .map((l) => decimal(l.lineTotal)),
      );
      const others = sumDecimals(at.slice(0, -1).map((take) => take.lineTotal!));
      at.at(-1)!.lineTotal = subtractDecimal(subtractDecimal(row.base, mealLineBases), others);
    }
    if (index === -1) vatBreakdown.push({ rate, ...row });
    else vatBreakdown[index] = { ...meal, ...row };
  }

  const name = receiptLabelsFor("en-GB").paymentOnAccount;
  const descriptions = Object.fromEntries(
    options.languages.map((language) => [language, receiptLabelsFor(language).paymentOnAccount]),
  );
  const firstLineNo = Math.max(0, ...priced.lines.map((line) => line.lineNo)) + 1;
  const deductionLines = takes.map((take, i): DeductionLine => ({
    lineNo: firstLineNo + i,
    name,
    descriptions,
    optionSnapshots: [],
    quantity: "1",
    unitPrice: take.lineTotal!,
    vatRate: take.rate,
    lineTotal: take.lineTotal!,
    lineGross: negateDecimal(take.gross),
    category: null,
    unitName: null,
    unitPrecision: null,
    parentLineNo: null,
    variantName: null,
    variantDescriptions: null,
    variantKitchenName: null,
    kitchenName: null,
    advanceRole: "deduction",
    deductsSaleId: take.advance.saleId,
  }));
  return { priced: { lines: priced.lines, total, vatBreakdown }, deductionLines };
}
