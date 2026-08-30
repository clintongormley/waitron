import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import type { LocationSummary } from "../api/client.js";

/**
 * The selection rule shared by every location-scoped screen (roster, planned-vs-actual, location
 * menus): keep the current id when it still exists in the list, otherwise fall back to the FIRST
 * location, and to "" (no location) when the list is empty. Pure — no DOM, no state — so it is unit
 * tested on its own and reused by each screen's loader in place of the hand-rolled
 * `!locations.some(...)` / `locations[0]` dance it used to inline.
 */
export function resolveLocationSelection(locations: LocationSummary[], current: string): string {
  if (locations.length === 0) return "";
  if (locations.some((l) => l.id === current)) return current;
  return locations[0]!.id;
}

/**
 * A presentational LOCATION PICKER shared by the roster, planned-vs-actual and location-menus screens,
 * which each used to hand-roll the identical `<select data-test="location-select">`. It is
 * props-in/events-out and owns NO state: the parent screen keeps the selected `locationId` and the
 * loaded `locations`, passes them down, and reloads on the event.
 *
 * It renders NOTHING when there is one location or none — there is nothing to pick — so a single-venue
 * tenant sees no redundant one-option select (the rule the location-menus screen already applied; the
 * roster and planned screens used to show a pointless one-option select and now match). Otherwise it
 * renders the labelled native `<select>` with an `<option>` per location, the current one marked via a
 * per-option `.selected` binding — NOT a select-level `.value`, which commits before the `<option>`
 * children exist and would drop a non-first preset (the trap person-edit documents). All three screens
 * default the selection to the first option, so the per-option binding is sufficient and no imperative
 * `updated()` reconciliation is needed (none of the three screens carried one).
 *
 * The label text is passed in (`label`) rather than fetched, so i18n stays at the screen edge (each
 * screen passes its own `t("roster.location")` / `t("planned.location")` / `t("location_menus.location")`,
 * all of which resolve to the same copy) and this widget stays free of the i18n layer.
 *
 * `:host { display: contents }` so the widget adds no box of its own: the projected `<label>`
 * participates directly in the parent's layout exactly as the inlined label did, and when the widget
 * renders nothing it contributes no phantom flex gap.
 *
 * On a pick it emits a composed, bubbling `location-changed` carrying `{ locationId }`; the native
 * `change` (which is `composed: false`) is `stopPropagation`ed for defensive consistency with the
 * screens' composed handlers.
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
        /* The gap below the picker (before the table/next control) — the margin the location-menus
         * screen used to carry on its own picker label, and which the roster/planned screens match on
         * their sibling week picker so the two align in their shared flex row. Rendered only when the
         * select is (nothing renders at one location or none), so a hidden picker leaves no phantom gap. */
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text);
      }
    `,
  ];

  /** The locations to choose from. Fewer than two renders nothing. */
  @property({ attribute: false }) locations: LocationSummary[] = [];

  /** The id of the currently selected location. The parent owns it; this widget never mutates it. */
  @property() selected = "";

  /** The picker's visible label — passed in so i18n stays at the screen edge. */
  @property() label = "";

  /** A location was picked. Re-emit as a composed, bubbling `location-changed` so it crosses this
   * widget's shadow boundary to the parent screen; `stopPropagation` the native (non-composed) event
   * for consistency with the screens' composed handlers. */
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
