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
  earlierLines: readonly {
    correctsLineId: string | null;
    vatRate: number;
    lineGross: number | null;
  }[];
  /** Whether the invoice's or an earlier correction's measured figures differ from the stored. */
  moved: boolean;
  /** The measured totals' sum, in cents. */
  measuredRemaining: number;
}

interface Group {
  rate: number;
  base: number;
  tax: number;
}

/**
 * The supplied split, checked against the correction's own total and its lines' fields, at the
 * cent and sorted by rate. Every amount is signed as filed: the total and each gross below zero,
 * bases and taxes at or below it, and no group both zero. Whether the lines agree with the split
 * rate by rate is the history's check, `linesMatchSplit`.
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
    basisPoints(line.vatRate);
  }
  const rates = new Set<number>();
  const groups = breakdown.map((group): Group => {
    const checked = storedGroup(group);
    if (
      rates.has(checked.rate) ||
      checked.base > 0 ||
      checked.tax > 0 ||
      (checked.base === 0 && checked.tax === 0)
    )
      refuse();
    rates.add(checked.rate);
    return checked;
  });
  if (groups.reduce((sum, group) => sum + group.base + group.tax, 0) !== cents(total)) refuse();
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
 * stored gross nothing has yet exhausted, and no more than its quantity; and unless, at each rate,
 * the base is the one `correctionBaseAtRate` gives after every earlier correction and the running
 * gross stays within the invoice's, all at the measured figures. While no figures are moved, the
 * lines must agree with the split at each rate; once moved, only in their gross, and when the
 * measured remaining is not what the invoice's lines have left, the correction must empty both.
 * Refused with `sale.correction_history_unusable` instead when what is stored cannot be checked: an
 * invoice line or an earlier correction of it with no gross, an earlier correction line naming no
 * invoice line (unmoved, only at one of the split's rates), a measured invoice breakdown without
 * exactly one group at a rate of the split or of an earlier correction, or such a rate at which
 * earlier corrections already took more base or gross than that group holds. Every line is known to
 * name a line of the invoice.
 */
export function checkPartialCorrectionHistory(
  lines: readonly RecordSaleLine[],
  breakdown: readonly VatBreakdownLine[],
  history: PartialCorrectionHistory,
): void {
  if (!history.moved) linesMatchSplit(lines, breakdown);
  // Per invoice line, the gross earlier corrections took; null when one stored none.
  const taken = new Map<string, number | null>();
  const unlinkedRates = new Set<number>();
  for (const row of history.earlierLines) {
    if (row.correctsLineId === null) {
      unlinkedRates.add(row.vatRate);
      continue;
    }
    const sum = taken.get(row.correctsLineId);
    taken.set(
      row.correctsLineId,
      sum === null || row.lineGross === null ? null : (sum ?? 0) - row.lineGross,
    );
  }
  const given = breakdown.map(storedGroup);
  let movedInTotal = false;
  if (history.moved) {
    if (
      [...history.invoiceLines.values()].some((source) => source.lineGross === null) ||
      history.earlierLines.some((row) => row.lineGross === null || row.correctsLineId === null)
    )
      unusable();
    const linesLeft = [
      ...[...history.invoiceLines.values()].map((source) => source.lineGross!),
      ...history.earlierLines.map((row) => row.lineGross!),
    ].reduce((sum, gross) => sum + gross, 0);
    movedInTotal = history.measuredRemaining !== linesLeft;
    if (
      !movedInTotal &&
      lines.reduce((sum, line) => sum + cents(line.lineGross!), 0) !==
        given.reduce((sum, group) => sum + group.base + group.tax, 0)
    )
      refuse();
  }
  for (const line of lines) {
    const source = history.invoiceLines.get(line.correctsLineId!)!;
    const earlier = taken.get(line.correctsLineId!);
    if (source.lineGross === null || earlier === null) unusable();
    if (source.vatRate !== basisPoints(line.vatRate)) refuse();
    // Per correction, never cumulative: an amount correction's quantity is the scope shown, not units returned.
    if (-thousandths(line.quantity) > source.quantity) refuse();
    if ((earlier ?? 0) - cents(line.lineGross!) > source.lineGross) refuse();
  }
  const invoice = new Map<number, Group[]>();
  for (const group of history.invoiceBreakdown.map(storedGroup)) {
    invoice.set(group.rate, [...(invoice.get(group.rate) ?? []), group]);
  }
  const prior = new Map<number, { base: number; gross: number }>();
  for (const group of history.earlierBreakdowns.flat().map(storedGroup)) {
    const sum = prior.get(group.rate) ?? { base: 0, gross: 0 };
    prior.set(group.rate, {
      base: sum.base - group.base,
      gross: sum.gross - group.base - group.tax,
    });
  }
  const byRate = new Map(given.map((group) => [group.rate, group]));
  for (const rate of new Set([...byRate.keys(), ...prior.keys()])) {
    const atRate = invoice.get(rate);
    const group = byRate.get(rate);
    if ((group !== undefined && !history.moved && unlinkedRates.has(rate)) || atRate?.length !== 1)
      unusable();
    const original = atRate[0]!;
    const before = prior.get(rate) ?? { base: 0, gross: 0 };
    if (before.base > original.base || before.gross > original.base + original.tax) unusable();
    if (group === undefined) continue;
    const gross = -(group.base + group.tax);
    const expected = correctionBaseAtRate(
      basisPointsToDecimal(rate),
      { base: centsToDecimal(original.base), tax: centsToDecimal(original.tax) },
      { gross: centsToDecimal(before.gross), base: centsToDecimal(before.base) },
      centsToDecimal(gross),
    );
    if (
      compareDecimal(expected, centsToDecimal(-group.base)) !== 0 ||
      before.gross + gross > original.base + original.tax
    )
      refuse();
  }
  if (!movedInTotal) return;
  for (const [rate, groups] of invoice) {
    const group = byRate.get(rate);
    const gross = group === undefined ? 0 : -(group.base + group.tax);
    if (
      (prior.get(rate)?.gross ?? 0) + gross !==
      groups.reduce((sum, each) => sum + each.base + each.tax, 0)
    )
      refuse();
  }
  const takes = new Map(lines.map((line) => [line.correctsLineId!, -cents(line.lineGross!)]));
  for (const [id, source] of history.invoiceLines) {
    if ((taken.get(id) ?? 0) + (takes.get(id) ?? 0) !== source.lineGross) refuse();
  }
}

/** Refuses unless, at each rate, the lines' base is the split's base and their gross its gross. */
function linesMatchSplit(
  lines: readonly RecordSaleLine[],
  breakdown: readonly VatBreakdownLine[],
): void {
  const lineGroups = new Map<number, { base: number; gross: number }>();
  for (const line of lines) {
    const rate = basisPoints(line.vatRate);
    const group = lineGroups.get(rate) ?? { base: 0, gross: 0 };
    lineGroups.set(rate, {
      base: group.base + cents(line.lineTotal),
      gross: group.gross + cents(line.lineGross!),
    });
  }
  for (const group of breakdown.map(storedGroup)) {
    const atRate = lineGroups.get(group.rate);
    if (
      atRate === undefined ||
      atRate.base !== group.base ||
      atRate.gross !== group.base + group.tax
    )
      refuse();
    lineGroups.delete(group.rate);
  }
  if (lineGroups.size > 0) refuse();
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

function unusable(): never {
  throw new AppError("sale.correction_history_unusable", {});
}
