export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const WORD = "[\\p{L}\\p{N}]";

/** A word holds only letters and digits, so it needs no escaping inside a pattern. */
function wordPattern(word: string, whole: boolean): RegExp {
  return new RegExp(`(?<!${WORD})${word}${whole ? `(?!${WORD})` : ""}`, "u");
}

export interface SearchRank {
  /** 0 a whole word, 1 the start of a word, 2 inside a word. */
  readonly kind: 0 | 1 | 2;
  /** The part the last word was best found in. */
  readonly part: number;
  /** Where in that part. */
  readonly position: number;
  /** The total length of all the parts. */
  readonly length: number;
}

export interface TextSearch {
  /** `parts` are already folded. Undefined when they do not match. */
  rank(parts: string | readonly string[]): SearchRank | undefined;
}

export function compareSearchRanks(left: SearchRank, right: SearchRank): number {
  return (
    left.kind - right.kind ||
    left.part - right.part ||
    left.position - right.position ||
    left.length - right.length
  );
}

const cap = (value: number, limit: number) => Math.min(value, limit - 1);

/** Kind, part (under 1000), position and length (each under 1,000,000) packed below 2^53, so one
 * non-negative safe integer sorts as `compareSearchRanks` does. */
export function searchRankKey(rank: SearchRank): number {
  return (
    rank.kind * 1e15 +
    cap(rank.part, 1000) * 1e12 +
    cap(rank.position, 1_000_000) * 1e6 +
    cap(rank.length, 1_000_000)
  );
}

/** A text matches when it holds every word of the query, in any order. A word followed by anything
 * but a letter or digit must be a whole word; the word still being typed may be any part of one.
 * The last word orders the matches. A query that is not blank but has no words matches nothing.
 * Undefined for a blank query: no search at all. */
export function textSearch(query: string): TextSearch | undefined {
  if (query.trim() === "") return undefined;
  const folded = foldForSearch(query);
  const words = folded.match(new RegExp(`${WORD}+`, "gu"));
  if (words === null) return { rank: () => undefined };
  // A global match is null or holds at least one word.
  const last = words.at(-1)!;
  // A word still being typed need not be whole, so it leaves the words that must be.
  if (new RegExp(`${WORD}$`, "u").test(folded)) words.pop();
  const whole = words.map((word) => wordPattern(word, true));
  const wholeLast = wordPattern(last, true);
  const startLast = wordPattern(last, false);
  const partRank = (text: string, part: number, length: number): SearchRank | undefined => {
    const atWhole = wholeLast.exec(text);
    if (atWhole !== null) return { kind: 0, part, position: atWhole.index, length };
    const atStart = startLast.exec(text);
    if (atStart !== null) return { kind: 1, part, position: atStart.index, length };
    const inside = text.indexOf(last);
    return inside === -1 ? undefined : { kind: 2, part, position: inside, length };
  };
  return {
    rank(given) {
      const parts = typeof given === "string" ? [given] : given;
      if (!whole.every((pattern) => parts.some((text) => pattern.test(text)))) return undefined;
      const length = parts.reduce((sum, text) => sum + text.length, 0);
      let best: SearchRank | undefined;
      parts.forEach((text, part) => {
        const found = partRank(text, part, length);
        if (found !== undefined && (best === undefined || compareSearchRanks(found, best) < 0))
          best = found;
      });
      return best;
    },
  };
}

export type NameSearch = <T>(named: readonly (readonly [T, string | readonly string[]])[]) => T[];

/** Blank query: every value, in the order given. Otherwise the matches in rank order, ties in the
 * order given. */
export function searchFor(query: string): NameSearch {
  const search = textSearch(query);
  if (search === undefined) return (named) => named.map(([value]) => value);
  return (named) =>
    named
      .flatMap(([value, text]) => {
        const rank = search.rank(text);
        return rank === undefined ? [] : [{ value, rank }];
      })
      .sort((left, right) => compareSearchRanks(left.rank, right.rank))
      .map(({ value }) => value);
}
