import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { MONEY_SCALE, type Decimal, grossOf, sumDecimals, toScale } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { productName } from "../widgets/product-name.js";
import { trimQuantity } from "../widgets/dish-format.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { StoreChangeController } from "../state/store-controller.js";
// Side-effect imports register the reused widgets this screen composes — the round-scoped product
// picker + basket, and the tab-pay tender — exactly as `till-counter-screen` registers its widgets.
// The screen names them only as tags below, so the reuse (not a fork) is what lives here.
import "../widgets/product-grid.js";
import "../widgets/basket.js";
import "../widgets/tender-pay.js";
import type { TabLine, TableServiceStatus, TillProduct } from "../api/client.js";
import type { ConfirmPaymentDetail } from "../widgets/tender-pay.js";

// The Estado picker's option type is the shape `GET /api/statuses` returns (`{ id, label, color }`),
// defined once in the API client and re-exported here so the screen's `.statuses` element type — and
// the existing test/app imports of `TableServiceStatus` from this module — stay stable.
export type { TableServiceStatus };

/**
 * A read-only store whose total + line count are the tab's LOCKED figures, computed ONCE from the tab
 * lines and NEVER re-priced. It is fed to the embedded `tender-pay` so the operator's change is
 * computed against the exact total the server will file from the stored locks (design H2: a tab does
 * not re-price — the add-time `unit_price_gross` is authoritative, never a catalogue recompute). It
 * overrides ONLY the two getters `tender-pay` reads, so the base's `priceBasket` path (the re-price
 * hazard) is never reached — the whole point of not loading tab lines into a normal store.
 */
class TabPayStore extends WorkingOrderStore {
  readonly #total: Decimal;
  readonly #count: number;
  constructor(total: Decimal, count: number) {
    super();
    this.#total = total;
    this.#count = count;
  }
  override get total(): Decimal {
    return this.#total;
  }
  override get lineCount(): number {
    return this.#count;
  }
}

/**
 * The TILL table-ordering screen (FP-1, design §5b): one open table's tab. Three regions —
 *
 *  - a full-width **product grid** (reused `till-product-grid`) whose taps accumulate the CURRENT
 *    round into a round-scoped `WorkingOrderStore`, shown by a reused `till-basket` in a bottom bar;
 *    **Enviar ronda** emits `send-round` with the picked `{ productId, quantity }` lines and clears the
 *    round (the round bar is the current round ONLY, never the whole tab);
 *  - a right-edge **drawer**, its handle badged with the count of lines still to serve, listing
 *    **Pendiente de servir** (each a `Servido` tick → `serve-line`), **Servido**, the tab **total**
 *    (summed from the LOCKED add-time prices — never a catalogue recompute), **Cobrar** (the reused
 *    `till-tender-pay`, whose terminal tender the screen re-emits as `pay-tab`), **Estado** (a status
 *    picker → `set-status`) and a **disabled Mover · Dividir** placeholder (TS-3/TS-5 are out of scope).
 *
 * FISCAL FIREWALL (H2). The screen owns NO fiscal path. Rounds, served ticks and status are pre-fiscal
 * signals the app turns into `addTabRound`/`markLineServed`/`setTableStatus`. Pay is the one
 * fiscally-adjacent spot and is handled entirely by REUSE: the embedded `tender-pay` computes change
 * against the {@link TabPayStore} (the LOCKED tab total), and the screen catches its `confirm-payment`
 * and re-emits it as `pay-tab` — so the app settles the whole tab through the EXISTING `recordSale`
 * verb (which files the tab's stored locked lines and ignores the sent basket), never a new fiscal
 * verb and never a re-price. The Hold/`park-order` a `tender-pay` also offers is meaningless for an
 * already-persisted tab, so the screen SWALLOWS it rather than misrouting it to the counter's basket.
 *
 * COPY. Every user-facing label goes through `t()` (`table.*`, plus `label.total`); the shipped default
 * locale is es-ES, so these render in Spanish ("Enviar ronda", "Pendiente de servir", "Servido",
 * "Cobrar", "Estado", "Mover · Dividir"). Lit + `@waitron/ui` `baseStyles` + theme tokens only — no
 * hardcoded chrome (the status swatch is DATA colour, like the floor screen's badge).
 *
 * DISCONNECT SAFETY: every handler only writes reactive state or dispatches upward — Lit never paints a
 * detached element — so no `isConnected` guard is needed (the sibling screens' reasoning).
 */
