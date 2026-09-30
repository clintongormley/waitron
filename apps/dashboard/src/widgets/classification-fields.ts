import { html } from "lit";
import type { ContentLanguages } from "@waitron/shared";
import type { CategorySummary } from "../api/client.js";
import { byLabel, categoryPath } from "./category-form.js";
import { currentLocale, t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-combobox.js";

/**
 * One category chosen from the reporting tree. This is a field template rather than an element, so
 * the control is rendered into the host's own shadow root and a refusal naming the field can focus
 * it by `name`.
 */

export interface CategoryFieldOptions {
  name: string;
  label: string;
  categories: readonly CategorySummary[];
  languages: ContentLanguages;
  /** The chosen category id, or null for the choice `noneLabel` names. */
  value: string | null;
  /** What choosing no category means here: Uncategorised, the top level, or the parent's. */
  noneLabel: string;
  /** Categories that may not be chosen, such as the one being deleted. */
  exclude?: ReadonlySet<string>;
  error?: string;
  disabled: boolean;
  change: (id: string | null) => void;
}

export function categoryField(options: CategoryFieldOptions) {
  const choices = options.categories
    .filter((category) => !options.exclude?.has(category.id))
    .map((category) => ({
      value: category.id,
      label: categoryPath(category, options.categories, currentLocale(), options.languages),
    }))
    .sort((a, b) => byLabel(a.label, b.label));
  return html`<wt-combobox
    name=${options.name}
    label=${options.label}
    placeholder=${options.noneLabel}
    searchPlaceholder=${t("categories.combobox_search")}
    noResultsLabel=${t("categories.combobox_no_results")}
    .disabled=${options.disabled}
    .error=${options.error ?? ""}
    .invalid=${!!options.error}
    .options=${[{ value: "", label: options.noneLabel }, ...choices]}
    .value=${options.value ?? ""}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      options.change(event.detail.value || null);
    }}
  ></wt-combobox>`;
}
