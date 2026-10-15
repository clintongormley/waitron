import { baseFromGross, EACH_UNIT } from "@waitron/catalogue";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  isZeroDecimal,
  multiplyDecimal,
  MONEY_SCALE,
  resolveSnapshotText,
  subtractDecimal,
  sumDecimals,
  type Decimal,
} from "@waitron/shared";
import type { ReceiptAdjustment, TillSaleLine } from "./till-sale.js";

export type FiledLine = TillSaleLine & { net: NonNullable<TillSaleLine["net"]> };

export function isFiled(line: TillSaleLine): line is FiledLine {
  return line.net !== undefined;
}

const ZERO = decimal("0.00");
const ONE = decimal("1");

/** A line's price, amount and discount before VAT; `discount` is "0.00" when nothing is taken off
 *  before VAT. Each line comes to its filed base exactly: amount − discount = `net.base`. */
export interface BeforeVatFigures {
  price: Decimal;
  amount: Decimal;
  discount: Decimal;
}

export interface FiguredLine {
  line: FiledLine;
  figures: BeforeVatFigures;
}

export function beforeVatFigures(line: FiledLine): BeforeVatFigures {
  const net = line.net;
  const filed = { price: decimal(net.unitPrice), amount: decimal(net.base), discount: ZERO };
  if (line.listGross === undefined) return filed;
  const listGross = decimal(line.listGross);
  const listUnitGross = listUnitGrossOf(line, listGross);
  if (listUnitGross === null) return filed;
  const rate = decimal(net.rate);
  const amount = baseFromGross(listGross, rate);
  const discount = subtractDecimal(amount, filed.amount);
  if (compareDecimal(discount, ZERO) < 0) return filed;
  return { price: baseFromGross(listUnitGross, rate), amount, discount };
}

/** The line's stored unit price with VAT before any discount, else one worked back from its total. */
function listUnitGrossOf(line: FiledLine, listGross: Decimal): Decimal | null {
  if (line.listUnitPriceGross !== undefined) return decimal(line.listUnitPriceGross);
  const quantity = decimal(line.quantity);
  const priceQuantity = decimal(line.net.priceQuantity);
  // Under one priced unit the list price cannot be divided back exactly.
  if (compareDecimal(quantity, priceQuantity) < 0) return null;
  return divideDecimal(multiplyDecimal(listGross, priceQuantity), quantity, MONEY_SCALE);
}

export interface GroupDiscount {
  /** The lines' `net.rate`, as filed. */
  rate: string;
  /** What the row takes off at this rate, before VAT; never zero. */
  amount: Decimal;
  /** Every line of the family at this rate has a filed base of zero; always false on an end row. */
  comp: boolean;
  /** The adjustment whose words name the row, or null for plain «Descuento». */
  named: ReceiptAdjustment | null;
}

export interface FiguredGroup {
  /** The group's position in `groupByParent(result.lines)`. */
  at: number;
  /** `dish.dishFamily` when set, else the dish's own index in `result.lines`. */
  family: number;
  lines: readonly FiguredLine[];
}

export interface InvoiceDiscounts {
  /** Own rows to print under a group, keyed by `FiguredGroup.at`. */
  under: ReadonlyMap<number, GroupDiscount[]>;
  /** One row per rate, in the order rates first appear in `groups`; never zero. */
  atEnd: GroupDiscount[];
}

/** A dish family's own discount prints under the family; what the bill took off prints once per
 *  rate at the end. Per family and rate: own + bill share = the lines' discounts, so the table still
 *  comes to the filed bases. `groups` holds the invoice's groups whose lines all have `net`. */
