import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { LocaleChangeController } from "./state/locale-controller.js";
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
import "./screens/till-handheld-enrol-screen.js";
import "./screens/till-expo-screen.js";
// The reusable supervisor-override dialog (cash-drawer-authorization §5); named as a tag below.
import "./widgets/supervisor-override-dialog.js";
import type { StringKey } from "./i18n/strings.js";
import type { BumpMode, FireControlMode } from "./widgets/station-queue.js";
import type {
  DeviceStation,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  PayOutcome,
  RoundLine,
  SaleLine,
  Station,
  StationQueueGroup,
  StaffMember,
  TabLine,
  TabTransfer,
  TableServiceStatus,
  TableState,
  TicketState,
  TillCourse,
  TillInfo,
  TillMenu,
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
type Screen =
  "lock" | "counter" | "ticket" | "schedule" | "floor" | "table-order" | "station" | "expo";

/**
 * The phone face-set for a `handheld` device (handheld-tableside spec §6a) — the screens a waiter's
 * phone offers, in order: `lock` (PIN sign-in), then the live `floor`, then per-table ordering
 * (`table-order`). No counter POS, KDS, expo or schedule. This is the CONFIGURABLE SEAM: it ships as a
 * constant keyed by device kind (the only kind with a bespoke face-set today), and a later slice
 * persists it per device and adds a dashboard editor (spec §6a/§9). Kept beside {@link Screen} so a new
 * face is a compile error here the moment the union changes. `#onLoggedIn` lands a handheld on its
 * post-lock face (`HANDHELD_FACES[1]`, the `floor`); the persisted slice will drive the rest of the
 * handheld's navigation from this list directly.
 */
const HANDHELD_FACES: Screen[] = ["lock", "floor", "table-order"];

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
 * DISCONNECT SAFETY. `setLocale` mutates module-global locale, so it is the effect that can outlive the
 * element. It runs in four places. THREE run post-await and each carries `if (!this.isConnected) return`
 * before the switch, so a teardown during the await skips it — {@link TillApp.boot} (races a teardown
 * before first paint), {@link TillApp.#onLogout} (the logout round trip) and
 * {@link TillApp.#onLocaleSelected} (the preference write — the durable server write has already landed
 * and the next login re-applies it, so only the pointless local repaint is skipped). The fourth,
 * {@link TillApp.#onLoggedIn}, runs its `setLocale` SYNCHRONOUSLY before its first await, so the element
 * is still connected and needs no guard. Each guarded site is pinned by a deletion-proven disconnect
 * test. Every OTHER event handler writes only reactive state and dispatches nothing upward, so needs no
 * guard — Lit never paints a detached element (`till-lock-screen`'s `#loadStaff` records the same
 * reasoning).
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

  /**
   * The venue's DERIVED default UI locale (per-user-language-preference), read from `GET /api/till`
   * on boot (Task 4 makes that field the derived default). It is the fallback the app switches back to
   * when nobody's preference applies: `resolveActiveLocale(personLocale, this.#venueLocale)` on login
   * ({@link #onLoggedIn}) and the language restored on logout ({@link #onLogout}). Defaults to the
   * deli's es-ES until boot resolves.
   */
  #venueLocale = "es-ES";

  constructor() {
    super();
    // Follow a locale switch made anywhere (login/logout/the chooser's setLocale): on a locale change
    // the controller calls requestUpdate(), re-running render() so `keyed(currentLocale(), …)` re-keys
    // and the screen repaints. The screens read `t()` at render time, so recreating them applies the switch.
    new LocaleChangeController(this);
  }

  @state() private screen: Screen = "lock";
  /**
   * Whether the station screen runs in DEVICE mode (device-identity-1 §5a) — an always-on enrolled KDS
   * display with no login. Set `true` by {@link #boot} when the device probe succeeds (an already-enrolled
   * display boots straight into its queue) or by {@link #onSetupDevice} when the lock screen's "set up"
   * affordance routes a FRESH display in to reach the enrol view. Threaded to `<till-station-screen>` in
   * `case "station"`; default `false` keeps the operator "Kitchen" nav path unchanged.
   */
  @state() private deviceMode = false;
  /**
   * Whether this browser is an enrolled HANDHELD device (handheld-tableside Task 7) — a waiter's phone,
   * as opposed to a `kds_station` display ({@link deviceMode}) or a normal operator till. Set `true` by
   * {@link #boot} when the device probe's {@link DeviceIdentity.kind} is `handheld`; a handheld STAYS on
   * the lock screen (unlike a KDS display, which boots past it) — the waiter PIN-logs-in — and then lands
   * on the live floor rather than the counter POS ({@link #onLoggedIn} reads this to pick the post-login
   * face, {@link HANDHELD_FACES}). Default `false` keeps every normal operator till's counter landing
   * unchanged.
   */
  @state() private handheldMode = false;
  /**
   * Whether the lock screen's "set up as waiter handheld" affordance has opened the handheld ENROL view
   * (handheld-tableside Task 8) — the twin of {@link deviceMode}'s station-screen enrol path, but for a
   * FRESH phone that holds no device cookie yet. Set `true` by {@link #onSetupHandheld}; while set,
   * `render` shows `<till-handheld-enrol-screen>` in place of the normal screen. Cleared by
   * {@link #onHandheldEnrolled} once the code is redeemed, which then re-runs {@link #boot} so the now-set
   * `handheld` cookie routes the app into the phone shell.
   */
  @state() private handheldEnrolling = false;
  /**
   * The device station the boot probe resolved (device-identity-1 §5a), stashed so it can be handed to
   * `<till-station-screen>` as `.initialDeviceStation` and the screen need not fetch
   * `GET /api/device/station` a SECOND time on mount (the boot probe already read it — one authenticated
   * queue read per enrolled-display boot, not two). Set ONLY by {@link #boot} on a successful probe;
   * stays `undefined` for a normal operator till and for the lock-screen "set up" path
   * ({@link #onSetupDevice}), where the screen fetches on mount (and a 401 there shows the enrol view).
   */
  @state() private initialDeviceStation?: DeviceStation;
  /** The issuer identity printed on the ticket (venue name + NIF), read once from `getTill` on boot. */
  @state() private issuer?: TicketIssuer;
  /** ALL sellable products across the location's accessible menus, loaded at login. The counter/table
   * screens are handed this WHOLE set plus {@link selectedCatalogueId}, and each narrows its OWN grid to
   * the selected menu via `filterProductsByMenu` (`menu-filter.ts`). The full set is threaded down
   * deliberately — a screen resolves a tab line's name and an allergen lookup against every menu's
   * products, not just the shown one — so a menu switch only re-filters the grid, never re-fetches. */
  @state() private products: TillProduct[] = [];
  /** The location's accessible menus (default first), loaded at login beside {@link products}. Drives the
   * `<till-menu-switcher>`; with one menu the switcher renders nothing and the till looks as before. */
  @state() private menus: TillMenu[] = [];
  /** The menu (catalogue) the grid currently shows — set to the default menu at login, then to whatever
   * the switcher's `menu-selected` picks. `""` before login / with no menus, which matches no product. */
  @state() private selectedCatalogueId = "";
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
  /**
   * The venue's ACTIVE kitchen courses (KDS-2 §5b), read once from `GET /api/till` on boot
   * ({@link TillInfo.courses}) and threaded to the table-order screen — its per-line course picker's
   * options and the id→name source for its waiter-fire actions. Defaults `[]` until boot resolves (a
   * venue with no courses configured, and the fail-safe for a boot that has not yet answered).
   */
  @state() private courses: TillCourse[] = [];
  /** The filed sale to print; set on a successful `recordSale`, read by the ticket view. The ticket's
   * line list comes from THIS result's `lines` (the filed composition), never the client basket. */
  @state() private result?: TillSaleResult;
  /**
   * The receipt (invoice) locale for the ticket, from `GET /api/till`'s own `invoiceLocale` field
   * (the fiscal `cfg.locale`) — the language the legal receipt renders in. Threaded to
   * `till-ticket-view` SEPARATELY from the operator-UI `setLocale`, which reads the DIFFERENT
   * `locale` (venue-default) field: the two are decoupled so a UI-unsupported fiscal locale never
   * flips the printed ticket's language (see `#boot`). Defaults to the deli's es-ES.
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
   * The eligible authorizers for an in-flight cash-drawer override (cash-drawer-authorization §5).
   * `undefined` means the override dialog is closed; a (possibly empty) array opens it. Set only when a
   * gated `POST /api/drawer/open` refuses the operator with `authorization.not_permitted` (403) and the
   * authorizer roster has been fetched; cleared on confirm-success, cancel, or a non-retryable failure.
   */
  @state() private overrideAuthorizers?: StaffMember[];
  /** A raw error code to show INSIDE the open override dialog on a failed authorize — a wrong
   * supervisor PIN (`pin.invalid`). Nulled before every attempt so a repeat re-shows; the dialog maps
   * it to copy (never the raw code). */
  @state() private overrideError: string | null = null;
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
   * Read the public till info once: set the OPERATOR-UI locale (`setLocale`) UNLESS an operator has
   * already logged in mid-flight (see the guard below), remember the receipt
   * (invoice) locale for the ticket, remember the ticket issuer, and (7c) remember the location's
   * pay-timing mode plus (Task 9) its integrated-card wiring. `setLocale` takes the UI-derived
   * `till.locale` (the venue default), while `invoiceLocale` takes the SEPARATE `till.invoiceLocale`
   * (the fiscal `cfg.locale`): they drive different things, come from different server fields, and
   * are threaded separately — the receipt uses its `invoiceLocale` PROP and must never follow the
   * operator UI (see `till-ticket-view`'s INVOICE LOCALE note).
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
      // Apply the venue default ONLY when no operator has logged in yet. On a slow link the lock screen's
      // `getStaff` + a human PIN entry can complete a login while this `getTill` is still in flight;
      // `#onLoggedIn` then applies the operator's preferred locale SYNCHRONOUSLY (`resolveActiveLocale`)
      // and sets `operatorPersonId`. Re-applying the venue default here would CLOBBER that back to the
      // venue's language for the rest of the session. Gating on "no operator" mirrors the dashboard's
      // `screen === "login"` seed gate (`dashboard-app.ts` #boot): it still applies the venue default on
      // the normal pre-login path AND on the device-station paths (device auto-boot and the lock screen's
      // "set up" affordance both set NO operator, and both legitimately want the venue default). The
      // `#venueLocale`/`invoiceLocale` writes below stay UNCONDITIONAL — they seed the login/logout
      // fallback and the receipt, neither of which touches the live UI locale, so a login race never wants
      // them skipped.
      if (this.operatorPersonId === "") setLocale(till.locale);
      // Remember the venue's derived default (Task 4): the fallback the app switches back to when no
      // operator preference applies — on login (resolveActiveLocale) and on logout. This is the
      // UI-derived venue default; the receipt's `invoiceLocale` below reads a DIFFERENT server field.
      this.#venueLocale = till.locale;
      // The RECEIPT (fiscal document) locale — a SEPARATE server field (`invoiceLocale`, sourced from
      // the fiscal `cfg.locale`), NOT the UI `till.locale`. The two are decoupled on purpose: the
      // venue-default UI derivation drops UI-unsupported codes (so a `ca-ES` fiscal locale would show
      // as `es-ES` in `till.locale`), which must never flip the printed legal ticket's language
      // (per-user-language spec, decision 2). Threaded to `till-ticket-view.invoiceLocale`.
      this.invoiceLocale = till.invoiceLocale;
      this.issuer = { venueName: till.venueName, nif: till.nif };
      this.orderFlow = till.orderFlow;
      this.bumpMode = till.bumpMode;
      this.fireControl = till.fireControl;
      this.courses = till.courses;
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
      // a detached element (see above). Return BEFORE the device probe: a till that could not read its own
      // setup is not a display to route into device mode.
      this.errorKey = "boot.error";
      return;
    }
    // DEVICE PROBE (device-identity §3b, handheld-tableside Task 7). An already-ENROLLED device holds the
    // device cookie, so `GET /api/device/me` succeeds and reports its KIND; the boot then picks the shell:
    //  - `handheld` (a waiter's phone): enter handheld mode but STAY on `lock` — the waiter PIN-logs-in and
    //    `#onLoggedIn` lands them on the floor. It binds to no station, so nothing is prefetched here.
    //  - `kds_station` (a kitchen display): boot STRAIGHT into device mode — the station screen with no
    //    login. This makes a SECOND authenticated read (`getDeviceStation`) after the identity read — a
    //    DELIBERATE, accepted cost (one extra read per KDS display boot) that PRESERVES the
    //    `initialDeviceStation` prefetch, so the station screen adopts the queue instead of re-reading it
    //    on mount (`#loadDevice`).
    //  - any other kind: fall through and remain a normal operator till on `lock` (forward-compatible — an
    //    older client ignores a kind it does not know).
    // A normal operator till has no device cookie → 401 (`device.unauthorized`), the EXPECTED not-a-device
    // case: swallow it and stay on `lock`. Deliberately NOT `boot.error` — a device 401 is not a boot
    // failure (that is getTill's alone). State-only writes, so no isConnected guard is needed (the
    // DISCONNECT SAFETY note; the module-global `setLocale` above is the only effect that took one).
    // RESET the device-mode state to a clean baseline BEFORE re-probing. `#boot` runs more than once —
    // `#onHandheldEnrolled` re-runs it after a fresh phone enrols — and the branches below only ever SET
    // their mode, never clear a prior one, so state from an earlier boot (or a prior `#onSetupDevice` that
    // set `deviceMode`/`screen = "station"`) would otherwise survive and mis-render. The reset is
    // unconditional so every boot starts known: `screen` falls back to the normal `lock`, then the probe's
    // branches re-establish the correct mode (`kds_station` moves to `station`; `handheld` and the
    // no-device case both legitimately stay on `lock`).
    this.handheldMode = false;
    this.deviceMode = false;
    this.screen = "lock";
    try {
      const identity = await this.api.getDeviceIdentity();
      if (identity.kind === "handheld") {
        // Stay on `lock`; the waiter PIN-logs-in, then `#onLoggedIn` lands them on the floor.
        this.handheldMode = true;
      } else if (identity.kind === "kds_station") {
        // Prefetch the bound station's queue and hand it to the station screen as `.initialDeviceStation`,
        // so its `#loadDevice` adopts it instead of re-reading `GET /api/device/station` on mount — the
        // second read here is the accepted cost of keeping that one-mount-read optimisation (see above).
        this.initialDeviceStation = await this.api.getDeviceStation();
        this.deviceMode = true;
        this.screen = "station";
      }
    } catch {
      // Not an enrolled device (or a transient probe failure) — remain a normal operator till on `lock`.
    }
  }

  /** A confirmed login: load the catalogue, remember the operator, show the counter, list held orders
   * and (Modes I/T) the prep queue, then load the colleague roster for the schedule screen. */
  async #onLoggedIn(event: Event): Promise<void> {
    const { personId, displayName, canConfigureTill, locale } = (
      event as CustomEvent<LoggedInDetail>
    ).detail;
    // Apply the operator's stored UI language (per-user-language-preference): their supported choice,
    // else the venue default. `setLocale` is module-global — the `keyed(currentLocale(), …)` wrapper recreates
    // the counter subtree so it renders in the resolved language. A NULL preference resolves to the
    // venue default, so a new operator with no choice keeps the venue's language.
    setLocale(resolveActiveLocale(locale, this.#venueLocale));
    const { menus, products } = await this.api.listProducts();
    this.products = products;
    this.menus = menus;
    // Show the location's default menu first. `#defaultCatalogueId` picks it the same way the
    // per-order reset does, so login and reset can never drift (see its own doc).
    this.selectedCatalogueId = this.#defaultCatalogueId();
    this.operatorName = displayName;
    this.operatorPersonId = personId;
    // FP-2: gate the on-till floor editor on the server-computed `till.configure` capability handed down
    // in the session response. Convenience only — the placement route re-checks server-side.
    this.canEdit = canConfigureTill;
    this.errorKey = undefined;
    // Where the operator lands after login: a handheld waiter goes to the face-set's post-lock face
    // (HANDHELD_FACES[1], the live floor); a normal operator till opens the counter POS.
    const landingFace = this.handheldMode ? HANDHELD_FACES[1] : "counter";
    if (landingFace === "floor") {
      // LOAD the floor the way counter→floor navigation does — `<till-floor-screen>` renders purely from
      // the app-owned `.zones`/`.tables`/`.statuses` props, which ONLY `#onShowFloor` fetches (it then
      // sets `screen = "floor"`). A handheld's face-set has no counter/`@show-floor` affordance and no
      // populated table to tap, so a bare `this.screen = "floor"` would strand the waiter on an empty,
      // unusable floor. `#onShowFloor` swallows a failed load (degrade gracefully), so this never blocks.
      await this.#onShowFloor();
    } else {
      this.screen = landingFace;
      // The counter's cross-till held list + default-station queue — counter concerns a handheld's floor
      // landing never shows, so they run only on the counter path (mirroring counter→floor nav, which
      // likewise fetches neither).
      await this.#refreshHeldOrders();
      await this.#refreshStationQueue();
      // The colleague roster for the staff schedule screen (unauthenticated `GET /api/staff`). Loaded
      // AFTER the counter is shown so a roster fetch failure never blocks the sale flow; the schedule
      // screen picks it up reactively via its `.staff` prop whenever it lands. A rejection is SWALLOWED,
      // leaving `staff` at its default `[]` — the picker stays empty rather than surfacing an error or
      // (under `void #onLoggedIn`) escaping as an unhandled rejection; the operator can still sell.
      // ON THE COUNTER PATH ONLY: `staff` is consumed exclusively by `case "schedule":`, a face a
      // handheld's face-set can never reach ({@link HANDHELD_FACES}), so a handheld landing on the floor
      // never fetches it — mirroring the held-list/station-queue guard above.
      try {
        this.staff = await this.api.listStaff();
      } catch {
        // Non-fatal: leave `this.staff` as its `[]` default (degrade gracefully, never rethrow).
      }
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
   * The location's DEFAULT menu id: the {@link TillMenu} the server flagged `isDefault` (it also orders
   * that one first), else the first accessible menu, else `""` (no menus — the grid shows nothing until
   * one exists). The single source of the default so login ({@link TillApp.#onLoggedIn}) and the
   * per-order reset ({@link TillApp.#onNewSale}/{@link TillApp.#onParkOrder}) cannot drift apart.
   */
  #defaultCatalogueId(): string {
    return this.menus.find((menu) => menu.isDefault)?.id ?? this.menus[0]?.id ?? "";
  }

  /** The switcher picked a menu (`menu-selected`): show that menu's products. State-only — it changes
   * `selectedCatalogueId`, which the screens thread into their grid filter, and NEVER touches the working
   * order, so an in-flight cart line survives the switch. The screens keep the FULL {@link products} for
   * name resolution (a tab spans menus) and allergen lookup; only their grid narrows.
   *
   * The switch is TEMPORARY (owner decision): it sticks for the current order but reverts to the
   * location default when the next order begins — see {@link TillApp.#defaultCatalogueId}'s reset call
   * sites. Nothing here resets it mid-order, so a switch made while ringing a basket survives until that
   * basket is settled or parked. */
  #onMenuSelected(event: CustomEvent<{ id: string }>): void {
    this.selectedCatalogueId = event.detail.id;
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

  /** Maps the current basket to the {@link SaleLine} shape every server call takes (`parkOrder`,
   * `updateWorkingOrder`, `placeOrder`, `recordSale`, `pay`) — never a price, since the server always
   * re-prices. A line with selected modifiers (ordering modifiers, Task 9) carries its `options` as the
   * bare `optionGroupItemId`s the server re-resolves; a plain line OMITS `options` (never `[]`) so a
   * no-modifier sale is byte-identical to before. Shared by `#onParkOrder`, `#onPlaceOrder`/`#syncIfDirty`,
   * `#onConfirmPayment` and `#onCollectCard`. */
  #currentSaleLines(): SaleLine[] {
    return this.#store.lines.map((line) => {
      const saleLine: SaleLine = { productId: line.product.id, quantity: line.quantity };
      if (line.options !== undefined && line.options.length > 0) {
        saleLine.options = line.options.map((option) => ({
          optionGroupItemId: option.optionGroupItemId,
        }));
      }
      return saleLine;
    });
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
   * owns its own fetching via `.api`, so this just switches. Operator path, so `deviceMode` stays false. */
  #onShowStation(): void {
    this.errorKey = undefined;
    this.screen = "station";
  }

  /**
   * Route a FRESH (unenrolled) display into device mode from the lock screen's "set up as kitchen display"
   * affordance (device-identity-1 §5a). The station screen mounts in device mode, probes its own device
   * station (401, since there is no cookie yet), and shows the enrol view so the operator can pair the
   * display with a code.
   *
   * Defense-in-depth (§C2): a handheld returns to the lock screen on every logout and cold boot, so a
   * leaked/bubbled `setup-device` must not let it become a KDS. The `handheldMode` guard withholds BOTH
   * the identity flip (`deviceMode`) and the navigation — and the navigation itself goes through
   * {@link #goToScreen}, whose face-set gate ({@link HANDHELD_FACES} excludes `station`) is the single
   * place that refusal lives. The lock screen already hides this affordance from an enrolled device
   * (`deviceEnrolled`); this is the second line if the event reaches the app anyway.
   */
  #onSetupDevice(): void {
    if (this.handheldMode) return;
    this.errorKey = undefined;
    this.deviceMode = true;
    this.#goToScreen("station");
  }

  /**
   * Route a FRESH phone into the handheld enrol view from the lock screen's "set up as waiter handheld"
   * affordance (handheld-tableside Task 8) — the twin of {@link #onSetupDevice}. State-only switch: while
   * `handheldEnrolling` is set, `render` shows `<till-handheld-enrol-screen>` instead of the lock screen,
   * so the operator can pair the phone with a code. Unlike the KDS path this does NOT touch `screen` —
   * the enrol screen is an overlay on the boot state, and a successful enrol re-boots into the shell
   * rather than navigating within this session.
   */
  #onSetupHandheld(): void {
    this.errorKey = undefined;
    this.handheldEnrolling = true;
  }

  /**
   * The handheld enrol view redeemed a pairing code (handheld-tableside Task 8): the device cookie is now
   * set, so leave the enrol view and re-run {@link #boot}. The boot's device probe reads the fresh cookie
   * as `handheld`, sets {@link handheldMode}, and keeps the app on the lock screen — the phone shell — for
   * the waiter to PIN-log-in. Re-boot (not a bare state flip) so the phone picks up its shell exactly as a
   * cold load of an already-enrolled handheld would, one code path for both.
   */
  async #onHandheldEnrolled(): Promise<void> {
    this.handheldEnrolling = false;
    await this.#boot();
  }

  /** Show the expo/pass display screen (KDS-3) — the expediter's cross-station board, reached from the
   * counter's "Pass" nav. Basket-preserving like the station/schedule/floor nav (the basket is
   * till-owned); the screen owns its own fetching + levers via `.api`, so this just switches. */
  #onShowExpo(): void {
    this.errorKey = undefined;
    this.screen = "expo";
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
      // A parked basket is set aside and a FRESH working order begins on the counter, so the active menu
      // reverts to the location default — the temporary-switch boundary (see {@link #onMenuSelected}),
      // exactly as {@link #onNewSale}. Only on the success path (inside the try): a rejected park keeps
      // the basket, so the order is still in progress and the switch must still stick. No-op single-menu.
      this.selectedCatalogueId = this.#defaultCatalogueId();
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

  /**
   * Reprint the just-filed sale's receipt (counter receipt/drawer §5) — the ticket screen's "Reprint"
   * button (`till-ticket-view` dispatches `reprint`; the view is presentational and holds no id). The
   * WORKING-ORDER id is `this.#store.id`, which is STILL the just-filed sale's id at the ticket stage:
   * `#onConfirmPayment`/`#onCollectCard`/`#onCollectOrder` set `this.result` + move to the `ticket`
   * screen but NEVER clear `#store`, and {@link #onNewSale} is the one place that re-mints it (via
   * `#store.clear()`) — so it names the sale the ticket is showing. NON-FISCAL: the server re-enqueues
   * PAPER only and files nothing. A failure (incl. a till with no printer) is non-fatal — the ticket
   * stays on screen and the operator retries — so it surfaces the generic `reprint.error` banner, never
   * an unhandled rejection or the raw domain code (the `#onConfirmPayment` convention). Writes only
   * reactive state, so no `isConnected` guard is needed (the app's DISCONNECT SAFETY note).
   */
  async #onReprint(): Promise<void> {
    this.errorKey = undefined;
    try {
      await this.api.reprint(this.#store.id);
    } catch {
      this.errorKey = "reprint.error";
    }
  }

  /**
   * Open the cash drawer (counter receipt/drawer §5 + cash-drawer-authorization §5) — the ticket
   * screen's "Abrir cajón" button (`till-ticket-view` dispatches `open-drawer`). OPTIMISTIC: it always
   * tries the direct open first and holds NO policy or role knowledge, so it stays correct if the
   * location's `drawer_open_policy` changes mid-shift.
   *
   * On the server's `authorization.not_permitted` (403 — a gated policy + an operator lacking
   * `cash.drawer`) it opens the reusable supervisor-override dialog (see {@link #openOverrideDialog}).
   * Any OTHER failure — a `drawer.no_printer` (no receipt printer set) or a transient one — is non-fatal
   * and surfaces the generic `drawer.error` banner (never an unhandled rejection or the raw code, the
   * `#onConfirmPayment` convention). Writes only reactive state, so no `isConnected` guard is needed.
   */
  async #onOpenDrawer(): Promise<void> {
    this.errorKey = undefined;
    try {
      await this.api.openDrawer();
    } catch (error) {
      if ((error as { code?: string }).code === "authorization.not_permitted") {
        await this.#openOverrideDialog();
      } else {
        this.errorKey = "drawer.error";
      }
    }
  }

  /**
   * The operator lacks `cash.drawer` under a gated policy: fetch the eligible supervisors and open the
   * override dialog with them. A failed fetch degrades to the generic `drawer.error` banner (no dialog)
   * — the operator retries. NO client-side policy or role knowledge: the picker is the server's list.
   */
  async #openOverrideDialog(): Promise<void> {
    try {
      const authorizers = await this.api.listDrawerAuthorizers();
      this.overrideError = null;
      this.overrideAuthorizers = authorizers;
    } catch {
      this.errorKey = "drawer.error";
    }
  }

  /**
   * Retry the drawer open with the supervisor override the dialog emitted (`{ personId, pin }` — the
   * `authorize()` override shape). On success the dialog closes; on `pin.invalid` (a wrong supervisor
   * PIN) the dialog stays open showing the retry error; on any other failure (`drawer.no_printer`, a
   * transient one) the dialog closes and the generic `drawer.error` banner shows. The PIN reaches only
   * this authenticated `openDrawer` request — it is never stored on the app or logged.
   */
  async #onOverrideConfirm(event: Event): Promise<void> {
    const { personId, pin } = (event as CustomEvent<{ personId: string; pin: string }>).detail;
    this.overrideError = null; // fresh attempt: clear any prior error so a repeat re-shows
    try {
      await this.api.openDrawer({ personId, pin });
      this.#closeOverrideDialog();
    } catch (error) {
      if ((error as { code?: string }).code === "pin.invalid") {
        this.overrideError = "pin.invalid"; // keep the dialog open for a retry
      } else {
        this.#closeOverrideDialog();
        this.errorKey = "drawer.error";
      }
    }
  }

  /** Close the override dialog and clear its error (also the cancel handler — cancel just dismisses). */
  #closeOverrideDialog(): void {
    this.overrideAuthorizers = undefined;
    this.overrideError = null;
  }

  /** Start the next sale: empty the basket (and, with it, its `persisted` flag), reset the place/collect
   * stage back to `"order"`, back to the counter. `cardOutcome` is cleared too — a new, unrelated
   * basket must never inherit a decline/timeout/network-unavailable banner from the sale before it. The
   * active menu reverts to the location default: a menu switch is TEMPORARY (see {@link #onMenuSelected})
   * and a new order is exactly the boundary it must not cross, so a waiter who switched for the last sale
   * starts the next one on the default. A single-menu venue makes this a no-op. */
  #onNewSale(): void {
    this.#store.clear();
    this.stage = "order";
    this.errorKey = undefined;
    this.cardOutcome = undefined;
    this.selectedCatalogueId = this.#defaultCatalogueId();
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

  /** Append the picked round to the open tab (FP-1) then reload so the drawer reflects it. Each line MAY
   * carry a `courseId` OVERRIDE the tab screen's course picker set (KDS-2 §5b) and its selected modifier
   * `options` (ordering modifiers, Task 9), both forwarded verbatim to `addTabRound`. A failed append is
   * non-fatal — surface a banner, leave the tab as it was. */
  async #onSendRound(event: Event): Promise<void> {
    const { lines } = (event as CustomEvent<{ lines: RoundLine[] }>).detail;
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

  /** Fire a HELD course of the open tab (KDS-2 §5b) — the waiter's "Fire <course>" tap under
   * `fire_control = 'waiter'`. Releases the course via `fireCourse` then reloads the tab so its held-course
   * actions reconcile to server truth (the fired course drops off `#heldCourses`). A failed fire is
   * non-fatal — surface a banner, leave the tab as it was — the same shape as {@link #onSendRound}. */
  async #onFireCourse(event: Event): Promise<void> {
    const { courseId } = (event as CustomEvent<{ orderId?: string; courseId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.fireCourse(this.activeTabId, courseId);
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

  /** Re-read the floor occupancy read-model into `this.tables` WITHOUT leaving the current screen — the
   * shared primitive behind the table-order action handlers below (a move/join/merge/transfer changes
   * which tables are free/occupied, so the action pickers must reconcile). Degrades to an empty floor on
   * a failed read (the floor touches no fiscal path, design H2; distinct from {@link #refreshFloor}, which
   * keeps the last-known floor because it runs ON the floor). Only writes reactive state — no guard. */
  async #reloadTables(): Promise<void> {
    try {
      this.tables = await this.api.getTablesState();
    } catch {
      this.tables = [];
    }
  }

  /** Relocate the whole tab to a FREE table (TS-3 move) then reconcile the floor, staying on the tab. The
   * tab now lives on the new table, so remember it as {@link activeTableId} — a later `set-status` keys by
   * TABLE id (Ruling FP-F). A failed move is non-fatal — surface a banner, leave the tab as it was — the
   * same shape as {@link #onServeLine}. */
  async #onMoveTab(event: Event): Promise<void> {
    const { toTableId } = (event as CustomEvent<{ toTableId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.moveTab(this.activeTabId, toTableId);
    } catch {
      this.errorKey = "table.error";
      return;
    }
    this.activeTableId = toTableId;
    await this.#reloadTables();
  }

  /** Extend the tab onto an ADDITIONAL free table (TS-3 join) then reconcile the floor. No status/tab id
   * change (both tables point at the same tab). A failed join is non-fatal. */
  async #onJoinTable(event: Event): Promise<void> {
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.joinTable(this.activeTabId, tableId);
    } catch {
      this.errorKey = "table.error";
      return;
    }
    await this.#reloadTables();
  }

  /** Combine ANOTHER open tab onto THIS bill (TS-3 merge) then reload this tab's lines (it absorbed the
   * other's) AND the floor (the source table freed or re-pointed). A failed merge is non-fatal. */
  async #onMergeTabs(event: Event): Promise<void> {
    const { fromTabId, freeSourceTable } = (
      event as CustomEvent<{ fromTabId: string; freeSourceTable: boolean }>
    ).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.mergeTabs(this.activeTabId, fromTabId, freeSourceTable);
    } catch {
      this.errorKey = "table.error";
      return;
    }
    // Two independent reads (each swallows its own error) — run them concurrently.
    await Promise.all([this.#loadTabLines(), this.#reloadTables()]);
  }

  /** Move SELECTED lines out of this tab into another open tab (TS-4 transfer) then reload this tab's
   * lines (the moved lines left) AND the floor (both tabs' totals changed). A failed transfer is
   * non-fatal. */
  async #onTransferLines(event: Event): Promise<void> {
    const { toTabId, transfers } = (
      event as CustomEvent<{ toTabId: string; transfers: TabTransfer[] }>
    ).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.transferLines(this.activeTabId, toTabId, transfers);
    } catch {
      this.errorKey = "table.error";
      return;
    }
    // Two independent reads (each swallows its own error) — run them concurrently.
    await Promise.all([this.#loadTabLines(), this.#reloadTables()]);
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

  /**
   * The face-set gate for the transitions that can fire WHILE A HANDHELD IS ACTIVE (handheld-tableside
   * §6a). A normal operator till may reach every {@link Screen}; a handheld may reach ONLY
   * {@link HANDHELD_FACES} (`lock`/`floor`/`table-order`), so a `target` outside that set is REFUSED —
   * the handheld stays put. This makes {@link HANDHELD_FACES} the genuine gate rather than a scattered
   * `handheldMode` read.
   *
   * The handlers routed through here are exactly the two whose events can reach the app from inside the
   * phone shell:
   *  - {@link #onBackToCounter} — a `back-to-counter` from the floor's Back or bubbled from the
   *    table-order subtree; the gate keeps it off the counter POS (and the `station`/`expo`/`schedule`
   *    it leads to).
   *  - {@link #onSetupDevice} — a leaked/bubbled `setup-device` from the lock screen, itself a handheld
   *    face; the gate refuses `station` (that handler ALSO guards its `deviceMode` identity flip on
   *    `handheldMode`, which this gate cannot).
   *
   * The remaining counter-side setters — {@link #onShowStation}, {@link #onShowExpo},
   * {@link #onShowSchedule} and the payment→`ticket` transitions — assign `this.screen` directly and are
   * NOT gated, because their affordances are emitted only by the counter screen
   * (`till-counter-screen`), which a handheld never reaches: unreachable-by-affordance, not gated.
   * Proven by deletion: drop the guard and a handheld's `back-to-counter` lands it on the counter (the
   * §6a containment test goes red).
   */
  #goToScreen(target: Screen): void {
    if (this.handheldMode && !HANDHELD_FACES.includes(target)) return;
    this.screen = target;
  }

  /** Return to the counter from a screen that emits `back-to-counter` — the schedule screen and (FP-1)
   * the live-floor screen both do — basket intact (the basket is till-owned and survives the trip).
   * Routed through {@link #goToScreen} so a handheld (whose face-set excludes `counter`, §6a) cannot use
   * it to escape the phone shell; a normal till reaches the counter exactly as before. */
  #onBackToCounter(): void {
    this.errorKey = undefined;
    this.#goToScreen("counter");
  }

  /** End the shift: tear the server session down, back to lock — but KEEP the basket (till-owned). */
  async #onLogout(): Promise<void> {
    await this.api.logout();
    // Guard the post-await module-global `setLocale` below against a teardown during the logout round
    // trip — the same shape #boot uses. A detached till never legitimately wants a locale switch, and
    // this one would repaint a live sibling's UI. Returns before the state writes too (harmless to skip
    // on a detached element); pinned by "does not revert the locale if the app disconnects mid-logout".
    if (!this.isConnected) return;
    this.operatorName = "";
    // Revert the UI to the venue default (per-user-language-preference): the previous operator's
    // language must not linger into the lock screen the next operator meets. Their own login re-applies
    // their preference, exactly as `canEdit` is dropped and re-supplied below.
    setLocale(this.#venueLocale);
    // Drop the floor-editor privilege — the next operator starts un-privileged until their own login
    // recomputes it (FP-2).
    this.canEdit = false;
    this.errorKey = undefined;
    this.screen = "lock";
  }

  /**
   * The ONE handler for a language pick (per-user-language-preference). The chooser is presentational —
   * it emits a composed `locale-selected` and nothing more; this decides what the pick MEANS, and that
   * turns entirely on whether anyone is logged in:
   *  - PRE-LOGIN (`screen === "lock"`): a TRANSIENT switch. Switch the UI (`setLocale`) but write
   *    nothing — there is no session to attach a preference to. Dropping this guard would `putLocale`
   *    with no session (401) and is what the "transient while on lock" test proves by deletion.
   *  - LOGGED IN: PERSIST the operator's preference (`putLocale`) and only THEN switch the UI. The
   *    switch is gated behind the successful write, so a failed save leaves the UI in the current
   *    language and surfaces a non-fatal `locale.save_failed` — never the raw code, and never a UI
   *    that claims a preference the server did not store.
   */
  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "lock") {
      setLocale(code);
      return;
    }
    this.errorKey = undefined;
    try {
      await this.api.putLocale(code);
      // Guard the post-await module-global `setLocale` against a teardown during the write — same shape
      // as #boot/#onLogout. The durable server write has already landed and the next login re-applies
      // the stored preference, so a detached till skips only the now-pointless local repaint; pinned by
      // "does not switch the locale if the app disconnects mid-putLocale".
      if (!this.isConnected) return;
      setLocale(code);
    } catch {
      this.errorKey = "locale.save_failed";
    }
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
        @setup-device=${() => this.#onSetupDevice()}
        @setup-handheld=${() => this.#onSetupHandheld()}
        @handheld-enrolled=${() => void this.#onHandheldEnrolled()}
        @show-expo=${() => this.#onShowExpo()}
        @park-order=${(event: Event) => void this.#onParkOrder(event)}
        @retrieve-order=${(event: Event) => void this.#onRetrieveOrder(event)}
        @discard-order=${(event: Event) => void this.#onDiscardOrder(event)}
        @new-sale=${() => this.#onNewSale()}
        @reprint=${() => void this.#onReprint()}
        @open-drawer=${() => void this.#onOpenDrawer()}
        @override-confirm=${(event: Event) => void this.#onOverrideConfirm(event)}
        @override-cancel=${() => this.#closeOverrideDialog()}
        @show-schedule=${() => this.#onShowSchedule()}
        @show-floor=${() => void this.#onShowFloor()}
        @floor-refresh=${() => void this.#refreshFloor()}
        @open-table=${(event: Event) => void this.#onOpenTable(event)}
        @send-round=${(event: Event) => void this.#onSendRound(event)}
        @fire-course=${(event: Event) => void this.#onFireCourse(event)}
        @serve-line=${(event: Event) => void this.#onServeLine(event)}
        @set-status=${(event: Event) => void this.#onSetStatus(event)}
        @move-tab=${(event: Event) => void this.#onMoveTab(event)}
        @join-table=${(event: Event) => void this.#onJoinTable(event)}
        @merge-tabs=${(event: Event) => void this.#onMergeTabs(event)}
        @transfer-lines=${(event: Event) => void this.#onTransferLines(event)}
        @pay-tab=${(event: Event) => void this.#onPayTab(event)}
        @back-to-floor=${() => void this.#onShowFloor()}
        @back-to-counter=${() => this.#onBackToCounter()}
        @logout=${() => void this.#onLogout()}
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
        @menu-selected=${(e: CustomEvent<{ id: string }>) => this.#onMenuSelected(e)}
      >
        ${this.errorKey ? html`<p class="error" role="alert">${t(this.errorKey)}</p>` : nothing}
        <!-- The reusable supervisor-override dialog (cash-drawer-authorization §5), present only while an
             override is in flight. It takes the eligible authorizers + the retry error as PROPS and emits
             override-confirm/override-cancel (wired on the app wrapper above) — the app owns the request. -->
        ${
          this.overrideAuthorizers !== undefined
            ? html`<till-supervisor-override-dialog
                .authorizers=${this.overrideAuthorizers}
                .error=${this.overrideError}
              ></till-supervisor-override-dialog>`
            : nothing
        }
        <!-- The handheld enrol view (handheld-tableside Task 8) overlays the boot/lock state when the
             lock screen's "set up as waiter handheld" affordance opened it — a FRESH phone pairing
             itself. Its handheld-enrolled event (wired above) re-boots into the phone shell. Shown ahead
             of the normal screen so it takes precedence over whatever screen the boot left set. -->
        ${
          this.handheldEnrolling
            ? html`<till-handheld-enrol-screen .api=${this.api}></till-handheld-enrol-screen>`
            : // keyed on the active locale: a locale switch changes the key, so Lit DISCARDS and rebuilds
              // the whole screen subtree, repainting every child in the new language (the screens hold no
              // LocaleChangeController of their own). A same-locale re-render keeps the key and reuses it.
              keyed(currentLocale(), this.#renderScreen())
        }
      </div>
    `;
  }

  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "lock":
        // `deviceEnrolled` gates the lock screen's device-setup affordances (§C2): an already-enrolled
        // device — a handheld (which STAYS on lock) or a KDS — must not offer "set up as kitchen
        // display", or a waiter could re-enrol an in-service phone as a KDS and escape the shell.
        return html`<till-lock-screen
          .api=${this.api}
          .deviceEnrolled=${this.handheldMode || this.deviceMode}
        ></till-lock-screen>`;
      case "counter":
        return html`<till-counter-screen
          .api=${this.api}
          .store=${this.#store}
          .products=${this.products}
          .menus=${this.menus}
          .selectedMenuId=${this.selectedCatalogueId}
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
          .canExitToCounter=${!this.handheldMode}
        ></till-floor-screen>`;
      // FP-1 (Ruling FP-D): the per-table ordering screen. It renders from the app-owned tab lines
      // (loaded via `getTabLines`, reloaded after each round/serve) and emits `send-round`/`serve-line`/
      // `pay-tab`/`set-status`/`back-to-floor`, wired on the app wrapper above. `orderId` rides through
      // (the tab's working-order id) for parity with the placeholder it replaces; the app owns the writes.
      case "table-order":
        return html`<till-table-order-screen
          .lines=${this.tabLines}
          .products=${this.products}
          .menus=${this.menus}
          .selectedMenuId=${this.selectedCatalogueId}
          .statuses=${this.statuses}
          .courses=${this.courses}
          .fireControl=${this.fireControl}
          .tables=${this.tables}
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
          .deviceMode=${this.deviceMode}
          .initialDeviceStation=${this.initialDeviceStation}
        ></till-station-screen>`;
      // KDS-3 (design §5): the expo/pass display. Like the station screen it OWNS its own fetching +
      // levers via `.api`, so the app just hands it the api + the venue fire-control mode (which gates
      // the pass's Fire lever) and switches; `back-to-counter` (wired above) returns.
      case "expo":
        return html`<till-expo-screen
          .api=${this.api}
          .fireControl=${this.fireControl}
        ></till-expo-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-app": TillApp;
  }
}
