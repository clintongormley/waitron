import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { setLocale, t } from "./i18n/t.js";
import { TillApi } from "./api/client.js";
import { WorkingOrderStore } from "./state/working-order.js";
// Side-effect imports register the three screen elements this app swaps between; it names them only
// as tags below, so the wiring — not the screens — is what lives here.
import "./screens/till-lock-screen.js";
import "./screens/till-counter-screen.js";
import "./screens/till-ticket-view.js";
import type { StringKey } from "./i18n/strings.js";
import type { TillProduct, TillSaleResult } from "./api/client.js";
import type { OrderLine } from "./state/working-order.js";
import type { LoggedInDetail } from "./screens/till-lock-screen.js";
import type { TicketIssuer } from "./screens/till-ticket-view.js";
import type { ConfirmPaymentDetail } from "./widgets/tender-pay.js";

/** The three faces of the till: sign in, ring up, print. The app shows exactly one at a time. */
type Screen = "lock" | "counter" | "ticket";

/**
 * The till's ROOT element — the capstone that turns the screens and widgets into a working POS.
 *
 * It owns the two things the whole flow shares: ONE {@link WorkingOrderStore} (the basket, which
 * belongs to the till and survives a shift change — see working-order.ts) and ONE {@link TillApi}. It
 * runs a tiny screen state machine and does the event wiring the individual screens deliberately do
 * not — every screen/widget emits a composed, bubbling event that reaches the handlers on the wrapper
 * below, and the app decides what happens next:
 *
 *  - boot → `getTill` sets the operator-UI locale, remembers the receipt (invoice) locale and the
 *    ticket issuer; the app opens on `lock`;
 *  - `logged-in` → load the products, remember the operator, show the `counter`;
 *  - `confirm-payment` → `recordSale` the basket, then show the `ticket` (or, on a rejected `{code}`,
 *    stay on the counter with the basket intact and surface a non-fatal error — a till must never
 *    lose a sale in progress);
 *  - `new-sale` → clear the basket, back to an empty `counter`;
 *  - `logout` → end the server session, back to `lock`, WITHOUT clearing the basket.
 *
 * DISCONNECT SAFETY. Only one post-await step here has an effect that outlives the element: `setLocale`
 * in {@link TillApp.boot} mutates module-global locale, so it is guarded by `isConnected`. The event
 * handlers only write reactive state and dispatch nothing upward, so they need no guard — Lit never
 * paints a detached element (the same reasoning `till-lock-screen`'s `#loadStaff` records).
 */
