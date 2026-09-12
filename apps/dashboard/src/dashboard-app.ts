import { dashboardPath } from "./navigation.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, UrlStateController } from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeOf } from "./i18n/codes.js";
import { diag } from "./diagnostics.js";
import type { StringKey } from "./i18n/strings.js";
// The module-UI seam: modules are mounted generically from the browser-safe registry, never named here.
// `tKit` is the kit's UNTYPED resolver (the app's own `t` is narrowed to its StringKey union, which a
// module's own label keys are not in); it resolves against the same shared catalogue `registerCatalogue`
// fills.
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
// Side-effect imports register the screen elements this shell swaps between; it names them only as
// tags below, so the wiring — not the screens — is what lives here.
import "./widgets/language-chooser.js";
import "./screens/login-screen.js";
import "./screens/profile-screen.js";
import type { ProfileScreen } from "./screens/profile-screen.js";
import "./screens/my-schedule-screen.js";
import "./screens/dashboard-overview-screen.js";
import "./screens/dashboard-sales-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/receipt-screen.js";
import "./screens/service-status-screen.js";
import "./screens/floor-screen.js";
import "./screens/kitchen-screen.js";
import "./screens/roster-screen.js";
import "./screens/approvals-screen.js";
import "./screens/planned-actual-screen.js";
import "./screens/purchases-screen.js";
import "./screens/recipe-screen.js";
import "./screens/devices-screen.js";
import "./screens/printers-screen.js";
import "./screens/printing-rules-screen.js";
import "./screens/canvas-editor-screen.js";
import "./screens/device-profiles-screen.js";
import "./screens/diagnostics-screen.js";
import "./screens/backup-screen.js";
import "./screens/email-screen.js";
import "./screens/payments-screen.js";
import type { DashboardApi, PersonRole } from "./api/client.js";
import {
  consumeGoogleLoginPreference,
  rememberSuccessfulLogin,
  type LoginMethod,
  type PendingLoginPreference,
} from "./login-preference.js";

/**
 * The faces of the management dashboard: sign in, view your own self-service schedule, manage staff,
 * author the catalogue, edit the receipt trim, configure the table service
 * statuses, arrange the floor plan (zones + tables), configure the kitchen (stations + bump mode),
 * author the roster, work the approvals queues, review planned vs actual worked time, record received
 * purchase invoices, author ingredients and product recipes, manage enrolled devices, manage printing
 * (agents + printers + status), see today's business overview, or review sales & takings over a date
 * range. Exactly one permitted destination shows at a time. Non-staff sessions restore a permitted
 * path or fall back to overview; staff sessions can open their schedule. Logged-in faces share logout
 * and language controls, with navigation available to non-staff sessions.
 *
 * "Your profile" is NOT one of these — it isn't a destination you navigate to (it has no sidebar
 * entry, and swapping the main content for it made an already-narrow page fight the shell's own
 * width and left nobody able to explain why nothing in the sidebar was ever highlighted while
 * viewing it). It's a modal ({@link profileOpen}) that opens over whichever face is current,
 * closes back to it, and is reachable from any of them via the banner's account menu.
 */
type CoreScreen =
  | "login"
  | "my-schedule"
  | "overview"
  | "sales"
  | "staff"
  | "catalogue"
  | "receipt"
  | "statuses"
  | "floor"
  | "kitchen"
  | "roster"
  | "approvals"
  | "planned-actual"
  | "purchases"
  | "recipe"
  | "devices"
  | "printers"
  | "printing-rules"
  | "canvas-editor"
  | "device-profiles"
  | "diagnostics"
  | "backup"
  | "email"
  | "payments";

/** A destination the shell can show: a core face, or an active module's own screen id. The `& {}` keeps
 * the `CoreScreen` literal autocomplete while still admitting any module id string — the one spelling
 * used everywhere a screen id is passed, rather than the weaker `CoreScreen | string` (which collapses
 * to `string`, dropping the literal hints). */
type ScreenId = CoreScreen | (string & {});

/** The viewport width at/below which the sidebar becomes the off-canvas drawer (Task 12). Kept as a
 * single source so the JS `matchMedia` query and the CSS `@media` block below cannot drift — a media
 * query cannot read a `--custom-property`, so the breakpoint is a literal in both places, and `48rem`
 * matches the existing repo precedent in `apps/till/src/screens/till-counter-screen.ts:111`. */
