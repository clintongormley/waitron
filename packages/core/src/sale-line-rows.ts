import { randomUUID } from "node:crypto";
import { decimal, decimalToCents } from "@waitron/shared";
import type { RecordSaleLine } from "./record-sale.js";

/**
 * Every issuance path preserves the same saved facts and resolves child links within its new sale.
 *
 * This builds the `sale_lines` insert, so it is where a line's decimal amounts become the count of
 * whole cents the money columns store. `quantity` and `vatRate` are not money columns — they keep
 * their own scales and stay decimal strings.
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
    quantity: line.quantity,
    unitPrice: decimalToCents(decimal(line.unitPrice)),
    vatRate: line.vatRate,
    lineTotal: decimalToCents(decimal(line.lineTotal)),
    category: line.category ?? null,
    variantId: line.variantId ?? null,
    variantName: line.variantName ?? null,
    variantDescriptions: line.variantDescriptions ?? null,
    variantKitchenName: line.variantKitchenName ?? null,
    kitchenName: line.kitchenName ?? null,
  }));
}
