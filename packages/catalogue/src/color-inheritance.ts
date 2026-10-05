/** Lowercase `#rrggbb`: the one spelling a stored colour takes. */
export function isStoredColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

export interface ColorNode {
  parentId: string | null;
  color: string | null;
}

/** The main category's colour, else the nearest coloured category above it, else null. A walk
 * longer than the tree can only be a loop in the data, so it ends there. */
export function categoryColor(
  categoryId: string | null,
  categories: ReadonlyMap<string, ColorNode>,
): string | null {
  let id = categoryId;
  for (let steps = 0; id !== null && steps <= categories.size; steps++) {
    const node = categories.get(id);
    if (node === undefined) return null;
    if (node.color !== null) return node.color;
    id = node.parentId;
  }
  return null;
}

export function effectiveColor(
  own: string | null,
  categoryId: string | null,
  categories: ReadonlyMap<string, ColorNode>,
): string | null {
  return own ?? categoryColor(categoryId, categories);
}
