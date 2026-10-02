import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { t } from "../i18n/t.js";
import type { LocationSummary } from "../api/client.js";

/** Returns "" (no location) when the list is empty. */
export function resolveLocationSelection(locations: LocationSummary[], current: string): string {
  if (locations.length === 0) return "";
  if (locations.some((l) => l.id === current)) return current;
  return locations[0]!.id;
}

/**
 * `:host { display: contents }` so the widget adds no box of its own: the dropdown participates
 * directly in the parent's layout, and when the widget renders nothing it contributes no phantom flex
 * gap.
 */
@customElement("dashboard-location-picker")
export class LocationPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .picker {
        /* The gap below the picker (before the table/next control) — the margin the roster/planned screens use
         * their sibling week picker so the two align in their shared flex row. Rendered only when the
         * dropdown is (nothing renders at one location or none), so a hidden picker leaves no phantom gap. */
        margin-bottom: var(--wt-space-4);
      }
    `,
  ];

  @property({ attribute: false }) locations: LocationSummary[] = [];

  @property() selected = "";

  @property() label = "";

  #onChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const locationId = event.detail.value;
    this.dispatchEvent(
      new CustomEvent<{ locationId: string }>("location-changed", {
        detail: { locationId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult | typeof nothing {
    if (this.locations.length <= 1) return nothing;
    return html`
      <wt-combobox
        class="picker"
        data-test="location-select"
        name="location"
        label=${this.label}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.locations.map((l) => ({ value: l.id, label: l.name }))}
        .value=${this.selected}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onChange(e)}
      ></wt-combobox>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-location-picker": LocationPicker;
  }
}
