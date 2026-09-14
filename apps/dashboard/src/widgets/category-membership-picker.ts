import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import type { CategorySummary, ProductCategories } from "../api/client.js";
import { categoryPath } from "./category-form.js";
import { t, currentLocale } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-lozenge.js";

@customElement("dashboard-category-membership-picker")
export class CategoryMembershipPicker extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-3);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) categories: readonly CategorySummary[] = [];
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) value: ProductCategories = {
    categoryIds: [],
    primaryCategoryId: null,
  };
  @property({ type: Boolean }) busy = false;
  @state() private draft: ProductCategories = { categoryIds: [], primaryCategoryId: null };
  protected override willUpdate(changes: PropertyValues<this>) {
    if (changes.has("value")) {
      this.draft = {
        categoryIds: [...this.value.categoryIds],
        primaryCategoryId: this.value.primaryCategoryId,
      };
    }
  }
  #setCategories(ids: string[]): void {
    let primary = this.draft.primaryCategoryId;
    const added = ids.filter((id) => !this.draft.categoryIds.includes(id));
    if (ids.length === 0) primary = null;
    else if (this.draft.categoryIds.length === 0 && added.length === 1) primary = added[0]!;
    else if (primary && !ids.includes(primary)) primary = null;
    this.draft = { categoryIds: ids, primaryCategoryId: primary };
  }
  #emit(event: Event, type: "wt-submit" | "wt-cancel"): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent(type, {
        detail:
          type === "wt-submit"
            ? {
                value: {
                  categoryIds: [...this.draft.categoryIds],
                  primaryCategoryId: this.draft.primaryCategoryId,
                },
              }
            : {},
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    const path = (category: CategorySummary) =>
      categoryPath(category, this.categories, currentLocale(), this.languages);
    const chosen = this.categories.filter((category) =>
      this.draft.categoryIds.includes(category.id),
    );
    return html`<wt-combobox
        data-test="member-categories"
        multiple
        label=${t("categories.categories_label")}
        placeholder=${t("categories.categories_placeholder")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .countLabel=${(count: number) =>
          t("categories.combobox_selected").replace("{count}", String(count))}
        .disabled=${this.busy}
        .options=${this.categories.map((category) => ({
          value: category.id,
          label: path(category),
        }))}
        .values=${[...this.draft.categoryIds]}
        @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
          event.stopPropagation();
          this.#setCategories(event.detail.values);
        }}
      ></wt-combobox>
      <div class="chips">
        ${chosen.map(
          (category) =>
            html`<wt-lozenge color=${category.color ?? ""}>${path(category)}</wt-lozenge>`,
        )}
      </div>
      <wt-combobox
        data-test="reporting-category"
        label=${t("editor.reporting_category")}
        placeholder=${t("categories.none")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .disabled=${this.busy || this.draft.categoryIds.length === 0}
        .options=${[
          { value: "", label: t("categories.none") },
          ...chosen.map((category) => ({ value: category.id, label: path(category) })),
        ]}
        .value=${this.draft.primaryCategoryId ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.draft = { ...this.draft, primaryCategoryId: event.detail.value || null };
        }}
      ></wt-combobox>
      <wt-form-actions
        ><wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#emit(event, "wt-cancel")}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-test="save-membership"
          variant="primary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#emit(event, "wt-submit")}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-membership-picker": CategoryMembershipPicker;
  }
}