@customElement("till-table-order-screen")
export class TillTableOrderScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        min-height: 100%;
        padding: var(--wt-space-4);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      .head-actions {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-5);
        margin-left: var(--wt-space-2);
        padding: 0 var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-4);
      }

      .grid-region {
        flex: 1 1 20rem;
        min-width: 0;
      }

      .drawer {
        flex: 0 0 22rem;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .drawer h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .drawer ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .line {
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .served-line {
        grid-template-columns: 1fr auto auto;
        color: var(--wt-color-text-muted);
      }

      .qty {
        color: var(--wt-color-text-muted);
      }

      .line-total {
        font-variant-numeric: tabular-nums;
      }

      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .total-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-2);
        border-top: 1px solid var(--wt-color-border);
      }

      .total-row .label {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .total-row .amount {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }

      .status-options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        margin-right: var(--wt-space-1);
        border-radius: 50%;
      }

      .round-bar {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .round-bar till-basket {
        flex: 1 1 auto;
        min-width: 0;
      }

      .round-bar .send-round {
        flex: 0 0 auto;
      }
    `,
  ];

  /** The open tab's lines (locked add-time prices + per-line served marker). The APP owns them —
   * loaded via `getTabLines` and reloaded after each round/serve — and threads them in; the drawer,
   * total and badge render from these, never a re-price. */
  @property({ attribute: false }) lines: TabLine[] = [];
  /** The sellable products, handed to the round product grid and used to resolve a line's name. */
  @property({ attribute: false }) products: TillProduct[] = [];
  /** The table service statuses the Estado picker offers (the app derives + threads them). */
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  /** The tab's working-order id (the app owns the writes; this rides along for reference/parity with
   * the FP-D placeholder it replaces). */
  @property() orderId?: string;
  /** A tab settlement is in flight (the app's `submitting`), threaded to the embedded pay widget so it
   * disables its confirm affordance — the visible half of the app's single-flight fiscal guard. */
  @property({ type: Boolean }) busy = false;

  /** Whether the pull-out tab drawer is open (its handle toggles it). */
  @state() private drawerOpen = false;

  /** The CURRENT round the product grid rings into and the round basket shows — its own store, distinct
   * from the tab (which is server-side). Cleared by {@link #sendRound}. */
  readonly #roundStore = new WorkingOrderStore();
  /** The pay store fed to `tender-pay` — rebuilt from {@link lines} on every change (see {@link willUpdate}). */
  #payStore?: TabPayStore;
  /** Per-line locked gross, keyed by `lineNo`, memoised from {@link lines} in the SAME
   * {@link willUpdate} guard that rebuilds {@link #payStore} — so a render triggered by the unrelated
   * `#roundStore` subscription (a product tap while building a round) reuses these instead of
   * recomputing `unitPriceGross × quantity` for every pending + served line. `lineNo` is unique per tab,
   * so it is a safe key; the map is fully populated for the current {@link lines} before any render. */
  #lineGrossByLineNo = new Map<number, Decimal>();

  constructor() {
    super();
    // Re-render on any round change (add/remove/clear) so the round basket and the Enviar-ronda
    // disabled state track the store; the controller owns the subscription lifecycle.
    new StoreChangeController(this, () => this.#roundStore);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // The per-line locked grosses and the tab total the pay widget settles against are both memoised
    // once per lines change — never a catalogue recompute (H2). Built on the first update too, before
    // the first render reads them. The gross map is filled BEFORE `#tabTotal` sums it below.
    if (changed.has("lines") || this.#payStore === undefined) {
      this.#lineGrossByLineNo = new Map(
        this.lines.map((line) => [line.lineNo, grossOf(line.unitPriceGross, line.quantity)]),
      );
      this.#payStore = new TabPayStore(this.#tabTotal(), this.lines.length);
    }
  }

  /** The line's LOCKED gross (`unitPriceGross × quantity` at money scale, via the shared `grossOf`
   * primitive), read from the {@link #lineGrossByLineNo} memo built in {@link willUpdate} — the SAME
   * arithmetic the server files with, so a drawer row can never round differently from the tab total or
   * the filed ticket. */
  #lineGross(line: TabLine): Decimal {
    return this.#lineGrossByLineNo.get(line.lineNo)!;
  }

  /** The tab's gross total — Σ of the locked line grosses, at money scale (`0.00` for an empty tab). */
  #tabTotal(): Decimal {
    return toScale(sumDecimals(this.lines.map((line) => this.#lineGross(line))), MONEY_SCALE);
  }

  /** The lines still to serve (`served_at IS NULL`) — the badge count and the Pendiente section. */
  #pending(): TabLine[] {
    return this.lines.filter((line) => line.servedAt === null);
  }

  /** The lines already served — the Servido section (no tick; the marker is set). */
  #served(): TabLine[] {
    return this.lines.filter((line) => line.servedAt !== null);
  }

  /** A line's display name from the catalogue, falling back to the raw id for a product deactivated
   * since it was added (mirrors the retrieve path's productId-only philosophy). */
  #nameFor(productId: string): string {
    const product = this.products.find((candidate) => candidate.id === productId);
    return product ? productName(product) : productId;
  }

  /** Trim a numeric(_,3) quantity's trailing zeros for display ("2.000" → "2", "0.320" → "0.32") —
   * the shared {@link trimQuantity} the kitchen queue uses too. */
  #displayQty(quantity: string): string {
    return trimQuantity(quantity);
  }

  /** Emit the current round's picked lines and clear the round bar for the next round. */
  #sendRound(): void {
    const lines = this.#roundStore.lines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
    }));
    this.dispatchEvent(
      new CustomEvent("send-round", { detail: { lines }, bubbles: true, composed: true }),
    );
    this.#roundStore.clear();
  }

  /** Announce that one pending line went out (the app marks it served, then reloads the tab). */
  #serve(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("serve-line", { detail: { lineNo }, bubbles: true, composed: true }),
    );
  }

  #toggleDrawer(): void {
    this.drawerOpen = !this.drawerOpen;
  }

  /** Announce a status pick (a status id, or `null` to clear) — the app keys it by TABLE id. */
  #pickStatus(statusId: string | null): void {
    this.dispatchEvent(
      new CustomEvent("set-status", { detail: { statusId }, bubbles: true, composed: true }),
    );
  }

  /** Return to the live floor (the app reloads occupancy so a just-paid table shows free). */
  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-floor", { bubbles: true, composed: true }));
  }

  /**
   * Re-emit the embedded `tender-pay`'s terminal tender as `pay-tab` so the APP settles the tab through
   * the EXISTING `recordSale` path (design H2). `stopPropagation` keeps the inner `confirm-payment` from
   * reaching the app's counter `#onConfirmPayment`, which would `#syncIfDirty` → re-price the tab's
   * locked lines. The detail (the cash/card tender) rides through verbatim.
   */
  #onTenderConfirm(event: Event): void {
    event.stopPropagation();
    const detail = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    this.dispatchEvent(new CustomEvent("pay-tab", { detail, bubbles: true, composed: true }));
  }

  /** Swallow a Hold/`park-order` from the embedded pay widget: a persisted tab cannot be parked, so this
   * meaningless affordance must never reach the app's counter `#onParkOrder`. */
  #onTenderPark(event: Event): void {
    event.stopPropagation();
  }

  override render() {
    const pending = this.#pending();
    return html`
      <section
        class="screen"
        data-order-id=${this.orderId ?? nothing}
        aria-label=${t("table.title")}
      >
        <header class="head">
          <h1 class="title">${t("table.title")}</h1>
          <div class="head-actions">
            <wt-button
              class="drawer-handle"
              data-open-drawer
              variant="secondary"
              aria-label=${t("table.open_drawer")}
              @click=${() => this.#toggleDrawer()}
            >
              ${t("table.open_drawer")}
              ${
                pending.length > 0
                  ? html`<span class="badge" data-pending-badge>${pending.length}</span>`
                  : nothing
              }
            </wt-button>
            <wt-button class="back" data-back variant="secondary" @click=${() => this.#back()}>
              ${t("table.back")}
            </wt-button>
          </div>
        </header>
        <div class="layout">
          <div class="grid-region">
            <till-product-grid
              .products=${this.products}
              .store=${this.#roundStore}
            ></till-product-grid>
          </div>
          ${this.drawerOpen ? this.#drawer(pending) : nothing}
        </div>
        <div class="round-bar">
          <till-basket .store=${this.#roundStore}></till-basket>
          <wt-button
            class="send-round"
            data-send-round
            variant="primary"
            size="lg"
            ?disabled=${this.#roundStore.lineCount === 0}
            @click=${() => this.#sendRound()}
          >
            ${t("table.send_round")}
          </wt-button>
        </div>
      </section>
    `;
  }

  #drawer(pending: TabLine[]): TemplateResult {
    return html`
      <aside class="drawer" data-drawer aria-label=${t("table.open_drawer")}>
        ${this.#pendingSection(pending)} ${this.#servedSection()}
        <div class="total-row">
          <span class="label">${t("label.total")}</span>
          <span class="amount" data-tab-total>${formatMoney(this.#payStore!.total)}</span>
        </div>
        <section
          class="pay"
          @confirm-payment=${(event: Event) => this.#onTenderConfirm(event)}
          @park-order=${(event: Event) => this.#onTenderPark(event)}
        >
          <h2>${t("table.pay_title")}</h2>
          <till-tender-pay .store=${this.#payStore} .busy=${this.busy}></till-tender-pay>
        </section>
        ${this.#statusSection()}
        <wt-button class="move-split" data-move-split variant="secondary" ?disabled=${true}>
          ${t("table.move_split")}
        </wt-button>
      </aside>
    `;
  }

  #pendingSection(pending: TabLine[]): TemplateResult {
    return html`<section class="pending">
      <h2>${t("table.pending_title")}</h2>
      ${
        pending.length === 0
          ? html`<p class="empty">${t("table.none_pending")}</p>`
          : html`<ul>
              ${pending.map((line) => this.#pendingLine(line))}
            </ul>`
      }
    </section>`;
  }

  #pendingLine(line: TabLine): TemplateResult {
    const name = this.#nameFor(line.productId);
    return html`<li class="line pending-line">
      <span class="name">${name}</span>
      <span class="qty">${this.#displayQty(line.quantity)}</span>
      <span class="line-total">${formatMoney(this.#lineGross(line))}</span>
      <wt-button
        class="serve"
        size="sm"
        variant="primary"
        data-serve=${line.lineNo}
        aria-label=${`${t("table.serve")} ${name}`}
        @click=${() => this.#serve(line.lineNo)}
      >
        <span aria-hidden="true">✓</span>
      </wt-button>
    </li>`;
  }

  #servedSection(): TemplateResult {
    const served = this.#served();
    return html`<section class="served">
      <h2>${t("table.served_title")}</h2>
      ${
        served.length === 0
          ? html`<p class="empty">${t("table.none_served")}</p>`
          : html`<ul>
              ${served.map(
                (line) =>
                  html`<li class="line served-line">
                    <span class="name">${this.#nameFor(line.productId)}</span>
                    <span class="qty">${this.#displayQty(line.quantity)}</span>
                    <span class="line-total">${formatMoney(this.#lineGross(line))}</span>
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  #statusSection(): TemplateResult {
    return html`<section class="status">
      <h2>${t("table.status_title")}</h2>
      <div class="status-options">
        ${this.statuses.map(
          (status) =>
            html`<wt-button
              class="status-option"
              data-status=${status.id}
              variant="secondary"
              @click=${() => this.#pickStatus(status.id)}
            >
              <span class="dot" style="background: ${status.color}" aria-hidden="true"></span>
              ${status.label}
            </wt-button>`,
        )}
        <wt-button
          class="status-clear"
          data-status-clear
          variant="secondary"
          @click=${() => this.#pickStatus(null)}
        >
          ${t("table.status_clear")}
        </wt-button>
      </div>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-table-order-screen": TillTableOrderScreen;
  }
}
