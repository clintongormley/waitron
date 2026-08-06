import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { setLocale, t } from "./i18n/t.js";
import { TillApi } from "./api/client.js";
import { WorkingOrderStore } from "./state/working-order.js";
import { LAYOUT_A } from "./layout.js";
// Side-effect imports register the three screen elements this app swaps between; it names them only
// as tags below, so the wiring — not the screens — is what lives here.
import "./screens/till-lock-screen.js";
import "./screens/till-counter-screen.js";
import "./screens/till-ticket-view.js";
import type { StringKey } from "./i18n/strings.js";
import type {
  HeldOrderSummary,
  OrderFlow,
  PrepQueueEntry,
  PrepState,
  TillProduct,
  TillSaleResult,
} from "./api/client.js";
import type { LayoutDef } from "./layout.js";
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
 *  - boot → `getTill` sets the operator-UI locale, remembers the receipt (invoice) locale, the ticket
 *    issuer and (7c) the location's pay-timing mode ({@link orderFlow}); the app opens on `lock`;
 *  - `logged-in` → load the products, remember the operator, show the `counter`, refresh the held list
 *    and (Modes I/T) the prep queue;
 *  - `confirm-payment` (Mode P) → `recordSale` the basket, then show the `ticket` and refresh the held
 *    list so a settled parked order drops off (or, on a rejected `{code}`, stay on the counter with the
 *    basket intact and surface a non-fatal error — a till must never lose a sale in progress);
 *  - `place-order` (Modes I/T) → park-or-sync then `placeOrder` the basket, move to the `"collect"`
 *    stage for the SAME order and refresh the prep queue;
 *  - `collect-order` (Modes I/T) → `collectOrder` the placed order, then show the `ticket` — the same
 *    shape `confirm-payment` follows, on the collect-stage tender instead of a fresh sale;
 *  - `advance-prep` → `advancePrep` one prep-queue entry, then refresh the queue regardless of outcome;
 *  - `new-sale` → clear the basket, reset the `"order"`/`"collect"` stage, back to an empty `counter`;
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
   * widget. Refreshed from `listWorkingOrders` on entering the counter and after every park, retrieve,
   * discard and successful pay — the moments the set changes — so a register always shows the current
   * parked orders, including ones parked on a different register.
   */
  @state() private heldOrders: HeldOrderSummary[] = [];
  /**
   * The location's pay-timing mode (7c prepare & collect, design §3), read once from `GET /api/till`
   * on boot (see `#boot`) — BEFORE login, since the counter needs it the moment it first renders.
   * Defaults `"prepay"` (Mode P), the walk-up flow every earlier slice shipped, so a boot that has not
   * yet resolved (or a stub that omits it) never shows Modes I/T's Place/Collect controls by accident.
   */
  @state() private orderFlow: OrderFlow = "prepay";
  /**
   * Where the CURRENT basket sits in a Mode-I/T order's life: `"order"` (composing/placing, the
   * default) or `"collect"` (this basket's order was placed and now awaits its tender). Ignored by
   * `tender-pay` under Mode P (`orderFlow === "prepay"`), which has no separate collect stage. Reset
   * to `"order"` by `#onNewSale` — the same moment the basket itself is cleared.
   */
  @state() private stage: "order" | "collect" = "order";
  /**
   * This node's active prep-queue entries (7c, design §5), handed to the counter's prep-queue widget.
   * Refreshed on entering the counter, after a successful place (Modes I/T enqueue automatically) and
   * after every advance — the moments the queue's contents change. Fetching is gated on
   * {@link orderFlow}: Mode P has no automatic path into prep (`sendToPrep` is a manual, unbuilt
   * follow-up — see `#refreshPrepQueue`), so a prepay till never issues the request.
   */
  @state() private prepQueue: PrepQueueEntry[] = [];
  /** The filed sale to print; set on a successful `recordSale`, read by the ticket view. The ticket's
   * line list comes from THIS result's `lines` (the filed composition), never the client basket. */
  @state() private result?: TillSaleResult;
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
  /**
   * REENTRY GUARD for placing — the same shape as {@link parking}, one flag per in-flight request. Set
   * synchronously at the top of {@link TillApp.#onPlaceOrder} before its first await and cleared in its
   * `finally`. Also OR'd into the `busy` prop threaded to `till-counter-screen` (alongside
   * {@link submitting}), so the Place control disables while its park-then-place round trip is
   * in flight — the same visible feedback `submitting` gives Pay/Collect.
   */
  @state() private placing = false;

  override firstUpdated(): void {
    void this.#boot();
  }

  /**
   * Read the public till info once: set the OPERATOR-UI locale (`setLocale`), remember the receipt
   * (invoice) locale for the ticket, remember the ticket issuer, and (7c) remember the location's
   * pay-timing mode. `setLocale` and `invoiceLocale` both take the SAME server `locale`, but they
   * drive different things and are threaded separately — the receipt uses its `invoiceLocale` PROP and
   * must never follow the operator UI (see `till-ticket-view`'s INVOICE LOCALE note).
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
    this.orderFlow = till.orderFlow;
  }

  /** A confirmed login: load the catalogue, remember the operator, show the counter, list held orders
   * and (Modes I/T) the prep queue. */
  async #onLoggedIn(event: Event): Promise<void> {
    const { displayName } = (event as CustomEvent<LoggedInDetail>).detail;
    const products = await this.api.listProducts();
    this.products = products;
    this.operatorName = displayName;
    this.errorKey = undefined;
    this.screen = "counter";
    await this.#refreshHeldOrders();
    await this.#refreshPrepQueue();
  }

  /**
   * Reload the cross-till held-orders list from the server. Called on entering the counter and after
   * every park/retrieve/discard and every successful pay, the moments the node's set of open parked
   * orders changes. Only writes reactive state, so no `isConnected` guard is needed (see the app's
   * DISCONNECT SAFETY note).
   */
  async #refreshHeldOrders(): Promise<void> {
    this.heldOrders = await this.api.listWorkingOrders();
  }

  /**
   * Reload the node's prep queue (7c, design §5). Called on entering the counter, after a successful
   * place (Modes I/T enqueue automatically at placing) and after every advance — the moments the
   * queue's contents change. Gated on {@link orderFlow}: under Mode P nothing auto-enqueues (`sendToPrep`
   * is a manual action with no UI control yet — a documented follow-up, not built here), so the widget
   * would only ever show its empty state and the request would be pure waste; skip it entirely.
   */
  async #refreshPrepQueue(): Promise<void> {
    if (this.orderFlow === "prepay") return;
    this.prepQueue = await this.api.listPrepQueue();
  }

  /**
   * Settle the basket (Mode P). A persisted/retrieved basket is SYNCED before paying so a local edit
   * takes effect; a fresh walk-up is filed straight from its lines. The ticket's line list comes from
   * the server RESULT (`result.lines`, the filed composition), so nothing is snapshotted from the
   * client basket here — a rejection simply leaves that same basket untouched on the counter.
   */
  async #onConfirmPayment(event: Event): Promise<void> {
    // Single-flight: a second confirm-payment fired before the first sale settles is a no-op, so the
    // same basket can never file twice (see `submitting`). Set BEFORE the first await — event dispatch
    // is synchronous, so the re-entrant call reads the flag that this call has already raised.
    if (this.submitting) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    // The store's STABLE working-order id — its own client-minted uuid for a walk-up, or a retrieved
    // order's id after `loadFrom` adopted it (see `#onRetrieveOrder`). Sending it (never a fresh uuid)
    // is the pay-idempotency key (spec §3): a lost-response re-tap replays against the same row rather
    // than filing a second chained record, and paying a RETRIEVED order settles under that order's own
    // id instead of orphaning it `open`. `#onParkOrder` sends the same `#store.id`.
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    try {
      // Re-lock an EDITED retrieved order before paying: the server's retrieved-order pay path files
      // from the STORED lock and IGNORES `req.lines`, so an edit made after retrieve would be SILENTLY
      // DROPPED from both the charge and the filed record without this (7b→7c regression). `#syncIfDirty`
      // carries the `persisted && dirty` gate and the `not_open` swallow (see its own doc) — a fresh
      // walk-up and an UNEDITED retrieved order both skip it, so the no-edit path files the stored lock,
      // and an already-settled order falls through to `recordSale`'s settled REPLAY below.
      await this.#syncIfDirty(id, lines, label);
      this.result = await this.api.recordSale(lines, tender, id);
      this.screen = "ticket";
      // A settled PARKED order must drop off the cross-till held list immediately — mirror the
      // park/retrieve/discard refresh (the four moments the node's open set changes). Without this a
      // just-paid retrieved order lingers in the in-memory `heldOrders` and re-appears on the counter
      // after "New sale" until the next park/retrieve/discard. Only on the success path; a walk-up
      // simply re-reads an unchanged list. Self-heals even if it fails — a retrieve of the settled
      // order 404s → `held.stale` → refresh — and cannot double-file (pay is idempotent, spec §3).
      await this.#refreshHeldOrders();
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

  /** Maps the current basket to the `{ productId, quantity }` line shape every server call takes
   * (`parkOrder`, `updateWorkingOrder`, `placeOrder`, `recordSale`) — never a price, since the server
   * always re-prices. Shared by `#onParkOrder`, `#onPlaceOrder`/`#syncIfDirty` and `#onConfirmPayment`. */
  #currentSaleLines(): { productId: string; quantity: string }[] {
    return this.#store.lines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
    }));
  }

  /**
   * Re-sync a PERSISTED (retrieved) working order to the server before a terminal fiscal step — pay
   * (`#onConfirmPayment`) or place (`#onPlaceOrder`) — but ONLY when the basket was actually EDITED
   * since it was retrieved. The one place both call sites express that rule, so neither re-implements
   * it. Two guards, both load-bearing:
   *  - `persisted`: a fresh walk-up (not persisted) has no server row to update — pay creates its order
   *    from the sent `lines`, place PARKS it first — so this is a no-op for it (each call site owns the
   *    fresh-basket branch; this helper only ever runs the update).
   *  - `dirty`: an UNEDITED retrieved order must NOT re-sync. `updateWorkingOrder` re-prices against the
   *    LIVE catalogue and replaces the ADD-TIME lock, so re-syncing an untouched order would file at the
   *    pay/place-time price and defeat the line-add snapshot (design §3: placing does not re-lock price).
   *    Gating on the edit keeps the no-edit path filing the stored lock.
   *
   * A `working_order.not_open` rejection is SWALLOWED (never re-thrown): it means the order is already
   * non-open — settled (a lost-response re-tap, or the loser of a two-till concurrent pay on the same
   * parked order), or placed (a concurrent place / an already-placed re-tap). That is NOT an error to
   * show: the caller's next step REPLAYS against the persisted row — `recordSale`'s settled branch
   * re-prints the filed ticket (spec §3), or `placeOrder` replays via `sales_working_order_id_key` —
   * never a double-file. Any OTHER rejection is a real sync failure and propagates to the caller's
   * `sale.error`/`place.error` handler.
   */
  async #syncIfDirty(
    id: string,
    lines: { productId: string; quantity: string }[],
    label: string | undefined,
  ): Promise<void> {
    if (!(this.#store.persisted && this.#store.dirty)) return;
    try {
      await this.api.updateWorkingOrder(id, { lines, label });
    } catch (error) {
      if ((error as { code?: string }).code !== "working_order.not_open") throw error;
    }
  }

  /**
   * Place the current basket (Modes I/T only — `tender-pay` never emits `place-order` under Mode P,
   * design §3): `open → placed`, freezing composition and (Mode I) issuing a deferred invoice.
   *
   * `placeOrder` requires the order to ALREADY exist as an `open` row, so this readies it first: a
   * basket never yet persisted (a fresh walk-up) is PARKED (`parkOrder`, then `store.markPersisted()`);
   * a basket already persisted (a RETRIEVED held order) is re-synced with `updateWorkingOrder` ONLY when
   * it was EDITED since retrieve (`#syncIfDirty`) — re-parking it would collide on the primary key
   * (`parkOrder` is a plain INSERT, not an idempotent replace), and re-syncing an UNEDITED order would
   * re-price it at place-time and defeat the add-time lock (design §3: placing does not re-lock price),
   * exactly as `#onConfirmPayment`'s pay-path re-sync guards. Either way the server places the intended
   * composition — the edit, or the stored lock — never a stale one.
   *
   * On success this widget instance moves to the `"collect"` stage for the SAME order (`store.id` is
   * unchanged — only `#onNewSale` re-mints it) and refreshes the prep queue, since Modes I/T enqueue
   * automatically at placing. Reentry-guarded like `#onParkOrder`'s `parking` (see `placing`'s own doc).
   */
  async #onPlaceOrder(): Promise<void> {
    if (this.placing) return;
    this.placing = true;
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    try {
      if (this.#store.persisted) {
        // A RETRIEVED order already exists server-side — sync it (only if EDITED, via `#syncIfDirty`)
        // rather than re-park: a re-park of the same id would 23505 on the server's plain INSERT, and
        // re-syncing an UNEDITED order would re-price it at place-time and defeat the add-time lock
        // (design §3). Symmetric with `#onConfirmPayment`'s pre-pay re-sync.
        await this.#syncIfDirty(id, lines, label);
      } else {
        await this.api.parkOrder({ id, lines, label });
        this.#store.markPersisted();
      }
      await this.api.placeOrder(id);
      this.stage = "collect";
      await this.#refreshPrepQueue();
    } catch {
      // A rejected {code} must not lose the order in progress: stay on the counter, basket (and its
      // `"order"` stage) intact, and surface a generic, non-fatal message — never the raw domain code.
      this.errorKey = "place.error";
    } finally {
      this.placing = false;
    }
  }

  /**
   * Collect and finalise a PLACED order (Modes I/T only, design §3): Mode I settles the already-issued
   * deferred invoice, Mode T files immediate — `collectOrder`'s own dispatch, unreached by this call.
   * Reuses `submitting`, the SAME single-flight guard `#onConfirmPayment` uses — both are terminal
   * fiscal-file moments (CLAUDE.md §5's double-file safety) — so a re-fired `collect-order` before the
   * first settles is a no-op exactly like a re-fired `confirm-payment`. Collect files the order's FROZEN
   * placed composition (never `req.lines`), and the ticket's line list comes from that filed result
   * (`result.lines`) — so a local edit made after placing does NOT reach the receipt, which shows the
   * invoiced goods. The basket itself is left untouched either way (like `#onConfirmPayment`), so
   * `#onNewSale` remains the one place that clears it and resets `stage`.
   */
  async #onCollectOrder(event: Event): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    const id = this.#store.id;
    this.errorKey = undefined;
    try {
      this.result = await this.api.collectOrder(id, tender);
      this.screen = "ticket";
    } catch {
      this.errorKey = "sale.error";
    } finally {
      this.submitting = false;
    }
  }

  /**
   * Advance a prep-queue entry one step (7c, design §5) — the kitchen action `<till-prep-queue>`'s
   * Advance control emits. Runs the refresh on BOTH paths, like `#onDiscardOrder`: even a rejected
   * advance (a race with another till, or a since-collected order) re-reads the queue, so a stale entry
   * corrects itself rather than sitting on an out-of-date state.
   */
  async #onAdvancePrep(event: Event): Promise<void> {
    const { id, to } = (event as CustomEvent<{ id: string; to: PrepState }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.advancePrep(id, to);
    } catch {
      this.errorKey = "prep.advance_error";
    }
    await this.#refreshPrepQueue();
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
    // Read the id (and map the lines) BEFORE the await: a successful clear() re-mints the id, so the
    // values sent must be captured against the basket as it stands now. `#currentSaleLines()` maps the
    // basket synchronously here, before the await.
    const id = this.#store.id;
    this.errorKey = undefined;
    try {
      await this.api.parkOrder({ id, lines: this.#currentSaleLines(), label });
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
    // Clear any prior non-fatal banner on the way in, exactly as `#onRetrieveOrder` does — a
    // successful discard must not leave a stale error (e.g. a `held.stale` from an earlier dead tap)
    // showing over the counter.
    this.errorKey = undefined;
    try {
      await this.api.abandonWorkingOrder(id);
    } catch {
      this.errorKey = "held.stale";
    }
    await this.#refreshHeldOrders();
  }

  /** Start the next sale: empty the basket (and, with it, its `persisted` flag), reset the place/collect
   * stage back to `"order"`, back to the counter. */
  #onNewSale(): void {
    this.#store.clear();
    this.stage = "order";
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

  /**
   * The layout to render for {@link orderFlow}: `LAYOUT_A` minus the prep-queue widget under Mode P.
   * Mode P has no automatic path into prep (see `#refreshPrepQueue`'s doc), so the widget would only
   * ever show its empty state there; Modes I/T enqueue automatically at placing (design §5) and are the
   * modes prep-queue exists for. `layout.ts` itself stays plain data (its own stated invariant) — this
   * derivation lives here, in the composition root, not there.
   */
  #layoutFor(): LayoutDef {
    return this.orderFlow === "prepay"
      ? LAYOUT_A.filter((widget) => widget.type !== "prep-queue")
      : LAYOUT_A;
  }

  override render() {
    return html`
      <div
        class="app"
        @logged-in=${(event: Event) => void this.#onLoggedIn(event)}
        @confirm-payment=${(event: Event) => void this.#onConfirmPayment(event)}
        @place-order=${() => void this.#onPlaceOrder()}
        @collect-order=${(event: Event) => void this.#onCollectOrder(event)}
        @advance-prep=${(event: Event) => void this.#onAdvancePrep(event)}
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
          .prepQueue=${this.prepQueue}
          .operatorName=${this.operatorName}
          .orderFlow=${this.orderFlow}
          .stage=${this.stage}
          .busy=${this.submitting || this.placing}
          .layout=${this.#layoutFor()}
        ></till-counter-screen>`;
      case "ticket":
        return html`<till-ticket-view
          .result=${this.result}
          .issuer=${this.issuer}
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
