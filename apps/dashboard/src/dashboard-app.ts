import { LeaveController, navigationGuardFor, type LeaveReason } from "@waitron/ui";
import { dashboardPath, leftToBrowser } from "./navigation.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  chooseTheme,
  iconButtonStyles,
  ThemeChoiceController,
  themeChoices,
  themeChoicesStyles,
  themeLabelsPerLocale,
  trackIconTooltip,
  UrlStateController,
  setHelpMode,
  type ThemeChoice,
  type WtInput,
  type WtToast,
} from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import { navMatches, destinationMatches, type NavSearchDestination } from "./nav-search.js";
import { collectSearchDestinations } from "./nav-destinations.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-toast.js";
import "@waitron/ui/src/components/wt-banner.js";
import "@waitron/ui/src/components/wt-help-switch.js";
import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";
import { currentLocale, setLocale, t, fill } from "./i18n/t.js";
import { codeOf, codeMessage } from "./i18n/codes.js";
import { setContentLanguages } from "@waitron/ui";
import { DashboardQueries } from "./api/query-controller.js";
import { diag } from "./diagnostics.js";
import { signalAcceptedPasskeys } from "./passkey-signals.js";
import type { StringKey } from "./i18n/strings.js";
// Modules are mounted generically from the browser-safe registry, never named here. `tKit` is the
// kit's untyped resolver: a module's label keys are not in the app's `StringKey` union.
import {
  CALENDAR_OWN_VIEW_IDS,
  registerCatalogue,
  t as tKit,
  type CalendarViewEntry,
  type DashboardCalendarView,
  type DashboardFurtherScreen,
  type DashboardRequest,
  type DashboardScreenHandle,
  type DashboardScreenPlacement,
  type DashboardSettingsPanel,
  type NavGroupId,
} from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { LocaleChangeController } from "./state/locale-controller.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import "@waitron/ui/src/components/wt-theme-chooser.js";
import "@waitron/ui/src/components/wt-demo-bar.js";
import "./screens/login-screen.js";
import "./screens/profile-screen.js";
import type { ProfileScreen } from "./screens/profile-screen.js";
import "./screens/my-schedule-screen.js";
import "./screens/dashboard-overview-screen.js";
import "./screens/dashboard-sales-screen.js";
import "./screens/vat-return-screen.js";
import "./screens/orders-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/modifiers-screen.js";
import "./screens/menus-screen.js";
import "./screens/units-screen.js";
import "./screens/department-receipt-dialog.js";
import "./screens/venue-details-panel.js";
import "./screens/venue-defaults-panel.js";
import "./screens/content-languages-screen.js";
import "./screens/service-status-screen.js";
import "./screens/kitchen-screen.js";
import { VENUE_SETTINGS_TABS, TAB_LABELS } from "./screens/venue-settings-screen.js";
import type { VenueSettingsPanel, VenueSettingsTab } from "./screens/venue-settings-screen.js";
import "./screens/approvals-screen.js";
import "./screens/planned-actual-screen.js";
import "./screens/purchases-screen.js";
import "./screens/devices-screen.js";
import "./screens/printers-screen.js";
import "./screens/floor-plan-editor.js";
import "./screens/device-profiles-screen.js";
import "./screens/diagnostics-screen.js";
import "./screens/backup-screen.js";
import "./screens/servers-screen.js";
import "./screens/cloud-services-screen.js";
import "./screens/email-screen.js";
import "./screens/demo-printer-screen.js";
import "./screens/demo-reader-screen.js";
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
const CORE_SCREENS = [
  "login",
  "my-schedule",
  "overview",
  "sales",
  "vat-return",
  "orders",
  "staff",
  "catalogue",
  "modifiers",
  "menus",
  "units",
  "content-languages",
  "venue-settings",
  "approvals",
  "planned-actual",
  "purchases",
  "devices",
  "printers",
  "floor-plan",
  "device-profiles",
  "diagnostics",
  "backup",
  "servers",
  "cloud",
  "email",
  "demo-printer",
  "demo-reader",
  "payments",
  "alerts",
] as const;
type CoreScreen = (typeof CORE_SCREENS)[number];

/** The `& {}` keeps the `CoreScreen` literal autocomplete while admitting any module id. */
type ScreenId = CoreScreen | (string & {});

/** Repeated as a literal in this file's CSS and in widgets/alerts-bell.ts, since a media query
 * cannot read a custom property, and in FOLDED_BY_DEFAULT below. */
const DRAWER_BREAKPOINT = "(max-width: 48rem)";

/** A tablet-width window, whose sidebar opens folded while no choice is stored. */
const FOLDED_BY_DEFAULT = "(48rem < width <= 64rem)";
const SIDEBAR_FOLDED_KEY = "waitron-dashboard-sidebar-folded";

function readStoredFold(): boolean | undefined {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_FOLDED_KEY);
    return stored === "true" ? true : stored === "false" ? false : undefined;
  } catch {
    return undefined;
  }
}

function storeFold(folded: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_FOLDED_KEY, String(folded));
  } catch {
    // Remembering the choice is a convenience; the sidebar works without it.
  }
}

const WAITRON_LOGO_URL = new URL("../../../packages/ui/brand/waitron-lockup.svg", import.meta.url)
  .href;
const WAITRON_LOGO_DARK_URL = new URL(
  "../../../packages/ui/brand/waitron-lockup-dark.svg",
  import.meta.url,
).href;

function darkLogoMedia(choice: ThemeChoice): string {
  if (choice === "dark") return "all";
  if (choice === "light") return "not all";
  return "(prefers-color-scheme: dark)";
}

type AccessRule = {
  requiresManager?: boolean;
  requiresPermission?: string;
};
type ScreenRule = AccessRule & { screen: ScreenId };
type NavItem = ScreenRule & { labelKey: StringKey };
type NavGroup = {
  id: NavGroupId;
  headerKey?: StringKey;
  icon: string;
  items: NavItem[];
  itemsAfterModules?: NavItem[];
};

const coreItems = (group: NavGroup): NavItem[] => [
  ...group.items,
  ...(group.itemsAfterModules ?? []),
];
/** A nav row as shown: a core item or a module's screen, labelled in the current language. */
type NavPage = { screen: ScreenId; label: string };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    icon: "section-overview",
    items: [{ screen: "overview", labelKey: "nav.overview" }],
  },
  {
    id: "reports",
    headerKey: "nav.group.reports",
    icon: "section-reports",
    items: [
      { screen: "sales", labelKey: "nav.sales" },
      { screen: "vat-return", labelKey: "nav.vat_return", requiresPermission: "report.export" },
    ],
    itemsAfterModules: [{ screen: "orders", labelKey: "nav.orders" }],
  },
  {
    id: "service",
    headerKey: "nav.group.service",
    icon: "section-service",
    items: [],
  },
  {
    id: "menu",
    headerKey: "nav.group.menu",
    icon: "section-menu",
    items: [
      { screen: "catalogue", labelKey: "nav.catalogue" },
      { screen: "menus", labelKey: "nav.menus", requiresManager: true },
      { screen: "modifiers", labelKey: "nav.modifiers", requiresManager: true },
      { screen: "units", labelKey: "nav.units" },
    ],
  },
  {
    id: "operations",
    headerKey: "nav.group.operations",
    icon: "section-operations",
    items: [],
    itemsAfterModules: [{ screen: "venue-settings", labelKey: "nav.venue_settings" }],
  },
  {
    id: "team",
    headerKey: "nav.group.team",
    icon: "section-team",
    items: [
      { screen: "staff", labelKey: "nav.staff" },
      { screen: "approvals", labelKey: "nav.approvals" },
      { screen: "planned-actual", labelKey: "nav.planned_actual" },
    ],
  },
  {
    id: "purchasing",
    headerKey: "nav.group.purchasing",
    icon: "section-purchasing",
    items: [{ screen: "purchases", labelKey: "nav.purchases" }],
  },
  {
    id: "configuration",
    headerKey: "nav.group.configuration",
    icon: "gear",
    items: [
      {
        screen: "content-languages",
        labelKey: "nav.content_languages",
        requiresPermission: "catalogue.manage",
      },
      { screen: "devices", labelKey: "nav.devices" },
      { screen: "printers", labelKey: "nav.printers" },
      { screen: "payments", labelKey: "nav.payments", requiresManager: true },
      { screen: "device-profiles", labelKey: "nav.device_profiles" },
      { screen: "diagnostics", labelKey: "nav.diagnostics", requiresManager: true },
      { screen: "backup", labelKey: "nav.backup", requiresManager: true },
      { screen: "servers", labelKey: "nav.servers", requiresPermission: "mirror.create" },
      { screen: "cloud", labelKey: "nav.cloud", requiresManager: true },
    ],
  },
];

