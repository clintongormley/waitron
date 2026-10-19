import { eq } from "drizzle-orm";
import { saleLines, workingOrderLines, type Transaction } from "@waitron/db";
import { addDecimal, centsToDecimal, decimal, thousandthsToDecimal } from "@waitron/shared";

export async function cancellationRefundValue(
  tx: Transaction,
  billId: string,
  saleId: string,
  lineId: string,
): Promise<{ quantity: string; gross: string } | undefined> {
  const stored = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  const filed = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  // Issuance numbers the sorted working lines by position, closing stored-number gaps.
  if (
    stored.length !== filed.length ||
    stored.some((row, i) => {
      const frozen = filed[i]!;
      const parent = stored.findIndex((candidate) => candidate.id === row.parentLineId);
      return (
        frozen.lineNo !== i + 1 ||
        frozen.quantity !== row.quantity ||
        frozen.parentLineId !== (parent === -1 ? null : filed[parent]!.id)
      );
    })
  )
    return undefined;
  const parent = stored.find((row) => row.id === lineId && row.parentLineId === null);
  if (parent === undefined) return undefined;
  let gross = decimal("0.00");
  for (const [i, row] of stored.entries()) {
    if (row.id !== lineId && row.parentLineId !== lineId) continue;
    const amount = filed[i]!.lineGross;
    if (amount === null) return undefined;
    gross = addDecimal(gross, centsToDecimal(amount));
  }
  return { quantity: thousandthsToDecimal(parent.quantity), gross };
}
