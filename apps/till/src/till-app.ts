import type { DietPredicate } from "./menu-filter.js";
import { isTillDestination, type TillDestination, tillPath } from "./navigation.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { UrlStateController, baseStyles } from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { diag } from "./diagnostics.js";
import { LocaleChangeController } from "./state/locale-controller.js";
import { TillApi, isNetworkFailure } from "./api/client.js";
import type { ServerRouter } from "./api/server-router.js";
import { WorkingOrderStore } from "./state/working-order.js";
import { toWireLineExtras, toWireModifiers, toWireProductIdentity } from "./state/order-line.js";
import { deriveExtraSelections } from "./state/held-extras.js";
import { deriveOptionSelections } from "./state/held-options.js";
import "./screens/till-lock-screen.js";
import "./screens/till-counter-screen.js";
import "./screens/till-ticket-view.js";
import "./screens/till-schedule-screen.js";
import "./screens/till-floor-screen.js";
import "./screens/till-table-order-screen.js";
import "./screens/till-station-screen.js";
import "./screens/till-enrol-screen.js";
import "./screens/till-device-chooser.js";
import "./screens/till-expo-screen.js";
import "./screens/till-allergen-screen.js";
import "./widgets/supervisor-override-dialog.js";
import "./widgets/tab-shell.js";
import "./widgets/card-grid.js";
import type { StringKey } from "./i18n/strings.js";
import type { BumpMode, FireControlMode } from "./widgets/station-queue.js";
import type {
  DeviceStation,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  ServiceZoneSummary,
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
  TillActiveReader,
  TillCourse,
  TillInfo,
  TillMenu,
  TillProduct,
  TillSaleResult,
} from "./api/client.js";
import { menuOfferToTillProduct } from "./api/client.js";
import { productUnit } from "./widgets/product-name.js";
import { kindOfFormFactor } from "./layout.js";
import type { CanvasDef, CapabilityFlag, DeviceKind, ReceiptConfig, TabDef } from "./layout.js";
import { SessionActivity } from "./session-activity.js";
import type { ShellAffordance } from "./widgets/tab-shell.js";
import type { OrderLine } from "./state/working-order.js";
import type { LoggedInDetail } from "./screens/till-lock-screen.js";
import type { DevDeviceList } from "./api/client.js";
import { readDevDeviceId, clearDevDeviceId } from "./api/dev-device.js";
import type { TicketIssuer } from "./screens/till-ticket-view.js";
import type {
  CollectCardDetail,
  ConfirmPaymentDetail,
  ParkOrderDetail,
} from "./widgets/tender-pay.js";

import { setContentLanguages } from "@waitron/ui";

/**
 * `"lock"` (or a boot failure) renders the lock screen; every other value renders the canvas tab shell
 * and names the surface a nav action moved to, not a separately rendered screen.
 */
type Screen =
  "lock" | "counter" | "ticket" | "schedule" | "floor" | "table-order" | "station" | "expo";

/** An overlay over the active canvas tab. Sale context remains local; regular destinations have URLs. */
type Drill = { kind: "table-order" | "ticket" | TillDestination };

/** A handheld's screens, in order; `#onLoggedIn` lands it on `HANDHELD_FACES[1]`. */
const HANDHELD_FACES: Screen[] = ["lock", "floor", "table-order"];

type RefreshList = "held" | "station";

interface RefreshRetry {
  /** What the write that preceded the failed refresh achieved. */
  messageKey: StringKey;
  failures: number;
  secondsLeft: number;
  inFlight: boolean;
}

const REFRESH_RETRY_SECONDS = [5, 10, 30] as const;

