import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, inNumberOrder } from "@waitron/ui";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { FloorZone, TableState } from "../api/client.js";
import { t } from "../i18n/t.js";
import { shownName, sparesOf, takenOffOf } from "../state/floor-today.js";
import { trackDialog } from "./track-dialog.js";

type Dialog = "spares" | "taken-off" | "reset";

const inNameOrder = (tables: TableState[]): TableState[] =>
  tables.sort((a, b) => inNumberOrder(shownName(a), shownName(b)));

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

      .heading {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-4) 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) zone: FloorZone | null = null;
  @property({ attribute: false }) tables: TableState[] = [];
  /** Below the till's phone width the List/Map toggle lives here, above a heading for the zone's items. */
  @property({ type: Boolean }) phone = false;
  @property() view: "map" | "list" = "map";
  /** Whether this device may change this zone's plan today; without it only a phone's toggle is offered. */
  @property({ type: Boolean }) canChangeToday = false;
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
    const spares = inNameOrder(sparesOf(this.tables));
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
                  ${shownName(table)}
                </wt-button>`,
            )}
          </div>`
    }
    ${this.#cancel()}`;
  }

  #takenOff(): TemplateResult {
    const takenOff = inNameOrder(takenOffOf(this.tables));
    return html`${
      takenOff.length === 0
        ? html`<p class="empty" data-empty>${t("floor.none_taken_off")}</p>`
        : html`<div class="rows">
            ${takenOff.map(
              (table) =>
                html`<div class="row" data-taken-off=${table.id}>
                  <span data-label>${shownName(table)}</span>
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

  #planItems(zone: FloorZone): TemplateResult {
    const setName = zone.layoutSetName;
    return html`${
        this.phone
          ? html`<p class="heading" data-menu-heading>
              ${t("floor.zone_menu_heading").replace("{zone}", () => zone.name)}
            </p>`
          : nothing
      }
      <wt-button
        data-menu-item="spares"
        variant="secondary"
        align="start"
        @click=${() => (this.open = "spares")}
      >
        ${t("floor.add_spare")}
      </wt-button>
      <wt-button
        data-menu-item="taken-off"
        variant="secondary"
        align="start"
        @click=${() => (this.open = "taken-off")}
      >
        ${t("floor.taken_off")}
      </wt-button>
      ${
        setName === null
          ? nothing
          : html`<wt-button
              data-menu-item="reset"
              variant="secondary"
              align="start"
              @click=${() => (this.open = "reset")}
            >
              ${t("floor.reset_plan").replace("{set}", () => setName)}
            </wt-button>`
      }`;
  }

  override render() {
    const zone = this.zone;
    const planned = zone !== null && this.canChangeToday;
    if (!planned && !this.phone) return nothing;
    return html`<wt-row-actions
        label=${planned ? t("floor.zone_menu") : t("floor.view_menu")}
        align="end"
      >
        ${
          this.phone
            ? html`<wt-button
                data-menu-item="view"
                variant="secondary"
                align="start"
                @click=${() => this.#emit("zone-toggle-view", {})}
              >
                ${this.view === "map" ? t("floor.view_list") : t("floor.view_map")}
              </wt-button>`
            : nothing
        }
        ${planned ? this.#planItems(zone) : nothing}
      </wt-row-actions>
      ${
        planned
          ? html`${this.#dialog("spares", t("floor.add_spare"), this.#spares())}
            ${this.#dialog("taken-off", t("floor.taken_off"), this.#takenOff())}
            ${this.#dialog(
              "reset",
              t("floor.reset_title").replace("{zone}", () => zone.name),
              this.#reset(zone),
            )}`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-floor-zone-menu": TillFloorZoneMenu;
  }
}
