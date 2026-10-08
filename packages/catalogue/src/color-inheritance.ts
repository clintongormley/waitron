/** Lowercase `#rrggbb`: the one spelling a stored colour takes. */
export function isStoredColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

/** `value` when it is null or a stored colour; anything else goes to `refuse`, which throws the
 * caller's own error. */
export function colorOrNull(value: unknown, refuse: () => never): string | null {
  return value === null || isStoredColor(value) ? value : refuse();
}

export interface ColorNode {
  parentId: string | null;
  color: string | null;
}

/** The main category's colour, else the nearest coloured category above it, else `fallback` (the
 * venue default). A walk longer than the tree can only be a loop in the data, so it ends there. */
export function categoryColor(
  categoryId: string | null,
  categories: ReadonlyMap<string, ColorNode>,
  fallback: string | null,
): string | null {
  let id = categoryId;
  for (let steps = 0; id !== null && steps <= categories.size; steps++) {
    const node = categories.get(id);
    if (node === undefined) return fallback;
    if (node.color !== null) return node.color;
    id = node.parentId;
  }
  return fallback;
}

export function effectiveColor(
  own: string | null,
  categoryId: string | null,
  categories: ReadonlyMap<string, ColorNode>,
  fallback: string | null,
): string | null {
  return own ?? categoryColor(categoryId, categories, fallback);
}
