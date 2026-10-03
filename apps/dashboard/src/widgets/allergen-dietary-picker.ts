import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "@waitron/ui";
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

type Field = "allergens" | "dietary";

@customElement("dashboard-allergen-dietary-picker")
export class AllergenDietaryPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-1);
      }
      .line {
        display: block;
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .line:hover:not(:disabled) .value {
        text-decoration: underline;
      }
      .line:disabled {
        ${disabledStyles}
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) value: AllergenDietaryValue = EMPTY;
  @state() private editing: Field | null = null;
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
    return values.length ? values.map(label).join(", ") : t("modifiers.none_specified");
  }

  async #focus(selector: string): Promise<void> {
    await this.updateComplete;
    this.shadowRoot?.querySelector<HTMLElement>(selector)?.focus();
  }

  #edit(field: Field, event: Event): void {
    event.stopPropagation();
    this.editing = field;
    void this.#focus(`[data-test="${field}"]`);
  }

  #finishEditing(field: Field): void {
    if (this.editing === field) this.editing = null;
  }

  /** wt-combobox stops the Escape that closes its own open list, so that one never arrives here;
   * this one is prevented, or the window around the editor closes with it. */
  #onEditorKeydown(field: Field, event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.#finishEditing(field);
    void this.#focus(`[data-test="${field}-line"]`);
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

  #line(field: Field, label: string, summary: string) {
    return html`<button
      type="button"
      class="line"
      data-test=${`${field}-line`}
      ?disabled=${this.busy}
      aria-label=${t("modifiers.edit_named").replace("{label}", label).replace("{value}", summary)}
      @click=${(event: Event) => this.#edit(field, event)}
    >
      <span class="label">${label}:</span>
      <span class="value" data-test=${`${field}-summary`}>${summary}</span>
    </button>`;
  }

  override render() {
    const allergens = t("modifiers.allergens");
    const dietary = t("modifiers.dietary_preferences");
    return html`
      ${
        this.editing === "allergens"
          ? html`<wt-combobox
              multiple
              data-test="allergens"
              name="allergens"
              label=${allergens}
              ?disabled=${this.busy}
              .options=${this.#allergenOptions()}
              .values=${this.value.allergens}
              .countLabel=${(count: number) =>
                t("modifiers.allergens_selected_count").replace("{count}", String(count))}
              @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onAllergens(e)}
              @keydown=${(e: KeyboardEvent) => this.#onEditorKeydown("allergens", e)}
              @focusout=${() => this.#finishEditing("allergens")}
            ></wt-combobox>`
          : this.#line(
              "allergens",
              allergens,
              this.#summary(this.value.allergens, (code) => allergenName(code)),
            )
      }
      ${
        this.editing === "dietary"
          ? html`<wt-combobox
              multiple
              data-test="dietary"
              name="dietary-preferences"
              label=${dietary}
              ?disabled=${this.busy}
              .options=${this.#dietaryOptions()}
              .values=${this.value.dietary}
              .countLabel=${(count: number) =>
                t("modifiers.dietary_selected_count").replace("{count}", String(count))}
              @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onDietary(e)}
              @keydown=${(e: KeyboardEvent) => this.#onEditorKeydown("dietary", e)}
              @focusout=${() => this.#finishEditing("dietary")}
            ></wt-combobox>`
          : this.#line(
              "dietary",
              dietary,
              this.#summary(this.value.dietary, (value) => t(`editor.diet.${value}`)),
            )
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-allergen-dietary-picker": AllergenDietaryPicker;
  }
}