@customElement("till-app")
export class TillApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .error {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
        text-align: center;
      }
    `,
  ];

  /** The HTTP face of the till. Defaults to a real same-origin client; a test injects a stub. */
  @property({ attribute: false }) api: TillApi = new TillApi();

  /** The one basket the whole flow shares. A stable reference (widgets subscribe to it directly). */
  readonly #store = new WorkingOrderStore();

  @state() private screen: Screen = "lock";
  /** The issuer identity printed on the ticket (venue name + NIF), read once from `getTill` on boot. */
  @state() private issuer?: TicketIssuer;
  /** The sellable products, loaded at login and handed to the counter's product grid. */
  @state() private products: TillProduct[] = [];
  /** The logged-in operator's display name, shown in the counter header. */
  @state() private operatorName = "";
  /** The filed sale to print; set on a successful `recordSale`, read by the ticket view. */
  @state() private result?: TillSaleResult;
  /** The basket lines snapshotted at pay time — the goods the ticket identifies (art. 7.1.e). */
  @state() private ticketLines: readonly OrderLine[] = [];
  /**
   * The receipt (invoice) locale for the ticket, from `GET /api/till` — the language the legal
   * receipt renders in. Threaded to `till-ticket-view` SEPARATELY from the operator-UI `setLocale`,
   * even though both read the same server `locale` (see `#boot`). Defaults to the deli's es-ES.
   */
  @state() private invoiceLocale = "es-ES";
  /** The string key of a non-fatal error to show over the counter, or `undefined` for none. */
  @state() private errorKey?: StringKey;
  /**
   * SINGLE-FLIGHT GUARD for sale confirmation — the fiscal double-file safety (CLAUDE.md §5: two
   * chained `registros_facturacion` records for one purchase are UNREPAIRABLE). Set synchronously at
   * the TOP of {@link TillApp.#onConfirmPayment}, BEFORE the first `await recordSale`, and cleared in
   * its `finally`. Because event dispatch is synchronous, a second `confirm-payment` fired before the
   * first settles (double-tap, a laggy link) sees `submitting === true` and is a no-op, so only ONE
   * `POST /api/sales` ever fires per basket regardless of UI timing. Also threaded down as
   * `till-counter-screen.busy` → `till-tender-pay.busy` to disable the pay affordance while in flight —
   * that disabling is the visible feedback; this flag is the actual safety.
   */
  @state() private submitting = false;

  override firstUpdated(): void {
    void this.#boot();
  }

  /**
   * Read the public till info once: set the OPERATOR-UI locale (`setLocale`), remember the receipt
   * (invoice) locale for the ticket, and remember the ticket issuer. `setLocale` and `invoiceLocale`
   * both take the SAME server `locale`, but they drive different things and are threaded separately —
   * the receipt uses its `invoiceLocale` PROP and must never follow the operator UI (see
   * `till-ticket-view`'s INVOICE LOCALE note).
   */
  async #boot(): Promise<void> {
    const till = await this.api.getTill();
    // Guard the ONE post-await external effect: setLocale mutates module-global state, so a boot that
    // resolves after the app was torn down must not repaint a live sibling's locale. The state writes
    // below need no such guard — Lit never paints a detached element.
    if (!this.isConnected) return;
    setLocale(till.locale);
    this.invoiceLocale = till.locale;
    this.issuer = { venueName: till.venueName, nif: till.nif };
  }

  /** A confirmed login: load the catalogue, remember the operator, show the counter. */
  async #onLoggedIn(event: Event): Promise<void> {
    const { displayName } = (event as CustomEvent<LoggedInDetail>).detail;
    const products = await this.api.listProducts();
    this.products = products;
    this.operatorName = displayName;
    this.errorKey = undefined;
    this.screen = "counter";
  }

  /**
   * Settle the basket. The lines are snapshotted BEFORE the await so the ticket prints exactly what was
   * rung up, and so a rejection can leave that same basket untouched on the counter.
   */
  async #onConfirmPayment(event: Event): Promise<void> {
    // Single-flight: a second confirm-payment fired before the first sale settles is a no-op, so the
    // same basket can never file twice (see `submitting`). Set BEFORE the first await — event dispatch
    // is synchronous, so the re-entrant call reads the flag that this call has already raised.
    if (this.submitting) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    // `store.lines` already returns a fresh defensive copy, so this snapshot needs no second spread.
    const lines = this.#store.lines;
    this.errorKey = undefined;
    try {
      this.result = await this.api.recordSale(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        tender,
      );
      this.ticketLines = lines;
      this.screen = "ticket";
    } catch {
      // A rejected {code} must not lose the sale in progress: stay on the counter, basket intact, and
      // surface a generic, non-fatal message — never the raw domain code.
      this.errorKey = "sale.error";
    } finally {
      // Re-enable Pay whichever way the sale settled: on success the counter is already gone (screen
      // is now `ticket`), on rejection the operator is back on the counter and may retry.
      this.submitting = false;
    }
  }

  /** Start the next sale: empty the basket, back to the counter. */
  #onNewSale(): void {
    this.#store.clear();
    this.errorKey = undefined;
    this.screen = "counter";
  }

  /** End the shift: tear the server session down, back to lock — but KEEP the basket (till-owned). */
  async #onLogout(): Promise<void> {
    await this.api.logout();
    this.operatorName = "";
    this.errorKey = undefined;
    this.screen = "lock";
  }

  override render() {
    return html`
      <div
        class="app"
        @logged-in=${(event: Event) => void this.#onLoggedIn(event)}
        @confirm-payment=${(event: Event) => void this.#onConfirmPayment(event)}
        @new-sale=${() => this.#onNewSale()}
        @logout=${() => void this.#onLogout()}
      >
        ${this.errorKey ? html`<p class="error" role="alert">${t(this.errorKey)}</p>` : nothing}
        ${this.#renderScreen()}
      </div>
    `;
  }

  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "lock":
        return html`<till-lock-screen .api=${this.api}></till-lock-screen>`;
      case "counter":
        return html`<till-counter-screen
          .store=${this.#store}
          .products=${this.products}
          .operatorName=${this.operatorName}
          .busy=${this.submitting}
        ></till-counter-screen>`;
      case "ticket":
        return html`<till-ticket-view
          .result=${this.result}
          .issuer=${this.issuer}
          .lines=${this.ticketLines}
          .invoiceLocale=${this.invoiceLocale}
        ></till-ticket-view>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-app": TillApp;
  }
}
