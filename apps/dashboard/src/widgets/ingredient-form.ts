import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
// Value import (not `import type`): pull in the child widget module for its `@customElement` side
// effect, so `<dashboard-allergen-picker>` is registered before this form renders it (the
// widget-registration pattern `product-form` uses for the picker).
import "./allergen-picker.js";
// Value import (side effect): register `<dashboard-dietary-origin-picker>` before this form renders it.
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
 * The `create-ingredient` event detail — the whole form assembled (`IngredientInput`). `allergens` is
 * OMITTED (never sent as `null`) when the picker is PENDING, because the server's `createIngredient`
 * throws `allergen.invalid_code` on an explicit `allergens: null` (the create-vs-patch asymmetry). `{}`
 * is a REVIEWED-NONE declaration, distinct from PENDING, and IS sent. Unlike a product, an ingredient
 * create takes no `active` — the server creates it active, and de/reactivation is a PATCH-only concern.
 */
export type CreateIngredientDetail = IngredientInput;

/** The `update-ingredient` event detail: the ingredient id + a patch of its mutable slice. */
export interface UpdateIngredientDetail {
  id: string;
  patch: IngredientPatch;
}

/**
 * The recipe-authoring dashboard's INGREDIENT FORM: a `wt-dialog` (create + edit) composing the
 * ingredient's own fields — a `name` `wt-input`, an EDIT-ONLY `active` `wt-switch` (`IngredientInput`
 * carries no `active`; de/reactivation is a PATCH-only concern), and the landed
 * `<dashboard-allergen-picker>`. The recipe screen (a later task) drives it by setting `.open` and
 * (for an edit) `.ingredient`, and hears one of two events: `create-ingredient` (create mode) or
 * `update-ingredient { id, patch }` (edit mode). Like `product-form`, the form does NOT call the API
 * and does NOT close itself on confirm — the screen closes it on a successful create/update, so a
 * rejected write leaves the entered values in place.
 *
 * SEEDING. `willUpdate` reseeds every field from `ingredient` whenever `ingredient` changes or the
 * dialog opens, so opening the form for an edit pre-fills it and opening it for a create (`ingredient`
 * null) starts it blank. The allergen picker is seeded through its `declaration` property (a separate
 * `seedAllergens` bound ONLY on reseed, never to the live value, so it does not fight the operator's
 * edits) — seeded from the ingredient's SINGLE `allergens` field (no manual/published split like a
 * product). The picker announces its own changes back through `allergens-changed`, which this form
 * captures (with `stopPropagation`, the house pattern) into `allergens`.
 *
 * THE CREATE-VS-PATCH ALLERGEN ASYMMETRY is load-bearing. On CREATE a PENDING picker (`value === null`)
 * OMITS the `allergens` key entirely — an explicit `allergens: null` makes `createIngredient` throw
 * `allergen.invalid_code`. On PATCH `allergens: null` is legal and clears the declaration back to
 * PENDING, so the edit patch always carries the current value, null included.
 *
 * A non-empty NAME is REQUIRED client-side — the column is NOT NULL and a nameless ingredient is a UI
 * error — so confirm is blocked and a `role="alert"` shown when it is empty. A single-flight `busy`
 * property (set by the screen while a create/update round-trips) makes confirm a no-op and disables the
 * control, mirroring `product-form` — the mutations are not server-idempotent.
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

  /** Whether the dialog is showing. The screen sets this to open the form; it clears on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** The ingredient being edited, or null for a create. Setting it pre-fills every field on the next open. */
  @property({ attribute: false }) ingredient: Ingredient | null = null;

  /** Single-flight gate: the screen sets it true while a create/update is in flight; confirm is a no-op. */
  @property({ type: Boolean }) busy = false;

  @state() private name = "";
  @state() private active = true;
  // The live allergen value (seeded, then updated by the picker's event). Kept SEPARATE from the
  // picker's `declaration` seed (`seedAllergens`) so a user edit — which changes this — never re-seeds
  // the picker and resets its per-code source inputs mid-typing.
  @state() private allergens: AllergenDeclaration = null;
  @state() private seedAllergens: AllergenDeclaration = null;
  // The live dietary origin (seeded, then updated by the picker's event). The picker takes its seed
  // directly from `seedOrigin`; the origin picker does not re-seed on the operator's own edits, so —
  // unlike the allergen picker with its per-code source inputs — the live value can safely share the
  // seed. They are still kept separate for symmetry with the allergen pair and clarity of intent.
  @state() private dietaryOrigin: DietaryOrigin | null = null;
  @state() private seedOrigin: DietaryOrigin | null = null;
  @state() private validationError: string | null = null;

  /**
   * Reseed every field from `ingredient` on an open or an ingredient change. Runs before render, so the
   * pre-filled values are in place for the first paint. A create (`ingredient` null) resets to blanks +
   * defaults; an edit fills from the loaded ingredient. Allergens are seeded into BOTH the live value
   * (`allergens`, what a save emits) and the picker's `declaration` seed (`seedAllergens`); the picker
   * does not emit on seed, so the form must seed its own live copy too, or an untouched edit would
   * re-save the wrong value.
   */
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

  /** Capture the picker's declaration; `stopPropagation` keeps its composed event inside this form. */
  #onAllergensChanged(event: CustomEvent<{ value: AllergenDeclaration }>): void {
    event.stopPropagation();
    this.allergens = event.detail.value;
  }

  /** Capture the origin picker's selection; `stopPropagation` keeps its composed event inside this form. */
  #onOriginChanged(event: CustomEvent<{ origin: DietaryOrigin | null }>): void {
    event.stopPropagation();
    this.dietaryOrigin = event.detail.origin;
  }

  /**
   * Assemble and emit the create/update event. `stopPropagation` keeps the confirm button's own
   * composed `click` inside this shadow boundary. Blocks (no event) on a `busy` gate and on an empty
   * name (a `role="alert"` is shown instead). Then, for an edit, emits `update-ingredient { id, patch }`
   * carrying name+active+allergens (allergens null included, legal to clear on a patch); for a create,
   * emits `create-ingredient` OMITTING `allergens` when the picker is PENDING (the create-vs-patch
   * asymmetry).
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return; // single-flight: a second confirm while one is in flight is ignored
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
        // `null` (uncategorise) is legal on a PATCH, so the origin always travels — unlike the create
        // asymmetry below, where a null origin is omitted to keep the body minimal.
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
    // A null origin (uncategorised) is the server default, so it is OMITTED on create — the picker's
    // empty option leaves the created ingredient uncategorised without sending the key.
    if (this.dietaryOrigin !== null) body.dietaryOrigin = this.dietaryOrigin;
    this.dispatchEvent(
      new CustomEvent<CreateIngredientDetail>("create-ingredient", {
        detail: body,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The dialog closed. Drop our own `open` to stay self-consistent, and — like `product-form` —
   * deliberately do NOT `stopPropagation`: the composed `wt-close` must bubble on to the screen (the
   * owner of the open state). Fields are NOT reset here; `willUpdate` reseeds them on the next open.
   */
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
          // The active toggle is EDIT-ONLY: `IngredientInput` carries no `active` (a create is always
          // active server-side), so rendering it on create would be a control whose value goes nowhere.
          // De/reactivation is a PATCH-only concern, so the switch appears only when editing.
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
          @allergens-changed=${(e: CustomEvent<{ value: AllergenDeclaration }>) =>
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