/** Core screens with no sidebar entry whose access rule #permittedScreen reads from here. */
const UNLISTED_SCREENS: ScreenRule[] = [
  { screen: "my-schedule" },
  { screen: "email", requiresManager: true },
  { screen: "demo-printer", requiresManager: true },
  { screen: "demo-reader", requiresManager: true },
  { screen: "floor-plan", requiresPermission: "venue.configure" },
];

type CoreSettingsPanel = AccessRule & {
  key: string;
  tab: VenueSettingsTab;
  render(api: DashboardApi, canConfigure: boolean): TemplateResult;
};

const CORE_SETTINGS_PANELS: readonly CoreSettingsPanel[] = [
  {
    key: "venue-details",
    tab: "venue-details",
    requiresPermission: "venue.view",
    render: (api, canConfigure) =>
      html`<dashboard-venue-details-panel
        .api=${api}
        .readOnly=${!canConfigure}
      ></dashboard-venue-details-panel>`,
  },
  {
    key: "defaults",
    tab: "venue-details",
    requiresPermission: "venue.configure",
    render: (api) =>
      html`<dashboard-venue-defaults-panel .api=${api}></dashboard-venue-defaults-panel>`,
  },
  {
    key: "statuses",
    tab: "tables",
    render: (api, canConfigure) =>
      html`<dashboard-service-status-screen
        .api=${api}
        .readOnly=${!canConfigure}
      ></dashboard-service-status-screen>`,
  },
  {
    key: "kitchen",
    tab: "kitchen",
    render: (api, canConfigure) =>
      html`<dashboard-kitchen-screen
        .api=${api}
        .readOnly=${!canConfigure}
      ></dashboard-kitchen-screen>`,
  },
];

/**
 * Owns session discovery, permitted URL navigation and language preferences.
 * The login screen stays visible until getMe confirms a session. Staff can open My schedule and
 * Orders; other roles can restore a destination from their visible sidebar entries, the alerts
 * screen, and the UNLISTED_SCREENS entries their role may open.
 *
 * A locale change recreates the screen subtree so translated text updates. Disconnect guards
 * prevent late responses from changing browser history or the shared locale after teardown.
 * Each screen owns its heading; the shell supplies navigation, logout, and the language and Theme
 * choices.
 */
@customElement("dashboard-app")
export class DashboardApp extends LitElement {
  static override styles = [
    baseStyles,
    iconButtonStyles,
    themeChoicesStyles,
    css`
      /* Fills the page's content box (index.html sizes it to the window), so the page's own padding
         stays inside the window rather than below it. */
      :host {
        display: block;
        height: 100%;
        --dashboard-sidebar-width: 34ch;
        --dashboard-strip-panel-width: 24ch;
      }

      /* The banner owns the first full-width row; navigation and content share the row below it.
         A firm height (not min-height) bounds the shell to the page, never more than one screen, so
         overflow below the banner has to happen INSIDE .sidebar/.main (each scrolls independently)
         rather than by growing the whole page — see .sidebar and .main below. */
      .shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 100vh;
      }

      /* Two-column app chrome below the banner: a fixed-width sidebar beside the main column. */
      .layout {
        display: flex;
        position: relative;
        flex: 1 1 auto;
        align-items: stretch;
        min-height: 0;
      }

      .sidebar {
        flex: 0 0 var(--dashboard-sidebar-width);
        box-sizing: border-box;
        max-height: 100%;
        overflow-y: auto;
        padding: var(--wt-space-3);
        border-right: 1px solid var(--wt-color-border);
        box-shadow: var(--wt-shadow-1);
      }

      .sidebar.folded {
        flex-basis: calc(var(--wt-tap-min) + 2 * var(--wt-space-2) + 1px);
        /* The tooltips lie outside the strip, beside its buttons. */
        overflow: visible;
        padding: var(--wt-space-2);
      }

      /* A phone held sideways is wider than the drawer's breakpoint and too short for every icon,
         so there the strip scrolls, and clips its tooltips; each button keeps its name. */
      @media (max-height: 40rem) {
        .sidebar.folded {
          overflow-y: auto;
        }
      }

      .strip {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--wt-space-1);
      }

      .icon-button.strip-button,
      .icon-button.strip-button:is([aria-pressed="true"], [aria-expanded="true"]) {
        border: none;
        border-inline-start: 3px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--wt-color-text);
      }

      .icon-button.strip-button:hover {
        background: var(--wt-color-surface);
      }

      .icon-button.strip-button[aria-current="true"] {
        border-inline-start-color: var(--wt-color-primary);
        background: var(--wt-color-surface-lifted);
      }

      .strip-button > .icon-tooltip {
        inset-block-start: 50%;
        inset-inline-start: calc(100% + var(--wt-space-1));
        transform: translateY(-50%);
      }

      /* As specific as the shared hover rule, which would otherwise show it under the open panel. */
      .icon-button.strip-button[aria-expanded="true"] > .icon-tooltip {
        display: none;
      }

      /* Over the content column, under the phone drawer's layers, which never show with the strip. */
      .strip-panel {
        position: absolute;
        z-index: 10;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        max-height: 100%;
        overflow-y: auto;
        min-width: var(--dashboard-strip-panel-width);
        padding: var(--wt-space-2) 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-bg);
        box-shadow: var(--wt-shadow-1);
      }

      .strip-panel-label {
        padding: var(--wt-space-1) var(--wt-space-3);
      }

      .strip-button > .icon-tooltip::before {
        inset-block: 0;
        inset-inline: auto 100%;
        block-size: auto;
        inline-size: var(--wt-space-1);
      }

      .nav {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .nav > wt-input {
        margin-block-end: var(--wt-space-2);
      }

      /* Rendered even while empty, so the live region exists before its message does; with no
         block padding it takes no height then. */
      .nav-search-empty {
        margin: 0;
        padding-inline: var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .nav-group {
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: var(--wt-space-1);
        width: 100%;
        min-height: var(--wt-tap-min);
        margin: var(--wt-space-1) 0 0;
        padding: var(--wt-space-3);
        border: none;
        border-inline-start: 3px solid transparent;
        background: transparent;
        font: inherit;
        line-height: var(--wt-font-size-lg);
        text-align: start;
        cursor: pointer;
      }

      /* After .nav-group's own rule, whose font shorthand would reset the size and weight. */
      .nav-group,
      .strip-panel-label {
        color: var(--wt-color-primary-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      button.nav-group:hover {
        background: var(--wt-color-surface);
      }

      div.nav-group {
        cursor: default;
      }

      .nav-group .group-icon {
        position: absolute;
        inset-inline-start: calc(-1 * var(--wt-space-1));
        margin-block-start: calc((var(--wt-font-size-lg) - var(--wt-font-size-sm)) / 2);
      }

      .nav-group-label {
        flex: 1;
        min-width: 0;
      }

      .nav-group .chevron-space {
        flex-shrink: 0;
        width: var(--wt-space-4);
      }

      .nav-group .chevron {
        flex-shrink: 0;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        margin-block-start: calc((var(--wt-font-size-lg) - var(--wt-space-4)) / 2);
        opacity: 0;
        transition: transform 150ms ease;
      }

      .nav-group:hover .chevron,
      .nav-group:focus-visible .chevron {
        opacity: 1;
      }

      @media (hover: none) {
        .nav-group .chevron {
          opacity: 1;
        }
      }

      .nav-group[aria-expanded="true"] .chevron {
        transform: rotate(180deg);
      }

      .nav-item,
      .nav-destination {
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

      @media (pointer: fine) {
        .nav-item,
        .nav-destination,
        .nav-group {
          min-height: var(--wt-space-6);
          padding-block: var(--wt-space-1);
        }
      }

      .nav-item:hover,
      .nav-destination:hover {
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .nav-item[aria-current="page"] {
        border-inline-start-color: var(--wt-color-primary);
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The content column beside the sidebar — scrolls independently, the same as .sidebar above,
         so a tall screen never grows the outer page past one viewport (that used to leave the
         shorter sidebar looking cut off next to a taller .main). Positioned so a visually hidden
         field hint is placed inside this scroll box, not against .layout, where it grows the page. */
      .main {
        position: relative;
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

      .brand-logo-picture {
        display: contents;
      }

      /* Hidden because under display: contents it becomes an item of the identity row and adds a
         gap before the logo. */
      .brand-logo-picture > source {
        display: none;
      }

      .brand-logo {
        display: block;
        flex: 0 0 auto;
        width: calc(var(--wt-space-6) * 4);
        height: auto;
      }

      .venue-row {
        display: contents;
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
      }

      /* A screen that fills .main, so its table's own box scrolls the rows while .main has room for the box's minimum. */
      .body.fill {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
      }

      /* Narrow screens (a phone or a split view): the sidebar becomes an off-canvas DRAWER inside the
         content row, below the banner. It leaves the flow and slides in when the layout gains
         the drawer-open class. A CSS media query cannot read a
         --custom-property, so the breakpoint is a literal here (and mirrored in the JS DRAWER_BREAKPOINT
         constant that drives the narrow state). */
      @media (max-width: 48rem) {
        /* A phone cannot fit the lockup, the legal name, the mode pill and the trailing controls on
           one line, so the name, the pill and the inbox link, when shown, take a second row and the
           trailing controls stay at the trailing edge of the first. The lockup's column is the one
           that shrinks, so the trailing controls keep the first row. */
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
        .venue-row {
          grid-area: venue;
          display: flex;
          align-items: center;
          gap: var(--wt-space-3);
        }
        .venue-name {
          padding-inline-start: 0;
          border-inline-start: 0;
        }
        /* The closed drawer is moved out past .layout's left edge, which is not the window's: the
           page's own padding would show its last strip. */
        .layout {
          overflow: clip;
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
          width: min(var(--dashboard-sidebar-width), 85vw);
          box-shadow: none;
          z-index: 30;
          /* Opaque so the dimmed main column never shows through the sliding panel. */
          background: var(--wt-color-bg);
          transform: translateX(-100%);
          transition: transform 150ms ease;
        }
        .layout.drawer-open .sidebar {
          box-shadow: var(--wt-shadow-1);
          transform: translateX(0);
        }
      }

      @media (max-width: 40rem) {
        wt-language-chooser::part(name) {
          display: none;
        }
        wt-language-chooser::part(code) {
          display: inline;
        }
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) liveUpdates?: { start(): void; stop(): void };
  @property({ attribute: false }) reload: () => void = () => location.reload();

  /** Defaults to `login`, so a cold load never flashes a logged-in face before the probe confirms a
   * session. */
  @state() private screen: ScreenId = "login";

  #enabledModules: readonly string[] = [];
  #activeScreens = new Map<
    string,
    { screen: DashboardScreenPlacement; handle: DashboardScreenHandle }
  >();
  #navGroups = new Map<NavGroupId, DashboardScreenPlacement[]>();
  #activePanels: {
    panel: DashboardSettingsPanel;
    handle: ReturnType<DashboardSettingsPanel["create"]>;
  }[] = [];

  #sessionPermissions: string[] = [];

  @state() private drawerOpen = false;

  @state() private navSearch = "";

  @state() private profileOpen = false;

  /** Reported by profile-screen via `profile-tab-change`: the Edit action lives in this shell's modal
   * footer, shown only while "details" is active. */
  @state() private profileTab: "details" | "security" = "details";

  /** Keeps the footer's Edit disabled until profile-screen has loaded the data `editDetails()` reads. */
  @state() private profileReady = false;

  /** Arriving at a screen opens its group (`willUpdate`, `#selectScreen`); a header click can then
   * collapse it like any other. */
  @state() private collapsedGroups = new Set<NavGroupId>(
    NAV_GROUPS.filter((group) => group.headerKey).map((group) => group.id),
  );
  // Keep the clicked header in place when another group's panel closes above it.
  #toggleGroup(id: NavGroupId, trigger: HTMLElement): void {
    const before = trigger.getBoundingClientRect().top;
    const next =
      trigger.getAttribute("aria-expanded") === "true"
        ? new Set(this.collapsedGroups).add(id)
        : new Set(
            NAV_GROUPS.filter((group) => group.headerKey && group.id !== id).map(
              (group) => group.id,
            ),
          );
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

  /** Ignored on a phone, whose drawer always holds the full sidebar. */
  @state() private sidebarFolded = false;

  /** The section whose panel is open beside its strip icon. */
  @state() private stripPanel: NavGroupId | null = null;
  #stripPanelIconTop: number | null = null;

  #setFolded(folded: boolean): void {
    this.sidebarFolded = folded;
    storeFold(folded);
  }

