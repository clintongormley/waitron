import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "./image-upload.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import type { ImageUploader } from "./image-upload.js";
import type { CategoryInput, CategorySummary } from "../api/client.js";
import { t, currentLocale } from "../i18n/t.js";

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
  language: string,
  config: ContentLanguages = { defaultLanguage: language, languages: [language] },
): string {
  return categoryAncestors(category, categories)
    .map(({ id, name }) => resolveEnabledContentText(name, language, config) || id)
    .reverse()
    .join(" / ");
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

/** API writes belong to the host, so the same editor can create a category inside a product draft. */
@customElement("dashboard-category-form")
export class CategoryForm extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .field-error {
        color: var(--wt-color-danger);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) value: CategorySummary | null = null;
  @property({ attribute: false }) categories: readonly CategorySummary[] = [];
  @property({ attribute: false }) api?: ImageUploader;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private names: Record<string, string> = {};
  @state() private parentId: string | null = null;
  @state() private image: string | null = null;
  @state() private color: string | null = null;
  @state() private validation: Record<string, string> = {};
  @state() private pickerOpen = false;
  protected override willUpdate(changes: PropertyValues<this>): void {
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as CategorySummary | null | undefined)?.id)
    ) {
      this.names = { ...this.value?.name };
      for (const locale of this.languages.languages) this.names[locale] ??= "";
      this.parentId = this.value?.parentId ?? null;
      this.image = this.value?.image ?? null;
      this.color = this.value?.color ?? null;
      this.validation = {};
    }
  }
  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { value: CategoryInput } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.pickerOpen) return;
    const language = this.languages.languages[0];
    if (!language || !this.names[language]?.trim()) {
      this.validation = { [`name-${language ?? ""}`]: t("categories.name_required") };
      return;
    }
    this.validation = {};
    this.#emit(event, "wt-submit", {
      value: {
        name: { ...this.names },
        parentId: this.parentId,
        image: this.image,
        color: this.color,
      },
    });
  }
  #parents(): readonly CategorySummary[] {
    if (!this.value) return this.categories;
    const excluded = categoryWithDescendants(this.value.id, this.categories);
    return this.categories.filter((category) => !excluded.has(category.id));
  }
  override render() {
    const errors = { ...this.fieldErrors, ...this.validation };
    return html`<wt-modal
      .open=${this.open}
      heading=${t(this.value ? "categories.edit" : "categories.create")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        if (!this.busy && !this.pickerOpen) this.#emit(event, "wt-cancel", {});
        else event.stopPropagation();
      }}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${Object.values(errors)}
        ></wt-form-error-summary>
        ${this.languages.languages.map(
          (locale) =>
            html`<wt-input
              name=${`category-name-${locale}`}
              label=${`${t("categories.name")} (${locale})`}
              .required=${locale === this.languages.languages[0]}
              .disabled=${this.busy}
              .value=${this.names[locale] ?? ""}
              .error=${errors[`name-${locale}`] ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.names = { ...this.names, [locale]: event.detail.value };
                this.validation = {};
              }}
            ></wt-input>`,
        )}
        <wt-combobox
          name="category-parent"
          label=${t("categories.parent")}
          .disabled=${this.busy}
          .options=${[
            { value: "", label: t("categories.no_parent") },
            ...this.#parents()
              .map((category) => ({
                value: category.id,
                label: categoryPath(category, this.categories, currentLocale(), this.languages),
              }))
              .sort((a, b) => byLabel(a.label, b.label)),
          ]}
          .value=${this.parentId ?? ""}
          .error=${errors.parent ?? ""}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.parentId = event.detail.value || null;
          }}
        ></wt-combobox>
        ${colorField({
          color: this.color,
          busy: this.busy,
          error: errors.color ?? "",
          name: "category-color",
          errorId: "category-color-error",
          change: (color) => {
            this.color = color;
          },
        })}
        <dashboard-image-upload
          aria-describedby="category-image-error"
          .api=${this.api}
          .image=${this.image}
          @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
            event.stopPropagation();
            this.pickerOpen = event.detail.open;
          }}
          @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
            event.stopPropagation();
            this.image = event.detail.image;
          }}
        ></dashboard-image-upload>
        <span class="field-error" id="category-image-error">${errors.image ?? nothing}</span>
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#emit(event, "wt-cancel", {})}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant="primary"
          .disabled=${this.busy || this.pickerOpen}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-form": CategoryForm;
  }
}
