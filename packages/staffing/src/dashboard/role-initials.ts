const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const letters = (word: string) => [...graphemes.segment(word)].map(({ segment }) => segment);

/** What a staff role's block shows for its name: the first letters of its first and last words,
 *  or a one-word name's first two letters. Two roles can share them. */
export function roleInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    const [first, second = ""] = letters(words[0]!);
    return first!.toLocaleUpperCase() + second;
  }
  return [words[0]!, words.at(-1)!].map((word) => letters(word)[0]!.toLocaleUpperCase()).join("");
}
