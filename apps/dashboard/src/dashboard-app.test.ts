import { page } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import { diag } from "./diagnostics.js";

/**
 * Installs a CONTROLLABLE stub for `window.matchMedia`, targeting only the drawer breakpoint
 * (`(max-width: 48rem)`); every other query (e.g. prefers-color-scheme) delegates to the real one, so
 * theming is untouched. Returns `set(narrow)` — which flips `matches` and fires the shell's registered
 * change listener — and `restore()`. Used instead of a real viewport resize because a genuine
 * desktop↔narrow resize does NOT reliably re-fire matchMedia in this headless browser within a test
 * budget (proven: the narrow→desktop transition timed out). This drives the shell's `narrow` state
 * deterministically. Install it BEFORE mountWidget so the element's connectedCallback reads the stub.
 */
function stubDrawerMatchMedia(): { set: (narrow: boolean) => void; restore: () => void } {
  const DRAWER_QUERY = "(max-width: 48rem)";
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = false;
  const mql = {
    get matches() {
      return matches;
    },
    media: DRAWER_QUERY,
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    query === DRAWER_QUERY ? mql : original(query)) as typeof window.matchMedia;
  return {
    set(narrow: boolean) {
      matches = narrow;
      for (const cb of listeners) cb({ matches: narrow } as MediaQueryListEvent);
    },
    restore() {
      window.matchMedia = original;
    },
  };
}
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { DashboardApi, PersonSummary } from "./api/client.js";

/** A stub of the module request primitive: every module screen reads through it on connect. Resolves an
 * empty array for the reads the bundled bookings screen makes (listTables + the day's bookings), so
 * mounting it in the generic-mount test leaves no stray rejection. */
const stubRequest: DashboardRequest = async () => [] as never;

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: true,
    email: null,
  },
];

/**
 * A fake `DashboardApi` covering every method the shell (and the screens it mounts) calls: the shell
 * itself calls `getMe` (the WHOAMI session probe) and `logout`; the login screen it mounts calls
 * `getStaffRoster`/`login`, the manager staff screen calls `listStaff`/`createPerson`, and the staff
 * self-service screen calls `getStaffRoster`/`listMyShifts`/`listMySwaps`/`listMyAbsences`. Each
 * defaults to a resolved value; `getMe` defaults to a MANAGER (so the default probe lands on the
 * manager `staff` screen, the pre-role-awareness behaviour). A test overrides any with its own
 * `vi.fn()`. Cast through `unknown` because the shell touches only this method surface, mirroring
 * `apps/till/src/till-app.test.ts`'s `stubApi`.
 */
