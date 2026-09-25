import { html, nothing } from "lit";
import type { ContentLanguages } from "@waitron/shared";
import type { CategorySummary, Label } from "../api/client.js";
import { categoryPath } from "./category-form.js";
import { currentLocale, t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-lozenge.js";

/**
 * A product's classification: ONE main category from the reporting tree, plus any number of flat
 * labels. These are field templates rather than an element, so each control is rendered into the
 * host's own shadow root and a refusal naming the field can focus it by `name`.
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
    .sort((a, b) => a.label.localeCompare(b.label));
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

export interface LabelsFieldOptions {
  labels: readonly Label[];
  value: readonly string[];
  error?: string;
  disabled: boolean;
  change: (ids: string[]) => void;
}

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name);

export function labelsField(options: LabelsFieldOptions) {
  const chosen = options.labels.filter((label) => options.value.includes(label.id)).sort(byName);
  return html`<wt-combobox
      name="labels"
      multiple
      label=${t("labels.field")}
      placeholder=${t("labels.none")}
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      .countLabel=${(count: number) =>
        t("categories.combobox_selected").replace("{count}", String(count))}
      .disabled=${options.disabled}
      .error=${options.error ?? ""}
      .invalid=${!!options.error}
      .options=${[...options.labels]
        .sort(byName)
        .map((label) => ({ value: label.id, label: label.name }))}
      .values=${[...options.value]}
      @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
        event.stopPropagation();
        options.change(event.detail.values);
      }}
    ></wt-combobox>
    ${
      chosen.length
        ? html`<div class="chips" data-test="label-chips">
            ${chosen.map((label) => html`<wt-lozenge>${label.name}</wt-lozenge>`)}
          </div>`
        : nothing
    }`;
}

/** Label names for ids, in the ids' order; an id no loaded label has reads as `missing`. */
export function labelNames(
  ids: readonly string[],
  labels: readonly Label[],
  missing: string,
): string[] {
  return ids.map((id) => labels.find((label) => label.id === id)?.name ?? missing);
}
