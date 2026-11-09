import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  decimalToThousandths,
  toScale,
  type Decimal,
} from "@waitron/shared";
import type { VatBreakdownLine } from "@waitron/fiscal";
import { correctionBaseAtRate } from "./correction-allocation.js";
import type { RecordSaleLine } from "./record-sale.js";
import "./errors.js";

/** What the writer read about the invoice being corrected, at the scales its rows store. */
export interface PartialCorrectionHistory {
  invoiceBreakdown: readonly { rate: string; base: string; tax: string }[];
  invoiceLines: ReadonlyMap<
    string,
    { vatRate: number; quantity: number; lineGross: number | null }
  >;
  earlierBreakdowns: readonly (readonly { rate: string; base: string; tax: string }[])[];
  earlierLines: readonly { correctsLineId: string | null; lineGross: number | null }[];
}

interface Group {
  rate: number;
  base: number;
  tax: number;
}

/**
 * The supplied split, checked against the correction's own total and lines, at the cent and
 * sorted by rate. Every amount is signed as filed: the total and each gross below zero, bases and
 * taxes at or below it.
 */
export function checkPartialCorrectionBreakdown(
  total: string,
  lines: readonly RecordSaleLine[],
  breakdown: readonly VatBreakdownLine[],
  wholeInvoice: boolean,
): VatBreakdownLine[] {
  if (wholeInvoice || cents(total) >= 0 || lines.length === 0) refuse();
  const sources = new Set<string>();
  const numbers = new Set<number>();
  const lineGroups = new Map<number, { base: number; gross: number }>();
  for (const line of lines) {
    if (
      !line.correctsLineId ||
      sources.has(line.correctsLineId) ||
      !Number.isSafeInteger(line.lineNo) ||
      line.lineNo < 1 ||
      numbers.has(line.lineNo) ||
      line.lineGross == null
    )
      refuse();
    sources.add(line.correctsLineId);
    numbers.add(line.lineNo);
    const base = cents(line.lineTotal);
    const gross = cents(line.lineGross);
    if (
      base > 0 ||
      gross >= 0 ||
      base < gross ||
      thousandths(line.quantity) >= 0 ||
      cents(line.unitPrice) < 0 ||
      (line.priceQuantity !== undefined && thousandths(line.priceQuantity) <= 0)
    )
      refuse();
    const rate = basisPoints(line.vatRate);
    const group = lineGroups.get(rate) ?? { base: 0, gross: 0 };
    lineGroups.set(rate, { base: group.base + base, gross: group.gross + gross });
  }
  const groups = breakdown.map((group): Group => {
    const checked = {
      rate: basisPoints(group.rate),
      base: cents(group.base),
      tax: cents(group.tax),
    };
    const atRate = lineGroups.get(checked.rate);
    if (
      atRate === undefined ||
      checked.base > 0 ||
      checked.tax > 0 ||
      atRate.base !== checked.base ||
      atRate.gross !== checked.base + checked.tax
    )
      refuse();
    lineGroups.delete(checked.rate);
    return checked;
  });
  if (
    lineGroups.size > 0 ||
    groups.reduce((sum, group) => sum + group.base + group.tax, 0) !== cents(total)
  )
    refuse();
  return groups
    .sort((left, right) => left.rate - right.rate)
    .map((group) => ({
      rate: basisPointsToDecimal(group.rate),
      base: centsToDecimal(group.base),
      tax: centsToDecimal(group.tax),
    }));
}

/**
 * Refuses a checked split unless each line takes from an invoice line at its own rate, with a
 * stored gross nothing has yet exhausted, and no more than its quantity; and unless, at each
 * rate, the base is the one `correctionBaseAtRate` gives after every earlier correction and the
 * running gross stays within the invoice's.
 */
export function checkPartialCorrectionHistory(
  lines: readonly RecordSaleLine[],
  breakdown: readonly VatBreakdownLine[],
  history: PartialCorrectionHistory,
): void {
  for (const line of lines) {
    const source = history.invoiceLines.get(line.correctsLineId!);
    if (
      source === undefined ||
      source.lineGross === null ||
      source.vatRate !== basisPoints(line.vatRate) ||
      -thousandths(line.quantity) > source.quantity
    )
      refuse();
    const earlier = history.earlierLines.filter(
      (row) => row.correctsLineId === line.correctsLineId,
    );
    if (earlier.some((row) => row.lineGross === null)) refuse();
    const taken = -earlier.reduce((sum, row) => sum + row.lineGross!, 0) - cents(line.lineGross!);
    if (taken > source.lineGross) refuse();
  }
  for (const group of breakdown) {
    const rate = basisPoints(group.rate);
    const atRate = (other: { rate: string }) => basisPoints(other.rate) === rate;
    const invoice = history.invoiceBreakdown.filter(atRate).map(storedGroup);
    if (invoice.length !== 1) refuse();
    const earlier = history.earlierBreakdowns.flatMap((stored) =>
      stored.filter(atRate).map(storedGroup),
    );
    const priorBase = -earlier.reduce((sum, prior) => sum + prior.base, 0);
    const priorGross = -earlier.reduce((sum, prior) => sum + prior.base + prior.tax, 0);
    const gross = -(cents(group.base) + cents(group.tax));
    const expected = correctionBaseAtRate(
      basisPointsToDecimal(rate),
      { base: centsToDecimal(invoice[0]!.base), tax: centsToDecimal(invoice[0]!.tax) },
      { gross: centsToDecimal(priorGross), base: centsToDecimal(priorBase) },
      centsToDecimal(gross),
    );
    if (
      compareDecimal(expected, centsToDecimal(-cents(group.base))) !== 0 ||
      priorGross + gross > invoice[0]!.base + invoice[0]!.tax
    )
      refuse();
  }
}

function storedGroup(group: { rate: string; base: string; tax: string }): Group {
  return { rate: basisPoints(group.rate), base: cents(group.base), tax: cents(group.tax) };
}

function basisPoints(value: string): number {
  const rate = exact(value, 2, decimalToBasisPoints);
  if (rate < 0 || rate > 10_000) refuse();
  return rate;
}

function cents(value: string): number {
  return exact(value, 2, decimalToCents);
}

function thousandths(value: string): number {
  return exact(value, 3, decimalToThousandths);
}

function exact(value: string, scale: number, count: (value: Decimal) => number): number {
  try {
    const amount = decimal(value);
    if (compareDecimal(amount, toScale(amount, scale)) === 0) return count(amount);
  } catch {
    refuse();
  }
  refuse();
}

function refuse(): never {
  throw new AppError("sale.correction_breakdown_invalid", {});
}
