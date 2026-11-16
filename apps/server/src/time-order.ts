import { byText } from "./text-order.js";

/** Compares stored times as moments rather than as text, and returns the winner exactly as
 *  stored. A time that does not parse never wins over one that does. Two spellings of one moment,
 *  or two times that do not parse, are decided by text: the smaller for the earliest. */
export function earliestTime(times: readonly string[]): string | undefined {
  return pick(times, -1);
}

/** As `earliestTime`, for the latest; a text tie goes to the larger. */
export function latestTime(times: readonly string[]): string | undefined {
  return pick(times, 1);
}

function pick(times: readonly string[], direction: 1 | -1): string | undefined {
  let best: string | undefined;
  for (const time of times) {
    if (best === undefined || beats(time, best, direction)) best = time;
  }
  return best;
}

function beats(time: string, best: string, direction: 1 | -1): boolean {
  const [at, bestAt] = [Date.parse(time), Date.parse(best)];
  const [bad, bestBad] = [Number.isNaN(at), Number.isNaN(bestAt)];
  if (bad !== bestBad) return bestBad;
  const order = bad || at === bestAt ? byText(time, best) : at - bestAt;
  return direction * order > 0;
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
