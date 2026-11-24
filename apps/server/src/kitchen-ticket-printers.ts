import {
  type Transaction,
  stationPrinterPairs,
  receiptRollColumns,
  printers,
  isReceiptPrinter,
} from "@waitron/db";
import type { PaperWidth, Resolution, EscSetting } from "@waitron/printing";
import { and, eq, inArray, isNull } from "drizzle-orm";

export interface PrinterMapping {
  stationId: string;
  printerId: string;
  paperWidth: PaperWidth;
  resolution: Resolution;
}
/**
 * The station→printer mappings for `stationIds`, ACTIVE printers only unless `switchedOffToo`, which
 * adds switched-off printers but never a deleted one. The fire and correction paths both resolve
 * printers here without it, so the header's never-block argument covers both.
 */
export async function printerMappings(
  tx: Transaction,
  stationIds: string[],
  { switchedOffToo = false }: { switchedOffToo?: boolean } = {},
): Promise<PrinterMapping[]> {
  return tx
    .select({
      stationId: stationPrinterPairs.stationId,
      printerId: stationPrinterPairs.printerId,
      ...receiptRollColumns,
    })
    .from(stationPrinterPairs)
    .innerJoin(printers, and(isReceiptPrinter(), eq(stationPrinterPairs.printerId, printers.id)))
    .where(
      and(
        inArray(stationPrinterPairs.stationId, stationIds),
        switchedOffToo ? isNull(printers.deletedAt) : eq(printers.active, true),
      ),
    );
}
/** `printers` grouped by paper width and resolution, in first-seen order: one ticket per group. */
export function groupByLayout<T extends EscSetting>(printers: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const printer of printers) {
    const key = `${printer.paperWidth}|${printer.resolution}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [printer]);
    else group.push(printer);
  }
  return [...groups.values()];
}
