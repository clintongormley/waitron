/** Filters add temporary choices without changing the ordinary tree's remembered branches. */
export class FilterExpansion {
  #choices = new Map<string, boolean>();
  #filters: object | undefined;

  choose(
    keys: readonly string[],
    expanded: boolean,
    temporary: (key: string) => boolean,
    closeBelow: (keys: readonly string[]) => readonly string[],
  ): string[] {
    const choices = keys.filter(temporary);
    if (choices.length === 0) return [...keys];
    this.set(expanded ? choices : closeBelow(choices), expanded);
    return keys.filter((key) => !choices.includes(key));
  }

  set(keys: readonly string[], expanded: boolean): void {
    for (const key of keys) this.#choices.set(key, expanded);
  }

  get(key: string): boolean | undefined {
    return this.#choices.get(key);
  }

  reset(filters: object | undefined): void {
    if (this.#filters === filters) return;
    this.#filters = filters;
    this.#choices.clear();
  }
}

export function visibleTree<Row>(
  rows: readonly Row[],
  visible: readonly Row[],
  rowKey: (row: Row, index: number) => string,
  parentOf: (row: Row) => string | null,
  searching: boolean,
  passesFilters: (row: Row) => boolean,
  filterOpensBranch?: (row: Row) => boolean,
) {
  const keys = rows.map((row, index) => rowKey(row, index));
  const keyByRow = new Map<Row, string>();
  const rowByKey = new Map<string, Row>();
  rows.forEach((row, index) => {
    keyByRow.set(row, keys[index]!);
    if (!rowByKey.has(keys[index]!)) rowByKey.set(keys[index]!, row);
  });
  const matched = new Set(visible.map((row) => keyByRow.get(row)!));
  const ancestors = new Set<string>();
  rows.forEach((row, index) => {
    if (!matched.has(keys[index]!)) return;
    const visited = new Set<string>();
    let parentKey = parentOf(row);
    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey);
      ancestors.add(parentKey);
      const parent = rowByKey.get(parentKey);
      parentKey = parent ? parentOf(parent) : null;
    }
  });
  const below = new Set<string>();
  if (searching) {
    let grew = true;
    while (grew) {
      grew = false;
      rows.forEach((row, index) => {
        const key = keys[index]!;
        const parent = parentOf(row);
        if (matched.has(key) || below.has(key) || parent === null) return;
        if (!matched.has(parent) && !below.has(parent)) return;
        if (!passesFilters(row)) return;
        below.add(key);
        grew = true;
      });
    }
  }
  const included = new Set([...matched, ...ancestors, ...below]);
  const ancestorOnly = new Set(
    [...ancestors].filter((key) => !matched.has(key) && !below.has(key)),
  );
  const heldOpen = searching ? ancestors : filterOpensBranch ? new Set(ancestorOnly) : ancestorOnly;
  if (!searching && filterOpensBranch) {
    for (const key of ancestors) {
      const row = rowByKey.get(key);
      if (row !== undefined && filterOpensBranch(row)) heldOpen.add(key);
    }
  }
  return { rows: rows.filter((_row, index) => included.has(keys[index]!)), ancestorOnly, heldOpen };
}