function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    // Per-user-language-preference (Task 10): getMe now carries the person's stored `locale` + the
    // `venueLocale` fallback (default: no preference at a Spanish venue → the UI stays es-ES); the boot
    // seed reads `getLocales` (loginDefault es-ES) and the logged-in persist path writes `putLocale`.
    // Module gating (Task 4): the default probe is a manager HOLDING `booking.manage` with `bookings`
    // enabled — reproducing the prior always-on bookings module for the Task-3 nav/screen tests. A test
    // that gates on the module supplies its own `permissions`/`modules`.
    getMe: vi.fn().mockResolvedValue({
      personId: "p1",
      role: "manager",
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
      permissions: ["booking.manage"],
      modules: ["bookings"],
    }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue(people),
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    inspectAccountAction: vi
      .fn()
      .mockResolvedValue({ email: "new@example.test", purpose: "invitation" }),
    createPerson: vi.fn().mockResolvedValue({ id: "p2" }),
    logout: vi.fn().mockResolvedValue(undefined),
    // The staff self-service (my-schedule) screen loads these on connect; resolve them so a staff-role
    // session (or navigating there) leaves no stray rejection.
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    // The catalogue screen the nav mounts loads these on connect; resolve them so navigating to it
    // does not leave a stray rejection (a rejection is a finding — the suite runs pristine). The
    // catalogue screen also loads `listStations` (KDS-1 routing selects), as does the Cocina screen.
    listCatalogues: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    // The receipt screen the nav mounts loads `getReceipt` on connect; resolve it (and stub the
    // writer it calls on Guardar) so navigating to it leaves no stray rejection.
    getReceipt: vi.fn().mockResolvedValue({ receipt: {} }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    // The service-status screen the nav mounts loads this on connect; resolve it so navigating to it
    // leaves no stray rejection.
    listStatuses: vi.fn().mockResolvedValue([]),
    // The roster screen the nav mounts loads these on connect; resolve them so navigating to it leaves
    // no stray rejection.
    getLocations: vi.fn().mockResolvedValue([{ id: "loc-1", name: "Main" }]),
    getRoster: vi.fn().mockResolvedValue({ version: null, shifts: [] }),
    // The approvals screen the nav mounts loads both queues on connect; resolve them so navigating to
    // it leaves no stray rejection.
    listPendingSwaps: vi.fn().mockResolvedValue([]),
    listPendingAbsences: vi.fn().mockResolvedValue([]),
    // The planned-vs-actual screen the nav mounts loads this on connect (after getLocations/listStaff,
    // both already stubbed above); resolve it so navigating to it leaves no stray rejection.
    getPlannedVsActual: vi.fn().mockResolvedValue([]),
    // The purchases screen the nav mounts loads this on connect; resolve it so navigating to it leaves
    // no stray rejection.
    listPurchaseInvoices: vi.fn().mockResolvedValue([]),
    // The floor-plan screen the nav mounts loads this on connect; resolve it so navigating to it leaves
    // no stray rejection. (The bookings screen is a MODULE now — it loads through the injected `.request`,
    // not this api — so its reads are stubbed by `stubRequest`, not here.)
    listTables: vi.fn().mockResolvedValue([]),
    // The devices screen the nav mounts loads this on connect (listStations is already stubbed above);
    // resolve it so navigating to it leaves no stray rejection.
    listDevices: vi.fn().mockResolvedValue([]),
    // The printers screen the nav mounts loads these three on connect; resolve them so navigating to it
    // leaves no stray rejection.
    listAgents: vi.fn().mockResolvedValue([]),
    listPrinters: vi.fn().mockResolvedValue([]),
    listRecentJobs: vi.fn().mockResolvedValue([]),
    // The canvas-editor screen the nav mounts loads this on connect; resolve it so navigating to it
    // leaves no stray rejection.
    listCanvases: vi.fn().mockResolvedValue([]),
    // The diagnostics screen (manager-gated nav) polls these on connect; resolve them so navigating to
    // it leaves no stray rejection.
    getRecentLogs: vi.fn().mockResolvedValue({ lines: [] }),
    getVerbosity: vi.fn().mockResolvedValue({ level: "info", revertsAt: null }),
    setVerbosity: vi.fn().mockResolvedValue(undefined),
    // The overview screen is the non-staff LANDING (Task 9), so it loads on connect for almost every
    // manager/supervisor/admin session in this suite; resolve it so booting leaves no stray rejection.
    getSalesOverview: vi.fn().mockResolvedValue({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    // The sales screen the nav mounts loads a single-day close by default (from === to === today());
    // resolve both report calls so navigating to it leaves no stray rejection.
    getDailyClose: vi.fn().mockResolvedValue({
      businessDay: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      cash: { byTill: [], tenderTotal: "0.00", tipTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      topSellers: [],
    }),
    getSalesPeriod: vi.fn().mockResolvedValue({
      from: "2026-08-30",
      to: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      topSellers: [],
    }),
    ...overrides,
  } as unknown as DashboardApi;
}

it.each(["staff", "supervisor", "manager", "admin"])(
  "makes Your profile reachable for %s, including by URL",
  async (role) => {
    history.replaceState(null, "", "/manage/profile");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role,
        locale: null,
        venueLocale: "en-GB",
        permissions: [],
        modules: [],
        venueName: "Venue",
      }),
      getProfile: vi.fn().mockResolvedValue({
        displayName: "Alex",
        email: "alex@example.com",
        locale: "en-GB",
        hasPassword: true,
        hasTotp: false,
        passkeys: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=profile]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-profile-screen")).not.toBeNull();
    if (role === "staff") expect(el.shadowRoot!.querySelector("nav")).toBeNull();
    const profile = el.shadowRoot!.querySelector("dashboard-profile-screen")!;
    await profile.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(profile.shadowRoot!.querySelector("[data-test=close-profile]")).toBeNull();
  },
);

/** Drains the microtask queue (settling the awaited probe/logout promises) then Lit's render. */
async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const login = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-login-screen");
const mySchedule = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-my-schedule-screen");
const overview = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-overview-screen");
const sales = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-sales-screen");
const staff = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-staff-screen");
const catalogue = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-catalogue-screen");
const receipt = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-receipt-screen");
const statuses = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-service-status-screen");
const roster = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-roster-screen");
const approvals = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-approvals-screen");
const plannedActual = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-planned-actual-screen");
const purchases = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-purchases-screen");
const kitchen = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-kitchen-screen");
const devices = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-devices-screen");
const screenPrinters = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-printers-screen");
const screenCanvasEditor = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-canvas-editor-screen");
const logoutBtn = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]");
const brandBanner = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=brand-banner]");
const venueName = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=venue-name]");
const modeIndicator = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=mode-indicator]");
const navOverview = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]");
const navSales = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-sales]");
const navStaff = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-staff]");
const navCatalogue = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-catalogue]");
const navReceipt = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-receipt]");
const navStatuses = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-statuses]");
const navRoster = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-roster]");
const navApprovals = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-approvals]");
const navPlannedActual = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-planned-actual]");
const navPurchases = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-purchases]");
const navKitchen = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-kitchen]");
const navDevices = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-devices]");
const navPrinters = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-printers]");
const navCanvasEditor = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-canvas-editor]");
/** The sidebar's navigation landmark (present only for a non-staff logged-in session). */
const sidebarNav = (el: DashboardApp) => el.shadowRoot!.querySelector("nav[aria-label]");
/** A nav item by its stable `data-test="nav-<screen>"` id (the ids every downstream consumer pins). */
const navItem = (el: DashboardApp, screen: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="nav-${screen}"]`);

/** The faces the grouped sidebar switches between for a manager/admin session (`diagnostics` is
 * manager-gated), every one keeping its `data-test` id — used to assert each item is present and to
 * pin the count. Eighteen are CORE faces; `bookings` is the bookings MODULE face, always enabled by
 * this suite's default stub (`modules: ["bookings"]` + `booking.manage`), so it is folded into the
 * fixture. A module face renders AFTER its group's core items, so `bookings` sorts to the END of the
 * Service group (after kitchen), which this order mirrors — pinned overview+sales, then Menu /
 * Service (+ the bookings module face) / Team / Purchasing / Configuration. The membership test below
 * asserts presence and count, not order. */
const NAV_SCREENS = [
  "overview",
  "sales",
  "catalogue",
  "recipe",
  "floor",
  "statuses",
  "kitchen",
  "bookings",
  "staff",
  "roster",
  "approvals",
  "planned-actual",
  "purchases",
  "receipt",
  "devices",
  "printers",
  "canvas-editor",
  "diagnostics",
  "backup",
  "email",
] as const;

/** The five group-header i18n keys the sidebar renders (the pinned overview+sales group has none). */
const NAV_GROUP_KEYS = [
  "nav.group.menu",
  "nav.group.service",
  "nav.group.team",
  "nav.group.purchasing",
  "nav.group.configuration",
] as const;
/** The chooser in the logged-in shell (present only when logged in). */
const shellChooser = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("dashboard-language-chooser");
/** The chooser nested inside the login screen's OWN shadow root (present only on the login screen). */
const loginChooser = (el: DashboardApp) =>
  login(el)!.shadowRoot!.querySelector<HTMLElement>("dashboard-language-chooser");

/** The logged-in screen tags — exactly one is mounted at a time (the staff self-service face plus the
 * manager faces the shell test navigates). */
const SCREEN_TAGS = [
  "dashboard-my-schedule-screen",
  "dashboard-overview-screen",
  "dashboard-sales-screen",
  "dashboard-staff-screen",
  "dashboard-catalogue-screen",
  "dashboard-receipt-screen",
  "dashboard-service-status-screen",
  "dashboard-roster-screen",
  "dashboard-approvals-screen",
  "dashboard-planned-actual-screen",
  "dashboard-purchases-screen",
  "dashboard-kitchen-screen",
  "dashboard-devices-screen",
  "dashboard-printers-screen",
  "dashboard-canvas-editor-screen",
  "dashboard-diagnostics-screen",
  "dashboard-email-screen",
] as const;

/** The screen tags currently mounted in the shell (should always be exactly one when logged in). */
function mountedScreens(el: DashboardApp): string[] {
  return SCREEN_TAGS.filter((tag) => el.shadowRoot!.querySelector(tag));
}

/** Count every `<h1>` in the composed tree: the shell's own (there are none) plus the mounted
 * screen's — the heading-outline invariant is exactly one across the whole DOM. */
function countH1(el: DashboardApp): number {
  const shellH1 = el.shadowRoot!.querySelectorAll("h1").length;
  const screenH1 = SCREEN_TAGS.reduce((n, tag) => {
    const screen = el.shadowRoot!.querySelector(tag);
    return n + (screen?.shadowRoot?.querySelectorAll("h1").length ?? 0);
  }, 0);
  return shellH1 + screenH1;
}

/** Fires the login screen's composed, bubbling `logged-in` — the exact shape it emits on success. */
function emitLoggedIn(source: Element): void {
  source.dispatchEvent(
    new CustomEvent("logged-in", { detail: { personId: "p1" }, bubbles: true, composed: true }),
  );
}

/** Fires a composed, bubbling CustomEvent from `source` — the shape the chooser's `locale-selected`
 * (and every screen's event) emits, so it crosses the shadow boundary up to the shell's handler. */
function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  sessionStorage.clear();
  localStorage.clear();
});
// `setLocale` mutates module-global state that outlives a test, so pin it back to the shipped default
// around every case — otherwise one test's switch leaks into the next.
beforeEach(() => setLocale("es-ES"));
afterEach(() => setLocale("es-ES"));

describe("dashboard-app", () => {
  it("returns to login when the known session deadline passes without another request", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          venueName: "Deli Test SL",
          permissions: [],
          modules: [],
          sessionExpiresInSeconds: 1,
          sessionIdleTimeoutSeconds: 2,
        }),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(overview(el)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(999);
      await el.updateComplete;
      expect(overview(el)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      await el.updateComplete;
      expect(login(el)).not.toBeNull();
      expect(login(el)!.shadowRoot!.textContent).toContain(
        codeMessage("management_session.expired"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns to login when a protected request reports an expired session", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    expect(overview(el)).not.toBeNull();

    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: { code: "management_session.expired" },
      }),
    );
    await el.updateComplete;
    expect(login(el)).not.toBeNull();
    expect(login(el)!.shadowRoot!.textContent).toContain(codeMessage("management_session.expired"));
  });

  it("moves the browser deadline after a successful authenticated request", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          venueName: "Deli Test SL",
          permissions: [],
          modules: [],
          sessionExpiresInSeconds: 1,
          sessionIdleTimeoutSeconds: 2,
        }),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(750);
      window.dispatchEvent(new Event("waitron-session-active"));
      await vi.advanceTimersByTimeAsync(1_249);
      await el.updateComplete;
      expect(overview(el)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(752);
      await el.updateComplete;
      expect(login(el)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks the session when a hidden tab becomes visible", async () => {
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({
        personId: "p1",
        role: "manager",
        locale: null,
        venueLocale: "es-ES",
        venueName: "Deli Test SL",
        permissions: [],
        modules: [],
      })
      .mockRejectedValueOnce({ code: "management_session.expired" });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe }),
    });
    await flush(el);
    expect(overview(el)).not.toBeNull();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush(el);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(login(el)).not.toBeNull();
  });

  it("does not restore protected content from a session probe that resolves after logout", async () => {
    let resolveLate!: (value: unknown) => void;
    const late = new Promise((resolve) => (resolveLate = resolve));
    const initial = {
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      venueName: "Deli Test SL",
      permissions: [],
      modules: [],
    };
    const getMe = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(late);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi({ getMe }) });
    await flush(el);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: { code: "management_session.expired" },
      }),
    );
    resolveLate(initial);
    await flush(el);
    expect(login(el)).not.toBeNull();
  });

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-app")).toBe(DashboardApp);
  });

  it("shows the Waitron banner and venue name on the login screen without logout", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    expect(brandBanner(el)).toBeTruthy();
    expect(brandBanner(el)!.querySelector<HTMLImageElement>('img[alt="Waitron"]')).toBeTruthy();
    expect(venueName(el)!.textContent?.trim()).toBe("Deli Test SL");
    expect(modeIndicator(el)?.textContent?.trim()).toBe("Preparación");
    expect(logoutBtn(el)).toBeNull();
  });

  it("shows an account-action link before probing an existing management session", async () => {
    history.replaceState(
      null,
      "",
      "/manage/account?token=action-token&purpose=invitation#email=new%40example.test",
    );
    const getMe = vi.fn().mockResolvedValue({
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      venueName: "Deli Test SL",
      permissions: [],
      modules: [],
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe }),
    });
    await flush(el);

    expect(login(el)?.shadowRoot?.querySelector("[data-test=complete-account]")).not.toBeNull();
    expect(overview(el)).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it("puts logout on the right side of the authenticated banner", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);

    const banner = brandBanner(el)!;
    const name = venueName(el)!;
    const logout = logoutBtn(el)!;
    expect(banner).toBeTruthy();
    expect(name.textContent?.trim()).toBe("Deli Test SL");
    expect(logout).toBeTruthy();
    expect(logout.getBoundingClientRect().left).toBeGreaterThan(name.getBoundingClientRect().right);
    const bannerBox = banner.getBoundingClientRect();
    const trailingPadding = Number.parseFloat(getComputedStyle(banner).paddingRight);
    expect(logout.getBoundingClientRect().right).toBeCloseTo(bannerBox.right - trailingPadding, 0);
  });

  it("puts the full-width banner above both the sidebar and page content", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);

    const shell = el.shadowRoot!.querySelector<HTMLElement>(".shell")!;
    const banner = brandBanner(el)!;
    const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
    const main = el.shadowRoot!.querySelector<HTMLElement>(".main")!;
    const hostBox = el.getBoundingClientRect();
    const bannerBox = banner.getBoundingClientRect();

    expect(shell.firstElementChild).toBe(banner);
    expect(bannerBox.left).toBeCloseTo(hostBox.left, 0);
    expect(bannerBox.right).toBeCloseTo(hostBox.right, 0);
    expect(sidebar.getBoundingClientRect().top).toBeGreaterThanOrEqual(bannerBox.bottom);
    expect(main.getBoundingClientRect().top).toBeGreaterThanOrEqual(bannerBox.bottom);
  });

  it("shows login when no session, business overview after a manager logs in", async () => {
    // getMe rejects at boot (no session) then resolves as a MANAGER after login — the real shape: the
    // whoami 401s before login and resolves once the cookie is set. Since Task 9 a non-staff login
    // lands on the business `overview` screen (was the manager `staff` screen — still one nav click
    // away, see the "navigates between the staff and catalogue screens" test).
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          venueName: "Deli Test SL",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(overview(el)).toBeNull();

    emitLoggedIn(login(el)!);
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(login(el)).toBeNull();
    expect(venueName(el)!.textContent?.trim()).toBe("Deli Test SL");
  });

  it("starts on the business overview screen when a manager session already exists", async () => {
    // Default getMe resolves as a manager → the shell lands on the business `overview` screen (Task 9's
    // non-staff landing).
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(mySchedule(el)).toBeNull();
    expect(login(el)).toBeNull();
  });

  it("a STAFF-role session opens on the self-service my-schedule screen, never the manager staff screen", async () => {
    // The whole point of the fast-follow: a staff person (empty permission set) resolves via role-blind
    // getMe and lands on the self-service view, not the manager screens. Proven by deletion: dropping
    // the `role === "staff" ? "my-schedule" : "overview"` branch in #applyMe lands them on `overview`
    // instead — the non-staff default screen.
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(mySchedule(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(mountedScreens(el)).toEqual(["dashboard-my-schedule-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("a staff session shows NO manager nav (its only face is self-service)", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    // No nav faces…
    expect(navStaff(el)).toBeNull();
    expect(navCatalogue(el)).toBeNull();
    expect(navRoster(el)).toBeNull();
    // …but the logout control is still present (a staff person can sign out).
    expect(logoutBtn(el)).toBeTruthy();
  });

  it("threads the logged-in person's id to the my-schedule screen", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect((mySchedule(el) as unknown as { myPersonId: string }).myPersonId).toBe("p9");
  });

  it("a STAFF login (after no session) lands on the my-schedule screen", async () => {
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p9",
          role: "staff",
          locale: null,
          venueLocale: "es-ES",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();

    emitLoggedIn(login(el)!);
    await flush(el);
    expect(mySchedule(el)).toBeTruthy();
    expect(login(el)).toBeNull();
  });

  it("opens Your profile after an invited person completes account setup", async () => {
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p9",
          role: "staff",
          locale: null,
          venueLocale: "es-ES",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    login(el)!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: { personId: "p9", accountSetup: true },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-profile-screen")).not.toBeNull();
  });

  it("treats ANY probe rejection as not-logged-in, never an unhandled rejection", async () => {
    // The common case is the `management_session.required`/401 reject, but the probe catches
    // EVERYTHING so a stray/network rejection still lands on login rather than escaping unhandled
    // (the whole suite runs with pristine output, which pins that). A bare Error carries no `code`.
    const api = stubApi({ getMe: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
  });

  it("contains the logged-in event so it does not leak past the shell (stopPropagation)", async () => {
    // House pattern: the shell is the final consumer of the composed `logged-in`, so it stops it at
    // the shadow boundary rather than letting it bubble on to the document. `host` is the light-DOM
    // node OUTSIDE the shell's shadow root, so a listener there fires only if propagation escaped.
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          permissions: [],
          modules: [],
        }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    const escaped = vi.fn();
    host.addEventListener("logged-in", escaped);

    emitLoggedIn(login(el)!);
    await flush(el);

    expect(overview(el)).toBeTruthy();
    expect(escaped).not.toHaveBeenCalled();
  });

  it("remembers the authenticated email and method only after login succeeds", async () => {
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "actual-person",
          role: "manager",
          email: "actual@example.com",
          locale: null,
          venueLocale: "es-ES",
          venueName: "Deli Test SL",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    login(el)!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: { personId: "untrusted", loginMethod: "passkey", rememberEmail: true },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(JSON.parse(localStorage.getItem("waitron-login-preference")!)).toEqual({
      email: "actual@example.com",
      method: "passkey",
    });
    expect(sessionStorage.getItem("waitron-login-preference")).toBeNull();
  });

  it("does not carry a remembered account's consent to a different passkey identity", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "saved@example.com", method: "passkey" }),
    );
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "other",
          role: "manager",
          email: "other@example.com",
          locale: null,
          venueLocale: "es-ES",
          venueName: "Deli Test SL",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    emit(login(el)!, "logged-in", {
      loginMethod: "passkey",
      rememberEmail: true,
      rememberedEmail: "saved@example.com",
    });
    await flush(el);
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
  });

  it("remembers an opted-in Google callback only after its identity probe succeeds", async () => {
    history.replaceState(null, "", "/manage/?login=google");
    sessionStorage.setItem(
      "waitron-google-login-preference",
      JSON.stringify({ expiresAt: Date.now() + 60000 }),
    );
    let resolve!: (value: unknown) => void;
    const api = stubApi({
      getMe: vi.fn().mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
    expect(sessionStorage.getItem("waitron-google-login-preference")).toBeNull();
    expect(location.search).not.toContain("login=google");
    resolve({
      personId: "google-person",
      role: "manager",
      email: "google@example.com",
      locale: null,
      venueLocale: "es-ES",
      venueName: "Deli Test SL",
      permissions: [],
      modules: [],
    });
    await flush(el);
    expect(JSON.parse(localStorage.getItem("waitron-login-preference")!)).toEqual({
      email: "google@example.com",
      method: "google",
    });
  });

  it.each(["failed", "different-account", "not-callback", "unchecked"])(
    "does not save Google preference for %s",
    async (scenario) => {
      history.replaceState(
        null,
        "",
        scenario === "not-callback" ? "/manage/" : "/manage/?login=google",
      );
      if (scenario !== "unchecked")
        sessionStorage.setItem(
          "waitron-google-login-preference",
          JSON.stringify({ expiresAt: Date.now() + 60000, rememberedEmail: "saved@example.com" }),
        );
      const api = stubApi({
        getMe:
          scenario === "failed"
            ? vi.fn().mockRejectedValue({ code: "management_session.required" })
            : vi.fn().mockResolvedValue({
                personId: "other",
                role: "manager",
                email: "other@example.com",
                locale: null,
                venueLocale: "es-ES",
                venueName: "Deli Test SL",
                permissions: [],
                modules: [],
              }),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await flush(el);
      expect(localStorage.getItem("waitron-login-preference")).toBeNull();
      expect(sessionStorage.getItem("waitron-google-login-preference")).toBeNull();
    },
  );

  it("does not show the logout control on the login screen", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(logoutBtn(el)).toBeNull();
  });

  it("logout: ends the session and returns to login (manager → login)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(overview(el)).toBeTruthy();

    logoutBtn(el)!.click();
    await flush(el);

    expect(api.logout).toHaveBeenCalledOnce();
    expect(login(el)).toBeTruthy();
    expect(overview(el)).toBeNull();
    expect(venueName(el)!.textContent?.trim()).toBe("Deli Test SL");
    expect(logoutBtn(el)).toBeNull();
  });

  // The logged-in shell gains a nav between the staff and catalogue screens. It opens on overview (the
  // probe's landing, Task 9), and the nav switches the mounted screen — exactly one shows at a time.
  it("navigates between the staff and catalogue screens", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    // Opens on overview, with both nav controls present.
    expect(overview(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(catalogue(el)).toBeNull();
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();

    // To staff.
    navStaff(el)!.click();
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect((staff(el) as unknown as { currentPersonId: string }).currentPersonId).toBe("p1");
    expect(overview(el)).toBeNull();

    // To catalogue.
    navCatalogue(el)!.click();
    await flush(el);
    expect(catalogue(el)).toBeTruthy();
    expect(staff(el)).toBeNull();

    // Back to staff.
    navStaff(el)!.click();
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect(catalogue(el)).toBeNull();
  });

  // Task 9: the two new reporting faces. The shell opens on overview (Task 9's landing), navigating to
  // sales mounts the sales screen, and navigating back to overview mounts it again (proving the "home"
  // nav button also works as a plain switch, not just the boot-time default).
  it("navigates to the sales screen and back to overview", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(navOverview(el)).toBeTruthy();
    expect(navSales(el)).toBeTruthy();

    navSales(el)!.click();
    await flush(el);
    expect(sales(el)).toBeTruthy();
    expect(overview(el)).toBeNull();
    expect(mountedScreens(el)).toEqual(["dashboard-sales-screen"]);
    expect(countH1(el)).toBe(1);

    navOverview(el)!.click();
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(sales(el)).toBeNull();
    expect(mountedScreens(el)).toEqual(["dashboard-overview-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the roster (shifts) screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navRoster(el)).toBeTruthy();
    navRoster(el)!.click();
    await flush(el);
    expect(roster(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-roster-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the approvals screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navApprovals(el)).toBeTruthy();
    navApprovals(el)!.click();
    await flush(el);
    expect(approvals(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-approvals-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the planned-vs-actual screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navPlannedActual(el)).toBeTruthy();
    navPlannedActual(el)!.click();
    await flush(el);
    expect(plannedActual(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-planned-actual-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the purchases screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navPurchases(el)).toBeTruthy();
    navPurchases(el)!.click();
    await flush(el);
    expect(purchases(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-purchases-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the service-status screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navStatuses(el)).toBeTruthy();
    navStatuses(el)!.click();
    await flush(el);
    expect(statuses(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-service-status-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the kitchen (Cocina) screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navKitchen(el)).toBeTruthy();
    navKitchen(el)!.click();
    await flush(el);
    expect(kitchen(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-kitchen-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the devices screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navDevices(el)).toBeTruthy();
    navDevices(el)!.click();
    await flush(el);
    expect(devices(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-devices-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the printers screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navPrinters(el)).toBeTruthy();
    navPrinters(el)!.click();
    await flush(el);
    expect(screenPrinters(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-printers-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("navigates to the canvas-editor screen", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navCanvasEditor(el)).toBeTruthy();
    navCanvasEditor(el)!.click();
    await flush(el);
    expect(screenCanvasEditor(el)).toBeTruthy();
    expect(mountedScreens(el)).toEqual(["dashboard-canvas-editor-screen"]);
    expect(countH1(el)).toBe(1);
  });

  // Roster ("Turnos"), approvals ("Aprobaciones"), planned-actual ("Previsto vs real"), purchases
  // ("Compras") and service-status ("Estados de servicio") each have their own dedicated nav test
  // above, so this test walks the remaining three faces (staff / catalogue / receipt).
  // Exactly one screen — and exactly one <h1> (each screen owns its own; the shell adds none) — shows
  // at a time.
  it("navigates the three non-roster logged-in screens, one screen and one h1 at a time", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    // Opens on overview (Task 9's non-staff landing), with all three nav controls present.
    expect(mountedScreens(el)).toEqual(["dashboard-overview-screen"]);
    expect(countH1(el)).toBe(1);
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();
    expect(navReceipt(el)).toBeTruthy();

    // To staff.
    navStaff(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-staff-screen"]);
    expect(staff(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);

    // To receipt.
    navReceipt(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-receipt-screen"]);
    expect(receipt(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);

    // To catalogue.
    navCatalogue(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-catalogue-screen"]);
    expect(catalogue(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);

    // Back to staff.
    navStaff(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-staff-screen"]);
    expect(staff(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);
  });

  it("records a nav event on the shared diagnostics trail when the screen changes", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    // `diag` is a MODULE SINGLETON shared across every test, so scope the assertion to events appended
    // after this baseline rather than the total length (which leaks across tests).
    const before = diag.snapshot().length;
    navSales(el)!.click();
    await flush(el);
    const nav = diag
      .snapshot()
      .slice(before)
      .find((e) => e.event === "nav");
    expect(nav?.fields.screen).toBe("sales");
  });

  // The grouped static sidebar (Task 11): every group header renders, every one of the twenty manager
  // faces (a manager session sees the gated configuration tools too) keeps its `data-test="nav-<screen>"`
  // id, and the active face is marked `aria-current="page"`.
  it("renders each nav group header and all nav items", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    // Every group header (an <h2 class="nav-group">) renders its localised label…
    const headers = [...el.shadowRoot!.querySelectorAll("h2.nav-group")].map((h) =>
      h.textContent?.trim(),
    );
    for (const key of NAV_GROUP_KEYS) expect(headers).toContain(t(key));
    // …and every manager face is present by its stable data-test id.
    for (const s of NAV_SCREENS) expect(navItem(el, s)).toBeTruthy();
    expect(NAV_SCREENS).toHaveLength(20);
    expect(navItem(el, "location-menus")).toBeNull();
    expect(navItem(el, "catalogue")!.textContent).toContain(t("nav.catalogue"));
  });

  // The module-UI seam (SP2 Task 3): a BUNDLED module's screen and nav are mounted GENERICALLY from the
  // registry, not hand-wired. `bookings` is now a module contribution (its screen + widget live in
  // @waitron/bookings/dashboard, reached only via @waitron/dashboard-modules); here it is active with no
  // gate, so a non-staff session shows its nav item and routing to it renders <dashboard-bookings-screen>
  // through the generic path. Proof-by-deletion: dropping the `#activeScreens.get(this.screen)` lookup in
  // #renderScreen (or the module-items append in #nav) makes the respective assertion below go red.
  it("renders a bundled module's screen and nav via the generic path", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      request: stubRequest,
    });
    await flush(el);
    // The module's nav item shows (in its declared `service` group), by its stable data-test id…
    expect(navItem(el, "bookings")).toBeTruthy();
    // …and routing to it mounts the module's own screen element through the generic mount path.
    navItem(el, "bookings")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).not.toBeNull();
  });

  // The two runtime gates (SP2 Task 4): a module's nav/screen shows only when the module is ENABLED
  // (`me.modules`) AND the signed-in person HOLDS its permission (`me.permissions` ⊇ requiresPermission).
  // Both directions are proven: enabled-but-not-permitted and permitted-but-not-enabled each HIDE it,
  // and only enabled+permitted shows it and routes to it.
  it("hides a module's nav AND denies its screen when the permission is absent (enabled but not permitted)", async () => {
    // bookings is ENABLED (`modules: ["bookings"]`) but the manager does NOT hold `booking.manage`, so
    // the nav item is filtered out and a URL naming the module falls back to overview. Drive the URL
    // restore path to prove `#permittedScreen` denies the module id, not just the nav filter.
    const url = new URL(location.href);
    url.pathname = "/manage/bookings";
    history.replaceState(null, "", url);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          permissions: [],
          modules: ["bookings"],
        }),
      }),
      request: stubRequest,
    });
    await flush(el);
    expect(navItem(el, "bookings")).toBeNull();
    // The requested `bookings` URL is denied and falls back to the overview landing.
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).toBeNull();
    expect(overview(el)).toBeTruthy();
  });

  it("hides a module entirely when it is not in the enabled set (permitted but not enabled)", async () => {
    // The manager HOLDS `booking.manage`, but bookings is NOT enabled (`modules: []`), so the module is
    // never activated: its nav item is absent and its screen never mounts.
    const url = new URL(location.href);
    url.pathname = "/manage/bookings";
    history.replaceState(null, "", url);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          permissions: ["booking.manage"],
          modules: [],
        }),
      }),
      request: stubRequest,
    });
    await flush(el);
    expect(navItem(el, "bookings")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).toBeNull();
    expect(overview(el)).toBeTruthy();
  });

  it("shows a module's nav and routes to its screen when enabled AND permitted", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          permissions: ["booking.manage"],
          modules: ["bookings"],
        }),
      }),
      request: stubRequest,
    });
    await flush(el);
    expect(navItem(el, "bookings")).not.toBeNull();
    navItem(el, "bookings")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).not.toBeNull();
  });

  // Module activation RECONCILES per session, it is not once-ever: a second /me (a re-probe or re-login)
  // whose `modules` set no longer enables a module must stop showing it, even though a tab stayed open.
  // A run-it probe falsified the once-ever early-return — `modules: []` on a second session still
  // permitted bookings. Proof-by-deletion: restoring the `if (this.#activeScreens.size) return` guard to
  // #activate makes the post-re-login assertions go red (the module lingers).
  it("reconciles the active module set on a re-login — a now-disabled module stops showing", async () => {
    const session1 = {
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      permissions: ["booking.manage"],
      modules: ["bookings"],
    };
    // Second session: SAME person and permission, but bookings is no longer enabled server-side.
    const session2 = { ...session1, modules: [] as string[] };
    const getMe = vi.fn().mockResolvedValueOnce(session1).mockResolvedValue(session2);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe }),
      request: stubRequest,
    });
    await flush(el);
    // First session: bookings enabled + permitted → its nav shows and it routes.
    expect(navItem(el, "bookings")).not.toBeNull();
    navItem(el, "bookings")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).not.toBeNull();

    // Re-login on the SAME element: logout drops to login, the login screen's `logged-in` re-probes,
    // and the second /me disables bookings. The active set must be rebuilt from it, not left once-ever.
    logoutBtn(el)!.click();
    await flush(el);
    emitLoggedIn(login(el)!);
    await flush(el);

    expect(navItem(el, "bookings")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).toBeNull();
    expect(overview(el)).toBeTruthy();
  });

  // A contribution naming a nav group the app does not know is a WIRING ERROR — #activate THROWS rather
  // than silently skipping the screen. The throw fires in #applyMe, inside #probeSession's total catch,
  // so it surfaces as the app dropping the otherwise-valid MANAGER session to login (nothing mounts).
  // That distinguishes throw from a silent `continue`: a silent skip would let the manager through to
  // overview. Driven by monkey-patching the shared registry array for this one mount (restored in a
  // finally), so the guard is exercised without a second fixture module.
  it("refuses to mount when a contribution names an unknown nav group (throws in #activate)", async () => {
    const bad = {
      module: "bookings",
      screen: {
        id: "bookings",
        navLabelKey: "nav.bookings",
        group: "nowhere",
        requiresPermission: "x",
      },
      strings: { en: {}, es: {} },
      create: () => ({ render: () => html`` }),
    };
    const list = DASHBOARD_MODULES as unknown as unknown[];
    const original = [...list];
    list.length = 0;
    list.push(bad);
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
        request: stubRequest,
      });
      await flush(el);
      // A silent skip would have landed this manager on overview; the throw dropped it to login.
      expect(login(el)).toBeTruthy();
      expect(overview(el)).toBeNull();
    } finally {
      list.length = 0;
      list.push(...original);
    }
  });

  // The diagnostics nav is manager-gated (`requiresManager: true`, Task 15): a `supervisor` session
  // must NOT see it, while a `manager` (and `admin`) session does. Proof-by-deletion: dropping the
  // `.filter((item) => !item.requiresManager || …)` from `#nav()` renders it for the supervisor too,
  // so the first assertion below goes red.
  it("hides the diagnostics nav from a supervisor and shows it to a manager", async () => {
    const supervisor = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p3",
        role: "supervisor",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
      listStaff: vi.fn().mockResolvedValue([]),
    });
    const { el: sup } = await mountWidget<DashboardApp>("dashboard-app", { api: supervisor });
    await flush(sup);
    // A supervisor sees the ordinary configuration items but not the gated diagnostics one.
    expect(navItem(sup, "devices")).toBeTruthy();
    expect(navItem(sup, "diagnostics")).toBeNull();

    const { el: mgr } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(mgr);
    expect(navItem(mgr, "diagnostics")).toBeTruthy();
  });

  it("clicking a nav item switches the screen and marks it aria-current=page", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    // Opens on overview (Task 9's landing) → overview is the current item.
    expect(navItem(el, "overview")!.getAttribute("aria-current")).toBe("page");

    navItem(el, "catalogue")!.click();
    await flush(el);
    expect(catalogue(el)).toBeTruthy();
    // The clicked item becomes current, and the previously-current one drops the marker.
    expect(navItem(el, "catalogue")!.getAttribute("aria-current")).toBe("page");
    expect(navItem(el, "overview")!.getAttribute("aria-current")).toBeNull();
  });

  // Task 12: the responsive drawer. On narrow screens the sidebar is an off-canvas drawer toggled by
  // the hamburger; opening it flips `.layout.drawer-open` and shows a scrim, and selecting any nav item
  // closes it again while STILL switching the screen (so a phone tap navigates and dismisses in one go).
  it("hamburger toggles the drawer open, a nav click closes it", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const layout = () => el.shadowRoot!.querySelector(".layout")!;
    expect(layout().classList.contains("drawer-open")).toBe(false);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeNull();

    // Open it via the hamburger.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await el.updateComplete;
    expect(layout().classList.contains("drawer-open")).toBe(true);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeTruthy();

    // Selecting a nav item closes the drawer AND switches the screen.
    navCatalogue(el)!.click();
    await flush(el);
    expect(layout().classList.contains("drawer-open")).toBe(false);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeNull();
    expect(catalogue(el)).toBeTruthy();
  });

  it("clicking the scrim closes the drawer", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await el.updateComplete;
    const scrim = el.shadowRoot!.querySelector<HTMLElement>(".scrim");
    expect(scrim).toBeTruthy();

    scrim!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(false);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeNull();
  });

  // Task 12 (a11y): when the sidebar is off-canvas (narrow viewport) AND closed, it must be `inert` so
  // its nav buttons leave the tab order + a11y tree rather than lurking off-screen ahead of
  // every visible control. It stays interactive at desktop width and whenever the drawer is open.
  // Proof-by-deletion: dropping the `?inert=${this.narrow && !this.drawerOpen}` binding leaves the
  // sidebar never-inert, so the narrow+closed assertion below goes red.
  it("makes the off-canvas sidebar inert only when narrow and closed", async () => {
    // Drive the breakpoint via a controllable matchMedia stub (installed BEFORE mount so the shell's
    // connectedCallback reads it) — deterministic, unlike a real viewport resize here.
    const mq = stubDrawerMatchMedia();
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      const sidebar = () => el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;

      // Desktop (matchMedia does not match): in-flow and fully interactive.
      expect(sidebar().hasAttribute("inert")).toBe(false);

      // Narrow + closed → inert (the nav buttons leave the tab order + a11y tree).
      mq.set(true);
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(true);

      // Opening the drawer makes it interactive again (narrow but open)…
      const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!;
      toggle.click();
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(false);
      // …and closing it again re-inerts it (still narrow).
      toggle.click();
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(true);

      // Back to desktop width while still CLOSED → interactive again (desktop overrides closed).
      mq.set(false);
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(false);
    } finally {
      mq.restore();
    }
  });

  // Task 12 (regression): a drawer opened at narrow width must be force-closed when the viewport
  // crosses to desktop — otherwise its full-viewport scrim keeps veiling the desktop layout after a
  // resize/rotate. Proof-by-deletion: dropping `if (!e.matches) this.drawerOpen = false` from
  // #onBreakpointChange leaves `.drawer-open` + `.scrim` present at desktop, so the last two
  // assertions go red.
  it("force-closes the drawer (and drops the scrim) when widened from narrow to desktop", async () => {
    const mq = stubDrawerMatchMedia();
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      const layout = () => el.shadowRoot!.querySelector<HTMLElement>(".layout")!;
      const scrim = () => el.shadowRoot!.querySelector<HTMLElement>(".scrim");

      // Narrow, then open the drawer via the hamburger: drawer-open class + scrim both present.
      mq.set(true);
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
      await el.updateComplete;
      expect(layout().classList.contains("drawer-open")).toBe(true);
      expect(scrim()).not.toBeNull();

      // Widen to desktop WITHOUT first closing the drawer → the drawer is force-closed and the scrim
      // (which would otherwise veil the whole desktop app) is gone.
      mq.set(false);
      await el.updateComplete;
      expect(layout().classList.contains("drawer-open")).toBe(false);
      expect(scrim()).toBeNull();
    } finally {
      mq.restore();
    }
  });

  it("Escape closes an open drawer", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const layout = () => el.shadowRoot!.querySelector<HTMLElement>(".layout")!;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await el.updateComplete;
    expect(layout().classList.contains("drawer-open")).toBe(true);

    // A keydown anywhere inside the layout bubbles to the wrapper's handler.
    layout().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(layout().classList.contains("drawer-open")).toBe(false);
  });

  it("a staff session gets no hamburger toggle (its only face is self-service, so no drawer)", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=nav-toggle]")).toBeNull();
  });

  it("a staff session still gets no nav (no navigation landmark)", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(sidebarNav(el)).toBeNull();
  });

  it("does not show the nav on the login screen", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(navOverview(el)).toBeNull();
    expect(navSales(el)).toBeNull();
    expect(navStaff(el)).toBeNull();
    expect(navCatalogue(el)).toBeNull();
    expect(navReceipt(el)).toBeNull();
  });

  // The nav is chrome, not a screen: logout works the same from the catalogue screen too.
  it("logout from the catalogue screen ends the session and returns to login", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    navCatalogue(el)!.click();
    await flush(el);
    expect(catalogue(el)).toBeTruthy();

    logoutBtn(el)!.click();
    await flush(el);
    expect(api.logout).toHaveBeenCalledOnce();
    expect(login(el)).toBeTruthy();
    expect(catalogue(el)).toBeNull();
  });

  it("logout: a FAILED logout still drops to login and never rejects", async () => {
    // A rejected `logout()` must not be an unhandled rejection and must not strand the operator on
    // the staff screen — the shell wraps the await and drops to login regardless. Deleting the
    // try/catch would surface the rejection; deleting the post-await `screen = "login"` would strand.
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue([]),
      logout: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    logoutBtn(el)!.click();
    await flush(el);

    expect(api.logout).toHaveBeenCalledOnce();
    expect(login(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
  });
});

