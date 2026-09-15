import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { ALLERGEN_CODES, allergenName } from "../i18n/domain.js";
import { DIETARY_LABELS, type DietaryLabel } from "../api/client.js";
import { t } from "../i18n/t.js";

/**
 * What a caller (a modifier choice today, a product editor later) has said an option does to a
 * dish: the allergens it ADDS, the allergens it REMOVES, and the dietary preferences it rules out.
 * `addAllergens`/`removeAllergens` are always disjoint — the same code cannot be both added and
 * removed — which this widget enforces on every change.
 */
export interface AllergenDietaryValue {
  addAllergens: string[];
  removeAllergens: string[];
  dietary: DietaryLabel[];
}

const EMPTY: AllergenDietaryValue = { addAllergens: [], removeAllergens: [], dietary: [] };

/**
 * Three multi-select comboboxes over the shared allergen and dietary vocabularies. It is domain-blind:
 * it knows nothing about modifiers or products, only that a thing can add allergens, remove allergens
 * and invalidate dietary claims. Consumers bind `.value` and listen for `wt-change`.
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

  #onAdd(event: CustomEvent<{ values: string[] }>): void {
    // wt-combobox already stops its own source event; stop this re-dispatched one before we emit ours
    // so a consumer never sees the inner combobox's wt-change alongside the widget's.
    event.stopPropagation();
    const addAllergens = event.detail.values;
    // Disjoint: anything now added is dropped from removes.
    const removeAllergens = this.value.removeAllergens.filter((c) => !addAllergens.includes(c));
    this.#emit({ ...this.value, addAllergens, removeAllergens });
  }

  #onRemove(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    const removeAllergens = event.detail.values;
    const addAllergens = this.value.addAllergens.filter((c) => !removeAllergens.includes(c));
    this.#emit({ ...this.value, addAllergens, removeAllergens });
  }

  #onDietary(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    this.#emit({ ...this.value, dietary: event.detail.values as DietaryLabel[] });
  }

  override render() {
    return html`
      <wt-combobox
        multiple
        data-test="add-allergens"
        label=${t("modifiers.add_allergen")}
        ?disabled=${this.busy}
        .options=${this.#allergenOptions()}
        .values=${this.value.addAllergens}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onAdd(e)}
      ></wt-combobox>
      <wt-combobox
        multiple
        data-test="remove-allergens"
        label=${t("modifiers.remove_allergen")}
        ?disabled=${this.busy}
        .options=${this.#allergenOptions()}
        .values=${this.value.removeAllergens}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onRemove(e)}
      ></wt-combobox>
      <wt-combobox
        multiple
        data-test="dietary"
        label=${t("modifiers.invalidates_dietary")}
        ?disabled=${this.busy}
        .options=${DIETARY_LABELS.map((l) => ({ value: l, label: t(`editor.diet.${l}`) }))}
        .values=${this.value.dietary}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onDietary(e)}
      ></wt-combobox>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-allergen-dietary-picker": AllergenDietaryPicker;
  }
}
