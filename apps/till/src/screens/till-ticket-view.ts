import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { baseStyles } from "@waitron/ui";
import { addDecimal, decimal } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { qrSvg } from "../qr.js";
import type { TillSaleResult } from "../api/client.js";

/** The receipt issuer's legally-printed identity (RD 1619/2012 art. 7.1.d): venue name + NIF. */
export interface TicketIssuer {
  venueName: string;
  nif: string;
}

/**
 * A filed line's goods name in the invoice locale (art. 7.1.e), resolved from the line's snapshotted
 * `descriptions` map exactly as `productName` resolves a product's — the invoice locale, then any
 * description the line carries, degrading to "" only for an empty map (a catalogue defect that still
 * prints something). The line comes from the SERVER's filed composition, so this reads its map rather
 * than a `TillProduct`.
 */
function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

/**
 * The fiscal labels are fixed Spanish constants — the invoice locale for a Spanish (ES-común) venue
 * is es-ES, so the receipt is a Spanish legal document regardless of the operator-UI language. The
 * {@link TillTicketView.invoiceLocale} property drives number/date FORMATTING only; a non-Spanish
 * invoice locale (a future non-ES territory) would need a translated label set.
 */
const LABEL = {
  nif: "NIF",
  invoice: "Factura",
  date: "Fecha",
  base: "Base",
  vat: "IVA",
  total: "TOTAL",
  cash: "Efectivo",
  change: "Cambio",
} as const;

/** The Veri*Factu legend — a FIXED legal string (Orden HAC/1177/2024 art. 20.1.b). Never translated. */
const LEGEND = "VERI*FACTU";

/** The issue timestamp formatted in the invoice locale — the fecha de expedición (art. 7.1.b). */
function issueDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * The filed ticket the customer receives after payment — a factura simplificada carrying the QR.
 *
 * This is a LEGAL document. It renders the non-removable core required by RD 1619/2012 art. 7.1 plus
 * the RRSIF/Veri*Factu QR + legend (Orden HAC/1177/2024 arts. 20–21), all settled on primary source in
 * `docs/compliance/verifactu-findings.md` §14:
 *
 *  - issuer venue name + NIF (7.1.d) — from {@link issuer};
 *  - número + serie (7.1.a) and fecha de expedición (7.1.b) — `result.invoiceNumber` / `result.issuedAt`;
 *  - identification of the goods (7.1.e) — one row per {@link lines} entry: name (invoice locale),
 *    quantity, per-line gross;
 *  - the tipo(s) impositivo(s) and the base imponible per rate (7.1.f) — from `result.vatBreakdown`
 *    (per-item VAT is NOT required; the cuota per rate is shown as an allowed extra);
 *  - contraprestación total (7.1.g) — `result.total`;
 *  - QR + VERI*FACTU legend.
 *
 * Allowed operational extras: efectivo (= total + change) and cambio.
 *
 * INVOICE LOCALE. The customer ticket is a fiscal document ISSUED IN SPAIN and is rendered in the
 * INVOICE locale ({@link invoiceLocale}), which is INDEPENDENT of the operator's UI language (spec §9,
 * `docs/compliance/verifactu-findings.md` §14): an English-speaking operator still hands the customer a
 * Spanish ticket. So the fiscal labels are Spanish CONSTANTS, while the money and date are formatted
 * with `invoiceLocale` and the product names are read in it — deliberately NOT via the operator-UI
 * `t()` / `currentLocale()`, which would flip "Efectivo"/"Cambio"/… (and the date format) to English
 * when the operator's UI is English. The locale is threaded in from the server till config
 * (`GET /api/till`), the same source that sets the operator UI — but separately, via {@link invoiceLocale}.
 */
