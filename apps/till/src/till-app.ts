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
import type { HeldOrderSummary, TillProduct, TillSaleResult } from "./api/client.js";
import type { OrderLine } from "./state/working-order.js";
import type { LoggedInDetail } from "./screens/till-lock-screen.js";
import type { TicketIssuer } from "./screens/till-ticket-view.js";
import type { ConfirmPaymentDetail, ParkOrderDetail } from "./widgets/tender-pay.js";

/** The three faces of the till: sign in, ring up, print. The app shows exactly one at a time. */
type Screen = "lock" | "counter" | "ticket";

/**
 * The quantity string to DISPLAY for a retrieved parked line. The server stores and returns every
 * quantity at numeric(_,3) scale, so an EACH product's whole count arrives as "2.000" — which the
 * basket would otherwise render verbatim. Trim the trailing zeros (and a bare trailing dot) so an
 * each line reads "2", not "2.000"; a WEIGHT product keeps its decimals ("0.320"). Only the DISPLAY
 * string is cleaned — re-pricing is untouched, because `priceBasket` parses the decimal either way
 * (`decimal("2")` and `decimal("2.000")` are equal), as does the pay-time `recordSale`. Applied here
 * in the app's retrieve mapping, deliberately NOT in the store (which stores lines verbatim).
 */
