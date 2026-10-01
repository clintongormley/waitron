import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney, partyTablesName } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import type { UnpaidDeparture } from "../api/client.js";

/**
 * The bills parties left without paying whose invoice is still owed (spec §8). A pure, read-only
 * view that renders nothing when there are none: collecting the debt is not done from the till.
 */
@customElement("till-unpaid-departures")
export class TillUnpaidDepartures extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .title {
        margin: var(--wt-space-3) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .departure {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
        min-width: 0;
      }

      .head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .reason {
        overflow-wrap: anywhere;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ attribute: false }) departures: UnpaidDeparture[] = [];

  #who(departure: UnpaidDeparture): string | null {
    const name = departure.recordedByName;
    if (name === null) return null;
    const approver = departure.authorizedByName;
    if (approver === null || approver === name)
      return t("departures.recorded_by").replace("{name}", () => name);
    return t("departures.recorded_approved")
      .replace("{name}", () => name)
      .replace("{approver}", () => approver);
  }

  #when(iso: string): string {
    return new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  }

  #row(departure: UnpaidDeparture): TemplateResult {
    const who = this.#who(departure);
    return html`<div class="departure" data-departure=${departure.id}>
      <div class="head">
        <span data-departure-tables>${partyTablesName(departure.tableLabels)}</span>
        <span data-departure-amount>${formatMoney(departure.amount, currentLocale())}</span>
      </div>
      ${
        departure.billLabel === null
          ? nothing
          : html`<span data-departure-bill>${departure.billLabel}</span>`
      }
      <span class="reason" data-departure-reason>${departure.reason}</span>
      <div class="meta">
        <span data-departure-invoice
          >${t("departures.invoice").replace("{number}", () => departure.invoiceNumber)}</span
        >
        ${who === null ? nothing : html`<span data-departure-who>${who}</span>`}
        <span data-departure-when>${this.#when(departure.recordedAt)}</span>
      </div>
    </div>`;
  }

  override render() {
    if (this.departures.length === 0) return nothing;
    return html`
      <h2 class="title">${t("departures.title")}</h2>
      ${this.departures.map((departure) => this.#row(departure))}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-unpaid-departures": TillUnpaidDepartures;
  }
}
