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
  /**
   * Where the entry's name came from. `null` is a row this write leaves as it was; any other value
   * is a row the write creates, renames, moves or makes count again, and entries sharing a value
   * already sat together under these names (the children of one category moved up together).
   */
  group: string | null;
}

/**
 * The first entry whose folded name another entry from a different group already holds: a write is
 * refused only for a clash it creates, so rows that already shared a name do not block an unrelated
 * save. The entry named is the later of the two, unless that one is a row the write leaves alone.
 */
export function firstNewClash<T extends NameEntry>(entries: readonly T[]): T | undefined {
  const held = new Map<string, T>();
  for (const entry of entries) {
    const key = foldName(entry.name);
    const earlier = held.get(key);
    if (earlier === undefined) held.set(key, entry);
    else if (earlier.group !== entry.group) return entry.group === null ? earlier : entry;
  }
  return undefined;
}
