import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-icon.js";
import {
  ALLERGEN_CODES,
  CEREAL_KINDS,
  NUT_KINDS,
  type Kind,
} from "@waitron/catalogue/src/allergens.js";
import { DIETARY_LABELS, type DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
import type { InheritedValues } from "@waitron/catalogue/src/product-types.js";
import { allergenName, allergenKindName } from "../i18n/domain.js";
import { fill, t } from "../i18n/t.js";
import {
  dietaryPresentation,
  type NutritionChange,
  type NutritionValue,
} from "./product-nutrition.js";

@customElement("dashboard-product-nutrition-picker")
export class ProductNutritionPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-4);
      }
      .group {
        display: grid;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      .heading {
        font-weight: var(--wt-font-weight-bold);
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--wt-space-1);
        min-height: var(--wt-tap-min);
        max-width: 100%;
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .chip[aria-pressed="true"] {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        border-color: var(--wt-color-primary);
      }
      .chip.none {
        border-style: dashed;
      }
      .chip.quiet[aria-pressed="true"] {
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text);
        border-color: var(--wt-color-border);
      }
      .chip:disabled {
        cursor: default;
      }
      .inherited {
        font-style: italic;
      }
      .busy {
        opacity: var(--wt-opacity-disabled);
        cursor: default;
      }
      .kinds {
        flex: 1 0 calc(100% - var(--wt-space-3));
        min-width: 0;
        display: grid;
        gap: var(--wt-space-2);
        margin-inline-start: var(--wt-space-3);
        padding-inline-start: var(--wt-space-3);
        border-inline-start: 1px solid var(--wt-color-primary);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        margin: 0;
      }
      .status {
        color: var(--wt-color-text-muted);
      }
      .status.unreviewed {
        color: var(--wt-color-warning);
      }
      wt-icon {
        flex: none;
      }
    `,
  ];
  @property({ attribute: false }) value: NutritionValue = {
    allergens: null,
    dietaryDeclarations: [],
  };
  @property({ attribute: false }) inherited: InheritedValues | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) errors: Record<string, string> = {};

  #emit(event: Event, change: NutritionChange): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent<NutritionChange>("wt-nutrition-change", {
        detail: change,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #chip(
    choice: string,
    label: string,
    selected: boolean,
    handler: (event: Event) => void,
    { icon = "", readonly = false, inherited = false, dashed = false, field = "" } = {},
  ) {
    return html`<button
      type="button"
      name=${field || choice}
      data-choice=${choice}
      class=${`chip ${readonly || inherited ? "quiet" : ""} ${inherited ? "inherited" : ""} ${dashed ? "none" : ""} ${this.busy ? "busy" : ""}`}
      aria-pressed=${String(selected)}
      ?disabled=${this.busy || readonly}
      aria-invalid=${this.errors[field] ? "true" : nothing}
      aria-describedby=${this.errors[field] ? `${field}-error` : nothing}
      @click=${(event: Event) => {
        if (readonly) {
          event.stopPropagation();
          return;
        }
        handler(event);
      }}
    >
      ${selected ? html`<span aria-hidden="true">✓</span>` : nothing}${icon ? html`<wt-icon name=${icon}></wt-icon>` : nothing}<span
        >${label}</span
      >
    </button>`;
  }

  #allergen(code: string, event: Event): void {
    const next = structuredClone(this.value.allergens ?? {});
    if (Object.hasOwn(next, code)) delete next[code];
    else next[code] = {};
    this.#emit(event, { field: "allergens", value: Object.keys(next).length ? next : null });
  }

  #kind(code: "gluten" | "nuts", kind: Kind, event: Event): void {
    if (this.value.allergens === null) {
      event.stopPropagation();
      return;
    }
    const next = structuredClone(this.value.allergens);
    const kinds = next[code]?.kinds ?? [];
    next[code] = {
      kinds: kinds.includes(kind) ? kinds.filter((entry) => entry !== kind) : [...kinds, kind],
    };
    this.#emit(event, { field: "allergens", value: next });
  }

  #diet(label: DietaryLabel, event: Event): void {
    const chosen = new Set(this.value.dietaryDeclarations ?? []);
    if (chosen.has(label)) chosen.delete(label);
    else chosen.add(label);
    const next = DIETARY_LABELS.filter((entry) => chosen.has(entry));
    this.#emit(event, {
      field: "dietaryDeclarations",
      value: this.inherited && !next.length ? null : next,
    });
  }

  focusField(field: string): void {
    this.shadowRoot?.querySelector<HTMLElement>(`[name="${field}"]:not(:disabled)`)?.focus();
  }

  #error(field: string): TemplateResult | typeof nothing {
    return this.errors[field]
      ? html`<p class="error" role="alert" id=${`${field}-error`}>${this.errors[field]}</p>`
      : nothing;
  }

  #kinds(
    code: "gluten" | "nuts",
    effective: NonNullable<NutritionValue["allergens"]>,
    inheriting: boolean,
  ) {
    const field = `allergens-${code}`;
    return html`<div
      class="kinds"
      data-field=${field}
      role="group"
      aria-label=${allergenName(code)}
    >
      <div class="choices">
        ${(code === "gluten" ? CEREAL_KINDS : NUT_KINDS).map((kind) =>
          this.#chip(
            `kind-${code}-${kind}`,
            allergenKindName(kind),
            effective[code]!.kinds?.includes(kind) ?? false,
            (event) => this.#kind(code, kind, event),
            { readonly: inheriting, inherited: inheriting, field },
          ),
        )}
      </div>
      ${this.#error(field)}
    </div>`;
  }

  override render() {
    const inheriting = this.inherited !== null && this.value.allergens === null;
    const effective = inheriting ? this.inherited!.allergens : this.value.allergens;
    const none = this.value.allergens !== null && Object.keys(this.value.allergens).length === 0;
    const dietary = dietaryPresentation(
      this.inherited ? this.value.dietaryDeclarations : (this.value.dietaryDeclarations ?? []),
      this.inherited?.dietaryDeclarations ?? [],
    );
    return html`<div class="group" role="group" aria-label=${t("modifiers.allergens")}>
        <span class="heading">${t("modifiers.allergens")}</span>
        <div class="choices">
          ${
            this.inherited
              ? this.#chip(
                  "same-as",
                  fill("editor.nutrition.same_as", { parent: this.inherited.name }),
                  inheriting,
                  (event) => this.#emit(event, { field: "allergens", value: null }),
                )
              : nothing
          }
          ${this.#chip(
            "none",
            t("editor.nutrition.contains_none"),
            none,
            (event) => this.#emit(event, { field: "allergens", value: none ? null : {} }),
            { dashed: true, field: "allergens" },
          )}
        </div>
        ${inheriting && (effective === null || Object.keys(effective).length === 0) ? html`<span data-test="inherited-status" class=${`status inherited ${effective === null ? "unreviewed" : ""}`}>${t(effective === null ? "editor.allergens_unreviewed" : "editor.nutrition.allergens_none")}</span>` : nothing}
        <div class="choices">
          ${ALLERGEN_CODES.map((code) => {
            const selected = effective !== null && Object.hasOwn(effective, code);
            return html`${this.#chip(
              `allergen-${code}`,
              allergenName(code),
              selected,
              (event) => this.#allergen(code, event),
              {
                icon: `allergen-${code}`,
                readonly: inheriting && selected,
                inherited: inheriting && selected,
              },
            )}${selected && (code === "gluten" || code === "nuts") ? this.#kinds(code, effective!, inheriting) : nothing}`;
          })}
        </div>
        ${this.#error("allergens")}
      </div>
      <div class="group" role="group" aria-label=${t("editor.nutrition.dietary")}>
        <span class="heading">${t("editor.nutrition.dietary")}</span>
        <div class="choices">
          ${DIETARY_LABELS.map((label) => {
            const implied = dietary.implied.find((entry) => entry.label === label);
            const selected = dietary.chosen.includes(label) || implied !== undefined;
            const suffix = implied
              ? ` ${fill("editor.nutrition.from", { label: t(`editor.diet.${implied.from}`) })}`
              : "";
            return this.#chip(
              `diet-${label}`,
              `${t(`editor.diet.${label}`)}${suffix}`,
              selected,
              (event) => this.#diet(label, event),
              {
                icon: `diet-${label}`,
                readonly: !dietary.inherited && implied !== undefined,
                inherited: dietary.inherited && selected,
              },
            );
          })}
        </div>
      </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-nutrition-picker": ProductNutritionPicker;
  }
}
