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

/** Sets the given printing choices on every station, or only on `stationIds`. */
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
  await (stationIds === undefined
    ? update
    : update.where(inArray(kitchenStations.id, [...stationIds])));
  if (stationIds !== undefined) return;
  // Writes the venue's value too until A756 PR 6 Task 38.
  if (set.printHeldWork !== undefined) await writePrintHeldWork(tx, set.printHeldWork);
  if (set.ticketGrouping !== undefined) await writeKitchenTicketGrouping(tx, set.ticketGrouping);
  if (set.printMovedSlips !== undefined) await writePrintMovedSlips(tx, set.printMovedSlips);
}
