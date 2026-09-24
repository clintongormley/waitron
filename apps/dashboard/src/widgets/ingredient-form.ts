import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "./allergen-picker.js";
import "./dietary-origin-picker.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  AllergenDeclaration,
  DietaryOrigin,
  Ingredient,
  IngredientInput,
  IngredientPatch,
} from "../api/client.js";

/**
 * `allergens` is OMITTED (never sent as `null`) when the picker is PENDING, because the server's
 * `createIngredient` throws `allergen.invalid_code` on an explicit `allergens: null`. `{}` is a
 * REVIEWED-NONE declaration, distinct from PENDING, and IS sent.
 */
export type CreateIngredientDetail = IngredientInput;

export interface UpdateIngredientDetail {
  id: string;
  patch: IngredientPatch;
}

/**
 * The form does NOT call the API and does NOT close itself on confirm — the screen closes it on a
 * successful create/update, so a rejected write leaves the entered values in place. On PATCH
 * `allergens: null` is legal and clears the declaration back to PENDING, so the edit patch always
 * carries the current value, null included.
 */
@customElement("dashboard-ingredient-form")
export class IngredientForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;

  @property({ attribute: false }) ingredient: Ingredient | null = null;

  @property({ type: Boolean }) busy = false;

  @state() private name = "";
  @state() private active = true;
  // Kept SEPARATE from the picker's `declaration` seed (`seedAllergens`) so a user edit — which
  // changes this — never re-seeds the picker.
  @state() private allergens: AllergenDeclaration = null;
  @state() private seedAllergens: AllergenDeclaration = null;
  @state() private dietaryOrigin: DietaryOrigin | null = null;
  @state() private seedOrigin: DietaryOrigin | null = null;
  @state() private validationError: string | null = null;

  /** Allergens are seeded into BOTH the live value (`allergens`, what a save emits) and the picker's
   * `declaration` seed (`seedAllergens`); the picker does not emit on seed, so the form must seed its
   * own live copy too, or an untouched edit would re-save the wrong value. */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("ingredient") && !(changed.has("open") && this.open)) return;
    const ing = this.ingredient;
    this.name = ing?.name ?? "";
    this.active = ing?.active ?? true;
    this.allergens = ing?.allergens ?? null;
    this.seedAllergens = ing?.allergens ?? null;
    this.dietaryOrigin = ing?.dietaryOrigin ?? null;
    this.seedOrigin = ing?.dietaryOrigin ?? null;
    this.validationError = null;
  }

  #onNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.name = event.detail.value;
    if (this.validationError) this.validationError = null;
  }

  #onActiveChange(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.active = event.detail.checked;
  }

  #onAllergensChanged(event: CustomEvent<{ value: AllergenDeclaration }>): void {
    event.stopPropagation();
    this.allergens = event.detail.value;
  }

  #onOriginChanged(event: CustomEvent<{ origin: DietaryOrigin | null }>): void {
    event.stopPropagation();
    this.dietaryOrigin = event.detail.origin;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    if (this.name.trim() === "") {
      this.validationError = "ingredient.name_required";
      return;
    }
    this.validationError = null;

    if (this.ingredient) {
      const patch: IngredientPatch = {
        name: this.name,
        active: this.active,
        allergens: this.allergens,
        dietaryOrigin: this.dietaryOrigin,
      };
      this.dispatchEvent(
        new CustomEvent<UpdateIngredientDetail>("update-ingredient", {
          detail: { id: this.ingredient.id, patch },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    const body: CreateIngredientDetail = { name: this.name };
    if (this.allergens !== null) body.allergens = this.allergens;
    if (this.dietaryOrigin !== null) body.dietaryOrigin = this.dietaryOrigin;
    this.dispatchEvent(
      new CustomEvent<CreateIngredientDetail>("create-ingredient", {
        detail: body,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Deliberately does not `stopPropagation`: the composed `wt-close` must bubble on to the screen
   * (the owner of the open state). */
  #onClose(): void {
    this.open = false;
  }

  override render() {
    return html`
      <wt-dialog
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
        heading=${this.ingredient ? t("ingredient.edit") : t("ingredient.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        <wt-input
          class="field"
          data-test="name"
          label=${t("ingredient.name")}
          .value=${this.name}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNameChange(e)}
        ></wt-input>
        ${
          // EDIT-ONLY: `IngredientInput` carries no `active` (a create is always active server-side).
          this.ingredient
            ? html`<wt-switch
                class="field"
                data-test="active"
                label=${t("ingredient.active")}
                .checked=${this.active}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onActiveChange(e)}
              ></wt-switch>`
            : nothing
        }
        <dashboard-dietary-origin-picker
          class="field"
          data-test="dietary-origin"
          .value=${this.seedOrigin}
          @origin-changed=${(e: CustomEvent<{ origin: DietaryOrigin | null }>) =>
            this.#onOriginChanged(e)}
        ></dashboard-dietary-origin-picker>
        <dashboard-allergen-picker
          data-test="allergens"
          .declaration=${this.seedAllergens}
          @wt-allergens-change=${(e: CustomEvent<{ value: AllergenDeclaration }>) =>
            this.#onAllergensChanged(e)}
        ></dashboard-allergen-picker>
        ${
          this.validationError
            ? html`<p class="error" role="alert" data-test="error">
                ${codeMessage(this.validationError)}
              </p>`
            : nothing
        }
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          ?disabled=${this.busy}
          @click=${(e: Event) => this.#confirm(e)}
          >${this.ingredient ? t("action.save") : t("action.create")}</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-ingredient-form": IngredientForm;
  }
}
