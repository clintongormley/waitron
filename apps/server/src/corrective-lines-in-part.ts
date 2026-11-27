import { inArray } from "drizzle-orm";
import { saleLines, type Transaction } from "@waitron/db";

type CorrectiveRow = Pick<typeof saleLines.$inferSelect, "id" | "lineGross" | "correctsLineId">;

/**
 * The ids of a corrective's rows given back in part: minus the row's stored gross differs from
 * the stored gross of the line it corrects. A row naming no line, as a replacement's do, or with
 * no stored gross on either side, is whole.
 */
export async function correctiveLinesInPart(
  tx: Transaction,
  rows: readonly CorrectiveRow[],
): Promise<Set<string>> {
  const named = rows.filter((row) => row.correctsLineId !== null && row.lineGross !== null);
  if (named.length === 0) return new Set();
  const corrected = await tx
    .select({ id: saleLines.id, lineGross: saleLines.lineGross })
    .from(saleLines)
    .where(
      inArray(
        saleLines.id,
        named.map((row) => row.correctsLineId!),
      ),
    );
  const grossOf = new Map(corrected.map((line) => [line.id, line.lineGross]));
  return new Set(
    named
      .filter((row) => {
        const gross = grossOf.get(row.correctsLineId!);
        return typeof gross === "number" && -row.lineGross! !== gross;
      })
      .map((row) => row.id),
  );
}
