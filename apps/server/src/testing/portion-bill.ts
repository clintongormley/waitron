import { randomUUID } from "node:crypto";
import type { Transaction } from "@waitron/db";
import { expandPortionRows, registerPortions, type PortionRef } from "../order-portions.js";
import type { OriginConfig } from "../trading-context.js";
import {
  bumpRevision,
  fireLines,
  insertTabRound,
  priceTabRound,
  type TabRoundLine,
} from "../working-order.js";
import { createTable } from "./live-table.js";
import { openPartyTab } from "./serve-line.js";

/** A round written onto an open bill as portions: priced once, one dish per line, bound. With
 * `fire`, every line is fired, none held. */
export async function addPortionRound(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  lines: TabRoundLine[],
  opts: { fire?: boolean } = {},
): Promise<PortionRef[]> {
  const round = await priceTabRound(tx, cfg, billId, lines, "checked");
  const out = expandPortionRows(
    round.rows,
    round.lineContexts,
    round.portionable,
    round.rows[0]!.lineNo,
  );
  const inserted = await insertTabRound(
    tx,
    cfg,
    { ...round, lineContexts: out.lineContexts },
    out.rows,
  );
  await registerPortions(tx, out.portions);
  if (opts.fire === true) {
    await fireLines(tx, cfg, billId, inserted);
    await bumpRevision(tx, [billId]);
  }
  return out.portions;
}

/** A fresh party's bill at a fresh table in `zoneId`, holding `lines` as portions. */
export async function portionBill(
  tx: Transaction,
  cfg: OriginConfig,
  zoneId: string,
  lines: TabRoundLine[],
): Promise<{ billId: string; portions: PortionRef[] }> {
  const table = await createTable(tx, cfg, { label: `P-${randomUUID().slice(0, 8)}`, zoneId });
  const { tabId } = await openPartyTab(tx, cfg, { tableId: table.id });
  return { billId: tabId, portions: await addPortionRound(tx, cfg, tabId, lines) };
}
