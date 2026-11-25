import { css, html, nothing } from "lit";
import { isStoredColor } from "@waitron/shared";
import type { ComboboxOption } from "@waitron/ui";
import type { CategorySummary } from "../api/catalog-api.js";
import { byLabel, categoryPath } from "./category-form.js";
import { t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-combobox.js";

export const classificationFieldStyles = css`
  .category-path {
    display: flex;
    align-items: center;
    min-height: var(--wt-tap-min);
    margin: 0;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    overflow-wrap: anywhere;
  }
  .chip[slot="value-prefix"] {
    display: inline-block;
    vertical-align: middle;
    margin-inline-end: var(--wt-space-2);
  }
`;

/** A category's whole path, as the product editor shows it; `missing` for an id the list lacks. */
export function categoryPathText(
  id: string,
  categories: readonly CategorySummary[],
  missing: string,
): string {
  const category = categories.find((candidate) => candidate.id === id);
  return category ? categoryPath(category, categories) : missing;
}

/** Every category depth-first, siblings sorted by name. A category whose parent the
 * list lacks is listed at the top level. */
export function categoryTree(categories: readonly CategorySummary[]): ComboboxOption[] {
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
      valueLabel: categoryPath(category, categories),
    });
    for (const child of childrenOf(category.id)) visit(child, depth + 1);
  };
  for (const top of childrenOf(null)) visit(top, 0);
  return options;
}

export interface CategoryPathFieldOptions {
  name: string;
  label: string;
  color?: string | null;
  add?: (text: string) => void;
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

export function variantCategoryPath(id: string | null, categories: readonly CategorySummary[]) {
  const path = id
    ? categoryPathText(id, categories, t("editor.missing_choice"))
    : t("categories.none");
  return html`<div class="group variant-category" data-section="categories">
    <p class="category-path" data-test="category-path">
      <span class="visually-hidden">${t("editor.classification")}: </span>${path}
    </p>
  </div>`;
}

export function categoryPathField(options: CategoryPathFieldOptions) {
  const add: ComboboxOption = {
    value: "add-category",
    label: t("categories.add"),
    icon: "plus",
    primary: true,
    action: true,
    actionLabelForSearch: (text) =>
      text ? t("categories.add_named").replace("{name}", () => text) : t("categories.add"),
  };
  return html`<wt-combobox
    data-section="categories"
    preserve-order
    name=${options.name}
    label=${options.label}
    placeholder=${options.missingLabel}
    show-empty-option
    searchPlaceholder=${t("categories.combobox_search")}
    noResultsLabel=${t("categories.combobox_no_results")}
    .disabled=${options.disabled}
    .error=${options.error ?? ""}
    .invalid=${!!options.error}
    .options=${[
      ...(options.add ? [add] : []),
      { value: "", label: options.noneLabel },
      ...categoryTree(options.categories),
    ]}
    .value=${options.value ?? ""}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      options.change(event.detail.value || null);
    }}
    @wt-combobox-action=${(event: CustomEvent<{ value: string; text: string }>) => {
      event.stopPropagation();
      options.add?.(event.detail.text);
    }}
    >${
      isStoredColor(options.color)
        ? html`<span
            slot="value-prefix"
            class="chip"
            aria-hidden="true"
            style=${`background:${options.color}`}
          ></span>`
        : nothing
    }</wt-combobox
  >`;
}