/** A whole-count unit's three-place server quantity reads "2", not "2.000". */
function displayQuantity(product: TillProduct, quantity: string): string {
  if (productUnit(product).precision !== 0 || !quantity.includes(".")) return quantity;
  return quantity.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Sale refusals a retry can never clear: the same basket files the same refused record. Every handler
 * whose server call reaches `recordSale` checks them. The settle paths show `sale.refused`, because
 * money may already have been taken; `#onPlaceOrder` takes no tender and shows `place.refused`.
 */
const PERMANENT_SALE_REFUSALS = new Set([
  "fiscal.record_invalid",
  "fiscal.foreign_recipient_unsupported",
]);

/** A table write refused because a card payment of the order is running says so, in the words the
 * counter uses; any other says the generic `table.error`. */
function tableWriteError(error: unknown): CounterError {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "order.payment_in_flight" ? { code } : "table.error";
}

/** Refusals the counter shows in their own words (`codeMessage`): each names what to do next, where
 * the generic "try again" would send the operator round the same refusal. */
const ACTIONABLE_REFUSALS = new Set(["order.payment_in_flight", "product.unavailable"]);

/** A counter pay, place or hold refusal: its own message when it is actionable, else `fallback`. */
function counterError(error: unknown, fallback: StringKey): CounterError {
  const code = (error as { code?: string } | undefined)?.code;
  return code !== undefined && ACTIONABLE_REFUSALS.has(code) ? { code } : fallback;
}

/** A banner's string key, or a refusal shown through its code's own message. */
type CounterError = StringKey | { code: string };

function isPermanentSaleRefusal(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code !== undefined && PERMANENT_SALE_REFUSALS.has(code);
}

/**
 * Owns the one {@link WorkingOrderStore}, which belongs to the till and survives a change of operator,
 * and the one {@link TillApi}. Screens emit composed events; this element decides what happens next. A
 * rejected sale leaves the basket intact: a till must never lose a sale in progress.
 *
 * Disconnect guards protect shared browser state: post-await locale switches, menu storage writes,
 * and URL updates must not overwrite a replacement app's state. Reactive fields belong to this
 * element; Lit does not paint them after it disconnects.
 */
@customElement("till-app")
export class TillApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .app {
        padding-bottom: calc(
          var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom)
        );
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

      .refresh-message {
        margin: 0;
      }

      .refresh-notice[data-active] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
      }

      .refresh-notice[data-active] .refresh-message {
        font-weight: var(--wt-font-weight-bold);
      }

      .refresh-countdown {
        flex: 1;
        margin: 0;
      }

      /* The compact waiting-for-promotion banner (till-reroute §4.4), muted so it informs without the
         alarm weight of the danger .error banner above. */
      .banner {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .mode-indicator {
        margin: 0;
        padding: var(--wt-space-1) var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-align: center;
      }
    `,
  ];

  /** The HTTP face of the till. Defaults to a real same-origin client; a test injects a stub. */
  @property({ attribute: false }) api: TillApi = new TillApi();

  /** Set by `main.ts`; undefined in tests that inject none. */
  @property({ attribute: false }) router?: ServerRouter;

  sessionActivity: SessionActivity = new SessionActivity();

  #deviceKind: DeviceKind = "till";

  /** `router` can be set after `connectedCallback`, so both it and `willUpdate` subscribe; a doubled
   * `server-changed` would boot twice. */
  #subscribedRouter?: ServerRouter;

  /**
   * The login session belonged to the server just left, so the operator is dropped locally and boot
   * re-runs against the new one. The working order stays in memory.
   */
  readonly #onServerChanged = (event: Event): void => {
    const { from, to } = (event as CustomEvent<{ from: string; to: string }>).detail;
    // Its own event kind, not `nav`: `#setScreen` below records the nav.
    diag.record("info", "server-switch", { from, to });
    this.operatorPersonId = "";
    this.operatorName = "";
    this.canEdit = false;
    this.errorKey = "server.switched";
    this.#setScreen("lock");
    void this.#boot();
  };

  readonly #onServerState = (): void => this.requestUpdate();

  #subscribeRouter(): void {
    if (this.#subscribedRouter === this.router) return;
    this.#detach();
    this.router?.addEventListener("server-changed", this.#onServerChanged);
    this.router?.addEventListener("state-changed", this.#onServerState);
    this.#subscribedRouter = this.router;
  }

  #detach(): void {
    this.#subscribedRouter?.removeEventListener("server-changed", this.#onServerChanged);
    this.#subscribedRouter?.removeEventListener("state-changed", this.#onServerState);
    this.#subscribedRouter = undefined;
  }

  /** The device profile's idle logout in seconds; `null` disables it. */
  #inactivityTimeoutSeconds: number | null = null;

  readonly #onInteraction = (): void => this.sessionActivity.noteInteraction();

  readonly #onVisibility = (): void => this.sessionActivity.reacquire();

  readonly #onIdle = (): void => void this.#onLogout();

  #configureSessionActivity(): void {
    this.sessionActivity.configure({
      // `operatorPersonId` is not cleared on logout, so `operatorName` is the login signal.
      loggedIn: this.operatorName !== "",
      kind: this.#deviceKind,
      timeoutSeconds: this.#inactivityTimeoutSeconds,
      onIdle: this.#onIdle,
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#subscribeRouter();
    // pointerdown/keydown are composed, so they reach this host from inside the screens' shadow roots.
    this.addEventListener("pointerdown", this.#onInteraction);
    this.addEventListener("keydown", this.#onInteraction);
    document.addEventListener("visibilitychange", this.#onVisibility);
    void this.sessionActivity.start();
  }

  override disconnectedCallback(): void {
    this.#abandonListRefreshes();
    this.#contentLanguageGeneration++;
    clearTimeout(this.#contentLanguageTimer);
    this.#detach();
    this.removeEventListener("pointerdown", this.#onInteraction);
    this.removeEventListener("keydown", this.#onInteraction);
    document.removeEventListener("visibilitychange", this.#onVisibility);
    void this.sessionActivity.stop();
    super.disconnectedCallback();
  }

  /** The one basket the whole flow shares. A stable reference (widgets subscribe to it directly). */
  readonly #store = new WorkingOrderStore();

  /** A stable field, so the shell's `loadLocales` property does not change on every render. */
  readonly #loadLocales = () => this.api.getLocales().then((r) => r.locales);

  /** Recomputed in {@link willUpdate}, so the shell's `affordances` property is not a fresh array on
   * every render. */
  #affordanceList: ShellAffordance[] = [];

  /** The venue's default UI locale, used when no operator's preference applies. */
  #venueLocale = "es-ES";

  /**
   * Set after a full {@link #loadFloorData}, so a repeat floor visit reloads tables only. A flag, not
   * `zones.length > 0`, because a venue with no floor zones leaves that 0. Reset at login and logout.
   */
  #floorLoaded = false;

  constructor() {
    super();
    // Re-renders on a locale switch, so `keyed(currentLocale(), …)` recreates the screens, which read
    // `t()` at render time.
    new LocaleChangeController(this);
  }

  @state() private screen: Screen = "lock";
  /** The shell's active tab; undefined only before boot resolves a canvas, or after a boot failure. */
  @state() private activeTabKey?: string;
  /** The drill-in stacked over the shell's active tab, or undefined when the tab body is on top. */
  @state() private drill?: Drill;
  /** An enrolled KDS display: no login, boots straight into its queue. Set only by {@link #boot}. */
  @state() private deviceMode = false;
  /** An enrolled handheld: stays on the lock screen for a PIN login, then lands on the floor. */
  @state() private handheldMode = false;
  /**
   * The device front door {@link #boot} chose, shown ahead of the lock screen and shell: `"chooser"` in
   * dev mode when this tab has adopted no device, `"enrol"` for a browser with no device cookie.
   * `undefined` once enrolled.
   */
  @state() private frontDoor?: "chooser" | "enrol";
  /** Read by {@link #boot} in dev mode, so the chooser need not fetch it again. */
  @state() private devDevices?: DevDeviceList;
  /** Whether this tab has adopted a dev device, which the "Switch device" affordance needs. */
  @state() private devTab = false;
  /** From the boot probe: the lock screen's heading, and the key for the remembered-operator default. */
  @state() private deviceName?: string;
  @state() private deviceId?: string;
  /** Prefetched by the boot probe, so the station screen does not read `GET /api/device/station` again. */
  @state() private initialDeviceStation?: DeviceStation;
  /** The issuer identity printed on the ticket (venue name + NIF), read once from `getTill` on boot. */
  @state() private issuer?: TicketIssuer;
  /** Offers available in the counter's current service zone. Each carries a distinct menu-item ID,
   * even when two menus offer the same product. Table ordering keeps its own zone-specific set. */
  @state() private products: TillProduct[] = [];
  /** Menus available in the counter's current service zone, default first. */
  @state() private menus: TillMenu[] = [];
  @state() private tableProducts: TillProduct[] = [];
  @state() private tableMenus: TillMenu[] = [];
  @state() private tableSelectedCatalogueId = "";
  /** Identifies the latest table-selection offer request so a slower prior selection cannot win. */
  #tableOfferRequest = 0;
  @state() private counterServiceZones: ServiceZoneSummary[] = [];
  @state() private counterServiceZoneId = "";
  #counterOfferRequest = 0;
  /** The grid's selected menu, reset to the default at login and changed by the switcher. */
  @state() private selectedCatalogueId = "";
  @state() private selectedDiet: DietPredicate | null = null;
  @state() private operatorName = "";
  /** The schedule screen leaves the operator out of the colleague picker. */
  @state() private operatorPersonId = "";
  @state() private staff: StaffMember[] = [];
  /** Every open working order in the venue, across tills. */
  @state() private heldOrders: HeldOrderSummary[] = [];
  @state() private zones: FloorZone[] = [];
  @state() private tables: TableState[] = [];
  /**
   * From the session's server-computed `canConfigureTill`, never derived from a role here. Hiding the
   * editor is convenience only; the server re-checks `venue.configure`. Reset at logout.
   */
  @state() private canEdit = false;
  /** Every active status, not only those applied to a table, so an unused status can still be picked. */
  @state() private statuses: TableServiceStatus[] = [];
  /** The working-order id of the tab opened from the floor. */
  @state() private activeTabId?: string;
  /** The table id of that tab: `set-status` is keyed by table, not by order. */
  @state() private activeTableId?: string;
  /** The open tab's lines at their locked add-time prices; a tab does not re-price. */
  @state() private tabLines: TabLine[] = [];
  /** Defaults to prepay, so an unresolved boot never shows the Place/Collect controls. */
  @state() private orderFlow: OrderFlow = "prepay";
  @state() private onboardingIntent?: TillInfo["onboardingIntent"];
  /** Defaults to `"none"`, so an unresolved boot never shows the integrated-card controls. */
  @state() private cardProvider: TillInfo["cardProvider"] = "none";
  @state() private tipsEnabled = false;
  @state() private activeReaders: TillActiveReader[] = [];
  /** The reader `till-tender-pay` shows before the operator picks one. */
  @state() private defaultReaderId?: string;
  /** Where the current basket sits in an order-then-collect flow; unused under prepay. */
  @state() private stage: "order" | "collect" = "order";
  @state() private stations: Station[] = [];
  /** The default station's queue. Prepay enqueues nothing automatically, so a prepay till never fetches it. */
  @state() private stationQueue: StationQueueGroup[] = [];
  /** Defaults to per-line, which is always correct, until boot answers. */
  @state() private bumpMode: BumpMode = "line";
  /** Defaults to `waiter`, so an unresolved boot never shows the display's fire action. */
  @state() private fireControl: FireControlMode = "waiter";
  @state() private courses: TillCourse[] = [];
  /** The ticket's lines come from this filed result, never the client basket. */
  @state() private result?: TillSaleResult;
  /** The location's issuance behavior; non-auto modes offer the original on the completion screen. */
  @state() private receiptPrintMode: "auto" | "on_request" | "never" = "auto";
  /** Whether the issuance-time original action is still available for the ticket currently shown. */
  @state() private originalReceiptAvailable = false;
  /** The working order that produced the ticket currently shown, including detached split checks. */
  private ticketWorkingOrderId?: string;
  /**
   * The receipt's language, kept apart from the operator UI locale so a fiscal locale the UI does not
   * support never changes the printed ticket's language.
   */
  @state() private invoiceLocale = "es-ES";
  /**
   * The server resolves a canvas for every boot, so this is `undefined` only after a boot failure, where
   * {@link render} shows the lock screen rather than an empty shell.
   */
  @state() private canvas?: CanvasDef;
  /** The card grid hides a card whose required capability is absent, except `tender-pay`, which also
   * takes cash. */
  @state() private capabilities: CapabilityFlag[] = [];
  /** The non-fiscal receipt trim; `{}` when the server omits it. */
  @state() private receipt: ReceiptConfig = {};
  /** The non-fatal error to show over the counter, or `undefined` for none. */
  @state() private errorKey?: CounterError;
  /**
   * Authorizers for an open cash-drawer override; `undefined` means the dialog is closed, and a possibly
   * empty array opens it.
   */
  @state() private overrideAuthorizers?: StaffMember[];
  /** An error code shown inside the open override dialog; cleared before each attempt so a repeat
   * re-shows. */
  @state() private overrideError: string | null = null;
  /**
   * The outcome of the last non-captured `collect-card` attempt. Cleared wherever the basket it describes
   * leaves the counter, and deliberately not by `#onDiscardOrder`, which never touches the loaded basket.
   */
  @state() private cardOutcome?: Exclude<PayOutcome, { outcome: "captured" }>["outcome"];
  /**
   * Single-flight guard: two chained fiscal records for one purchase cannot be repaired. Set
   * synchronously before the first await of {@link TillApp.#onConfirmPayment}, so a second
   * `confirm-payment` before the first settles is a no-op; disabling the button is only the visible
   * feedback.
   */
  @state() private submitting = false;
  /** Re-entry guard for {@link TillApp.#onParkOrder}, set before its first await. */
  @state() private parking = false;
  /** Re-entry guard for {@link TillApp.#onPlaceOrder}; also disables Place while in flight. */
  @state() private placing = false;
  /** A list whose refresh failed after a successful write, with its automatic retry's countdown. */
  @state() private refreshRetries: Partial<Record<RefreshList, RefreshRetry>> = {};
  #refreshTimers = new Map<RefreshList, ReturnType<typeof setTimeout>>();
  #refreshGeneration: Record<RefreshList, number> = { held: 0, station: 0 };

  readonly #url = new UrlStateController(this, () => this.#onHistory(), tillPath);

  #requestedTab(): string | undefined {
    const requested = this.#url.read("till-tab");
    return this.canvas?.tabs.find((tab) => tab.key === requested)?.key ?? this.canvas?.tabs[0]?.key;
  }

  #setActiveTab(key: string | undefined, replace = false, retainDestination = false): void {
    this.activeTabKey = key;
    if (key !== undefined)
      this.#url.write(
        {
          "till-tab": key,
          ...(retainDestination ? {} : { "till-view": null, "till-station": null }),
        },
        replace,
      );
  }

  #allowsDestination(destination: TillDestination): boolean {
    return (
      !this.deviceMode && (destination === "allergens" || this.#affordances().includes(destination))
    );
  }

  #restoreDestination(): void {
    const requested = this.#url.read("till-view");
    const destination =
      isTillDestination(requested) && this.#allowsDestination(requested) ? requested : null;
    this.drill = destination === null ? undefined : { kind: destination };
    this.#url.write(
      {
        "till-view": destination,
        "till-station": destination === "station" ? this.#url.read("till-station") : null,
      },
      true,
    );
  }

  readonly #onHistory = (): void => {
    if (!this.#inShell()) return;
    const key = this.#requestedTab();
    if (key !== undefined) this.#onTabSelect(key, true);
  };

  override firstUpdated(): void {
    void this.#boot();
  }

  /** `handheldMode` is set after `canvas` in {@link #boot}, so a change to either recomputes the
   * affordances. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("canvas") || changed.has("handheldMode"))
      this.#affordanceList = this.#affordances();
    // `router` may be assigned after `connectedCallback`.
    if (changed.has("router")) this.#subscribeRouter();
  }

  #contentLanguageGeneration = 0;
  #contentLanguageTimer?: ReturnType<typeof setTimeout>;

  async #refreshContentLanguages(generation: number): Promise<void> {
    try {
      const config = await this.api.getContentLanguages();
      if (this.isConnected && generation === this.#contentLanguageGeneration)
        setContentLanguages(config);
    } finally {
      if (this.isConnected && generation === this.#contentLanguageGeneration) {
        this.#contentLanguageTimer = setTimeout(() => {
          void this.#refreshContentLanguages(generation).catch(() => undefined);
        }, 60_000);
      }
    }
  }

  async #boot(): Promise<void> {
    this.#abandonListRefreshes();
    clearTimeout(this.#contentLanguageTimer);
    const contentGeneration = ++this.#contentLanguageGeneration;
    try {
      const [till] = await Promise.all([
        this.api.getTill(),
        this.#refreshContentLanguages(contentGeneration),
      ]);
      // `setLocale` changes module-global state, so it must not run for a torn-down app. The state
      // writes below need no guard: Lit never paints a detached element.
      if (!this.isConnected) return;
      this.router?.setServers(till.servers);
      // Only before any login: a login can complete while `getTill` is in flight, and re-applying the
      // venue default would overwrite the operator's own language.
      if (this.operatorPersonId === "") setLocale(till.locale);
      this.#venueLocale = till.locale;
      // A separate field: the UI default drops UI-unsupported codes, which must never change the
      // printed ticket's language.
      this.invoiceLocale = till.invoiceLocale;
      this.onboardingIntent = till.onboardingIntent;
      this.issuer = { venueName: till.venueName, nif: till.nif };
      this.orderFlow = till.orderFlow;
      this.receiptPrintMode = till.receiptPrintMode ?? "auto";
      this.bumpMode = till.bumpMode;
      this.fireControl = till.fireControl;
      this.courses = till.courses;
      this.cardProvider = till.cardProvider;
      this.tipsEnabled = till.tipsEnabled;
      this.activeReaders = till.activeReaders ?? [];
      this.defaultReaderId = till.defaultReaderId;
      this.receipt = till.receipt ?? {};
      this.canvas = till.canvas;
      this.capabilities = till.capabilities;
      this.#inactivityTimeoutSeconds = till.inactivityTimeoutSeconds ?? null;
      // Validated and retained, but not written to the URL: the front-door surfaces are not `/tabs/*`
      // destinations, so the tab is published only when the shell opens.
      this.activeTabKey = this.#requestedTab();
    } catch {
      // Return before the device probe: a till that could not read its own setup is not a display to
      // route into device mode.
      this.errorKey = "boot.error";
      return;
    }
    // `#boot` re-runs, and the branches below only ever set a mode, so reset first.
    this.handheldMode = false;
    this.deviceMode = false;
    this.#deviceKind = "till";
    this.deviceName = undefined;
    this.deviceId = undefined;
    this.frontDoor = undefined;
    this.devTab = readDevDeviceId() !== null;
    this.#setScreen("lock");
    // The till has no server flag for dev mode: the dev-only `GET /api/dev/devices` answers only there,
    // and its list is also the chooser's data.
    if (!this.devTab) {
      try {
        this.devDevices = await this.api.getDevDevices();
        if (!this.isConnected) return;
        this.frontDoor = "chooser";
        return;
      } catch {
        // Not dev mode, or a transient failure.
      }
    }
    // A KDS boots straight into its station, prefetching the queue; a handheld stays on the lock
    // screen; any other or unknown kind is a normal operator till. A browser with no device cookie
    // answers `device.unauthorized` and gets the join screen, which is not a boot failure.
    try {
      const identity = await this.api.getDeviceIdentity();
      this.deviceName = identity.name;
      this.deviceId = identity.deviceId;
      const kind = kindOfFormFactor(identity.formFactor);
      this.#deviceKind = kind ?? "till";
      if (kind === "handheld") {
        this.handheldMode = true;
      } else if (kind === "kds_station") {
        this.initialDeviceStation = await this.api.getDeviceStation();
        if (!this.isConnected) return;
        this.deviceMode = true;
        this.#setScreen("station");
        this.#onHistory();
      }
    } catch (error) {
      // Only a genuine `device.unauthorized` goes to the join screen. Any other failure is transient,
      // and stranding a sellable till behind an approval it cannot get would block sales, so it falls
      // through to the login screen.
      if ((error as { code?: string }).code === "device.unauthorized") this.frontDoor = "enrol";
    }
    this.#configureSessionActivity();
  }

  async #onLoggedIn(event: Event): Promise<void> {
    const { personId, displayName, canConfigureTill, locale } = (
      event as CustomEvent<LoggedInDetail>
    ).detail;
    setLocale(resolveActiveLocale(locale, this.#venueLocale));
    // Refresh restores regular destinations only after login; sale context remains local.
    this.drill = undefined;
    this.#floorLoaded = false;
    let offerLoadFailed = false;
    try {
      const { menus, offers, zones, context } = await this.api.listDefaultZoneOffers();
      this.products = offers.map(menuOfferToTillProduct);
      this.menus = menus;
      this.counterServiceZones = zones ?? [];
      this.counterServiceZoneId = context.zoneId;
      this.api.setServiceZone(context.zoneId);
      if (zones !== undefined && context.serviceMode !== "table_tab")
        this.orderFlow = context.serviceMode;
    } catch {
      offerLoadFailed = true;
      this.products = [];
      this.menus = [];
      this.counterServiceZones = [];
      this.counterServiceZoneId = "";
    }
    // A fresh login starts on the zone's default menu, regardless of the previous menu preference.
    this.#selectMenu(this.#defaultCatalogueId());
    this.#selectDiet(null);
    this.operatorName = displayName;
    this.operatorPersonId = personId;
    this.canEdit = canConfigureTill;
    this.errorKey = offerLoadFailed ? "service_zone.load_error" : undefined;
    this.#configureSessionActivity();
    const landingFace = this.handheldMode ? HANDHELD_FACES[1] : "counter";
    if (landingFace === "floor") await this.#loadFloorData();
    // History may change while login data loads and the lock screen still owns the page.
    this.#setActiveTab(this.#requestedTab(), true, true);
    this.#setScreen(landingFace);
    this.#restoreDestination();
    if (landingFace !== "floor") {
      // Counter-only data: a handheld lands on the floor, which shows neither.
      await this.#refreshHeldOrders();
      await this.#refreshStationQueue();
      // Loaded after the counter is shown, and a failure is swallowed, so the roster never blocks a sale.
      try {
        this.staff = await this.api.listStaff();
      } catch {
        // Non-fatal: the picker keeps the roster it had.
      }
    }
    // A restored floor tab needs its data on first paint. The handheld landing already loads it;
    // avoid repeating that load while still loading a floor tab restored on a counter device.
    if (this.#inShell() && !this.#floorLoaded) {
      const tab = this.#activeTab();
      if (tab !== undefined && this.#tabNeedsFloorData(tab)) await this.#loadFloorData();
    }
  }

  #refreshHeldOrders(): Promise<void> {
    return this.#refreshList("held");
  }

  #refreshStationQueue(): Promise<void> {
    return this.#refreshList("station");
  }

  /**
   * For the refresh behind a write that has already succeeded: its failure is a load failure, so it
   * never reaches the write's own error handling.
   */
  #refreshAfterWrite(list: RefreshList, messageKey: StringKey): Promise<void> {
    return this.#refreshList(list, messageKey);
  }

  /**
   * Only the newest refresh of a list may install the list's rows (`heldOrders` or `stationQueue`) or
   * start, change or end its retry, and {@link TillApp.#abandonListRefreshes} makes every earlier
   * request stale. Without a `messageKey` a failure is also thrown to the caller.
   */
  async #refreshList(list: RefreshList, messageKey?: StringKey): Promise<void> {
    const request = ++this.#refreshGeneration[list];
    let install: () => void;
    try {
      install = await this.#loadList(list);
    } catch (error) {
      if (request === this.#refreshGeneration[list]) this.#onRefreshFailed(list, messageKey);
      if (messageKey === undefined) throw error;
      return;
    }
    if (request !== this.#refreshGeneration[list]) return;
    install();
    this.#endRefreshRetry(list);
  }

  async #loadList(list: RefreshList): Promise<() => void> {
    if (list === "station") return this.#loadStationQueue();
    const rows = await this.api.listWorkingOrders();
    return () => (this.heldOrders = rows);
  }

  async #loadStationQueue(): Promise<() => void> {
    if (this.orderFlow === "prepay") return () => (this.stationQueue = []);
    if (this.stations.length === 0) this.stations = await this.api.listStations();
    const defaultStation = this.stations.find((station) => station.isDefault);
    const queue =
      defaultStation === undefined ? [] : (await this.api.getStationQueue(defaultStation.id)).items;
    return () => (this.stationQueue = queue);
  }

  /**
   * One loop per list. A failure while it counts down at most updates what the message says
   * succeeded. A failure while its attempt is in flight counts as that attempt's failure, whether it
   * is the attempt's own or a newer request's, which supersedes the attempt.
   */
  #onRefreshFailed(list: RefreshList, messageKey: StringKey | undefined): void {
    const pending = this.refreshRetries[list];
    if (pending === undefined) {
      if (messageKey === undefined) return;
      this.#setRefreshRetry(list, {
        messageKey,
        failures: 0,
        secondsLeft: REFRESH_RETRY_SECONDS[0],
        inFlight: false,
      });
    } else if (!pending.inFlight) {
      if (messageKey !== undefined) this.#setRefreshRetry(list, { ...pending, messageKey });
      return;
    } else {
      const failures = pending.failures + 1;
      this.#setRefreshRetry(list, {
        messageKey: messageKey ?? pending.messageKey,
        failures,
        inFlight: false,
        secondsLeft: REFRESH_RETRY_SECONDS[Math.min(failures, REFRESH_RETRY_SECONDS.length - 1)]!,
      });
    }
    this.#armRefreshTick(list);
  }

  #setRefreshRetry(list: RefreshList, retry: RefreshRetry | undefined): void {
    const next = { ...this.refreshRetries };
    if (retry === undefined) delete next[list];
    else next[list] = retry;
    this.refreshRetries = next;
  }

  #armRefreshTick(list: RefreshList): void {
    clearTimeout(this.#refreshTimers.get(list));
    this.#refreshTimers.set(
      list,
      setTimeout(() => this.#onRefreshTick(list), 1000),
    );
  }

  #onRefreshTick(list: RefreshList): void {
    const retry = this.refreshRetries[list];
    if (retry === undefined) return;
    if (retry.secondsLeft > 1) {
      this.#setRefreshRetry(list, { ...retry, secondsLeft: retry.secondsLeft - 1 });
      this.#armRefreshTick(list);
      return;
    }
    void this.#retryRefresh(list);
  }

  /** Called by the countdown and by "Try now"; an attempt already in flight is not doubled. */
  async #retryRefresh(list: RefreshList): Promise<void> {
    const retry = this.refreshRetries[list];
    if (retry === undefined || retry.inFlight) return;
    clearTimeout(this.#refreshTimers.get(list));
    this.#setRefreshRetry(list, { ...retry, inFlight: true });
    await this.#refreshList(list, retry.messageKey);
  }

  #endRefreshRetry(list: RefreshList): void {
    clearTimeout(this.#refreshTimers.get(list));
    this.#refreshTimers.delete(list);
    if (this.refreshRetries[list] !== undefined) this.#setRefreshRetry(list, undefined);
  }

  #abandonListRefreshes(): void {
    this.#refreshGeneration.held++;
    this.#refreshGeneration.station++;
    for (const timer of this.#refreshTimers.values()) clearTimeout(timer);
    this.#refreshTimers.clear();
    this.refreshRetries = {};
  }

  #renderRefreshNotice(list: RefreshList): TemplateResult {
    const retry = this.refreshRetries[list];
    // The status region stays in the page and holds only the message, so the countdown's ticks never
    // change what it announces.
    return html`<div
      class="refresh-notice"
      data-refresh-notice=${list}
      ?data-active=${retry !== undefined}
    >
      <p class="refresh-message" role="status">${retry === undefined ? "" : t(retry.messageKey)}</p>
      ${
        retry === undefined
          ? nothing
          : html`<p class="refresh-countdown">
                ${
                  retry.inFlight
                    ? t("refresh.retrying")
                    : retry.secondsLeft === 1
                      ? t("refresh.retry_in_one")
                      : t("refresh.retry_in").replace("{n}", String(retry.secondsLeft))
                }
              </p>
              <wt-button
                variant="secondary"
                data-refresh-retry
                .loading=${retry.inFlight}
                @click=${() => void this.#retryRefresh(list)}
                >${t("refresh.try_now")}</wt-button
              >`
      }
    </div>`;
  }

  #defaultStationId(): string | undefined {
    return this.stations.find((station) => station.isDefault)?.id;
  }

  /** The zone's default menu, or its first menu when none is marked default. */
  #defaultCatalogueId(menus: TillMenu[] = this.menus): string {
    return menus.find((menu) => menu.isDefault)?.id ?? menus[0]?.id ?? "";
  }

  /** Menu selection filters the product grid without changing the working order or browser history. */
  #onMenuSelected(event: CustomEvent<{ id: string }>): void {
    if (this.#tableCatalogueActive()) this.#selectTableMenu(event.detail.id);
    else this.#selectMenu(event.detail.id);
  }

  #tableCatalogueActive(): boolean {
    return (
      this.drill?.kind === "table-order" || this.#activeTab()?.key === this.#tableOrderTabKey()
    );
  }

  #selectTableMenu(id: string): void {
    if (!this.isConnected) return;
    if (id !== "" && !this.tableMenus.some((menu) => menu.id === id)) return;
    this.tableSelectedCatalogueId = id;
  }

  #selectDiet(predicate: DietPredicate | null): void {
    if (!this.isConnected) return;
    this.selectedDiet = predicate;
    try {
      if (predicate === null) sessionStorage.removeItem("waitron.dietFilter");
      else sessionStorage.setItem("waitron.dietFilter", predicate);
    } catch {
      // Filtering remains available when browser storage is blocked.
    }
  }

  #selectMenu(id: string): void {
    if (!this.isConnected) return;
    if (id !== "" && !this.menus.some((menu) => menu.id === id)) return;
    this.selectedCatalogueId = id;
    try {
      sessionStorage.setItem("waitron.lastMenu", id);
    } catch {
      // The current selection still works when browser storage is unavailable.
    }
  }

  async #onCounterZoneSelected(event: Event): Promise<void> {
    const { zoneId } = (event as CustomEvent<{ zoneId: string }>).detail;
    if (this.#store.lines.length > 0) {
      this.errorKey = "service_zone.basket_active";
      this.requestUpdate();
      return;
    }
    if (!this.counterServiceZones.some((zone) => zone.id === zoneId)) return;
    const request = ++this.#counterOfferRequest;
    try {
      const { menus, offers, defaultMenuId, context } = await this.api.listZoneOffers(zoneId);
      if (request !== this.#counterOfferRequest || this.#store.lines.length > 0) return;
      this.products = offers.map(menuOfferToTillProduct);
      this.menus = menus;
      this.counterServiceZoneId = context.zoneId;
      this.api.setServiceZone(context.zoneId);
      if (context.serviceMode !== "table_tab") this.orderFlow = context.serviceMode;
      this.stage = "order";
      await this.#refreshStationQueue();
      this.#selectMenu(defaultMenuId ?? this.#defaultCatalogueId(menus));
      this.errorKey = undefined;
    } catch {
      if (request === this.#counterOfferRequest) this.errorKey = "service_zone.load_error";
    }
  }

  /**
   * Settles the basket (prepay). The ticket's lines come from the server result, so a rejection leaves
   * the basket untouched on the counter.
   */
  async #onConfirmPayment(event: Event): Promise<void> {
    // Single-flight (see `submitting`): set before the first await.
    if (this.submitting) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    // The store's stable working-order id is the pay-idempotency key: a re-tap after a lost response
    // replays against the same row rather than filing a second record.
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    let reachedFiscal = false;
    try {
      // The server pays a retrieved order from its stored lines and ignores `lines`, so an edit made
      // after retrieving must be saved first or it is silently dropped from the charge and the record.
      if (!(await this.#syncIfDirty(id, lines, label))) return;
      reachedFiscal = true;
      this.result = await this.api.recordSale(lines, tender, id);
      this.#showTicket(id);
      // A just-paid retrieved order must drop off the held list.
      await this.#refreshAfterWrite("held", "refresh.held_after_sale");
    } catch (error) {
      // The basket stays intact. `sale.refused` is permanent, and its message covers refunding a manual
      // terminal charge; `sale.unconfirmed` means the fiscal call was reached, so the sale may have
      // filed; anything else is the free-to-retry `sale.error`.
      this.errorKey = isPermanentSaleRefusal(error)
        ? "sale.refused"
        : reachedFiscal && isNetworkFailure(error)
          ? "sale.unconfirmed"
          : counterError(error, "sale.error");
    } finally {
      this.submitting = false;
    }
  }

  /**
   * Like {@link TillApp.#onConfirmPayment}, sharing its `submitting` guard, but a decline, timeout or
   * `network_unavailable` comes back as data, not a throw: nothing was filed, so it is recorded in
   * {@link cardOutcome} and the basket stays, with no error banner.
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
    let reachedFiscal = false;
    try {
      if (!(await this.#syncIfDirty(id, lines, label))) return;
      reachedFiscal = true;
      const out: PayOutcome = await this.api.pay({
        id,
        lines,
        ...(detail.tip ? { tip: detail.tip } : {}),
        ...(detail.allowOffline ? { allowOffline: true } : {}),
        ...(detail.simulationOutcome === undefined
          ? {}
          : { simulationOutcome: detail.simulationOutcome }),
        // Omitted, the server uses the paying device's default reader.
        ...(detail.readerId === undefined ? {} : { readerId: detail.readerId }),
      });
      if (out.outcome === "captured") {
        this.result = out.ticket;
        this.#showTicket(id, this.orderFlow !== "invoice_first");
        await this.#refreshAfterWrite("held", "refresh.held_after_sale");
      } else {
        this.cardOutcome = out.outcome;
      }
    } catch (error) {
      // The terminal may already have captured before the fiscal record was refused (`finalizeCapture`,
      // `apps/server/src/till-sale.ts`), which is what `sale.refused`'s refund sentence is for.
      this.errorKey = isPermanentSaleRefusal(error)
        ? "sale.refused"
        : reachedFiscal && isNetworkFailure(error)
          ? "sale.unconfirmed"
          : counterError(error, "sale.error");
    } finally {
      this.submitting = false;
    }
  }

  /** Never carries a price: the server re-prices. */
  #currentSaleLines(): SaleLine[] {
    return this.#store.lines.map((line) => {
      const saleLine: SaleLine = {
        ...toWireProductIdentity(line.product),
        quantity: line.quantity,
        ...toWireLineExtras(line),
        ...toWireModifiers(line),
      };
      if (line.workingOrderLineId !== undefined) {
        saleLine.workingOrderLineId = line.workingOrderLineId;
      }
      return saleLine;
    });
  }

  /**
   * Saves an edited retrieved order before a pay or place. A fresh basket has no server row, and
   * re-saving an unedited one would re-price it against the live catalogue, losing its add-time prices.
   * `working_order.not_open` (already settled or placed) is swallowed so the pay routes replay the filed
   * ticket; `placeOrder` is not idempotent and still refuses. An idempotent `placeOrder` is a recorded
   * backlog follow-up (docs/backlog.md).
   */
  async #syncIfDirty(id: string, lines: SaleLine[], label: string | undefined): Promise<boolean> {
    if (!(this.#store.persisted && this.#store.dirty)) return true;
    try {
      const saved = await this.api.updateWorkingOrder(id, {
        lines,
        label,
        revision: this.#store.revision,
      });
      this.#store.markSaved(saved.revision);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "working_order.out_of_date") {
        await this.#reloadChangedOrder(id);
        return false;
      }
      if (code !== "working_order.not_open") throw error;
    }
    return true;
  }

  /**
   * `placeOrder` needs an existing open row, so a fresh basket is parked first and a retrieved one is
   * saved only if edited (see {@link #syncIfDirty}); re-parking a retrieved order would replay it
   * server-side and drop the edit. On success the SAME order moves to the `"collect"` stage.
   */
  async #onPlaceOrder(): Promise<void> {
    if (this.placing) return;
    this.placing = true;
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    // A network failure after the fiscal call started is `sale.unconfirmed`; before it, nothing was filed.
    let reachedFiscal = false;
    try {
      if (this.#store.persisted) {
        if (!(await this.#syncIfDirty(id, lines, label))) return;
      } else {
        await this.api.parkOrder({ id, lines, label });
        this.#store.markPersisted();
      }
      reachedFiscal = true;
      await this.api.placeOrder(id);
      this.stage = "collect";
      await this.#refreshAfterWrite("station", "refresh.station_after_place");
    } catch (error) {
      // `place.refused`, not `sale.refused`: placing takes no tender, so its message says nothing
      // about refunds.
      this.errorKey = isPermanentSaleRefusal(error)
        ? "place.refused"
        : reachedFiscal && isNetworkFailure(error)
          ? "sale.unconfirmed"
          : counterError(error, "place.error");
    } finally {
      this.placing = false;
    }
  }

  /**
   * Shares `submitting` with {@link TillApp.#onConfirmPayment}. Collect files the order's placed
   * composition, never the local basket, so an edit made after placing does not reach the receipt.
   */
  async #onCollectOrder(event: Event): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    const id = this.#store.id;
    this.errorKey = undefined;
    try {
      this.result = await this.api.collectOrder(id, tender);
      this.#showTicket(id, this.orderFlow !== "invoice_first");
    } catch (error) {
      // No preliminary save, so any network failure may have filed. Collect carries a tender, so a
      // permanent refusal takes `sale.refused`.
      this.errorKey = isPermanentSaleRefusal(error)
        ? "sale.refused"
        : isNetworkFailure(error)
          ? "sale.unconfirmed"
          : "sale.error";
    } finally {
      this.submitting = false;
    }
  }

  /** Refreshes on both paths, so a rejected advance (a race with another till) still corrects the queue. */
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

  /** Non-fiscal, so no single-flight guard; refreshes on both paths like {@link #onAdvanceTicketItem}. */
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

  #onShowStation(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "station" });
    else this.#setScreen("station");
  }

  /**
   * Re-boots rather than reading the kind from the event: the device cookie is the source of truth, so
   * the device lands exactly where a cold load would. The dev chooser's embedded join screen stops this
   * event and does not reach here.
   */
  async #onEnrolled(): Promise<void> {
    await this.#boot();
  }

  async #onSwitchDevice(): Promise<void> {
    clearDevDeviceId();
    await this.#boot();
  }

  /** A revoked device cookie: re-boot, which routes the device to the join screen. */
  async #onDeviceUnauthorized(): Promise<void> {
    await this.#boot();
  }

  #onShowExpo(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "expo" });
    else this.#setScreen("expo");
  }

  /**
   * A fresh basket is parked under the store's id; a retrieved one is saved only if edited, never
   * re-parked (see {@link TillApp.#onPlaceOrder}). On success `clear()` re-mints the id, and
   * `cardOutcome` is cleared so a decline never carries over to the next customer.
   */
  async #onParkOrder(event: Event): Promise<void> {
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
        // The Hold field opens blank, so fall back to the stored label rather than wipe it. A typed
        // label is saved only when a line was also edited (docs/backlog.md).
        if (!(await this.#syncIfDirty(id, lines, label ?? this.#store.label))) return;
      } else {
        await this.api.parkOrder({ id, lines, label });
      }
      this.#store.clear();
      this.cardOutcome = undefined;
      await this.#refreshAfterWrite("held", "refresh.held_after_park");
    } catch (error) {
      this.errorKey = counterError(error, "held.park_error");
    } finally {
      this.parking = false;
    }
  }

  /**
   * Loads a parked order under its own id, so a later payment uses the same idempotency key. The held
   * list has no live push, so another till may already have paid or discarded the order: that is a
   * non-fatal `held.stale`, the current basket is untouched, and the list refreshes on both paths.
   * `cardOutcome` is cleared only on success, because only then is the basket replaced.
   */
  async #onRetrieveOrder(event: Event): Promise<void> {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.#loadHeldOrder(id);
    } catch {
      // Paid or discarded on another till; the basket is untouched.
      this.errorKey = "held.stale";
    }
    // Runs on both paths: on success the list is re-read; on the stale race the vanished row drops off.
    await this.#refreshHeldOrders();
  }

  /**
   * A save refused `working_order.out_of_date` was made from a copy another till has since changed
   * (spec §10.7 example 2): the order is loaded again as it now stands, and staff are told, so they
   * make their change again on it. An order closed meanwhile reads as a stale retrieve.
   */
  async #reloadChangedOrder(id: string): Promise<void> {
    try {
      await this.#loadHeldOrder(id);
      this.errorKey = "held.changed_elsewhere";
    } catch {
      this.errorKey = "held.stale";
    }
    await this.#refreshHeldOrders();
  }

  /** Replaces the basket with the open order `id` as stored; a failed read rejects, basket untouched. */
  async #loadHeldOrder(id: string): Promise<void> {
    const order = await this.api.retrieveWorkingOrder(id);
    const lines: OrderLine[] = [];
    let droppedAProduct = false;
    let extraNotOffered = false;
    let mustChooseAgain = false;
    // Indexed once rather than scanned per line; the first entry wins under either key.
    const liveByProduct = new Map<string, TillProduct>();
    const liveByMenuItem = new Map<string, TillProduct>();
    for (const candidate of this.products) {
      if (!liveByProduct.has(candidate.id)) liveByProduct.set(candidate.id, candidate);
      if (candidate.menuItemId !== undefined && !liveByMenuItem.has(candidate.menuItemId))
        liveByMenuItem.set(candidate.menuItemId, candidate);
    }
    for (const line of order.lines) {
      // The snapshot keeps the order's names and price; the offered lists come from today's live
      // offer, which is what an edit has to answer against.
      const live =
        line.menuItemId === undefined
          ? line.productId === undefined
            ? undefined
            : liveByProduct.get(line.productId)
          : liveByMenuItem.get(line.menuItemId);
      const stored = line.product;
      const product =
        stored === undefined
          ? live
          : {
              ...stored,
              ...(live === undefined ? {} : { offeredModifiers: live.offeredModifiers }),
            };
      if (product === undefined) {
        // A legacy product-only line no longer resolves; contextual lines carry their own snapshot.
        droppedAProduct = true;
        continue;
      }
      // Each pick goes back to the list it was taken from, if the live offer still has it there.
      const picks = deriveExtraSelections(product.offeredModifiers ?? [], line.extras);
      if (picks.notOffered.length > 0) extraNotOffered = true;
      // A still-offered list that nothing matched must be answered again: the server refuses the
      // edit until it is, and falling back to the list's default would change what the diner asked for.
      const answers = deriveOptionSelections(product.offeredModifiers ?? [], line.optionSnapshots);
      if (answers.unanswered.length > 0) mustChooseAgain = true;
      lines.push({
        product,
        quantity: displayQuantity(product, line.quantity),
        ...(line.workingOrderLineId === undefined
          ? {}
          : { workingOrderLineId: line.workingOrderLineId }),
        ...(live === undefined ? { notOffered: true as const } : {}),
        ...(picks.extras.length === 0 ? {} : { extras: picks.extras }),
        ...(picks.notOffered.length === 0 ? {} : { notOfferedExtras: picks.notOffered }),
        ...(answers.options.length === 0 ? {} : { options: answers.options }),
        ...(line.optionSnapshots === undefined ? {} : { optionSnapshots: line.optionSnapshots }),
        ...(line.note === undefined ? {} : { note: line.note }),
      });
    }
    // One banner, so a DROPPED product is reported first: it has already changed what the basket
    // will bill, where the other two change nothing until the operator edits the order.
    if (droppedAProduct) this.errorKey = "held.product_gone";
    else if (extraNotOffered) this.errorKey = "held.extra_not_offered";
    else if (mustChooseAgain) this.errorKey = "held.options_changed";
    this.#store.loadFrom(order.id, lines, order.label ?? undefined, order.revision);
    this.cardOutcome = undefined;
  }

  /** A discard already made on another till is a non-fatal `held.stale`; the list refreshes on both paths. */
  async #onDiscardOrder(event: Event): Promise<void> {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.abandonWorkingOrder(id);
    } catch {
      this.errorKey = "held.stale";
    }
    await this.#refreshHeldOrders();
  }

  /**
   * `ticketWorkingOrderId` is captured by every terminal sale path, including a detached split check,
   * which the counter store cannot identify.
   */
  async #onReprint(): Promise<void> {
    if (this.ticketWorkingOrderId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.reprint(this.ticketWorkingOrderId);
    } catch {
      this.errorKey = "reprint.error";
    }
  }

  /** Enqueue the issuance-time ORIGINAL. Only a successful enqueue retires the original action; a
   * failed request stays retryable and never silently turns the next attempt into a duplicate. */
  async #onPrintReceipt(): Promise<void> {
    if (this.ticketWorkingOrderId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.printReceipt(this.ticketWorkingOrderId);
      this.originalReceiptAvailable = false;
    } catch {
      this.errorKey = "receipt.error";
    }
  }

  /** Enqueue the separate card payment slip. Presentation failure cannot affect the filed sale. */
  async #onPaymentSlip(): Promise<void> {
    if (this.ticketWorkingOrderId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.printPaymentSlip(this.ticketWorkingOrderId);
    } catch {
      this.errorKey = "payment_slip.error";
    }
  }

  /**
   * Tries the direct open first and holds no policy or role knowledge, so it stays correct if the drawer
   * policy changes mid-shift; `authorization.not_permitted` opens the supervisor override.
   */
  async #onOpenDrawer(): Promise<void> {
    // A handheld carries a pocket float rather than a register. Keep this independent of its profile's
    // print/drawer capabilities so a synthetic event cannot reach the manual drawer route.
    if (this.handheldMode) return;
    this.errorKey = undefined;
    try {
      await this.api.openDrawer();
    } catch (error) {
      if ((error as { code?: string }).code === "authorization.not_permitted") {
        await this.#openOverrideDialog();
      } else {
        this.errorKey =
          (error as { code?: string }).code === "drawer.not_attached"
            ? "drawer.not_attached"
            : "drawer.error";
      }
    }
  }

  /** The picker is the server's list of authorizers; the client holds no policy or role knowledge. */
  async #openOverrideDialog(): Promise<void> {
    try {
      const authorizers = await this.api.listDrawerAuthorizers();
      this.overrideError = null;
      this.overrideAuthorizers = authorizers;
    } catch {
      this.errorKey = "drawer.error";
    }
  }

  /** `pin.invalid` keeps the dialog open for a retry. The PIN is never stored on the app or logged. */
  async #onOverrideConfirm(event: Event): Promise<void> {
    const { personId, pin } = (event as CustomEvent<{ personId: string; pin: string }>).detail;
    this.overrideError = null; // fresh attempt: clear any prior error so a repeat re-shows
    try {
      await this.api.openDrawer({ personId, pin });
      this.#closeOverrideDialog();
    } catch (error) {
      if ((error as { code?: string }).code === "pin.invalid") {
        this.overrideError = "pin.invalid";
      } else {
        this.#closeOverrideDialog();
        this.errorKey =
          (error as { code?: string }).code === "drawer.not_attached"
            ? "drawer.not_attached"
            : "drawer.error";
      }
    }
  }

  /** Also the cancel handler. */
  #closeOverrideDialog(): void {
    this.overrideAuthorizers = undefined;
    this.overrideError = null;
  }

  /** Clear the completed order and return home, retaining this browser tab's menu preference. */
  #onNewSale(): void {
    this.#store.clear();
    this.ticketWorkingOrderId = undefined;
    this.originalReceiptAvailable = false;
    this.stage = "order";
    this.errorKey = undefined;
    this.cardOutcome = undefined;
    // The home tab is the canvas's first tab (a handheld has no counter tab). After settling a tab the
    // floor is stale, so a floor home refreshes it.
    if (this.#inShell()) {
      const home = this.canvas?.tabs[0];
      this.#setActiveTab(home?.key, true);
      this.#popDrill();
      if (home !== undefined && this.#tabNeedsFloorData(home)) void this.#refreshFloor();
    } else {
      this.#setScreen("counter");
    }
  }

  #onShowSchedule(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "schedule" });
    else this.#setScreen("schedule");
  }

  #onOpenAllergens(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "allergens" });
  }

  #onCloseAllergens(): void {
    if (this.#inShell()) this.#popDrill();
  }

  async #onShowFloor(): Promise<void> {
    this.errorKey = undefined;
    await this.#loadFloorData();
    this.#setScreen("floor");
  }

  /**
   * A shell tab reached through `tab-select` must load the floor itself, or the floor-plan card renders
   * with no table to tap. A failed load leaves the last-known floor.
   */
  async #loadFloorData(): Promise<void> {
    try {
      const [tables, zones, statuses] = await Promise.all([
        this.api.getTablesState(),
        this.api.listZones(),
        this.api.listStatuses(),
      ]);
      this.tables = tables;
      this.zones = zones;
      this.statuses = statuses;
      this.#floorLoaded = true;
    } catch {
      // Non-fatal: the last-known floor stays.
    }
  }

  /** Station and expo cards fetch their own data and table-order loads on the open-table drill, so only
   * the floor cards need app-loaded data. */
  #tabNeedsFloorData(tab: TabDef): boolean {
    return tab.cards.some(
      (card) => card.type === "floor-plan" || card.type === "table-layout-editor",
    );
  }

  /** Select a validated canvas tab and load its floor data when needed. Explicit selection closes the
   * overlay; history restores a permitted regular destination over the tab. The first floor visit
   * loads zones and statuses too, while later visits refresh only live occupancy. */
  #onTabSelect(key: string, fromHistory = false): void {
    const tab = this.canvas?.tabs.find((candidate) => candidate.key === key);
    if (tab === undefined) return;
    this.#setActiveTab(key, fromHistory, fromHistory);
    if (fromHistory) this.#restoreDestination();
    else if (this.drill !== undefined) this.#popDrill();
    if (this.#tabNeedsFloorData(tab)) {
      if (this.#floorLoaded) void this.#refreshFloor();
      else void this.#loadFloorData();
    }
  }

  /** Tables only: a placement write changes neither the zones nor the statuses. */
  async #refreshFloor(): Promise<void> {
    try {
      this.tables = await this.api.getTablesState();
    } catch {
      // Non-fatal: the last-known floor stays.
    }
  }

  /** A free table opens a fresh tab; an occupied one resumes {@link TableState.tabId}. */
  async #onOpenTable(event: Event): Promise<void> {
    const { tableId, hasOpenTab } = (event as CustomEvent<{ tableId: string; hasOpenTab: boolean }>)
      .detail;
    const offerRequest = ++this.#tableOfferRequest;
    this.errorKey = undefined;
    const table = this.tables.find((candidate) => candidate.id === tableId);
    if (table?.zoneId !== null && table?.zoneId !== undefined) {
      try {
        const { menus, offers, defaultMenuId } = await this.api.listZoneOffers(table.zoneId);
        if (offerRequest !== this.#tableOfferRequest) return;
        this.tableProducts = offers.map(menuOfferToTillProduct);
        this.tableMenus = menus;
        this.tableSelectedCatalogueId = defaultMenuId ?? this.#defaultCatalogueId(menus);
      } catch {
        if (offerRequest !== this.#tableOfferRequest) return;
        this.tableProducts = [];
        this.tableMenus = [];
        this.tableSelectedCatalogueId = "";
        this.errorKey = "table.error";
        return;
      }
    } else {
      this.tableProducts = [];
      this.tableMenus = [];
      this.tableSelectedCatalogueId = "";
    }
    // `set-status` is keyed by table id, so it is remembered alongside the tab's order id.
    this.activeTableId = tableId;
    if (hasOpenTab) {
      this.activeTabId = table?.tabId;
    } else {
      const { tabId } = await this.api.openTab(tableId);
      this.activeTabId = tabId;
    }
    await this.#loadTabLines();
    // A canvas that authors a `table-order` card (handheld, tablet) switches to that tab; a till drills
    // in over the floor tab. Off the shell, only the lock screen is reached here, by a logout that lands
    // while the tab is opening.
    if (this.#inShell()) {
      const orderTabKey = this.#tableOrderTabKey();
      if (orderTabKey !== undefined)
        this.#setActiveTab(orderTabKey); // card mount (handheld/tablet)
      else this.#pushDrill({ kind: "table-order" }); // drill mount (till)
    } else if (this.screen !== "lock") {
      // A late answer must not unlock a logged-out till.
      this.#setScreen("table-order");
    }
  }

  /** A failed read, or no tab id, leaves an empty tab rather than blocking the operator. */
  async #loadTabLines(): Promise<void> {
    if (this.activeTabId === undefined) {
      this.tabLines = [];
      return;
    }
    try {
      this.tabLines = (await this.api.getTabLines(this.activeTabId)).lines;
    } catch {
      this.tabLines = [];
    }
  }

  async #onSendRound(event: Event): Promise<void> {
    const { lines } = (event as CustomEvent<{ lines: RoundLine[] }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.addTabRound(this.activeTabId, lines);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    await this.#loadTabLines();
  }

  async #onFireCourse(event: Event): Promise<void> {
    const { courseId } = (event as CustomEvent<{ orderId?: string; courseId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.fireCourse(this.activeTabId, courseId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    await this.#loadTabLines();
  }

  async #onServeLine(event: Event): Promise<void> {
    const { lineNo } = (event as CustomEvent<{ lineNo: number }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.markLineServed(this.activeTabId, lineNo);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    await this.#loadTabLines();
  }

  /** The reload runs on both paths: after a raced `ticket.already_fired` the line is fired, and
   * re-reading reconciles the picker. */
  async #onSetLineCourse(event: Event): Promise<void> {
    const { lineNo, courseId } = (event as CustomEvent<{ lineNo: number; courseId: string | null }>)
      .detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.setLineCourse(this.activeTabId, lineNo, courseId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
    await this.#loadTabLines();
  }

  /** `lineNos: []` sends every held line. The reload runs on both paths, as in {@link #onRecallLines}. */
  async #onSendLines(event: Event): Promise<void> {
    const { lineNos } = (event as CustomEvent<{ lineNos: number[] }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.sendLines(this.activeTabId, lineNos);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
    await this.#loadTabLines();
  }

  /**
   * The reload runs on both paths: after a raced `ticket.already_started` the line has started, and
   * re-reading turns its Recall into Cancel.
   */
  async #onRecallLines(event: Event): Promise<void> {
    const { lineNos } = (event as CustomEvent<{ lineNos: number[] }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.recallLines(this.activeTabId, lineNos);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
    await this.#loadTabLines();
  }

  /** Already confirmed on the screen. The reload runs on both paths, as in {@link #onRecallLines}. */
  async #onVoidLine(event: Event): Promise<void> {
    const { lineNo } = (event as CustomEvent<{ lineNo: number }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.voidLine(this.activeTabId, lineNo);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
    await this.#loadTabLines();
  }

  /** Keyed by {@link activeTableId}, not the tab's order id. */
  async #onSetStatus(event: Event): Promise<void> {
    const { statusId } = (event as CustomEvent<{ statusId: string | null }>).detail;
    if (this.activeTableId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.setTableStatus(this.activeTableId, statusId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
  }

  /** Re-reads occupancy without leaving the screen. Unlike {@link #refreshFloor}, a failed read
   * empties the floor. */
  async #reloadTables(): Promise<void> {
    try {
      this.tables = await this.api.getTablesState();
    } catch {
      this.tables = [];
    }
  }

  /** The tab now lives on the new table, so it becomes {@link activeTableId}. */
  async #onMoveTab(event: Event): Promise<void> {
    const { toTableId } = (event as CustomEvent<{ toTableId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.moveTab(this.activeTabId, toTableId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    this.activeTableId = toTableId;
    await this.#reloadTables();
  }

  async #onJoinTable(event: Event): Promise<void> {
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.joinTable(this.activeTabId, tableId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    await this.#reloadTables();
  }

  async #onMergeTabs(event: Event): Promise<void> {
    const { fromTabId, freeSourceTable } = (
      event as CustomEvent<{ fromTabId: string; freeSourceTable: boolean }>
    ).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.mergeTabs(this.activeTabId, fromTabId, freeSourceTable);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    // Each read swallows its own error.
    await Promise.all([this.#loadTabLines(), this.#reloadTables()]);
  }

  async #onTransferLines(event: Event): Promise<void> {
    const { toTabId, transfers } = (
      event as CustomEvent<{ toTabId: string; transfers: TabTransfer[] }>
    ).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.transferLines(this.activeTabId, toTabId, transfers);
    } catch (error) {
      this.errorKey = tableWriteError(error);
      return;
    }
    // Each read swallows its own error.
    await Promise.all([this.#loadTabLines(), this.#reloadTables()]);
  }

  /** Carve selected tab lines into a detached check, then point the existing table payment screen at
   * that check. The origin table id stays captured so its label continues to identify this split bill. */
  async #onSplitLines(event: Event): Promise<void> {
    const { transfers } = (event as CustomEvent<{ transfers: TabTransfer[] }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      const { checkId } = await this.api.splitTab(this.activeTabId, transfers);
      this.activeTabId = checkId;
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.errorKey =
        code === "tab.transfer_modifier_line"
          ? "table.split_modifier_error"
          : code === "tab.split_held_line"
            ? "table.split_held_error"
            : tableWriteError(error);
      return;
    }
    await Promise.all([this.#loadTabLines(), this.#reloadTables()]);
  }

  /**
   * The tab is an open working order, so `recordSale` files its stored lines and ignores the basket: `[]`
   * is sent and `#syncIfDirty` is deliberately skipped, because saving would re-price the tab's add-time
   * lines. Shares `submitting` with {@link #onConfirmPayment}.
   */
  async #onPayTab(event: Event): Promise<void> {
    if (this.submitting || this.activeTabId === undefined) return;
    this.submitting = true;
    const id = this.activeTabId;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    this.errorKey = undefined;
    try {
      this.result = await this.api.recordSale([], tender, id);
      this.#showTicket(id);
    } catch (error) {
      // No preliminary save, so any network failure may have filed.
      this.errorKey = isPermanentSaleRefusal(error)
        ? "sale.refused"
        : isNetworkFailure(error)
          ? "sale.unconfirmed"
          : "sale.error";
    } finally {
      this.submitting = false;
    }
  }

  /**
   * Refuses a screen outside {@link HANDHELD_FACES} for a handheld. Only the no-shell arm of
   * {@link #onBackToCounter} calls it: inside the shell a handheld has no counter tab, and
   * {@link #pushDrill} refuses its station, expo and schedule drill-ins because
   * {@link #affordances} gives it none. The no-shell arms of the other counter-side handlers call
   * {@link #setScreen} unchecked.
   */
  #goToScreen(target: Screen): void {
    if (this.handheldMode && !HANDHELD_FACES.includes(target)) return;
    this.#setScreen(target);
  }

  /** Every face change goes through here, so the diagnostics trail records it. */
  #setScreen(screen: Screen): void {
    diag.record("info", "nav", { screen });
    this.screen = screen;
  }

  /**
   * The else-arms that set `screen` are also reached by an async handler whose answer arrives after
   * logout, and setting `screen` there takes the till off the lock screen, which is why
   * {@link #showTicket} and {@link #onOpenTable} check for `lock` first. {@link #onShowFloor} does
   * not (docs/backlog.md, "Till code that no test can reach").
   */
  #inShell(): boolean {
    return this.canvas !== undefined && this.#shellActive();
  }

  /** Records the same `nav` trail as {@link #setScreen}. */
  #pushDrill(drill: Drill): void {
    if (isTillDestination(drill.kind)) {
      if (!this.#allowsDestination(drill.kind)) return;
      this.#url.write({ "till-view": drill.kind, "till-station": null });
    }
    diag.record("info", "nav", { screen: drill.kind });
    this.drill = drill;
  }

  /** Records the `nav` trail for the tab it returns to. */
  #popDrill(): void {
    if (isTillDestination(this.drill?.kind))
      this.#url.write({ "till-view": null, "till-station": null });
    diag.record("info", "nav", { screen: this.activeTabKey });
    this.drill = undefined;
  }

  #showTicket(workingOrderId: string, invoiceIssuedNow = true): void {
    this.ticketWorkingOrderId = workingOrderId;
    this.originalReceiptAvailable = invoiceIssuedNow && this.receiptPrintMode !== "auto";
    if (this.#inShell()) this.#pushDrill({ kind: "ticket" });
    // A late answer must not unlock a logged-out till.
    else if (this.screen !== "lock") this.#setScreen("ticket");
  }

  /** A handheld's canvas has no counter tab, so inside the shell it shows its first tab instead. */
  #onBackToCounter(): void {
    this.errorKey = undefined;
    if (this.#inShell()) {
      this.#setActiveTab("counter");
      this.#popDrill();
    } else {
      this.#goToScreen("counter");
    }
  }

  /**
   * Inside the shell only a till reaches this: a handheld's order tab is `embedded` and emits no
   * `back-to-floor`. Neither `openTab` nor a round updates `.tables`, so a bare pop would show the
   * just-opened table as free.
   */
  #onBackToFloor(): void {
    if (this.#inShell()) {
      this.errorKey = undefined;
      this.#popDrill();
      void this.#refreshFloor();
    } else {
      void this.#onShowFloor();
    }
  }

  /** Keeps the basket: it belongs to the till. */
  async #onLogout(): Promise<void> {
    // Lock locally first: a rejecting or hanging `api.logout()` (offline, failover) must never leave
    // the till unlocked. The server logout is best-effort.
    this.operatorName = "";
    this.canEdit = false;
    // `screen = "lock"` resets neither the drill nor the tab.
    this.drill = undefined;
    this.#setActiveTab(this.canvas?.tabs[0]?.key, true);
    this.#url.write({ "till-zone": null }, true);
    this.#floorLoaded = false;
    this.errorKey = undefined;
    this.#abandonListRefreshes();
    this.#setScreen("lock");
    this.#configureSessionActivity();
    try {
      await this.api.logout();
    } catch {
      // The device is already locked locally.
    }
    // After the round trip, so guarded: a detached till must not change a live sibling's module-global
    // locale.
    if (!this.isConnected) return;
    setLocale(this.#venueLocale);
  }

  /**
   * Before login, or on a kitchen display, a pick only switches the UI: there is no session to save it
   * to. Logged in, the preference is saved first and the UI switches only after that succeeds.
   */
  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "lock" || this.deviceMode) {
      setLocale(code);
      return;
    }
    this.errorKey = undefined;
    try {
      await this.api.putLocale(code);
      // The preference is saved; a detached till skips only the local repaint.
      if (!this.isConnected) return;
      setLocale(code);
    } catch {
      this.errorKey = "locale.save_failed";
    }
  }

  /** The front-door screens are handled ahead of this in {@link render}, and guarded here too so the
   * predicate does not depend on render order. */
  #shellActive(): boolean {
    return this.screen !== "lock" && this.frontDoor === undefined;
  }

  /** Falls back to the first tab, so a stale key never leaves the shell without a body. */
  #activeTab(): TabDef | undefined {
    return this.canvas?.tabs.find((tab) => tab.key === this.activeTabKey) ?? this.canvas?.tabs[0];
  }

  #tableOrderTabKey(): string | undefined {
    return this.canvas?.tabs.find((tab) => tab.cards.some((card) => card.type === "table-order"))
      ?.key;
  }

  /**
   * Station, Expo and Schedule surfaces not authored as tabs, offered as buttons. A handheld gets none:
   * it cannot open any of them.
   */
  #affordances(): ShellAffordance[] {
    if (this.handheldMode) return [];
    const tabKeys = new Set(this.canvas?.tabs.map((tab) => tab.key) ?? []);
    return (["station", "expo", "schedule"] as ShellAffordance[]).filter((a) => !tabKeys.has(a));
  }

  #tabBody(tab: TabDef): TemplateResult {
    if (tab.key === "counter") {
      // `embedded`: the shell owns the header.
      return html`<till-counter-screen
        embedded
        .api=${this.api}
        .store=${this.#store}
        .products=${this.products}
        .menus=${this.menus}
        .selectedMenuId=${this.selectedCatalogueId}
        .serviceZones=${this.counterServiceZones}
        .selectedServiceZoneId=${this.counterServiceZoneId}
        .selectedDiet=${this.selectedDiet}
        .heldOrders=${this.heldOrders}
        .stationQueue=${this.stationQueue}
        .defaultStationId=${this.#defaultStationId()}
        .operatorName=${this.operatorName}
        .invoiceLocale=${this.invoiceLocale}
        .orderFlow=${this.orderFlow}
        .stage=${this.stage}
        .busy=${this.submitting || this.placing}
        .counterTab=${tab}
        .cardProvider=${this.cardProvider}
        .tipsEnabled=${this.tipsEnabled}
        .cardOutcome=${this.cardOutcome}
        .activeReaders=${this.activeReaders}
        .defaultReaderId=${this.defaultReaderId}
      ></till-counter-screen>`;
    }
    return html`<till-card-grid
      .tab=${tab}
      .store=${this.#store}
      .capabilities=${this.capabilities}
      .canConfigureTill=${this.canEdit}
      .products=${tab.key === this.#tableOrderTabKey() ? this.tableProducts : this.products}
      .heldOrders=${this.heldOrders}
      .stationQueue=${this.stationQueue}
      .defaultStationId=${this.#defaultStationId()}
      .busy=${this.submitting}
      .orderFlow=${this.orderFlow}
      .stage=${this.stage}
      .cardProvider=${this.cardProvider}
      .tipsEnabled=${this.tipsEnabled}
      .cardOutcome=${this.cardOutcome}
      .activeReaders=${this.activeReaders}
      .defaultReaderId=${this.defaultReaderId}
      .api=${this.api}
      .fireControl=${this.fireControl}
      .zones=${this.zones}
      .tables=${this.tables}
      .bumpMode=${this.bumpMode}
      .deviceMode=${this.deviceMode}
      .initialDeviceStation=${this.initialDeviceStation}
      .menus=${tab.key === this.#tableOrderTabKey() ? this.tableMenus : this.menus}
      .selectedMenuId=${
        tab.key === this.#tableOrderTabKey()
          ? this.tableSelectedCatalogueId
          : this.selectedCatalogueId
      }
      .selectedDiet=${this.selectedDiet}
      .statuses=${this.statuses}
      .courses=${this.courses}
      .tabLines=${this.tabLines}
      .orderId=${this.activeTabId}
    ></till-card-grid>`;
  }

  #activeTabBody(): TemplateResult | typeof nothing {
    const tab = this.#activeTab();
    return tab !== undefined ? this.#tabBody(tab) : nothing;
  }

  /** Drill-ins mount non-embedded, so each keeps its own Back or Close; an `embedded` mount would trap
   * the user with no way out. */
  #drillBody(): TemplateResult | typeof nothing {
    switch (this.drill?.kind) {
      case "table-order":
        return html`<till-table-order-screen
          slot="drill"
          .lines=${this.tabLines}
          .products=${this.tableProducts}
          .menus=${this.tableMenus}
          .selectedMenuId=${this.tableSelectedCatalogueId}
          .selectedDiet=${this.selectedDiet}
          .statuses=${this.statuses}
          .courses=${this.courses}
          .fireControl=${this.fireControl}
          .tables=${this.tables}
          .orderId=${this.activeTabId}
          .busy=${this.submitting}
        ></till-table-order-screen>`;
      case "ticket":
        return html`<till-ticket-view
          slot="drill"
          .result=${this.result}
          .issuer=${this.issuer}
          .invoiceLocale=${this.invoiceLocale}
          .receipt=${this.receipt}
          .originalReceiptAvailable=${this.originalReceiptAvailable}
          .canPrintReceipt=${
            this.deviceId === undefined || this.capabilities.includes("print-receipt")
          }
          .canOpenDrawer=${!this.handheldMode}
          .simulated=${this.onboardingIntent === "demo" || this.onboardingIntent === "prepare"}
        ></till-ticket-view>`;
      case "schedule":
        return html`<till-schedule-screen
          slot="drill"
          .api=${this.api}
          .staff=${this.staff}
          .operatorPersonId=${this.operatorPersonId}
        ></till-schedule-screen>`;
      case "station":
        return html`<till-station-screen
          slot="drill"
          .api=${this.api}
          .bumpMode=${this.bumpMode}
          .fireControl=${this.fireControl}
          .deviceMode=${this.deviceMode}
          .initialDeviceStation=${this.initialDeviceStation}
        ></till-station-screen>`;
      case "expo":
        return html`<till-expo-screen
          slot="drill"
          .api=${this.api}
          .fireControl=${this.fireControl}
        ></till-expo-screen>`;
      case "allergens":
        return html`<till-allergen-screen
          slot="drill"
          .products=${this.products}
          .locale=${currentLocale()}
          .invoiceLocale=${this.invoiceLocale}
        ></till-allergen-screen>`;
      case undefined:
        return nothing;
    }
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
        @enrolled=${() => void this.#onEnrolled()}
        @switch-device=${() => void this.#onSwitchDevice()}
        @device-unauthorized=${() => void this.#onDeviceUnauthorized()}
        @show-expo=${() => this.#onShowExpo()}
        @park-order=${(event: Event) => void this.#onParkOrder(event)}
        @retrieve-order=${(event: Event) => void this.#onRetrieveOrder(event)}
        @discard-order=${(event: Event) => void this.#onDiscardOrder(event)}
        @new-sale=${() => this.#onNewSale()}
        @reprint=${() => void this.#onReprint()}
        @print-receipt=${() => void this.#onPrintReceipt()}
        @payment-slip=${() => void this.#onPaymentSlip()}
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
        @set-line-course=${(event: Event) => void this.#onSetLineCourse(event)}
        @send-lines=${(event: Event) => void this.#onSendLines(event)}
        @recall-lines=${(event: Event) => void this.#onRecallLines(event)}
        @void-line=${(event: Event) => void this.#onVoidLine(event)}
        @set-status=${(event: Event) => void this.#onSetStatus(event)}
        @move-tab=${(event: Event) => void this.#onMoveTab(event)}
        @join-table=${(event: Event) => void this.#onJoinTable(event)}
        @merge-tabs=${(event: Event) => void this.#onMergeTabs(event)}
        @transfer-lines=${(event: Event) => void this.#onTransferLines(event)}
        @split-lines=${(event: Event) => void this.#onSplitLines(event)}
        @pay-tab=${(event: Event) => void this.#onPayTab(event)}
        @back-to-floor=${() => this.#onBackToFloor()}
        @back-to-counter=${() => this.#onBackToCounter()}
        @open-allergens=${() => this.#onOpenAllergens()}
        @close-allergens=${() => this.#onCloseAllergens()}
        @logout=${() => void this.#onLogout()}
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
        @diet-filter-selected=${(e: CustomEvent<{ predicate: DietPredicate | null }>) =>
          this.#selectDiet(e.detail.predicate)}
        @counter-zone-selected=${(event: Event) => void this.#onCounterZoneSelected(event)}
        @menu-selected=${(e: CustomEvent<{ id: string }>) => this.#onMenuSelected(e)}
      >
        ${
          this.onboardingIntent === undefined
            ? nothing
            : html`<p class="mode-indicator" data-test="mode-indicator">
                ${t(`mode.${this.onboardingIntent}`)}
              </p>`
        }
        ${
          this.errorKey
            ? html`<p class="error" role="alert">
                ${
                  typeof this.errorKey === "string"
                    ? t(this.errorKey)
                    : codeMessage(this.errorKey.code)
                }
              </p>`
            : nothing
        }
        ${this.#renderRefreshNotice("held")} ${this.#renderRefreshNotice("station")}
        <!-- The waiting-for-promotion banner (till-reroute §4.4). On the shell surface (an operator
             mid-shift), the lock-screen's own status line is not visible, so the shell surfaces the same
             server.waiting_promotion copy compactly here while the router reports no server is accepting
             sales. Gated on the shell surface so it never double-renders beside the lock screen's own line. -->
        ${
          this.#inShell() && (this.router?.waiting ?? false)
            ? html`<p class="banner" role="status">${t("server.waiting_promotion")}</p>`
            : nothing
        }
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
        <!-- The device FRONT DOOR (device-enrolment §3.1), shown ahead of the shell/lock so it takes
             precedence over whatever screen the boot left set. The chooser is the dev-only device picker
             (its enrolled event is handled INSIDE the chooser — a dev-tab adopt, not the app's re-boot);
             the enrol screen is the join screen a fresh production browser shows, whose enrolled event
             (wired above) re-boots into the matching shell. -->
        ${
          this.frontDoor === "chooser"
            ? html`<till-device-chooser
                .api=${this.api}
                .list=${this.devDevices}
              ></till-device-chooser>`
            : this.frontDoor === "enrol"
              ? html`<till-enrol-screen .api=${this.api}></till-enrol-screen>`
              : // Keyed on the locale, so a switch rebuilds the subtree in the new language; the
                // screens hold no locale controller of their own. The lock screen also shows after a
                // boot failure, rather than an empty shell.
                this.#inShell()
                ? keyed(
                    currentLocale(),
                    html`<till-tab-shell
                      .tabs=${this.canvas?.tabs ?? []}
                      .activeTabKey=${this.activeTabKey}
                      .operatorName=${this.operatorName}
                      .affordances=${this.#affordanceList}
                      .kiosk=${this.deviceMode}
                      .loadLocales=${this.#loadLocales}
                      @tab-select=${(e: CustomEvent<{ key: string }>) => {
                        this.#onTabSelect(e.detail.key);
                      }}
                    >
                      ${this.#activeTabBody()}
                      ${this.#drillBody() /* the drill overlay, when one is open */}
                    </till-tab-shell>`,
                  )
                : keyed(
                    currentLocale(),
                    html`<till-lock-screen
                      .api=${this.api}
                      .deviceName=${this.deviceName}
                      .deviceId=${this.deviceId}
                      .devMode=${this.devTab}
                      .serverStatuses=${this.router?.statuses() ?? []}
                      .serverCurrent=${this.router?.current ?? ""}
                      .serverWaiting=${this.router?.waiting ?? false}
                      @check-again=${() => void this.router?.probeNow()}
                    ></till-lock-screen>`,
                  )
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-app": TillApp;
  }
}
