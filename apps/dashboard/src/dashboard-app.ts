import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { diag } from "./diagnostics.js";
import type { StringKey } from "./i18n/strings.js";
import { LocaleChangeController } from "./state/locale-controller.js";
// Side-effect imports register the screen elements this shell swaps between; it names them only as
// tags below, so the wiring — not the screens — is what lives here.
import "./widgets/language-chooser.js";
import "./screens/login-screen.js";
import "./screens/my-schedule-screen.js";
import "./screens/dashboard-overview-screen.js";
import "./screens/dashboard-sales-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/location-menus-screen.js";
import "./screens/layout-screen.js";
import "./screens/receipt-screen.js";
import "./screens/service-status-screen.js";
import "./screens/floor-screen.js";
import "./screens/bookings-screen.js";
import "./screens/kitchen-screen.js";
import "./screens/roster-screen.js";
import "./screens/approvals-screen.js";
import "./screens/planned-actual-screen.js";
import "./screens/purchases-screen.js";
import "./screens/recipe-screen.js";
import "./screens/devices-screen.js";
import "./screens/printers-screen.js";
import "./screens/canvas-editor-screen.js";
import "./screens/diagnostics-screen.js";
import type { DashboardApi, PersonRole } from "./api/client.js";

/**
 * The faces of the management dashboard: sign in, view your own self-service schedule, manage staff,
 * author the catalogue, arrange the till layout, edit the receipt trim, configure the table service
 * statuses, arrange the floor plan (zones + tables), configure the kitchen (stations + bump mode),
 * author the roster, work the approvals queues, review planned vs actual worked time, record received
 * purchase invoices, author ingredients and product recipes, manage enrolled devices, manage printing
 * (agents + printers + status), see today's business overview, or review sales & takings over a date
 * range. Exactly one shows at a time. `overview`, `sales`, `staff`, `catalogue`, `location-menus`,
 * `layout`, `receipt`, `statuses`, `floor`, `bookings`, `kitchen`, `roster`, `approvals`,
 * `planned-actual`, `purchases`, `recipe`, `devices`, `printers` and `canvas-editor` are the nineteen
 * non-gated MANAGER faces the nav switches between (a manager/admin session also sees the gated
 * `diagnostics`, for twenty in all) — `overview` is also
 * the post-login/post-probe LANDING for every non-staff role (Task 9); `my-schedule` is the sole face
 * of a `staff`-role session and carries no nav. All logged-in faces share the same chrome (logout, plus
 * the nav for a non-staff session).
 */
type Screen =
  | "login"
  | "my-schedule"
  | "overview"
  | "sales"
  | "staff"
  | "catalogue"
  | "location-menus"
  | "layout"
  | "receipt"
  | "statuses"
  | "floor"
  | "bookings"
  | "kitchen"
  | "roster"
  | "approvals"
  | "planned-actual"
  | "purchases"
  | "recipe"
  | "devices"
  | "printers"
  | "canvas-editor"
  | "diagnostics";

/** The viewport width at/below which the sidebar becomes the off-canvas drawer (Task 12). Kept as a
 * single source so the JS `matchMedia` query and the CSS `@media` block below cannot drift — a media
 * query cannot read a `--custom-property`, so the breakpoint is a literal in both places, and `48rem`
 * matches the existing repo precedent in `apps/till/src/screens/till-counter-screen.ts:111`. */
const DRAWER_BREAKPOINT = "(max-width: 48rem)";

/** One nav entry: the face it switches to, the i18n key for its label, and whether it is manager-gated
 * (`requiresManager` hides it from a `supervisor` session — `#nav()` filters on it before mapping). */
type NavItem = { screen: Screen; labelKey: StringKey; requiresManager?: boolean };
/** One sidebar group: an optional header label (the pinned first group has none) and its items. */
type NavGroup = { headerKey?: StringKey; items: NavItem[] };

