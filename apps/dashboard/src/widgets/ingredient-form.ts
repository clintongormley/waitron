import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { sameValue } from "./product-editor-model.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "./allergen-picker.js";
import "./dietary-origin-picker.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
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

/** `name` marks the name field; `_form` is shown in the bottom message alone. */
export type IngredientFormErrors = Partial<Record<"name" | "_form", string>>;

/** A refused ingredient write, keyed by this form's fields. */
export function ingredientRefusalErrors(error: unknown): IngredientFormErrors {
  const code = codeOf(error);
  const params = (error as { params?: { field?: unknown } }).params ?? {};
  if (code === "management.request_invalid" && params.field === "name")
    return { name: codeMessage(code) };
  return { _form: codeMessage(code) };
}

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
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;

  @property({ attribute: false }) ingredient: Ingredient | null = null;

  @property({ type: Boolean }) busy = false;

  @property({ attribute: false }) fieldErrors: IngredientFormErrors = {};

  @state() private name = "";
  @state() private active = true;
  // Kept SEPARATE from the picker's `declaration` seed (`seedAllergens`) so a user edit — which
  // changes this — never re-seeds the picker.
  @state() private allergens: AllergenDeclaration = null;
  @state() private seedAllergens: AllergenDeclaration = null;
  @state() private dietaryOrigin: DietaryOrigin | null = null;
  @state() private seedOrigin: DietaryOrigin | null = null;
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  #scope?: DraftScope<IngredientPatch>;
  #leave?: LeaveCoordinator;
  #baseline?: IngredientPatch;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    this.isConnected &&
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #current(): IngredientPatch {
    return {
      name: this.name,
      active: this.active,
      allergens: this.allergens,
      dietaryOrigin: this.dietaryOrigin,
    };
  }

  #restore(value: IngredientPatch): void {
    this.name = value.name ?? "";
    this.active = value.active ?? true;
    this.allergens = structuredClone(value.allergens ?? null);
    this.seedAllergens = this.allergens;
    this.dietaryOrigin = value.dietaryOrigin ?? null;
    this.seedOrigin = this.dietaryOrigin;
  }

  closeSaved(submitted: IngredientInput | IngredientPatch): void {
    this.#baseline = {
      name: submitted.name ?? this.name,
      active: "active" in submitted ? submitted.active : true,
      allergens: submitted.allergens ?? null,
      dietaryOrigin: submitted.dietaryOrigin ?? null,
    };
    this.#scope?.commit(this.#baseline);
    this.open = false;
    this.shadowRoot!.querySelector("wt-dialog")!.closeAfter("saved");
  }

  /** Allergens are seeded into BOTH the live value (`allergens`, what a save emits) and the picker's
   * `declaration` seed (`seedAllergens`); the picker does not emit on seed, so the form must seed its
   * own live copy too. */
  override willUpdate(changed: PropertyValues): void {
    const previous = changed.get("ingredient") as Ingredient | null | undefined;
    const reopened =
      (changed.has("open") && this.open) ||
      (changed.has("ingredient") && this.ingredient?.id !== previous?.id);
    if (changed.has("fieldErrors") || reopened) this.dismissed = new Set();
    if (reopened) {
      this.#scope?.dispose();
      this.#scope = undefined;
      const ing = this.ingredient;
      this.#restore({
        name: ing?.name ?? "",
        active: ing?.active ?? true,
        allergens: ing?.allergens ?? null,
        dietaryOrigin: ing?.dietaryOrigin ?? null,
      });
      this.attempted = false;
      this.#baseline = structuredClone(this.#current());
    }
    if (changed.has("busy") && this.busy && this.#baseline) this.#scope?.commit(this.#baseline);
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.#baseline = undefined;
    } else if (this.isConnected && !this.#scope) {
      this.#baseline ??= structuredClone(this.#current());
      const { coordinator, scope } = draftScopeFor<IngredientPatch>(this, {
        id: this,
        current: () => this.#current(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        restore: (value) => this.#restore(value),
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(this.#baseline);
    }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has("fieldErrors") && this.fieldErrors.name)
      void focusFirstInvalid(this.shadowRoot!);
  }

  #onNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    this.name = event.detail.value;
    this.#scope?.changed();
    this.dismissed = new Set([...this.dismissed, "name"]);
  }

  #onActiveChange(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    this.active = event.detail.checked;
    this.#scope?.changed();
  }

  #onAllergensChanged(event: CustomEvent<{ value: AllergenDeclaration }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    this.allergens = event.detail.value;
    this.#scope?.changed();
  }

  #onOriginChanged(event: CustomEvent<{ origin: DietaryOrigin | null }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    this.dietaryOrigin = event.detail.origin;
    this.#scope?.changed();
  }

  #nameError(): string {
    return this.name.trim() === "" ? codeMessage("ingredient.name_required") : "";
  }

  #refused(key: keyof IngredientFormErrors): string {
    return this.dismissed.has(key) ? "" : (this.fieldErrors[key] ?? "");
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.dismissed = new Set([...this.dismissed, ...Object.keys(this.fieldErrors)]);
    if (this.#nameError() !== "") {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }

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

  #onClose(): void {
    this.open = false;
  }

  override render() {
    const invalidName = this.attempted ? this.#nameError() : "";
    const saveAction = saveActionState(this.#scope);
    const nameError = invalidName || this.#refused("name");
    const bottom = [this.#refused("_form"), nameError === "" ? "" : t("form.fix_fields")]
      .filter((message) => message !== "")
      .join(" ");
    return html`
      <wt-dialog
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
        heading=${this.ingredient ? t("ingredient.edit") : t("ingredient.new")}
        .open=${this.open}
        .dismissible=${!this.busy}
        .beforeClose=${this.#leave ? this.#beforeClose : undefined}
        @wt-close=${() => this.#onClose()}
      >
        <wt-input
          class="field"
          data-test="name"
          name="name"
          label=${t("ingredient.name")}
          required
          error=${nameError}
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
        <wt-form-actions slot="footer" .error=${bottom}>
          <wt-button
            variant=${saveAction.variant}
            data-test="confirm"
            ?disabled=${saveAction.unchanged || this.busy || invalidName !== ""}
            @click=${(e: Event) => this.#confirm(e)}
            >${this.ingredient ? t("action.save") : t("action.create")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-ingredient-form": IngredientForm;
  }
}
