import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import type { Station } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { trackDialog } from "./track-dialog.js";

const moveRefusals: Record<string, StringKey> = {
  "ticket.already_started": "move_station.refused.ticket.already_started",
  "working_order.not_open": "move_station.refused.working_order.not_open",
  "working_order.already_collected": "move_station.refused.working_order.already_collected",
  "tab.line_not_found": "move_station.refused.tab.line_not_found",
  "ticket.not_sent": "move_station.refused.ticket.not_sent",
  "ticket.made_here": "move_station.refused.ticket.made_here",
};

@customElement("till-station-choice-dialog")
export class TillStationChoiceDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: grid;
        gap: var(--wt-space-3);
      }
      label {
        display: grid;
        gap: var(--wt-space-1);
      }
      select {
        width: 100%;
        padding: var(--wt-space-2);
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        font: inherit;
      }
      select:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .refusal {
        margin: 0;
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property() mode: "make-at" | "move" = "make-at";
  @property() dishName = "";
  @property({ attribute: false }) stations: Station[] = [];
  @property() currentStationId: string | null = null;
  @property() selected: string | null = null;
  @property({ type: Boolean }) busy = false;
  @property() refusal: string | null = null;

  #choice(): string | null {
    if (this.selected !== null)
      return this.stations.some((station) => station.id === this.selected) ? this.selected : null;
    if (this.mode === "make-at") return null;
    return this.stations.some((station) => station.id === this.currentStationId)
      ? this.currentStationId
      : null;
  }

  #emit(type: "station-chosen" | "close", detail?: { stationId: string | null }): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #submit(): void {
    const choice = this.#choice();
    if (
      this.busy ||
      (this.mode === "move" && (choice === null || choice === this.currentStationId))
    )
      return;
    this.#emit("station-chosen", { stationId: choice });
  }

  #refusal(): string {
    const code = this.refusal!;
    const key = this.mode === "move" ? moveRefusals[code] : undefined;
    return key === undefined ? codeMessage(code) : t(key);
  }

  override render() {
    const choice = this.#choice();
    const moving = this.mode === "move";
    const currentListed = this.stations.some((station) => station.id === this.currentStationId);
    const label = t(moving ? "move_station.move_to" : "move_station.make_at");
    return html`
      <wt-dialog
        ${trackDialog()}
        .open=${true}
        .heading=${`${label}: ${this.dishName}`}
        @wt-close=${() => this.#emit("close")}
      >
        <div class="body" data-body>
          <label>
            <span>${label}</span>
            <select
              name="station"
              @change=${(event: Event) => {
                const value = (event.target as HTMLSelectElement).value;
                this.selected = value === "" ? null : value;
              }}
            >
              ${
                moving
                  ? currentListed
                    ? nothing
                    : html`<option value="" .selected=${choice === null}>
                        ${t("move_station.choose")}
                      </option>`
                  : html`<option value="" .selected=${choice === null}>
                      ${t("move_station.rules")}
                    </option>`
              }
              ${this.stations.map(
                (station) =>
                  html`<option value=${station.id} .selected=${choice === station.id}>
                    ${
                      moving && station.id === this.currentStationId
                        ? t("move_station.now").replace("{station}", () => station.name)
                        : station.open
                          ? station.name
                          : t("dead_end.station_closed").replace("{station}", () => station.name)
                    }
                  </option>`,
              )}
            </select>
          </label>
          ${
            this.refusal === null
              ? nothing
              : html`<p class="refusal" role="alert">${this.#refusal()}</p>`
          }
        </div>
        <wt-button
          slot="footer"
          data-cancel
          variant="secondary"
          @click=${() => this.#emit("close")}
        >
          ${t("action.cancel")}
        </wt-button>
        <wt-button
          slot="footer"
          data-submit
          ?disabled=${this.busy || (moving && (choice === null || choice === this.currentStationId))}
          @click=${() => this.#submit()}
        >
          ${t(moving ? "move_station.move" : "move_station.save")}
        </wt-button>
      </wt-dialog>
    `;
  }
}
