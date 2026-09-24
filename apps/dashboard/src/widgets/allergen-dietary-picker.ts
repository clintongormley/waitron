import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { ALLERGEN_CODES, allergenName } from "../i18n/domain.js";
import { DIETARY_SUITABILITY, type DietaryLabel } from "../api/client.js";
import { t } from "../i18n/t.js";

/** The allergens a thing CONTAINS, and the dietary preferences it is SUITABLE FOR. */
export interface AllergenDietaryValue {
  allergens: string[];
  dietary: DietaryLabel[];
}

const EMPTY: AllergenDietaryValue = { allergens: [], dietary: [] };

@customElement("dashboard-allergen-dietary-picker")
export class AllergenDietaryPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-3);
      }
      .field {
        display: grid;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
      }
      .summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) value: AllergenDietaryValue = EMPTY;
  @state() private editing: "allergens" | "dietary" | null = null;
  /** Products offer the full declaration set; modifier choices keep the four-item default. */
  @property({ attribute: false }) dietaryOptions: readonly DietaryLabel[] = DIETARY_SUITABILITY;

  #emit(next: AllergenDietaryValue): void {
    this.value = next;
    this.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: next }, bubbles: true, composed: true }),
    );
  }

  #allergenOptions() {
    return ALLERGEN_CODES.map((code) => ({ value: code, label: allergenName(code) }));
  }

  #dietaryOptions() {
    return this.dietaryOptions.map((value) => ({
      value,
      label: t(`editor.diet.${value}`),
    }));
  }

  #summary<T extends string>(values: readonly T[], label: (value: T) => string): string {
    return values.length ? values.map(label).join(", ") : t("modifiers.none_selected");
  }

  async #edit(field: "allergens" | "dietary", event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.editing = field;
    await this.updateComplete;
    this.shadowRoot?.querySelector<HTMLElement>(`[data-test="${field}"]`)?.focus();
  }

  #finishEditing(field: "allergens" | "dietary"): void {
    if (this.editing === field) this.editing = null;
  }

  #onAllergens(event: CustomEvent<{ values: string[] }>): void {
    // wt-combobox already stops its own source event; stop this re-dispatched one before we emit ours
    // so a consumer never sees the inner combobox's wt-change alongside the widget's.
    event.stopPropagation();
    this.#emit({ ...this.value, allergens: event.detail.values });
  }

  #onDietary(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    const chosen = new Set(event.detail.values);
    this.#emit({
      ...this.value,
      dietary: this.dietaryOptions.filter((label) => chosen.has(label)),
    });
  }

  override render() {
    return html`
      <div class="field" role="group" aria-labelledby="allergens-label">
        <span id="allergens-label" class="label">${t("modifiers.allergens")}</span>
        ${
          this.editing === "allergens"
            ? html`<wt-combobox
                multiple
                data-test="allergens"
                name="allergens"
                aria-label=${t("modifiers.allergens")}
                ?disabled=${this.busy}
                .options=${this.#allergenOptions()}
                .values=${this.value.allergens}
                .countLabel=${(count: number) =>
                  t("modifiers.allergens_selected_count").replace("{count}", String(count))}
                @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onAllergens(e)}
                @focusout=${() => this.#finishEditing("allergens")}
              ></wt-combobox>`
            : html`<div class="summary">
                <span data-test="allergens-summary"
                  >${this.#summary(this.value.allergens, (code) => allergenName(code))}</span
                >
                <wt-button
                  data-test="edit-allergens"
                  variant="ghost"
                  .disabled=${this.busy}
                  aria-label=${`${t("action.edit")}: ${t("modifiers.allergens")}`}
                  @click=${(event: Event) => void this.#edit("allergens", event)}
                  >${t("action.edit")}</wt-button
                >
              </div>`
        }
      </div>
      <div class="field" role="group" aria-labelledby="dietary-label">
        <span id="dietary-label" class="label">${t("modifiers.dietary_preferences")}</span>
        ${
          this.editing === "dietary"
            ? html`<wt-combobox
                multiple
                data-test="dietary"
                name="dietary-preferences"
                aria-label=${t("modifiers.dietary_preferences")}
                ?disabled=${this.busy}
                .options=${this.#dietaryOptions()}
                .values=${this.value.dietary}
                .countLabel=${(count: number) =>
                  t("modifiers.dietary_selected_count").replace("{count}", String(count))}
                @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onDietary(e)}
                @focusout=${() => this.#finishEditing("dietary")}
              ></wt-combobox>`
            : html`<div class="summary">
                <span data-test="dietary-summary"
                  >${this.#summary(this.value.dietary, (value) => t(`editor.diet.${value}`))}</span
                >
                <wt-button
                  data-test="edit-dietary"
                  variant="ghost"
                  .disabled=${this.busy}
                  aria-label=${`${t("action.edit")}: ${t("modifiers.dietary_preferences")}`}
                  @click=${(event: Event) => void this.#edit("dietary", event)}
                  >${t("action.edit")}</wt-button
                >
              </div>`
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-allergen-dietary-picker": AllergenDietaryPicker;
  }
}
