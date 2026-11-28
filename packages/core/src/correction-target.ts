import { and, eq, sql } from "drizzle-orm";
import { correctivesOf, saleLines, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { saleId as brandSaleId } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";

/**
 * The invoice a correction of `saleId` is filed against: its replacement when it has one, since
 * that is the invoice AEAT holds in the sale's place, else the sale itself. A sale has at most one
 * replacement (`sale.replacement_not_first`).
 */
export async function correctionTargetFor(tx: Transaction, saleId: SaleId): Promise<SaleId> {
  const [replacement] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.correctsSaleId, saleId), eq(sales.replacesOriginal, true)));
  return replacement === undefined ? saleId : brandSaleId(replacement.id);
}

/**
 * The corrections already recorded that change what the correction target `targetId`
 * (`correctionTargetFor`) owes, read through `correctivesOf`: for a replacement, the replaced
 * invoice's own (the replacement left out) and the replacement's. A line of the replaced
 * invoice's correction names that invoice's line, so it is read as naming the replacement's line
 * with the same line number.
 */
export async function earlierCorrectionsOf(tx: Transaction, targetId: SaleId) {
  const [target] = await tx
    .select({ correctsSaleId: sales.correctsSaleId, replacesOriginal: sales.replacesOriginal })
    .from(sales)
    .where(eq(sales.id, targetId));
  const replaced =
    target?.replacesOriginal === true && target.correctsSaleId !== null
      ? brandSaleId(target.correctsSaleId)
      : null;
  const ofTarget = correctivesOf(sql`${sales}`, sql`${replaced ?? targetId}`);
  const corrections = await tx
    .select({ id: sales.id, total: sales.total, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(ofTarget);
  const lines = await tx
    .select({
      saleId: saleLines.saleId,
      correctsLineId: saleLines.correctsLineId,
      vatRate: saleLines.vatRate,
      lineTotal: saleLines.lineTotal,
      lineGross: saleLines.lineGross,
      setMenuPart: saleLines.setMenuPart,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(ofTarget)
    .orderBy(saleLines.saleId, saleLines.lineNo);
  if (replaced === null) return { corrections, lines };
  const numbered = (saleId: SaleId) =>
    tx
      .select({ id: saleLines.id, lineNo: saleLines.lineNo })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId));
  const byNumber = new Map((await numbered(targetId)).map((line) => [line.lineNo, line.id]));
  const onReplaced = new Map(
    (await numbered(replaced)).map((line) => [line.id, byNumber.get(line.lineNo) ?? null]),
  );
  return {
    corrections,
    lines: lines.map((line) =>
      line.correctsLineId !== null && onReplaced.has(line.correctsLineId)
        ? { ...line, correctsLineId: onReplaced.get(line.correctsLineId)! }
        : line,
    ),
  };
}
