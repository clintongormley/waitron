export type FilterChoice = string | string[];

export function isFilterChoice(value: unknown): value is FilterChoice {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((each) => typeof each === "string"))
  );
}

export function sameValues(a: readonly string[], b: readonly string[]): boolean {
  const right = new Set(b);
  return new Set(a).size === right.size && a.every((value) => right.has(value));
}

/** The lists are copied so a listener cannot change the table's own filter state through them. */
export function copyChoices(choices: Record<string, FilterChoice>): Record<string, FilterChoice> {
  return Object.fromEntries(
    Object.entries(choices).map(([key, value]) => [
      key,
      typeof value === "string" ? value : [...value],
    ]),
  );
}

export function sameChoices(
  a: Record<string, FilterChoice>,
  b: Record<string, FilterChoice>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const [left, right] = [a[key]!, b[key]];
      if (typeof left === "string" || typeof right === "string") return left === right;
      return right !== undefined && sameValues(left, right);
    })
  );
}

export function filterChoice(
  filters: Record<string, FilterChoice>,
  key: string,
  value: FilterChoice | undefined,
): Record<string, FilterChoice> {
  const next = { ...filters };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function persistTableView(
  key: string | undefined,
  view: {
    sortKey: string | null;
    sortDirection: "ascending" | "descending";
    filters: Record<string, FilterChoice>;
  },
  temporaryFilters: ReadonlyMap<string, FilterChoice | undefined>,
): void {
  if (!key) return;
  let filters = view.filters;
  for (const [column, previous] of temporaryFilters)
    filters = filterChoice(filters, column, previous);
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...view, filters }));
  } catch {
    // The remembered view is a convenience; the table works without it.
  }
}
