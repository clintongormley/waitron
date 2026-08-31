import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { baseStyles } from "@waitron/ui";
import { addDecimal, decimal, perDishOptionQuantity } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { qrSvg } from "../qr.js";
import type { TillSaleLine, TillSaleResult } from "../api/client.js";
import type { ReceiptConfig } from "../layout.js";

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

/**
 * The multiplication sign for a per-option-quantity badge (`×2`). The SAME `×` (U+00D7) the printed
 * receipt (`apps/server/src/receipt-ticket.ts`) and the on-screen basket use, so the badge reads
 * identically across the filed ticket, the paper receipt and the live basket.
 */
const QTY_BADGE = "×";

/** A dish and the option lines filed beneath it — the shape {@link groupByParent} produces. */
interface LineGroup {
  dish: TillSaleLine;
  options: TillSaleLine[];
}

/**
 * Group the filed line list into dishes each carrying their child option lines (ordering modifiers,
 * Task 14). A parent dish has `parentLineNo == null`; a child option points at its dish's `lineNo`. The
 * filed lines arrive in emission order — dish immediately followed by its options — so a single forward
 * scan attaching each child to the most recent dish groups them without a lookup. This does NOT
 * recompute any figure: it re-orders the SAME already-filed lines, so the printed list still reconciles
 * with `result.total` exactly as before.
 *
 * Mirrors `apps/server/src/receipt-ticket.ts`'s `groupByParent` (the printed receipt's identical
 * grouping over the same `TillSaleLine` shape) — kept as its own LOCAL copy rather than imported, the
 * same bundle-decoupling rationale as every type in `../api/client.js` (an `apps/till` → `apps/server`
 * dependency would drag server/Node code into the browser bundle). The till's own on-screen basket
 * (`apps/till/src/widgets/basket.ts`) needs no such helper: its lines already carry a nested `options`
 * array from client state, never a flat filed list to re-group.
 *
 * A leading child with no dish yet (structurally impossible for filed data — a dish is always emitted
 * before its options) is treated as its own dish rather than dropped, so no filed line ever vanishes
 * from the on-screen ticket.
 */
