import { inArray } from "drizzle-orm";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { staffPresentationName } from "@waitron/catalogue";
import { thousandthsToDecimal } from "@waitron/shared";

export interface OrderPreviewItem {
  lineId: string;
  name: string;
  quantity: string;
  note: string | null;
  extras: { lineId: string; name: string; quantity: string }[];
}

export async function readOrderPreviewItems(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, OrderPreviewItem[]>> {
  const result = new Map(orderIds.map((id) => [id, [] as OrderPreviewItem[]]));
  if (orderIds.length === 0) return result;
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      orderId: workingOrderLines.workingOrderId,
      parentLineId: workingOrderLines.parentLineId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.workingOrderId, [...orderIds]))
    .orderBy(workingOrderLines.lineNo);
  const children = new Map<string, OrderPreviewItem["extras"]>();
  for (const row of rows) {
    if (row.parentLineId === null) continue;
    const extras = children.get(row.parentLineId) ?? [];
    extras.push({
      lineId: row.id,
      name: staffPresentationName(row),
      quantity: thousandthsToDecimal(row.quantity),
    });
    children.set(row.parentLineId, extras);
  }
  for (const row of rows) {
    if (row.parentLineId !== null) continue;
    result.get(row.orderId)!.push({
      lineId: row.id,
      name: staffPresentationName(row),
      quantity: thousandthsToDecimal(row.quantity),
      note: row.note,
      extras: children.get(row.id) ?? [],
    });
  }
  return result;
}