function displayQuantity(product: TillProduct, quantity: string): string {
  if (product.pricingUnit !== "each" || !quantity.includes(".")) return quantity;
  return quantity.replace(/0+$/, "").replace(/\.$/, "");
}

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
  /**
   * The node's OPEN parked orders (the cross-till held list), handed to the counter's held-orders
   * widget. Refreshed from `listWorkingOrders` on entering the counter and after every park, retrieve
   * and discard — the four moments the set changes — so a register always shows the current parked
   * orders, including ones parked on a different register.
   */
  @state() private heldOrders: HeldOrderSummary[] = [];
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
  /**
   * REENTRY GUARD for parking — the same shape as {@link submitting}, one flag per in-flight request.
   * Set synchronously at the top of {@link TillApp.#onParkOrder} before the first `await parkOrder` and
   * cleared in its `finally`, so a re-fired `park-order` (double-tap, a laggy link) is a no-op while the
   * first is pending. Parking twice is idempotent server-side (the id is the primary key), so this is
   * hygiene rather than a fiscal safety — but a duplicate `POST` is still avoided.
   */
  @state() private parking = false;

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

  /** A confirmed login: load the catalogue, remember the operator, show the counter, list held orders. */
  async #onLoggedIn(event: Event): Promise<void> {
    const { displayName } = (event as CustomEvent<LoggedInDetail>).detail;
    const products = await this.api.listProducts();
    this.products = products;
    this.operatorName = displayName;
    this.errorKey = undefined;
    this.screen = "counter";
    await this.#refreshHeldOrders();
  }

  /**
   * Reload the cross-till held-orders list from the server. Called on entering the counter and after
   * every park/retrieve/discard, the moments the node's set of open parked orders changes. Only writes
   * reactive state, so no `isConnected` guard is needed (see the app's DISCONNECT SAFETY note).
   */
  async #refreshHeldOrders(): Promise<void> {
    this.heldOrders = await this.api.listWorkingOrders();
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
        // Task 9 placeholder: a walk-up mints a fresh idempotency id per sale (the same default the
        // server applies when none is sent). Task 10/11 replaces this with the store's held
        // working-order id, so paying a RETRIEVED parked order settles under that order's own id.
        crypto.randomUUID(),
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

  /**
   * Park the current basket to pay later, then empty it for the next customer — staying on the counter
   * (a parked order is NOT a completed sale, so there is no ticket). The store's stable `id` is sent as
   * the park-idempotency key; on success `store.clear()` empties the basket AND re-mints that id, so the
   * next park/pay keys a fresh working order rather than colliding with the parked one. A rejected park
   * must not lose the order: like `#onConfirmPayment`, it surfaces a non-fatal error and leaves the
   * basket intact (no `clear`) so the operator can retry.
   */
  async #onParkOrder(event: Event): Promise<void> {
    // Reentry guard: a second park-order fired before the first settles is a no-op (see `parking`).
    if (this.parking) return;
    this.parking = true;
    const { label } = (event as CustomEvent<ParkOrderDetail>).detail;
    // Read the id and lines BEFORE the await: a successful clear() re-mints the id, so the value sent
    // must be captured against the basket as it stands now.
    const id = this.#store.id;
    const lines = this.#store.lines;
    this.errorKey = undefined;
    try {
      await this.api.parkOrder({
        id,
        lines: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        label,
      });
      this.#store.clear();
      await this.#refreshHeldOrders();
    } catch {
      // A rejected park must not lose the order: stay on the counter, basket intact, generic message.
      this.errorKey = "held.park_error";
    } finally {
      this.parking = false;
    }
  }

  /**
   * Retrieve a parked order into the basket — the other half of the cross-till story. Fetch the order,
   * rebuild its lines by resolving each `productId` against the loaded catalogue (the parked line
   * stores only id + quantity — never a price — so the till RE-PRICES on retrieve), load them into the
   * shared store under the retrieved order's own id (so paying it later keys the same idempotency slot
   * the server persisted it under), and refresh the list. Stays on the counter with the retrieved
   * basket ready to ring or pay.
   *
   * DEACTIVATED-PRODUCT EDGE (spec §4): a line whose product no longer resolves — deactivated in the
   * catalogue since the order was parked — is DROPPED from the rebuilt basket and a non-fatal
   * `held.product_gone` is surfaced, rather than failing the whole retrieve. The operator gets the rest
   * of the order back and is told something was removed.
   *
   * Each `quantity` arrives at numeric(_,3) scale ("2.000"); {@link displayQuantity} cleans an EACH
   * count's trailing zeros for display without touching re-pricing (a weight keeps its decimals).
   *
   * CROSS-TILL STALE-LIST RACE. The held list has no live push (by design — replication is future
   * shared infra), so between our last `listWorkingOrders` and this tap another register may have paid
   * or discarded the order, and `retrieveWorkingOrder` then rejects (`working_order.not_found`). Like
   * `#onParkOrder`/`#onConfirmPayment`, that must fail GRACEFULLY: surface a non-fatal `held.stale` (never
   * the raw code) and leave the current basket UNTOUCHED — `loadFrom` runs only after the successful
   * await, so a rejection never half-loads it. The refresh below then runs on both paths, so the
   * vanished order drops off the list rather than sitting there inviting another dead tap.
   */
  async #onRetrieveOrder(event: Event): Promise<void> {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.errorKey = undefined;
    try {
      const order = await this.api.retrieveWorkingOrder(id);
      const lines: OrderLine[] = [];
      let droppedAProduct = false;
      for (const line of order.lines) {
        const product = this.products.find((candidate) => candidate.id === line.productId);
        if (product === undefined) {
          // The product was deactivated since the order was parked: drop the line, flag it, keep going.
          droppedAProduct = true;
          continue;
        }
        lines.push({ product, quantity: displayQuantity(product, line.quantity) });
      }
      if (droppedAProduct) this.errorKey = "held.product_gone";
      this.#store.loadFrom(order.id, lines, order.label ?? undefined);
    } catch {
      // The order was paid/discarded on another register since our list was refreshed: non-fatal
      // notice, basket left intact (loadFrom never ran), never leak the raw code.
      this.errorKey = "held.stale";
    }
    // Runs on both paths: on success the list is re-read; on the stale race the vanished row drops off.
    await this.#refreshHeldOrders();
  }

  /**
   * Discard a parked order (`open → abandoned`), then refresh the held list so it drops off. The same
   * cross-till stale-list race as {@link TillApp.#onRetrieveOrder} applies: if the order was already
   * paid/discarded on another register, `abandonWorkingOrder` rejects (`working_order.not_open`) — a
   * non-fatal `held.stale`, never the raw code. The refresh runs on both paths, so a stale row drops
   * off whether the discard landed or the order was already gone.
   */
  async #onDiscardOrder(event: Event): Promise<void> {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    try {
      await this.api.abandonWorkingOrder(id);
    } catch {
      this.errorKey = "held.stale";
    }
    await this.#refreshHeldOrders();
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
        @park-order=${(event: Event) => void this.#onParkOrder(event)}
        @retrieve-order=${(event: Event) => void this.#onRetrieveOrder(event)}
        @discard-order=${(event: Event) => void this.#onDiscardOrder(event)}
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
          .heldOrders=${this.heldOrders}
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
