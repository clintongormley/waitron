import { inArray, sql } from "drizzle-orm";
import { saleLines, type Transaction } from "@waitron/db";

type CorrectiveRow = Pick<typeof saleLines.$inferSelect, "id" | "lineGross" | "correctsLineId">;

type CorrectedLine = Pick<
  typeof saleLines.$inferSelect,
  "lineGross" | "quantity" | "unitPrecision"
>;

/**
 * How many of a row's dishes `taken` cents give back: k when the row counts a whole number of
 * dishes n > 1, never a weight, at a whole-cent price u, and `taken` is k × u for 0 < k < n;
 * otherwise null.
 */
function wholeDishesOf(taken: number, line: CorrectedLine): number | null {
  const dishes = line.quantity / 1000;
  const price = (line.lineGross ?? 0) / dishes;
  const count = taken / price;
  const counted = line.unitPrecision === 0 && Number.isInteger(dishes) && dishes > 1;
  if (!counted || !Number.isInteger(price) || price <= 0) return null;
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
 * The ids of a corrective's rows given back in part: minus the row's stored gross differs from
 * the stored gross of the line it corrects, and is not a whole number of its dishes. A row naming
 * no line, as a replacement's do, or with no stored gross, is whole.
 */
export async function correctiveLinesInPart(
  tx: Transaction,
  rows: readonly CorrectiveRow[],
): Promise<Set<string>> {
  const parts = await partRows(tx, rows);
  return new Set([...parts].filter(([, dishes]) => dishes === null).map(([id]) => id));
}

/**
 * `lines`, one per entry of `dishes` in order and then the advances, with each line whose row
 * `correctiveLinesInPart` answers marked `givenBackInPart`, and each giving back k whole dishes of
 * its row showing quantity -k. An ordinary sale and a replacement answer `lines` unread.
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
