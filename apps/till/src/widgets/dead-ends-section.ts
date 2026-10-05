import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { t } from "../i18n/t.js";
import type { DeadEndAnswer } from "../api/client.js";
import { trimQuantity } from "./dish-format.js";

@customElement("till-dead-ends-section")
export class TillDeadEndsSection extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .row {
        padding: var(--wt-space-3) 0;
        border-top: 1px solid var(--wt-color-border);
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .reason {
        margin: var(--wt-space-2) 0;
      }
      wt-combobox {
        margin-top: var(--wt-space-1);
      }
      .remove {
        margin-top: var(--wt-space-2);
      }
      .invalid {
        color: var(--wt-color-danger);
        margin: var(--wt-space-3) 0 0;
      }
    `,
  ];

  @property({ attribute: false }) answer: DeadEndAnswer = {
    sends: false,
    deadEnds: [],
    stations: [],
  };
  @property({ attribute: false }) choices: ReadonlyMap<string, string> = new Map();
  @property({ type: Boolean }) allowRemove = false;

  #emit(type: "make-at" | "remove", detail: { key: string; stationId?: string }): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  override render() {
    return html`${this.answer.deadEnds.map(
      (row) => html`
        <div class="row" data-dead-end=${row.key}>
          <div class="name">${row.name} ×${trimQuantity(row.quantity)}</div>
          <p class="reason">
            ${t(row.why === "closed" ? "dead_end.closed" : "dead_end.disabled").replace("{station}", () => row.stationName)}
          </p>
          <wt-combobox
            name="make-at"
            label=${t("dead_end.make_at")}
            required
            placeholder=${t("dead_end.choose_station")}
            search="auto"
            .options=${this.answer.stations.map((station) => ({ value: station.id, label: station.open ? station.name : t("dead_end.station_closed").replace("{station}", () => station.name) }))}
            .value=${this.choices.get(row.key) ?? ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.#emit("make-at", { key: row.key, stationId: event.detail.value });
            }}
          >
          </wt-combobox>
          ${this.allowRemove ? html`<wt-button class="remove" variant="secondary" @click=${() => this.#emit("remove", { key: row.key })}>${t("action.remove")}</wt-button>` : nothing}
        </div>
      `,
    )}${this.answer.deadEnds.some((row) => !this.choices.get(row.key)) ? html`<p class="invalid">${t(this.allowRemove ? "dead_end.choose_or_remove" : "dead_end.choose")}</p>` : nothing}`;
  }
}
