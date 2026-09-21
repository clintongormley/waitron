import { randomUUID } from "node:crypto";
import {
  decimal,
  decimalToBasisPoints,
  decimalToCents,
  decimalToThousandths,
} from "@waitron/shared";
import type { RecordSaleLine } from "./record-sale.js";

/**
 * Every issuance path preserves the same saved facts and resolves child links within its new sale.
 *
 * This builds the `sale_lines` insert, so it is where a line's decimal literals become the whole
 * numbers those columns store — each at its own scale, which is why there are three converters and
 * not one: an amount counts cents, `quantity` counts thousandths (0.005 kg is 5), `vatRate` counts
 * basis points (21.00% is 2100).
 *
 * The conversion is this row and nothing above it. The line's own `quantity` and `vatRate` stay the
 * decimal strings the caller supplied, and the breakdown the fiscal record is filed with comes from
 * those: all three issuance paths hand `buildVatBreakdown` (`record-sale.ts`) their `input.lines`,
 * never a row this returns.
 */
export function saleLineRows(saleId: string, lines: readonly RecordSaleLine[]) {
  const ids = lines.map(() => randomUUID());
  const byLineNo = new Map(lines.map((line, index) => [line.lineNo, ids[index]!]));
  return lines.map((line, index) => ({
    id: ids[index]!,
    saleId,
    lineNo: line.lineNo,
    parentLineId: line.parentLineNo == null ? null : (byLineNo.get(line.parentLineNo) ?? null),
    name: line.name,
    descriptions: line.descriptions,
    optionSnapshots: line.optionSnapshots ?? [],
    unitName: line.unitName ?? null,
    unitPrecision: line.unitPrecision ?? null,
    quantity: decimalToThousandths(decimal(line.quantity)),
    unitPrice: decimalToCents(decimal(line.unitPrice)),
    vatRate: decimalToBasisPoints(decimal(line.vatRate)),
    lineTotal: decimalToCents(decimal(line.lineTotal)),
    category: line.category ?? null,
    variantId: line.variantId ?? null,
    variantName: line.variantName ?? null,
    variantDescriptions: line.variantDescriptions ?? null,
    variantKitchenName: line.variantKitchenName ?? null,
    kitchenName: line.kitchenName ?? null,
  }));
}
