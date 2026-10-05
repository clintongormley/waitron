import type { CategorySummary } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

export const PATH_SEPARATOR = " › ";

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
  separator = PATH_SEPARATOR,
): string {
  return categoryAncestors(category, categories)
    .map(({ name }) => name)
    .reverse()
    .join(separator);
}

/** The path spelled with each separator a person might type, one spelling per line so a term
 * typed into a one-line search box cannot run from the end of one spelling into the next. */
export function categoryPathSearchText(
  category: CategorySummary,
  categories: readonly CategorySummary[],
): string {
  return [PATH_SEPARATOR, " / ", " > "]
    .map((separator) => categoryPath(category, categories, separator))
    .join("\n");
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
  ["category.name_taken", "name"],
  ["category.parent_cycle", "parent"],
]);
const FIELD_BY_REQUEST_FIELD = new Map([
  ["name", "name"],
  ["parentId", "parent"],
  ["color", "color"],
]);

/** A refused category write, keyed by the field it concerns (`name`, `parent` or `color`), or
 * `_form` when it concerns none. `parentId` is the parent the refused write named. */
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
  if (code === "category.invalid" && params.field === "color") field = "color";
  if (code === "management.request_invalid" && typeof params.field === "string")
    field = FIELD_BY_REQUEST_FIELD.get(params.field);
  return { [field ?? "_form"]: field === "color" ? t("editor.field_rejected") : message };
}
