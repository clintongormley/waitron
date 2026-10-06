import { businessDayStart, civilDateOf as civilDate, venueMomentAt } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import type { VenueClockPreview, VenueClockView } from "./venue-detail-types.js";
import "./errors.js";

type Clock = { timeZone: string; dayCutover: string };
const DAY = 86400000;
function view(at: Date, clock: Clock): VenueClockView | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(clock.dayCutover)) return null;
  const moment = venueMomentAt(at, clock);
  if (!moment) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: clock.timeZone,
    timeZoneName: "longOffset",
  });
  const offset = (ms: number) =>
    formatter.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")!.value;
  const transitions: VenueClockView["transitions"] = [];
  let previousAt = at.getTime();
  let previousOffset = offset(previousAt);
  // Preview searches the next 400 days; fixed-offset zones have no entries.
  for (let day = 1; day <= 400 && transitions.length < 2; day++) {
    const nextAt = at.getTime() + day * DAY;
    const nextOffset = offset(nextAt);
    if (nextOffset !== previousOffset) {
      let low = previousAt,
        high = nextAt;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offset(middle) === previousOffset) low = middle;
        else high = middle;
      }
      const changeAt = new Date(high);
      const date = civilDate(changeAt, clock.timeZone);
      let afterDay = high;
      while (civilDate(new Date(afterDay), clock.timeZone) === date) afterDay += 3600000;
      // Use the last instant of this civil date, even for a late cutover.
      let endLow = afterDay - 3600000,
        endHigh = afterDay;
      while (endHigh - endLow > 1) {
        const middle = Math.floor((endLow + endHigh) / 2);
        if (civilDate(new Date(middle), clock.timeZone) === date) endLow = middle;
        else endHigh = middle;
      }
      const resolved = businessDayStart(new Date(endLow), clock);
      transitions.push({
        at: changeAt.toISOString(),
        civilDate: date,
        boundaryAt: resolved,
        boundaryTime: venueMomentAt(new Date(resolved), clock)!.timeOfDay,
      });
    }
    previousAt = nextAt;
    previousOffset = nextOffset;
  }
  return {
    timeZone: clock.timeZone,
    dayCutover: clock.dayCutover.slice(0, 5),
    civilDate: civilDate(at, clock.timeZone),
    timeOfDay: moment.timeOfDay,
    businessDay: moment.businessDay,
    transitions,
  };
}
export function venueClockPreview(
  at: Date,
  current: Clock,
  proposed: Clock,
  backupDeadlines: VenueClockPreview["backupDeadlines"],
): VenueClockPreview {
  let timeZone: string;
  try {
    timeZone = new Intl.DateTimeFormat("en-GB", { timeZone: proposed.timeZone }).resolvedOptions()
      .timeZone;
    if (/^[+-]/.test(timeZone)) throw new Error();
  } catch {
    throw new AppError("venue.detail_invalid", { field: "timeZone", reason: "time_zone" });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(proposed.dayCutover))
    throw new AppError("venue.detail_invalid", { field: "dayCutover", reason: "cutover" });
  const candidate = { timeZone, dayCutover: proposed.dayCutover.slice(0, 5) };
  return {
    at: at.toISOString(),
    current: view(at, current),
    proposed: view(at, candidate)!,
    backupDeadlines,
  };
}
