import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { STATION_COLOURS, type StationColour } from "@waitron/shared";
import { format } from "./hours-view.js";
import { stationColourStyles } from "./station-colour-styles.js";
import { t } from "./strings.js";

export interface StationColourUser {
  id: string;
  name: string;
  colour: StationColour;
}

const STEPS: Partial<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Twelve colour tiles, each naming the given stations that already have it. */
@customElement("station-colour-picker")
export class StationColourPicker extends LitElement {
  static override styles = [
    baseStyles,
    stationColourStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      fieldset {
        border: none;
        margin: 0;
        padding: 0;
        min-width: 0;
      }
      legend {
        padding: 0;
        margin-block-end: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
      }
      [role="radiogroup"] {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--wt-space-2);
      }
      @container (max-width: 360px) {
        [role="radiogroup"] {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .tile {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .tile[aria-checked="true"] {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-primary);
        outline-offset: calc(-1 * var(--wt-field-line-width-active));
        font-weight: var(--wt-font-weight-bold);
      }
      .tile:disabled {
        cursor: default;
      }
      .swatch {
        flex: none;
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--station-fill);
      }
      .text {
        display: grid;
        min-width: 0;
      }
      .colour-name,
      .used-by {
        overflow-wrap: anywhere;
      }
      .used-by {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property() value: StationColour = "red";
  /** The other stations, whose names show under the colour each has. */
  @property({ attribute: false }) stations: readonly StationColourUser[] = [];
  @property({ type: Boolean }) busy = false;
  @property() error = "";

  private choose(colour: StationColour, focus = false) {
    this.value = colour;
    this.dispatchEvent(
      new CustomEvent("station-colour-change", {
        detail: { colour },
        bubbles: true,
        composed: true,
      }),
    );
    if (focus)
      void this.updateComplete.then(() =>
        this.shadowRoot!.querySelector<HTMLElement>(
          `[role=radio][data-station-colour="${colour}"]`,
        )?.focus(),
      );
  }

  override render(): unknown {
    const tabStop = Math.max(0, STATION_COLOURS.indexOf(this.value));
    return html`<fieldset name="colour">
      <legend>${t("prep.colour")}<span class="required" aria-hidden="true">*</span></legend>
      <div
        role="radiogroup"
        aria-label=${t("prep.colour")}
        aria-required="true"
        aria-invalid=${this.error ? "true" : "false"}
        aria-describedby="colour-error"
      >
        ${STATION_COLOURS.map((colour, index) => {
          const name = t(`prep.colour.${colour}`);
          const users = this.stations
            .filter((station) => station.colour === colour)
            .map((station) => station.name)
            .join(", ");
          return html`<button
            type="button"
            class="tile"
            role="radio"
            aria-checked=${this.value === colour ? "true" : "false"}
            aria-label=${users ? format("prep.colour_used_by", { colour: name, stations: users }) : name}
            data-station-colour=${colour}
            tabindex=${index === tabStop ? 0 : -1}
            ?disabled=${this.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.choose(colour);
            }}
            @keydown=${(event: KeyboardEvent) => {
              const step = STEPS[event.key];
              if (!step) return;
              event.preventDefault();
              this.choose(
                STATION_COLOURS[(index + step + STATION_COLOURS.length) % STATION_COLOURS.length]!,
                true,
              );
            }}
          >
            <span class="swatch" aria-hidden="true"></span>
            <span class="text" aria-hidden="true">
              <span class="colour-name">${name}</span>
              ${users ? html`<span class="used-by">${users}</span>` : nothing}
            </span>
          </button>`;
        })}
      </div>
      <span id="colour-error" class="error">${this.error}</span>
    </fieldset>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "station-colour-picker": StationColourPicker;
  }
}