  #onNavToggle(): void {
    if (this.narrow) this.drawerOpen = !this.drawerOpen;
    else this.#setFolded(!this.sidebarFolded);
  }

  #breakpoint?: MediaQueryList;

  readonly #onBreakpointChange = (e: MediaQueryListEvent): void => {
    this.narrow = e.matches;
    // Wider than a phone the toggle folds the sidebar instead, so a drawer left open would leave its
    // scrim over the whole layout.
    if (!e.matches) this.drawerOpen = false;
  };

  /** NOT named `role`: that collides with `HTMLElement.role`, which a `@state` cannot override. */
  @state() private sessionRole?: PersonRole;

  @state() private myPersonId = "";

  @state() private sessionNoticeCode: string | null = null;
  @state() private updateAvailable = false;
  readonly #onBuildChanged = (): void => {
    this.updateAvailable = true;
  };
  @state() private contentLanguageError: string | null = null;
  @state() private contentLanguagesReady = false;
  readonly #languageQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.contentLanguageError = codeOf(error);
    },
  );
  /** A stable field, so the chooser's `loadLocales` property does not change on every render. */
  readonly #loadLocales = () => this.api.getLocales().then((r) => r.locales);
  @state() private alerts: AlertView[] = [];
  @state() private alertsVisible = false;
  @state() private alertError: string | null = null;
  @state() private alertBusyKey: string | null = null;
  @state() private alertToast: { alerts: AlertView[]; tone: "info" | "error" } | null = null;
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
    // A refusal still in flight from before the reset must not replace its notice; only a reload does.
    if (this.sessionNoticeCode === "node.reset") return;
    if (
      code === "management_session.expired" ||
      code === "management_session.required" ||
      code === "person.suspended" ||
      code === "node.reset"
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
  readonly #theme = new ThemeChoiceController(this, { applies: true });

  readonly #themeLabelsFor = themeLabelsPerLocale(() => ({
    theme: t("theme.label"),
    light: t("theme.light"),
    dark: t("theme.dark"),
    device: t("theme.device"),
  }));

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
    this.sidebarFolded = readStoredFold() ?? window.matchMedia(FOLDED_BY_DEFAULT).matches;
    this.#breakpoint.addEventListener("change", this.#onBreakpointChange);
    this.addEventListener("click", this.#onAppLink, true);
    window.addEventListener("waitron-session-invalid", this.#onSessionInvalid);
    window.addEventListener("waitron-session-active", this.#onSessionActive);
    window.addEventListener(BUILD_CHANGED_EVENT, this.#onBuildChanged);
    window.addEventListener("storage", this.#onSessionStorage);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
  }

  override disconnectedCallback(): void {
    this.sessionGeneration += 1;
    this.liveUpdates?.stop();
    this.#breakpoint?.removeEventListener("change", this.#onBreakpointChange);
    this.#breakpoint = undefined;
    this.removeEventListener("click", this.#onAppLink, true);
    window.removeEventListener("waitron-session-invalid", this.#onSessionInvalid);
    window.removeEventListener("waitron-session-active", this.#onSessionActive);
    window.removeEventListener(BUILD_CHANGED_EVENT, this.#onBuildChanged);
    window.removeEventListener("storage", this.#onSessionStorage);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    document.removeEventListener("pointerdown", this.#onPointerDownOutsidePanel, true);
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
      const guard = navigationGuardFor(window);
      if (guard) await guard.write(url, true);
      else history.replaceState(history.state, "", url);
    }
    if (url.searchParams.has("token")) {
      await this.#seedLocale();
      return;
    }
    await this.#probeSession(preference);
    if (googleCallback && this.sessionRole !== undefined) void signalAcceptedPasskeys(this.api);
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

  #venueNameRead = 0;

  /** The banner's name alone; only the latest read is shown, and a failed read keeps the name it
   *  shows. */
  async #rereadVenueName(): Promise<void> {
    const generation = this.sessionGeneration;
    const read = ++this.#venueNameRead;
    try {
      const { venueName } = await this.api.getMe();
      if (this.isConnected && generation === this.sessionGeneration && read === this.#venueNameRead)
        this.venueName = venueName;
    } catch {
      // Keeps the name it shows.
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
    // A plain field: redraw so the screens given a permission see the change.
    this.requestUpdate();
    this.onboardingIntent = me.onboardingIntent;
    // Activate the enabled modules before resolving the permitted screen, so a URL naming an enabled
    // module's screen id is recognised while a disabled module's is not.
    this.#activate(me.modules);
    this.#applyRequestedScreen(this.#url.read("dashboard"));
    this.#venueLocale = me.venueLocale;
    this.venueName = me.venueName;
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
      alerts: arrived,
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

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("screen")) this.#openGroupOf(this.screen);
    if (this.stripPanel !== null && (changed.has("screen") || !this.#folded()))
      this.stripPanel = null;
  }

  #openGroupOf(screen: ScreenId): void {
    const group =
      NAV_GROUPS.find((entry) => coreItems(entry).some((item) => item.screen === screen))?.id ??
      this.#activeScreens.get(screen)?.screen.group;
    if (group === undefined) return;
    this.collapsedGroups = new Set(
      NAV_GROUPS.filter((entry) => entry.headerKey && entry.id !== group).map((entry) => entry.id),
    );
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("stripPanel")) {
      if (this.stripPanel === null)
        document.removeEventListener("pointerdown", this.#onPointerDownOutsidePanel, true);
      else document.addEventListener("pointerdown", this.#onPointerDownOutsidePanel, true);
    }
    this.#placeStripPanel();
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
    setHelpMode(false);
    this.leave.forceReset();
    navigationGuardFor(window)?.reset();
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
    this.#enabledModules = [];
    this.#activeScreens.clear();
    this.#navGroups.clear();
    this.#activePanels = [];
    this.drawerOpen = false;
    this.navSearch = "";
    this.#broadcastSessionDeadline(0);
    this.#url.write({ dashboard: null }, true);
    if (this.isConnected) {
      setLocale(this.#loginLocale ?? this.#venueLocale);
      void this.#seedLocale();
    }
  }

  /**
   * Runs on every probe/login and rebuilds the maps from scratch, so a module disabled server-side
   * since the last session stops showing. Unknown nav groups or settings tabs, repeated screen,
   * panel or calendar view ids, and a calendar view id that is one of the Calendar's own words
   * throw rather than silently dropping or replacing a contribution.
   */
  #activate(enabled: readonly string[]): void {
    this.#enabledModules = [...enabled];
    const knownGroups = new Set<NavGroupId>(NAV_GROUPS.map((g) => g.id));
    const knownTabs = new Set<string>(VENUE_SETTINGS_TABS);
    const ids = new Set<string>(CORE_SCREENS);
    const panelIds = new Set<string>(CORE_SETTINGS_PANELS.map((panel) => panel.key));
    this.#activeScreens.clear();
    this.#navGroups.clear();
    this.#activePanels = [];
    const calendarViews = this.#calendarViews(enabled);
    for (const c of DASHBOARD_MODULES) {
      if (!enabled.includes(c.module)) continue;
      const screens: readonly DashboardFurtherScreen[] = [c, ...(c.moreScreens ?? [])];
      for (const { screen } of screens) {
        if (!knownGroups.has(screen.group))
          throw new Error(
            `dashboard module "${c.module}" names unknown nav group "${screen.group}"`,
          );
        if (ids.has(screen.id))
          throw new Error(`dashboard module "${c.module}" repeats screen id "${screen.id}"`);
        ids.add(screen.id);
      }
      for (const panel of c.settingsPanels ?? []) {
        if (!knownTabs.has(panel.tab))
          throw new Error(
            `dashboard module "${c.module}" names unknown settings tab "${panel.tab}"`,
          );
        if (panelIds.has(panel.id))
          throw new Error(`dashboard module "${c.module}" repeats settings panel id "${panel.id}"`);
        panelIds.add(panel.id);
      }
      registerCatalogue(c.strings);
      const ctx = {
        request: this.request,
        liveData: this.api.liveData,
        renderPanel: (panel: string, subject: { id: string; name: string }) =>
          panel === "department-receipt" && this.#sessionPermissions.includes("layout.configure")
            ? html`<dashboard-department-receipt-dialog
                .api=${this.api}
                .subject=${subject}
                .canManagePolicy=${this.#sessionPermissions.includes("venue_service.manage")}
              ></dashboard-department-receipt-dialog>`
            : null,
        calendarViews,
      };
      for (const contributed of screens) {
        const { screen } = contributed;
        this.#activeScreens.set(screen.id, {
          screen,
          handle: contributed.create(ctx),
        });
        if (this.#mayRead(screen)) {
          const group = this.#navGroups.get(screen.group) ?? [];
          group.push(screen);
          this.#navGroups.set(screen.group, group);
        }
      }
      for (const panel of c.settingsPanels ?? [])
        this.#activePanels.push({ panel, handle: panel.create(ctx) });
    }
    for (const list of this.#navGroups.values())
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.#searchDestinations();
  }

  /** Gathered before any module's screens are created, because each module gets its own `ctx`. */
  #calendarViews(enabled: readonly string[]): CalendarViewEntry[] {
    const ids = new Set<string>(CALENDAR_OWN_VIEW_IDS);
    const views: DashboardCalendarView[] = [];
    for (const c of DASHBOARD_MODULES) {
      if (!enabled.includes(c.module)) continue;
      for (const view of c.calendarViews ?? []) {
        if (ids.has(view.id))
          throw new Error(`dashboard module "${c.module}" repeats calendar view id "${view.id}"`);
        ids.add(view.id);
        views.push(view);
      }
    }
    return views
      .filter((view) => this.#mayRead(view))
      .sort((a, b) => a.order - b.order)
      .map((view) => ({
        view,
        canWrite: this.#sessionPermissions.includes(view.requiresPermission),
      }));
  }

  /** A module's screen, panel or Calendar view opens to its write permission or its read one. */
  #mayRead(item: { requiresPermission: string; readPermission?: string }): boolean {
    return (
      this.#sessionPermissions.includes(item.requiresPermission) ||
      (item.readPermission !== undefined && this.#sessionPermissions.includes(item.readPermission))
    );
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
    if (this.sessionRole !== undefined && this.isConnected) void signalAcceptedPasskeys(this.api);
    if (accountSetup && this.sessionRole !== undefined && this.isConnected) {
      this.#openProfile();
    }
  }

  async #onLogout(): Promise<void> {
    const generation = this.sessionGeneration;
    await this.leave.coordinator.request({
      scopes: "all",
      reason: "signout",
      proceed: async () => {
        try {
          await this.api.logout();
        } catch {
          // The local session is cleared even when the logout request is refused.
        }
        if (this.isConnected && generation === this.sessionGeneration) this.#returnToLogin(null);
      },
    });
  }

  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "login") {
      this.#loginLocaleChoice += 1;
      setLocale(code);
      return;
    }
    const generation = this.sessionGeneration;
    await this.leave.coordinator.request({
      scopes: code === currentLocale() ? [] : "all",
      except: [this.renderRoot.querySelector("dashboard-profile-screen")].filter(
        (profile): profile is ProfileScreen => profile !== null,
      ),
      reason: "navigation",
      proceed: async () => {
        // Probes from before or during this write must not restore the old preference.
        this.#sessionLocaleChoice += 1;
        try {
          await this.api.putLocale(code);
          if (!this.isConnected || generation !== this.sessionGeneration) return;
          this.#sessionLocaleChoice += 1;
          setLocale(code);
        } catch {
          // A refused preference write leaves the active language unchanged.
        }
      },
    });
  }

  private readonly leave = new LeaveController(this);

  private leaveConfirmation() {
    return this.leave.render({
      heading: t("unsaved.heading"),
      message: t("unsaved.message"),
      keepLabel: t("unsaved.keep"),
      discardLabel: t("unsaved.discard"),
    });
  }

  override render(): TemplateResult {
    if (this.screen === "login") {
      // The login controller repaints translated text without discarding credentials or account setup.
      return html`
        ${this.leaveConfirmation()}
        <div
          class="login-page"
          @wt-locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
        >
          ${this.#demoBar(false)} ${this.#banner(false, false)} ${this.#updateBar()}
          <div class="body">
            <dashboard-login-screen
              .api=${this.api}
              .noticeCode=${this.sessionNoticeCode}
              @logged-in=${(event: Event) => void this.#onLoggedIn(event)}
            ></dashboard-login-screen>
          </div>
        </div>
      `;
    }
    return html`
      ${this.leaveConfirmation()}
      <div
        class="shell"
        @focusin=${(e: FocusEvent) => this.#onShellFocusIn(e)}
        @keydown=${(e: KeyboardEvent) => this.#onLayoutKeydown(e)}
        @wt-locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        ${this.#demoBar(true)}
        <div class="banner-row">
          ${this.#banner(true, true)} ${this.#noticesInEditor() ? nothing : this.#notices()}
        </div>
        <div class=${classMap({ layout: true, "drawer-open": this.drawerOpen })}>
          <!-- At desktop width the sidebar is in-flow; below the
               breakpoint (Task 12) it becomes the off-canvas drawer the hamburger toggles. When it is
               off-canvas AND closed (narrow && not drawerOpen) it is inert, so its nav buttons
               leave the tab order + a11y tree rather than lurking off-screen ahead of every visible
               control; it is interactive at desktop width and whenever the drawer is open. -->
          <aside
            class=${classMap({ sidebar: true, folded: this.#folded() })}
            ?inert=${this.narrow && !this.drawerOpen}
            @scroll=${() => this.#onSidebarScroll()}
          >
            ${this.#folded() ? this.#strip() : this.#nav()}
          </aside>
          <!-- The scrim behind the open drawer — a tap on it closes the drawer. Rendered only while open;
               the drawer is force-closed on the transition
               to desktop (#onBreakpointChange), so this never renders at desktop width.
               aria-hidden: it is a decorative veil, not an interactive control in the a11y tree. -->
          ${
            this.drawerOpen
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
            <div
              class=${classMap({ body: true, fill: this.screen === "catalogue" })}
              @wt-edit-product=${this.#onEditProduct}
            >
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
          </div>
        </div>
        ${this.#renderProfileModal()}
      </div>
    `;
  }

  /** The floor plan editor's modal makes everything outside its own subtree inert, so there the
   * shell's notices are slotted into the editor instead of the banner row. */
  #noticesInEditor(): boolean {
    return this.screen === "floor-plan" && this.contentLanguagesReady;
  }

  #notices(slot?: string): TemplateResult {
    return html`${this.#updateBar(slot)}
      <wt-toast
        class="alert-toast"
        data-test="alert-toast"
        slot=${slot ?? nothing}
        .open=${this.alertToast !== null}
        .message=${
          this.alertToast === null
            ? ""
            : this.alertToast.alerts.length === 1
              ? alertMessage(this.alertToast.alerts[0]!.code, this.alertToast.alerts[0]!.params)
              : t("alerts.toast_many").replace("{count}", String(this.alertToast.alerts.length))
        }
        tone=${this.alertToast?.tone ?? "info"}
        close-label=${t("action.close")}
        @wt-activate=${(e: Event) => this.#onToastActivate(e)}
        @wt-close=${(e: Event) => this.#onToastClose(e)}
      ></wt-toast>`;
  }

  #updateBar(slot?: string): TemplateResult | typeof nothing {
    // A reset box has its own notice, with its own Reload, on the sign-in page.
    if (!this.updateAvailable || this.sessionNoticeCode === "node.reset") return nothing;
    return html`<wt-banner
      data-test="update-bar"
      slot=${slot ?? nothing}
      message=${t("update.message")}
      action-label=${t("update.reload")}
      @wt-banner-action=${() => this.reload()}
    ></wt-banner>`;
  }

  #demoBar(authenticated: boolean): TemplateResult | typeof nothing {
    if (this.onboardingIntent !== "demo" && this.onboardingIntent !== "prepare") return nothing;
    const links = [
      { label: t("demo_bar.dashboard"), href: "/manage", current: true },
      { label: t("demo_bar.device"), href: "/" },
      ...(!authenticated || this.#canOpenScreen("email")
        ? [{ label: t("nav.email_inbox"), href: "/manage/email" }]
        : []),
      ...(!authenticated || this.#canOpenScreen("demo-printer")
        ? [{ label: t("demo_printer.title"), href: "/manage/demo-printer" }]
        : []),
      ...(!authenticated || this.#canOpenScreen("demo-reader")
        ? [{ label: t("demo_reader.title"), href: "/manage/demo-reader" }]
        : []),
    ];
    return html`<wt-demo-bar
      data-test="demo-bar"
      .modeLabel=${t(`mode.${this.onboardingIntent}`)}
      .navigationLabel=${t("demo_bar.navigation")}
      .links=${links}
    ></wt-demo-bar>`;
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
                aria-expanded=${String(this.narrow ? this.drawerOpen : !this.sidebarFolded)}
                @click=${() => this.#onNavToggle()}
                ><wt-icon name="hamburger"></wt-icon
              ></wt-button>`
            : nothing
        }
        <picture class="brand-logo-picture">
          <source media=${darkLogoMedia(this.#theme.choice)} srcset=${WAITRON_LOGO_DARK_URL} />
          <img class="brand-logo" src=${WAITRON_LOGO_URL} alt="Waitron" />
        </picture>
        <span class="venue-row"
          ><span class="venue">
            <span class="venue-name" data-test="venue-name">${this.venueName}</span>
            ${
              this.onboardingIntent === "live"
                ? html`<span class="mode-indicator" data-test="mode-indicator"
                    >${t("mode.live")}</span
                  >`
                : nothing
            }
          </span></span
        >
      </div>
      <div class="banner-actions">
        ${
          authenticated
            ? nothing
            : html`<wt-theme-chooser
                data-test="theme-chooser"
                .active=${this.#theme.choice}
                .labels=${this.#themeLabelsFor(currentLocale())}
              ></wt-theme-chooser>`
        }
        <wt-language-chooser
          data-test="language-chooser"
          .active=${currentLocale()}
          .loadLocales=${this.#loadLocales}
        ></wt-language-chooser>
        ${
          authenticated
            ? html`${
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
                <wt-help-switch data-test="help-switch" label=${t("help.label")}></wt-help-switch>
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
                  ${themeChoices({
                    active: this.#theme.choice,
                    labels: this.#themeLabelsFor(currentLocale()),
                    onPick: chooseTheme,
                  })}
                  <wt-button
                    variant="ghost"
                    align="start"
                    data-test="logout"
                    @click=${() => void this.#onLogout()}
                    >${t("action.logout")}</wt-button
                  >
                </wt-row-actions>`
            : nothing
        }
      </div>
    </header>`;
  }

  /** Listening in the capture phase, this runs before an anchor's own click handler, so an anchor
   * that handles a plain click itself says so with `data-own-click`. A disabled anchor's navigation
   * is cancelled here; its own click handler still runs. */
  readonly #onAppLink = (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    const anchor = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement && node.hasAttribute("href"),
      );
    if (!anchor) return;
    if (anchor.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    if (
      leftToBrowser(event) ||
      anchor.hasAttribute("data-own-click") ||
      anchor.hasAttribute("download") ||
      anchor.getAttribute("href")?.startsWith("#") ||
      (anchor.target !== "" && anchor.target !== "_self")
    )
      return;
    const url = new URL(anchor.href);
    if (
      url.origin !== location.origin ||
      (url.pathname !== "/manage" && !url.pathname.startsWith("/manage/"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    void navigationGuardFor(window)?.write(url);
  };

  #selectScreen(screen: ScreenId): void {
    const destination = this.#permittedScreen(screen);
    const navigation =
      destination === "venue-operations"
        ? this.#url.write({ dashboard: destination, department: null, view: null, zone: null })
        : this.#writeScreenUrl(destination);
    void Promise.resolve(navigation).then((outcome) => {
      if (outcome === "proceeded" && this.isConnected && this.screen === destination) {
        this.#openGroupOf(destination);
        this.drawerOpen = false;
        this.navSearch = "";
      }
    });
  }

  /** A screen (the units in-use modal) asks to open a product's editor; navigate to the catalogue
   * screen with that product deep-linked. No automatic return — the person navigates back themselves. */
  #onEditProduct(event: CustomEvent<{ productId: string }>): void {
    event.stopPropagation();
    const screen = this.#permittedScreen("catalogue");
    if (screen !== "catalogue") return;
    void this.#url.write({ dashboard: screen, view: null, product: event.detail.productId });
  }

  #mayOpen(item: AccessRule): boolean {
    if (item.requiresManager && this.sessionRole !== "manager" && this.sessionRole !== "admin")
      return false;
    return (
      item.requiresPermission === undefined ||
      this.#sessionPermissions.includes(item.requiresPermission)
    );
  }

  #settingsPanels(): (VenueSettingsPanel & { order: number })[] {
    const core = CORE_SETTINGS_PANELS.filter((panel) => this.#mayOpen(panel)).map((panel) => ({
      key: panel.key,
      tab: panel.tab,
      order: 0,
      render: () => panel.render(this.api, this.#sessionPermissions.includes("venue.configure")),
    }));
    const modules = this.#activePanels
      .filter(({ panel }) => this.#mayRead(panel))
      .map(({ panel, handle }) => ({
        key: panel.id,
        tab: panel.tab as VenueSettingsTab,
        order: panel.order ?? 0,
        render: () => handle.render(!this.#sessionPermissions.includes(panel.requiresPermission)),
      }));
    return [...core, ...modules].sort((a, b) => a.order - b.order);
  }

  #permittedScreen(requested: string | null): ScreenId {
    if (this.sessionRole === "staff") return requested === "orders" ? "orders" : "my-schedule";
    if (requested === "alerts") return "alerts";
    if (
      (requested === "demo-printer" || requested === "demo-reader") &&
      this.onboardingIntent !== "demo" &&
      this.onboardingIntent !== "prepare"
    )
      return "overview";
    const item = [...NAV_GROUPS.flatMap(coreItems), ...UNLISTED_SCREENS].find(
      (entry) => entry.screen === requested,
    );
    if (item && this.#mayOpen(item)) return item.screen;
    if (requested !== null) {
      const active = this.#activeScreens.get(requested);
      if (active && this.#mayRead(active.screen)) return requested;
    }
    return "overview";
  }

  readonly #url = new UrlStateController(this, () => this.#onHistory(), {
    ...dashboardPath,
    keepUnlisted: [
      ...(dashboardPath.keepUnlisted ?? []),
      ...DASHBOARD_MODULES.flatMap((c) =>
        [c, ...(c.moreScreens ?? [])].map(({ screen }) => screen.id),
      ).filter((id) => dashboardPath.children[id] === undefined),
    ],
    leave: {
      isDirty: () => this.leave.coordinator.isDirty(),
      request: (proceed, signal, destination) => {
        const segment = new URL(destination).pathname.split("/")[2];
        let requested: string | undefined;
        try {
          requested = segment === undefined ? undefined : decodeURIComponent(segment);
        } catch {
          requested = undefined;
        }
        const profile = this.renderRoot.querySelector<ProfileScreen>("dashboard-profile-screen");
        const retainedSchedule =
          requested === "my-schedule" && this.screen === "my-schedule" && !this.profileOpen
            ? this.renderRoot.querySelector("dashboard-my-schedule-screen")
            : null;
        const hoursPanel = retainedSchedule?.shadowRoot?.querySelector("dashboard-my-hours-panel");
        const hoursDrafts = Array.from(
          hoursPanel?.shadowRoot?.querySelectorAll(
            "dashboard-attendance-proposal-dialog, dashboard-attendance-export-dialog",
          ) ?? [],
        );
        // A tab change retains schedule forms while guarding the Hours dialogs it releases.
        const moduleScopes =
          !this.profileOpen && requested === this.screen
            ? this.#activeScreens.get(this.screen)?.handle.navigationScopes?.(new URL(destination))
            : undefined;
        const scopes =
          moduleScopes ??
          (retainedSchedule
            ? hoursDrafts
            : requested === "profile"
              ? []
              : this.profileOpen && requested === this.screen && profile
                ? [profile]
                : "all");
        return this.leave.coordinator.request({
          scopes,
          reason: "navigation",
          proceed,
          signal,
        });
      },
    },
  });

  #writeScreenUrl(screen: ScreenId, replace = false) {
    return this.#url.write(
      { dashboard: screen, ...(this.#url.read("dashboard") === screen ? {} : { view: null }) },
      replace,
    );
  }

  /** "profile" opens the modal over the current screen, or over the person's default when none is
   * resolved yet. An already-resolved screen is left alone because this also runs on every re-probe,
   * including the one a profile save triggers while the URL still reads "profile". The cost: a module
   * disabled server-side while the modal is open is not re-gated until the next navigation. */
  #applyRequestedScreen(requested: string | null): void {
    if (requested === "printing-rules") {
      const destination = this.#permittedScreen("prep-stations");
      this.#url.write(
        { dashboard: destination, view: destination === "prep-stations" ? "stations" : null },
        true,
      );
      requested = destination;
    }
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
    this.#url.write({ dashboard: "profile" }, false);
  }

  /** Replaces the current entry, so "profile" does not stay behind as its own Back-button stop. A
   * Back-button close goes through `#onHistory` instead. */
  #closeProfile(): void {
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
    if (e.key === "Escape" && !e.isComposing && this.drawerOpen) this.drawerOpen = false;
  }

  /** The pages this person may open, group by group in nav order, each labelled in the current
   * language. */
  #permittedNav(): { group: NavGroup; pages: NavPage[] }[] {
    if (this.sessionRole === "staff")
      return [
        {
          group: NAV_GROUPS.find((group) => group.id === "overview")!,
          pages: [
            { screen: "my-schedule", label: t("nav.my_schedule") },
            { screen: "orders", label: t("nav.orders") },
          ],
        },
      ];
    const shown = (items: NavItem[] = []): NavPage[] =>
      items
        .filter((item) => this.#mayOpen(item))
        .map((item) => ({ screen: item.screen, label: t(item.labelKey) }));
    return NAV_GROUPS.map((group) => {
      const among = [...(this.#navGroups.get(group.id) ?? [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((screen) => ({ screen: screen.id, label: tKit(screen.navLabelKey) }));
      return {
        group,
        pages: [...shown(group.items), ...among, ...shown(group.itemsAfterModules)],
      };
    });
  }

  /** `#permittedNav` narrowed by the search; `pages` is undefined when none is left. */
  #shownNav(): { group: NavGroup; pages?: NavPage[] }[] {
    const permitted = this.#permittedNav();
    if (this.sessionRole === "staff") return permitted;
    return permitted.map(({ group, pages }) => {
      const heading = group.headerKey === undefined ? "" : t(group.headerKey);
      const matched = navMatches(this.navSearch, pages, heading);
      return { group, pages: matched.length > 0 ? matched : undefined };
    });
  }

  #searchDestinations(): NavSearchDestination[] {
    const pages = this.#permittedNav().flatMap(({ group, pages }) =>
      pages.map((page) => ({ ...page, heading: group.headerKey ? t(group.headerKey) : "" })),
    );
    const tabs = new Set(this.#settingsPanels().map((panel) => panel.tab));
    return collectSearchDestinations({
      pages,
      declarations: DASHBOARD_MODULES.filter((c) =>
        this.#enabledModules.includes(c.module),
      ).flatMap((c) => c.searchDestinations ?? []),
      calendarViews: this.#calendarViews(this.#enabledModules),
      settingsTabs: VENUE_SETTINGS_TABS.filter((tab) => tabs.has(tab)).map((id) => ({
        id,
        label: t(TAB_LABELS[id]),
      })),
      permissions: this.#sessionPermissions,
      label: tKit,
      knownScreens: [
        ...CORE_SCREENS,
        ...DASHBOARD_MODULES.flatMap((c) =>
          [c, ...(c.moreScreens ?? [])].map(({ screen }) => screen.id),
        ),
      ],
    });
  }

  async #openSearchDestination(destination: NavSearchDestination): Promise<void> {
    const current = this.#searchDestinations().find(
      (item) => item.id === destination.id && item.href === destination.href,
    );
    if (!current) return;
    const guard = navigationGuardFor(window);
    const url = new URL(guard?.href ?? location.href);
    url.pathname = current.href;
    const outcome = await guard?.write(url);
    if (outcome === "proceeded" && this.isConnected && this.screen === current.screen) {
      this.#openGroupOf(current.screen);
      this.drawerOpen = false;
      this.navSearch = "";
    }
  }

  #folded(): boolean {
    return !this.narrow && this.sidebarFolded;
  }

  async #searchFromStrip(): Promise<void> {
    this.#setFolded(false);
    await this.updateComplete;
    const search = this.renderRoot.querySelector<WtInput>("wt-input[data-test=nav-search]");
    await search?.updateComplete;
    search?.focus();
  }

  #openSectionFromStrip(group: NavGroup, pages: NavPage[], event: MouseEvent): void {
    if (pages.length === 1) {
      this.#openFromNav(pages[0]!.screen);
      return;
    }
    if (this.stripPanel === group.id) {
      this.stripPanel = null;
      return;
    }
    this.stripPanel = group.id;
    // A click a key made reports no pointer clicks.
    if (event.detail === 0)
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>("[data-test=strip-panel] .nav-item")?.focus(),
      );
  }

  #stripPanelParts(): { panel: HTMLElement; icon: HTMLElement } | null {
    const panel = this.renderRoot.querySelector<HTMLElement>("[data-test=strip-panel]");
    const icon = this.renderRoot.querySelector<HTMLElement>(`[aria-controls="${panel?.id}"]`);
    return panel && icon ? { panel, icon } : null;
  }

  readonly #onPointerDownOutsidePanel = (event: PointerEvent): void => {
    const parts = this.#stripPanelParts();
    const path = event.composedPath();
    if (parts && !path.includes(parts.panel) && !path.includes(parts.icon)) this.stripPanel = null;
  };

  /** Only focus moving to somewhere else closes it: a click on the panel's text moves it nowhere. */
  #onStripPanelFocusOut(event: FocusEvent): void {
    const parts = this.#stripPanelParts();
    const next = event.relatedTarget as Node | null;
    if (parts && next && !parts.panel.contains(next) && !parts.icon.contains(next))
      this.stripPanel = null;
  }

  #onStripPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing || this.stripPanel === null) return;
    event.stopPropagation();
    const icon = this.#stripPanelParts()?.icon;
    this.stripPanel = null;
    icon?.focus();
  }

  /** Focusing an icon scrolls the strip, and that scroll's event can arrive after the panel opened,
   * so only a scroll that moved the icon since the panel was placed closes it. */
  #onSidebarScroll(): void {
    if (this.stripPanel === null) return;
    const icon = this.#stripPanelParts()?.icon;
    if (icon && icon.getBoundingClientRect().top !== this.#stripPanelIconTop)
      this.stripPanel = null;
  }

  /** Placed before its first paint: `updated` runs before the frame is drawn. */
  #placeStripPanel(): void {
    const parts = this.#stripPanelParts();
    if (parts === null) return;
    const layout = this.renderRoot.querySelector<HTMLElement>(".layout")!;
    const area = layout.getBoundingClientRect();
    const icon = parts.icon.getBoundingClientRect();
    this.#stripPanelIconTop = icon.top;
    const strip = this.renderRoot.querySelector<HTMLElement>("aside.sidebar")!;
    const top = Math.min(icon.top - area.top, area.height - parts.panel.offsetHeight);
    parts.panel.style.top = `${Math.max(0, top)}px`;
    parts.panel.style.left = `${strip.getBoundingClientRect().right - area.left}px`;
  }

  #stripButton(
    test: string,
    label: string,
    icon: string,
    onClick: (event: MouseEvent) => void,
    current = false,
    controls?: { id: string; open: boolean },
  ): TemplateResult {
    return html`<button
      type="button"
      class="icon-button strip-button"
      data-test="strip-${test}"
      aria-label=${label}
      aria-current=${current ? "true" : nothing}
      aria-expanded=${controls ? String(controls.open) : nothing}
      aria-controls=${controls?.open ? controls.id : nothing}
      @click=${onClick}
      @keydown=${controls ? (e: KeyboardEvent) => this.#onStripPanelKeydown(e) : nothing}
      @focusout=${controls?.open ? (e: FocusEvent) => this.#onStripPanelFocusOut(e) : nothing}
      @pointerenter=${trackIconTooltip}
      @pointerleave=${trackIconTooltip}
      @focus=${trackIconTooltip}
      @blur=${trackIconTooltip}
    >
      <wt-icon name=${icon}></wt-icon><span class="icon-tooltip" aria-hidden="true">${label}</span>
    </button>`;
  }

  #stripPanel(id: string, label: string, pages: NavPage[]): TemplateResult {
    return html`<div
      class="strip-panel"
      id=${id}
      role="group"
      aria-labelledby="${id}-label"
      data-test="strip-panel"
      @keydown=${(e: KeyboardEvent) => this.#onStripPanelKeydown(e)}
      @focusout=${(e: FocusEvent) => this.#onStripPanelFocusOut(e)}
    >
      <div class="strip-panel-label" id="${id}-label">${label}</div>
      ${pages.map(
        (page) =>
          html`<button
            type="button"
            class="nav-item"
            aria-current=${this.screen === page.screen ? "page" : nothing}
            data-test="strip-panel-${page.screen}"
            @click=${() => {
              const icon = this.screen === page.screen ? this.#stripPanelParts()?.icon : undefined;
              this.stripPanel = null;
              this.#openFromNav(page.screen);
              icon?.focus();
            }}
          >
            ${page.label}
          </button>`,
      )}
    </div>`;
  }

  /** The folded sidebar: one icon per section with a page this person may open. The search does
   * not narrow it. A section's panel follows its icon, so Tab moves from the icon into it. */
  #strip(): TemplateResult {
    const sections = this.#permittedNav().filter(({ pages }) => pages.length > 0);
    return html`<nav class="strip" aria-label=${t("nav.sections")}>
      ${
        this.sessionRole === "staff"
          ? nothing
          : this.#stripButton(
              "search",
              t("nav.search"),
              "search",
              () => void this.#searchFromStrip(),
            )
      }
      ${sections.map(({ group, pages }) => {
        const label = group.headerKey === undefined ? t("nav.overview") : t(group.headerKey);
        const id = `strip-panel-${group.id}`;
        const open = this.stripPanel === group.id;
        return html`${this.#stripButton(
          group.id,
          label,
          group.icon,
          (e) => this.#openSectionFromStrip(group, pages, e),
          pages.some((page) => page.screen === this.screen),
          pages.length > 1 ? { id, open } : undefined,
        )}${open ? this.#stripPanel(id, label, pages) : nothing}`;
      })}
    </nav>`;
  }

  #openFromNav(screen: ScreenId): void {
    this.#selectScreen(screen);
  }

  /** Escape is stopped only when it cleared a term, so on an empty box it still closes the drawer.
   * A key reported with isComposing set belongs to an input method's composition, not the box. */
  #onNavSearchKeydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === "Enter" && this.navSearch.trim() !== "") {
      const first = this.#shownNav().find((section) => section.pages?.length)?.pages?.[0];
      if (first) this.#openFromNav(first.screen);
      else {
        const inner = destinationMatches(this.navSearch, this.#searchDestinations())[0];
        if (inner) void this.#openSearchDestination(inner);
      }
    } else if (e.key === "Escape" && this.navSearch !== "") {
      e.stopPropagation();
      this.navSearch = "";
    }
  }

  /** Items are plain `.nav-item` buttons, not `wt-button`: a long list reads as navigation, not a
   * stack of buttons. */
  #nav(): TemplateResult {
    const searching = this.navSearch.trim() !== "";
    const sections = this.#shownNav();
    const inner = searching ? destinationMatches(this.navSearch, this.#searchDestinations()) : [];
    const noMatch =
      searching && sections.every((section) => section.pages === undefined) && inner.length === 0;
    return html`
      <nav class="nav" aria-label=${t("nav.sections")}>
        ${
          this.sessionRole === "staff"
            ? nothing
            : html`<wt-input
                type="search"
                name="nav-search"
                autocomplete="off"
                data-test="nav-search"
                label=${t("nav.search")}
                hide-label
                placeholder=${t("nav.search")}
                .value=${live(this.navSearch)}
                @wt-change=${(e: CustomEvent<{ value: string }>) => (this.navSearch = e.detail.value)}
                @keydown=${(e: KeyboardEvent) => this.#onNavSearchKeydown(e)}
              ></wt-input>`
        }
        ${sections.map(({ group, pages }) => {
          if (pages === undefined) return nothing;
          // A search shows its matches open without touching `collapsedGroups`, and its headers
          // are plain labels rather than toggles.
          const collapsed = !searching && this.collapsedGroups.has(group.id);
          const panelId = `nav-group-panel-${group.id}`;
          return html`
            ${
              group.headerKey === undefined
                ? nothing
                : searching
                  ? html`<div class="nav-group" data-test="nav-group-${group.id}">
                      <wt-icon class="group-icon" size="sm" name=${group.icon}></wt-icon>
                      <span class="nav-group-label">${t(group.headerKey)}</span>
                      <span class="chevron-space"></span>
                    </div>`
                  : html`<button
                      type="button"
                      class="nav-group"
                      aria-expanded=${!collapsed}
                      aria-controls=${panelId}
                      data-test="nav-group-${group.id}"
                      @click=${(e: MouseEvent) =>
                        this.#toggleGroup(group.id, e.currentTarget as HTMLElement)}
                    >
                      <wt-icon class="group-icon" size="sm" name=${group.icon}></wt-icon>
                      <span class="nav-group-label">${t(group.headerKey)}</span>
                      <wt-icon name="chevron-down" class="chevron"></wt-icon>
                    </button>`
            }
            <div id=${panelId} ?hidden=${collapsed}>
              ${repeat(
                pages,
                (page) => page.screen,
                (page) =>
                  html`<button
                    type="button"
                    class="nav-item"
                    aria-current=${this.screen === page.screen ? "page" : nothing}
                    data-test="nav-${page.screen}"
                    @click=${() => this.#openFromNav(page.screen)}
                  >
                    ${page.label}
                  </button>`,
              )}
            </div>
          `;
        })}
        ${repeat(
          inner,
          (destination) => destination.id,
          (destination) =>
            html`<button
              type="button"
              class="nav-destination"
              data-search-destination=${destination.id}
              @click=${() => void this.#openSearchDestination(destination)}
            >
              ${fill("nav.destination", { label: destination.label, page: destination.pageLabel })}
            </button>`,
        )}
        ${
          this.sessionRole === "staff"
            ? nothing
            : html`<p class="nav-search-empty" role="status" data-test="nav-search-empty">
                ${noMatch ? t("nav.no_matches") : nothing}
              </p>`
        }
      </nav>
    `;
  }

  readonly #beforeProfileClose = async (reason: LeaveReason): Promise<boolean> => {
    const profile = this.renderRoot.querySelector<ProfileScreen>("dashboard-profile-screen");
    return profile ? profile.requestLeave(reason) : true;
  };

  /** profile-screen's per-field edit modals nest inside this one deliberately: this modal is the page,
   * they are its forms. */
  #renderProfileModal(): TemplateResult {
    return html`
      <wt-modal
        size="standard"
        heading=${t("profile.title")}
        .open=${this.profileOpen}
        .beforeClose=${this.#beforeProfileClose}
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
          <wt-button
            slot="cancel"
            data-test="close-profile"
            @click=${(event: Event) =>
              void (event.currentTarget as HTMLElement).closest("wt-modal")?.requestClose("cancel")}
            >${t("action.close")}</wt-button
          >
          ${
            this.profileTab === "details"
              ? html`<wt-button
                  data-test="edit-profile-details"
                  variant=${this.profileReady ? "primary" : "secondary"}
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
    if (mod)
      return mod.handle.render(!this.#sessionPermissions.includes(mod.screen.requiresPermission));
    switch (this.screen) {
      case "my-schedule":
        return html`<dashboard-my-schedule-screen
          .request=${this.request}
          .liveData=${this.api.liveData}
          .modules=${this.#enabledModules}
          .api=${this.api}
          .myPersonId=${this.myPersonId}
        ></dashboard-my-schedule-screen>`;
      case "sales":
        return html`<dashboard-sales-screen .api=${this.api}></dashboard-sales-screen>`;
      case "vat-return":
        return html`<dashboard-vat-return-screen .api=${this.api}></dashboard-vat-return-screen>`;
      case "orders":
        return html`<dashboard-orders-screen
          .api=${this.api}
          .canExport=${this.#sessionPermissions.includes("report.export")}
        ></dashboard-orders-screen>`;
      case "staff":
        return html`<dashboard-staff-screen
          .api=${this.api}
          .currentPersonId=${this.myPersonId}
        ></dashboard-staff-screen>`;
      case "modifiers":
        return html`<dashboard-modifiers-screen .api=${this.api}></dashboard-modifiers-screen>`;
      case "menus":
        return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen>`;
      case "catalogue":
        return html`<dashboard-catalogue-screen
          .api=${this.api}
          sticky-header
        ></dashboard-catalogue-screen>`;
      case "units":
        return html`<dashboard-units-screen .api=${this.api}></dashboard-units-screen>`;
      case "content-languages":
        return html`<dashboard-content-languages-screen
          .api=${this.api}
        ></dashboard-content-languages-screen>`;
      case "venue-settings":
        return html`<dashboard-venue-settings-screen
          .panels=${this.#settingsPanels()}
          @venue-identity-changed=${() => void this.#rereadVenueName()}
        ></dashboard-venue-settings-screen>`;
      case "approvals":
        return html`<dashboard-approvals-screen .api=${this.api}></dashboard-approvals-screen>`;
      case "planned-actual":
        return html`<dashboard-planned-actual-screen
          .api=${this.api}
        ></dashboard-planned-actual-screen>`;
      case "purchases":
        return html`<dashboard-purchases-screen .api=${this.api}></dashboard-purchases-screen>`;
      case "devices":
        return html`<dashboard-devices-screen
          .api=${this.api}
          .canManageReaders=${this.#sessionPermissions.includes("payments.manage")}
        ></dashboard-devices-screen>`;
      case "printers":
        return html`<dashboard-printers-screen
          .api=${this.api}
          .canManage=${this.#sessionPermissions.includes("printer.manage")}
        ></dashboard-printers-screen>`;
      case "floor-plan":
        return html`<dashboard-floor-plan-editor .api=${this.api}
          >${this.#notices("notices")}</dashboard-floor-plan-editor
        >`;
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
      case "servers":
        return html`<dashboard-servers-screen .api=${this.api}></dashboard-servers-screen>`;
      case "email":
        return html`<dashboard-email-screen
          .api=${this.api}
          .canManage=${this.#sessionPermissions.includes("system.manage")}
        ></dashboard-email-screen>`;
      case "demo-printer":
        return html`<dashboard-demo-printer-screen
          .api=${this.api}
        ></dashboard-demo-printer-screen>`;
      case "demo-reader":
        return html`<dashboard-demo-reader-screen .api=${this.api}></dashboard-demo-reader-screen>`;
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
