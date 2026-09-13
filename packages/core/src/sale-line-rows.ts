import { randomUUID } from "node:crypto";
import type { RecordSaleLine } from "./record-sale.js";

/** Every issuance path preserves the same saved facts and resolves child links within its new sale. */
export function saleLineRows(tenantId: string, saleId: string, lines: readonly RecordSaleLine[]) {
  const ids = lines.map(() => randomUUID());
  const byLineNo = new Map(lines.map((line, index) => [line.lineNo, ids[index]!]));
  return lines.map((line, index) => ({
    id: ids[index]!,
    tenantId,
    saleId,
    lineNo: line.lineNo,
    parentLineId: line.parentLineNo == null ? null : (byLineNo.get(line.parentLineNo) ?? null),
    descriptions: line.descriptions,
    modifierSnapshots: line.modifierSnapshots ?? [],
    unitName: line.unitName ?? null,
    unitPrecision: line.unitPrecision ?? null,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    vatRate: line.vatRate,
    lineTotal: line.lineTotal,
    category: line.category ?? null,
    variantId: line.variantId ?? null,
    variantName: line.variantName ?? null,
    kitchenName: line.kitchenName ?? null,
  }));
}
