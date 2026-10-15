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
  type Decimal,
} from "@waitron/shared";
import type { LineGroup } from "./receipt-lines.js";
import type { ReceiptAdjustment, TillSaleLine } from "./till-sale.js";

type FiledLine = TillSaleLine & { net: NonNullable<TillSaleLine["net"]> };

const ZERO = decimal("0.00");
const ONE = decimal("1");

/** A line's price, amount and discount before VAT; `discount` is "0.00" when nothing is taken off
 *  before VAT. Each line comes to its filed base exactly: amount − discount = `net.base`. */
export function beforeVatFigures(line: FiledLine): {
  price: Decimal;
  amount: Decimal;
  discount: Decimal;
} {
  const net = line.net;
  const filed = { price: decimal(net.unitPrice), amount: decimal(net.base), discount: ZERO };
  if (line.listGross === undefined) return filed;
  const quantity = decimal(line.quantity);
  const priceQuantity = decimal(net.priceQuantity);
  // Under one priced unit the list price cannot be divided back exactly (owner question Q9).
  if (compareDecimal(quantity, priceQuantity) < 0) return filed;
  const rate = decimal(net.rate);
  const listGross = decimal(line.listGross);
  const amount = baseFromGross(listGross, rate);
  const discount = subtractDecimal(amount, filed.amount);
  if (compareDecimal(discount, ZERO) < 0) return filed;
  const listUnitGross = divideDecimal(
    multiplyDecimal(listGross, priceQuantity),
    quantity,
    MONEY_SCALE,
  );
  return { price: baseFromGross(listUnitGross, rate), amount, discount };
}

export interface GroupDiscount {
  /** The lines' `net.rate`, as filed. */
  rate: string;
  /** The `discount` of `beforeVatFigures` for the group's lines at this rate, added; never zero. */
  amount: Decimal;
  /** Every line of the group at this rate has a filed base of zero. */
  comp: boolean;
  /** The adjustment whose words name the row, or null for plain «Descuento». */
  named: ReceiptAdjustment | null;
}

/** One entry per rate the group's lines carry, in the order the rates first appear. Every line of
 *  `group` must have `net`. */
export function groupDiscounts(
  group: LineGroup,
  billAdjustments: readonly ReceiptAdjustment[],
  invoiceHasLineAdjustments: boolean,
): GroupDiscount[] {
  const lines = [group.dish, ...group.options] as FiledLine[];
  const own = lines.flatMap((line) => line.adjustments ?? []);
  const named =
    own.length === 1 && billAdjustments.length === 0
      ? own[0]!
      : own.length === 0 && billAdjustments.length === 1 && !invoiceHasLineAdjustments
        ? billAdjustments[0]!
        : null;
  const byRate: { rate: string; amount: Decimal; comp: boolean }[] = [];
  for (const line of lines) {
    const { discount } = beforeVatFigures(line);
    const zeroBase = isZeroDecimal(decimal(line.net.base));
    const entry = byRate.find(
      (candidate) => compareDecimal(decimal(candidate.rate), decimal(line.net.rate)) === 0,
    );
    if (entry === undefined) {
      byRate.push({ rate: line.net.rate, amount: discount, comp: zeroBase });
    } else {
      entry.amount = addDecimal(entry.amount, discount);
      entry.comp &&= zeroBase;
    }
  }
  return byRate
    .filter((entry) => !isZeroDecimal(entry.amount))
    .map((entry) => ({ ...entry, named }));
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
  // `soldInEach` comes from the line's recorded context; a sale with none leaves only the names.
  const each = Object.entries(unitName).every(
    ([language, text]) =>
      (EACH_UNIT.abbreviation as Record<string, string>)[language.split("-")[0]!] === text,
  );
  if (each) return line.quantity;
  return `${line.quantity} ${resolveSnapshotText(unitName, namesLocale, namesLocale)}`;
}
