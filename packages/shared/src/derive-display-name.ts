/**
 * The display name a form should hold after a first/last-name change.
 *
 * `current` is the display name before this change; `prevFirst`/`prevLast` are the first/last
 * names it was last generated against; `nextFirst`/`nextLast` are the new values. Regenerate
 * ("nextFirst nextLast", single-spaced, trimmed) when `current` is blank OR still equals what was
 * last generated ("prevFirst prevLast", single-spaced, trimmed); otherwise the person has
 * customised the display name, so return `current` unchanged. Shared by the setup wizard, the
 * new-staff form, the admin person editor and the profile screen so they auto-fill identically.
 */
export function deriveDisplayName(
  current: string,
  prevFirst: string,
  prevLast: string,
  nextFirst: string,
  nextLast: string,
): string {
  // Join first and last into a single-spaced name, dropping an absent part and any stray spaces the
  // raw form fields carried. Used for BOTH the "still matches the last generated name" comparison and
  // the regenerated value, so the two never disagree over spacing.
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
