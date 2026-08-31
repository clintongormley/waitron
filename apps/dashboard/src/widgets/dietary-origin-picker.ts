import { LitElement, type PropertyValues, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { DIETARY_ORIGINS, type DietaryOrigin } from "../api/client.js";

/**
 * The management dashboard's DIETARY-ORIGIN PICKER — the ingredient-form counterpart of the allergen
 * picker, but a single choice rather than a 14-code grid. A labelled native `<select>` over the eight
 * `DIETARY_ORIGINS`, PLUS a leading empty "not categorised" option that maps to `null`: an ingredient
 * with a null origin is UNCATEGORISED, which makes every product using it publish diet-PENDING (rather
 * than a false "vegan"), so "not categorised" must be a first-class, selectable state — never a
 * silent absence.
 *
 * SEEDING. The `value` property is the seed (the ingredient form binds it from a loaded ingredient's
 * `dietaryOrigin`, only on reseed — never to the live value — so it does not fight the operator's
 * edits). `willUpdate` reconstructs the internal `selected` state once when `value` changes; after
 * that the `<select>`'s own change drives `selected`. The picker holds no API and validates nothing
 * client-side — the server's `validateOrigin` (`diet.invalid_origin`) stays the authority; the picker
 * only reports the chosen token (or null) through a bubbling, composed `origin-changed { origin }` so
 * the ingredient form can read it without reaching into this widget's internals.
 */
@customElement("dashboard-dietary-origin-picker")
export class DietaryOriginPicker extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      label {
        display: block;
        margin-bottom: var(--wt-space-2);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
      select {
        width: 100%;
      }
    `,
  ];

  /**
   * The SEED origin for edit mode — the ingredient form sets this from a loaded ingredient's
   * `dietaryOrigin` so the picker opens pre-filled. `null` (the default, and a CREATE) seeds the
   * UNCATEGORISED state (the empty option). Bound only on (re)seed by the form, never to the live
   * value, so it does not fight the operator's edits.
   */
  @property({ attribute: false }) value: DietaryOrigin | null = null;

  /** The live selection. `null` is the not-categorised state; a token is a chosen origin. */
  @state() private selected: DietaryOrigin | null = null;

  /**
   * Seed `selected` from a freshly-assigned `value` (edit-mode pre-fill). Runs only when `value`
   * actually changes — an operator edit changes `selected`, not `value`, so it is never re-seeded out
   * from under them. Does NOT emit `origin-changed` — seeding is not an operator change.
   */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("value")) this.selected = this.value;
  }

  /**
   * The `<select>` changed. Native `change` is `composed: false`, so `stopPropagation` here is
   * defensive consistency with the composed handlers elsewhere, not a boundary guard. The empty
   * option's value (`""`) maps back to `null` (uncategorised); any other value is a taxonomy token.
   */
  #onChange(event: Event): void {
    event.stopPropagation();
    const raw = (event.target as HTMLSelectElement).value;
    this.selected = raw === "" ? null : (raw as DietaryOrigin);
    this.#emit();
  }

  /**
   * Announce the selection. `bubbles`+`composed` so it crosses this widget's shadow boundary to the
   * ingredient form, which folds it into the create/update body.
   */
  #emit(): void {
    this.dispatchEvent(
      new CustomEvent<{ origin: DietaryOrigin | null }>("origin-changed", {
        detail: { origin: this.selected },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <label for="origin">${t("origin.label")}</label>
      <select id="origin" data-test="origin" @change=${(e: Event) => this.#onChange(e)}>
        <option value="" ?selected=${this.selected === null}>${t("origin.uncategorised")}</option>
        ${DIETARY_ORIGINS.map(
          (origin) =>
            html`<option value=${origin} ?selected=${this.selected === origin}>
              ${t(`origin.${origin}`)}
            </option>`,
        )}
      </select>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-dietary-origin-picker": DietaryOriginPicker;
  }
}
