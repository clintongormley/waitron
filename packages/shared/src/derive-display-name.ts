/**
 * The display name a form should hold after a first/last-name change: regenerated from the new
 * names when `current` is blank or still equals the name generated from the previous ones;
 * otherwise the person has customised it, and it is kept.
 */
export function deriveDisplayName(
  current: string,
  prevFirst: string,
  prevLast: string,
  nextFirst: string,
  nextLast: string,
): string {
  const combine = (first: string, last: string): string =>
    [first, last]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
  const prevGenerated = combine(prevFirst, prevLast);
  if (current.trim() === "" || current === prevGenerated) {
    return combine(nextFirst, nextLast);
  }
  return current;
}
