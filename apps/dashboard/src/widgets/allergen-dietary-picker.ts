import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { ALLERGEN_CODES, allergenName } from "../i18n/domain.js";
import { DIETARY_SUITABILITY, type DietarySuitability } from "../api/client.js";
import { t } from "../i18n/t.js";

/**
 * What a caller (a modifier choice today, a product editor later) has said an option is: the
 * allergens it CONTAINS, and the dietary preferences it is SUITABLE FOR. Both are plain code lists.
 */
export interface AllergenDietaryValue {
  allergens: string[];
  dietary: DietarySuitability[];
}

const EMPTY: AllergenDietaryValue = { allergens: [], dietary: [] };

/**
 * One allergen multi-select plus a four-item dietary checklist over the shared vocabularies. It is
 * domain-blind: it knows nothing about modifiers or products, only that a thing contains allergens
 * and is suitable for dietary preferences. Consumers bind `.value` and listen for `wt-change`.
 */
@customElement("dashboard-allergen-dietary-picker")
export class AllergenDietaryPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-3);
      }
      fieldset {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      legend {
        padding-inline: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
      }
      .diet {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        font: inherit;
      }
      .diet input {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        accent-color: var(--wt-color-primary);
      }
    `,
  ];

  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) value: AllergenDietaryValue = EMPTY;

  #emit(next: AllergenDietaryValue): void {
    this.value = next;
    this.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: next }, bubbles: true, composed: true }),
    );
  }

  #allergenOptions() {
    return ALLERGEN_CODES.map((code) => ({ value: code, label: allergenName(code) }));
  }

  #onAllergens(event: CustomEvent<{ values: string[] }>): void {
    // wt-combobox already stops its own source event; stop this re-dispatched one before we emit ours
    // so a consumer never sees the inner combobox's wt-change alongside the widget's.
    event.stopPropagation();
    this.#emit({ ...this.value, allergens: event.detail.values });
  }

  #onDietary(event: Event): void {
    // The native checkbox change does not compose out of the shadow root, but stopping it keeps the
    // "re-emit exactly one wt-change" contract explicit rather than relying on that detail.
    event.stopPropagation();
    const chosen = new Set(this.value.dietary);
    const input = event.target as HTMLInputElement;
    if (input.checked) chosen.add(input.value as DietarySuitability);
    else chosen.delete(input.value as DietarySuitability);
    // Keep the canonical DIETARY_SUITABILITY order so the emitted list is deterministic.
    this.#emit({
      ...this.value,
      dietary: DIETARY_SUITABILITY.filter((label) => chosen.has(label)),
    });
  }

  override render() {
    return html`
      <wt-combobox
        multiple
        data-test="allergens"
        label=${t("modifiers.allergens")}
        ?disabled=${this.busy}
        .options=${this.#allergenOptions()}
        .values=${this.value.allergens}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onAllergens(e)}
      ></wt-combobox>
      <fieldset data-test="dietary">
        <legend>${t("modifiers.invalidates_dietary")}</legend>
        ${DIETARY_SUITABILITY.map(
          (label) =>
            html`<label class="diet"
              ><input
                type="checkbox"
                name=${`diet-${label}`}
                value=${label}
                ?disabled=${this.busy}
                .checked=${this.value.dietary.includes(label)}
                @change=${(e: Event) => this.#onDietary(e)}
              /><span>${t(`editor.diet.${label}`)}</span></label
            >`,
        )}
      </fieldset>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-allergen-dietary-picker": AllergenDietaryPicker;
  }
}
