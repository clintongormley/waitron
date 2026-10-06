// Test support: seeds a station's standard week from a list of weekly intervals.
import { randomUUID } from "node:crypto";
import type { Transaction } from "@waitron/db";
import { replaceWeekHours } from "../hours.js";
import type { WeekCell, WeekDay } from "../hours-types.js";
import type { VenueScope } from "../operations.js";
import type { WeeklyInterval } from "../routing.js";

const DAY = 24 * 60;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total: number) =>
  `${String(Math.floor((total % DAY) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/**
 * The configured week open exactly when `intervals` are: each weekday's intervals as periods, with
 * overlapping ones joined, and every other day Closed. No intervals gives a week with no hours set.
 */
export function weekFromIntervals(intervals: readonly WeeklyInterval[]): WeekDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday): WeekDay => {
    if (intervals.length === 0) return { weekday, cell: { mode: "not_set", periods: [] } };
    const spans = intervals
      .filter((interval) => interval.weekday === weekday)
      .map(({ opensAt, closesAt }) => {
        const start = minutes(opensAt);
        const end = minutes(closesAt);
        return { start, end: end > start ? end : end + DAY };
      })
      .sort((a, b) => a.start - b.start);
    const joined: { start: number; end: number }[] = [];
    for (const span of spans) {
      const last = joined.at(-1);
      if (last !== undefined && span.start < last.end) last.end = Math.max(last.end, span.end);
      else joined.push({ ...span });
    }
    const cell: WeekCell =
      joined.length === 0
        ? { mode: "closed", periods: [] }
        : {
            mode: "periods",
            periods: joined.map(({ start, end }) => ({
              id: randomUUID(),
              opensAt: clock(start),
              closesAt: clock(end),
            })),
          };
    return { weekday, cell };
  });
}

/** Saves `intervals` as the station's standard week. */
export async function seedStationWeek(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  intervals: readonly WeeklyInterval[],
  at = new Date("2026-01-01T00:00:00Z"),
): Promise<void> {
  await replaceWeekHours(
    tx,
    cfg,
    { kind: "station", id: stationId },
    weekFromIntervals(intervals),
    at,
  );
}
