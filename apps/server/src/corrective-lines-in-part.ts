import { inArray, sql } from "drizzle-orm";
import { saleLines, type Transaction } from "@waitron/db";
import { baseFromGross } from "@waitron/menu";
import { basisPointsToDecimal, centsToDecimal, decimalToCents } from "@waitron/shared";

type CorrectiveRow = Pick<typeof saleLines.$inferSelect, "id" | "lineGross" | "correctsLineId">;

type CorrectedLine = Pick<
  typeof saleLines.$inferSelect,
  "lineGross" | "quantity" | "unitPrecision" | "unitPrice" | "vatRate" | "setMenuPart"
>;

/**
 * k when `taken` cents are k of a counted row's n dishes, 0 < k < n, and the row's unit price is
 * what one of them paid: an nth of its money is whole cents whose price before VAT is the stored
 * unit price, so -k at that price agrees with the corrective's amount as the row's n agrees with
 * its own. A row of a divided set menu is in part, null, whatever its figures.
 */
function wholeDishesOf(taken: number, line: CorrectedLine): number | null {
  if (line.unitPrecision !== 0 || line.setMenuPart !== null) return null;
  const dishes = line.quantity / 1000;
  const each = line.lineGross! / dishes;
  if (!Number.isInteger(each)) return null;
  const price = baseFromGross(centsToDecimal(each), basisPointsToDecimal(line.vatRate));
  if (decimalToCents(price) !== line.unitPrice) return null;
  const count = taken / each;
  return Number.isInteger(count) && count > 0 && count < dishes ? count : null;
}

/**
 * Each corrective row naming a line with a stored gross that gives back other than the whole of
 * it: by id, the whole dishes it gives back (`wholeDishesOf`), or null when it is in part.
 */
async function partRows(
  tx: Transaction,
  rows: readonly CorrectiveRow[],
): Promise<Map<string, number | null>> {
  const named = rows.filter((row) => row.correctsLineId !== null && row.lineGross !== null);
  if (named.length === 0) return new Map();
  const ids = JSON.stringify(named.map((row) => row.correctsLineId!));
  const corrected = await tx
    .select({
      id: saleLines.id,
      lineGross: saleLines.lineGross,
      quantity: saleLines.quantity,
      unitPrecision: saleLines.unitPrecision,
      unitPrice: saleLines.unitPrice,
      vatRate: saleLines.vatRate,
      setMenuPart: saleLines.setMenuPart,
    })
    .from(saleLines)
    .where(inArray(saleLines.id, sql`(select value from json_each(${ids}))`));
  const byId = new Map(corrected.map((line) => [line.id, line]));
  const answer = new Map<string, number | null>();
  for (const row of named) {
    const line = byId.get(row.correctsLineId!)!;
    const taken = -row.lineGross!;
    if (taken !== line.lineGross) answer.set(row.id, wholeDishesOf(taken, line));
  }
  return answer;
}

/**
 * `lines`, one per entry of `dishes` in order and then the advances, with each line whose row gives
 * back other than the whole of the line it corrects marked `givenBackInPart`, unless it gives back
 * k whole dishes of its row (`wholeDishesOf`): then it shows quantity -k. A row naming no line, as
 * a replacement's do, or with no stored gross, is whole. An ordinary sale and a replacement answer
 * `lines` unread.
 */
export async function markGivenBackInPart<
  Line extends { quantity: string; givenBackInPart?: true },
>(
  tx: Transaction,
  sale: { correctsSaleId: string | null; replacesOriginal: boolean },
  dishes: readonly CorrectiveRow[],
  lines: readonly Line[],
): Promise<Line[]> {
  if (sale.correctsSaleId === null || sale.replacesOriginal) return [...lines];
  const parts = await partRows(tx, dishes);
  return lines.map((line, i) => {
    if (dishes[i] === undefined || !parts.has(dishes[i].id)) return line;
    const count = parts.get(dishes[i].id);
    return count == null ? { ...line, givenBackInPart: true } : { ...line, quantity: `-${count}` };
  });
}