/** The resolved shape `getLocales` answers with (used by the controllable-promise disconnect tests). */
type LocalesResponse = {
  locales: { code: string; label: string }[];
  venueDefault: string;
  loginDefault: string;
  venueName: string;
};
/** The resolved shape the widened `getMe` answers with. */
type MeResponse = {
  personId: string;
  role: string;
  locale: string | null;
  venueLocale: string;
  venueName: string;
  permissions: string[];
  modules: string[];
};

describe("dashboard-app — per-user locale (Task 10)", () => {
  it("uses the browser-matched login language at a Spanish venue", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      getLocales: vi.fn().mockResolvedValue({
        locales: [],
        venueDefault: "es-ES",
        loginDefault: "en-GB",
        venueName: "Test SL",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
    expect(login(el)!.shadowRoot!.querySelector("[data-test=continue]")!.textContent).toContain(
      t("action.continue", "en-GB"),
    );
  });

  it("keeps the authenticated language when a login-language response arrives late", async () => {
    let resolveLocales!: (value: LocalesResponse) => void;
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: "es-ES",
          venueLocale: "en-GB",
          venueName: "Test SL",
          permissions: [],
          modules: [],
        }),
      getLocales: vi.fn(
        () =>
          new Promise<LocalesResponse>((resolve) => {
            resolveLocales = resolve;
          }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    emitLoggedIn(login(el)!);
    await flush(el);
    expect(overview(el)).toBeTruthy();
    resolveLocales({
      locales: [],
      venueDefault: "en-GB",
      loginDefault: "en-GB",
      venueName: "Test SL",
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
  });

  it("restores the venue language when logout and the language request both fail", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: "en-GB",
        venueLocale: "es-ES",
        venueName: "Test SL",
        permissions: [],
        modules: [],
      }),
      logout: vi.fn().mockRejectedValue(new Error("offline")),
      getLocales: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
    logoutBtn(el)!.click();
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(currentLocale()).toBe("es-ES");
  });

  it("preserves an explicit login language choice while the browser default is pending", async () => {
    let resolveLocales!: (value: LocalesResponse) => void;
    const api = stubApi({
      getLocales: vi.fn(
        () =>
          new Promise<LocalesResponse>((resolve) => {
            resolveLocales = resolve;
          }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    logoutBtn(el)!.click();
    await flush(el);
    emit(login(el)!, "locale-selected", { code: "es-ES" });
    await flush(el);
    resolveLocales({
      locales: [],
      venueDefault: "es-ES",
      loginDefault: "en-GB",
      venueName: "Test SL",
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    expect(api.putLocale).not.toHaveBeenCalled();
  });

  it("restores a known browser default immediately when logout completes", async () => {
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: "es-ES",
          venueLocale: "es-ES",
          venueName: "Test SL",
          permissions: [],
          modules: [],
        }),
      getLocales: vi.fn().mockResolvedValue({
        locales: [],
        venueDefault: "es-ES",
        loginDefault: "en-GB",
        venueName: "Test SL",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
    emitLoggedIn(login(el)!);
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    logoutBtn(el)!.click();
    // Let logout finish, but observe the language before the seed's awaited read resumes.
    await Promise.resolve();
    expect(currentLocale()).toBe("en-GB");
    await flush(el);
    expect(login(el)).toBeTruthy();
  });

  it("returns to the browser-matched language after logout", async () => {
    const api = stubApi({
      getLocales: vi.fn().mockResolvedValue({
        locales: [],
        venueDefault: "es-ES",
        loginDefault: "en-GB",
        venueName: "Test SL",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    logoutBtn(el)!.click();
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(currentLocale()).toBe("en-GB");
  });

  it("applies the supplied login default in nested controls", async () => {
    // No session → stays on `login`; the boot seed reads getLocales and applies its loginDefault (en-GB,
    // which differs from the es-ES module default so the switch is observable). The login controller
    // repaints its translated content without recreating the current attempt.
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      getLocales: vi.fn().mockResolvedValue({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(currentLocale()).toBe("en-GB");
    // The email/password field labels live inside the wt-input primitive's own shadow root, so a
    // localised string that renders in the login screen's OWN shadow is the observable proxy: the
    // first-step button's slotted text differs across locales and exercises the login controller's
    // response to the server's language default.
    const submit = login(el)!.shadowRoot!.querySelector("[data-test=continue]")!;
    expect(submit.textContent).toContain(t("action.continue", "en-GB")); // "Continue"
    expect(submit.textContent).not.toContain(t("action.continue", "es-ES")); // not "Continuar"
  });

  it("applies the person's stored locale on a logged-in boot — the seed never clobbers it, and never runs", async () => {
    // Pins the race fix. Venue default es-ES; the signed-in person's stored locale is en-GB. Because a
    // session is found, the login-language seed is SKIPPED entirely (serialized: probe first, seed only
    // when still on `login`), so the UI ends on the PERSON's en-GB — never the venue default — and
    // getLocales is never called (one WHOAMI round trip). A DEEP child (the my-schedule <h1>) renders it.
    const getLocales = vi
      .fn()
      .mockResolvedValue({ locales: [], venueDefault: "es-ES", loginDefault: "es-ES" });
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: "en-GB",
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
      getLocales,
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(mySchedule(el)).toBeTruthy();
    expect(currentLocale()).toBe("en-GB");
    expect(getLocales).not.toHaveBeenCalled();
    const h1 = mySchedule(el)!.shadowRoot!.querySelector("h1")!;
    expect(h1.textContent).toContain(t("myschedule.title", "en-GB")); // "My schedule"
    expect(h1.textContent).not.toContain(t("myschedule.title", "es-ES")); // not "Mi horario"
  });

  it("falls back to the venue default when the person has no stored locale", async () => {
    // resolveActiveLocale(null, "es-ES") === "es-ES": a person with no preference gets the venue UI.
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: null,
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(currentLocale()).toBe("es-ES");
  });

  it("switches the UI to the person's locale after they log in from the login screen", async () => {
    // No session at boot (seeded to the es-ES venue default), then a manager whose stored locale is
    // en-GB logs in: the post-login re-probe's #applyMe switches the UI to their language.
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: "en-GB",
          venueLocale: "es-ES",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(currentLocale()).toBe("es-ES");

    emitLoggedIn(login(el)!);
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(currentLocale()).toBe("en-GB");
  });

  it("a locale pick on the login screen switches transiently — setLocale, NOT putLocale (and the chooser renders + bubbles)", async () => {
    // A pre-login pick is transient: switch the UI but write NOTHING (no session to attach it to). The
    // chooser lives inside the login screen; its composed event bubbles to the shell. Proven-by-deletion
    // target: dropping the `screen === "login"` branch makes this fail (putLocale would fire).
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(loginChooser(el)).toBeTruthy(); // the login screen renders the chooser

    emit(loginChooser(el)!, "locale-selected", { code: "en-GB" });
    await flush(el);
    expect(currentLocale()).toBe("en-GB"); // switched
    expect(api.putLocale).not.toHaveBeenCalled(); // but NOT persisted
  });

  it.each(["password", "setup-passkey"] as const)(
    "keeps the %s attempt when its language changes",
    async (step) => {
      const api = stubApi({
        getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await flush(el);
      const screen = login(el)!;
      Object.assign(screen, {
        step,
        email: "typed@example.com",
        password: "current secret",
        passkeyName: "Work laptop",
      });
      await flush(el);
      emit(loginChooser(el)!, "locale-selected", { code: "en-GB" });
      await flush(el);
      expect(login(el)).toBe(screen);
      expect(screen.shadowRoot!.querySelector("h1")!.textContent).toBe(
        t(step === "password" ? "login.password_heading" : "account.offer_passkey", "en-GB"),
      );
      expect(screen.shadowRoot!.textContent).toContain("typed@example.com");
      expect(screen).toMatchObject({
        step,
        password: "current secret",
        passkeyName: "Work laptop",
      });
      expect(api.putLocale).not.toHaveBeenCalled();
    },
  );

  it("renders the chooser in the logged-in shell, and a pick there persists (putLocale) then switches (setLocale)", async () => {
    const putLocale = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ putLocale }),
    });
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(shellChooser(el)).toBeTruthy(); // the logged-in shell renders the chooser
    expect(currentLocale()).toBe("es-ES"); // manager, no stored preference, es-ES venue

    emit(shellChooser(el)!, "locale-selected", { code: "en-GB" });
    await flush(el);
    expect(putLocale).toHaveBeenCalledWith("en-GB");
    expect(currentLocale()).toBe("en-GB"); // the switch happened AFTER the persist resolved
  });

  it("a rejected putLocale leaves the language unchanged (the switch is gated behind the durable write)", async () => {
    // The persist failed, so the UI must NOT switch — setLocale is gated behind the successful write.
    // Moving `setLocale` before/outside the try would wrongly switch on a failed save.
    const putLocale = vi.fn().mockRejectedValue({ code: "locale.unsupported" });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ putLocale }),
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");

    emit(shellChooser(el)!, "locale-selected", { code: "en-GB" });
    await flush(el);
    expect(putLocale).toHaveBeenCalledWith("en-GB");
    expect(currentLocale()).toBe("es-ES"); // unchanged — the failed write never switched the UI
  });

  it("logout replaces a saved preference with the supplied login default", async () => {
    // With no browser match, the server supplies the venue default as loginDefault.
    // Logging out must apply that default instead of retaining the manager's saved English.
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: "en-GB",
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");

    logoutBtn(el)!.click();
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(currentLocale()).toBe("es-ES"); // reverted to the venue default
  });

  // ── Pending responses must not repaint a detached app ──

  it("does not seed the login default if the app disconnects mid-getLocales", async () => {
    // The seed's setLocale(loginDefault) runs AFTER `await getLocales()`. Start with no session so the
    // seed runs; make getLocales pending, detach, then resolve: the seed must be SKIPPED. Deleting the
    // `if (!this.isConnected) return` after getLocales makes the seed fire and this fail.
    let resolveLocales!: (v: LocalesResponse) => void;
    const getLocales = vi.fn(() => new Promise<LocalesResponse>((r) => (resolveLocales = r)));
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      getLocales,
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el); // probe rejected → on login; the seed's getLocales is now pending
    expect(currentLocale()).toBe("es-ES"); // module default, not yet seeded
    host.remove(); // torn down before getLocales resolves
    resolveLocales({
      locales: [],
      venueDefault: "en-GB",
      loginDefault: "en-GB",
      venueName: "Deli Test SL",
    });
    await flush(el);
    expect(getLocales).toHaveBeenCalledOnce();
    expect(currentLocale()).toBe("es-ES"); // the seed to en-GB was skipped on the detached app
  });

  it("does not switch the locale if the app disconnects mid-probe (getMe / #applyMe)", async () => {
    // #applyMe runs post-await (`#applyMe(await getMe())`), so a teardown during the probe must not
    // repaint a live sibling's locale. Make getMe pending, detach, resolve as an en-GB person: the
    // applied setLocale must be SKIPPED. Deleting #applyMe's `if (!this.isConnected) return` fails this.
    let resolveMe!: (v: MeResponse) => void;
    const getMe = vi.fn(() => new Promise<MeResponse>((r) => (resolveMe = r)));
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe }),
    });
    expect(currentLocale()).toBe("es-ES"); // getMe pending → nothing applied or seeded yet
    host.remove(); // torn down before the probe resolves
    resolveMe({
      personId: "p1",
      role: "manager",
      locale: "en-GB",
      venueLocale: "es-ES",
      venueName: "Deli Test SL",
      permissions: [],
      modules: [],
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES"); // #applyMe's setLocale to en-GB was skipped on the detached app
  });

  it("does not switch the locale if the app disconnects mid-putLocale (persist path)", async () => {
    // #onLocaleSelected's setLocale(code) runs AFTER `await putLocale(code)`. The durable write has
    // already landed (the next login re-applies it), so a teardown during the write skips only the
    // now-pointless local repaint. Deleting the new `if (!this.isConnected) return` after putLocale fails.
    let resolvePut!: () => void;
    const putLocale = vi.fn(() => new Promise<void>((r) => (resolvePut = r)));
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ putLocale }),
    });
    await flush(el); // logged in as a manager, es-ES
    expect(currentLocale()).toBe("es-ES");

    emit(shellChooser(el)!, "locale-selected", { code: "en-GB" }); // putLocale now pending
    await el.updateComplete;
    host.remove(); // torn down before putLocale resolves
    resolvePut();
    await flush(el);
    expect(putLocale).toHaveBeenCalledWith("en-GB"); // the durable write still happened
    expect(currentLocale()).toBe("es-ES"); // but the local repaint was skipped on the detached app
  });

  it("does not revert the locale if the app disconnects mid-logout", async () => {
    // Completing logout after teardown must not start a language read or change the shared locale.
    let resolveLogout!: () => void;
    const logout = vi.fn(() => new Promise<void>((r) => (resolveLogout = r)));
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: "en-GB",
        venueLocale: "es-ES",
        permissions: [],
        modules: [],
      }),
      logout,
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");

    logoutBtn(el)!.click(); // logout() now pending
    await el.updateComplete;
    host.remove(); // torn down before logout resolves
    resolveLogout();
    await flush(el);
    expect(currentLocale()).toBe("en-GB"); // the revert to es-ES was skipped on the detached app
    expect(api.getLocales).not.toHaveBeenCalled();
  });
});

