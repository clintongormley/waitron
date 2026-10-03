import { html } from "lit";
import type { ComboboxOption } from "@waitron/ui";
import type { CategorySummary } from "../api/client.js";
import { byLabel, categoryPath } from "./category-form.js";
import { t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-combobox.js";

/** How the product editor joins a category path's names. */
export const PATH_SEPARATOR = " › ";

/** A category's whole path, as the product editor shows it; `missing` for an id the list lacks. */
export function categoryPathText(
  id: string,
  categories: readonly CategorySummary[],
  missing: string,
): string {
  const category = categories.find((candidate) => candidate.id === id);
  return category ? categoryPath(category, categories, PATH_SEPARATOR) : missing;
}

/** Every category depth-first, siblings in the category list's order. A category whose parent the
 * list lacks is listed at the top level. */
function categoryTree(categories: readonly CategorySummary[]): ComboboxOption[] {
  const known = new Set(categories.map(({ id }) => id));
  const childrenOf = (parentId: string | null) =>
    categories
      .filter((category) =>
        parentId === null
          ? category.parentId === null || !known.has(category.parentId)
          : category.parentId === parentId,
      )
      .sort((a, b) => byLabel(a.name, b.name));
  const options: ComboboxOption[] = [];
  const visit = (category: CategorySummary, depth: number) => {
    options.push({
      value: category.id,
      label: category.name,
      depth,
      valueLabel: categoryPath(category, categories, PATH_SEPARATOR),
    });
    for (const child of childrenOf(category.id)) visit(child, depth + 1);
  };
  for (const top of childrenOf(null)) visit(top, 0);
  return options;
}

export interface CategoryPathFieldOptions {
  name: string;
  label: string;
  actionLabel: string;
  categories: readonly CategorySummary[];
  /** The chosen category id, or null for the choice `noneLabel` names. */
  value: string | null;
  noneLabel: string;
  /** Shown for a chosen id the list lacks. */
  missingLabel: string;
  error?: string;
  disabled: boolean;
  change: (id: string | null) => void;
}

/**
 * The chosen category as its path, with an action word that opens every category as an indented
 * tree. A field template rather than an element, so the control is rendered into the host's own
 * shadow root and a refusal naming the field can focus it by `name`.
 */
export function categoryPathField(options: CategoryPathFieldOptions) {
  return html`<wt-combobox
    appearance="link"
    name=${options.name}
    label=${options.label}
    action-label=${options.actionLabel}
    placeholder=${options.missingLabel}
    show-empty-option
    searchPlaceholder=${t("categories.combobox_search")}
    noResultsLabel=${t("categories.combobox_no_results")}
    .disabled=${options.disabled}
    .error=${options.error ?? ""}
    .invalid=${!!options.error}
    .options=${[{ value: "", label: options.noneLabel }, ...categoryTree(options.categories)]}
    .value=${options.value ?? ""}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      options.change(event.detail.value || null);
    }}
  ></wt-combobox>`;
}
