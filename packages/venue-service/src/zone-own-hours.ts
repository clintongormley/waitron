// Browser-safe: the dashboard's Month loads this, so it imports types only.
import type { ClosedRange, ServiceRange } from "./service-day.js";

/** Where a range falls on its business day, in minutes after the day's changeover. */
export interface Placed {
  start: number;
  end: number;
}

export interface ZoneOwnHours {
  /** The department's ranges less the zone's closures, each piece keeping its period. */
  ranges: (ServiceRange & Placed)[];
  /** The zone's closures cut to the times its department is open, in day order. */
  closed: (ClosedRange & Placed)[];
}

type Piece = ClosedRange & Placed;

const DAY = 1440;

/** Places a range on the business day, which runs from its changeover to the next day's, `endMinute`
 *  long; a time at or before the start is on the clock's next day, and an end past the day's is cut
 *  to it. */
export function placeOnDay({ dayCutover, endMinute }: { dayCutover: string; endMinute: number }) {
  const clock = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const cutover = clock(dayCutover);
  const minute = (time: string) => (clock(time) - cutover + DAY) % DAY;
  return ({ startsAt, endsAt }: ClosedRange): Piece => {
    const start = minute(startsAt);
    const end = minute(endsAt) + (minute(endsAt) <= start ? DAY : 0);
    return { start, end: Math.min(end, endMinute), startsAt, endsAt };
  };
}

export function zoneOwnHours(
  department: readonly ServiceRange[],
  closures: readonly ClosedRange[],
  day: { dayCutover: string; endMinute: number },
): ZoneOwnHours {
  const place = placeOnDay(day);
  const closed = closures.map(place);
  const ranges: ZoneOwnHours["ranges"] = [];
  const cut: Piece[] = [];
  for (const range of department) {
    let pieces = [place(range)];
    for (const closure of closed) {
      pieces = pieces.flatMap((piece) => {
        if (closure.end <= piece.start || closure.start >= piece.end) return [piece];
        const inner = {
          start: Math.max(piece.start, closure.start),
          end: Math.min(piece.end, closure.end),
          startsAt: closure.start > piece.start ? closure.startsAt : piece.startsAt,
          endsAt: closure.end < piece.end ? closure.endsAt : piece.endsAt,
        };
        cut.push(inner);
        return [
          ...(closure.start > piece.start
            ? [{ ...piece, end: closure.start, endsAt: closure.startsAt }]
            : []),
          ...(closure.end < piece.end
            ? [{ ...piece, start: closure.end, startsAt: closure.endsAt }]
            : []),
        ];
      });
    }
    ranges.push(...pieces.map((piece) => ({ periodId: range.periodId, ...piece })));
  }
  return {
    ranges,
    closed: cut.sort((a, b) => a.start - b.start),
  };
}
