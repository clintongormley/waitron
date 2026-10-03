import type { CategorySummary } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

/** The category, then each category above it, stopping at a parent the list lacks or a loop. */
export function categoryAncestors(
  category: CategorySummary,
  categories: readonly CategorySummary[],
): CategorySummary[] {
  const chain: CategorySummary[] = [];
  const seen = new Set<string>();
  let current: CategorySummary | undefined = category;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = categories.find((item) => item.id === current!.parentId);
  }
  return chain;
}

export function categoryPath(
  category: CategorySummary,
  categories: readonly CategorySummary[],
  separator = " / ",
): string {
  return categoryAncestors(category, categories)
    .map(({ name }) => name)
    .reverse()
    .join(separator);
}

/** The collation `wt-data-table` sorts text with, so a picker or list and the tables agree. */
export function byLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function categoryWithDescendants(
  id: string,
  categories: readonly CategorySummary[],
): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories)
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        grew = true;
      }
  }
  return ids;
}

const FIELD_BY_CODE = new Map([
  ["category.invalid", "name"],
  ["category.parent_cycle", "parent"],
]);
const FIELD_BY_REQUEST_FIELD = new Map([
  ["name", "name"],
  ["parentId", "parent"],
]);

/** A refused category write, keyed by the field it concerns (`name` or `parent`), or `_form` when it
 * concerns neither. `parentId` is the parent the refused write named. */
export function categoryRefusalErrors(
  error: unknown,
  parentId: string | null = null,
): Record<string, string> {
  const code = codeOf(error);
  const message = codeMessage(code);
  const params = (error as { params?: { field?: unknown; categoryId?: unknown } }).params ?? {};
  let field = FIELD_BY_CODE.get(code);
  if (code === "category.not_found" && parentId !== null && params.categoryId === parentId)
    field = "parent";
  if (code === "management.request_invalid" && typeof params.field === "string")
    field = FIELD_BY_REQUEST_FIELD.get(params.field);
  return { [field ?? "_form"]: message };
}
