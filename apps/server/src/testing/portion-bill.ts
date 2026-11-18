import { randomUUID } from "node:crypto";
import type { Transaction } from "@waitron/db";
import { expandPortionRows } from "../order-portions.js";
import type { OriginConfig } from "../trading-context.js";

import {
  bumpRevision,
  fireLines,
  insertTabRound,
  priceTabRound,
  type PricedTabRound,
  type TabRoundLine,
} from "../working-order.js";
import { createTable } from "./live-table.js";
import { openPartyTab } from "./serve-line.js";

export interface PortionRef {
  lineId: string;
  ordinal: number;
  pricingCohortId: string;
  measured: boolean;
}

export function portionRefsOf(rows: readonly PricedTabRound["rows"][number][]): PortionRef[] {
  return rows.flatMap((row) =>
    row.cohortId == null
      ? []
      : [
          {
            lineId: row.id!,
            ordinal: row.cohortOrdinal!,
            pricingCohortId: row.cohortId,
            measured: row.wholePortion === false,
          },
        ],
  );
}

/** A round written onto an open bill as portions: priced once, one dish per line, bound. With
 * `fire`, every line is fired, none held. */
export async function addPortionRound(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  lines: TabRoundLine[],
  opts: { fire?: boolean; measureDishes?: true } = {},
): Promise<PortionRef[]> {
  const round = await priceTabRound(tx, cfg, billId, lines, "checked");
  const out = expandPortionRows(
    round.rows,
    round.lineContexts,
    round.portionable,
    round.rows[0]!.lineNo,
  );
  const rows = opts.measureDishes
    ? out.rows.map((row) => (row.parentLineId == null ? { ...row, wholePortion: false } : row))
    : out.rows;
  const inserted = await insertTabRound(
    tx,
    cfg,
    { ...round, lineContexts: out.lineContexts },
    rows,
  );
  if (opts.fire === true) {
    await fireLines(tx, cfg, billId, inserted);
    await bumpRevision(tx, [billId]);
  }
  return portionRefsOf(rows);
}

/** A fresh party's bill at a fresh table in `zoneId`, holding `lines` as portions. */
export async function portionBill(
  tx: Transaction,
  cfg: OriginConfig,
  zoneId: string,
  lines: TabRoundLine[],
  opts?: { measureDishes?: true },
): Promise<{ billId: string; portions: PortionRef[] }> {
  const table = await createTable(tx, cfg, { label: `P-${randomUUID().slice(0, 8)}`, zoneId });
  const { tabId } = await openPartyTab(tx, cfg, { tableId: table.id });
  return { billId: tabId, portions: await addPortionRound(tx, cfg, tabId, lines, opts) };
}

export const unboundLineCohort = { cohortId: null, cohortOrdinal: null, wholePortion: null };

export async function addFixtureExtra(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  parentLineId: string,
  menuItemId: string,
  fire = false,
): Promise<string> {
  const round = await priceTabRound(tx, cfg, billId, [{ menuItemId, quantity: "1" }], "checked");
  const [row] = await insertTabRound(tx, cfg, round, [{ ...round.rows[0]!, parentLineId }]);
  if (fire) await fireLines(tx, cfg, billId, [row!]);
  return row!.id;
}
