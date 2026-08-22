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
import "./screens/till-schedule-screen.js";
import "./screens/till-floor-screen.js";
import "./screens/till-table-order-screen.js";
import "./screens/till-station-screen.js";
import type { StringKey } from "./i18n/strings.js";
import type { BumpMode, FireControlMode } from "./widgets/station-queue.js";
import type {
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  PayOutcome,
  Station,
  StationQueueGroup,
  StaffMember,
  TabLine,
  TableServiceStatus,
  TableState,
  TicketState,
  TillInfo,
  TillProduct,
  TillSaleResult,
} from "./api/client.js";
import type { LayoutDef, ReceiptConfig } from "./layout.js";
import type { OrderLine } from "./state/working-order.js";
import type { LoggedInDetail } from "./screens/till-lock-screen.js";
import type { TicketIssuer } from "./screens/till-ticket-view.js";
import type {
  CollectCardDetail,
  ConfirmPaymentDetail,
  ParkOrderDetail,
} from "./widgets/tender-pay.js";

/**
 * The faces of the till: sign in, ring up, print, the staff schedule, and (FP-1) the live floor and the
 * per-table ordering screen. One at a time. `"table-order"` is added here by Task 8 so `#renderScreen`
 * stays exhaustive (Ruling FP-D) — it renders a placeholder until Task 9 supplies `<till-table-order-screen>`.
 */
type Screen = "lock" | "counter" | "ticket" | "schedule" | "floor" | "table-order" | "station";

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
 * Whether a received layout is the built-in default {@link LAYOUT_A}, compared by VALUE (serialised) —
 * the layout arrives as fresh JSON from `GET /api/till`, never the local `LAYOUT_A` reference. Design
 * §7: a DEFAULT (or absent) layout keeps slice 1's Mode-P prep-queue drop as the fallback
 * (`#layoutFor`); an AUTHORED layout — ANY structural difference, a reordering or a
 * per-widget config key — renders VERBATIM, the owner's choice (a prep-queue they placed under Mode P
 * simply shows its empty state).
 *
 * The serialised compare is exact because the till's `LAYOUT_A` (`layout.ts:47-54`) and the server's
 * `DEFAULT_LAYOUT` are the SAME literal in the same key order (`type`/`region`/`config`, empty bags) —
 * a verbatim copy, verified in `packages/layouts/src/defaults.ts`. A false-negative would cost only the
 * cosmetic Mode-P prep-queue drop, never a fiscal element. Both branches are proven by the
 * `default-copy → prep-queue dropped` and `authored → prep-queue survives` tests (making this return a
 * constant fails one or the other).
 */
// `LAYOUT_A` is a module constant, so its serialisation never changes — compute it once at module
// load rather than on every `isDefaultLayout` call, which `#layoutFor()` runs on every reactive
// re-render of the live counter. (Imports are initialised before this runs, so `LAYOUT_A` is bound.)
const LAYOUT_A_JSON = JSON.stringify(LAYOUT_A);

