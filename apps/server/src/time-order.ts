import { byText } from "./text-order.js";

/** Compares stored times as moments rather than as text, and returns the winner exactly as
 *  stored. A time that does not parse never wins over one that does; with none parsing, the first
 *  wins. */
export function earliestTime(times: readonly string[]): string | undefined {
  return pick(times, (at, best) => at < best);
}

/** As `earliestTime`, for the latest. */
export function latestTime(times: readonly string[]): string | undefined {
  return pick(times, (at, best) => at > best);
}

function pick(
  times: readonly string[],
  beats: (at: number, best: number) => boolean,
): string | undefined {
  let best: string | undefined;
  let bestAt = Number.NaN;
  for (const time of times) {
    const at = Date.parse(time);
    if (best === undefined || (!Number.isNaN(at) && (Number.isNaN(bestAt) || beats(at, bestAt)))) {
      best = time;
      bestAt = at;
    }
  }
  return best;
}

/** Orders stored times as moments: no time first, then parseable times by moment, then times that
 *  do not parse, in text order. Two spellings of one moment compare equal. */
export function byMoment(a: string | null, b: string | null): number {
  if (a === null || b === null) return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  const [atA, atB] = [Date.parse(a), Date.parse(b)];
  const [badA, badB] = [Number.isNaN(atA), Number.isNaN(atB)];
  if (badA || badB) return badA && badB ? byText(a, b) : badA ? 1 : -1;
  return atA - atB;
}
