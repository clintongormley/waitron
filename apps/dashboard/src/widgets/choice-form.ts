import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles, currentContentLanguages, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { type DietarySuitability, type ModifierEffects, type VatClass } from "../api/client.js";
import { vatClassName } from "../i18n/domain.js";
import { isModifierPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { t } from "../i18n/t.js";
import "./allergen-dietary-picker.js";
import type { AllergenDietaryValue } from "./allergen-dietary-picker.js";
import {
  isModifierQuantity,
  nameFields,
  nonBlankNames,
  switchField,
  textField,
  type FieldContext,
} from "./form-fields.js";

/**
 * One modifier choice as this modal edits it: the shared fields (name, availability) plus, for an
 * extra, its price, maximum quantity, tax class and allergen/dietary effects. The consumer (the
 * modifier form) mirrors `available` inline in its table too — one value edited in two places, not
 * two values. `priceDelta`/`maxQuantity`/`vatClass` are absent for an options choice.
 */
export type ChoiceDraft = ModifierEffects & {
  id: string;
  name: Record<string, string>;
  available: boolean;
  priceDelta?: string;
  maxQuantity?: number;
  vatClass?: VatClass | null;
};

@customElement("dashboard-choice-form")
export class ChoiceForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      summary {
        cursor: pointer;
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) locales: string[] = [];
  @property() kind: "extras" | "options" = "extras";
  @property({ attribute: false }) value: ChoiceDraft | null = null;
  @state() private errors: Record<string, string> = {};
  @state() private name: Record<string, string> = {};
  @state() private available = true;
  @state() private priceDelta = "0.00";
  @state() private maxQuantity = "1";
  @state() private vatClass?: VatClass | null;
  @state() private effects: ModifierEffects = {};
  override willUpdate(changed: PropertyValues<this>): void {
    if (!(changed.has("open") && this.open) && !changed.has("value")) return;
    const value = this.value;
    this.#choiceId = value?.id ?? crypto.randomUUID();
    this.name = { ...value?.name };
    this.available = value?.available ?? true;
    this.priceDelta = value?.priceDelta ?? "0.00";
    this.maxQuantity = value?.maxQuantity !== undefined ? String(value.maxQuantity) : "1";
    this.vatClass = value?.vatClass;
    this.effects = value
      ? {
          ...(value.addAllergens === undefined ? {} : { addAllergens: value.addAllergens }),
          ...(value.suitableFor === undefined ? {} : { suitableFor: value.suitableFor }),
        }
      : {};
    this.errors = {};
  }
  #choiceId = "";
  #error(key: string): string {
    return this.errors[key] ?? "";
  }
  #patch(patch: Partial<ModifierEffects>): void {
    this.effects = { ...this.effects, ...patch };
  }
  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent("wt-choice-cancel", { detail: {}, bubbles: true, composed: true }),
    );
  }
  #save(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const errors: Record<string, string> = {};
    const language = currentContentLanguages().defaultLanguage;
    if (!this.name[language]?.trim()) errors.name = t("modifiers.name_required");
    // The price and quantity checks use the server's limits, so either value it would refuse is
    // caught here, on its own field, rather than as a problem with the whole modifier.
    if (this.kind === "extras") {
      if (!isModifierPrice(this.priceDelta)) errors.priceDelta = t("modifiers.price_invalid");
      if (!isModifierQuantity(this.maxQuantity))
        errors.maxQuantity = t("modifiers.quantity_invalid");
    }
    this.errors = errors;
    if (Object.keys(errors).length) return;
    const value: ChoiceDraft = {
      id: this.#choiceId,
      name: nonBlankNames(this.name),
      available: this.available,
      ...this.effects,
      // The client always sends an explicit suitability list (never null/absent); the contract
      // normalises anyway. Positive: the labels the choice is suitable for.
      suitableFor: this.effects.suitableFor ?? [],
      ...(this.kind === "extras"
        ? {
            priceDelta: this.priceDelta,
            maxQuantity: Number(this.maxQuantity),
            ...(this.vatClass === undefined ? {} : { vatClass: this.vatClass }),
          }
        : {}),
    };
    this.dispatchEvent(
      new CustomEvent("wt-choice-save", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  #fields(): FieldContext {
    return { busy: this.busy, locales: this.locales, error: (key) => this.#error(key) };
  }
  #pickerValue(): AllergenDietaryValue {
    return {
      allergens: Object.keys(this.effects.addAllergens ?? {}),
      dietary: (this.effects.suitableFor ?? []) as DietarySuitability[],
    };
  }
  #onPicker(event: CustomEvent<{ value: AllergenDietaryValue }>): void {
    event.stopPropagation();
    const v = event.detail.value;
    this.#patch({
      // Every allergen the choice contains is recorded as `contains`. The follow-up allergen spec
      // (docs/superpowers/specs — contains/may-contain removal) deletes this presence wrapper.
      addAllergens: v.allergens.length
        ? Object.fromEntries(v.allergens.map((code) => [code, { presence: "contains" as const }]))
        : {},
      suitableFor: v.dietary,
    });
  }
  #effects() {
    return html`<details open>
      <summary>${t("modifiers.effects")}</summary>
      <div class="fields">
        <dashboard-allergen-dietary-picker
          .busy=${this.busy}
          .value=${this.#pickerValue()}
          @wt-change=${(e: CustomEvent<{ value: AllergenDietaryValue }>) => this.#onPicker(e)}
        ></dashboard-allergen-dietary-picker>
      </div>
    </details>`;
  }
  override render() {
    return html`<wt-modal
      .open=${this.open}
      heading=${this.name[currentContentLanguages().defaultLanguage] || t("modifiers.choice")}
      @wt-close=${(event: Event) => this.#cancel(event)}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>('[data-test="choice-save"]'),
        );
      }}
    >
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${Object.values(this.errors)}
      ></wt-form-error-summary>
      <div class="fields">
        ${nameFields(this.#fields(), "name", t("modifiers.name"), this.name, (name) => {
          this.name = name;
        })}
        ${switchField(
          this.#fields(),
          "available",
          t("modifiers.available"),
          this.available,
          (available) => {
            this.available = available;
          },
        )}
        ${
          this.kind === "extras"
            ? html`${textField(
                  this.#fields(),
                  "priceDelta",
                  t("modifiers.price"),
                  this.priceDelta,
                  (priceDelta) => {
                    this.priceDelta = priceDelta;
                  },
                  true,
                )}${textField(
                  this.#fields(),
                  "maxQuantity",
                  t("modifiers.max_quantity"),
                  this.maxQuantity,
                  (maxQuantity) => {
                    this.maxQuantity = maxQuantity;
                  },
                  true,
                )}<label
                  >${t("modifiers.vat")}<select
                    name="vatClass"
                    .disabled=${this.busy}
                    @change=${(event: Event) => {
                      event.stopPropagation();
                      this.vatClass =
                        ((event.target as HTMLSelectElement).value as VatClass) || null;
                    }}
                  >
                    <option value="" ?selected=${!this.vatClass}>
                      ${t("modifiers.inherit_vat")}
                    </option>
                    ${(["general", "reduced", "super_reduced", "zero"] as const).map((value) => html`<option value=${value} ?selected=${this.vatClass === value}>${vatClassName(value)}</option>`)}
                  </select></label
                >`
            : nothing
        }
        ${this.#effects()}
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          data-test="choice-cancel"
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-test="choice-save"
          variant="primary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#save(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      ></wt-modal
    >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-choice-form": ChoiceForm;
  }
}
