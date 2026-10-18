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

/** Places a range on the business day, which runs `endMinute` minutes from its changeover. The start
 *  is read within the first 24 hours, so on a 25-hour day a range written 06:00–07:00 lands at the
 *  day's start, not its end; an end at or before the start falls a day later; and an end past the
 *  day's is cut to it. */
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

/** The part of `closure` inside `range`; each end keeps the clock time of whichever cut it. */
function overlap(range: Piece, closure: Piece): Piece {
  return {
    start: Math.max(range.start, closure.start),
    end: Math.min(range.end, closure.end),
    startsAt: closure.start > range.start ? closure.startsAt : range.startsAt,
    endsAt: closure.end < range.end ? closure.endsAt : range.endsAt,
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
        cut.push(overlap(piece, closure));
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

/** The pieces joined where they touch or overlap, in day order. */
function joined(pieces: readonly Piece[]): Piece[] {
  const spans: Piece[] = [];
  for (const piece of [...pieces].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && piece.start <= last.end) {
      if (piece.end > last.end) {
        last.end = piece.end;
        last.endsAt = piece.endsAt;
      }
    } else spans.push({ ...piece });
  }
  return spans;
}

/** The index of the first closure not wholly inside the department's ranges, or -1. */
export function closureOutsideHours(
  department: readonly ClosedRange[],
  closures: readonly ClosedRange[],
  day: { dayCutover: string; endMinute: number },
): number {
  const place = placeOnDay(day);
  const spans = joined(department.map(place));
  return closures.findIndex((closure) => {
    const { start, end } = place(closure);
    return !spans.some((span) => span.start <= start && end <= span.end);
  });
}

/** The closures cut to the department's ranges: what lies outside is dropped, and pieces that
 *  touch join. In day order. */
export function closuresInHours(
  department: readonly ClosedRange[],
  closures: readonly ClosedRange[],
  day: { dayCutover: string; endMinute: number },
): ClosedRange[] {
  const place = placeOnDay(day);
  const spans = joined(department.map(place));
  const pieces: Piece[] = [];
  for (const closure of closures.map(place)) {
    for (const span of spans) {
      if (closure.end <= span.start || closure.start >= span.end) continue;
      pieces.push(overlap(span, closure));
    }
  }
  return joined(pieces).map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
}
