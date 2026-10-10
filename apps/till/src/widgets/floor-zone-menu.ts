import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { FloorZone, TableState } from "../api/client.js";
import { t } from "../i18n/t.js";
import { sparesOf, takenOffOf } from "../state/floor-today.js";
import { trackDialog } from "./track-dialog.js";

type Dialog = "spares" | "taken-off" | "reset";

/**
 * Today's plan (⋮) for a planned zone: Add a spare table, Taken off today and Reset to saved plan.
 * A pick sends `zone-place-spare` or `zone-put-back` `{ tableId }`, or `zone-reset` `{ zoneId }`,
 * and closes its dialog.
 */
@customElement("till-floor-zone-menu")
export class TillFloorZoneMenu extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  /** `null` draws nothing. */
  @property({ attribute: false }) zone: FloorZone | null = null;
  /** The zone's tables. */
  @property({ attribute: false }) tables: TableState[] = [];
  @state() private open: Dialog | null = null;

  #emit(type: string, detail: object): void {
    this.open = null;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #cancel(): TemplateResult {
    return html`<wt-button
      slot="footer"
      data-cancel
      variant="secondary"
      @click=${() => (this.open = null)}
    >
      ${t("action.cancel")}
    </wt-button>`;
  }

  #dialog(name: Dialog, heading: string, body: TemplateResult): TemplateResult {
    return html`<wt-dialog
      ${trackDialog()}
      data-dialog=${name}
      .open=${this.open === name}
      .heading=${heading}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.open === name) this.open = null;
      }}
    >
      ${this.open === name ? body : nothing}
    </wt-dialog>`;
  }

  #spares(): TemplateResult {
    const spares = sparesOf(this.tables);
    return html`${
      spares.length === 0
        ? html`<p class="empty" data-empty>${t("floor.no_spares")}</p>`
        : html`<div class="rows">
            ${spares.map(
              (table) =>
                html`<wt-button
                  data-spare=${table.id}
                  variant="secondary"
                  @click=${() => this.#emit("zone-place-spare", { tableId: table.id })}
                >
                  ${table.label}
                </wt-button>`,
            )}
          </div>`
    }
    ${this.#cancel()}`;
  }

  #takenOff(): TemplateResult {
    const takenOff = takenOffOf(this.tables);
    return html`${
      takenOff.length === 0
        ? html`<p class="empty" data-empty>${t("floor.none_taken_off")}</p>`
        : html`<div class="rows">
            ${takenOff.map(
              (table) =>
                html`<div class="row" data-taken-off=${table.id}>
                  <span data-label>${table.label}</span>
                  <wt-button
                    data-put-back
                    variant="secondary"
                    @click=${() => this.#emit("zone-put-back", { tableId: table.id })}
                  >
                    ${t("floor.put_back")}
                  </wt-button>
                </div>`,
            )}
          </div>`
    }
    ${this.#cancel()}`;
  }

  #reset(zone: FloorZone): TemplateResult {
    return html`<p data-reset-body>${t("floor.reset_body")}</p>
      ${this.#cancel()}
      <wt-button
        slot="footer"
        data-reset-confirm
        variant="danger"
        @click=${() => this.#emit("zone-reset", { zoneId: zone.id })}
      >
        ${t("floor.reset_confirm")}
      </wt-button>`;
  }

  override render() {
    const zone = this.zone;
    if (zone === null) return nothing;
    return html`<wt-row-actions label=${t("floor.zone_menu")} align="end">
        <wt-button
          data-menu-item="spares"
          variant="secondary"
          @click=${() => (this.open = "spares")}
        >
          ${t("floor.add_spare")}
        </wt-button>
        <wt-button
          data-menu-item="taken-off"
          variant="secondary"
          @click=${() => (this.open = "taken-off")}
        >
          ${t("floor.taken_off")}
        </wt-button>
        <wt-button data-menu-item="reset" variant="secondary" @click=${() => (this.open = "reset")}>
          ${t("floor.reset_plan")}
        </wt-button>
      </wt-row-actions>
      ${this.#dialog("spares", t("floor.add_spare"), this.#spares())}
      ${this.#dialog("taken-off", t("floor.taken_off"), this.#takenOff())}
      ${this.#dialog(
        "reset",
        t("floor.reset_title").replace("{zone}", () => zone.name),
        this.#reset(zone),
      )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-floor-zone-menu": TillFloorZoneMenu;
  }
}
