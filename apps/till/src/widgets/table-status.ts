import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type WtToast, baseStyles, floorMapFillStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-toast.js";
import type { TableParty, TableState } from "../api/client.js";
import { t } from "../i18n/t.js";
import { combinedStatus, pinText, readyText, standInStatus } from "../state/floor-map.js";
import { signalOf } from "../state/table-signals.js";
import "./table-details-sheet.js";

/** The party's tables in its table order. */
function partyRows(tables: readonly TableState[], party: TableParty): TableState[] {
  const rows = tables.filter((table) => table.party?.id === party.id);
  const at = (table: TableState) => {
    const index = party.tableIds.indexOf(table.id);
    return index === -1 ? Infinity : index;
  };
  return rows.sort((a, b) => at(a) - at(b));
}

/** Counts are read from one table, never summed: the server repeats a party's counts on each of
 * its tables (`packages/shared/src/table-signals.ts`). */
function flashMessage(rows: readonly TableState[]): string {
  const ready = Math.max(...rows.map((row) => row.readyToServe));
  const parts: string[] = [];
  if (ready > 0) parts.push(readyText(ready));
  if (rows.some((row) => row.timingBand === "forgotten")) parts.push(t("table.flash_forgotten"));
  if (rows.some((row) => signalOf(row.signals, "bill_requested")))
    parts.push(t("signal.bill_requested"));
  return parts.join(" · ");
}

/** The order screen's status pin, which opens the table's details, and the notice shown once per
 * party when it has dishes ready, a forgotten order or a bill requested. */
@customElement("till-table-status")
export class TillTableStatus extends LitElement {
  static override styles = [
    baseStyles,
    floorMapFillStyles,
    css`
      :host {
        display: contents;
      }

      .status-pin {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: 0 var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      .swatch {
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }

      /* The equipment toast's place (till-app.ts): over the page, so it moves nothing. */
      .flash-notice {
        position: fixed;
        inset-inline: var(--wt-space-3);
        top: calc(var(--wt-space-3) + env(safe-area-inset-top));
        z-index: 10;
      }
    `,
  ];

  @property({ attribute: false }) tables: TableState[] = [];
  @property({ attribute: false }) party: TableParty | null = null;

  /** The party the sheet was opened for; it closes once that party or all its tables go. */
  #openFor: string | null = null;
  #judgedPartyId: string | null = null;
  #partyRows: TableState[] = [];
  #message = "";

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#judgedPartyId = null;
    super.disconnectedCallback();
  }

  #setOpen(partyId: string | null): void {
    this.#openFor = partyId;
    this.requestUpdate();
  }

  override willUpdate(): void {
    const party = this.party;
    this.#partyRows = party === null ? [] : partyRows(this.tables, party);
    this.#message = flashMessage(this.#partyRows);
    if (this.#partyRows.length === 0 || this.#openFor !== party?.id) this.#openFor = null;
  }

  override updated(): void {
    const notice = this.renderRoot.querySelector<WtToast>("wt-toast[data-flash-notice]");
    if (notice === null) return;
    if (this.#message === "") notice.open = false;
    const partyId = this.party!.id;
    if (partyId === this.#judgedPartyId) return;
    this.#judgedPartyId = partyId;
    if (this.#message !== "") notice.show();
  }

  override render() {
    const party = this.party;
    const rows = this.#partyRows;
    if (party === null || rows.length === 0) return nothing;
    const fill = combinedStatus(rows.map(standInStatus)).fill;
    const text = pinText(rows);
    return html`<button
        type="button"
        class="status-pin"
        data-status-pin
        aria-label=${t("table.status_pin").replace("{status}", () => text)}
        @click=${() => this.#setOpen(party.id)}
      >
        <span class="swatch" data-fill=${fill} aria-hidden="true"></span>
        ${text}
      </button>
      <wt-toast
        class="flash-notice"
        data-flash-notice
        tone="info"
        .duration=${4000}
        .message=${this.#message}
        close-label=${t("table.flash_close")}
      ></wt-toast>
      <till-table-details-sheet
        .table=${this.#openFor === null ? null : rows[0]!}
        .heading=${party.displayName}
        @details-close=${(event: Event) => {
          event.stopPropagation();
          this.#setOpen(null);
        }}
      ></till-table-details-sheet>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-table-status": TillTableStatus;
  }
}
