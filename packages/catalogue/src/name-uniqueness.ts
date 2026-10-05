/**
 * The form a category or product name is compared in when the question is "is this name already
 * taken?": surrounding whitespace and case are ignored, interior whitespace and accents are not.
 * Folded here rather than in SQL because this engine's `lower()` folds ASCII letters only; the steps
 * are `@waitron/identity`'s `foldForUniqueness`, whose comment gives the reason for each.
 */
export function foldName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase().normalize("NFC");
}

export interface NameEntry {
  name: string;
  /** False for a row this write leaves as it was; true for one it creates, renames, moves or makes
   * count again. */
  changed: boolean;
}

/**
 * The first entry whose folded name another entry already holds, where at least one of the two is
 * changed: a write is refused only for a clash it creates, so rows that already shared a name do not
 * block an unrelated save. The entry named is the later of the two, unless that one is unchanged.
 */
export function firstNewClash<T extends NameEntry>(entries: readonly T[]): T | undefined {
  const held = new Map<string, T>();
  for (const entry of entries) {
    const key = foldName(entry.name);
    const earlier = held.get(key);
    if (earlier === undefined) held.set(key, entry);
    else if (entry.changed) return entry;
    else if (earlier.changed) return earlier;
  }
  return undefined;
}
