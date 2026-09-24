import { dashboardPath } from "./navigation.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, UrlStateController, type WtToast } from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-toast.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeOf, codeMessage } from "./i18n/codes.js";
import { setContentLanguages } from "@waitron/ui";
import { DashboardQueries } from "./api/query-controller.js";
import { diag } from "./diagnostics.js";
import type { StringKey } from "./i18n/strings.js";
// Modules are mounted generically from the browser-safe registry, never named here. `tKit` is the
// kit's untyped resolver: a module's label keys are not in the app's `StringKey` union.
import {
  registerCatalogue,
  t as tKit,
  type DashboardContribution,
  type DashboardRequest,
  type DashboardScreenHandle,
  type NavGroupId,
} from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { LocaleChangeController } from "./state/locale-controller.js";
import "./widgets/language-chooser.js";
import "./screens/login-screen.js";
import "./screens/profile-screen.js";
import type { ProfileScreen } from "./screens/profile-screen.js";
import "./screens/my-schedule-screen.js";
import "./screens/dashboard-overview-screen.js";
import "./screens/dashboard-sales-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/categories-screen.js";
import "./screens/modifiers-screen.js";
import "./screens/units-screen.js";
import "./screens/receipt-screen.js";
import "./screens/location-settings-screen.js";
import "./screens/service-status-screen.js";
import "./screens/floor-screen.js";
import "./screens/kitchen-screen.js";
import "./screens/roster-screen.js";
import "./screens/approvals-screen.js";
import "./screens/planned-actual-screen.js";
import "./screens/purchases-screen.js";
import "./screens/devices-screen.js";
import "./screens/printers-screen.js";
import "./screens/printing-rules-screen.js";
import "./screens/canvas-editor-screen.js";
import "./screens/device-profiles-screen.js";
import "./screens/diagnostics-screen.js";
import "./screens/backup-screen.js";
import "./screens/cloud-services-screen.js";
import "./screens/email-screen.js";
import "./screens/payments-screen.js";
import "./screens/alerts-screen.js";
import "./widgets/alerts-bell.js";
import type { AlertsBell } from "./widgets/alerts-bell.js";
import { alertMessage } from "./i18n/alerts.js";
import { AlertArrivals } from "./state/alert-arrivals.js";
import { markAlertHandled } from "./widgets/alert-format.js";
import type { AlertView, AlertsResponse, DashboardApi, PersonRole } from "./api/client.js";
import {
  consumeGoogleLoginPreference,
  rememberSuccessfulLogin,
  type LoginMethod,
  type PendingLoginPreference,
} from "./login-preference.js";

/**
 * "Your profile" is not a `CoreScreen`: it is a modal ({@link profileOpen}) over whichever face is
 * current, reached from the banner's account menu.
 */
type CoreScreen =
  | "login"
  | "my-schedule"
  | "overview"
  | "sales"
  | "staff"
  | "categories"
  | "catalogue"
  | "modifiers"
  | "units"
  | "receipt"
  | "location-settings"
  | "statuses"
  | "floor"
  | "kitchen"
  | "roster"
  | "approvals"
  | "planned-actual"
  | "purchases"
  | "devices"
  | "printers"
  | "printing-rules"
  | "canvas-editor"
  | "device-profiles"
  | "diagnostics"
  | "backup"
  | "cloud"
  | "email"
  | "payments"
  | "alerts";

/** The `& {}` keeps the `CoreScreen` literal autocomplete while admitting any module id. */
type ScreenId = CoreScreen | (string & {});

/** Also written as a literal in the CSS `@media` block below: a media query cannot read a custom
 * property. */
const DRAWER_BREAKPOINT = "(max-width: 48rem)";

const WAITRON_LOGO_URL = new URL("../../../packages/ui/brand/waitron-lockup.svg", import.meta.url)
  .href;

type NavItem = { screen: ScreenId; labelKey: StringKey; requiresManager?: boolean };
type NavGroup = { id: NavGroupId; headerKey?: StringKey; icon?: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "reports",
    items: [
      { screen: "overview", labelKey: "nav.overview" },
      { screen: "sales", labelKey: "nav.sales" },
    ],
  },
  {
    id: "menu",
    headerKey: "nav.group.menu",
    items: [
      { screen: "catalogue", labelKey: "nav.catalogue" },
      { screen: "categories", labelKey: "nav.categories" },
      { screen: "modifiers", labelKey: "nav.modifiers", requiresManager: true },
      { screen: "units", labelKey: "nav.units" },
    ],
  },
  {
    id: "service",
    headerKey: "nav.group.service",
    items: [
      { screen: "floor", labelKey: "nav.floor" },
      { screen: "statuses", labelKey: "nav.statuses" },
      { screen: "kitchen", labelKey: "nav.kitchen" },
    ],
  },
  {
    id: "team",
    headerKey: "nav.group.team",
    items: [
      { screen: "staff", labelKey: "nav.staff" },
      { screen: "roster", labelKey: "nav.roster" },
      { screen: "approvals", labelKey: "nav.approvals" },
      { screen: "planned-actual", labelKey: "nav.planned_actual" },
    ],
  },
  {
    id: "purchasing",
    headerKey: "nav.group.purchasing",
    items: [{ screen: "purchases", labelKey: "nav.purchases" }],
  },
  {
    id: "configuration",
    headerKey: "nav.group.configuration",
    icon: "gear",
    items: [
      { screen: "receipt", labelKey: "nav.receipt" },
      { screen: "location-settings", labelKey: "nav.location_settings", requiresManager: true },
      { screen: "devices", labelKey: "nav.devices" },
      { screen: "printers", labelKey: "nav.printers" },
      { screen: "printing-rules", labelKey: "nav.printing_rules" },
      { screen: "payments", labelKey: "nav.payments", requiresManager: true },
      { screen: "canvas-editor", labelKey: "nav.canvases" },
      { screen: "device-profiles", labelKey: "nav.device_profiles" },
      { screen: "diagnostics", labelKey: "nav.diagnostics", requiresManager: true },
      { screen: "backup", labelKey: "nav.backup", requiresManager: true },
      { screen: "cloud", labelKey: "nav.cloud", requiresManager: true },
      { screen: "email", labelKey: "nav.email", requiresManager: true },
    ],
  },
];