export function invoiceDiscounts(
  groups: readonly FiguredGroup[],
  billAdjustments: readonly ReceiptAdjustment[],
): InvoiceDiscounts {
  const families = new Map<number, FiguredGroup[]>();
  for (const group of groups) {
    const members = families.get(group.family);
    if (members === undefined) families.set(group.family, [group]);
    else members.push(group);
  }
  const hasBill = billAdjustments.length > 0;
  const under = new Map<number, GroupDiscount[]>();
  const billShares: { rate: string; amount: Decimal }[] = [];
  for (const members of families.values()) {
    const lines = members.flatMap((group) => group.lines);
    const ownEntries = lines.flatMap(({ line }) => line.adjustments ?? []);
    const byRate = discountsByRate(lines);
    const oneRate = byRate.length === 1;
    const home =
      members.find((group) =>
        group.lines.some(({ line }) => (line.adjustments ?? []).length > 0),
      ) ?? members[0]!;
    for (const entry of byRate) {
      const ownAmount =
        !hasBill || (ownEntries.length > 0 && !oneRate)
          ? entry.amount
          : ownEntries.length === 0
            ? ZERO
            : clamp(
                baseFromGross(
                  sumDecimals(ownEntries.map((own) => decimal(own.amount))),
                  decimal(entry.rate),
                ),
                entry.amount,
              );
      addByRate(billShares, entry.rate, subtractDecimal(entry.amount, ownAmount));
      if (isZeroDecimal(ownAmount)) continue;
      const row: GroupDiscount = {
        rate: entry.rate,
        amount: ownAmount,
        comp: entry.comp,
        named: ownEntries.length === 1 && (!hasBill || oneRate) ? ownEntries[0]! : null,
      };
      const rows = under.get(home.at);
      if (rows === undefined) under.set(home.at, [row]);
      else rows.push(row);
    }
  }
  const atEndNamed = billAdjustments.length === 1 ? billAdjustments[0]! : null;
  const atEnd = firstRates(groups)
    .map((rate) => ({
      rate,
      amount: billShares.find((share) => sameRate(share.rate, rate))?.amount ?? ZERO,
      comp: false,
      named: atEndNamed,
    }))
    .filter((row) => !isZeroDecimal(row.amount));
  return { under, atEnd };
}

function sameRate(left: string, right: string): boolean {
  return compareDecimal(decimal(left), decimal(right)) === 0;
}

function addByRate(
  totals: { rate: string; amount: Decimal }[],
  rate: string,
  amount: Decimal,
): void {
  const entry = totals.find((candidate) => sameRate(candidate.rate, rate));
  if (entry === undefined) totals.push({ rate, amount });
  else entry.amount = addDecimal(entry.amount, amount);
}

/** Every rate the lines carry, as first filed, in the order they first appear. */
function firstRates(groups: readonly FiguredGroup[]): string[] {
  const rates: string[] = [];
  for (const { line } of groups.flatMap((group) => group.lines)) {
    if (!rates.some((rate) => sameRate(rate, line.net.rate))) rates.push(line.net.rate);
  }
  return rates;
}

/** The lines' discounts added per rate, in the order the rates first appear; `comp` when every
 *  line at the rate has a filed base of zero. */
function discountsByRate(
  lines: readonly FiguredLine[],
): { rate: string; amount: Decimal; comp: boolean }[] {
  const byRate: { rate: string; amount: Decimal; comp: boolean }[] = [];
  for (const {
    line,
    figures: { discount },
  } of lines) {
    const zeroBase = isZeroDecimal(decimal(line.net.base));
    const entry = byRate.find((candidate) => sameRate(candidate.rate, line.net.rate));
    if (entry === undefined) byRate.push({ rate: line.net.rate, amount: discount, comp: zeroBase });
    else {
      entry.amount = addDecimal(entry.amount, discount);
      entry.comp &&= zeroBase;
    }
  }
  return byRate;
}

/** `value` kept between zero and `ceiling`. */
function clamp(value: Decimal, ceiling: Decimal): Decimal {
  if (compareDecimal(value, ZERO) < 0) return ZERO;
  return compareDecimal(value, ceiling) > 0 ? ceiling : value;
}

/** "4" for a count in the Each unit or a line with no unit; "2" for two portions of an extra
 *  priced per portion; "0.35 kg" for any other unit. */
export function quantityText(
  line: Pick<TillSaleLine, "quantity" | "unitName" | "soldInEach" | "net">,
  namesLocale: string,
): string {
  if (line.net !== undefined) {
    const priceQuantity = decimal(line.net.priceQuantity);
    if (compareDecimal(priceQuantity, ONE) !== 0) {
      const quantity = decimal(line.quantity);
      const portions = divideDecimal(quantity, priceQuantity, 0);
      if (compareDecimal(multiplyDecimal(portions, priceQuantity), quantity) === 0) return portions;
    }
  }
  const unitName = line.unitName;
  if (unitName == null || line.soldInEach === true) return line.quantity;
  // `soldInEach` marks a line whose recorded context says Each; any other line is judged by its names.
  const each = Object.entries(unitName).every(
    ([language, text]) =>
      (EACH_UNIT.abbreviation as Record<string, string>)[language.split("-")[0]!] === text,
  );
  if (each) return line.quantity;
  return `${line.quantity} ${resolveSnapshotText(unitName, namesLocale, namesLocale)}`;
}
