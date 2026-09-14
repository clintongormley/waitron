import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter, CATEGORY_PALETTE } from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "./image-upload.js";
import type { ImageUploader } from "./image-upload.js";
import type { CategoryInput, CategorySummary } from "../api/client.js";
import { t, currentLocale } from "../i18n/t.js";

export function categoryPath(
  category: CategorySummary,
  categories: readonly CategorySummary[],
  language: string,
  config: ContentLanguages = { defaultLanguage: language, languages: [language] },
): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: CategorySummary | undefined = category;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(resolveEnabledContentText(current.name, language, config) || current.id);
    current = categories.find((item) => item.id === current!.parentId);
  }
  return names.join(" / ");
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
      fieldset.color {
        display: grid;
        gap: var(--wt-space-2);
        border: none;
        margin: 0;
        padding: 0;
      }
      fieldset.color legend {
        padding: 0;
        font: inherit;
      }
      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .swatch {
        width: var(--wt-space-6);
        height: var(--wt-space-6);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        cursor: pointer;
      }
      .swatch.on {
        outline: var(--wt-selected-ring);
        outline-offset: var(--wt-selected-ring-offset);
      }
      .swatch.none {
        width: auto;
        padding: 0 var(--wt-space-2);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
      .custom {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
      }
      .custom input[type="color"] {
        width: var(--wt-space-6);
        height: var(--wt-space-6);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        cursor: pointer;
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
  #parents(): CategorySummary[] {
    const excluded = new Set(this.value ? [this.value.id] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of this.categories)
        if (category.parentId && excluded.has(category.parentId) && !excluded.has(category.id)) {
          excluded.add(category.id);
          changed = true;
        }
    }
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
              // Same collation wt-data-table uses for these very names on the categories screen, so
              // the dropdown and the tables agree: numeric runs in order, accents/case folded.
              .sort((a, b) =>
                a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
              ),
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
        <fieldset class="color">
          <legend>${t("categories.color")}</legend>
          <div class="swatches" role="radiogroup" aria-label=${t("categories.color")}>
            <button
              type="button"
              class="swatch none ${this.color === null ? "on" : ""}"
              role="radio"
              aria-checked=${this.color === null}
              data-color=""
              .disabled=${this.busy}
              @click=${(event: Event) => {
                event.stopPropagation();
                this.color = null;
              }}
            >
              ${t("categories.color_none")}
            </button>
            ${CATEGORY_PALETTE.map(
              (c) =>
                html`<button
                  type="button"
                  class="swatch ${this.color === c ? "on" : ""}"
                  style=${`background:${c}`}
                  role="radio"
                  aria-checked=${this.color === c}
                  aria-label=${c}
                  data-color=${c}
                  .disabled=${this.busy}
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    this.color = c;
                  }}
                ></button>`,
            )}
          </div>
          <label class="custom"
            >${t("categories.color_custom")}
            <input
              type="color"
              name="category-color"
              aria-invalid=${errors.color ? "true" : "false"}
              aria-describedby="category-color-error"
              .value=${this.color ?? "#000000"}
              .disabled=${this.busy}
              @input=${(event: Event) => {
                event.stopPropagation();
                this.color = (event.target as HTMLInputElement).value;
              }}
          /></label>
          <span class="field-error" id="category-color-error">${errors.color ?? nothing}</span>
        </fieldset>
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
