import { randomUUID } from "node:crypto";
import { stringToBasisPoints, stringToCents, stringToThousandths } from "@waitron/shared";
import type { RecordSaleLine } from "./record-sale.js";

/**
 * The `sale_lines` insert, and the only place a line's decimal literals become the whole numbers
 * those columns store, each at its own scale: amounts in cents, `quantity` in thousandths
 * (0.005 kg is 5), `vatRate` in basis points (21.00% is 2100). The fiscal breakdown is never built
 * from these rows. A child line's parent is resolved within the new sale.
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
    quantity: stringToThousandths(line.quantity),
    unitPrice: stringToCents(line.unitPrice),
    vatRate: stringToBasisPoints(line.vatRate),
    lineTotal: stringToCents(line.lineTotal),
    category: line.category ?? null,
    variantName: line.variantName ?? null,
    variantDescriptions: line.variantDescriptions ?? null,
    variantKitchenName: line.variantKitchenName ?? null,
    kitchenName: line.kitchenName ?? null,
    productId: line.productId ?? null,
    parentProductId: line.parentProductId ?? null,
    menuId: line.menuId ?? null,
    menuVersionId: line.menuVersionId ?? null,
    lineGross: line.lineGross == null ? null : stringToCents(line.lineGross),
    classification: line.classification ?? null,
  }));
}
