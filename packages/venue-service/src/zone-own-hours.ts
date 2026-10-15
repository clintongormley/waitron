import type { ClosedRange, ServiceRange } from "./service-day.js";

export interface ZoneOwnHours {
  /** The department's ranges less the zone's closures, each piece keeping its period. */
  ranges: ServiceRange[];
  /** The zone's closures cut to the times its department is open, in day order. */
  closed: ClosedRange[];
}

interface Piece {
  start: number;
  end: number;
  startsAt: string;
  endsAt: string;
}

const DAY = 1440;

// Placed as the Month view places a bar, so its pieces line up with what it draws.
function placer({ dayCutover, endMinute }: { dayCutover: string; endMinute: number }) {
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
  const place = placer(day);
  const closed = closures.map(place).filter((closure) => closure.start < closure.end);
  const ranges: ServiceRange[] = [];
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
    ranges.push(
      ...pieces.map(({ startsAt, endsAt }) => ({ periodId: range.periodId, startsAt, endsAt })),
    );
  }
  return {
    ranges,
    closed: cut
      .sort((a, b) => a.start - b.start)
      .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  };
}
