import type { Transaction } from "@waitron/db";
import type { OriginConfig, TradingContext } from "../trading-context.js";
import {
  createOpenOrder,
  insertTabRound,
  priceTabRound,
  type TabRoundLine,
} from "../working-order.js";

/**
 * Append `lines` to an open order with each line stored once, as a counter order written before
 * portions holds them; for the partial-quantity paths slice 1's D12 keeps. Nothing is fired.
 */
export async function writeGroupedLines(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  lines: TabRoundLine[],
  creditedTo: string | null = null,
): Promise<void> {
  const round = await priceTabRound(tx, cfg, orderId, lines, "checked");
  await insertTabRound(
    tx,
    cfg,
    round,
    round.rows.map((row) => ({ ...row, creditedTo })),
  );
}

/** Grouped, as a counter order written before portions; for the partial-quantity paths slice 1's D12 keeps. */
export async function openGroupedCounterOrder(
  tx: Transaction,
  cfg: OriginConfig,
  id: string,
  lines: TabRoundLine[],
  placement: Pick<
    NonNullable<Parameters<typeof createOpenOrder>[5]>,
    "zoneId" | "partyId" | "creditedTo"
  > = {},
): Promise<{ orderNumber: number }> {
  const { orderNumber } = await createOpenOrder(tx, cfg, id, [], null, placement);
  if (lines.length > 0) await writeGroupedLines(tx, cfg, id, lines, placement.creditedTo ?? null);
  return { orderNumber };
}