/**
 * Owns session discovery, permitted URL navigation and language preferences.
 * The login screen stays visible until getMe confirms a session. Staff have their own
 * schedule and profile; other roles can restore a destination from their visible sidebar entries.
 *
 * A locale change recreates the screen subtree so translated text updates. Disconnect guards
 * prevent late responses from changing browser history or the shared locale after teardown.
 * Each screen owns its heading; the shell supplies navigation, logout and the language chooser.
 */
@customElement("dashboard-app")
export class DashboardApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        /* Sidebar column width — a documented LOCAL custom property, not design-system chrome.
           Override it on the host to reflow. Expressed in ch (not rem/em, not a pixel guess) so the
           column tracks its own nav text; the responsive drawer (Task 12) layers over this. */
        --dashboard-sidebar-width: 18ch;
      }

      /* The banner owns the first full-width row; navigation and content share the row below it.
         A firm height (not min-height) bounds the shell to exactly one screen, so overflow below
         the banner has to happen INSIDE .sidebar/.main (each scrolls independently) rather than by
         growing the whole page — see .sidebar and .main below. */
      .shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }

      /* Two-column app chrome below the banner: a fixed-width sidebar beside the main column. */
      .layout {
        display: flex;
        position: relative;
        flex: 1 1 auto;
        align-items: stretch;
        min-height: 0;
      }

      /* The desktop sidebar: fixed width, scrolls vertically on its own when the nav is tall.
         max-height is relative to .layout's now-bounded cross size (via .shell's firm height), not
         a flat 100vh guess — a flat 100vh ignored the banner's own height, so on a page taller than
         one screen the sidebar capped out short of where .main actually ended. */
      .sidebar {
        flex: 0 0 var(--dashboard-sidebar-width);
        box-sizing: border-box;
        max-height: 100%;
        overflow-y: auto;
        padding: var(--wt-space-3);
        border-right: 1px solid var(--wt-color-border);
      }

      /* One vertical stack of grouped nav items. */
      .nav {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      /* Group header: a toggle button (collapses/expands its own items), small caps (uppercase,
         letter-spacing) — makes it unmistakably a label rather than a fainter link, which plain
         small+muted text didn't. Uses the primary accent rather than muted grey so
         it doesn't read as the same weight of "quiet" as a resting nav item beneath it; sharing the
         accent hue with the current-page indicator is fine here because a header is never itself the
         current page, so there's no ambiguity about what the colour is pointing at. */
      .nav-group {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        width: 100%;
        min-height: var(--wt-tap-min);
        margin: var(--wt-space-2) 0 0;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--wt-color-primary);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        text-align: start;
        cursor: pointer;
      }

      .nav-group:hover {
        background: var(--wt-color-surface);
      }

      /* Points down at rest ("expand downward"); rotated to point up when expanded ("collapse"),
         matching the direction its own panel of items opens in. */
      .nav-group .chevron {
        flex-shrink: 0;
        transition: transform 150ms ease;
      }

      .nav-group[aria-expanded="true"] .chevron {
        transform: rotate(180deg);
      }

      /* A flat nav row, not a button: no border/background box, so a list of ~20 of these reads as
         navigation rather than a stack of buttons. Resting items are muted, not full-strength text —
         at equal weight and colour they competed with the group headers above and buried the
         current page's accent in a crowd of equally dark siblings. The selected-item treatment
         (accent edge + bold coloured text, no fill) mirrors wt-tabs' own selected state — same idiom,
         vertical instead of horizontal — and is now the one loud thing in an otherwise calm list. */
      .nav-item {
        display: block;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: none;
        border-inline-start: 3px solid transparent;
        background: transparent;
        color: var(--wt-color-text-muted);
        font: inherit;
        font-weight: var(--wt-font-weight-normal);
        text-align: start;
        cursor: pointer;
      }

      .nav-item:hover {
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .nav-item[aria-current="page"] {
        border-inline-start-color: var(--wt-color-primary);
        color: var(--wt-color-primary);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The content column beside the sidebar — scrolls independently, the same as .sidebar above,
         so a tall screen never grows the outer page past one viewport (that used to leave the
         shorter sidebar looking cut off next to a taller .main). */
      .main {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        max-height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      .brand-banner {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
      }

      .brand-identity {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        min-width: 0;
        gap: var(--wt-space-3);
      }

      .brand-logo {
        display: block;
        flex: 0 0 auto;
        width: calc(var(--wt-space-6) * 4);
        height: auto;
      }

      .venue {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .venue-name {
        /* A floor, not zero: unbounded, this flex item was the only shrinkable thing in
           .brand-identity, so a narrow banner could squeeze it down to a couple of pixels wide —
           and overflow-wrap: anywhere then wrapped every single CHARACTER onto its own line rather
           than at word boundaries, a tall unreadable column instead of a couple of ordinary lines.
           overflow-wrap: anywhere stays as the guard for a single word longer than this floor. */
        min-width: 8ch;
        padding-inline-start: var(--wt-space-3);
        border-inline-start: 1px solid var(--wt-color-border);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .mode-indicator {
        flex: 0 0 auto;
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .banner-actions {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        margin-inline-start: auto;
      }

      /* The pop-up hangs off the banner's real bottom edge, whatever the page margin or banner height. */
      .banner-row {
        position: relative;
      }

      .alert-toast {
        position: absolute;
        inset-block-start: calc(100% + var(--wt-space-2));
        inset-inline-end: var(--wt-space-3);
        z-index: 40;
        max-width: calc(100% - 2 * var(--wt-space-3));
      }

      /* The hamburger that opens the off-canvas drawer. Hidden at desktop width (the sidebar is always
         in-flow there); the narrow-screen media query below reveals it at the banner's leading edge. */
      .nav-toggle {
        display: none;
      }

      /* The veil behind the open drawer: it covers the content row below the banner and closes the
         drawer on a tap. It sits under the sliding sidebar but over the main content. */
      .scrim {
        position: absolute;
        inset: 0;
        z-index: 20;
        background: var(--wt-color-scrim);
      }

      .body {
        padding: var(--wt-space-4);
        padding-bottom: calc(
          var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom)
        );
      }

      /* Narrow screens (a phone or a split view): the sidebar becomes an off-canvas DRAWER inside the
         content row, below the banner. It leaves the flow and slides in when the layout gains
         the drawer-open class; the hamburger appears to toggle it. A CSS media query cannot read a
         --custom-property, so the breakpoint is a literal here (and mirrored in the JS DRAWER_BREAKPOINT
         constant that drives the narrow state); 48rem matches the existing repo precedent in
         apps/till/src/screens/till-counter-screen.ts:111. */
      @media (max-width: 48rem) {
        /* A phone cannot fit the lockup, the legal name, the mode pill and both menus on one line, so
           the name and pill take a second row and the menus stay at the trailing edge of the first.
           The lockup's column is the one that shrinks, so the menus keep the first row. */
        .brand-banner {
          display: grid;
          grid-template-columns: auto minmax(0, max-content) 1fr auto;
          grid-template-areas:
            "toggle logo . actions"
            "venue venue venue venue";
          gap: var(--wt-space-2) 0;
        }
        .brand-identity {
          display: contents;
        }
        .nav-toggle {
          display: inline-block;
          grid-area: toggle;
          margin-inline-end: var(--wt-space-3);
        }
        .brand-logo {
          grid-area: logo;
          max-width: 100%;
        }
        .banner-actions {
          grid-area: actions;
          margin-inline-start: var(--wt-space-2);
        }
        .venue {
          grid-area: venue;
        }
        .venue-name {
          padding-inline-start: 0;
          border-inline-start: 0;
        }
        .alert-toast {
          inset-inline: var(--wt-space-2);
          max-width: none;
        }
        .sidebar {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          /* position:absolute drops .sidebar out of flex layout, so the flex-basis above no longer
             sizes it — without its own width it fell back to shrink-to-fit over the nav's content,
             a width that moved every time a group expanded or collapsed and that translateX(-100%)
             then closed against inconsistently. */
          width: var(--dashboard-sidebar-width);
          z-index: 30;
          /* Opaque so the dimmed main column never shows through the sliding panel. */
          background: var(--wt-color-bg);
          transform: translateX(-100%);
          transition: transform 150ms ease;
        }
        .layout.drawer-open .sidebar {
          transform: translateX(0);
        }
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) liveUpdates?: { start(): void; stop(): void };

  /** Defaults to `login`, so a cold load never flashes a logged-in face before the probe confirms a
   * session. */
  @state() private screen: ScreenId = "login";

  #activeScreens = new Map<
    string,
    { contribution: DashboardContribution; handle: DashboardScreenHandle }
  >();
  #navGroups = new Map<NavGroupId, DashboardContribution[]>();

  #sessionPermissions: string[] = [];

  @state() private drawerOpen = false;

  @state() private profileOpen = false;

  /** Reported by profile-screen via `profile-tab-change`: the Edit action lives in this shell's modal
   * footer, shown only while "details" is active. */
  @state() private profileTab: "details" | "security" = "details";

  /** Keeps the footer's Edit disabled until profile-screen has loaded the data `editDetails()` reads. */
  @state() private profileReady = false;

  /** A group in this set still renders expanded if it holds the CURRENT screen. */
  @state() private collapsedGroups = new Set<NavGroupId>();
  // Collapsing a group shrinks the sidebar, and the browser clamps scrollTop, snapping the list
  // upward. Correcting scrollTop by how far the clicked header moved keeps it where it was clicked.
  #toggleGroup(id: NavGroupId, trigger: HTMLElement): void {
    const before = trigger.getBoundingClientRect().top;
    const next = new Set(this.collapsedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsedGroups = next;
    void this.updateComplete.then(() => {
      const sidebar = trigger.closest<HTMLElement>(".sidebar");
      if (!sidebar) return;
      sidebar.scrollTop += trigger.getBoundingClientRect().top - before;
    });
  }

  /** A CLOSED off-canvas sidebar must be `inert` (see render), or its nav buttons stay in the tab order
   * and the accessibility tree while off-screen. */
  @state() private narrow = false;

  #breakpoint?: MediaQueryList;

  readonly #onBreakpointChange = (e: MediaQueryListEvent): void => {
    this.narrow = e.matches;
    // At desktop there is no hamburger to reopen the drawer, so one left open would leave its scrim
    // over the whole layout.
    if (!e.matches) this.drawerOpen = false;
  };

  /** NOT named `role`: that collides with `HTMLElement.role`, which a `@state` cannot override. */
  @state() private sessionRole?: PersonRole;

  @state() private myPersonId = "";

  @state() private sessionNoticeCode: string | null = null;
  @state() private contentLanguageError: string | null = null;
  @state() private contentLanguagesReady = false;
  readonly #languageQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.contentLanguageError = codeOf(error);
    },
  );
  @state() private alerts: AlertView[] = [];
  @state() private alertsVisible = false;
  @state() private alertError: string | null = null;
  @state() private alertBusyKey: string | null = null;
  @state() private alertToast: { message: string; tone: "info" | "error" } | null = null;
  readonly #alertArrivals = new AlertArrivals();
  /** Bumped whenever the alerts state is cleared, which also happens without a new session (a
   * re-check that finds the person is now staff), so a Mark handled started before it is ignored. */
  #alertsGeneration = 0;
  readonly #alertQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => diag.record("warn", "alerts.load_failed", { code: codeOf(error) }),
  );
  /** The last element focused outside the pop-up: where focus returns when the pop-up, holding
   * focus, is closed. Both of its buttons are removed on press, which would drop focus to the page. */
  #focusBeforeToast: HTMLElement | null = null;
  private sessionExpiryTimer?: ReturnType<typeof setTimeout>;
  private sessionIdleTimeoutSeconds = 30 * 60;
  private sessionGeneration = 0;

  readonly #onSessionInvalid = (event: Event): void => {
    const code = (event as CustomEvent<{ code?: unknown }>).detail?.code;
    if (
      code === "management_session.expired" ||
      code === "management_session.required" ||
      code === "person.suspended"
    ) {
      this.#returnToLogin(code);
    }
  };

  readonly #onVisibilityChange = (): void => {
    if (document.visibilityState === "visible" && this.screen !== "login") {
      void this.#probeSession();
    }
  };

  readonly #onSessionActive = (): void => {
    if (this.sessionRole !== undefined) {
      this.#scheduleSessionExpiry(this.sessionIdleTimeoutSeconds);
      this.#broadcastSessionDeadline(Date.now() + this.sessionIdleTimeoutSeconds * 1000);
    }
  };

  readonly #onSessionStorage = (event: StorageEvent): void => {
    if (event.key !== "waitron-management-session-deadline" || this.sessionRole === undefined)
      return;
    const deadline = Number(event.newValue);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      this.#returnToLogin("management_session.expired");
      return;
    }
    this.#scheduleSessionExpiry((deadline - Date.now()) / 1000);
  };

  @state() private venueName = "";
  @state() private onboardingIntent?: "demo" | "prepare" | "live";

  // Returning to sign-in must have a language even when the server is unreachable.
  #venueLocale = "es-ES";
  #loginLocale?: string;
  #loginLocaleChoice = 0;
  /** Bumped by a signed-in language pick, the twin of `#loginLocaleChoice` for the login screen. A
   * session probe whose answer was decided BEFORE the pick took effect carries the language from
   * before it, so that answer must not repaint over the person's choice. */
  #sessionLocaleChoice = 0;

  constructor() {
    super();
    // Repaint the shell on language changes; authenticated screens are recreated by their locale key.
    // Login observes the locale itself so its current attempt survives the switch.
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // matchMedia fires `change` only on a transition, so read the initial match first.
    this.#breakpoint = window.matchMedia(DRAWER_BREAKPOINT);
    this.narrow = this.#breakpoint.matches;
    this.#breakpoint.addEventListener("change", this.#onBreakpointChange);
    window.addEventListener("waitron-session-invalid", this.#onSessionInvalid);
    window.addEventListener("waitron-session-active", this.#onSessionActive);
    window.addEventListener("storage", this.#onSessionStorage);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
  }

  override disconnectedCallback(): void {
    this.liveUpdates?.stop();
    this.#breakpoint?.removeEventListener("change", this.#onBreakpointChange);
    this.#breakpoint = undefined;
    window.removeEventListener("waitron-session-invalid", this.#onSessionInvalid);
    window.removeEventListener("waitron-session-active", this.#onSessionActive);
    window.removeEventListener("storage", this.#onSessionStorage);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    clearTimeout(this.sessionExpiryTimer);
    this.sessionExpiryTimer = undefined;
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    void this.#boot();
  }

  /** Account-action links open their form even with an existing session. Otherwise probe first,
   * then seed the login language only when signed out, preserving a signed-in person's preference. */
  async #boot(): Promise<void> {
    const url = new URL(window.location.href);
    const googleCallback = url.searchParams.get("login") === "google";
    const preference = consumeGoogleLoginPreference(googleCallback);
    if (googleCallback) {
      url.searchParams.delete("login");
      history.replaceState(history.state, "", url);
    }
    if (url.searchParams.has("token")) {
      await this.#seedLocale();
      return;
    }
    await this.#probeSession(preference);
    if (this.screen === "login") await this.#seedLocale();
  }

  /** The server matches Accept-Language against the installed UI languages. A late response must
   * not overwrite a person's explicit language choice or repaint a disconnected app. */
  async #seedLocale(): Promise<void> {
    const choice = this.#loginLocaleChoice;
    try {
      const { loginDefault, venueDefault, venueName, onboardingIntent } =
        await this.api.getLocales();
      if (!this.isConnected || this.screen !== "login") return;
      this.#venueLocale = venueDefault;
      this.#loginLocale = loginDefault;
      this.venueName = venueName;
      this.onboardingIntent = onboardingIntent;
      if (choice === this.#loginLocaleChoice) setLocale(loginDefault);
    } catch {
      // A failed language read must never block sign-in.
    }
  }

  /**
   * `getMe()` resolves for every role, staff included. The catch is total: any rejection means no
   * usable session, and dropping to login is the safe default for every failure.
   */
  async #probeSession(preference?: PendingLoginPreference): Promise<void> {
    const generation = this.sessionGeneration;
    const localeChoice = this.#sessionLocaleChoice;
    const wasAuthenticated = this.sessionRole !== undefined;
    try {
      const me = await this.api.getMe();
      if (!this.isConnected || generation !== this.sessionGeneration) return;
      this.#applyMe(me, preference, localeChoice === this.#sessionLocaleChoice);
    } catch (error) {
      if (!this.isConnected || generation !== this.sessionGeneration) return;
      const code = codeOf(error);
      if (
        wasAuthenticated ||
        code === "management_session.expired" ||
        code === "person.suspended"
      ) {
        this.#returnToLogin(
          code === "management_session.expired" || code === "person.suspended" ? code : null,
        );
      } else {
        this.screen = "login";
      }
    }
  }

  /** Restore a permitted URL destination after authentication and apply the person's language.
   * The disconnect guard protects both browser history and the shared locale from a late response,
   * and `mayApplyLocale` is false when the probe predates a signed-in language pick, whose answer
   * still carries the language from before it. */
  #applyMe(
    me: {
      personId: string;
      role: PersonRole;
      email: string | null;
      locale: string | null;
      venueLocale: string;
      sessionDefault: string;
      permissions: string[];
      modules: string[];
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
      sessionExpiresInSeconds?: number;
      sessionIdleTimeoutSeconds?: number;
    },
    preference: PendingLoginPreference | undefined,
    mayApplyLocale: boolean,
  ): void {
    if (!this.isConnected) return;
    this.sessionNoticeCode = null;
    this.myPersonId = me.personId;
    if (preference !== undefined && typeof me.email === "string") {
      rememberSuccessfulLogin(
        me.email,
        preference.method,
        preference.persistent,
        preference.rememberedEmail,
      );
    }
    this.sessionRole = me.role;
    this.liveUpdates?.start();
    this.#sessionPermissions = me.permissions;
    // Activate the enabled modules before resolving the permitted screen, so a URL naming an enabled
    // module's screen id is recognised while a disabled module's is not.
    this.#activate(me.modules);
    this.#applyRequestedScreen(this.#url.read("dashboard"));
    this.#venueLocale = me.venueLocale;
    this.venueName = me.venueName;
    this.onboardingIntent = me.onboardingIntent;
    const remainingSeconds = me.sessionExpiresInSeconds ?? 30 * 60;
    this.sessionIdleTimeoutSeconds = me.sessionIdleTimeoutSeconds ?? 30 * 60;
    this.#scheduleSessionExpiry(remainingSeconds);
    this.#broadcastSessionDeadline(Date.now() + remainingSeconds * 1000);
    this.#writeCurrentUrl(true);
    // A person's own choice wins; otherwise their browser's language, which the server has already
    // floored at the venue default for a browser asking for a language we do not ship.
    if (mayApplyLocale) setLocale(resolveActiveLocale(me.locale, me.sessionDefault));
    this.#loadContentLanguages();
    this.#watchAlerts();
  }

  #loadContentLanguages(): void {
    this.contentLanguageError = null;
    void this.#languageQueries
      .watch("getContentLanguages", [], (config) => {
        setContentLanguages(config);
        this.contentLanguagesReady = true;
        this.contentLanguageError = null;
      })
      .catch(() => undefined);
  }

  #watchAlerts(): void {
    if (this.sessionRole === "staff") {
      this.#clearAlerts();
      return;
    }
    void this.#alertQueries
      .watch("listAlerts", [], (response) => this.#applyAlerts(response))
      .catch(() => undefined);
  }

  #applyAlerts(response: AlertsResponse): void {
    this.alertsVisible = response.visible;
    if (!response.visible) {
      this.alerts = [];
      this.alertToast = null;
      this.#alertArrivals.reset();
      this.#alertQueries.release("listAlerts");
      return;
    }
    const arrived = this.#alertArrivals.next(response.alerts);
    this.alerts = response.alerts;
    if (arrived.length === 0) return;
    this.alertToast = {
      message:
        arrived.length === 1
          ? alertMessage(arrived[0]!.code, arrived[0]!.params)
          : t("alerts.toast_many").replace("{count}", String(arrived.length)),
      tone: arrived.some((a) => a.severity === "error") ? "error" : "info",
    };
  }

  #clearAlerts(): void {
    this.#alertsGeneration += 1;
    this.#alertQueries.release("listAlerts");
    this.#alertArrivals.reset();
    this.alerts = [];
    this.alertsVisible = false;
    this.alertError = null;
    this.alertBusyKey = null;
    this.alertToast = null;
    this.#focusBeforeToast = null;
  }

  async #onAlertHandle(event: CustomEvent<{ incidentId: string; key: string }>): Promise<void> {
    event.stopPropagation();
    // A request can outlive its session: an expired session is reported, and the shell returns to
    // login, before the request's own promise rejects.
    const generation = this.sessionGeneration;
    const alertsGeneration = this.#alertsGeneration;
    const current = () =>
      this.isConnected &&
      generation === this.sessionGeneration &&
      alertsGeneration === this.#alertsGeneration;
    this.alertBusyKey = event.detail.key;
    this.alertError = null;
    try {
      await markAlertHandled(this.api, event.detail.incidentId, current);
    } catch (error) {
      if (current()) this.alertError = codeOf(error);
    } finally {
      if (current()) this.alertBusyKey = null;
    }
  }

  #canOpenScreen = (screen: string): boolean => this.#permittedScreen(screen) === screen;

  override updated(changed: PropertyValues): void {
    // An open pop-up whose new text equals the old changes no toast property, so its countdown
    // would not restart on its own.
    if (changed.has("alertToast") && this.alertToast !== null)
      this.renderRoot.querySelector<WtToast>("[data-test=alert-toast]")?.show();
  }

  #onShellFocusIn(event: FocusEvent): void {
    if ((event.target as Element).matches("[data-test=alert-toast]")) return;
    const deepest = event.composedPath()[0];
    if (deepest instanceof HTMLElement) this.#focusBeforeToast = deepest;
  }

  #onToastActivate(event: Event): void {
    event.stopPropagation();
    const bell = this.renderRoot.querySelector<AlertsBell>("dashboard-alerts-bell");
    if (bell === null) return;
    bell.open();
    bell.focusPanel();
  }

  #onToastClose(event: Event): void {
    if (event.target !== event.currentTarget) return;
    const hadFocus = (event.currentTarget as WtToast).matches(":focus-within");
    this.alertToast = null;
    const previous = this.#focusBeforeToast;
    if (hadFocus && previous?.isConnected) previous.focus();
  }

  #scheduleSessionExpiry(seconds: number): void {
    clearTimeout(this.sessionExpiryTimer);
    this.sessionExpiryTimer = setTimeout(
      () => this.#returnToLogin("management_session.expired"),
      Math.max(0, seconds * 1000),
    );
  }

  #broadcastSessionDeadline(deadline: number): void {
    try {
      localStorage.setItem("waitron-management-session-deadline", String(deadline));
    } catch {
      // Session expiry remains enforced by the local timer and the server when storage is unavailable.
    }
  }

  #returnToLogin(code: string | null): void {
    this.#languageQueries.release("getContentLanguages");
    this.#clearAlerts();
    this.contentLanguagesReady = false;
    this.contentLanguageError = null;
    this.liveUpdates?.stop();
    this.sessionGeneration += 1;
    clearTimeout(this.sessionExpiryTimer);
    this.sessionExpiryTimer = undefined;
    this.sessionNoticeCode = code;
    this.screen = "login";
    this.sessionRole = undefined;
    this.myPersonId = "";
    this.#sessionPermissions = [];
    this.#activeScreens.clear();
    this.#navGroups.clear();
    this.drawerOpen = false;
    this.#broadcastSessionDeadline(0);
    this.#url.write(
      { dashboard: null, canvas: null, "canvas-tab": null, "floor-view": null, "floor-zone": null },
      true,
    );
    if (this.isConnected) {
      setLocale(this.#loginLocale ?? this.#venueLocale);
      void this.#seedLocale();
    }
  }

  /**
   * Runs on every probe/login and rebuilds the maps from scratch, so a module disabled server-side
   * since the last session stops showing. A contribution naming an unknown nav group id THROWS rather
   * than silently dropping the screen.
   */
  #activate(enabled: readonly string[]): void {
    const knownGroups = new Set<NavGroupId>(NAV_GROUPS.map((g) => g.id));
    this.#activeScreens.clear();
    this.#navGroups.clear();
    for (const c of DASHBOARD_MODULES) {
      if (!enabled.includes(c.module)) continue;
      if (!knownGroups.has(c.screen.group))
        throw new Error(
          `dashboard module "${c.module}" names unknown nav group "${c.screen.group}"`,
        );
      registerCatalogue(c.strings);
      this.#activeScreens.set(c.screen.id, {
        contribution: c,
        handle: c.create({ request: this.request, liveData: this.api.liveData }),
      });
      if (this.#sessionPermissions.includes(c.screen.requiresPermission)) {
        const group = this.#navGroups.get(c.screen.group) ?? [];
        group.push(c);
        this.#navGroups.set(c.screen.group, group);
      }
    }
    for (const list of this.#navGroups.values())
      list.sort((a, b) => (a.screen.order ?? 0) - (b.screen.order ?? 0));
  }

  /**
   * The login route returns who signed in and whether to offer them a passkey — no role and no
   * permissions — so the shell re-probes `getMe()`.
   */
  async #onLoggedIn(event: Event): Promise<void> {
    event.stopPropagation();
    const detail = (
      event as CustomEvent<{
        accountSetup?: boolean;
        loginMethod?: LoginMethod;
        rememberEmail?: boolean;
        rememberedEmail?: string;
      }>
    ).detail;
    const accountSetup = detail?.accountSetup === true;
    // Account activation has no Remember choice, so it does not change another saved shortcut.
    const preference: PendingLoginPreference | undefined = accountSetup
      ? undefined
      : {
          method: detail?.loginMethod ?? "password",
          persistent: detail?.rememberEmail === true,
          rememberedEmail: detail?.rememberedEmail,
        };
    await this.#probeSession(preference);
    if (accountSetup && this.sessionRole !== undefined && this.isConnected) {
      this.#openProfile();
    }
  }

  async #onLogout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // A failed logout must still drop to login; the reason it failed is not actionable here.
    }
    this.#returnToLogin(null);
  }

  /**
   * Before login a pick only switches the UI: there is no session to attach it to. Signed in, the
   * preference is saved first and the UI switches only after, so a failed save leaves the language
   * unchanged.
   */
  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "login") {
      this.#loginLocaleChoice += 1;
      setLocale(code);
      return;
    }
    // Bumped twice on purpose. The first invalidates a probe already in flight; the second
    // invalidates one that started while the write was still going, whose answer also predates the
    // choice. Nothing orders the two replies, so without the second the probe can answer last and
    // put the old language back for good.
    this.#sessionLocaleChoice += 1;
    try {
      await this.api.putLocale(code);
      if (!this.isConnected) return;
      this.#sessionLocaleChoice += 1;
      setLocale(code);
    } catch {
      // Leave the language unchanged on a failed save — the switch is gated behind the durable write.
    }
  }

  override render(): TemplateResult {
    if (this.screen === "login") {
      // The login controller repaints translated text without discarding credentials or account setup.
      // Its chooser bubbles here so the shell can apply the transient pre-login language choice.
      return html`
        ${this.#banner(false, false)}
        <div
          class="body"
          @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
        >
          <dashboard-login-screen
            .api=${this.api}
            .noticeCode=${this.sessionNoticeCode}
            @logged-in=${(event: Event) => void this.#onLoggedIn(event)}
          ></dashboard-login-screen>
        </div>
      `;
    }
    const hasNav = this.sessionRole !== "staff";
    return html`
      <div
        class="shell"
        @focusin=${(e: FocusEvent) => this.#onShellFocusIn(e)}
        @keydown=${(e: KeyboardEvent) => this.#onLayoutKeydown(e)}
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        <div class="banner-row">
          ${this.#banner(true, hasNav)}
          <wt-toast
            class="alert-toast"
            data-test="alert-toast"
            .open=${this.alertToast !== null}
            .message=${this.alertToast?.message ?? ""}
            tone=${this.alertToast?.tone ?? "info"}
            close-label=${t("action.close")}
            @wt-activate=${(e: Event) => this.#onToastActivate(e)}
            @wt-close=${(e: Event) => this.#onToastClose(e)}
          ></wt-toast>
        </div>
        <div class=${classMap({ layout: true, "drawer-open": hasNav && this.drawerOpen })}>
          <!-- The sidebar, shown only for a non-staff session. At desktop width it is in-flow; below the
               breakpoint (Task 12) it becomes the off-canvas drawer the hamburger toggles. When it is
               off-canvas AND closed (narrow && not drawerOpen) it is inert, so its nav buttons
               leave the tab order + a11y tree rather than lurking off-screen ahead of every visible
               control; it is interactive at desktop width and whenever the drawer is open. -->
          ${
            hasNav
              ? html`<aside class="sidebar" ?inert=${this.narrow && !this.drawerOpen}>
                  ${this.#nav()}
                </aside>`
              : nothing
          }
          <!-- The scrim behind the open drawer — a tap on it closes the drawer. Rendered only while open
               (and only a non-staff session can open one); the drawer is force-closed on the transition
               to desktop (#onBreakpointChange), so this never renders at desktop width.
               aria-hidden: it is a decorative veil, not an interactive control in the a11y tree. -->
          ${
            hasNav && this.drawerOpen
              ? html`<div
                  class="scrim"
                  aria-hidden="true"
                  @click=${() => (this.drawerOpen = false)}
                ></div>`
              : nothing
          }
          <div class="main">
            ${
              this.contentLanguageError
                ? html`<div role="alert" data-test="content-language-error">
                    <p>
                      ${t("content_languages.load_error")} ${codeMessage(this.contentLanguageError)}
                    </p>
                    <wt-button
                      data-test="retry-content-languages"
                      variant="secondary"
                      @click=${() => this.#loadContentLanguages()}
                      >${t("content_languages.retry")}</wt-button
                    >
                  </div>`
                : nothing
            }
            <!-- keyed on the active locale: a switch changes the key, so Lit discards and rebuilds the
                 screen subtree, repainting every child in the new language (screens hold no controller). -->
            <div class="body" @wt-edit-product=${this.#onEditProduct}>
              ${
                this.contentLanguagesReady
                  ? keyed(currentLocale(), this.#renderScreen())
                  : this.contentLanguageError === null
                    ? html`<p role="status" data-test="content-language-loading">
                        ${t("content_languages.loading")}
                      </p>`
                    : nothing
              }
            </div>
            <dashboard-language-chooser
              .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
            ></dashboard-language-chooser>
          </div>
        </div>
        ${this.#renderProfileModal()}
      </div>
    `;
  }

  #banner(authenticated: boolean, hasNav: boolean): TemplateResult {
    return html`<header class="brand-banner" data-test="brand-banner">
      <div class="brand-identity">
        ${
          authenticated && hasNav
            ? html`<wt-button
                class="nav-toggle"
                variant="ghost"
                data-test="nav-toggle"
                aria-label=${t("nav.toggle")}
                @click=${() => (this.drawerOpen = !this.drawerOpen)}
                ><wt-icon name="hamburger"></wt-icon
              ></wt-button>`
            : nothing
        }
        <img class="brand-logo" src=${WAITRON_LOGO_URL} alt="Waitron" />
        <span class="venue">
          <span class="venue-name" data-test="venue-name">${this.venueName}</span>
          ${
            this.onboardingIntent === undefined
              ? nothing
              : html`<span class="mode-indicator" data-test="mode-indicator">
                  ${t(`mode.${this.onboardingIntent}`)}
                </span>`
          }
        </span>
      </div>
      ${
        authenticated
          ? html`<div class="banner-actions">
              ${
                this.alertsVisible
                  ? html`<dashboard-alerts-bell
                      data-test="alerts-bell"
                      .alerts=${this.alerts}
                      .error=${this.alertError}
                      .busyKey=${this.alertBusyKey}
                      .canOpen=${this.#canOpenScreen}
                      @wt-alert-handle=${(e: CustomEvent<{ incidentId: string; key: string }>) =>
                        void this.#onAlertHandle(e)}
                      @wt-alerts-see-all=${(e: Event) => {
                        e.stopPropagation();
                        this.#selectScreen("alerts");
                      }}
                      @wt-alert-go-to=${(e: CustomEvent<{ screen: string }>) => {
                        e.stopPropagation();
                        this.#selectScreen(e.detail.screen);
                      }}
                    ></dashboard-alerts-bell>`
                  : nothing
              }
              <wt-row-actions
                icon="person"
                align="end"
                .iconSize=${"lg"}
                label=${t("nav.account_menu")}
                data-test="account-menu"
              >
                <wt-button
                  variant="ghost"
                  align="start"
                  data-test="profile"
                  @click=${() => this.#openProfile()}
                  >${t("action.account_settings")}</wt-button
                >
                <wt-button
                  variant="ghost"
                  align="start"
                  data-test="logout"
                  @click=${() => void this.#onLogout()}
                  >${t("action.logout")}</wt-button
                >
              </wt-row-actions>
            </div>`
          : nothing
      }
    </header>`;
  }

  #selectScreen(screen: ScreenId): void {
    diag.record("info", "nav", { screen });
    this.screen = this.#permittedScreen(screen);
    this.#writeScreenUrl(this.screen);
    this.drawerOpen = false;
  }

  /** A screen (the units in-use modal) asks to open a product's editor; navigate to the catalogue
   * screen with that product deep-linked. No automatic return — the person navigates back themselves. */
  #onEditProduct(event: CustomEvent<{ productId: string }>): void {
    event.stopPropagation();
    const screen = this.#permittedScreen("catalogue");
    if (screen !== "catalogue") return;
    // An ordinary screen change (so the previous screen's `view` segment is cleared), then the
    // product on top of it — `write` merges into what the URL already holds. The second write
    // REPLACES, so the jump is a single Back-button stop rather than two.
    this.#selectScreen(screen);
    this.#url.write({ product: event.detail.productId }, true);
  }

  /** The module permission check here matches the one `#activate` applies to the nav. */
  #permittedScreen(requested: string | null): ScreenId {
    if (this.sessionRole === "staff") return "my-schedule";
    if (requested === "alerts") return "alerts";
    const item = NAV_GROUPS.flatMap((group) => group.items).find(
      (entry) => entry.screen === requested,
    );
    if (
      item &&
      (!item.requiresManager || this.sessionRole === "manager" || this.sessionRole === "admin")
    )
      return item.screen;
    if (requested !== null) {
      const active = this.#activeScreens.get(requested);
      if (
        active &&
        this.#sessionPermissions.includes(active.contribution.screen.requiresPermission)
      )
        return requested;
    }
    return "overview";
  }

  readonly #url = new UrlStateController(this, () => this.#onHistory(), dashboardPath);

  #writeScreenUrl(screen: ScreenId, replace = false): void {
    this.#url.write(
      { dashboard: screen, ...(this.#url.read("dashboard") === screen ? {} : { view: null }) },
      replace,
    );
  }

  /** "profile" opens the modal over the current screen, or over the person's default when none is
   * resolved yet. An already-resolved screen is left alone because this also runs on every re-probe,
   * including the one a profile save triggers while the URL still reads "profile". The cost: a module
   * disabled server-side while the modal is open is not re-gated until the next navigation. */
  #applyRequestedScreen(requested: string | null): void {
    this.profileOpen = requested === "profile";
    if (this.profileOpen && this.screen !== "login") return;
    this.screen = this.#permittedScreen(this.profileOpen ? null : requested);
  }

  #writeCurrentUrl(replace: boolean): void {
    if (this.profileOpen) this.#url.write({ dashboard: "profile" }, replace);
    else this.#writeScreenUrl(this.screen, replace);
  }

  /** A pushed navigation, so the browser's Back button closes the modal. */
  #openProfile(): void {
    this.profileOpen = true;
    this.#url.write({ dashboard: "profile" }, false);
    this.drawerOpen = false;
  }

  /** Replaces the current entry, so "profile" does not stay behind as its own Back-button stop. A
   * Back-button close goes through `#onHistory` instead. */
  #closeProfile(): void {
    this.profileOpen = false;
    this.#writeScreenUrl(this.screen, true);
  }

  readonly #onHistory = (): void => {
    if (this.screen === "login" || this.sessionRole === undefined) return;
    this.#applyRequestedScreen(this.#url.read("dashboard"));
    this.#writeCurrentUrl(true);
    this.drawerOpen = false;
    diag.record("info", "nav", { screen: this.screen });
  };

  /** A no-op when the drawer is closed, so it never swallows Escape from anything else. */
  #onLayoutKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.drawerOpen) this.drawerOpen = false;
  }

  /** Items are plain `.nav-item` buttons, not `wt-button`: a long list reads as navigation, not a
   * stack of buttons. */
  #nav(): TemplateResult {
    return html`
      <nav class="nav" aria-label=${t("nav.sections")}>
        ${NAV_GROUPS.map((group) => {
          const contributions = this.#navGroups.get(group.id) ?? [];
          const containsCurrentScreen =
            group.items.some((item) => item.screen === this.screen) ||
            contributions.some((c) => c.screen.id === this.screen);
          const collapsed = this.collapsedGroups.has(group.id) && !containsCurrentScreen;
          const panelId = `nav-group-panel-${group.id}`;
          return html`
            ${
              group.headerKey
                ? html`<button
                    type="button"
                    class="nav-group"
                    aria-expanded=${!collapsed}
                    aria-controls=${panelId}
                    data-test="nav-group-${group.id}"
                    @click=${(e: MouseEvent) =>
                      this.#toggleGroup(group.id, e.currentTarget as HTMLElement)}
                  >
                    <wt-icon name="chevron-down" class="chevron"></wt-icon>
                    ${group.icon ? html`<wt-icon name=${group.icon}></wt-icon>` : nothing}
                    ${t(group.headerKey)}
                  </button>`
                : nothing
            }
            <div id=${panelId} ?hidden=${collapsed}>
              ${group.items
                .filter(
                  (item) =>
                    !item.requiresManager ||
                    this.sessionRole === "manager" ||
                    this.sessionRole === "admin",
                )
                .map(
                  (item) =>
                    html`<button
                      type="button"
                      class="nav-item"
                      aria-current=${this.screen === item.screen ? "page" : nothing}
                      data-test="nav-${item.screen}"
                      @click=${() => this.#selectScreen(item.screen)}
                    >
                      ${t(item.labelKey)}
                    </button>`,
                )}
              ${contributions.map(
                (c) =>
                  html`<button
                    type="button"
                    class="nav-item"
                    aria-current=${this.screen === c.screen.id ? "page" : nothing}
                    data-test="nav-${c.screen.id}"
                    @click=${() => this.#selectScreen(c.screen.id)}
                  >
                    ${tKit(c.screen.navLabelKey)}
                  </button>`,
              )}
            </div>
          `;
        })}
      </nav>
    `;
  }

  /** profile-screen's per-field edit modals nest inside this one deliberately: this modal is the page,
   * they are its forms. */
  #renderProfileModal(): TemplateResult {
    return html`
      <wt-modal
        heading=${t("profile.title")}
        .open=${this.profileOpen}
        @wt-close=${(e: Event) => {
          // profile-screen's own nested edit modal sends the same composed, bubbling wt-close.
          if (e.target !== e.currentTarget) return;
          this.#closeProfile();
        }}
      >
        ${
          this.profileOpen
            ? html`<dashboard-profile-screen
                .api=${this.api}
                @profile-updated=${() => void this.#probeSession()}
                @profile-tab-change=${(
                  e: CustomEvent<{ tab: "details" | "security"; ready: boolean }>,
                ) => {
                  this.profileTab = e.detail.tab;
                  this.profileReady = e.detail.ready;
                }}
              ></dashboard-profile-screen>`
            : nothing
        }
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" data-test="close-profile" @click=${() => this.#closeProfile()}
            >${t("action.close")}</wt-button
          >
          ${
            this.profileTab === "details"
              ? html`<wt-button
                  data-test="edit-profile-details"
                  variant="primary"
                  ?disabled=${!this.profileReady}
                  @click=${() =>
                    this.renderRoot
                      .querySelector<ProfileScreen>("dashboard-profile-screen")
                      ?.editDetails()}
                  >${t("action.edit")}</wt-button
                >`
              : nothing
          }
        </wt-form-actions>
      </wt-modal>
    `;
  }

  /**
   * `screen` is never `login` here, so `overview` is the default rather than an unreachable
   * exhaustive `default`.
   */
  #renderScreen(): TemplateResult {
    const mod = this.#activeScreens.get(this.screen);
    if (mod) return mod.handle.render();
    switch (this.screen) {
      case "my-schedule":
        return html`<dashboard-my-schedule-screen
          .api=${this.api}
          .myPersonId=${this.myPersonId}
        ></dashboard-my-schedule-screen>`;
      case "sales":
        return html`<dashboard-sales-screen .api=${this.api}></dashboard-sales-screen>`;
      case "staff":
        return html`<dashboard-staff-screen
          .api=${this.api}
          .currentPersonId=${this.myPersonId}
        ></dashboard-staff-screen>`;
      case "categories":
        return html`<dashboard-categories-screen .api=${this.api}></dashboard-categories-screen>`;
      case "modifiers":
        return html`<dashboard-modifiers-screen .api=${this.api}></dashboard-modifiers-screen>`;
      case "catalogue":
        return html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`;
      case "units":
        return html`<dashboard-units-screen .api=${this.api}></dashboard-units-screen>`;
      case "location-settings":
        return html`<dashboard-location-settings-screen
          .api=${this.api}
        ></dashboard-location-settings-screen>`;
      case "receipt":
        return html`<dashboard-receipt-screen .api=${this.api}></dashboard-receipt-screen>`;
      case "statuses":
        return html`<dashboard-service-status-screen
          .api=${this.api}
        ></dashboard-service-status-screen>`;
      case "floor":
        return html`<dashboard-floor-screen .api=${this.api}></dashboard-floor-screen>`;
      case "kitchen":
        return html`<dashboard-kitchen-screen .api=${this.api}></dashboard-kitchen-screen>`;
      case "roster":
        return html`<dashboard-roster-screen .api=${this.api}></dashboard-roster-screen>`;
      case "approvals":
        return html`<dashboard-approvals-screen .api=${this.api}></dashboard-approvals-screen>`;
      case "planned-actual":
        return html`<dashboard-planned-actual-screen
          .api=${this.api}
        ></dashboard-planned-actual-screen>`;
      case "purchases":
        return html`<dashboard-purchases-screen .api=${this.api}></dashboard-purchases-screen>`;
      case "devices":
        return html`<dashboard-devices-screen .api=${this.api}></dashboard-devices-screen>`;
      case "printing-rules":
        return html`<dashboard-printing-rules-screen
          .api=${this.api}
        ></dashboard-printing-rules-screen>`;
      case "printers":
        return html`<dashboard-printers-screen .api=${this.api}></dashboard-printers-screen>`;
      case "canvas-editor":
        return html`<dashboard-canvas-editor-screen
          .api=${this.api}
        ></dashboard-canvas-editor-screen>`;
      case "device-profiles":
        return html`<dashboard-device-profiles-screen
          .api=${this.api}
        ></dashboard-device-profiles-screen>`;
      case "diagnostics":
        return html`<dashboard-diagnostics-screen .api=${this.api}></dashboard-diagnostics-screen>`;
      case "cloud":
        return html`<dashboard-cloud-services-screen
          .api=${this.api}
        ></dashboard-cloud-services-screen>`;
      case "backup":
        return html`<dashboard-backup-screen .api=${this.api}></dashboard-backup-screen>`;
      case "email":
        return html`<dashboard-email-screen .api=${this.api}></dashboard-email-screen>`;
      case "payments":
        return html`<dashboard-payments-screen
          .api=${this.api}
          .request=${this.request}
          .mode=${this.onboardingIntent}
        ></dashboard-payments-screen>`;
      case "alerts":
        return html`<dashboard-alerts-screen
          .api=${this.api}
          .canOpen=${this.#canOpenScreen}
          @wt-alert-go-to=${(e: CustomEvent<{ screen: string }>) => {
            e.stopPropagation();
            this.#selectScreen(e.detail.screen);
          }}
        ></dashboard-alerts-screen>`;
      default:
        return html`<dashboard-overview-screen .api=${this.api}></dashboard-overview-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-app": DashboardApp;
  }
}
