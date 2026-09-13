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
  const prevGenerated = `${prevFirst} ${prevLast}`.trim();
  if (current.trim() === "" || current === prevGenerated) {
    return `${nextFirst} ${nextLast}`.trim();
  }
  return current;
}
