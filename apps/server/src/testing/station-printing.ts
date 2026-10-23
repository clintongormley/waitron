import { kitchenStations, type Transaction } from "@waitron/db";
import type { TicketGrouping } from "@waitron/shared";
import {
  writeKitchenTicketGrouping,
  writePrintHeldWork,
  writePrintMovedSlips,
} from "@waitron/venue-service";
import { inArray } from "drizzle-orm";

export interface StationPrintingChoices {
  printHeldWork?: boolean;
  ticketGrouping?: TicketGrouping;
  printMovedSlips?: boolean;
}

export async function setStationPrinting(
  tx: Transaction,
  choices: StationPrintingChoices,
  stationIds?: readonly string[],
): Promise<void> {
  const set: StationPrintingChoices = {};
  if (choices.printHeldWork !== undefined) set.printHeldWork = choices.printHeldWork;
  if (choices.ticketGrouping !== undefined) set.ticketGrouping = choices.ticketGrouping;
  if (choices.printMovedSlips !== undefined) set.printMovedSlips = choices.printMovedSlips;
  if (Object.keys(set).length === 0) return;
  const update = tx.update(kitchenStations).set(set);
  if (stationIds !== undefined) {
    const updated = await update
      .where(inArray(kitchenStations.id, [...stationIds]))
      .returning({ id: kitchenStations.id });
    if (updated.length !== stationIds.length)
      throw new Error(
        `setStationPrinting: ${stationIds.length - updated.length} id(s) match no station`,
      );
    return;
  }
  await update;
  // Writes the venue's value too until A756 PR 6 Task 38.
  if (set.printHeldWork !== undefined) await writePrintHeldWork(tx, set.printHeldWork);
  if (set.ticketGrouping !== undefined) await writeKitchenTicketGrouping(tx, set.ticketGrouping);
  if (set.printMovedSlips !== undefined) await writePrintMovedSlips(tx, set.printMovedSlips);
}