function groupByParent(lines: readonly TillSaleLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    if (line.parentLineNo == null || current === undefined) {
      groups.push({ dish: line, options: [] });
    } else {
      current.options.push(line);
    }
  }
  return groups;
}

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

      /* Non-fiscal receipt trim (design §8), rendered AROUND the immutable core — never inside it. */
      .header-subtitle,
      .footer-message {
        margin: var(--wt-space-1) 0 0;
        text-align: center;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .footer-message {
        margin-top: var(--wt-space-2);
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

      /* A selected option (ordering modifiers, Task 14) — indented beneath its dish, name left and its
         own delta right (0,00 for a free option), never its own quantity column (an option is priced per
         dish, so repeating the count reads as noise) — matching the printed receipt's identical indent. */
      .line.option {
        padding-left: var(--wt-space-4);
        color: var(--wt-color-text-muted);
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

      /* The receipt-hardware actions (reprint the paper, kick the drawer) — a row above New sale, each
         a full-width secondary button on the same 22rem column as the ticket + New sale. */
      .receipt-actions {
        display: flex;
        gap: var(--wt-space-3);
        max-width: 22rem;
        margin: 0 auto var(--wt-space-3);
      }

      .receipt-actions wt-button {
        flex: 1;
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
  /**
   * The owner-authored NON-FISCAL trim (layout & receipt editors, design §8), threaded from `till-app`
   * (`GET /api/till`). `headerSubtitle` renders under the venue name and `footerMessage` under the
   * VERI*FACTU legend, both `nothing` when absent — the immutable art. 7.1 core (below) is NEVER read
   * from or gated on this prop, so no `ReceiptConfig` field can suppress or reorder a mandated element.
   * Undefined (an older server, or a tenant that never opened the editor) renders no trim at all.
   */
  @property({ attribute: false }) receipt?: ReceiptConfig;

  /** Announce that the operator wants to start the next sale. The parent (Task 19) swaps the screen. */
  #newSale(): void {
    this.dispatchEvent(new CustomEvent("new-sale", { bubbles: true, composed: true }));
  }

  /**
   * Announce that the operator wants to REPRINT this filed sale's receipt (counter receipt/drawer §5) —
   * the paper only; the on-screen ticket is unchanged. Presentational: the view dispatches the intent and
   * `till-app` owns the API call and the working-order id (this view holds only the filed `result`, which
   * carries no working-order id). Mirrors {@link #newSale}'s composed, bubbling CustomEvent so the app
   * shell's `@reprint` handler catches it across the shadow boundary.
   */
  #reprint(): void {
    this.dispatchEvent(new CustomEvent("reprint", { bubbles: true, composed: true }));
  }

  /**
   * Announce that the operator wants to OPEN THE CASH DRAWER (counter receipt/drawer §5) — a no-sale kick
   * (giving change, a cash count). Presentational, exactly like {@link #reprint}: the view dispatches the
   * intent and `till-app` owns the API call; the server audits it and resolves the till's printer from its
   * own config, so there is nothing for the view to pass.
   */
  #openDrawer(): void {
    this.dispatchEvent(new CustomEvent("open-drawer", { bubbles: true, composed: true }));
  }

  override render() {
    const r = this.result;
    const locale = this.invoiceLocale;
    const svg = qrSvg(r.qr);
    return html`
      <article class="ticket">
        <header class="issuer">
          <p class="venue">${this.issuer.venueName}</p>
          ${
            this.receipt?.headerSubtitle
              ? html`<p class="header-subtitle">${this.receipt.headerSubtitle}</p>`
              : nothing
          }
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
          ${groupByParent(r.lines).map(
            // LINE-LIST SOURCE. Each line is the FILED composition returned by the server
            // (`TillSaleResult.lines`) — name (invoice locale), display quantity and the GROSS the line
            // was filed at — NOT the mutable client basket. So the printed goods list can never diverge
            // from the invoice, even after a local edit between place and collect, or a retrieved-order
            // edit before pay (Finding 2 — this replaced the earlier client-side `lineGross` render that
            // assumed a fixed, uneditable catalogue). Σ(line.gross) == r.total by construction.
            //
            // GROUPING (ordering modifiers, Task 14): each dish's selected options render INDENTED
            // beneath it, at their own delta (0,00 for a free option) — the same grouping the printed
            // receipt (`formatReceipt`) already applies to this identical line list, via {@link groupByParent}.
            (group) => html`
              <li class="line">
                <span class="line-name">${lineName(group.dish.descriptions, locale)}</span>
                <span class="line-qty">${group.dish.quantity}</span>
                <span class="line-gross">${formatMoney(group.dish.gross, locale)}</span>
              </li>
              ${group.options.map(
                // Per-option quantity: the per-dish count is recovered from the filed COMBINED child
                // quantity (see perDishOptionQuantity). Append a "×N" badge to the name ONLY when it
                // exceeds 1; the common one-per-dish case shows no badge and is byte-identical to before.
                // Same `×` badge as the printed receipt (`apps/server/src/receipt-ticket.ts`).
                (option) => {
                  const perDish = perDishOptionQuantity(option.quantity, group.dish.quantity);
                  const badge = perDish > 1 ? ` ${QTY_BADGE}${perDish}` : "";
                  return html`
                    <li class="line option">
                      <span class="line-name"
                        >${lineName(option.descriptions, locale)}${badge}</span
                      >
                      <span class="line-gross">${formatMoney(option.gross, locale)}</span>
                    </li>
                  `;
                },
              )}
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
        ${
          this.receipt?.footerMessage
            ? html`<p class="footer-message">${this.receipt.footerMessage}</p>`
            : nothing
        }
      </article>

      <div class="receipt-actions">
        <wt-button
          class="reprint"
          variant="secondary"
          size="lg"
          data-test="reprint"
          @click=${() => this.#reprint()}
        >
          ${t("action.reprint")}
        </wt-button>
        <wt-button
          class="open-drawer"
          variant="secondary"
          size="lg"
          data-test="open-drawer"
          @click=${() => this.#openDrawer()}
        >
          ${t("action.open_drawer")}
        </wt-button>
      </div>

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