describe("dashboard URL navigation", () => {
  it("restores the requested section after a session probe and after refresh", async () => {
    const url = new URL(location.href);
    url.pathname = "/manage/staff";
    url.searchParams.set("dev", "1");
    history.replaceState(null, "", url);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-staff-screen")).not.toBeNull();
    el.remove();
    const { el: refreshed } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(refreshed);
    expect(refreshed.shadowRoot!.querySelector("dashboard-staff-screen")).not.toBeNull();
    expect(new URL(location.href).searchParams.get("dev")).toBe("1");
  });

  it("records navigation once and follows real Back and Forward", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-staff"]')!.click();
    await flush(el);
    expect(location.pathname).toBe("/manage/staff");
    const count = history.length;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-staff"]')!.click();
    await flush(el);
    expect(history.length).toBe(count);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-catalogue"]')!.click();
    await flush(el);
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-staff-screen")).not.toBeNull();
    const forward = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.forward();
    await forward;
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
  });

  it.each([
    ["manager", "missing", "overview"],
    ["supervisor", "diagnostics", "overview"],
    ["staff", "staff", "my-schedule"],
  ])("validates a %s session's requested %s section", async (role, requested, expected) => {
    const url = new URL(location.href);
    url.pathname = `/manage/${requested}`;
    history.replaceState(null, "", url);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role,
          locale: null,
          venueLocale: "es-ES",
          permissions: [],
          modules: [],
        }),
      }),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector(`dashboard-${expected}-screen`)).not.toBeNull();
    expect(location.pathname).toBe(`/manage/${expected}`);
  });

  it("keeps a protected destination behind login and ignores history after logout", async () => {
    const url = new URL(location.href);
    url.pathname = "/manage/staff";
    history.replaceState(null, "", url);
    const getMe = vi.fn().mockRejectedValue({ code: "management_session.required" });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi({ getMe }) });
    await flush(el);
    expect(login(el)).not.toBeNull();
    getMe.mockResolvedValue({
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      permissions: [],
      modules: [],
    });
    login(el)!.dispatchEvent(new CustomEvent("logged-in", { bubbles: true, composed: true }));
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-staff-screen")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="logout"]')!.click();
    await flush(el);
    history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(login(el)).not.toBeNull();
  });
});

it("leaves long dashboard content clear of the bottom-right language chooser on a narrow screen", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(375, 667);
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        listStaff: vi.fn().mockResolvedValue(
          Array.from({ length: 30 }, (_, i) => ({
            ...people[0]!,
            personId: `p${i}`,
            displayName: `Person ${i}`,
          })),
        ),
      }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-staff"]')!.click();
    await flush(el);
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const chooser = el.shadowRoot!.querySelector("dashboard-language-chooser")!;
    const trigger = chooser
      .shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!
      .getBoundingClientRect();
    expect(trigger.right).toBeLessThanOrEqual(window.innerWidth);
    expect(
      el.shadowRoot!.querySelector<HTMLElement>("dashboard-staff-screen")!.getBoundingClientRect()
        .bottom,
    ).toBeLessThanOrEqual(trigger.top);
  } finally {
    await page.viewport(width, height);
    window.scrollTo(0, 0);
  }
});