function isDefaultLayout(layout: LayoutDef): boolean {
  return JSON.stringify(layout) === LAYOUT_A_JSON;
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
 *  - `collect-card` (integrated card terminal, sub-project 7 Task 8) → `pay` the basket over the
 *    provider; same success shape as `confirm-payment`, but a decline/timeout/network-unavailable is
 *    DATA, not a throw — stay on the counter with the basket intact and record the outcome
 *    ({@link cardOutcome}) instead of an error (CLAUDE.md §5: nothing may block a sale but the sale
 *    itself);
 *  - `place-order` (Modes I/T) → park-or-sync then `placeOrder` the basket, move to the `"collect"`
 *    stage for the SAME order and refresh the default station's queue;
 *  - `collect-order` (Modes I/T) → `collectOrder` the placed order, then show the `ticket` — the same
 *    shape `confirm-payment` follows, on the collect-stage tender instead of a fresh sale;
 *  - `advance-ticket-item` (KDS-1) → `advanceTicketItem` one ticket line, then refresh the default
 *    station's queue regardless of outcome;
 *  - `show-station` → switch to the kitchen station-display screen (basket-preserving);
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
  /** The logged-in operator's person id — threaded to the schedule screen so it can filter the
   * operator out of the colleague picker (you cannot offer a shift to yourself). */
  @state() private operatorPersonId = "";
  /** The active staff roster, loaded at login (unauthenticated `GET /api/staff`) and threaded to the
   * schedule screen's colleague picker. Defaults empty — a roster fetch failure leaves the picker
   * empty rather than blocking the counter. */
  @state() private staff: StaffMember[] = [];
  /**
   * The node's OPEN parked orders (the cross-till held list), handed to the counter's held-orders
   * widget. Refreshed from `listWorkingOrders` on entering the counter and after every park, retrieve,
   * discard and successful pay — the moments the set changes — so a register always shows the current
   * parked orders, including ones parked on a different register.
   */
  @state() private heldOrders: HeldOrderSummary[] = [];
  /** The venue's active floor-plan zones (FP-1), loaded on entering the floor screen and handed to it.
   * Owned and refreshed by the app, like {@link heldOrders}. */
  @state() private zones: FloorZone[] = [];
  /** The live-floor occupancy read-model (FP-1), loaded on entering the floor screen and handed to it.
   * Owned and refreshed by the app, like {@link heldOrders}. */
  @state() private tables: TableState[] = [];
  /**
   * Whether the logged-in operator may edit the spatial floor plan (FP-2) — true iff they hold
   * `till.configure` (a manager/admin, spec §3). Threaded to `till-floor-screen.canEdit` to gate its
   * "Editar plano" toggle. Client hiding is convenience only; the on-till placement route re-checks the
   * gate server-side (FP-2 Task 4).
   *
   * Set at login from the session's SERVER-COMPUTED `canConfigureTill` capability ({@link #onLoggedIn}),
   * so the client never re-derives it from a role (which would drift from the server's
   * `roleHasPermission`), and reset to `false` on logout so the next operator starts un-privileged until
   * their own login re-supplies it.
   */
  @state() private canEdit = false;
  /**
   * The venue's ACTIVE service statuses (FP-1, TS-2) — the catalogue the table-order screen's Estado
   * picker offers, loaded from `GET /api/statuses` on entering the floor and threaded to the screen.
   * The FULL active set (not derived from which statuses happen to be applied to a table), so a
   * configured-but-never-yet-applied status can still be picked. Owned and refreshed by the app.
   */
  @state() private statuses: TableServiceStatus[] = [];
  /**
   * The working-order id of the tab the operator just opened or resumed from the floor (FP-1) — the
   * `orderId` Task 9's table-ordering screen reads. Set by {@link TillApp.#onOpenTable}: `openTab`'s new
   * id for a free table, or the read-model's {@link TableState.tabId} for an occupied one. A tab is a
   * PRE-FISCAL working order (design H2) — opening one files no sale/registro/huella.
   */
  @state() private activeTabId?: string;
  /**
   * The TABLE id of the tab the operator opened from the floor (FP-1, Ruling FP-F). DISTINCT from
   * {@link activeTabId} (the tab's working-order id): the table-order screen's `set-status` is keyed by
   * TABLE id, not order id, so `#onSetStatus` needs this. Set by {@link TillApp.#onOpenTable} from the
   * SAME `open-table` event that resolves {@link activeTabId}.
   */
  @state() private activeTableId?: string;
  /**
   * The open tab's lines (FP-1) — locked add-time prices + per-line served markers, from `getTabLines`.
   * Owned and refreshed by the app (loaded on entering the table-order screen and re-read after every
   * round/serve), handed to `till-table-order-screen` which renders its drawer/total/badge from them. A
   * tab does NOT re-price (design H2), so these are the authoritative locked figures, never recomputed.
   */
  @state() private tabLines: TabLine[] = [];
  /**
   * The location's pay-timing mode (7c prepare & collect, design §3), read once from `GET /api/till`
   * on boot (see `#boot`) — BEFORE login, since the counter needs it the moment it first renders.
   * Defaults `"prepay"` (Mode P), the walk-up flow every earlier slice shipped, so a boot that has not
   * yet resolved (or a stub that omits it) never shows Modes I/T's Place/Collect controls by accident.
   */
  @state() private orderFlow: OrderFlow = "prepay";
  /**
   * The till's integrated-card wiring (Task 9), read once from `GET /api/till` on boot alongside
   * {@link orderFlow} — threaded to `till-tender-pay` (via `till-counter-screen`) so it can choose
   * between the #62 manual (datáfono) Card path and the integrated `collect-card` one. Defaults
   * `"none"`, same reasoning as `orderFlow`'s default: a boot that has not yet resolved (or a stub
   * that omits it) never shows the integrated affordances by accident.
   */
  @state() private cardProvider: TillInfo["cardProvider"] = "none";
  /** Whether the till prompts for a tip on an integrated-card collection (Task 9), read once from
   * `GET /api/till` alongside {@link cardProvider}. Defaults `false`, same reasoning. */
  @state() private tipsEnabled = false;
  /**
   * Where the CURRENT basket sits in a Mode-I/T order's life: `"order"` (composing/placing, the
   * default) or `"collect"` (this basket's order was placed and now awaits its tender). Ignored by
   * `tender-pay` under Mode P (`orderFlow === "prepay"`), which has no separate collect stage. Reset
   * to `"order"` by `#onNewSale` — the same moment the basket itself is cleared.
   */
  @state() private stage: "order" | "collect" = "order";
  /**
   * The venue's kitchen stations (KDS-1), fetched lazily the first time the counter needs its
   * default-station queue (see {@link #refreshStationQueue}) and cached for the session. The counter's
   * queue reads the DEFAULT station; the dedicated station-display screen fetches its own list.
   */
  @state() private stations: Station[] = [];
  /**
   * The DEFAULT station's queue (KDS-1, design §3e — "the counter prep-queue becomes the default
   * station"), grouped by order, handed to the counter's station-queue widget. The per-line/per-station
   * successor to 7c's `prepQueue`. Refreshed on entering the counter, after a successful place (Modes I/T
   * enqueue automatically) and after every advance. Fetching is gated on {@link orderFlow}: Mode P has no
   * automatic path into the kitchen here (`sendToPrep` is a manual, unbuilt follow-up — see
   * {@link #refreshStationQueue}), so a prepay till never issues the request.
   */
  @state() private stationQueue: StationQueueGroup[] = [];
  /**
   * The venue's whole-ticket bump mode (KDS-1 §2e, `locations.bump_mode`) — `line` (per-line, the source
   * of truth) or `ticket` (advance the whole order at a station). Read once from `GET /api/till` on boot
   * ({@link TillInfo.bumpMode}) and threaded to the station-display screen, which enables its whole-ticket
   * affordance for a `ticket` venue. Defaults `line` until boot resolves — the fail-safe default (per-line
   * bump is always correct), so a boot that has not yet answered never shows the convenience by accident.
   */
  @state() private bumpMode: BumpMode = "line";
  /**
   * The venue's KDS fire-control mode (KDS-2 §2c, `locations.fire_control`) — `waiter` (the tab screen
   * owns the fire) or `kitchen` (the station display owns it). Read once from `GET /api/till` on boot
   * ({@link TillInfo.fireControl}) and threaded to the station-display screen, which shows its per-course
   * "Empezar curso" action only for a `kitchen` venue. Defaults `waiter` until boot resolves — the
   * fail-safe default, so a boot that has not yet answered never shows the display's fire by accident.
   */
  @state() private fireControl: FireControlMode = "waiter";
  /** The filed sale to print; set on a successful `recordSale`, read by the ticket view. The ticket's
   * line list comes from THIS result's `lines` (the filed composition), never the client basket. */
  @state() private result?: TillSaleResult;
  /**
   * The receipt (invoice) locale for the ticket, from `GET /api/till` — the language the legal
   * receipt renders in. Threaded to `till-ticket-view` SEPARATELY from the operator-UI `setLocale`,
   * even though both read the same server `locale` (see `#boot`). Defaults to the deli's es-ES.
   */
  @state() private invoiceLocale = "es-ES";
  /**
   * The owner-authored till layout as received from `GET /api/till` (layout & receipt editors), or
   * `undefined` when the server omits it (an older server predating the editor). {@link layoutFor}
   * renders an AUTHORED layout (present and structurally different from the built-in default) VERBATIM,
   * and falls back to the Mode-P-filtered {@link LAYOUT_A} for a default or absent layout — see its own
   * doc and {@link isDefaultLayout}.
   */
  @state() private receivedLayout?: LayoutDef;
  /**
   * The authored NON-FISCAL receipt trim (header subtitle + footer message), read from `GET /api/till`
   * on boot and threaded to `till-ticket-view`. Defaults to `{}` (no trim) — the value an older server
   * that omits the field, or a tenant that never opened the receipt editor, resolves to. It renders
   * AROUND the immutable art. 7.1 core, never able to touch it (design §8).
   */
  @state() private receipt: ReceiptConfig = {};
  /** The string key of a non-fatal error to show over the counter, or `undefined` for none. */
  @state() private errorKey?: StringKey;
  /**
   * The outcome of the most recent DECLINED/`timeout`/`network_unavailable` `collect-card` attempt
   * (integrated card terminal, sub-project 7 Task 8) — `undefined` once none is pending. Set by
   * {@link TillApp.#onCollectCard} on a non-`captured` outcome. Cleared wherever the basket it
   * describes stops being the one on the counter — at the top of `#onCollectCard` itself (a fresh
   * attempt clears any prior banner, like {@link errorKey}), and on the SUCCESS path of every handler
   * that swaps or empties `#store`: {@link TillApp.#onParkOrder} (`store.clear()` empties it for the
   * next customer), {@link TillApp.#onRetrieveOrder} (`store.loadFrom` swaps in a different order's
   * lines), and {@link TillApp.#onNewSale}. Deliberately NOT reset by
   * {@link TillApp.#onDiscardOrder}: that handler discards a held order named by the event's OWN `id`
   * and never touches `#store` — the currently loaded basket (and any outcome it carries) is
   * unaffected by discarding some other parked order. Read by `till-tender-pay` (Task 9, threaded
   * through `#renderScreen`/`till-counter-screen`) to render retry / switch-tender / wait.
   *
   * Marked `private` like every other `@state()` field on this class — safe now that `#renderScreen`
   * reads it (below), satisfying `tsconfig.base.json`'s `noUnusedLocals` the same way every sibling
   * field does. It was temporarily NOT `private` while Task 9's widget (the first reader) did not yet
   * exist; see git history on this line for the receipt that justified that, now moot.
   */
  @state() private cardOutcome?: Exclude<PayOutcome, { outcome: "captured" }>["outcome"];
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
   * Set synchronously at the top of {@link TillApp.#onParkOrder} before its first await and cleared in
   * its `finally`, so a re-fired `park-order` (double-tap, a laggy link) is a no-op while the first is
   * pending. A re-park is idempotent server-side (it REPLAYS the existing open order and inserts
   * nothing), so this is hygiene rather than a fiscal safety — but a duplicate `POST` is still avoided.
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
   * pay-timing mode plus (Task 9) its integrated-card wiring. `setLocale` and `invoiceLocale` both
   * take the SAME server `locale`, but they drive different things and are threaded separately — the
   * receipt uses its `invoiceLocale` PROP and must never follow the operator UI (see
   * `till-ticket-view`'s INVOICE LOCALE note).
   *
   * A FAILED `getTill` at start-up — the server unreachable, OR a non-2xx answer the client surfaces as a
   * rejected `{ code }` such as `server.internal` (see `api/client.ts`'s `!res.ok` branch) — must be a
   * HANDLED state, not an unhandled rejection: `firstUpdated` fires `void this.#boot()`, so an uncaught
   * throw escapes the microtask. The bare `catch` covers both, surfacing the `boot.error` banner; the lock
   * screen still renders beneath it and recovery is a page reload (this runs once, with no in-UI retry).
   */
  async #boot(): Promise<void> {
    try {
      const till = await this.api.getTill();
      // Guard the ONE post-await external effect: setLocale mutates module-global state, so a boot that
      // resolves after the app was torn down must not repaint a live sibling's locale. The state writes
      // below need no such guard — Lit never paints a detached element.
      if (!this.isConnected) return;
      setLocale(till.locale);
      this.invoiceLocale = till.locale;
      this.issuer = { venueName: till.venueName, nif: till.nif };
      this.orderFlow = till.orderFlow;
      this.bumpMode = till.bumpMode;
      this.fireControl = till.fireControl;
      this.cardProvider = till.cardProvider;
      this.tipsEnabled = till.tipsEnabled;
      // The authored (or default) layout + receipt trim (layout & receipt editors). `layout` drives
      // `#layoutFor()` (authored → verbatim, default/absent → the Mode-P fallback); `receipt` is threaded
      // to the ticket. `?? {}` handles an older server that omits `receipt` (the field is typed present).
      this.receivedLayout = till.layout;
      this.receipt = till.receipt ?? {};
    } catch {
      // Any boot failure — server unreachable, or a non-2xx `{ code }` — surfaces the non-fatal `boot.error`
      // banner rather than let the rejection escape unhandled. Needs no isConnected guard — Lit never paints
      // a detached element (see above).
      this.errorKey = "boot.error";
    }
  }

  /** A confirmed login: load the catalogue, remember the operator, show the counter, list held orders
   * and (Modes I/T) the prep queue, then load the colleague roster for the schedule screen. */
  async #onLoggedIn(event: Event): Promise<void> {
    const { personId, displayName, canConfigureTill } = (event as CustomEvent<LoggedInDetail>)
      .detail;
    const products = await this.api.listProducts();
    this.products = products;
    this.operatorName = displayName;
    this.operatorPersonId = personId;
    // FP-2: gate the on-till floor editor on the server-computed `till.configure` capability handed down
    // in the session response. Convenience only — the placement route re-checks server-side.
    this.canEdit = canConfigureTill;
    this.errorKey = undefined;
    this.screen = "counter";
    await this.#refreshHeldOrders();
    await this.#refreshStationQueue();
    // The colleague roster for the staff schedule screen (unauthenticated `GET /api/staff`). Loaded
    // AFTER the counter is shown so a roster fetch failure never blocks the sale flow; the schedule
    // screen picks it up reactively via its `.staff` prop whenever it lands. A rejection is SWALLOWED,
    // leaving `staff` at its default `[]` — the picker stays empty rather than surfacing an error or
    // (under `void #onLoggedIn`) escaping as an unhandled rejection; the operator can still sell.
    try {
      this.staff = await this.api.listStaff();
    } catch {
      // Non-fatal: leave `this.staff` as its `[]` default (degrade gracefully, never rethrow).
    }
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
   * Reload the DEFAULT station's queue for the counter (KDS-1, design §3e). Called on entering the
   * counter, after a successful place (Modes I/T enqueue automatically at placing) and after every
   * advance — the moments the queue's contents change. Gated on {@link orderFlow}: under Mode P nothing
   * auto-enqueues (`sendToPrep` is a manual action with no UI control yet — a documented follow-up), so
   * the widget would only ever show its empty state and the request would be pure waste; skip it entirely.
   *
   * The station list is fetched ONCE and cached (`this.stations`): the counter needs only the default
   * station's id, which does not change mid-shift. A venue with no default station (a misconfiguration)
   * leaves the queue empty rather than throwing — the kitchen display touches no fiscal path.
   */
  async #refreshStationQueue(): Promise<void> {
    if (this.orderFlow === "prepay") return;
    if (this.stations.length === 0) this.stations = await this.api.listStations();
    const defaultStation = this.stations.find((station) => station.isDefault);
    if (defaultStation === undefined) {
      this.stationQueue = [];
      return;
    }
    this.stationQueue = await this.api.getStationQueue(defaultStation.id);
  }

  /** The DEFAULT station's id, or `undefined` when none is configured — threaded to the counter's
   * station-queue widget (its whole-ticket bump is keyed by station). */
  #defaultStationId(): string | undefined {
    return this.stations.find((station) => station.isDefault)?.id;
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

  /**
   * Settle the basket over the INTEGRATED card terminal (sub-project 7 Task 8). Same shape as
   * {@link TillApp.#onConfirmPayment} — single-flight via `submitting` (the SAME flag: both are
   * terminal fiscal-file moments, CLAUDE.md §5's double-file safety), the same pre-pay `#syncIfDirty`
   * re-lock for an edited retrieved order (`payWorkingOrderIntegrated` ignores `req.lines` for a
   * retrieved/placed order exactly like `recordSale` does — `IntegratedPayRequest`'s own doc,
   * `apps/server/src/till-sale.ts:185-187`), and the same post-success held-list refresh.
   *
   * It diverges only in what a NON-success answer means: `recordSale` rejects with a thrown `{ code }`
   * on any failure, but `pay` answers 200 with the outcome as DATA even on a decline
   * (`IntegratedPayOutcome`'s own doc — nothing may block a sale on anything but the sale itself,
   * CLAUDE.md §5). So this handler branches on `out.outcome` instead of assuming a ticket:
   *  - `captured`: identical to `#onConfirmPayment`'s success path — show the ticket, refresh the held
   *    list.
   *  - `declined` / `timeout` / `network_unavailable`: nothing was filed and the order stays `open`, so
   *    simply STAY on the counter with the basket intact and record the outcome in {@link cardOutcome}
   *    for Task 9's widget to render retry / switch-tender (cash or manual card is one tap away) /
   *    wait — never an error banner; this is not a fault.
   *  - a THROWN fault (a genuine server error, incl. the recovery-window corruption 500 — Task 5) falls
   *    to the `catch`, exactly like `#onConfirmPayment`: the generic `sale.error`, basket intact, never
   *    the raw code.
   */
  async #onCollectCard(event: Event): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const detail = (event as CustomEvent<CollectCardDetail>).detail;
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    this.cardOutcome = undefined;
    try {
      await this.#syncIfDirty(id, lines, label);
      const out: PayOutcome = await this.api.pay({
        id,
        lines,
        ...(detail.tip ? { tip: detail.tip } : {}),
        ...(detail.allowOffline ? { allowOffline: true } : {}),
      });
      if (out.outcome === "captured") {
        this.result = out.ticket;
        this.screen = "ticket";
        await this.#refreshHeldOrders();
      } else {
        this.cardOutcome = out.outcome;
      }
    } catch {
      this.errorKey = "sale.error";
    } finally {
      this.submitting = false;
    }
  }

  /** Maps the current basket to the `{ productId, quantity }` line shape every server call takes
   * (`parkOrder`, `updateWorkingOrder`, `placeOrder`, `recordSale`, `pay`) — never a price, since the
   * server always re-prices. Shared by `#onParkOrder`, `#onPlaceOrder`/`#syncIfDirty`,
   * `#onConfirmPayment` and `#onCollectCard`. */
  #currentSaleLines(): { productId: string; quantity: string }[] {
    return this.#store.lines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
    }));
  }

  /**
   * Re-sync a PERSISTED (retrieved) working order to the server before a terminal fiscal step — pay
   * (`#onConfirmPayment`/`#onCollectCard`) or place (`#onPlaceOrder`) — but ONLY when the basket was
   * actually EDITED since it was retrieved. The one place every call site expresses that rule, so none
   * re-implements it. Two guards, both load-bearing:
   *  - `persisted`: a fresh walk-up (not persisted) has no server row to update — pay creates its order
   *    from the sent `lines`, place PARKS it first — so this is a no-op for it (each call site owns the
   *    fresh-basket branch; this helper only ever runs the update).
   *  - `dirty`: an UNEDITED retrieved order must NOT re-sync. `updateWorkingOrder` re-prices against the
   *    LIVE catalogue and replaces the ADD-TIME lock, so re-syncing an untouched order would file at the
   *    pay/place-time price and defeat the line-add snapshot (design §3: placing does not re-lock price).
   *    Gating on the edit keeps the no-edit path filing the stored lock.
   *
   * A `working_order.not_open` rejection is SWALLOWED (never re-thrown): it means the order is already
   * non-open — settled, or placed (a lost-response re-tap, or the loser of a two-till concurrent
   * pay/place on the same order). What the caller's NEXT step does with that differs, and only the two
   * PAY paths are made whole by it:
   *  - PAY (`recordSale` and the integrated `pay`): swallowing lets each server route's own settled
   *    branch REPLAY the filed ticket (spec §3 for `recordSale`; `payWorkingOrderIntegrated`'s step 2,
   *    `apps/server/src/till-sale.ts:644-650`, for `pay` — same "already settled → idempotent replay,
   *    files nothing" shape) instead of surfacing an error — that replay is the whole point of the
   *    swallow. Never a double-file.
   *  - PLACE: server `placeOrder` is NOT idempotent — for a non-open order it re-raises the SAME
   *    `working_order.not_open` (working-order.ts refuses any non-open row; there is no
   *    `sales_working_order_id_key` replay for placing), which `#onPlaceOrder` surfaces as `place.error`.
   *    So a concurrent/re-tapped place of an already-placed order shows `place.error` whether or not this
   *    swallow fires — the swallow neither helps nor hurts the place path. Do NOT read it as a place
   *    replay; an idempotent `placeOrder` is a recorded backlog follow-up, not this behaviour.
   * Any OTHER rejection is a real sync failure and propagates to the caller's `sale.error`/`place.error`
   * handler.
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
   * it was EDITED since retrieve (`#syncIfDirty`) — re-parking it would SILENTLY REPLAY the existing open
   * order server-side and discard the edit (park is idempotent: the re-sent basket is dropped), and
   * re-syncing an UNEDITED order would re-price it at place-time and defeat the add-time lock (design §3:
   * placing does not re-lock price), exactly as `#onConfirmPayment`'s pay-path re-sync guards. Either way
   * the server places the intended composition — the edit, or the stored lock — never a stale one.
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
        // rather than re-park: a re-park of the same id would SILENTLY REPLAY the existing open order
        // server-side and discard the edit (park is idempotent — the re-sent basket is dropped), and
        // re-syncing an UNEDITED order would re-price it at place-time and defeat the add-time lock
        // (design §3). Symmetric with `#onConfirmPayment`'s pre-pay re-sync.
        await this.#syncIfDirty(id, lines, label);
      } else {
        await this.api.parkOrder({ id, lines, label });
        this.#store.markPersisted();
      }
      await this.api.placeOrder(id);
      this.stage = "collect";
      await this.#refreshStationQueue();
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
   * Advance a ticket ITEM one kitchen step (KDS-1, design §3c) — the per-line bump the counter's
   * default-station `<till-station-queue>` emits (`advance-ticket-item`). Runs the refresh on BOTH paths,
   * like `#onDiscardOrder`: even a rejected advance (a race with another till, or a since-advanced line)
   * re-reads the default station's queue, so a stale entry corrects itself rather than sitting on an
   * out-of-date state. The dedicated station-display SCREEN handles (and stops) its own advances, so this
   * only ever fires for the counter's widget.
   */
  async #onAdvanceTicketItem(event: Event): Promise<void> {
    const { itemId, to } = (
      event as CustomEvent<{ itemId: string; to: Exclude<TicketState, "queued"> }>
    ).detail;
    this.errorKey = undefined;
    try {
      await this.api.advanceTicketItem(itemId, to);
    } catch {
      this.errorKey = "station.advance_error";
    }
    await this.#refreshStationQueue();
  }

  /**
   * Hand a settled Mode-P order to the customer (KDS-1 §3e) — the per-order collect the counter's
   * default-station `<till-station-queue>` emits (`mark-collected`) for a COLLECTABLE (settled) order.
   * `markCollected` stamps the order-level `collected_at`, and the refresh then drops the handed-over
   * order off the counter's queue. NON-FISCAL — it settles nothing and files nothing, so it needs none of
   * the `submitting` single-flight guard the pay/collect fiscal moments use. Runs the refresh on BOTH
   * paths like {@link #onAdvanceTicketItem}: a rejected collect (a race, an already-collected order)
   * re-reads the queue so the display reconciles to server truth. The station-display SCREEN stops (and
   * handles) its own `mark-collected`, so this only ever fires for the counter's widget.
   */
  async #onMarkCollected(event: Event): Promise<void> {
    const { orderId } = (event as CustomEvent<{ orderId: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.markCollected(orderId);
    } catch {
      this.errorKey = "station.collect_error";
    }
    await this.#refreshStationQueue();
  }

  /** Show the station-display screen (KDS-1) — the kitchen's own view, reached from the counter's
   * "Kitchen" nav. Basket-preserving like the schedule/floor nav (the basket is till-owned); the screen
   * owns its own fetching via `.api`, so this just switches. */
  #onShowStation(): void {
    this.errorKey = undefined;
    this.screen = "station";
  }

  /**
   * Park (Hold) the current basket to pay later, then empty it for the next customer — staying on the
   * counter (a parked order is NOT a completed sale, so there is no ticket). Mirrors the ready-the-order
   * shape of {@link TillApp.#onPlaceOrder}, branching on whether the basket already exists server-side:
   *  - a FRESH walk-up (not persisted) is PARKED (`parkOrder`) under the store's stable `id`, the
   *    park-idempotency key;
   *  - a RETRIEVED order (already an `open` row server-side) is re-synced with `updateWorkingOrder` ONLY
   *    when it was EDITED since retrieve (`#syncIfDirty`), and NEVER re-parked. A re-park of the same id
   *    is now IDEMPOTENT server-side — it catches the unique violation and REPLAYS the existing open
   *    order, inserting nothing (the re-sent basket is DISCARDED; the id is the idempotency key) — so
   *    re-parking a retrieved order would SILENTLY discard the edit while showing success. Routing
   *    through `#syncIfDirty` saves the edit and no-ops an unedited retrieve, exactly as the pay path
   *    (`#onConfirmPayment`) and place path (`#onPlaceOrder`) do.
   *
   * On success `store.clear()` empties the basket AND re-mints its id (a cleared basket is a new working
   * order, ready to key a fresh park/pay), and `cardOutcome` is cleared alongside it so a declined card
   * on THIS basket never carries over into the next customer's unrelated sale (fix round 1). A rejected
   * park/sync must not lose the order: like `#onConfirmPayment`, it surfaces a non-fatal error and leaves
   * the basket intact (no `clear`) so the operator can retry — `cardOutcome` is left untouched on that
   * path too, since the same basket (and any decline it carries) is still the one on the counter.
   */
  async #onParkOrder(event: Event): Promise<void> {
    // Reentry guard: a second park-order fired before the first settles is a no-op (see `parking`).
    if (this.parking) return;
    this.parking = true;
    const { label } = (event as CustomEvent<ParkOrderDetail>).detail;
    // Read the id and map the lines BEFORE the await: a successful clear() re-mints the id, so the
    // values sent must be captured against the basket as it stands now.
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    this.errorKey = undefined;
    try {
      if (this.#store.persisted) {
        // A RETRIEVED order already exists server-side — sync it (only if EDITED, via `#syncIfDirty`)
        // rather than re-park: a re-park of the same id would SILENTLY REPLAY the existing open order
        // server-side and DISCARD the edit (park is idempotent — the re-sent basket is dropped).
        // Symmetric with `#onPlaceOrder`'s and `#onConfirmPayment`'s ready-the-order re-sync. The Hold
        // field opens BLANK (`event.detail.label` is undefined unless the operator types one), and
        // `updateWorkingOrder` writes `label ?? null`, so fall back to the STORED label — a blank re-hold
        // must keep the retrieved order's name (e.g. "Mesa 4"), not wipe it; a typed value renames.
        await this.#syncIfDirty(id, lines, label ?? this.#store.label);
      } else {
        await this.api.parkOrder({ id, lines, label });
      }
      this.#store.clear();
      this.cardOutcome = undefined;
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
   *
   * `loadFrom` swaps in a DIFFERENT order's lines, so a decline recorded against the basket being
   * replaced (`cardOutcome`) is cleared alongside it (fix round 1) — otherwise the newly retrieved
   * order would inherit a banner that describes a sale it was never part of. Cleared only on this
   * success path, not in the `catch`: a rejected retrieve leaves the current basket untouched, so
   * whatever `cardOutcome` it already carries is still describing the basket still on the counter.
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
      this.cardOutcome = undefined;
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
   * stage back to `"order"`, back to the counter. `cardOutcome` is cleared too — a new, unrelated
   * basket must never inherit a decline/timeout/network-unavailable banner from the sale before it. */
  #onNewSale(): void {
    this.#store.clear();
    this.stage = "order";
    this.errorKey = undefined;
    this.cardOutcome = undefined;
    this.screen = "counter";
  }

  /** Show the staff schedule screen (from the counter's "My schedule" control) WITHOUT clearing the
   * basket — the basket is till-owned and survives the round trip, exactly like logout. */
  #onShowSchedule(): void {
    this.errorKey = undefined;
    this.screen = "schedule";
  }

  /**
   * Show the live-floor screen (FP-1), loading the venue's zones and the live occupancy read-model first
   * so the floor renders populated. Basket-preserving like the schedule nav (the basket is till-owned).
   * Mirrors {@link TillApp.#onShowSchedule} plus a data load. A failed load is SWALLOWED — leaving the
   * last-known (or empty) floor — rather than blocking the operator, the same degrade-gracefully shape
   * {@link TillApp.#onLoggedIn} uses for the staff roster; the floor touches no fiscal path (design H2),
   * so an empty floor is safe. Only writes reactive state, so no `isConnected` guard is needed (the app's
   * DISCONNECT SAFETY note).
   */
  async #onShowFloor(): Promise<void> {
    this.errorKey = undefined;
    try {
      const [tables, zones, statuses] = await Promise.all([
        this.api.getTablesState(),
        this.api.listZones(),
        this.api.listStatuses(),
      ]);
      this.tables = tables;
      this.zones = zones;
      // The Estado picker's catalogue (FP-1) — loaded here so the table-order screen (reached from the
      // floor) has the full ACTIVE status set to offer, including statuses applied to no table yet.
      this.statuses = statuses;
    } catch {
      // Non-fatal: leave zones/tables/statuses at their last values (or empty), degrade gracefully.
    }
    this.screen = "floor";
  }

  /**
   * Re-read the floor after the floor screen persisted a spatial placement change (FP-2) — it emits
   * `floor-refresh` once its on-till `setTablePlacement` / `clearPlacement` write lands. Re-loads only
   * the TABLES (whose placement columns changed): a placement write only READS `floor_zones` (to
   * validate the target zone is active) and never mutates them, so the zone LIST is guaranteed unchanged
   * across an edit — `this.zones` (loaded on floor entry, {@link #onShowFloor}) is left as-is rather than
   * re-fetched for a value that cannot have moved. Statuses are likewise unchanged by a placement. Stays
   * on the floor and, like {@link #onShowFloor}, swallows a failed read (degrade gracefully — the floor
   * touches no fiscal path). Only writes reactive state, so no `isConnected` guard is needed (the
   * DISCONNECT SAFETY note).
   */
  async #refreshFloor(): Promise<void> {
    try {
      this.tables = await this.api.getTablesState();
    } catch {
      // Non-fatal: leave the last-known floor in place (degrade gracefully).
    }
  }

  /**
   * The floor screen asked to open (or resume) a table's tab (FP-1). A FREE table opens a fresh tab via
   * `openTab` — a PRE-FISCAL working order (design H2), never a sale/registro/huella — and the app
   * remembers its new working-order id; an OCCUPIED table already has one, resolved from the read-model
   * ({@link TableState.tabId}, present iff `hasOpenTab`). Either way the app moves to the table-ordering
   * screen, which reads {@link activeTabId} (Task 9). Awaits `openTab` on the happy path like
   * {@link TillApp.#onLoggedIn}'s `listProducts`.
   */
  async #onOpenTable(event: Event): Promise<void> {
    const { tableId, hasOpenTab } = (event as CustomEvent<{ tableId: string; hasOpenTab: boolean }>)
      .detail;
    this.errorKey = undefined;
    // `set-status` is keyed by TABLE id (Ruling FP-F), so remember it from the SAME event that resolves
    // the tab's working-order id — `#onSetStatus` reads {@link activeTableId}, the pay/round/serve paths
    // read {@link activeTabId}.
    this.activeTableId = tableId;
    if (hasOpenTab) {
      this.activeTabId = this.tables.find((table) => table.id === tableId)?.tabId;
    } else {
      const { tabId } = await this.api.openTab(tableId);
      this.activeTabId = tabId;
    }
    // Load the tab's lines so the table-order screen renders populated. A failed read degrades to an
    // empty tab (see {@link #loadTabLines}) rather than blocking the transition.
    await this.#loadTabLines();
    this.screen = "table-order";
  }

  /**
   * (Re)load the active tab's lines for the table-order screen (FP-1). Called on entering the screen and
   * after every round/serve write. A read failure — or no resolved tab id — leaves an EMPTY tab rather
   * than blocking the operator (the floor touches no fiscal path, design H2; an empty tab is safe), the
   * same degrade-gracefully shape {@link #onShowFloor} uses. Only writes reactive state (no guard).
   */
  async #loadTabLines(): Promise<void> {
    if (this.activeTabId === undefined) {
      this.tabLines = [];
      return;
    }
    try {
      this.tabLines = await this.api.getTabLines(this.activeTabId);
    } catch {
      this.tabLines = [];
    }
  }

  /** Append the picked round to the open tab (FP-1) then reload so the drawer reflects it. A failed
   * append is non-fatal — surface a banner, leave the tab as it was. */
  async #onSendRound(event: Event): Promise<void> {
    const { lines } = (event as CustomEvent<{ lines: { productId: string; quantity: string }[] }>)
      .detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.addTabRound(this.activeTabId, lines);
    } catch {
      this.errorKey = "table.error";
      return;
    }
    await this.#loadTabLines();
  }

  /** Mark one tab line delivered (FP-1) then reload the drawer. `served_at` is a PRE-FISCAL operational
   * marker (design H2). A failed mark is non-fatal. */
  async #onServeLine(event: Event): Promise<void> {
    const { lineNo } = (event as CustomEvent<{ lineNo: number }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.markLineServed(this.activeTabId, lineNo);
    } catch {
      this.errorKey = "table.error";
      return;
    }
    await this.#loadTabLines();
  }

  /** Set (or clear) the table's manual service status (FP-1, TS-2) — keyed by {@link activeTableId}, not
   * the tab's order id. A failed write is non-fatal. */
  async #onSetStatus(event: Event): Promise<void> {
    const { statusId } = (event as CustomEvent<{ statusId: string | null }>).detail;
    if (this.activeTableId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.setTableStatus(this.activeTableId, statusId);
    } catch {
      this.errorKey = "table.error";
    }
  }

  /**
   * Settle the WHOLE tab (FP-1, H2-critical). The tab is a PERSISTED OPEN working order, so the EXISTING
   * `recordSale` verb files its STORED LOCKED lines and IGNORES the sent basket — `payWorkingOrder`'s
   * open-order branch (`apps/server/src/till-sale.ts:338-343`): "the browser sends none; the persisted
   * `working_order_lines` are the authoritative composition". So this sends `[]` (that documented shape;
   * the empty-basket guard is walk-up-only, `:329`) and, crucially, does NOT run `#syncIfDirty` — a
   * sync/`updateWorkingOrder` would RE-PRICE and destroy the tab's add-time locks. No new fiscal verb,
   * no re-price. Same single-flight (`submitting`, the double-file safety), success→ticket and
   * error→banner shape as {@link #onConfirmPayment}; the tab-pay tender arrives as `pay-tab` (the screen
   * re-emits its embedded `tender-pay`'s `confirm-payment`, so this never collides with the counter's own
   * `#onConfirmPayment`).
   */
  async #onPayTab(event: Event): Promise<void> {
    if (this.submitting || this.activeTabId === undefined) return;
    this.submitting = true;
    const id = this.activeTabId;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    this.errorKey = undefined;
    try {
      this.result = await this.api.recordSale([], tender, id);
      this.screen = "ticket";
    } catch {
      this.errorKey = "sale.error";
    } finally {
      this.submitting = false;
    }
  }

  /** Return to the counter from a screen that emits `back-to-counter` — the schedule screen and (FP-1)
   * the live-floor screen both do — basket intact (the basket is till-owned and survives the trip). */
  #onBackToCounter(): void {
    this.errorKey = undefined;
    this.screen = "counter";
  }

  /** End the shift: tear the server session down, back to lock — but KEEP the basket (till-owned). */
  async #onLogout(): Promise<void> {
    await this.api.logout();
    this.operatorName = "";
    // Drop the floor-editor privilege — the next operator starts un-privileged until their own login
    // recomputes it (FP-2).
    this.canEdit = false;
    this.errorKey = undefined;
    this.screen = "lock";
  }

  /**
   * The layout the counter renders (design §7). An AUTHORED layout — one received from `GET /api/till`
   * and structurally different from the built-in default (see {@link isDefaultLayout}) — renders
   * VERBATIM: it is the owner's explicit choice, so no mode filter runs (a prep-queue they placed under
   * Mode P simply shows its empty state).
   *
   * A DEFAULT or ABSENT layout keeps slice 1's fallback: `LAYOUT_A` minus the prep-queue widget under
   * Mode P. Mode P has no automatic path into the kitchen (see `#refreshStationQueue`'s doc), so the widget would
   * only ever show its empty state there; Modes I/T enqueue automatically at placing (design §5) and
   * are the modes prep-queue exists for. `layout.ts` itself stays plain data (its own stated invariant)
   * — this derivation lives here, in the composition root, not there.
   */
  #layoutFor(): LayoutDef {
    if (this.receivedLayout !== undefined && !isDefaultLayout(this.receivedLayout)) {
      return this.receivedLayout;
    }
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
        @collect-card=${(event: Event) => void this.#onCollectCard(event)}
        @place-order=${() => void this.#onPlaceOrder()}
        @collect-order=${(event: Event) => void this.#onCollectOrder(event)}
        @advance-ticket-item=${(event: Event) => void this.#onAdvanceTicketItem(event)}
        @mark-collected=${(event: Event) => void this.#onMarkCollected(event)}
        @show-station=${() => this.#onShowStation()}
        @park-order=${(event: Event) => void this.#onParkOrder(event)}
        @retrieve-order=${(event: Event) => void this.#onRetrieveOrder(event)}
        @discard-order=${(event: Event) => void this.#onDiscardOrder(event)}
        @new-sale=${() => this.#onNewSale()}
        @show-schedule=${() => this.#onShowSchedule()}
        @show-floor=${() => void this.#onShowFloor()}
        @floor-refresh=${() => void this.#refreshFloor()}
        @open-table=${(event: Event) => void this.#onOpenTable(event)}
        @send-round=${(event: Event) => void this.#onSendRound(event)}
        @serve-line=${(event: Event) => void this.#onServeLine(event)}
        @set-status=${(event: Event) => void this.#onSetStatus(event)}
        @pay-tab=${(event: Event) => void this.#onPayTab(event)}
        @back-to-floor=${() => void this.#onShowFloor()}
        @back-to-counter=${() => this.#onBackToCounter()}
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
          .stationQueue=${this.stationQueue}
          .defaultStationId=${this.#defaultStationId()}
          .operatorName=${this.operatorName}
          .invoiceLocale=${this.invoiceLocale}
          .orderFlow=${this.orderFlow}
          .stage=${this.stage}
          .busy=${this.submitting || this.placing}
          .layout=${this.#layoutFor()}
          .cardProvider=${this.cardProvider}
          .tipsEnabled=${this.tipsEnabled}
          .cardOutcome=${this.cardOutcome}
        ></till-counter-screen>`;
      case "ticket":
        return html`<till-ticket-view
          .result=${this.result}
          .issuer=${this.issuer}
          .invoiceLocale=${this.invoiceLocale}
          .receipt=${this.receipt}
        ></till-ticket-view>`;
      case "schedule":
        return html`<till-schedule-screen
          .api=${this.api}
          .staff=${this.staff}
          .operatorPersonId=${this.operatorPersonId}
        ></till-schedule-screen>`;
      case "floor":
        return html`<till-floor-screen
          .zones=${this.zones}
          .tables=${this.tables}
          .api=${this.api}
          .canEdit=${this.canEdit}
        ></till-floor-screen>`;
      // FP-1 (Ruling FP-D): the per-table ordering screen. It renders from the app-owned tab lines
      // (loaded via `getTabLines`, reloaded after each round/serve) and emits `send-round`/`serve-line`/
      // `pay-tab`/`set-status`/`back-to-floor`, wired on the app wrapper above. `orderId` rides through
      // (the tab's working-order id) for parity with the placeholder it replaces; the app owns the writes.
      case "table-order":
        return html`<till-table-order-screen
          .lines=${this.tabLines}
          .products=${this.products}
          .statuses=${this.statuses}
          .orderId=${this.activeTabId}
          .busy=${this.submitting}
        ></till-table-order-screen>`;
      // KDS-1 (design §5a): the kitchen's station-display screen. It OWNS its own fetching via `.api`
      // (the station list + the active station's queue) and handles its own advances, so the app just
      // hands it the api + the venue bump mode and switches; `back-to-counter` (wired above) returns.
      case "station":
        return html`<till-station-screen
          .api=${this.api}
          .bumpMode=${this.bumpMode}
          .fireControl=${this.fireControl}
        ></till-station-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-app": TillApp;
  }
}
