import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import type { CategorySummary, ProductCategories } from "../api/client.js";
import { categoryPath } from "./category-form.js";
import { t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

@customElement("dashboard-category-membership-picker")
export class CategoryMembershipPicker extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-3);
      }
      fieldset {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      label {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        min-height: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) categories: readonly CategorySummary[] = [];
  @property({ attribute: false }) locales: readonly string[] = [];
  @property({ attribute: false }) value: ProductCategories = {
    categoryIds: [],
    primaryCategoryId: null,
  };
  @property({ type: Boolean }) busy = false;
  @state() private draft: ProductCategories = { categoryIds: [], primaryCategoryId: null };
  @state() private error = "";
  protected override willUpdate(changes: PropertyValues<this>) {
    if (changes.has("value")) {
      this.draft = {
        categoryIds: [...this.value.categoryIds],
        primaryCategoryId: this.value.primaryCategoryId,
      };
      this.error = "";
    }
  }
  #change(event: Event, id: string): void {
    event.stopPropagation();
    const selected = (event.target as HTMLInputElement).checked;
    const ids = selected
      ? [...this.draft.categoryIds, id]
      : this.draft.categoryIds.filter((value) => value !== id);
    let primary = this.draft.primaryCategoryId;
    if (ids.length === 0) primary = null;
    else if (selected && this.draft.categoryIds.length === 0) primary = id;
    else if (primary && !ids.includes(primary)) primary = null;
    this.draft = { categoryIds: ids, primaryCategoryId: primary };
    this.error = "";
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
    return html`<wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${this.error ? [this.error] : []}
      ></wt-form-error-summary>
      <fieldset .disabled=${this.busy}>
        <legend>${t("categories.membership")}</legend>
        ${this.categories.map((category) => html`<label><input type="checkbox" name="category-membership" value=${category.id} .checked=${this.draft.categoryIds.includes(category.id)} @change=${(event: Event) => this.#change(event, category.id)} />${categoryPath(category, this.categories, this.locales[0] ?? "en")}</label>`)}
      </fieldset>
      <label
        >${t("editor.reporting_category")}<select
          name="primary-category"
          .disabled=${this.busy || !this.draft.categoryIds.length}
          aria-invalid=${this.error ? "true" : "false"}
          aria-describedby="primary-category-error"
          @change=${(event: Event) => {
            event.stopPropagation();
            this.draft = {
              ...this.draft,
              primaryCategoryId: (event.target as HTMLSelectElement).value || null,
            };
            this.error = "";
          }}
        >
          <option value="" .selected=${this.draft.primaryCategoryId === null}>
            ${t("categories.none")}
          </option>
          ${this.categories.filter((category) => this.draft.categoryIds.includes(category.id)).map((category) => html`<option value=${category.id} .selected=${category.id === this.draft.primaryCategoryId}>${categoryPath(category, this.categories, this.locales[0] ?? "en")}</option>`)}
        </select></label
      ><span id="primary-category-error">${this.error}</span>
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