const DRAWER_BREAKPOINT = "(max-width: 48rem)";

/** The canonical brand lockup. `new URL(..., import.meta.url)` lets Vite fingerprint the shared SVG
 * without copying logo geometry into this shell. */
const WAITRON_LOGO_URL = new URL("../../../packages/ui/brand/waitron-lockup.svg", import.meta.url)
  .href;

/** One nav entry: the face it switches to, the i18n key for its label, and whether it is manager-gated
 * (`requiresManager` hides it from a `supervisor` session — `#nav()` filters on it before mapping). */
type NavItem = { screen: ScreenId; labelKey: StringKey; requiresManager?: boolean };
/** One sidebar group: a stable `id` (a module contribution names one as its `screen.group`), an optional
 * header label (the pinned first group has none), an optional registered icon name for that header
 * (kept rare — see "Icons" in design-system.md; a group only gets one where it's as unambiguous as
 * Settings' gear, not attempted for every group) and its items. */
type NavGroup = { id: NavGroupId; headerKey?: StringKey; icon?: string; items: NavItem[] };

/**
 * The grouped, DATA-DRIVEN sidebar. `#nav()` renders this in a loop, so the manager faces are
 * described here once rather than spelled out one-by-one in the template. The pinned first group
 * (overview + sales) carries no header — the two reporting faces lead. Each item keeps the stable
 * `data-test="nav-<screen>"` id every downstream consumer (tests included) pins.
 */
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
      { screen: "recipe", labelKey: "nav.recipe" },
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
      { screen: "devices", labelKey: "nav.devices" },
      { screen: "printers", labelKey: "nav.printers" },
      { screen: "printing-rules", labelKey: "nav.printing_rules" },
      { screen: "payments", labelKey: "nav.payments", requiresManager: true },
      { screen: "canvas-editor", labelKey: "nav.canvases" },
      { screen: "device-profiles", labelKey: "nav.device_profiles" },
      { screen: "diagnostics", labelKey: "nav.diagnostics", requiresManager: true },
      { screen: "backup", labelKey: "nav.backup", requiresManager: true },
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
        margin-inline-start: auto;
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
        .nav-toggle {
          display: inline-block;
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

  /** The HTTP face of the dashboard. `main.ts` injects a real same-origin client; a test injects a
   * stub. Assigned as a property (`attribute: false`) — a `DashboardApi` cannot travel through an
   * attribute string. */
  @property({ attribute: false }) api!: DashboardApi;

  /** The request primitive a mounted module screen is wired to (a module's contribution builds its own
   * typed client on it). `main.ts` injects one built from the SAME instrumented fetch as `api`; a test
   * injects a stub. Assigned as a property (`attribute: false`) — it cannot travel through an attribute. */
  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) liveUpdates?: { start(): void; stop(): void };

  /** Which screen is showing. Defaults to `login`, so a cold load never flashes a logged-in face
   * before the probe confirms a session (see the class doc). A CoreScreen literal or an active module's
   * screen id (`string`); the `& {}` keeps the literal autocomplete while admitting any module id. */
  @state() private screen: ScreenId = "login";

  /** Each active module's mounted screen, keyed by its screen id: the contribution (its nav placement +
   * permission) alongside the handle (its rendered screen). This is the ENABLED set — `me.modules` gates
   * it, the per-permission gate is layered on in `#navGroups`. The generic mount path `#renderScreen`
   * and the route gate `#permittedScreen` consult it before the core switch. Rebuilt on every
   * {@link #activate}, so a re-probe/re-login reconciles a module the server has since disabled. */
  #activeScreens = new Map<
    string,
    { contribution: DashboardContribution; handle: DashboardScreenHandle }
  >();
  /** The active-and-PERMITTED module contributions grouped by nav-group id, each group pre-sorted by
   * `order`. Built once per {@link #activate} so `#nav` does a single `Map.get` per group rather than
   * filtering the whole active set and sorting it on every render, for every group. */
  #navGroups = new Map<NavGroupId, DashboardContribution[]>();

  /** The signed-in person's EFFECTIVE permission set from the WHOAMI probe (`me.permissions`). The two
   * module gates read it: `#nav` shows a module's item only when this set holds its `requiresPermission`,
   * and `#permittedScreen` admits a module id only when it does too. A client-side HINT for the UI —
   * every module route is still gated server-side. Empty until a probe/login resolves. */
  #sessionPermissions: string[] = [];

  /** Whether the off-canvas nav drawer is open (Task 12). Only meaningful on narrow screens, where the
   * sidebar slides in over the main column; at desktop width the sidebar is always in-flow and the
   * hamburger + scrim are hidden, so this flag is inert there. The hamburger toggles it, and selecting
   * ANY nav item — or clicking the scrim — sets it back to `false`. */
  @state() private drawerOpen = false;

  /** Whether the "Your profile" modal is open over the current `screen` — see the note on
   * {@link CoreScreen} for why this is not itself a screen. Driven by the URL's `dashboard=profile`
   * (so it survives refresh/deep-link — `#applyRequestedScreen`/`#writeCurrentUrl` keep the two in
   * sync) as well as `#openProfile`/`#closeProfile` for in-session opens and closes. */
  @state() private profileOpen = false;

  /** Which tab of the open profile modal is showing — profile-screen.ts owns the tab strip itself
   * and reports changes via `profile-tab-change`, because the Edit action for "Your details" lives
   * in THIS shell's modal footer (alongside Close), not inside profile-screen.ts: Security has no
   * equivalent single action, so the footer only shows Edit while "details" is active. */
  @state() private profileTab: "details" | "security" = "details";

  /** Whether profile-screen.ts has actually loaded its data yet (same `profile-tab-change` event —
   * see {@link profileTab}). The Edit button lives outside the `p === null` render guard that used
   * to keep an in-card Edit button from existing before load completed, so this is what disables
   * it until there is real data for `editDetails()` to read. */
  @state() private profileReady = false;

  /** Manually-collapsed nav groups (headerless groups are never collapsible, so never appear here).
   * A group in this set still renders expanded if it contains the CURRENT screen — collapsing "Team"
   * and then navigating to Staff should not hide the page you are already on. */
  @state() private collapsedGroups = new Set<NavGroupId>();
  // Collapsing a group the user has scrolled down to reach shrinks the sidebar's scrollable
  // content, and the browser then CLAMPS scrollTop to the new (shorter) max — snapping the whole
  // visible list upward even though nothing above the clicked header actually moved. Recording the
  // trigger's own on-screen position before the toggle and correcting scrollTop by the same amount
  // once the DOM has updated keeps it exactly where the user clicked it, regardless of that clamp.
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

  /** Whether the viewport is at/below the drawer breakpoint (Task 12). Tracked from `matchMedia` so the
   * shell knows when the sidebar is off-canvas: a CLOSED off-canvas sidebar must be made `inert` (see
   * render) or its nav buttons stay in the tab order and a11y tree while translated off-screen,
   * so a keyboard user would tab through invisible controls before reaching a visible one. At
   * desktop width the sidebar is in-flow and always interactive, so this is `false` there. */
  @state() private narrow = false;

  /** The live breakpoint query the shell listens to. Held so {@link disconnectedCallback} can detach the
   * listener; created in {@link connectedCallback}. */
  #breakpoint?: MediaQueryList;

  /** The breakpoint listener — a stable bound reference so add/removeEventListener pair up. */
  readonly #onBreakpointChange = (e: MediaQueryListEvent): void => {
    this.narrow = e.matches;
    // Crossing to desktop force-closes the drawer. At desktop the sidebar is in-flow and there is no
    // hamburger to reopen it, so a drawer left open at narrow width would otherwise leave its
    // full-viewport scrim veiling the whole desktop layout after a resize/rotate until the next click.
    if (!e.matches) this.drawerOpen = false;
  };

  /** The logged-in person's role, learned from `getMe()`. `undefined` until a probe/login resolves.
   * `staff` suppresses the manager nav; the four other values keep it. NOT named `role` — that
   * collides with `HTMLElement.role` (the reflected ARIA property), which a `@state` cannot override. */
  @state() private sessionRole?: PersonRole;

  /** The logged-in person's id, threaded to the staff self-service screen (its colleague picker filters
   * this out, and it names a swap's counterparty). Empty until a probe/login resolves. */
  @state() private myPersonId = "";

  @state() private sessionNoticeCode: string | null = null;
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

  /** The one tenant/business this deployment database represents. It remains visible across login
   * and every dashboard location, because a tenant can contain several locations. */
  @state() private venueName = "";
  @state() private onboardingIntent?: "demo" | "prepare" | "live";

  // Returning to sign-in must have a language even when the server is unreachable.
  #venueLocale = "es-ES";
  #loginLocale?: string;
  #loginLocaleChoice = 0;

  constructor() {
    super();
    // Repaint the shell on language changes; authenticated screens are recreated by their locale key.
    // Login observes the locale itself so its current attempt survives the switch.
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Track the drawer breakpoint so a CLOSED off-canvas sidebar can be made inert (see render). Read
    // the current match once up front (matchMedia only fires `change` on a TRANSITION, never for the
    // initial state), then follow changes.
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
   * Probe for a live management session via WHOAMI (`getMe()`) — the role-blind endpoint that resolves
   * for EVERY role (a staff person holds no `person.manage`, so the old `listStaff()` probe would 403
   * them and wrongly drop them to login). A resolved response proves the httpOnly session cookie is
   * valid, so apply the role; ANY rejection means no usable session (the common
   * `management_session.required`/401, but also a stray or network error), so open on `login`. The
   * catch is deliberately total: catching only the session code would let any other rejection escape as
   * an unhandled promise rejection (the `apps/till` `#boot` follow-up, `docs/backlog.md`), and dropping
   * to login is the safe default for every failure anyway.
   */
  async #probeSession(preference?: PendingLoginPreference): Promise<void> {
    const generation = this.sessionGeneration;
    const wasAuthenticated = this.sessionRole !== undefined;
    try {
      const me = await this.api.getMe();
      if (!this.isConnected || generation !== this.sessionGeneration) return;
      this.#applyMe(me, preference);
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
   * The disconnect guard protects both browser history and the shared locale from a late response. */
  #applyMe(
    me: {
      personId: string;
      role: PersonRole;
      email: string | null;
      locale: string | null;
      venueLocale: string;
      permissions: string[];
      modules: string[];
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
      sessionExpiresInSeconds?: number;
      sessionIdleTimeoutSeconds?: number;
    },
    preference?: PendingLoginPreference,
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
    // Activate ONLY the enabled modules (`me.modules`) before resolving the permitted screen, so a URL
    // naming an enabled module's own screen id is recognised while a disabled module's is not.
    // The per-permission gate is applied on top, in `#nav` and `#permittedScreen`.
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
    setLocale(resolveActiveLocale(me.locale, me.venueLocale));
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
   * (Re)build the active module set from `enabled` (the session's `me.modules`). RECONCILES rather than
   * activating once-ever: `#applyMe` calls this on every probe/login, so a module disabled server-side
   * since the last session stops showing — the maps are cleared and rebuilt from scratch each time
   * (`registerCatalogue` is idempotent, so re-registering an already-known catalogue is harmless). For
   * each enabled module: register its strings, mount its screen handle (built with this app's request),
   * and — when the session HOLDS its `requiresPermission` — file it into its nav group. A contribution
   * naming a nav group id the app does not know is a wiring error, so it THROWS rather than silently
   * dropping the screen. The per-permission gate lives here (in `#navGroups`) and in `#permittedScreen`,
   * so a module can be active (enabled) yet absent from the nav.
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
   * A confirmed login from `dashboard-login-screen`. `stopPropagation` keeps the composed, bubbling
   * `logged-in` inside the shell (the house pattern — the shell is its final consumer, so it must not
   * leak on to the document past the shadow boundary). The login route returns only `{ personId }`, so
   * the shell re-probes `getMe()` to learn the freshly-authenticated role and land on the right face.
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

  /**
   * End the shift: tear the server session down, then back to `login`. The await is wrapped so a
   * failed `logout()` is neither an unhandled rejection nor a reason to strand the operator on the
   * staff screen — either way the shell drops to `login` (the local session is over regardless of
   * what the server answered).
   */
  async #onLogout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // A failed logout must still drop to login; the reason it failed is not actionable here.
    }
    this.#returnToLogin(null);
  }

  /**
   * The ONE handler for a language pick (per-user-language-preference). The chooser is presentational —
   * it emits a composed `locale-selected` carrying only the chosen `code`; this decides what the pick
   * MEANS, and that turns entirely on whether anyone is signed in:
   *  - PRE-LOGIN (`screen === "login"`): a TRANSIENT switch. Switch the UI (`setLocale`) but write
   *    NOTHING — there is no session to attach a preference to. This runs synchronously before any
   *    await, so the element is still connected and it needs no disconnect guard.
   *  - LOGGED IN: PERSIST the operator's preference (`putLocale`) and only THEN switch the UI, so a
   *    failed save leaves the language unchanged (the shell has no error banner — the write simply does
   *    not take effect and the current language stands). The post-await `setLocale` is disconnect-guarded
   *    (the DISCONNECT SAFETY note): the durable write has already landed and the next login re-applies
   *    it, so a teardown mid-write skips only the now-pointless local repaint.
   */
  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "login") {
      this.#loginLocaleChoice += 1;
      setLocale(code);
      return;
    }
    try {
      await this.api.putLocale(code);
      if (!this.isConnected) return;
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
    // A non-staff session carries the nav; a staff person has self-service and profile access, so it gets no
    // sidebar, no hamburger and no drawer at all.
    const hasNav = this.sessionRole !== "staff";
    return html`
      <div
        class="shell"
        @keydown=${(e: KeyboardEvent) => this.#onLayoutKeydown(e)}
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        ${this.#banner(true, hasNav)}
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
            <!-- keyed on the active locale: a switch changes the key, so Lit discards and rebuilds the
                 screen subtree, repainting every child in the new language (screens hold no controller). -->
            <div class="body">${keyed(currentLocale(), this.#renderScreen())}</div>
            <dashboard-language-chooser
              .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
            ></dashboard-language-chooser>
          </div>
        </div>
        ${this.#renderProfileModal()}
      </div>
    `;
  }

  /** The dashboard's stable identity chrome: logo + tenant legal name on every face, with session
   * actions only after authentication. The narrow-screen navigation toggle stays at the leading
   * edge; the account menu (Account settings, Log out) occupies the trailing edge in both desktop
   * and narrow layouts. */
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
        <span class="venue-name" data-test="venue-name">${this.venueName}</span>
        ${
          this.onboardingIntent === undefined
            ? nothing
            : html`<span class="mode-indicator" data-test="mode-indicator">
                ${t(`mode.${this.onboardingIntent}`)}
              </span>`
        }
      </div>
      ${
        authenticated
          ? html`<div class="banner-actions">
              <wt-row-actions
                icon="person"
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

  /** Switch to a nav face AND close the drawer (Task 12). One handler for every nav item so navigating
   * on a narrow screen dismisses the off-canvas drawer in the same tap; on desktop the `drawerOpen`
   * flip is inert (the drawer is never shown there). Keeps the `screen` set the nav has always done. */
  #selectScreen(screen: ScreenId): void {
    diag.record("info", "nav", { screen });
    this.screen = this.#permittedScreen(screen);
    this.#writeScreenUrl(this.screen);
    this.drawerOpen = false;
  }

  /** A URL selects a destination only within the authenticated person's visible navigation — the core
   * nav items (gated by role), or an ACTIVE module's screen id whose `requiresPermission` the session
   * holds. A module that is enabled (active) but whose permission the person lacks is denied here, just
   * as it is hidden from the nav — the two gates agree. `requested` is never "profile" — see
   * `#applyRequestedScreen`, which intercepts that value before this ever sees it. */
  #permittedScreen(requested: string | null): ScreenId {
    if (this.sessionRole === "staff") return "my-schedule";
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

  /** Resolves BOTH `screen` and `profileOpen` from a requested URL value. "profile" means the
   * modal is open, never a `screen` itself, so it overlays whatever screen is already showing
   * rather than replacing it — UNLESS there isn't one yet (`screen` is still its pre-login
   * "login" default: a first boot, or a direct deep-link straight to `/manage/profile`), where it
   * falls back to this person's ordinary default (my-schedule for staff, otherwise
   * `#permittedScreen`'s own fallback). Leaving an ALREADY-resolved screen alone matters because
   * this method also runs on every session re-probe (`#applyMe`), including the one a successful
   * profile save triggers via `profile-updated` — at that point the url still reads "profile" (the
   * modal has not closed), and re-resolving would silently fall through to the #permittedScreen(null)
   * default and discard whatever screen the modal was actually opened over. One thing this trades
   * away: a re-probe while the modal is open still reconciles the active module set (`#activate`,
   * called earlier in `#applyMe`), but no longer re-gates the PRESERVED `screen` id through
   * `#permittedScreen` — so if a module is disabled server-side in the exact window the profile
   * modal is open, `this.screen` can keep naming that now-inactive module until the next real
   * navigation. `#renderScreen` falls through to the overview default rather than crashing, but
   * `#closeProfile` would still write the dead id into the URL. Narrow (needs a server-side
   * permission change inside one profile-modal session) and not new — `#applyRequestedScreen` did
   * not exist before this modal did, so there was no prior behaviour to preserve here. */
  #applyRequestedScreen(requested: string | null): void {
    this.profileOpen = requested === "profile";
    if (this.profileOpen && this.screen !== "login") return;
    this.screen = this.#permittedScreen(this.profileOpen ? null : requested);
  }

  /** Writes the CURRENT screen/profile state to the URL — "profile" while the modal is open (so
   * refresh and deep-links keep working), otherwise the underlying screen. */
  #writeCurrentUrl(replace: boolean): void {
    if (this.profileOpen) this.#url.write({ dashboard: "profile" }, replace);
    else this.#writeScreenUrl(this.screen, replace);
  }

  /** Opens the profile modal over whatever is current — a real navigation (PUSHed, like selecting
   * any nav item), so the browser's Back button closes it. */
  #openProfile(): void {
    this.profileOpen = true;
    this.#url.write({ dashboard: "profile" }, false);
    this.drawerOpen = false;
  }

  /** Closes the profile modal via the UI (Cancel/Escape/wt-close) — REPLACES the current entry
   * with the underlying screen's URL rather than leaving "profile" as its own stop in Back-button
   * history; a Back-button-driven close instead goes through `#onHistory` below. */
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

  /** Escape closes the open drawer (Task 12) — completing keyboard operability: open via the hamburger,
   * close via Escape, the scrim, or selecting a nav item. Bound on the `.layout` wrapper, which contains
   * every logged-in control, so a keydown anywhere inside (the hamburger, a nav button) bubbles to it.
   * A no-op when the drawer is already closed, so it never swallows Escape from anything else. */
  #onLayoutKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.drawerOpen) this.drawerOpen = false;
  }

  /** The manager nav, shown only for a NON-staff session (a `staff` person opens their schedule or profile without a sidebar). Rendered data-driven from {@link NAV_GROUPS}: the pinned first group (overview +
   * sales, the two reporting faces) leads with no header and is never collapsible, then the Menu /
   * Service / Team / Purchasing / Configuration groups, each headed by a toggle button (chevron +
   * label) that shows/hides its items — collapsed by default only via user action, and forced open
   * whenever it contains the current screen (see {@link collapsedGroups}). Each active MODULE
   * contribution appends its own item into the group whose `id` matches its `screen.group`, sorted
   * by `order`. Each item is a plain `.nav-item` button, not `wt-button` — a nav list of ~20 rows
   * reads as navigation, not a stack of buttons. The active face carries `aria-current="page"`,
   * which is what `.nav-item[aria-current="page"]` styles from. Every item keeps its stable
   * `data-test="nav-<screen>"` id. */
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

  /** "Your profile" as a modal over whichever face is current — see the note on {@link CoreScreen}
   * for why it isn't a screen itself. `<dashboard-profile-screen>` only mounts while `profileOpen`
   * is true, so a session that never opens it never pays for the `getProfile`/`getLocales`/
   * `getGoogleConfig` calls its `connectedCallback` makes. It carries its OWN edit modal for each
   * field/action (see profile-screen.ts), so opening one nests inside this one — deliberate: the
   * outer modal is a page, the inner one is the small form for whatever you're changing on it, the
   * same relationship a list screen has with its own per-row edit modal. */
  #renderProfileModal(): TemplateResult {
    return html`
      <wt-modal
        heading=${t("profile.title")}
        .open=${this.profileOpen}
        @wt-close=${(e: Event) => {
          // wt-close is composed+bubbling, and profile-screen's OWN nested edit modal (opened from
          // inside this one) dispatches the same event type — without this check, closing THAT
          // inner modal also closed this outer one, since the event bubbles straight through it.
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
   * The mounted logged-in face for the current `screen`. Reached only from the chrome branch of
   * {@link DashboardApp.render}, where `screen` is never `login`, so `overview` is the default: it is
   * every non-staff role's probe/post-login landing (Task 9), and folding it into the default keeps
   * that branch covered rather than leaving an unreachable exhaustive `default`.
   */
  #renderScreen(): TemplateResult {
    // An active module owns its own screen — paint it before the core switch.
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
      case "catalogue":
        return html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`;
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
      case "recipe":
        return html`<dashboard-recipe-screen .api=${this.api}></dashboard-recipe-screen>`;
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
