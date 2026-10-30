import { randomUUID } from "node:crypto";
import type { Transaction } from "@waitron/db";
import type { OriginConfig } from "../trading-context.js";
import { insertTabRound, priceTabRound } from "../working-order.js";
import { createTable } from "./live-table.js";
import { fireAll, openPartyTab } from "./serve-line.js";
import { offerProducts } from "./zone-offers.js";
import type { ProductLine } from "./split-extras-venue.js";

export async function createTableKitchenOrder(
  tx: Transaction,
  cfg: OriginConfig,
  lines: ProductLine[] = [],
): Promise<string> {
  const offers = await offerProducts(tx, cfg, { zone: "tables" });
  const table = await createTable(tx, cfg, {
    label: `Kitchen ${randomUUID()}`,
    zoneId: offers.zoneId,
  });
  const { tabId } = await openPartyTab(tx, cfg, { tableId: table.id });
  if (lines.length > 0) {
    const round = await priceTabRound(tx, cfg, tabId, offers.toOfferLines(lines), "checked");
    await insertTabRound(tx, cfg, round, round.rows);
  }
  return tabId;
}

export async function fireTableKitchenOrder(
  tx: Transaction,
  cfg: OriginConfig,
  lines: ProductLine[],
): Promise<string> {
  const id = await createTableKitchenOrder(tx, cfg, lines);
  await fireAll(tx, cfg, id);
  return id;
}
