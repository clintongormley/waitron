import type { HoursOpenShift } from "./attendance-contract.js";
import { compareEvents } from "./effective-entries.js";
import type { TimeEntryRecord } from "./projection.js";

export function openShiftsFor(entries: readonly TimeEntryRecord[]): HoursOpenShift[] {
  let open: HoursOpenShift | undefined;
  for (const entry of entries) {
    switch (entry.entryKind) {
      case "in":
        open = { start: entry, breakStart: null };
        break;
      case "out":
        open = undefined;
        break;
      case "break_start":
        if (open) open.breakStart = entry;
        break;
      case "break_end":
        if (open) open.breakStart = null;
        break;
    }
  }
  return open === undefined ? [] : [open];
}
export function entriesFromOpenShift(
  entries: readonly TimeEntryRecord[],
  { start }: HoursOpenShift,
): TimeEntryRecord[] {
  return entries.filter((entry) => compareEvents(entry, start) >= 0);
}
