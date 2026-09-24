import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import type { LocationSummary } from "../api/client.js";

/** Returns "" (no location) when the list is empty. */
export function resolveLocationSelection(locations: LocationSummary[], current: string): string {
  if (locations.length === 0) return "";
  if (locations.some((l) => l.id === current)) return current;
  return locations[0]!.id;
}

/**
 * The current option is marked via a per-option `.selected` binding — NOT a select-level `.value`,
 * which commits before the `<option>` children exist and would drop a non-first preset.
 *
 * `:host { display: contents }` so the widget adds no box of its own: the `<label>` participates
 * directly in the parent's layout, and when the widget renders nothing it contributes no phantom flex
 * gap.
 */
@customElement("dashboard-location-picker")
export class LocationPicker extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: contents;
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        /* The gap below the picker (before the table/next control) — the margin the roster/planned screens use
         * their sibling week picker so the two align in their shared flex row. Rendered only when the
         * select is (nothing renders at one location or none), so a hidden picker leaves no phantom gap. */
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ attribute: false }) locations: LocationSummary[] = [];

  @property() selected = "";

  @property() label = "";

  #onChange(event: Event): void {
    event.stopPropagation();
    const locationId = (event.target as HTMLSelectElement).value;
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
      <label class="picker"
        >${this.label}
        <select data-test="location-select" @change=${(e: Event) => this.#onChange(e)}>
          ${this.locations.map(
            (l) =>
              html`<option value=${l.id} .selected=${l.id === this.selected}>${l.name}</option>`,
          )}
        </select>
      </label>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-location-picker": LocationPicker;
  }
}
