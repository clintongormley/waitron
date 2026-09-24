import { LitElement, type PropertyValues, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { DIETARY_ORIGINS, type DietaryOrigin } from "../api/client.js";

/**
 * A leading empty "not categorised" option maps to `null`: an ingredient with a null origin is
 * UNCATEGORISED, which leaves the DERIVED vegan and vegetarian labels of every product whose recipe
 * uses it "unknown" rather than a false "vegan" (a staff override can still set them), so "not
 * categorised" must be a first-class, selectable state — never a silent absence.
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

  @property({ attribute: false }) value: DietaryOrigin | null = null;

  @state() private selected: DietaryOrigin | null = null;

  // An operator edit changes `selected`, not `value`, so it is never re-seeded out from under them.
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("value")) this.selected = this.value;
  }

  #onChange(event: Event): void {
    event.stopPropagation();
    const raw = (event.target as HTMLSelectElement).value;
    this.selected = raw === "" ? null : (raw as DietaryOrigin);
    this.#emit();
  }

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
