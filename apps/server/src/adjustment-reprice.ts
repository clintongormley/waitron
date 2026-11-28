import { eq, inArray, sql } from "drizzle-orm";
import { lineGross, type PricedRow } from "@waitron/adjustments";
import { workingOrderLines, type AdjustmentSplit, type Transaction } from "@waitron/db";
import {
  compareDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  subtractDecimal,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import type { Row } from "./adjustment-rows.js";
import type { TradingContext } from "./trading-context.js";
import { splitLinesWithinOrder, type SplitRow } from "./working-order-transfer.js";

const ZERO = decimal("0");

/** New prices for one row, or for the part of it split off with the part of its dish covered when
 * `carved`; a second row in `rows` is split off that one in turn. */
export interface Change {
  row: Row;
  carved: boolean;
  rows: PricedRow[];
  reduction: Decimal;
}

/** The part of a dish a comp or a discount covers, split off with its extras before the prices
 * change. */
export interface Carve {
  lineNo: number;
  quantity: number;
}

async function setPrice(
  tx: Transaction,
  lineId: string,
  row: PricedRow,
  priceQuantity: number,
): Promise<void> {
  await tx
    .update(workingOrderLines)
    .set({
      unitPriceGross: decimalToCents(row.unitGross),
      lineTotal: decimalToCents(
        divideDecimal(
          multiplyDecimal(row.unitGross, row.quantity),
          thousandthsToDecimal(priceQuantity),
          MONEY_SCALE,
        ),
      ),
    })
    .where(eq(workingOrderLines.id, lineId));
}

/**
 * Writes the plan's new prices, first splitting the part `carve` covers off its dish, with its
 * extras, when a change is to that part; answers each row it split off, with the row it came from,
 * a carved dish before its extras, and the line number of each by its id, and what each change
 * took off each line it lowered.
 */
export async function reprice(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  carve: Carve | null,
  changes: readonly Change[],
  stamped: readonly string[],
): Promise<{ splits: AdjustmentSplit[]; lineNoOf: Map<string, number>; taken: LineReduction[] }> {
  const touched = [...new Set([...changes.map(({ row }) => row.id), ...stamped])];
  // Before any split, so a split row copies the price its line had (plan D21).
  await tx
    .update(workingOrderLines)
    .set({
      listUnitPriceGross: sql`coalesce(${workingOrderLines.listUnitPriceGross}, ${workingOrderLines.unitPriceGross})`,
    })
    .where(inArray(workingOrderLines.id, touched));
  const carved = changes.some((change) => change.carved)
    ? await splitLinesWithinOrder(
        tx,
        cfg,
        orderId,
        [{ lineNo: carve!.lineNo, quantity: thousandthsToDecimal(carve!.quantity) }],
        { splitExtras: true },
      )
    : new Map<string, SplitRow>();
  const splits: AdjustmentSplit[] = [...carved].map(([from, to]) => ({ from, to: to.id }));
  const lineNoOf = new Map([...carved.values()].map(({ id, lineNo }) => [id, lineNo]));
  const subjects = changes.map((change) => {
    const { id, lineNo } = change.carved ? carved.get(change.row.id)! : change.row;
    return { id, lineNo, change };
  });
  const twoRows = subjects.filter(({ change }) => change.rows.length === 2);
  const seconds =
    twoRows.length === 0
      ? new Map<string, SplitRow>()
      : await splitLinesWithinOrder(
          tx,
          cfg,
          orderId,
          twoRows.map(({ lineNo, change }) => ({ lineNo, quantity: change.rows[1]!.quantity })),
        );
  const taken: LineReduction[] = [];
  for (const { id, change } of subjects) {
    const [first, lower] = change.rows;
    await setPrice(tx, id, first!, change.row.priceQuantity);
    const second = seconds.get(id);
    let firstReduction = change.reduction;
    if (second !== undefined) {
      splits.push({ from: id, to: second.id });
      lineNoOf.set(second.id, second.lineNo);
      await setPrice(tx, second.id, lower!, change.row.priceQuantity);
      const quantity = decimalToThousandths(lower!.quantity);
      const reduction = subtractDecimal(
        lineGross(change.row, quantity),
        lineGross(change.row, quantity, decimalToCents(lower!.unitGross)),
      );
      firstReduction = subtractDecimal(change.reduction, reduction);
      taken.push({ lineId: second.id, reduction, quantity });
    }
    taken.push({
      lineId: id,
      reduction: firstReduction,
      quantity: decimalToThousandths(first!.quantity),
    });
  }
  return {
    splits,
    lineNoOf,
    taken: taken.filter(({ reduction }) => compareDecimal(reduction, ZERO) !== 0),
  };
}

/** What a comp or a discount took off one line, `quantity` of it then (plan D37). */
export interface LineReduction {
  lineId: string;
  reduction: Decimal;
  quantity: number;
}
