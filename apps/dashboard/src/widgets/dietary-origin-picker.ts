import { LitElement, type PropertyValues, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
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
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ attribute: false }) value: DietaryOrigin | null = null;

  @state() private selected: DietaryOrigin | null = null;

  // An operator edit changes `selected`, not `value`, so it is never re-seeded out from under them.
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("value")) this.selected = this.value;
  }

  #onChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const raw = event.detail.value;
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
      <wt-combobox
        name="origin"
        data-test="origin"
        label=${t("origin.label")}
        search="auto"
        placeholder=${t("origin.uncategorised")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${[
          { value: "", label: t("origin.uncategorised") },
          ...DIETARY_ORIGINS.map((origin) => ({ value: origin, label: t(`origin.${origin}`) })),
        ]}
        .value=${this.selected ?? ""}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onChange(e)}
      ></wt-combobox>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-dietary-origin-picker": DietaryOriginPicker;
  }
}