/**
 * The grouped, DATA-DRIVEN sidebar. `#nav()` renders this in a loop, so the manager faces are
 * described here once rather than spelled out one-by-one in the template. The pinned first group
 * (overview + sales) carries no header — the two reporting faces lead. Each item keeps the stable
 * `data-test="nav-<screen>"` id every downstream consumer (tests included) pins.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { screen: "overview", labelKey: "nav.overview" },
      { screen: "sales", labelKey: "nav.sales" },
    ],
  },
  {
    headerKey: "nav.group.menu",
    items: [
      { screen: "catalogue", labelKey: "nav.catalogue" },
      { screen: "location-menus", labelKey: "nav.location_menus" },
      { screen: "recipe", labelKey: "nav.recipe" },
    ],
  },
  {
    headerKey: "nav.group.service",
    items: [
      { screen: "floor", labelKey: "nav.floor" },
      { screen: "bookings", labelKey: "nav.bookings" },
      { screen: "statuses", labelKey: "nav.statuses" },
      { screen: "kitchen", labelKey: "nav.kitchen" },
    ],
  },
  {
    headerKey: "nav.group.team",
    items: [
      { screen: "staff", labelKey: "nav.staff" },
      { screen: "roster", labelKey: "nav.roster" },
      { screen: "approvals", labelKey: "nav.approvals" },
      { screen: "planned-actual", labelKey: "nav.planned_actual" },
    ],
  },
  {
    headerKey: "nav.group.purchasing",
    items: [{ screen: "purchases", labelKey: "nav.purchases" }],
  },
  {
    headerKey: "nav.group.configuration",
    items: [
      { screen: "layout", labelKey: "nav.layout" },
      { screen: "receipt", labelKey: "nav.receipt" },
      { screen: "devices", labelKey: "nav.devices" },
      { screen: "printers", labelKey: "nav.printers" },
      { screen: "canvas-editor", labelKey: "nav.canvases" },
      { screen: "diagnostics", labelKey: "nav.diagnostics", requiresManager: true },
    ],
  },
];

/**
 * The management dashboard's ROOT element — the shell that turns the screens into a working app.
 *
 * It owns one thing the whole flow shares: the injected {@link DashboardApi}. It runs a screen
 * machine (`login` | `my-schedule` | `overview` | `sales` | `staff` | `catalogue` | `location-menus` |
 * `layout` | `receipt` | `statuses` | `floor` | `kitchen` | `roster` | `approvals` | `planned-actual` |
 * `purchases` | `recipe` | `devices` | `printers`) and does the event wiring the screens deliberately
 * do not:
 *
 *  - boot → a SESSION PROBE ({@link DashboardApp.#probeSession}) calls `api.getMe()` (WHOAMI); a
 *    success means a live management session, so it applies the resolved role — a `staff` person
 *    lands on the self-service `my-schedule` screen, a manager/supervisor/admin on the business
 *    `overview` screen (registered Task 9 — the "today at a glance" home) — while ANY rejection (the
 *    common `management_session.required`/401, or a stray/network error) means no usable session, so
 *    it opens on `login`. The probe is fully wrapped
 *    — an unhandled rejection here would be the exact `apps/till` `#boot` defect (`docs/backlog.md`),
 *    so this shell mirrors the login/staff screens' own `try/catch`ed loaders instead;
 *  - `logged-in` (from the login screen, on a successful `api.login`) → re-probe `getMe()` to learn
 *    the freshly-authenticated person's role, then land on `my-schedule` or `overview` the same way;
 *  - the NAV (the shell's own control, shown only for a NON-staff logged-in session) switches between
 *    the nineteen non-gated manager faces `overview`, `sales`, `staff`, `catalogue`, `location-menus`,
 *    `layout`, `receipt`, `statuses`, `floor`, `bookings`, `kitchen`, `roster`, `approvals`,
 *    `planned-actual`, `purchases`, `recipe`, `devices`, `printers` and `canvas-editor` (plus the gated
 *    `diagnostics`) — a plain local state change, no
 *    server call. A `staff` session has no
 *    nav (the self-service view is its only face);
 *  - `logout` (the shell's own control, logged-in only) → end the server session, back to `login`.
 *
 * The default screen is `login`: before the probe resolves the shell shows the sign-in screen, and
 * only a successful probe switches it to a logged-in face — so a not-logged-in cold load never
 * flashes a screen it is not entitled to.
 *
 * HEADING OUTLINE. Each screen owns its OWN top heading — `dashboard-my-schedule-screen` renders the
 * sole `<h1>Mi horario</h1>`, `dashboard-overview-screen` the sole `<h1>Hoy de un vistazo</h1>`,
 * `dashboard-sales-screen` the sole `<h1>Ventas y recaudación</h1>`, `dashboard-staff-screen` the sole
 * `<h1>Usuarios</h1>`, `dashboard-catalogue-screen` the sole `<h1>Carta</h1>`,
 * `dashboard-location-menus-screen` the sole `<h1>Menús por local</h1>`,
 * `dashboard-layout-screen` the sole `<h1>Disposición</h1>`, `dashboard-receipt-screen` the sole
 * `<h1>Recibo</h1>`, `dashboard-service-status-screen` the sole `<h1>Estados de servicio</h1>`,
 * `dashboard-floor-screen` the sole `<h1>Sala</h1>`, `dashboard-kitchen-screen` the sole
 * `<h1>Cocina</h1>`, `dashboard-roster-screen` the sole `<h1>Turnos</h1>`,
 * `dashboard-approvals-screen` the sole `<h1>Aprobaciones</h1>`, `dashboard-planned-actual-screen`
 * the sole `<h1>Previsto vs real</h1>`, `dashboard-purchases-screen` the sole `<h1>Compras</h1>`,
 * `dashboard-recipe-screen` the sole `<h1>Recetas</h1>`, `dashboard-devices-screen` the sole
 * `<h1>Dispositivos</h1>`, `dashboard-printers-screen` the sole `<h1>Impresoras</h1>`, and
 * `dashboard-login-screen`
 * none — so the shell adds no competing `<h1>`: its logged-in chrome is a two-column layout — a
 * sidebar `<nav>` (whose group labels are `<h2 class="nav-group">`, never `<h1>`) beside a `<header
 * class="topbar">` carrying the language chooser + logout button — keeping exactly one `<h1>` in the
 * DOM at a time.
 *
 * DISCONNECT SAFETY (per-user-language-preference). `setLocale` mutates module-global locale, so it is
 * the one effect that can outlive the element. It runs on FOUR post-await paths, and each carries
 * `if (!this.isConnected) return` before the switch so a teardown during the await skips it —
 * {@link DashboardApp.#seedLocale} (the boot venue-default seed), {@link DashboardApp.#applyMe} (invoked
 * as `#applyMe(await getMe())`, so the probe's round trip is the await), {@link DashboardApp.#onLogout}
 * (the venue-default revert, after the logout round trip) and {@link DashboardApp.#onLocaleSelected}'s
 * PERSIST path (the preference write has already landed and the next login re-applies it, so only the
 * pointless local repaint is skipped). The TRANSIENT (`screen === "login"`) branch of
 * `#onLocaleSelected` runs its `setLocale` SYNCHRONOUSLY before any await, so it needs no guard. Each
 * guarded site is pinned by a deletion-proven disconnect test. Every OTHER state write here is
 * reactive-only and needs no guard — Lit never paints a detached element.
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

      /* Two-column app chrome: a fixed-width sidebar beside the scrolling main column. */
      .layout {
        display: flex;
        align-items: stretch;
        min-height: 100vh;
      }

      /* The desktop sidebar: fixed width, scrolls vertically on its own when the nav is tall. */
      .sidebar {
        flex: 0 0 var(--dashboard-sidebar-width);
        box-sizing: border-box;
        max-height: 100vh;
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

      /* Group header: a quiet, small label above its items — not a competing heading. */
      .nav-group {
        margin: var(--wt-space-3) 0 var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The main column: top bar (chooser + logout) over the scrolling screen body. */
      .main {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      /* The hamburger that opens the off-canvas drawer. Hidden at desktop width (the sidebar is always
         in-flow there); the narrow-screen media query below reveals it. Pushed to the LEADING edge so
         the chooser + logout stay grouped at the trailing edge (the topbar is otherwise flex-end). */
      .nav-toggle {
        display: none;
        margin-inline-end: auto;
      }

      /* The veil behind the open drawer: it dims the main column and closes the drawer on a tap. Only
         rendered while the drawer is open, and the drawer only opens on narrow screens — crossing to
         desktop force-closes it (#onBreakpointChange), so this full-viewport veil never shows at
         desktop width. Sits under the sliding sidebar but over the main content. */
      .scrim {
        position: fixed;
        inset: 0;
        z-index: 20;
        background: var(--wt-color-scrim);
      }

      .body {
        padding: var(--wt-space-4);
      }

      /* Narrow screens (a phone or a split view): the sidebar becomes an off-canvas DRAWER. It leaves
         the flow (position: fixed, translated off the leading edge) and slides in when the layout gains
         the drawer-open class; the hamburger appears to toggle it. A CSS media query cannot read a
         --custom-property, so the breakpoint is a literal here (and mirrored in the JS DRAWER_BREAKPOINT
         constant that drives the narrow state); 48rem matches the existing repo precedent in
         apps/till/src/screens/till-counter-screen.ts:111. */
      @media (max-width: 48rem) {
        .nav-toggle {
          display: inline-block;
        }
        .sidebar {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
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

  /** Which screen is showing. Defaults to `login`, so a cold load never flashes a logged-in face
   * before the probe confirms a session (see the class doc). */
  @state() private screen: Screen = "login";

  /** Whether the off-canvas nav drawer is open (Task 12). Only meaningful on narrow screens, where the
   * sidebar slides in over the main column; at desktop width the sidebar is always in-flow and the
   * hamburger + scrim are hidden, so this flag is inert there. The hamburger toggles it, and selecting
   * ANY nav item — or clicking the scrim — sets it back to `false`. */
  @state() private drawerOpen = false;

  /** Whether the viewport is at/below the drawer breakpoint (Task 12). Tracked from `matchMedia` so the
   * shell knows when the sidebar is off-canvas: a CLOSED off-canvas sidebar must be made `inert` (see
   * render) or its twenty nav buttons stay in the tab order and a11y tree while translated off-screen,
   * so a keyboard user would tab through twenty invisible controls before reaching a visible one. At
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

  /**
   * The venue's DERIVED default UI locale (per-user-language-preference), read from
   * `GET /management-api/locales` on boot ({@link #seedLocale}) — the dashboard has no venue locale until
   * this task, so it SEEDS the login screen in the venue's language. It is also the fallback
   * `resolveActiveLocale(personLocale, this.#venueLocale)` falls back to on login ({@link #applyMe}) when
   * the signed-in person has no stored preference. Defaults to the deli's es-ES until boot resolves.
   */
  #venueLocale = "es-ES";

  constructor() {
    super();
    // Follow a locale switch made anywhere (seed/login/the chooser's setLocale): on a locale change the
    // controller calls requestUpdate(), re-running render() so `keyed(currentLocale(), …)` re-keys and the
    // screen repaints. The screens read `t()` at render time, so recreating them applies the switch.
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
  }

  override disconnectedCallback(): void {
    this.#breakpoint?.removeEventListener("change", this.#onBreakpointChange);
    this.#breakpoint = undefined;
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    void this.#boot();
  }

  /**
   * Boot: probe for a session, THEN — only when none was found (still on `login`) — seed the login
   * screen in the venue's language. The two are serialized deliberately, not raced:
   *  - a LOGGED-IN probe's {@link #applyMe} already sets the UI locale from the WHOAMI (`me.locale`
   *    resolved against `me.venueLocale`) and remembers `venueLocale`, so a venue-default seed
   *    afterwards would both fire a REDUNDANT `getLocales` and risk CLOBBERING the person's applied
   *    locale. Gating the seed on `screen === "login"` removes both — the logged-in path makes exactly
   *    one WHOAMI round trip;
   *  - a NO-SESSION probe leaves `screen === "login"`, so the seed runs and localises the sign-in screen.
   * `#probeSession` swallows its own rejection (→ `login`), so this never throws.
   */
  async #boot(): Promise<void> {
    await this.#probeSession();
    if (this.screen === "login") await this.#seedLocale();
  }

  /**
   * Read the venue's offered languages and SEED the UI to the venue default, so the pre-auth login
   * screen renders in the venue's language rather than the module default. Reached only from {@link #boot}
   * on the no-session path. A failure (server unreachable, a non-2xx `{ code }`) is swallowed — the UI
   * simply stays on the module default; this is cosmetic pre-auth polish, never a reason to block sign-in.
   */
  async #seedLocale(): Promise<void> {
    try {
      const { venueDefault } = await this.api.getLocales();
      // Guard the post-await module-global `setLocale`: a teardown during the fetch must not repaint a
      // live sibling's locale (the DISCONNECT SAFETY note). The `#venueLocale` write below the guard is
      // harmless to skip on a detached element — nothing reads it after teardown.
      if (!this.isConnected) return;
      this.#venueLocale = venueDefault;
      setLocale(venueDefault);
    } catch {
      // Stay on the module default — a failed locale read must never block sign-in.
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
  async #probeSession(): Promise<void> {
    try {
      this.#applyMe(await this.api.getMe());
    } catch {
      this.screen = "login";
    }
  }

  /** Land a resolved whoami on the right face: a `staff` person on the self-service `my-schedule`
   * screen, every other role (supervisor/manager/admin) on the business `overview` screen — the
   * post-login landing since Task 9 (previously the manager `staff` screen; `staff` is still one nav
   * click away). Records the id + role the shell and screen both read. The ONE place the role→screen
   * branch lives, shared by the boot probe and the post-login re-probe.
   *
   * Per-user-language-preference: also apply the signed-in person's UI language —
   * `resolveActiveLocale(me.locale, me.venueLocale)`, their supported stored choice else the venue
   * default — and remember the venue default for later. `#applyMe` is invoked as `#applyMe(await
   * getMe())`, so the module-global `setLocale` runs POST-AWAIT: a teardown during the probe must not
   * repaint a live sibling's locale (the DISCONNECT SAFETY note). The reactive state writes above the
   * guard are harmless on a detached element (Lit never paints one), so only `setLocale` is guarded. */
  #applyMe(me: {
    personId: string;
    role: PersonRole;
    locale: string | null;
    venueLocale: string;
  }): void {
    this.myPersonId = me.personId;
    this.sessionRole = me.role;
    this.screen = me.role === "staff" ? "my-schedule" : "overview";
    this.#venueLocale = me.venueLocale;
    if (!this.isConnected) return;
    setLocale(resolveActiveLocale(me.locale, me.venueLocale));
  }

  /**
   * A confirmed login from `dashboard-login-screen`. `stopPropagation` keeps the composed, bubbling
   * `logged-in` inside the shell (the house pattern — the shell is its final consumer, so it must not
   * leak on to the document past the shadow boundary). The login route returns only `{ personId }`, so
   * the shell re-probes `getMe()` to learn the freshly-authenticated role and land on the right face.
   */
  #onLoggedIn(event: Event): void {
    event.stopPropagation();
    void this.#probeSession();
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
    this.screen = "login";
    // Revert the UI to the venue default (per-user-language-preference): the previous operator's chosen
    // language must not linger into the login screen the next person meets — their own login re-applies
    // their stored preference. Guard the post-await module-global `setLocale` (the DISCONNECT SAFETY
    // note): a teardown during the logout round trip must not repaint a live sibling's locale.
    if (!this.isConnected) return;
    setLocale(this.#venueLocale);
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
      // The login screen's own chooser bubbles its composed `locale-selected` up to this `<div>`, where
      // `#onLocaleSelected` turns a pre-login pick into a transient switch. `keyed(currentLocale(), …)`
      // recreates the login screen on a locale change so it repaints in the new language (it holds no controller).
      return html`<div
        class="body"
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        ${keyed(
          currentLocale(),
          html`<dashboard-login-screen
            .api=${this.api}
            @logged-in=${(event: Event) => this.#onLoggedIn(event)}
          ></dashboard-login-screen>`,
        )}
      </div>`;
    }
    // A non-staff session carries the nav; a staff person has only the self-service view, so it gets no
    // sidebar, no hamburger and no drawer at all.
    const hasNav = this.sessionRole !== "staff";
    return html`
      <div
        class=${classMap({ layout: true, "drawer-open": hasNav && this.drawerOpen })}
        @keydown=${(e: KeyboardEvent) => this.#onLayoutKeydown(e)}
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        <!-- The sidebar, shown only for a non-staff session. At desktop width it is in-flow; below the
             breakpoint (Task 12) it becomes the off-canvas drawer the hamburger toggles. When it is
             off-canvas AND closed (narrow && not drawerOpen) it is inert, so its twenty nav buttons
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
          <header class="topbar">
            <!-- The hamburger: opens/closes the off-canvas drawer. Present only for a non-staff session
                 (a staff person has no nav to reveal); hidden at desktop width by the CSS above. -->
            ${
              hasNav
                ? html`<wt-button
                    class="nav-toggle"
                    variant="ghost"
                    data-test="nav-toggle"
                    aria-label=${t("nav.toggle")}
                    @click=${() => (this.drawerOpen = !this.drawerOpen)}
                    >☰</wt-button
                  >`
                : nothing
            }
            <dashboard-language-chooser
              .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
            ></dashboard-language-chooser>
            <wt-button variant="secondary" data-test="logout" @click=${() => void this.#onLogout()}
              >${t("action.logout")}</wt-button
            >
          </header>
          <!-- keyed on the active locale: a switch changes the key, so Lit discards and rebuilds the
               screen subtree, repainting every child in the new language (screens hold no controller). -->
          <div class="body">${keyed(currentLocale(), this.#renderScreen())}</div>
        </div>
      </div>
    `;
  }

  /** Switch to a nav face AND close the drawer (Task 12). One handler for every nav item so navigating
   * on a narrow screen dismisses the off-canvas drawer in the same tap; on desktop the `drawerOpen`
   * flip is inert (the drawer is never shown there). Keeps the `screen` set the nav has always done. */
  #selectScreen(screen: Screen): void {
    diag.record("info", "nav", { screen });
    this.screen = screen;
    this.drawerOpen = false;
  }

  /** Escape closes the open drawer (Task 12) — completing keyboard operability: open via the hamburger,
   * close via Escape, the scrim, or selecting a nav item. Bound on the `.layout` wrapper, which contains
   * every logged-in control, so a keydown anywhere inside (the hamburger, a nav button) bubbles to it.
   * A no-op when the drawer is already closed, so it never swallows Escape from anything else. */
  #onLayoutKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.drawerOpen) this.drawerOpen = false;
  }

  /** The manager nav — the twenty-face switcher, shown only for a NON-staff session (a `staff` person
   * has just the self-service view, so no nav). Rendered data-driven from {@link NAV_GROUPS}: the
   * pinned first group (overview + sales, the two reporting faces) leads with no header, then the
   * Menu / Service / Team / Purchasing / Configuration groups, each headed by an `<h2 class="nav-group">`.
   * The ACTIVE face is `variant="primary"` + `aria-current="page"`; the rest are `variant="secondary"`.
   * Every item keeps its stable `data-test="nav-<screen>"` id. */
  #nav(): TemplateResult {
    return html`
      <nav class="nav" aria-label=${t("nav.sections")}>
        ${NAV_GROUPS.map(
          (group) => html`
            ${group.headerKey ? html`<h2 class="nav-group">${t(group.headerKey)}</h2>` : nothing}
            ${group.items
              .filter(
                (item) =>
                  !item.requiresManager ||
                  this.sessionRole === "manager" ||
                  this.sessionRole === "admin",
              )
              .map(
                (item) =>
                  html`<wt-button
                    class="nav-item"
                    variant=${this.screen === item.screen ? "primary" : "secondary"}
                    aria-current=${this.screen === item.screen ? "page" : nothing}
                    data-test="nav-${item.screen}"
                    @click=${() => this.#selectScreen(item.screen)}
                    >${t(item.labelKey)}</wt-button
                  >`,
              )}
          `,
        )}
      </nav>
    `;
  }

  /**
   * The mounted logged-in face for the current `screen`. Reached only from the chrome branch of
   * {@link DashboardApp.render}, where `screen` is never `login`, so `overview` is the default: it is
   * every non-staff role's probe/post-login landing (Task 9), and folding it into the default keeps
   * that branch covered rather than leaving an unreachable exhaustive `default`.
   */
  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "my-schedule":
        return html`<dashboard-my-schedule-screen
          .api=${this.api}
          .myPersonId=${this.myPersonId}
        ></dashboard-my-schedule-screen>`;
      case "sales":
        return html`<dashboard-sales-screen .api=${this.api}></dashboard-sales-screen>`;
      case "staff":
        return html`<dashboard-staff-screen .api=${this.api}></dashboard-staff-screen>`;
      case "catalogue":
        return html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`;
      case "location-menus":
        return html`<dashboard-location-menus-screen
          .api=${this.api}
        ></dashboard-location-menus-screen>`;
      case "layout":
        return html`<dashboard-layout-screen .api=${this.api}></dashboard-layout-screen>`;
      case "receipt":
        return html`<dashboard-receipt-screen .api=${this.api}></dashboard-receipt-screen>`;
      case "statuses":
        return html`<dashboard-service-status-screen
          .api=${this.api}
        ></dashboard-service-status-screen>`;
      case "floor":
        return html`<dashboard-floor-screen .api=${this.api}></dashboard-floor-screen>`;
      case "bookings":
        return html`<dashboard-bookings-screen .api=${this.api}></dashboard-bookings-screen>`;
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
      case "printers":
        return html`<dashboard-printers-screen .api=${this.api}></dashboard-printers-screen>`;
      case "canvas-editor":
        return html`<dashboard-canvas-editor-screen
          .api=${this.api}
        ></dashboard-canvas-editor-screen>`;
      case "diagnostics":
        return html`<dashboard-diagnostics-screen .api=${this.api}></dashboard-diagnostics-screen>`;
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