@customElement("till-ticket-view")
export class TillTicketView extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .ticket {
        max-width: 22rem;
        margin: 0 auto var(--wt-space-4);
        padding: var(--wt-space-4);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        box-shadow: var(--wt-shadow-1);
        font-variant-numeric: tabular-nums;
      }

      .issuer {
        margin: 0 0 var(--wt-space-3);
        text-align: center;
      }

      .venue {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .nif {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
      }

      .meta,
      .lines {
        margin: 0 0 var(--wt-space-3);
        padding: 0 0 var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .lines {
        list-style: none;
      }

      .meta-row,
      .line,
      .vat-row,
      .total-row,
      .tender-row {
        display: flex;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-1) 0;
      }

      .meta-label,
      .vat-label,
      .line-qty,
      .tender-row {
        color: var(--wt-color-text-muted);
      }

      .line-name {
        flex: 1;
      }

      .total-row {
        margin: var(--wt-space-2) 0;
        padding-top: var(--wt-space-2);
        border-top: 1px solid var(--wt-color-border);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .tender {
        margin-bottom: var(--wt-space-3);
      }

      .qr {
        display: flex;
        justify-content: center;
        margin: var(--wt-space-3) 0;
      }

      .qr svg {
        width: 10rem;
        height: 10rem;
      }

      .legend {
        margin: 0;
        text-align: center;
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: 0.1em;
      }

      .new-sale {
        display: block;
        max-width: 22rem;
        margin: 0 auto;
      }
    `,
  ];

  /** The filed sale to render. Set before the element connects; the render reads it directly. */
  @property({ attribute: false }) result!: TillSaleResult;
  /** The issuer identity legally printed on the ticket — from `GET /api/till` (`venueName` + `nif`). */
  @property({ attribute: false }) issuer!: TicketIssuer;
  /**
   * The locale the receipt is RENDERED in — the money, date and product names (see the class doc's
   * INVOICE LOCALE note). Fed from the server till config by the parent (`GET /api/till`), NEVER the
   * operator-UI `currentLocale()`. Defaults to es-ES, the deli's invoice locale.
   */
  @property() invoiceLocale = "es-ES";

  /** Announce that the operator wants to start the next sale. The parent (Task 19) swaps the screen. */
  #newSale(): void {
    this.dispatchEvent(new CustomEvent("new-sale", { bubbles: true, composed: true }));
  }

  override render() {
    const r = this.result;
    const locale = this.invoiceLocale;
    const svg = qrSvg(r.qr);
    return html`
      <article class="ticket">
        <header class="issuer">
          <p class="venue">${this.issuer.venueName}</p>
          <p class="nif">${LABEL.nif}: ${this.issuer.nif}</p>
        </header>

        <div class="meta">
          <div class="meta-row">
            <span class="meta-label">${LABEL.invoice}</span>
            <span class="invoice-number">${r.invoiceNumber}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">${LABEL.date}</span>
            <span>${issueDate(r.issuedAt, locale)}</span>
          </div>
        </div>

        <ul class="lines">
          ${r.lines.map(
            // LINE-LIST SOURCE. Each line is the FILED composition returned by the server
            // (`TillSaleResult.lines`) — name (invoice locale), display quantity and the GROSS the line
            // was filed at — NOT the mutable client basket. So the printed goods list can never diverge
            // from the invoice, even after a local edit between place and collect, or a retrieved-order
            // edit before pay (Finding 2 — this replaced the earlier client-side `lineGross` render that
            // assumed a fixed, uneditable catalogue). Σ(line.gross) == r.total by construction.
            (line) => html`
              <li class="line">
                <span class="line-name">${lineName(line.descriptions, locale)}</span>
                <span class="line-qty">${line.quantity}</span>
                <span class="line-gross">${formatMoney(line.gross, locale)}</span>
              </li>
            `,
          )}
        </ul>

        <div class="vat">
          ${r.vatBreakdown.map(
            (v) => html`
              <div class="vat-row">
                <span class="vat-label">${LABEL.base} ${v.rate}%</span>
                <span class="vat-amount">${formatMoney(v.base, locale)}</span>
              </div>
              <div class="vat-row">
                <span class="vat-label">${LABEL.vat} ${v.rate}%</span>
                <span class="vat-amount">${formatMoney(v.tax, locale)}</span>
              </div>
            `,
          )}
        </div>

        <div class="total-row">
          <span>${LABEL.total}</span>
          <span>${formatMoney(r.total, locale)}</span>
        </div>

        <div class="tender">
          <div class="tender-row">
            <span>${LABEL.cash}</span>
            <span>${formatMoney(addDecimal(decimal(r.total), decimal(r.change)), locale)}</span>
          </div>
          <div class="tender-row">
            <span>${LABEL.change}</span>
            <span>${formatMoney(r.change, locale)}</span>
          </div>
        </div>

        ${svg ? html`<div class="qr">${unsafeHTML(svg)}</div>` : nothing}
        <p class="legend">${LEGEND}</p>
      </article>

      <wt-button class="new-sale" variant="primary" size="lg" @click=${() => this.#newSale()}>
        ${t("action.new_sale")}
      </wt-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-ticket-view": TillTicketView;
  }
}
