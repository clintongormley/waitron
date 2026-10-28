import { eq } from "drizzle-orm";
import { saleLinePortions, saleLines, workingOrderLines, type Transaction } from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  decimal,
  sumDecimals,
  thousandthsToDecimal,
} from "@waitron/shared";
import { readPortionBindings } from "./order-portions.js";

type Filed = typeof saleLines.$inferSelect;
type Stored = typeof workingOrderLines.$inferSelect;

export async function cancellationRefundValue(
  tx: Transaction,
  billId: string,
  saleId: string,
  lineId: string,
): Promise<{ quantity: string; gross: string } | undefined> {
  return (await refundValues(tx, billId, saleId, [lineId]))[0];
}

/** A till row of identical portions valued as today's one line (plan D32): the portions' count and
 * the sum of each one's filed value; none when any portion's value cannot be read. */
export async function rowRefundValue(
  tx: Transaction,
  billId: string,
  saleId: string,
  lineIds: readonly string[],
): Promise<{ quantity: string; gross: string } | undefined> {
  const values = await refundValues(tx, billId, saleId, lineIds);
  if (values.some((value) => value === undefined)) return undefined;
  return {
    quantity: sumDecimals(values.map((value) => decimal(value!.quantity))),
    gross: sumDecimals(values.map((value) => decimal(value!.gross))),
  };
}

async function refundValues(
  tx: Transaction,
  billId: string,
  saleId: string,
  lineIds: readonly string[],
): Promise<({ quantity: string; gross: string } | undefined)[]> {
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
  const bindings = await readPortionBindings(
    tx,
    stored.filter((row) => row.parentLineId === null).map((row) => row.id),
  );
  const links =
    bindings.size === 0
      ? []
      : await tx
          .select({
            saleLineId: saleLinePortions.saleLineId,
            portionId: saleLinePortions.portionId,
          })
          .from(saleLinePortions)
          .innerJoin(saleLines, eq(saleLines.id, saleLinePortions.saleLineId))
          .where(eq(saleLines.saleId, saleId));
  return lineIds.map((lineId) => {
    const parent = stored.find((row) => row.id === lineId && row.parentLineId === null);
    if (parent === undefined) return undefined;
    if (bindings.size === 0) return byPosition(stored, filed, lineId);
    const binding = bindings.get(lineId);
    if (binding === undefined) {
      const linked = new Set(links.map((link) => link.saleLineId));
      const bound = (row: Stored) => bindings.has(row.parentLineId ?? row.id);
      return byPosition(
        stored.filter((row) => !bound(row)),
        filed.filter((row) => !linked.has(row.id)),
        lineId,
      );
    }
    return byPortion(
      filed,
      links,
      binding.portionId,
      stored.filter((row) => row.id === lineId || row.parentLineId === lineId),
    );
  });
}

/** Unbound lines, each paired by position with a filed row no portion is linked to. */
function byPosition(
  stored: readonly Stored[],
  filed: readonly Filed[],
  lineId: string,
): { quantity: string; gross: string } | undefined {
  if (
    stored.length !== filed.length ||
    stored.some((row, i) => {
      const frozen = filed[i]!;
      const parent = stored.findIndex((candidate) => candidate.id === row.parentLineId);
      return (
        frozen.quantity !== row.quantity ||
        frozen.parentLineId !== (parent === -1 ? null : filed[parent]!.id)
      );
    })
  )
    return undefined;
  let gross = decimal("0.00");
  let quantity = 0;
  for (const [i, row] of stored.entries()) {
    if (row.id === lineId) quantity = row.quantity;
    if (row.id !== lineId && row.parentLineId !== lineId) continue;
    const amount = filed[i]!.lineGross;
    if (amount === null) return undefined;
    gross = addDecimal(gross, centsToDecimal(amount));
  }
  return { quantity: thousandthsToDecimal(quantity), gross };
}

/**
 * One portion's share of each filed row linked to it: its dish row and its extras' rows, which must
 * match its stored dish line and extras.
 */
function byPortion(
  filed: readonly Filed[],
  links: readonly { saleLineId: string; portionId: string }[],
  portionId: string,
  family: readonly Stored[],
): { quantity: string; gross: string } | undefined {
  const count = new Map<string, number>();
  const mine = new Set<string>();
  for (const link of links) {
    count.set(link.saleLineId, (count.get(link.saleLineId) ?? 0) + 1);
    if (link.portionId === portionId) mine.add(link.saleLineId);
  }
  const rows = filed.filter((row) => mine.has(row.id));
  const dish = rows.find((row) => row.parentLineId === null);
  let gross = decimal("0.00");
  let quantity = 0;
  const shares: string[] = [];
  for (const row of rows) {
    const portions = count.get(row.id)!;
    const shareQuantity = row.quantity / portions;
    const shareGross = row.lineGross === null ? null : row.lineGross / portions;
    if (shareGross === null || !Number.isInteger(shareGross)) return undefined;
    if (row === dish) quantity = shareQuantity;
    shares.push(`${row === dish}:${shareQuantity}`);
    gross = addDecimal(gross, centsToDecimal(shareGross));
  }
  const kept = family.map((row) => `${row.parentLineId === null}:${row.quantity}`);
  if (shares.sort().join() !== kept.sort().join()) return undefined;
  return { quantity: thousandthsToDecimal(quantity), gross };
}
