import { leaveCoordinatorFor, navigationGuardFor } from "@waitron/ui";
import { commands, page, userEvent } from "vitest/browser";
import { applyTokens, currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { html } from "lit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { ProfileScreen } from "./screens/profile-screen.js";
import { diag } from "./diagnostics.js";
import indexHtml from "../index.html?raw";
import darkLockup from "../../../packages/ui/brand/waitron-lockup-dark.svg?raw";
import lightLockup from "../../../packages/ui/brand/waitron-lockup.svg?raw";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

/**
 * Stubs `window.matchMedia` for the drawer breakpoint only; every other query delegates to the real
 * one. Install it BEFORE mountWidget so the element's connectedCallback reads the stub.
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
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { WtToast } from "@waitron/ui";
import type { AlertsBell } from "./widgets/alerts-bell.js";
import type { AlertView, DashboardApi, PersonSummary } from "./api/client.js";
import type { WtInput } from "@waitron/ui";

const stubRequest: DashboardRequest = async () => [] as never;
const adjustmentsRequest: DashboardRequest = async (path, method, body, options) =>
  path.startsWith("/management-api/adjustments/reasons")
    ? ({ reasons: [] } as never)
    : path === "/management-api/adjustments/settings"
      ? ({ maxBillDiscountBp: null } as never)
      : stubRequest(path, method, body, options);

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

const meResponse = {
  personId: "p1",
  role: "manager",
  email: "manager@example.com",
  locale: null as string | null,
  venueLocale: "es-ES",
  sessionDefault: "es-ES",
  venueName: "Deli Test SL",
  onboardingIntent: "prepare",
  permissions: ["booking.manage"],
  modules: ["bookings"],
};

/** Every read the shell and the screens it mounts make on connect resolves: a stray rejection is a
 * finding. */
function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getMe: vi.fn().mockResolvedValue({ ...meResponse }),
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
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    listCatalogues: vi.fn().mockResolvedValue([]),
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general" }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getReceipt: vi.fn().mockResolvedValue({ receipt: {}, venueAddress: [] }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    listStatuses: vi.fn().mockResolvedValue([]),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
    listCourses: vi.fn().mockResolvedValue([]),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Sala principal", operationDescription: "Venta" }),
    getReceiptLanguage: vi
      .fn()
      .mockResolvedValue({ language: "es-ES", choices: ["es-ES"], fixed: null }),
    previewReceipt: vi.fn(() => new Promise(() => undefined)),
    getLocations: vi.fn().mockResolvedValue([{ id: "loc-1", name: "Main" }]),
    getRoster: vi.fn().mockResolvedValue({ version: null, shifts: [] }),
    listPendingSwaps: vi.fn().mockResolvedValue([]),
    listPendingAbsences: vi.fn().mockResolvedValue([]),
    getPlannedVsActual: vi.fn().mockResolvedValue([]),
    listPurchaseInvoices: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
    listDevices: vi.fn().mockResolvedValue([]),
    listAgents: vi.fn().mockResolvedValue([]),
    listPrinters: vi.fn().mockResolvedValue([]),
    listRecentJobs: vi.fn().mockResolvedValue([]),
    listCanvases: vi.fn().mockResolvedValue([]),
    getRecentLogs: vi.fn().mockResolvedValue({ lines: [] }),
    getVerbosity: vi.fn().mockResolvedValue({ level: "info", revertsAt: null }),
    setVerbosity: vi.fn().mockResolvedValue(undefined),
    getSalesOverview: vi.fn().mockResolvedValue({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getDailyClose: vi.fn().mockResolvedValue({
      businessDay: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      cash: { byOrigin: [], tenderTotal: "0.00", tipTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      topSellers: [],
    }),
    getSalesPeriod: vi.fn().mockResolvedValue({
      from: "2026-08-30",
      to: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      topSellers: [],
    }),
    listOrderPages: vi.fn().mockResolvedValue({ rows: [], next: null, from: null, to: null }),
    listOrderStaff: vi.fn().mockResolvedValue({ staff: [] }),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    markIncidentHandled: vi.fn().mockResolvedValue(undefined),
    passkeySignals: vi.fn().mockResolvedValue({
      rpId: "localhost",
      userId: "cDE",
      credentialIds: [],
      name: "manager@example.com",
      displayName: "Manager",
    }),
    ...overrides,
  } as unknown as DashboardApi;
}

it.each(["staff", "supervisor", "manager", "admin"])(
  "makes Your profile reachable for %s as a modal over their ordinary landing face, by URL",
  async (role) => {
    history.replaceState(null, "", "/manage/profile");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role,
        locale: null,
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
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
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.open).toBe(true);
    expect(el.shadowRoot!.querySelector("dashboard-profile-screen")).not.toBeNull();
    if (role === "staff") expect(el.shadowRoot!.querySelector("nav")).not.toBeNull();
    expect(new URL(location.href).pathname).toBe("/manage/profile");
    expect(
      el.shadowRoot!.querySelector(
        role === "staff" ? "dashboard-my-schedule-screen" : "dashboard-overview-screen",
      ),
    ).not.toBeNull();

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
    await flush(el);
    expect(modal.open).toBe(false);
    await expect.poll(() => el.shadowRoot!.querySelector("dashboard-profile-screen")).toBeNull();
    expect(new URL(location.href).pathname).toBe(
      role === "staff" ? "/manage/my-schedule" : "/manage/overview",
    );
  },
);

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
const units = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-units-screen");
const navUnits = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-units]");
const venueSettings = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-venue-settings-screen");
const roster = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-roster-screen");
const approvals = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-approvals-screen");
const plannedActual = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-planned-actual-screen");
const purchases = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-purchases-screen");
const devices = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-devices-screen");
const screenPrinters = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-printers-screen");
const screenCanvasEditor = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-canvas-editor-screen");
const logoutBtn = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]");
const accountMenuTrigger = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=account-menu]");
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
const navVenueSettings = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-venue-settings]");
const navRoster = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-roster]");
const navApprovals = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-approvals]");
const navPlannedActual = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-planned-actual]");
const navPurchases = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-purchases]");
const navDevices = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-devices]");
const navPrinters = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-printers]");
const navCanvasEditor = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-canvas-editor]");
const sidebarNav = (el: DashboardApp) => el.shadowRoot!.querySelector("nav[aria-label]");
const navItem = (el: DashboardApp, screen: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="nav-${screen}"]`);

const NAV_SCREENS = [
  "overview",
  "sales",
  "catalogue",
  "menus",
  "floor",
  "bookings",
  "staff",
  "roster",
  "approvals",
  "planned-actual",
  "purchases",
  "venue-settings",
  "devices",
  "printers",
  "canvas-editor",
  "diagnostics",
  "backup",
  "cloud",
] as const;

const NAV_GROUP_KEYS = [
  "nav.group.reports",
  "nav.group.service",
  "nav.group.menu",
  "nav.group.operations",
  "nav.group.team",
  "nav.group.purchasing",
  "nav.group.configuration",
] as const;
const shellChooser = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>(".shell [data-test=brand-banner] wt-language-chooser");
const loginChooser = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>(
    ".login-page [data-test=brand-banner] wt-language-chooser",
  );

const SCREEN_TAGS = [
  "dashboard-my-schedule-screen",
  "dashboard-overview-screen",
  "dashboard-sales-screen",
  "dashboard-staff-screen",
  "dashboard-catalogue-screen",
  "dashboard-venue-settings-screen",
  "dashboard-roster-screen",
  "dashboard-approvals-screen",
  "dashboard-planned-actual-screen",
  "dashboard-purchases-screen",
  "dashboard-devices-screen",
  "dashboard-printers-screen",
  "dashboard-canvas-editor-screen",
  "dashboard-diagnostics-screen",
  "dashboard-email-screen",
] as const;

function mountedScreens(el: DashboardApp): string[] {
  return SCREEN_TAGS.filter((tag) => el.shadowRoot!.querySelector(tag));
}

function countH1(el: DashboardApp): number {
  const shellH1 = el.shadowRoot!.querySelectorAll("h1").length;
  const screenH1 = SCREEN_TAGS.reduce((n, tag) => {
    const screen = el.shadowRoot!.querySelector(tag);
    return n + (screen?.shadowRoot?.querySelectorAll("h1").length ?? 0);
  }, 0);
  return shellH1 + screenH1;
}

function allH1(root: ParentNode): Element[] {
  const found: Element[] = [...root.querySelectorAll("h1")];
  for (const child of root.querySelectorAll("*"))
    if (child.shadowRoot) found.push(...allH1(child.shadowRoot));
  return found;
}

function emitLoggedIn(source: Element): void {
  source.dispatchEvent(
    new CustomEvent("logged-in", { detail: { personId: "p1" }, bubbles: true, composed: true }),
  );
}

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
// `setLocale` is module-global state that outlives a test.
beforeEach(() => setLocale("es-ES"));
afterEach(() => setLocale("es-ES"));
let signalAll: MockInstance<typeof PublicKeyCredential.signalAllAcceptedCredentials>;
let signalDetails: MockInstance<typeof PublicKeyCredential.signalCurrentUserDetails>;
beforeEach(() => {
  signalAll = vi
    .spyOn(PublicKeyCredential, "signalAllAcceptedCredentials")
    .mockResolvedValue(undefined);
  signalDetails = vi
    .spyOn(PublicKeyCredential, "signalCurrentUserDetails")
    .mockResolvedValue(undefined);
});
afterEach(() => {
  signalAll.mockRestore();
  signalDetails.mockRestore();
});

describe("dashboard-app", () => {
  it("waits for content languages before mounting an editable screen", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    let finish!: (config: { defaultLanguage: string; languages: string[] }) => void;
    const api = stubApi({
      getContentLanguages: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=content-language-loading]")).not.toBeNull();
    expect(logoutBtn(el)).not.toBeNull();
    expect(currentLocale()).toBe("es-ES");
    finish({ defaultLanguage: "fr", languages: ["fr", "es"] });
    await flush(el);
    expect(currentContentLanguages().defaultLanguage).toBe("fr");
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
    expect(currentLocale()).toBe("es-ES");
  });

  it("offers retry while failed initial content-language loading keeps screens unmounted", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const getContentLanguages = vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue({ defaultLanguage: "fr", languages: ["fr", "es"] });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getContentLanguages }),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=content-language-error]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-content-languages]")!.click();
    await flush(el);
    expect(currentContentLanguages().defaultLanguage).toBe("fr");
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=content-language-error]")).toBeNull();
  });

  it("ignores a language read that finishes after logout", async () => {
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    let finish!: (config: { defaultLanguage: string; languages: string[] }) => void;
    const api = stubApi({
      getContentLanguages: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    logoutBtn(el)!.click();
    await flush(el);
    finish({ defaultLanguage: "fr", languages: ["fr"] });
    await flush(el);
    expect(login(el)).not.toBeNull();
    expect(currentContentLanguages().defaultLanguage).toBe("es");
  });
  it("loads the site's content languages independently of the interface language", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "fr", languages: ["fr", "en"] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    await vi.waitFor(() => expect(currentContentLanguages().defaultLanguage).toBe("fr"));
    expect(currentLocale()).toBe("es-ES");
  });
  // The signed-in twin of the login screen's late-`getLocales` guard: a probe already in flight when
  // someone picks a language answers with the language from before the pick.
  it("keeps a signed-in language pick when a session probe started before it answers late", async () => {
    let resolveLate!: (value: unknown) => void;
    const stale = {
      ...meResponse,
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
    };
    const getMe = vi
      .fn()
      .mockResolvedValueOnce(stale)
      .mockReturnValueOnce(new Promise((resolve) => (resolveLate = resolve)));
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi({ getMe }) });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    // A background probe starts (tab regains focus) and is still in flight...
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    // ...while the person explicitly picks English, which persists and repaints.
    emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
    // The probe now answers with the pre-pick row.
    resolveLate(stale);
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
  });

  // The other ordering, and nothing orders the two replies: the probe STARTS after the pick, so the
  // pick's own bump does not invalidate it, and it ANSWERS after the save has already repainted. The
  // second bump — the one the save lands — is what stops the stale answer winning the last word.
  it("keeps a signed-in language pick when a probe started after it answers after the save", async () => {
    let resolveProbe!: (value: unknown) => void;
    let resolvePut!: () => void;
    const stale = {
      ...meResponse,
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
    };
    const getMe = vi
      .fn()
      .mockResolvedValueOnce(stale)
      .mockReturnValueOnce(new Promise((resolve) => (resolveProbe = resolve)));
    const putLocale = vi.fn(() => new Promise<void>((resolve) => (resolvePut = resolve)));
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe, putLocale }),
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    // The person picks English; the save is still in flight, so nothing has repainted yet.
    emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    // NOW a background probe starts — after the pick, so it captures the already-bumped counter.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    // The save lands and the choice is applied.
    resolvePut();
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
    // The probe answers last, with the row from before the pick. It must not win.
    resolveProbe(stale);
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
  });

  it("opens in the browser's language when the person has never chosen one", async () => {
    // Nobody invited to an existing venue has a stored language, so the browser's preference — which
    // the server has already matched against the languages we ship — is what they should see. The
    // venue default is deliberately the OTHER language, so a shell still reading `venueLocale` fails.
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "en-GB",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("en-GB");
  });

  it("keeps an explicit choice whatever the browser asks for", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        locale: "es-ES",
        venueLocale: "es-ES",
        sessionDefault: "en-GB",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
  });

  it("returns to login when the known session deadline passes without another request", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          sessionDefault: "es-ES",
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
          sessionDefault: "es-ES",
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
        sessionDefault: "es-ES",
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
      sessionDefault: "es-ES",
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
    expect(
      el.shadowRoot!.querySelector("wt-demo-bar")?.shadowRoot!.querySelector("strong")?.textContent,
    ).toBe("Preparación");
    expect(logoutBtn(el)).toBeNull();
  });

  it("shows the dark-theme lockup in the banner while the computer is in dark mode, and the light one otherwise", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    // Vite may inline a small SVG as a data URL, rewriting its quotes and spacing on the way, so
    // the served drawing is compared with the file's once both are parsed.
    const drawing = (svg: string) =>
      new XMLSerializer()
        .serializeToString(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement)
        .replace(/\s+/g, " ");
    const served = async (url: string) => drawing(await (await fetch(url)).text());
    expect(drawing(darkLockup)).not.toBe(drawing(lightLockup));
    const img = brandBanner(el)!.querySelector<HTMLImageElement>('img[alt="Waitron"]')!;
    const shown = async () => (img.currentSrc ? served(img.currentSrc) : "");
    try {
      await commands.emulateColorScheme("dark");
      await expect.poll(shown).toBe(drawing(darkLockup));
      await commands.emulateColorScheme("light");
      await expect.poll(shown).toBe(drawing(lightLockup));
    } finally {
      await commands.emulateColorScheme(null);
    }
  });

  it("starts the banner's logo at the identity row's leading edge, with nothing laid out before it", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);

    const identity = brandBanner(el)!.querySelector<HTMLElement>(".brand-identity")!;
    const logo = identity.querySelector<HTMLImageElement>(".brand-logo")!;
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 800);
      expect(window.innerWidth).toBe(1280);
      expect(identity.querySelector("source")!.getClientRects()).toHaveLength(0);
      expect(logo.getBoundingClientRect().left).toBeCloseTo(
        identity.getBoundingClientRect().left,
        0,
      );
    } finally {
      await page.viewport(width, height);
    }
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
      sessionDefault: "es-ES",
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

  it("puts the account menu on the right side of the authenticated banner", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);

    const banner = brandBanner(el)!;
    const name = venueName(el)!;
    const trigger = accountMenuTrigger(el)!;
    expect(banner).toBeTruthy();
    expect(name.textContent?.trim()).toBe("Deli Test SL");
    expect(trigger).toBeTruthy();
    expect(trigger.getBoundingClientRect().left).toBeGreaterThan(
      name.getBoundingClientRect().right,
    );
    const bannerBox = banner.getBoundingClientRect();
    const trailingPadding = Number.parseFloat(getComputedStyle(banner).paddingRight);
    expect(trigger.getBoundingClientRect().right).toBeCloseTo(bannerBox.right - trailingPadding, 0);
    // Anchored at the trailing edge, it must open inward (right edge under the trigger), not off-screen.
    expect(trigger.getAttribute("align")).toBe("end");
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

    expect(shell.firstElementChild).toBe(el.shadowRoot!.querySelector("wt-demo-bar"));
    expect(shell.querySelector(".banner-row")!.firstElementChild).toBe(banner);
    expect(bannerBox.left).toBeCloseTo(hostBox.left, 0);
    expect(bannerBox.right).toBeCloseTo(hostBox.right, 0);
    expect(sidebar.getBoundingClientRect().top).toBeGreaterThanOrEqual(bannerBox.bottom);
    expect(main.getBoundingClientRect().top).toBeGreaterThanOrEqual(bannerBox.bottom);
  });

  it("shows login when no session, business overview after a manager logs in", async () => {
    // getMe rejects at boot (no session), then resolves as a MANAGER after login.
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          sessionDefault: "es-ES",
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
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(mySchedule(el)).toBeNull();
    expect(login(el)).toBeNull();
  });

  it("a STAFF-role session opens on the self-service my-schedule screen, never the manager staff screen", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: ["sale.take_payment"],
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

  it("a staff session sees Orders and My schedule, without manager pages", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: ["sale.take_payment"],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navStaff(el)).toBeNull();
    expect(navCatalogue(el)).toBeNull();
    expect(navRoster(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=nav-orders]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=nav-my-schedule]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=nav-search]")).toBeNull();
    expect(logoutBtn(el)).toBeTruthy();
  });

  it("threads the logged-in person's id to the my-schedule screen", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: ["sale.take_payment"],
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
          sessionDefault: "es-ES",
          permissions: ["sale.take_payment"],
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
          sessionDefault: "es-ES",
          permissions: ["sale.take_payment"],
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

  it("opens profile from any screen without navigating away, and returns to exactly that screen on close", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    navItem(el, "catalogue")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
    expect(navItem(el, "catalogue")!.getAttribute("aria-current")).toBe("page");

    el.shadowRoot!.querySelector<HTMLElement>('[data-test="profile"]')!.click();
    await flush(el);
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.open).toBe(true);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
    expect(navItem(el, "catalogue")!.getAttribute("aria-current")).toBe("page");
    expect(new URL(location.href).pathname).toBe("/manage/profile");

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
    await flush(el);
    expect(modal.open).toBe(false);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
    await expect.poll(() => new URL(location.href).pathname).toBe("/manage/catalogue");
  });

  it("keeps the underlying screen after saving your profile — a save re-probes the session while the URL still says profile", async () => {
    // A save's profile-updated re-probes the session while the URL still reads "profile"; the
    // screen under the modal must survive that.
    const saveProfile = vi.fn().mockResolvedValue({ emailVerificationSent: false });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        listStaff: vi.fn().mockResolvedValue([]),
        getProfile: vi.fn().mockResolvedValue({
          displayName: "Alex",
          firstNames: "Alex",
          lastNames: "Rivera",
          telephone: null,
          email: "alex@example.com",
          pendingEmail: null,
          locale: "en-GB",
          hasPassword: true,
          hasTotp: false,
          hasGoogle: false,
          passkeys: [],
        }),
        saveProfile,
        getLocales: vi.fn().mockResolvedValue({
          locales: [{ code: "en-GB", label: "English" }],
          venueDefault: "en-GB",
        }),
      }),
    });
    await flush(el);
    navItem(el, "catalogue")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();

    el.shadowRoot!.querySelector<HTMLElement>('[data-test="profile"]')!.click();
    await flush(el);
    const profileScreen = el.shadowRoot!.querySelector("dashboard-profile-screen")!;
    await new Promise((r) => setTimeout(r, 0));
    await profileScreen.updateComplete;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-profile-details"]')!.click();
    await profileScreen.updateComplete;

    profileScreen
      .shadowRoot!.querySelector("wt-input[name=telephone]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "+34 600 000 001" } }));
    await profileScreen.updateComplete;
    profileScreen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    await flush(el); // the save's own profile-updated -> #probeSession() round trip
    expect(saveProfile).toHaveBeenCalledOnce();

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
    await expect.poll(() => new URL(location.href).pathname).toBe("/manage/catalogue");
  });

  it("disables the relocated Edit button until profile data has actually loaded, and never throws if clicked early", async () => {
    // Edit lives in the shell's footer, so it renders before getProfile() resolves, and
    // editDetails() reads the loaded profile.
    let resolveProfile!: (value: unknown) => void;
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        listStaff: vi.fn().mockResolvedValue([]),
        getProfile: vi.fn(() => new Promise((resolve) => (resolveProfile = resolve))),
      }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="profile"]')!.click();
    await flush(el);
    const editButton = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-test="edit-profile-details"]',
    )!;
    expect(editButton.disabled).toBe(true);
    // The public entry point itself is also guarded, independent of the button's disabled state.
    const profileScreen = el.shadowRoot!.querySelector<ProfileScreen>("dashboard-profile-screen")!;
    expect(() => profileScreen.editDetails()).not.toThrow();

    resolveProfile({
      displayName: "Alex",
      firstNames: "Alex",
      lastNames: "Rivera",
      telephone: null,
      email: "alex@example.com",
      pendingEmail: null,
      locale: "en-GB",
      hasPassword: true,
      hasTotp: false,
      hasGoogle: false,
      passkeys: [],
    });
    await flush(el);
    await flush(el);
    expect(editButton.disabled).toBe(false);
  });

  it("resets both the active tab and the Edit button's readiness on a fresh reopen, not stale state from the previous visit", async () => {
    // Only the fresh profile-screen instance announcing itself on connect resets `profileTab` and
    // `profileReady`; nothing in the shell resets them on close.
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        listStaff: vi.fn().mockResolvedValue([]),
        getProfile: vi.fn().mockResolvedValue({
          displayName: "Alex",
          firstNames: "Alex",
          lastNames: "Rivera",
          telephone: null,
          email: "alex@example.com",
          pendingEmail: null,
          locale: "en-GB",
          hasPassword: true,
          hasTotp: false,
          hasGoogle: false,
          passkeys: [],
        }),
      }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="profile"]')!.click();
    await flush(el);
    const editButton = () =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        '[data-test="edit-profile-details"]',
      );
    expect(editButton()!.disabled).toBe(false);

    // Switch to Security — Edit disappears (Security has no equivalent single action) — then close.
    const profileScreen = el.shadowRoot!.querySelector<ProfileScreen>("dashboard-profile-screen")!;
    const wtTabs = profileScreen.shadowRoot!.querySelector("wt-tabs")!;
    wtTabs.dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "security" } }));
    await profileScreen.updateComplete;
    await flush(el);
    expect(editButton()).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
    await flush(el);
    await expect.poll(() => profileScreen.isConnected).toBe(false);

    el.shadowRoot!.querySelector<HTMLElement>('[data-test="profile"]')!.click();
    await flush(el);
    expect(editButton()).not.toBeNull();
    expect(editButton()!.disabled).toBe(false);
  });

  it("closing profile-screen's OWN nested edit modal does not also close the outer profile modal", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        listStaff: vi.fn().mockResolvedValue([]),
        getProfile: vi.fn().mockResolvedValue({
          displayName: "Alex",
          firstNames: "Alex",
          lastNames: "Rivera",
          telephone: null,
          email: "alex@example.com",
          pendingEmail: null,
          locale: "en-GB",
          hasPassword: true,
          hasTotp: false,
          hasGoogle: false,
          passkeys: [],
        }),
      }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="profile"]')!.click();
    await flush(el);
    const outerModal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(outerModal.open).toBe(true);

    const profileScreen = el.shadowRoot!.querySelector("dashboard-profile-screen")!;
    await new Promise((r) => setTimeout(r, 0));
    await profileScreen.updateComplete;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-profile-details"]')!.click();
    await profileScreen.updateComplete;
    const innerModal = profileScreen.shadowRoot!.querySelector("wt-modal")!;
    expect(innerModal.open).toBe(true);

    profileScreen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await profileScreen.updateComplete;
    await flush(el);
    expect(innerModal.open).toBe(false);
    expect(outerModal.open).toBe(true);
    expect(el.shadowRoot!.querySelector("dashboard-profile-screen")).not.toBeNull();
  });

  it("treats ANY probe rejection as not-logged-in, never an unhandled rejection", async () => {
    const api = stubApi({ getMe: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
  });

  it("contains the logged-in event so it does not leak past the shell (stopPropagation)", async () => {
    // `host` is outside the shell's shadow root, so a listener there fires only if propagation escaped.
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: null,
          venueLocale: "es-ES",
          sessionDefault: "es-ES",
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

  it("preserves an existing shortcut when account setup finishes without a Remember choice", async () => {
    const saved = JSON.stringify({ email: "saved@example.test", method: "password" });
    localStorage.setItem("waitron-login-preference", saved);
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({
          personId: "new-person",
          role: "manager",
          email: "new@example.test",
          locale: null,
          venueLocale: "es-ES",
          sessionDefault: "es-ES",
          venueName: "Deli",
          permissions: [],
          modules: [],
        }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    login(el)!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: {
          personId: "new-person",
          accountSetup: true,
          loginMethod: "password",
          rememberEmail: false,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(localStorage.getItem("waitron-login-preference")).toBe(saved);
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
          sessionDefault: "es-ES",
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
          sessionDefault: "es-ES",
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
      sessionDefault: "es-ES",
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

  it.each(["failed", "different-account", "not-callback", "no-intent"])(
    "does not save Google preference for %s",
    async (scenario) => {
      history.replaceState(
        null,
        "",
        scenario === "not-callback" ? "/manage/" : "/manage/?login=google",
      );
      if (scenario !== "no-intent")
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
                sessionDefault: "es-ES",
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

  it("opens a product's editor on the catalogue screen from the units in-use modal", async () => {
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue([]),
      listUnits: vi
        .fn()
        .mockResolvedValue([
          { id: "u1", name: { es: "kg" }, abbreviation: { es: "kg" }, precision: 0 },
        ]),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    navUnits(el)!.click();
    await flush(el);
    expect(units(el)).toBeTruthy();

    units(el)!.dispatchEvent(
      new CustomEvent("wt-edit-product", {
        detail: { productId: "p1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(catalogue(el)).toBeTruthy();
    expect(units(el)).toBeNull();
    expect(location.pathname).toContain("/manage/catalogue/product/p1");
  });

  // The jump is an ordinary screen change, so it clears the previous screen's `view` segment the
  // way every nav click does — otherwise a units URL reached by deep link carries its `view` into
  // the catalogue URL, where it means something else entirely.
  it("clears a stale view segment when opening a product's editor from the units modal", async () => {
    history.replaceState(null, "", "/manage/units/view/detail");
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue([]),
      listUnits: vi
        .fn()
        .mockResolvedValue([
          { id: "u1", name: { es: "kg" }, abbreviation: { es: "kg" }, precision: 0 },
        ]),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(units(el)).toBeTruthy();
    // Without this the test passes even if the units URL never carries a `view` segment at all,
    // which is the very thing the navigation is supposed to clear.
    expect(location.pathname).toBe("/manage/units/view/detail");

    units(el)!.dispatchEvent(
      new CustomEvent("wt-edit-product", {
        detail: { productId: "p1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(location.pathname).toBe("/manage/catalogue/product/p1");
  });

  it("navigates between the staff and catalogue screens", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    expect(overview(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(catalogue(el)).toBeNull();
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();

    navStaff(el)!.click();
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect((staff(el) as unknown as { currentPersonId: string }).currentPersonId).toBe("p1");
    expect(overview(el)).toBeNull();

    navCatalogue(el)!.click();
    await flush(el);
    expect(catalogue(el)).toBeTruthy();
    expect(staff(el)).toBeNull();

    navStaff(el)!.click();
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect(catalogue(el)).toBeNull();
  });

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

  it("opens Venue settings, with Tables and Kitchen among its tabs, under one h1", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    navVenueSettings(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-venue-settings-screen"]);
    const page = venueSettings(el)!;
    const keys = [
      ...page.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
    ].map((tab) => tab.getAttribute("data-key"));
    expect(keys).toEqual(["receipts", "tables", "kitchen"]);
    expect(
      page.shadowRoot!.querySelector('[slot="tables"] dashboard-service-status-screen'),
    ).not.toBeNull();
    expect(page.shadowRoot!.querySelector("dashboard-kitchen-screen")).not.toBeNull();
    expect(allH1(el.shadowRoot!)).toHaveLength(1);
    expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  });

  const panelsOn = (el: DashboardApp, tab: string) =>
    [...venueSettings(el)!.shadowRoot!.querySelector(`[slot="${tab}"]`)!.children].map((child) =>
      child.tagName.toLowerCase(),
    );

  it("puts venue service's Needs clearing switch above statuses on Tables and its kitchen panel after the core one", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/tables");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "venue-service"],
        permissions: ["booking.manage", "venue_service.manage"],
      }),
    });
    const request: DashboardRequest = async (path, method, body, options) =>
      path === "/management-api/venue-service"
        ? ({
            departments: [],
            zones: [],
            hours: [],
            readiness: [],
            settings: { editSentLines: true },
            kitchenTicketGrouping: "combined",
            printHeldWork: false,
            releaseReminderMinutes: 10,
            clearingWorkflow: false,
          } as never)
        : stubRequest(path, method, body, options);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
    await flush(el);
    expect(panelsOn(el, "tables")).toEqual([
      "dashboard-venue-service-settings",
      "dashboard-service-status-screen",
    ]);
    expect(panelsOn(el, "kitchen")).toEqual([
      "dashboard-kitchen-screen",
      "dashboard-venue-service-settings",
    ]);
    expect(location.pathname).toBe("/manage/venue-settings/view/tables");
  });

  it("keeps Tables and Kitchen, each with only its core panel, when venue service is disabled", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/tables");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings"],
        permissions: ["booking.manage", "venue_service.manage"],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(panelsOn(el, "tables")).toEqual(["dashboard-service-status-screen"]);
    expect(panelsOn(el, "kitchen")).toEqual(["dashboard-kitchen-screen"]);
    expect(location.pathname).toBe("/manage/venue-settings/view/tables");
  });

  it("hands each core panel the shell's api", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/kitchen");
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    const page = venueSettings(el)!;
    for (const tag of [
      "dashboard-receipts-screen",
      "dashboard-service-status-screen",
      "dashboard-kitchen-screen",
    ])
      expect(page.shadowRoot!.querySelector<HTMLElement & { api: DashboardApi }>(tag)!.api).toBe(
        api,
      );
    expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
  });

  it.each(["/manage/kitchen", "/manage/statuses", "/manage/receipts"])(
    "treats the retired address %s as an unknown screen",
    async (path) => {
      history.replaceState(null, "", path);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      expect(overview(el)).not.toBeNull();
      expect(location.pathname).toBe("/manage/overview");
    },
  );

  it("treats the retired address /manage/adjustment-reasons as an unknown screen", async () => {
    history.replaceState(null, "", "/manage/adjustment-reasons");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "adjustments"],
        permissions: ["booking.manage", "adjustment.manage", "report.view"],
      }),
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: adjustmentsRequest,
    });
    await flush(el);
    expect(overview(el)).not.toBeNull();
    expect(location.pathname).toBe("/manage/overview");
  });

  it("shows Adjustment reasons as a Venue settings tab to a manager of adjustments, and not in the nav", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/adjustment-reasons");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "adjustments"],
        permissions: ["booking.manage", "adjustment.manage", "report.view"],
      }),
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: adjustmentsRequest,
    });
    await flush(el);
    expect(navItem(el, "adjustment-reasons")).toBeNull();
    expect(navItem(el, "adjustment-report")).not.toBeNull();
    expect(
      venueSettings(el)!.shadowRoot!.querySelector(
        '[slot="adjustment-reasons"] dashboard-adjustment-reasons-screen',
      ),
    ).not.toBeNull();
    expect(location.pathname).toBe("/manage/venue-settings/view/adjustment-reasons");
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

  it.each([
    { permissions: ["booking.manage"], canManageReaders: false },
    { permissions: ["booking.manage", "payments.manage"], canManageReaders: true },
  ])(
    "tells the devices screen whether the session may manage card readers ($permissions)",
    async ({ permissions, canManageReaders }) => {
      const api = stubApi({
        listStaff: vi.fn().mockResolvedValue([]),
        getMe: vi.fn().mockResolvedValue({ ...meResponse, permissions }),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await flush(el);
      navDevices(el)!.click();
      await flush(el);
      expect((devices(el) as HTMLElement & { canManageReaders: boolean }).canManageReaders).toBe(
        canManageReaders,
      );
    },
  );

  it("tells the open devices screen when a session re-read finds payments.manage gone", async () => {
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ ...meResponse, permissions: ["booking.manage", "payments.manage"] })
      .mockResolvedValue({ ...meResponse, permissions: ["booking.manage"] });
    // After the re-read the alert and content-language reads stay unanswered, so neither redraws the
    // shell; `setLocale` in `#applyMe` still does, so this case passes without `#applyMe`'s own redraw.
    let reread = false;
    const answer = <T>(value: T) =>
      reread ? new Promise<T>(() => undefined) : Promise.resolve(value);
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue([]),
      getMe,
      listAlerts: vi.fn(() => answer({ visible: false, alerts: [] })),
      getContentLanguages: vi.fn(() => answer({ defaultLanguage: "es", languages: ["es"] })),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    navDevices(el)!.click();
    await flush(el);
    const screen = devices(el) as HTMLElement & { canManageReaders: boolean };
    expect(screen.canManageReaders).toBe(true);

    reread = true;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush(el);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(devices(el)).toBe(screen);
    expect(screen.canManageReaders).toBe(false);
  });

  it("retires printing rules from the sidebar and mounted screens", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    expect(navItem(el, "printing-rules")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-printing-rules-screen")).toBeNull();
    expect(navItem(el, "printers")).not.toBeNull();
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

  it("navigates the three non-roster logged-in screens, one screen and one h1 at a time", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    expect(mountedScreens(el)).toEqual(["dashboard-overview-screen"]);
    expect(countH1(el)).toBe(1);
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();
    expect(navVenueSettings(el)).toBeTruthy();

    navStaff(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-staff-screen"]);
    expect(staff(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);

    navVenueSettings(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-venue-settings-screen"]);
    expect(venueSettings(el)).toBeTruthy();
    expect(allH1(el.shadowRoot!)).toHaveLength(1);

    navCatalogue(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-catalogue-screen"]);
    expect(catalogue(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);

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

  it("renders each nav group header and all nav items", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const headers = [...el.shadowRoot!.querySelectorAll("button.nav-group")].map((h) =>
      h.textContent?.trim(),
    );
    for (const key of NAV_GROUP_KEYS) expect(headers).toContain(t(key));
    for (const s of NAV_SCREENS) expect(navItem(el, s)).toBeTruthy();
    expect(navItem(el, "email"), "the banner's inbox link is the way to the inbox").toBeNull();
    expect(navItem(el, "sections")).toBeNull();
    expect(navItem(el, "recipe")).toBeNull();
    expect(navItem(el, "location-menus")).toBeNull();
    expect(navItem(el, "catalogue")!.textContent).toContain(t("nav.catalogue"));
  });

  it("draws text on the page itself, outside the app, at the 14px body size", () => {
    // In the app, tokens sit on <html> and index.html styles <body>; anything rendered straight into
    // the page rather than inside the app's own element inherits the body's size.
    const style = document.createElement("style");
    style.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
    document.head.append(style);
    applyTokens(document.documentElement);
    try {
      expect(getComputedStyle(document.body).fontSize).toBe("14px");
    } finally {
      style.remove();
      document.documentElement.removeAttribute("data-wt-theme-root");
    }
  });

  it("draws a nav item at the 14px body size and a group header at the 12px small size", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    expect(getComputedStyle(navItem(el, "catalogue")!).fontSize).toBe("14px");
    expect(getComputedStyle(el.shadowRoot!.querySelector("button.nav-group")!).fontSize).toBe(
      "12px",
    );
  });

  it("draws a group chevron between its old 14px and larger 18px sizes", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const chevron = el.shadowRoot!.querySelector<HTMLElement>("button.nav-group .chevron")!;
    expect(chevron.getBoundingClientRect().width).toBe(16);
  });

  it("expands and collapses a nav group's items from its header toggle", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-team"]')!;
    const panel = el.shadowRoot!.querySelector<HTMLElement>("#nav-group-panel-team")!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);

    header.click();
    await flush(el);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(navItem(el, "staff")).toBeTruthy();

    header.click();
    await flush(el);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });

  it("keeps only the last opened nav group expanded", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!;
    const team = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-team]")!;
    menu.click();
    await flush(el);
    team.click();
    await flush(el);
    expect(team.getAttribute("aria-expanded")).toBe("true");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(navItem(el, "catalogue")!.checkVisibility()).toBe(false);

    navItem(el, "catalogue")!.click();
    await flush(el);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(team.getAttribute("aria-expanded")).toBe("false");
    expect([
      ...el.shadowRoot!.querySelectorAll('button.nav-group[aria-expanded="true"]'),
    ]).toHaveLength(1);
  });

  it("preserves a lower header's position when opening it closes the group above", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 300);
      const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
      host.style.height = "300px";
      await flush(el);
      const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!;
      const team = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-team]")!;
      const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
      // Browser scroll anchoring can mask a missing application correction.
      sidebar.style.overflowAnchor = "none";
      menu.click();
      await flush(el);
      sidebar.scrollTop =
        team.getBoundingClientRect().top - sidebar.getBoundingClientRect().top - 48;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const before = team.getBoundingClientRect().top;
      expect(before).toBeGreaterThan(sidebar.getBoundingClientRect().top);
      expect(before).toBeLessThan(sidebar.getBoundingClientRect().bottom);
      team.click();
      await flush(el);
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(team.getAttribute("aria-expanded")).toBe("true");
      expect(team.getBoundingClientRect().top).toBeCloseTo(before, 0);
    } finally {
      await page.viewport(width, height);
    }
  });

  it("aligns nav header text with its pages and reserves a trailing first-line chevron", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 800);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
      await flush(el);
      const header = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!;
      header.click();
      await flush(el);
      const textRect = (node: HTMLElement) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          if (!text.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          return range.getClientRects()[0]!;
        }
        throw new Error("Missing navigation text");
      };
      const text = textRect(header);
      const item = textRect(navItem(el, "catalogue")!);
      const chevron = header.querySelector<HTMLElement>(".chevron")!;
      const arrow = chevron.getBoundingClientRect();
      expect(text.left).toBeCloseTo(item.left, 0);
      expect(arrow.left).toBeGreaterThan(text.right);
      expect(arrow.right).toBeCloseTo(header.getBoundingClientRect().right - 12, 0);
      expect(
        Math.abs(arrow.top + arrow.height / 2 - (text.top + text.height / 2)),
      ).toBeLessThanOrEqual(1);
      expect(getComputedStyle(chevron).opacity).toBe("0");
      await userEvent.hover(header);
      expect(getComputedStyle(chevron).opacity).toBe("1");
      expect(textRect(header).left).toBe(text.left);
      await commands.parkPointer();
      header.blur();
      await userEvent.keyboard("{Tab}");
      header.focus();
      expect(header.matches(":focus-visible")).toBe(true);
      expect(getComputedStyle(chevron).opacity).toBe("1");
      el.style.setProperty("--dashboard-sidebar-width", "18ch");
      await el.updateComplete;
      const wrappedText = textRect(header);
      const wrappedArrow = chevron.getBoundingClientRect();
      expect(
        Math.abs(
          wrappedArrow.top + wrappedArrow.height / 2 - (wrappedText.top + wrappedText.height / 2),
        ),
      ).toBeLessThanOrEqual(1);
    } finally {
      await page.viewport(width, height);
    }
  });

  it.each(["en-GB", "es-ES"])(
    "fits nav group labels on one line and paints the sidebar edge (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      try {
        await page.viewport(1280, 800);
        const { el } = await mountWidget<DashboardApp>("dashboard-app", {
          api: stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, locale }) }),
        });
        await flush(el);
        const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
        const probe = document.createElement("div");
        probe.style.boxShadow = "var(--wt-shadow-1)";
        sidebar.append(probe);
        expect(getComputedStyle(sidebar).boxShadow).toBe(getComputedStyle(probe).boxShadow);
        probe.remove();
        expect(sidebar.getBoundingClientRect().width).toBeGreaterThan(200);
        expect(matchMedia("(pointer: fine)").matches).toBe(true);
        for (const header of el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")) {
          expect(header.getBoundingClientRect().height).toBe(32);
          const label = header.querySelector<HTMLElement>(".nav-group-label")!;
          expect(label.getBoundingClientRect().height).toBe(18);
          const icon = header.querySelector<HTMLElement>(".group-icon");
          if (icon)
            expect(icon.getBoundingClientRect().right).toBeLessThan(
              label.getBoundingClientRect().left,
            );
          const panel = el.shadowRoot!.getElementById(header.getAttribute("aria-controls")!)!;
          const item = panel.querySelector<HTMLElement>(".nav-item")!;
          header.click();
          await flush(el);
          expect(label.getBoundingClientRect().left).toBeCloseTo(
            item.getBoundingClientRect().left + 15,
            0,
          );
        }
        expect(navItem(el, "overview")!.getBoundingClientRect().height).toBe(32);
        await page.viewport(390, 844);
        await vi.waitFor(() => expect(sidebar.hasAttribute("inert")).toBe(true));
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
        await flush(el);
        expect(sidebar.getBoundingClientRect().width).toBeLessThan(390 * 0.85 + 1);
        el.style.setProperty("--dashboard-sidebar-width", "100vw");
        await page.viewport(320, 844);
        expect(window.innerWidth).toBe(320);
        expect(sidebar.getBoundingClientRect().width).toBeCloseTo(320 * 0.85, 0);
      } finally {
        await page.viewport(width, height);
      }
    },
  );

  it("starts with every headed nav group collapsed", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const headers = [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")];
    expect(headers.length).toBe(NAV_GROUP_KEYS.length);
    for (const header of headers) {
      expect(header.getAttribute("aria-expanded")).toBe("false");
      const panel = el.shadowRoot!.getElementById(header.getAttribute("aria-controls")!)!;
      expect(panel.hidden).toBe(true);
    }
    expect(navItem(el, "overview")!.checkVisibility()).toBe(true);
  });

  it("starts with only the group holding the opened page expanded", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const expanded = [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")]
      .filter((h) => h.getAttribute("aria-expanded") === "true")
      .map((h) => h.dataset.test);
    expect(expanded).toEqual(["nav-group-menu"]);
    expect(navItem(el, "catalogue")!.checkVisibility()).toBe(true);
  });

  it.each([
    ["es-ES", "Productos y cartas"],
    ["en-GB", "Products and menus"],
  ])("names the products group for menus as well as products (%s)", async (locale, heading) => {
    const me = { ...meResponse, venueLocale: locale, sessionDefault: locale };
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe: vi.fn().mockResolvedValue(me) }),
    });
    await flush(el);
    expect(currentLocale()).toBe(locale);
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-menu"]')!;
    expect(header.textContent!.replace(/\s+/g, " ").trim()).toBe(heading);
  });

  it.each([
    ["es-ES", "Informes"],
    ["en-GB", "Reporting"],
  ])("puts the report screens under a Reporting section (%s)", async (locale, heading) => {
    const me = {
      ...meResponse,
      venueLocale: locale,
      sessionDefault: locale,
      permissions: ["report.export", "report.view"],
      modules: ["adjustments"],
    };
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe: vi.fn().mockResolvedValue(me) }),
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-reports"]')!;
    expect(header.textContent!.replace(/\s+/g, " ").trim()).toBe(heading);
    const panel = el.shadowRoot!.querySelector("#nav-group-panel-reports")!;
    expect(
      [...panel.querySelectorAll<HTMLElement>(".nav-item")].map((b) => b.dataset.test),
    ).toEqual(["nav-sales", "nav-vat-return", "nav-adjustment-report", "nav-orders"]);
  });

  it("opens Orders from its URL inside an expanded Reporting section", async () => {
    history.replaceState(null, "", "/manage/orders");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-orders-screen")).not.toBeNull();
    expect(location.pathname).toBe("/manage/orders");
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-reports"]')!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(navItem(el, "orders")!.getAttribute("aria-current")).toBe("page");
    expect(navItem(el, "orders")!.checkVisibility()).toBe(true);
  });

  it("keeps Overview above the Reporting section, under no heading", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const overview = navItem(el, "overview")!;
    const reporting = el.shadowRoot!.querySelector('[data-test="nav-group-reports"]')!;
    expect(overview.closest("#nav-group-panel-reports")).toBeNull();
    expect(
      overview.compareDocumentPosition(reporting) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const headers = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-group")];
    expect(
      headers.filter((h) => h.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toEqual([]);
  });

  it("collapses the current page's group when its header is clicked, and opens it on a second click", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-menu"]')!;
    const panel = el.shadowRoot!.querySelector<HTMLElement>("#nav-group-panel-menu")!;
    expect(header.getAttribute("aria-expanded")).toBe("true");

    header.click();
    await flush(el);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(navItem(el, "catalogue")!.checkVisibility()).toBe(false);
    expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();

    header.click();
    await flush(el);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(navItem(el, "catalogue")!.checkVisibility()).toBe(true);
  });

  it.each(["Back", "query write"])(
    "keeps a manually opened nav group on a same-page %s",
    async (operation) => {
      history.replaceState(null, "", "/manage/catalogue");
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
      await flush(el);
      if (operation === "Back") history.pushState(null, "", "/manage/catalogue?review=1");
      const team = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-team]")!;
      team.click();
      await flush(el);
      expect(team.getAttribute("aria-expanded")).toBe("true");
      if (operation === "Back") {
        const back = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        history.back();
        await back;
      } else {
        await navigationGuardFor(window)!.write("/manage/catalogue?review=2");
      }
      await flush(el);
      expect(location.pathname).toBe("/manage/catalogue");
      expect(el.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
      expect(team.getAttribute("aria-expanded")).toBe("true");
      expect(
        el.shadowRoot!.querySelector("[data-test=nav-group-menu]")!.getAttribute("aria-expanded"),
      ).toBe("false");
    },
  );

  it("opens a collapsed group when the Back button arrives at a page in it", async () => {
    history.replaceState(null, "", "/manage/staff");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-team"]')!;
    const panel = el.shadowRoot!.querySelector<HTMLElement>("#nav-group-panel-team")!;
    expect(header.getAttribute("aria-expanded")).toBe("true");

    navItem(el, "catalogue")!.click();
    await flush(el);
    expect(location.pathname).toBe("/manage/catalogue");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);

    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await flush(el);

    expect(location.pathname).toBe("/manage/staff");
    expect(el.shadowRoot!.querySelector("dashboard-staff-screen")).not.toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(navItem(el, "staff")!.checkVisibility()).toBe(true);
    expect(
      el.shadowRoot!.querySelector('[data-test="nav-group-menu"]')!.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("starts with a module page's group expanded when that page is opened", async () => {
    history.replaceState(null, "", "/manage/bookings");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      request: stubRequest,
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-service"]')!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(navItem(el, "bookings")!.checkVisibility()).toBe(true);
  });

  it("keeps the clicked group header at the same on-screen position when collapsing shrinks the list above the fold", async () => {
    // Scrolled partway, not to an edge, where exact preservation can be impossible; a MIDDLE group
    // leaves content above and below to absorb the shrink.
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1200, 300);
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-team"]')!.click();
      await flush(el);
      const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
      const header = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-team"]')!;
      expect(header.getAttribute("aria-expanded")).toBe("true");
      sidebar.scrollTop = 100;
      expect(sidebar.scrollTop).toBe(100);
      await new Promise((r) => requestAnimationFrame(r));
      const before = header.getBoundingClientRect().top;

      header.click();
      await flush(el);
      await new Promise((r) => requestAnimationFrame(r));

      expect(header.getBoundingClientRect().top).toBeCloseTo(before, 0);
    } finally {
      await page.viewport(width, height);
    }
  });

  it("renders a bundled module's screen and nav via the generic path", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      request: stubRequest,
    });
    await flush(el);
    expect(navItem(el, "bookings")).toBeTruthy();
    navItem(el, "bookings")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).not.toBeNull();
  });

  it("hides a module's nav AND denies its screen when the permission is absent (enabled but not permitted)", async () => {
    // Drive the URL restore path, so `#permittedScreen` is tested and not just the nav filter.
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
          sessionDefault: "es-ES",
          permissions: [],
          modules: ["bookings"],
        }),
      }),
      request: stubRequest,
    });
    await flush(el);
    expect(navItem(el, "bookings")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).toBeNull();
    expect(overview(el)).toBeTruthy();
  });

  it("hides a module entirely when it is not in the enabled set (permitted but not enabled)", async () => {
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
          sessionDefault: "es-ES",
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
          sessionDefault: "es-ES",
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

  it("reconciles the active module set on a re-login — a now-disabled module stops showing", async () => {
    const session1 = {
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      permissions: ["booking.manage"],
      modules: ["bookings"],
    };
    const session2 = { ...session1, modules: [] as string[] };
    const getMe = vi.fn().mockResolvedValueOnce(session1).mockResolvedValue(session2);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe }),
      request: stubRequest,
    });
    await flush(el);
    expect(navItem(el, "bookings")).not.toBeNull();
    navItem(el, "bookings")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).not.toBeNull();

    logoutBtn(el)!.click();
    await flush(el);
    emitLoggedIn(login(el)!);
    await flush(el);

    expect(navItem(el, "bookings")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-bookings-screen")).toBeNull();
    expect(overview(el)).toBeTruthy();
  });

  // The throw lands in #probeSession's total catch, so it shows as a manager session dropping to
  // login; a silent skip would have reached overview. The shared registry array is patched for this
  // one mount and restored in a finally.
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

  it("offers a manager Venue settings in Venue operations, opening on its Receipts tab", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navItem(el, "receipts")).toBeNull();
    const item = navVenueSettings(el)!;
    expect(item.textContent!.trim()).toBe(t("nav.venue_settings"));
    const panel = el.shadowRoot!.querySelector("#nav-group-panel-operations")!;
    expect(panel.contains(item)).toBe(true);
    item.click();
    await flush(el);
    const receipts = venueSettings(el)!.shadowRoot!.querySelector<
      HTMLElement & { api?: DashboardApi }
    >("dashboard-receipts-screen");
    expect(receipts!.api).toBe(api);
    expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  });

  it("shows a supervisor Venue settings without its Receipts tab", async () => {
    const supervisor = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p3",
        role: "supervisor",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: [],
        modules: [],
      }),
      listStaff: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: supervisor });
    await flush(el);
    expect(navItem(el, "devices")).toBeTruthy();
    navVenueSettings(el)!.click();
    await flush(el);
    const page = venueSettings(el)!;
    expect(page.shadowRoot!.querySelector("dashboard-receipts-screen")).toBeNull();
    expect(location.pathname).toBe("/manage/venue-settings/view/tables");
  });

  it("shows a supervisor Tables and Kitchen settings without edit controls", async () => {
    const supervisor = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        role: "supervisor",
        permissions: ["venue.view"],
        modules: [],
      }),
      listStatuses: vi.fn().mockResolvedValue([
        {
          id: "s1",
          label: "Ready",
          color: "#abc",
          displayOrder: 0,
          active: true,
          createdAt: "2026-10-01T00:00:00Z",
        },
      ]),
      listCourses: vi
        .fn()
        .mockResolvedValue([{ id: "c1", name: "Starters", displayOrder: 0, active: true }]),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: supervisor });
    await flush(el);
    navVenueSettings(el)!.click();
    await flush(el);
    const settings = venueSettings(el)!;
    const statuses = settings.shadowRoot!.querySelector<HTMLElement>(
      "dashboard-service-status-screen",
    )!;
    await vi.waitFor(() =>
      expect(statuses.shadowRoot!.querySelector("[data-test=row-s1]")).not.toBeNull(),
    );
    expect(statuses.shadowRoot!.querySelector("[data-test=row-s1]")!.textContent).toContain(
      "Ready",
    );
    expect(statuses.shadowRoot!.querySelector("[data-test=row-s1]")!.textContent).toContain("#abc");
    expect(statuses.shadowRoot!.querySelector("[data-test=row-s1]")!.textContent).toContain("0");
    expect(statuses.shadowRoot!.querySelector("[data-test=new-label]")).toBeNull();
    expect(statuses.shadowRoot!.querySelector("[data-test=save-s1]")).toBeNull();
    const tabs = settings.shadowRoot!.querySelector<HTMLElement>("wt-tabs")!;
    tabs.dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "kitchen" } }));
    await flush(el);
    const kitchen = settings.shadowRoot!.querySelector<HTMLElement>("dashboard-kitchen-screen")!;
    await vi.waitFor(() =>
      expect(kitchen.shadowRoot!.querySelector("dashboard-course-list")).not.toBeNull(),
    );
    expect(kitchen.shadowRoot!.querySelector("[data-test=bump-line]")).toBeNull();
    expect(kitchen.shadowRoot!.querySelector("[data-test=fire-waiter]")).toBeNull();
    const courses = kitchen.shadowRoot!.querySelector<HTMLElement>("dashboard-course-list")!;
    await vi.waitFor(() => expect(courses.shadowRoot!.textContent).toContain("Starters"));
    expect(courses.shadowRoot!.querySelector("[data-test=add-course]")).toBeNull();
    expect(courses.shadowRoot!.querySelector("[data-test=name-c1]")).toBeNull();
  });

  it("includes venue-service settings panels for a supervisor as read-only", async () => {
    const supervisor = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        role: "supervisor",
        permissions: ["venue.view"],
        modules: ["venue-service"],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: supervisor });
    await flush(el);
    navVenueSettings(el)!.click();
    await flush(el);
    const settings = venueSettings(el)!;
    const panels = settings.shadowRoot!.querySelectorAll<HTMLElement & { readOnly: boolean }>(
      "dashboard-venue-service-settings",
    );
    expect(panels).toHaveLength(2);
    expect([...panels].map((panel) => [panel.getAttribute("subject"), panel.readOnly])).toEqual([
      ["tables", true],
      ["kitchen", true],
    ]);
  });

  it("hides the diagnostics nav from a supervisor and shows it to a manager", async () => {
    const supervisor = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p3",
        role: "supervisor",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: [],
        modules: [],
      }),
      listStaff: vi.fn().mockResolvedValue([]),
    });
    const { el: sup } = await mountWidget<DashboardApp>("dashboard-app", { api: supervisor });
    await flush(sup);
    expect(navItem(sup, "devices")).toBeTruthy();
    expect(navItem(sup, "diagnostics")).toBeNull();
    sup.remove();

    const { el: mgr } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(mgr);
    expect(navItem(mgr, "diagnostics")).toBeTruthy();
  });

  it("shows the Servers nav, after Backups, only to a session holding the permission it needs", async () => {
    const admin = stubApi({
      getMe: vi
        .fn()
        .mockResolvedValue({ ...meResponse, role: "admin", permissions: ["mirror.create"] }),
      listStaff: vi.fn().mockResolvedValue([]),
    });
    const { el: adm } = await mountWidget<DashboardApp>("dashboard-app", { api: admin });
    await flush(adm);
    const item = navItem(adm, "servers");
    expect(item!.textContent!.trim()).toBe(t("nav.servers"));
    const panel = adm.shadowRoot!.querySelector("#nav-group-panel-configuration")!;
    const order = [...panel.querySelectorAll<HTMLElement>(".nav-item")].map((b) => b.dataset.test);
    expect(order.indexOf("nav-servers")).toBe(order.indexOf("nav-backup") + 1);
    adm.remove();

    // A manager holds no `mirror.create`, so the item that would only answer "not permitted" is not
    // offered; an admin whose permissions somehow lack it is not offered it either.
    const { el: mgr } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(mgr);
    expect(navItem(mgr, "backup")).toBeTruthy();
    expect(navItem(mgr, "servers")).toBeNull();
    mgr.remove();
    const { el: bare } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({ ...meResponse, role: "admin", permissions: [] }),
        listStaff: vi.fn().mockResolvedValue([]),
      }),
    });
    await flush(bare);
    expect(navItem(bare, "servers")).toBeNull();
  });

  it.each([
    ["admin", ["mirror.create"], "dashboard-servers-screen", "/manage/servers"],
    ["manager", ["booking.manage"], "dashboard-overview-screen", "/manage/overview"],
  ])(
    "opens /manage/servers for the %s role only when the session holds the permission",
    async (role, permissions, tag, path) => {
      history.replaceState(null, "", "/manage/servers");
      const api = stubApi({
        getMe: vi.fn().mockResolvedValue({ ...meResponse, role, permissions }),
        listServers: vi.fn().mockResolvedValue({ term: 0, nodes: [] }),
        liveData: new LiveData(),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await flush(el);
      const face = el.shadowRoot!.querySelector<HTMLElement & { api?: DashboardApi }>(tag);
      expect(face).not.toBeNull();
      if (tag === "dashboard-servers-screen") expect(face!.api).toBe(api);
      expect(location.pathname).toBe(path);
    },
  );

  it("offers Content languages first in Settings, to a session holding person.manage, and opens its page", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({ ...meResponse, permissions: ["person.manage"] }),
      listStaff: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    const item = navItem(el, "content-languages");
    expect(item!.textContent!.trim()).toBe(t("nav.content_languages"));
    const panel = el.shadowRoot!.querySelector("#nav-group-panel-configuration")!;
    const order = [...panel.querySelectorAll<HTMLElement>(".nav-item")].map((b) => b.dataset.test);
    expect(order[0]).toBe("nav-content-languages");

    item!.click();
    await flush(el);
    const face = el.shadowRoot!.querySelector<HTMLElement & { api?: DashboardApi }>(
      "dashboard-content-languages-screen",
    );
    expect(face!.api).toBe(api);
    expect(location.pathname).toBe("/manage/content-languages");
  });

  it.each([
    ["supervisor", []],
    ["manager", ["booking.manage"]],
  ])(
    "does not offer Content languages to a %s session without person.manage",
    async (role, permissions) => {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({
          getMe: vi.fn().mockResolvedValue({ ...meResponse, role, permissions }),
          listStaff: vi.fn().mockResolvedValue([]),
        }),
      });
      await flush(el);
      expect(navItem(el, "overview")).toBeTruthy();
      expect(navItem(el, "content-languages")).toBeNull();
    },
  );

  it.each([
    [
      "manager",
      ["person.manage"],
      "dashboard-content-languages-screen",
      "/manage/content-languages",
    ],
    ["supervisor", [], "dashboard-overview-screen", "/manage/overview"],
  ])(
    "opens /manage/content-languages for a %s session only when it holds person.manage",
    async (role, permissions, tag, path) => {
      history.replaceState(null, "", "/manage/content-languages");
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({
          getMe: vi.fn().mockResolvedValue({ ...meResponse, role, permissions }),
          listStaff: vi.fn().mockResolvedValue([]),
        }),
      });
      await flush(el);
      expect(el.shadowRoot!.querySelector(tag)).not.toBeNull();
      expect(location.pathname).toBe(path);
    },
  );

  it("opens the Devices page from the approval link's URL for a manager", async () => {
    history.replaceState(null, "", "/manage/devices");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe: vi.fn().mockResolvedValue(meResponse) }),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-devices-screen")).not.toBeNull();
    expect(location.pathname).toBe("/manage/devices");
  });

  it("offers the VAT return under Sales to a session holding report.export, and opens its page", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({ ...meResponse, permissions: ["report.export"] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    const item = navItem(el, "vat-return");
    expect(item!.textContent!.trim()).toBe(t("nav.vat_return"));
    const panel = el.shadowRoot!.querySelector("#nav-group-panel-reports")!;
    const order = [...panel.querySelectorAll<HTMLElement>(".nav-item")].map((b) => b.dataset.test);
    expect(order.indexOf("nav-vat-return")).toBe(order.indexOf("nav-sales") + 1);

    item!.click();
    await flush(el);
    const face = el.shadowRoot!.querySelector<HTMLElement & { api?: DashboardApi }>(
      "dashboard-vat-return-screen",
    );
    expect(face!.api).toBe(api);
    expect(location.pathname).toBe("/manage/vat-return");
  });

  it.each([
    ["supervisor", ["report.view"]],
    ["manager", ["booking.manage"]],
  ])(
    "does not offer the VAT return to a %s session without report.export",
    async (role, permissions) => {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, role, permissions }) }),
      });
      await flush(el);
      expect(navItem(el, "sales")).toBeTruthy();
      expect(navItem(el, "vat-return")).toBeNull();
    },
  );

  it.each([
    ["manager", ["report.export"], "dashboard-vat-return-screen", "/manage/vat-return"],
    ["supervisor", ["report.view"], "dashboard-overview-screen", "/manage/overview"],
  ])(
    "opens /manage/vat-return for a %s session only when it holds report.export",
    async (role, permissions, tag, path) => {
      history.replaceState(null, "", "/manage/vat-return");
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, role, permissions }) }),
      });
      await flush(el);
      expect(el.shadowRoot!.querySelector(tag)).not.toBeNull();
      expect(location.pathname).toBe(path);
    },
  );

  it.each([
    ["manager", "dashboard-email-screen", "/manage/email"],
    ["admin", "dashboard-email-screen", "/manage/email"],
    ["supervisor", "dashboard-overview-screen", "/manage/overview"],
  ])(
    "opens /manage/email, which has no sidebar entry, signed in as %s, only for a manager or an admin",
    async (role, tag, path) => {
      history.replaceState(null, "", "/manage/email");
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({
          getMe: vi.fn().mockResolvedValue({ ...meResponse, role }),
          listStaff: vi.fn().mockResolvedValue([]),
          getEmailInbox: vi.fn(() => new Promise(() => undefined)),
        }),
      });
      await flush(el);
      expect(navItem(el, "email")).toBeNull();
      expect(el.shadowRoot!.querySelector(tag)).not.toBeNull();
      expect(location.pathname).toBe(path);
    },
  );

  it("clicking a nav item switches the screen and marks it aria-current=page", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    expect(navItem(el, "overview")!.getAttribute("aria-current")).toBe("page");

    navItem(el, "catalogue")!.click();
    await flush(el);
    expect(catalogue(el)).toBeTruthy();
    expect(navItem(el, "catalogue")!.getAttribute("aria-current")).toBe("page");
    expect(navItem(el, "overview")!.getAttribute("aria-current")).toBeNull();
  });

  it("mutes a resting nav item and paints only the current one from the primary-text token", async () => {
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-primary-text", "rgb(4, 5, 6)");
    expect(getComputedStyle(navItem(el, "overview")!).color).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(navItem(el, "catalogue")!).color).toBe("rgb(1, 2, 3)");
  });

  it("shows the gear icon on the Settings group header, and no other group header", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const settingsHeader = el.shadowRoot!.querySelector('[data-test="nav-group-configuration"]')!;
    expect(settingsHeader.textContent).toContain(t("nav.group.configuration"));
    expect(settingsHeader.querySelector('wt-icon[name="gear"]')).not.toBeNull();
    const teamHeader = el.shadowRoot!.querySelector('[data-test="nav-group-team"]')!;
    expect(teamHeader.querySelectorAll("wt-icon")).toHaveLength(1); // only the chevron, no gear
  });
  it("shows the hamburger icon on the drawer toggle, not the kebab", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const icon = el.shadowRoot!.querySelector('[data-test="nav-toggle"] wt-icon')!;
    expect(icon.getAttribute("name")).toBe("hamburger");
  });
  it("hamburger toggles the drawer open, a nav click closes it", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const layout = () => el.shadowRoot!.querySelector(".layout")!;
    expect(layout().classList.contains("drawer-open")).toBe(false);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeNull();

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await el.updateComplete;
    expect(layout().classList.contains("drawer-open")).toBe(true);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeTruthy();

    navCatalogue(el)!.click();
    await flush(el);
    expect(layout().classList.contains("drawer-open")).toBe(false);
    expect(el.shadowRoot!.querySelector(".scrim")).toBeNull();
    expect(catalogue(el)).toBeTruthy();
  });

  it("keeps the off-canvas drawer a fixed width, unaffected by which nav groups are expanded", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 800);
      expect(window.innerWidth).toBe(1280);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      const sidebar = () => el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
      const desktopWidth = sidebar().getBoundingClientRect().width;
      await page.viewport(400, 800);
      expect(window.innerWidth).toBe(400);
      for (let i = 0; i < 100 && !sidebar().hasAttribute("inert"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const widthBeforeToggle = sidebar().getBoundingClientRect().width;
      expect(widthBeforeToggle).toBeCloseTo(desktopWidth, 0);
      // Fully off-screen when closed, not a hairline sliver left visible.
      await vi.waitFor(() =>
        expect(sidebar().getBoundingClientRect().right).toBeLessThanOrEqual(0),
      );

      el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-group-team"]')!.click();
      await el.updateComplete;
      expect(sidebar().getBoundingClientRect().width).toBeCloseTo(widthBeforeToggle, 0);
    } finally {
      await page.viewport(width, height);
    }
  });

  it("keeps the venue name on a legible line width at narrow viewport, never squeezed into one letter per line", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const venueName = () => el.shadowRoot!.querySelector<HTMLElement>('[data-test="venue-name"]')!;
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
      for (let i = 0; i < 100 && !sidebar.hasAttribute("inert"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const rect = venueName().getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(20);
      expect(rect.height).toBeLessThan(100);
    } finally {
      await page.viewport(width, height);
    }
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

  it("makes the off-canvas sidebar inert only when narrow and closed", async () => {
    const mq = stubDrawerMatchMedia();
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      const sidebar = () => el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;

      expect(sidebar().hasAttribute("inert")).toBe(false);

      mq.set(true);
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(true);

      const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!;
      toggle.click();
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(false);
      toggle.click();
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(true);

      mq.set(false);
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(false);
    } finally {
      mq.restore();
    }
  });

  it("force-closes the drawer (and drops the scrim) when widened from narrow to desktop", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      const layout = () => el.shadowRoot!.querySelector<HTMLElement>(".layout")!;
      const scrim = () => el.shadowRoot!.querySelector<HTMLElement>(".scrim");

      el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
      await el.updateComplete;
      expect(layout().classList.contains("drawer-open")).toBe(true);
      expect(scrim()).not.toBeNull();

      await page.viewport(1280, 800);
      expect(window.innerWidth).toBe(1280);
      await el.updateComplete;
      expect(layout().classList.contains("drawer-open")).toBe(false);
      expect(scrim()).toBeNull();
    } finally {
      await page.viewport(width, height);
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

    layout().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(layout().classList.contains("drawer-open")).toBe(false);
  });

  it("keeps the shell within one screen height so the sidebar and content scroll independently, not the page", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1000, 600);
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
      const shell = el.shadowRoot!.querySelector(".shell")!;
      expect(shell.getBoundingClientRect().height).toBeLessThanOrEqual(600);
      const sidebar = el.shadowRoot!.querySelector(".sidebar")!;
      const main = el.shadowRoot!.querySelector(".main")!;
      expect(
        Math.abs(sidebar.getBoundingClientRect().bottom - main.getBoundingClientRect().bottom),
      ).toBeLessThan(2);
    } finally {
      await page.viewport(width, height);
    }
  });

  it("a staff session can open its two-page drawer", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: ["sale.take_payment"],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=nav-toggle]")).not.toBeNull();
  });

  it("a staff session's navigation landmark holds only My schedule and Orders", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: ["sale.take_payment"],
        modules: [],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(sidebarNav(el)).not.toBeNull();
    expect(
      [...sidebarNav(el)!.querySelectorAll("[data-test^=nav-]")].map((item) =>
        item.getAttribute("data-test"),
      ),
    ).toEqual(["nav-my-schedule", "nav-orders"]);
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
    expect(navVenueSettings(el)).toBeNull();
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
    // A rejected `logout()` must not be an unhandled rejection, and must not strand the operator.
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

type LocalesResponse = {
  locales: { code: string; label: string }[];
  venueDefault: string;
  loginDefault: string;
  venueName: string;
};
type MeResponse = {
  personId: string;
  role: string;
  locale: string | null;
  venueLocale: string;
  sessionDefault: string;
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
          sessionDefault: "en-GB",
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
        sessionDefault: "es-ES",
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
    emit(login(el)!, "wt-locale-selected", { code: "es-ES" });
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
          sessionDefault: "es-ES",
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
    // No session, so the boot seed applies getLocales' loginDefault (en-GB, which differs from the
    // es-ES module default so the switch is observable).
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
    // A session is found, so the login-language seed is skipped and getLocales is never called: the UI
    // ends on the person's en-GB, never the venue default.
    const getLocales = vi
      .fn()
      .mockResolvedValue({ locales: [], venueDefault: "es-ES", loginDefault: "es-ES" });
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: "en-GB",
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        permissions: ["sale.take_payment"],
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
    // A person with no preference gets the venue UI, because the server's browser match already
    // floored itself at the venue default for a browser asking for a language we do not ship.
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
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
          sessionDefault: "es-ES",
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
    // A pre-login pick is transient: switch the UI but write nothing.
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(loginChooser(el)).toBeTruthy(); // the signed-out banner renders the chooser

    emit(loginChooser(el)!, "wt-locale-selected", { code: "en-GB" });
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
      emit(loginChooser(el)!, "wt-locale-selected", { code: "en-GB" });
      await flush(el);
      expect(login(el)).toBe(screen);
      expect(screen.shadowRoot!.querySelector("h1")!.textContent).toBe(
        t(step === "password" ? "login.password_heading" : "account.offer_passkey", "en-GB"),
      );
      expect(screen.shadowRoot!.querySelector<WtInput>("[data-test=login-context]")!.value).toBe(
        "typed@example.com",
      );
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

    emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
    await flush(el);
    expect(putLocale).toHaveBeenCalledWith("en-GB");
    expect(currentLocale()).toBe("en-GB"); // the switch happened AFTER the persist resolved
  });

  it("names the shell's language on the chooser, and the new one once a pick is saved", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    const trigger = () =>
      shellChooser(el)!
        .shadowRoot!.querySelector("[data-test=lang-trigger] [part=name]")!
        .textContent!.trim();
    expect(trigger()).toBe("Español");

    emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
    await flush(el);
    expect(trigger()).toBe("English");
  });

  it("a rejected putLocale leaves the language unchanged (the switch is gated behind the durable write)", async () => {
    const putLocale = vi.fn().mockRejectedValue({ code: "locale.unsupported" });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ putLocale }),
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");

    emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
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
        sessionDefault: "es-ES",
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
    // Detached while the seed's getLocales is pending: the seed must be skipped.
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
    // Detached while the probe is pending: #applyMe's setLocale must be skipped.
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
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions: [],
      modules: [],
    });
    await flush(el);
    expect(currentLocale()).toBe("es-ES"); // #applyMe's setLocale to en-GB was skipped on the detached app
  });

  it("does not switch the locale if the app disconnects mid-putLocale (persist path)", async () => {
    // The durable write has landed, so a teardown during it skips only the local repaint.
    let resolvePut!: () => void;
    const putLocale = vi.fn(() => new Promise<void>((r) => (resolvePut = r)));
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ putLocale }),
    });
    await flush(el); // logged in as a manager, es-ES
    expect(currentLocale()).toBe("es-ES");

    emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" }); // putLocale now pending
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
        sessionDefault: "es-ES",
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
  it.each([
    ["manager", ["venue_service.manage"], ["venue-service"], "/manage/prep-stations/view/tickets"],
    ["supervisor", ["venue.view"], ["venue-service"], "/manage/prep-stations/view/stations"],
    ["manager", [], [], "/manage/overview"],
  ] as const)(
    "replaces a retired printing bookmark with a permitted destination (%s, %s)",
    async (role, permissions, modules, destination) => {
      history.replaceState(null, "", "/manage/staff");
      history.pushState(null, "", "/manage/printing-rules");
      const length = history.length;
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({
          getMe: vi.fn().mockResolvedValue({ ...meResponse, role, permissions, modules }),
        }),
        request: async (path) => {
          if (
            path === "/management-api/venue-service/routing" ||
            path === "/management-api/venue-service/stations/overview"
          )
            return {
              stations: [],
              defaultStationId: null,
              stationTimes: [],
              todayEnds: { timeOfDay: "06:00", tomorrow: true },
              clockReadable: true,
              zones: [],
              categories: [],
              products: [],
              cells: [],
              canMakeDefault: false,
            } as never;
          if (path === "/management-api/stations/health")
            return {
              capturedAt: "2026-10-06T10:00:00Z",
              stations: [],
              outputsDown: { printersDown: [], screensDark: [] },
            } as never;
          if (path === "/management-api/stations/outputs-down")
            return { printersDown: [], screensDark: [] } as never;
          return [] as never;
        },
      });
      await flush(el);
      await expect.poll(() => location.pathname).toBe(destination);
      expect(history.length).toBe(length);
      expect(navItem(el, "printing-rules")).toBeNull();
      expect(el.shadowRoot!.querySelector("dashboard-printing-rules-screen")).toBeNull();
      const back = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await back;
      await flush(el);
      expect(location.pathname).toBe("/manage/staff");
      const forward = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.forward();
      await forward;
      await flush(el);
      await expect.poll(() => location.pathname).toBe(destination);
    },
  );

  it("opens the live Prep overview for venue viewers through a saved configuration-tab link", async () => {
    history.replaceState(null, "", "/manage/prep-stations/view/settings");
    const reads: string[] = [];
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "supervisor",
          locale: "en-GB",
          venueLocale: "en-GB",
          sessionDefault: "en-GB",
          permissions: ["venue.view"],
          modules: ["venue-service"],
          venueName: "Venue",
        }),
      }),
      request: async (path) => {
        reads.push(path);
        if (path === "/management-api/venue-service/stations/overview")
          return {
            stations: [],
            defaultStationId: null,
            stationTimes: [],
            todayEnds: { timeOfDay: "06:00", tomorrow: true },
            clockReadable: true,
          } as never;
        if (path === "/management-api/stations?includeDisabled=true") return [] as never;
        if (path === "/management-api/stations/health")
          return {
            capturedAt: "2026-10-05T12:00:00Z",
            stations: [],
            outputsDown: { printersDown: [], screensDark: [] },
          } as never;
        if (path === "/management-api/stations/outputs-down")
          return { printersDown: [], screensDark: [] } as never;
        return [] as never;
      },
    });
    await flush(el);
    expect(navItem(el, "prep-stations")).not.toBeNull();
    const screen = el.shadowRoot!.querySelector("dashboard-prep-stations-screen")!;
    expect(screen).not.toBeNull();
    await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-tabs")).not.toBeNull());
    expect(screen.shadowRoot!.querySelector('[data-test="new-station"]')).toBeNull();
    expect(location.pathname).toBe("/manage/prep-stations/view/stations");
    expect(reads).toContain("/management-api/venue-service/stations/overview");
    for (const path of [
      "/management-api/venue-service/routing",
      "/management-api/printers",
      "/management-api/devices",
      "/management-api/watchers",
      "/management-api/products",
    ])
      expect(reads).not.toContain(path);
  });

  it("preserves a prep station tester product when the dashboard restores the screen", async () => {
    history.replaceState(null, "", "/manage/prep-stations/test/lager");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          locale: "en-GB",
          venueLocale: "en-GB",
          sessionDefault: "en-GB",
          permissions: ["venue_service.manage"],
          modules: ["venue-service"],
          venueName: "Venue",
        }),
      }),
      request: async (path, method, body, options) =>
        path === "/management-api/venue-service/routing"
          ? ({
              stationTimes: [],
              todayEnds: null,
              clockReadable: true,
              zones: [],
              categories: [],
              products: [],
              cells: [],
              defaultStationId: null,
              stations: [],
              canMakeDefault: false,
            } as never)
          : path === "/management-api/stations/health"
            ? ({
                capturedAt: "2026-10-05T12:00:00Z",
                stations: [],
                outputsDown: { printersDown: [], screensDark: [] },
              } as never)
            : path.startsWith("/management-api/venue-service/routing/explain?")
              ? ({ route: null, decidedBy: null, fallbacks: [], clockReadable: true } as never)
              : stubRequest(path, method, body, options),
    });
    await flush(el);
    expect(location.pathname).toBe("/manage/prep-stations/view/routing/test/lager");
  });
  it.each([
    { modules: ["venue-service"], permissions: [] },
    { modules: [], permissions: ["venue_service.manage"] },
  ])(
    "denies a saved venue tab unless both module and permission are present: %j",
    async ({ modules, permissions }) => {
      const url = new URL(location.href);
      url.pathname = "/manage/venue-operations/view/zones";
      history.replaceState(null, "", url);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({
          getMe: vi.fn().mockResolvedValue({
            personId: "p1",
            role: "manager",
            locale: "en",
            venueLocale: "en",
            sessionDefault: "en",
            modules,
            permissions,
          }),
        }),
        request: stubRequest,
      });
      await flush(el);
      expect(navItem(el, "venue-operations")).toBeNull();
      expect(el.shadowRoot!.querySelector("dashboard-venue-operations-screen")).toBeNull();
      expect(overview(el)).toBeTruthy();
      expect(location.pathname).toBe("/manage/overview");
    },
  );

  it("restores a saved venue link through refresh and Back from another section", async () => {
    const url = new URL(location.href);
    url.pathname = "/manage/venue-operations/view/zones";
    url.searchParams.set("dev", "1");
    history.replaceState(null, "", url);
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        permissions: ["venue_service.manage"],
        modules: ["venue-service"],
        venueName: "Venue",
      }),
    });
    const request: DashboardRequest = async (path) =>
      (path === "/management-api/venue-service"
        ? {
            departments: [],
            zones: [],
            routes: [],
            hours: [],
            readiness: [],
            settings: { editSentLines: true },
          }
        : []) as never;
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
    await flush(el);
    expect(location.pathname).toBe("/manage/venue-operations");
    await expect
      .poll(() =>
        Boolean(
          el
            .shadowRoot!.querySelector("dashboard-venue-operations-screen")
            ?.shadowRoot?.querySelector('[data-test="policy-tree"]'),
        ),
      )
      .toBe(true);
    expect(location.pathname).toBe("/manage/venue-operations");
    el.remove();
    const { el: refreshed } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
    await flush(refreshed);
    await expect
      .poll(() =>
        Boolean(
          refreshed
            .shadowRoot!.querySelector("dashboard-venue-operations-screen")
            ?.shadowRoot?.querySelector('[data-test="policy-tree"]'),
        ),
      )
      .toBe(true);
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(location.search).toBe(url.search);
    navItem(refreshed, "staff")!.click();
    await flush(refreshed);
    expect(location.pathname).toBe("/manage/staff");
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await flush(refreshed);
    await expect
      .poll(() =>
        Boolean(
          refreshed
            .shadowRoot!.querySelector("dashboard-venue-operations-screen")
            ?.shadowRoot?.querySelector('[data-test="policy-tree"]'),
        ),
      )
      .toBe(true);
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(location.search).toBe(url.search);
  });

  it("opens a saved venue link after signing in to a protected destination", async () => {
    const url = new URL(location.href);
    url.pathname = "/manage/venue-operations/view/zones";
    url.searchParams.set("dev", "1");
    history.replaceState(null, "", url);
    const getMe = vi.fn().mockRejectedValue({ code: "management_session.required" });
    const request: DashboardRequest = async (path) =>
      (path === "/management-api/venue-service"
        ? {
            departments: [],
            zones: [],
            routes: [],
            hours: [],
            readiness: [],
            settings: { editSentLines: true },
          }
        : []) as never;
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe }),
      request,
    });
    await flush(el);
    expect(login(el)).not.toBeNull();
    expect(location.pathname).toBe("/manage/venue-operations/view/zones");
    getMe.mockResolvedValue({
      personId: "p1",
      role: "manager",
      locale: "en-GB",
      venueLocale: "en-GB",
      sessionDefault: "en-GB",
      permissions: ["venue_service.manage"],
      modules: ["venue-service"],
      venueName: "Venue",
    });
    emitLoggedIn(login(el)!);
    await flush(el);
    expect(location.pathname).toBe("/manage/venue-operations");
    await expect
      .poll(() =>
        Boolean(
          el
            .shadowRoot!.querySelector("dashboard-venue-operations-screen")
            ?.shadowRoot?.querySelector('[data-test="policy-tree"]'),
        ),
      )
      .toBe(true);
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(location.search).toBe(url.search);
  });

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
          sessionDefault: "es-ES",
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
      sessionDefault: "es-ES",
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

/**
 * Mounts the app the way the real page does: inside `#app`, under `index.html`'s own page style, so a
 * layout test sees the body padding and sizing the browser applies.
 */
async function mountInRealPage(
  api: DashboardApi,
  width: number,
  height: number,
): Promise<{ el: DashboardApp; unmount: () => Promise<void> }> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  const style = document.createElement("style");
  style.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
  document.head.append(style);
  const app = document.createElement("div");
  app.id = "app";
  applyTokens(app);
  document.body.append(app);
  await page.viewport(width, height);
  const el = document.createElement("dashboard-app") as DashboardApp;
  el.api = api;
  app.append(el);
  await flush(el);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return {
    el,
    unmount: async () => {
      app.remove();
      style.remove();
      document.scrollingElement!.scrollTop = 0;
      await page.viewport(before.width, before.height);
    },
  };
}

const bannerTrigger = (host: Element) =>
  host
    .shadowRoot!.querySelector("[data-test=brand-banner] wt-language-chooser")!
    .shadowRoot!.querySelector("[data-test=lang-trigger]")!
    .getBoundingClientRect();

it.each([
  [1280, 844],
  [390, 844],
])(
  "fits the signed-in page in a %ix%i window, language chooser and all, and scrolls long content inside the column",
  async (width, height) => {
    const { el, unmount } = await mountInRealPage(
      stubApi({
        listStaff: vi.fn().mockResolvedValue(
          Array.from({ length: 30 }, (_, i) => ({
            ...people[0]!,
            personId: `p${i}`,
            displayName: `Person ${i}`,
          })),
        ),
      }),
      width,
      height,
    );
    try {
      if (width < 768) {
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
        await flush(el);
      }
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-staff"]')!.click();
      await flush(el);
      const main = el.shadowRoot!.querySelector<HTMLElement>(".main")!;
      main.scrollTo(0, main.scrollHeight);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(bannerTrigger(el).bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
      expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
    } finally {
      await unmount();
    }
  },
);

it("keeps the phone drawer within the window inside the real page", async () => {
  const { el, unmount } = await mountInRealPage(stubApi(), 390, 844);
  try {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await flush(el);
    const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect();
    expect(sidebar.top).toBeGreaterThanOrEqual(
      el.shadowRoot!.querySelector("[data-test=brand-banner]")!.getBoundingClientRect().bottom - 1,
    );
    expect(sidebar.bottom).toBeLessThanOrEqual(window.innerHeight);
  } finally {
    await unmount();
  }
});

/** Presses Tab `presses` times from the top of the page and reports whether focus ever landed in the sidebar. */
async function tabReachesSidebar(el: DashboardApp, presses: number): Promise<boolean> {
  const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
  (document.activeElement as HTMLElement | null)?.blur();
  for (let i = 0; i < presses; i++) {
    await userEvent.tab();
    let focused: Element | null = document.activeElement;
    while (focused?.shadowRoot?.activeElement) {
      if (sidebar.contains(focused)) return true;
      focused = focused.shadowRoot.activeElement;
    }
    if (focused && sidebar.contains(focused)) return true;
  }
  return false;
}

/**
 * The part of the sidebar the window shows, as the browser's own intersection observer reports it:
 * that clips by every scrolling or clipping ancestor, where the sidebar's own box does not, and an
 * inert sidebar is still observed, where hit-testing skips it.
 */
async function sidebarInWindow(el: DashboardApp): Promise<DOMRectReadOnly> {
  const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
  return new Promise((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      observer.disconnect();
      resolve(entries.at(-1)!.intersectionRect);
    });
    observer.observe(sidebar);
  });
}

it("shows no part of the closed phone drawer inside the real page, and all of the open one", async () => {
  const { el, unmount } = await mountInRealPage(stubApi(), 390, 844);
  try {
    const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect((await sidebarInWindow(el)).width).toBeLessThan(1);
    expect(await tabReachesSidebar(el, 30)).toBe(false);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await flush(el);
    await vi.waitFor(async () => {
      const box = sidebar.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      expect((await sidebarInWindow(el)).width).toBeCloseTo(box.width, 0);
    });
    expect(await tabReachesSidebar(el, 30)).toBe(true);

    el.shadowRoot!.querySelector<HTMLElement>(".scrim")!.click();
    await flush(el);
    await vi.waitFor(async () => expect((await sidebarInWindow(el)).width).toBeLessThan(1));
  } finally {
    await unmount();
  }
});

it("keeps the desktop sidebar in the page beside the content", async () => {
  const { el, unmount } = await mountInRealPage(stubApi(), 1280, 844);
  try {
    const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
    const box = sidebar.getBoundingClientRect();
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(box.left).toBe(el.shadowRoot!.querySelector(".layout")!.getBoundingClientRect().left);
    expect(box.right).toBeLessThanOrEqual(
      el.shadowRoot!.querySelector(".main")!.getBoundingClientRect().left,
    );
    expect((await sidebarInWindow(el)).width).toBeCloseTo(box.width, 0);
  } finally {
    await unmount();
  }
});

const signedOut = () =>
  stubApi({ getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }) });

it.each([
  ["the sign-in form", "/manage/"],
  ["an emailed account link", "/manage/account?token=t1&purpose=invitation"],
])(
  "puts the language chooser at the trailing edge of the signed-out banner on %s, and none in the login screen",
  async (_where, url) => {
    const before = location.pathname + location.search;
    history.replaceState(null, "", url);
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: signedOut() });
      await flush(el);
      const screen = login(el)!;
      await (screen as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      expect(screen.shadowRoot!.querySelector("wt-language-chooser")).toBeNull();
      const banner = brandBanner(el)!;
      const bannerBox = banner.getBoundingClientRect();
      const trailingPadding = Number.parseFloat(getComputedStyle(banner).paddingRight);
      expect(bannerTrigger(el).right).toBeCloseTo(bannerBox.right - trailingPadding, 0);
      expect(bannerTrigger(el).left).toBeGreaterThan(venueName(el)!.getBoundingClientRect().right);
    } finally {
      history.replaceState(null, "", before);
    }
  },
);

it("names the page's language on the signed-out banner's chooser, and follows a pick there", async () => {
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: signedOut() });
  await flush(el);
  const name = () =>
    loginChooser(el)!
      .shadowRoot!.querySelector("[data-test=lang-trigger] [part=name]")!
      .textContent!.trim();
  expect(name()).toBe("Español");
  loginChooser(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=lang-trigger]")!.click();
  await vi.waitFor(() =>
    expect(loginChooser(el)!.shadowRoot!.querySelector("[data-test=lang-en-GB]")).not.toBeNull(),
  );
  loginChooser(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=lang-en-GB]")!.click();
  await flush(el);
  expect(currentLocale()).toBe("en-GB");
  expect(name()).toBe("English");
});

it("offers the server's languages on the signed-out banner's chooser", async () => {
  const getLocales = vi.fn().mockResolvedValue({
    locales: [{ code: "en-GB", label: "English (server)" }],
    venueDefault: "es-ES",
    loginDefault: "es-ES",
    venueName: "Deli Test SL",
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      getLocales,
    }),
  });
  await flush(el);
  const calls = getLocales.mock.calls.length;
  const chooser = loginChooser(el)!;
  chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
  await vi.waitFor(() =>
    expect(chooser.shadowRoot!.querySelector('[data-test="lang-en-GB"]')?.textContent?.trim()).toBe(
      "English (server)",
    ),
  );
  expect(getLocales).toHaveBeenCalledTimes(calls + 1);
});

describe.each([
  ["signed in", stubApi],
  ["signed out", signedOut],
] as const)("the banner's language chooser, %s", (_state, api) => {
  it.each([
    [1280, "Español", "name"],
    [390, "ES", "code"],
  ] as const)(
    "at %ipx shows %s, names its trigger in full for a screen reader, and fits the window",
    async (width, shown, part) => {
      const { el, unmount } = await mountInRealPage(api(), width, 844);
      try {
        const chooser = el.shadowRoot!.querySelector(
          "[data-test=brand-banner] wt-language-chooser",
        )!;
        const trigger = chooser.shadowRoot!.querySelector<HTMLElement>("[data-test=lang-trigger]")!;
        const name = trigger.querySelector<HTMLElement>("[part=name]")!;
        const code = trigger.querySelector<HTMLElement>("[part=code]")!;
        const [visible, hidden] = part === "name" ? [name, code] : [code, name];
        expect(getComputedStyle(visible).display).not.toBe("none");
        expect(getComputedStyle(hidden).display).toBe("none");
        expect(visible.textContent!.trim()).toBe(shown);
        expect(trigger.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(
          "Español",
        );
        const banner = brandBanner(el)!;
        expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
        expect(trigger.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      } finally {
        await unmount();
      }
    },
  );
});

describe("the banner's email inbox link", () => {
  it("shows Demo navigation above the public login page", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
        getLocales: vi.fn().mockResolvedValue({
          locales: [{ code: "es-ES", label: "Español" }],
          venueDefault: "es-ES",
          loginDefault: "es-ES",
          venueName: "Deli Test SL",
          onboardingIntent: "demo",
        }),
      }),
    });
    await flush(el);
    const bar = el.shadowRoot!.querySelector("wt-demo-bar");
    expect(bar).not.toBeNull();
    expect(brandBanner(el)!.querySelector("[data-test=mode-indicator]")).toBeNull();
    expect(brandBanner(el)!.querySelector("[data-test=email-inbox-link]")).toBeNull();
    expect(bar!.shadowRoot!.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      "Panel",
    );
    expect(bar!.shadowRoot!.querySelector('a[href="/"]')).not.toBeNull();
  });

  it("keeps the Live label in the banner without a Demo bar", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: withIntent(false, "live"),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-demo-bar")).toBeNull();
    expect(modeIndicator(el)?.textContent?.trim()).toBe("En vivo");
  });

  const inboxLink = (el: DashboardApp) =>
    el
      .shadowRoot!.querySelector("wt-demo-bar")
      ?.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="/manage/email"]') ?? null;
  const withIntent = (signedIn: boolean, intent: string | undefined) =>
    signedIn
      ? stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, onboardingIntent: intent }) })
      : stubApi({
          getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
          getLocales: vi.fn().mockResolvedValue({
            locales: [{ code: "es-ES", label: "Español" }],
            venueDefault: "es-ES",
            loginDefault: "es-ES",
            venueName: "Deli Test SL",
            onboardingIntent: intent,
          }),
        });

  it.each([
    ["signed in", "demo", true],
    ["signed out", "demo", false],
    ["signed in", "prepare", true],
    ["signed out", "prepare", false],
  ] as const)(
    "%s, when the intent is %s, links to the inbox from the shared bar",
    async (_state, intent, signedIn) => {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: withIntent(signedIn, intent),
      });
      await flush(el);
      expect(login(el) === null).toBe(signedIn);
      const link = inboxLink(el)!;
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe("/manage/email");
      expect(link.textContent!.trim()).toBe("Bandeja de correo");
    },
  );

  it("links to the pretend printer beside the inbox only in Demo or Preparation", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: withIntent(true, "demo"),
    });
    await flush(el);
    const bar = el.shadowRoot!.querySelector("wt-demo-bar")!;
    const links = [...bar.shadowRoot!.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(links.indexOf("/manage/demo-printer")).toBe(links.indexOf("/manage/email") + 1);
  });

  it("links to the pretend card reader in the Demo bar", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: withIntent(true, "demo"),
    });
    await flush(el);
    const bar = el.shadowRoot!.querySelector("wt-demo-bar")!;
    const links = [...bar.shadowRoot!.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );

    expect(links.indexOf("/manage/demo-reader")).toBe(links.indexOf("/manage/demo-printer") + 1);
  });

  it("opens the pretend reader page for a manager in Demo", async () => {
    history.replaceState(null, "", "/manage/demo-reader");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi
          .fn()
          .mockResolvedValue({ ...meResponse, role: "manager", onboardingIntent: "demo" }),
        listDemoReaderPayments: vi.fn().mockResolvedValue({ payments: [] }),
      }),
    });
    await flush(el);

    expect(el.shadowRoot!.querySelector("dashboard-demo-reader-screen")).not.toBeNull();
    expect(location.pathname).toBe("/manage/demo-reader");
  });

  it("shows the pending card amount and lets the manager approve it", async () => {
    history.replaceState(null, "", "/manage/demo-reader");
    const decideDemoReaderPayment = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi
          .fn()
          .mockResolvedValue({ ...meResponse, role: "manager", onboardingIntent: "demo" }),
        listDemoReaderPayments: vi.fn().mockResolvedValue({
          payments: [{ id: "payment-1", amount: "12.34" }],
        }),
        decideDemoReaderPayment,
      }),
    });
    await flush(el);
    const reader = el.shadowRoot!.querySelector("dashboard-demo-reader-screen")!;
    await vi.waitFor(() =>
      expect(
        reader.shadowRoot!.querySelector("[data-test=demo-reader-amount]")?.textContent,
      ).toContain("12"),
    );

    reader.shadowRoot!.querySelector<HTMLElement>("[data-test=demo-reader-approve]")!.click();
    await vi.waitFor(() =>
      expect(decideDemoReaderPayment).toHaveBeenCalledWith("payment-1", "captured"),
    );
  });

  it("refuses the pretend reader page in Live", async () => {
    history.replaceState(null, "", "/manage/demo-reader");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi
          .fn()
          .mockResolvedValue({ ...meResponse, role: "manager", onboardingIntent: "live" }),
      }),
    });
    await flush(el);

    expect(el.shadowRoot!.querySelector("dashboard-demo-reader-screen")).toBeNull();
    expect(location.pathname).toBe("/manage/overview");
  });

  it("opens the pretend printer page for a manager", async () => {
    history.replaceState(null, "", "/manage/demo-printer");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi
          .fn()
          .mockResolvedValue({ ...meResponse, role: "manager", onboardingIntent: "demo" }),
        listDemoPrinterJobs: vi.fn(() => new Promise(() => undefined)),
      }),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-demo-printer-screen")).not.toBeNull();
    expect(location.pathname).toBe("/manage/demo-printer");
  });

  it.each([
    ["supervisor", "demo"],
    ["manager", "live"],
  ] as const)("refuses the pretend printer page for %s in %s", async (role, intent) => {
    history.replaceState(null, "", "/manage/demo-printer");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({
        getMe: vi.fn().mockResolvedValue({ ...meResponse, role, onboardingIntent: intent }),
      }),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-demo-printer-screen")).toBeNull();
    expect(location.pathname).toBe("/manage/overview");
  });

  it.each([
    ["signed in", "live", true],
    ["signed in", undefined, true],
    ["signed out", "live", false],
    ["signed out", undefined, false],
  ] as const)("shows no inbox link %s when the intent is %s", async (_state, intent, signedIn) => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: withIntent(signedIn, intent),
    });
    await flush(el);
    expect(login(el) === null).toBe(signedIn);
    expect(el.shadowRoot!.querySelector("[data-test=language-chooser]")).not.toBeNull();
    expect(inboxLink(el)).toBeNull();
  });

  it.each([
    ["demo", "staff", false],
    ["demo", "supervisor", false],
    ["demo", "manager", true],
    ["demo", "admin", true],
    ["prepare", "staff", false],
    ["prepare", "supervisor", false],
    ["prepare", "manager", true],
    ["prepare", "admin", true],
  ] as const)(
    "when the intent is %s, signed in as %s, shows the inbox link only to a session that may open the inbox",
    async (intent, role, shown) => {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({
          getMe: vi.fn().mockResolvedValue({ ...meResponse, role, onboardingIntent: intent }),
          listStaff: vi.fn().mockResolvedValue([]),
        }),
      });
      await flush(el);
      expect(login(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("wt-demo-bar")).not.toBeNull();
      expect(inboxLink(el) !== null).toBe(shown);
    },
  );
});

it("starts live updates after authentication and stops them on logout and disconnect", async () => {
  const liveUpdates = { start: vi.fn(), stop: vi.fn() };
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi(), liveUpdates });
  await flush(el);
  expect(liveUpdates.start).toHaveBeenCalledOnce();
  logoutBtn(el)!.click();
  await flush(el);
  expect(liveUpdates.stop).toHaveBeenCalledOnce();
  el.remove();
  expect(liveUpdates.stop).toHaveBeenCalledTimes(2);
});
it("opens the reusable modifiers library from its own management destination", async () => {
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi({
      listExtraLists: vi.fn().mockResolvedValue([]),
      listOptionLists: vi.fn().mockResolvedValue([]),
    }),
  });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-modifiers"]')!.click();
  await flush(el);
  // The bare destination normalises to the default tab, which is what every other tabbed screen
  // does: alerts-screen.test.ts:60 opens `/manage/alerts` and :75 expects `/manage/alerts/view/open`.
  expect(location.pathname).toBe("/manage/modifiers/view/extras");
  expect(el.shadowRoot!.querySelector("dashboard-modifiers-screen")).not.toBeNull();
});

describe("alerts in the shell", () => {
  const alert = (id: string, severity: AlertView["severity"] = "warning"): AlertView => ({
    key: `incident:${id}`,
    kind: "event",
    code: "payment.offline_forward_declined",
    params: { amount: "12.50", paymentRef: `pi_${id}` },
    severity,
    since: "2026-09-14T12:00:00.000Z",
    area: "payments",
  });
  const bell = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=alerts-bell]");
  const toast = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<WtToast>("[data-test=alert-toast]")!;
  const toastButton = (el: DashboardApp, name: "message" | "close") =>
    toast(el).shadowRoot!.querySelector<HTMLButtonElement>(`.${name}`)!;
  const panel = (el: DashboardApp) =>
    bell(el)!
      .shadowRoot!.querySelector("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLElement>("[popover]")!;

  // The shell applies the session's language on login, so the session itself must be English.
  const alertsApi = (overrides: Record<string, unknown> = {}) =>
    stubApi({
      getMe: vi.fn().mockResolvedValue({ ...meResponse, sessionDefault: "en-GB" }),
      liveData: new LiveData(),
      ...overrides,
    });
  const countOf = (el: DashboardApp) =>
    (bell(el)!.shadowRoot!.querySelector("wt-count-badge") as HTMLElement & { count: number })
      .count;

  /** Mounts a manager whose first alerts read holds one alert, then raises one more so the pop-up
   * opens. Returns the element and its live data so a test can raise more. */
  async function mountWithPopup() {
    const liveData = new LiveData();
    const listAlerts = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, alerts: [alert("1")] })
      .mockResolvedValue({ visible: true, alerts: [alert("1"), alert("2", "error")] });
    const api = alertsApi({ listAlerts, liveData });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: stubRequest,
    });
    await flush(el);
    liveData.invalidate([{ type: "incidents", id: "new" }]);
    await vi.waitFor(() => expect(toast(el).open).toBe(true));
    await el.updateComplete;
    await toast(el).updateComplete;
    return { el, host, liveData };
  }

  const tapMin = (el: DashboardApp): number => {
    const value = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
    expect(value, "--wt-tap-min resolves to a length").toBeGreaterThan(0);
    return value;
  };

  /** Runs `body` at a real viewport size inside the real page's outer margin (`index.html` pads the
   * body by 24px), then restores the size. */
  async function atViewport(host: HTMLElement, width: number, body: () => Promise<void>) {
    const before = { width: window.innerWidth, height: window.innerHeight };
    host.style.padding = "24px";
    try {
      await page.viewport(width, 800);
      await vi.waitFor(() => expect(window.innerWidth).toBe(width));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await body();
    } finally {
      await page.viewport(before.width, before.height);
    }
  }

  it("shows the bell with its count when alerts are visible, and no pop-up on the first read", async () => {
    const api = alertsApi({
      listAlerts: vi
        .fn()
        .mockResolvedValue({ visible: true, alerts: [alert("1", "error"), alert("2")] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    const count = bell(el)!.shadowRoot!.querySelector("wt-count-badge") as HTMLElement & {
      count: number;
    };
    expect(count.count).toBe(2);
    expect(count.getAttribute("tone")).toBe("error");
    expect(toast(el).open).toBe(false);
  });

  it("puts the language chooser, then the bell, before the account menu in the banner", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    const actions = el.shadowRoot!.querySelector(".banner-actions")!;
    expect([...actions.children].map((child) => child.getAttribute("data-test"))).toEqual([
      "language-chooser",
      "alerts-bell",
      "account-menu",
    ]);
  });

  it.each([360, 400, 480])(
    "fits every banner item without overlap at %ipx, with the language chooser, the bell and the account menu",
    async (width) => {
      const api = alertsApi({
        listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1", "error")] }),
      });
      const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
        api,
        request: stubRequest,
      });
      await flush(el);
      await atViewport(host, width, async () => {
        const banner = brandBanner(el)!;
        const items = [
          "[data-test=nav-toggle]",
          ".brand-logo",
          "[data-test=venue-name]",
          "[data-test=alerts-bell]",
          "[data-test=account-menu]",
          "[data-test=language-chooser]",
        ].map((selector) => {
          const box = el.shadowRoot!.querySelector(selector)!.getBoundingClientRect();
          return { selector, box };
        });
        const outer = banner.getBoundingClientRect();
        for (const { selector, box } of items) {
          expect(box.width, `${selector} is visible`).toBeGreaterThan(0);
          expect(box.left, `${selector} starts inside the banner`).toBeGreaterThanOrEqual(
            outer.left,
          );
          expect(box.right, `${selector} ends inside the banner`).toBeLessThanOrEqual(outer.right);
        }
        for (const [i, a] of items.entries()) {
          for (const b of items.slice(i + 1)) {
            const overlapX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
            const overlapY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
            expect(overlapX > 0.5 && overlapY > 0.5, `${a.selector} overlaps ${b.selector}`).toBe(
              false,
            );
          }
        }
        expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
        const [, logo, , , menu, chooser] = items;
        expect(menu!.box.top, "the account menu shares the lockup's row").toBeLessThan(
          logo!.box.bottom,
        );
        expect(chooser!.box.top, "the language chooser shares the lockup's row").toBeLessThan(
          logo!.box.bottom,
        );
      });
    },
  );

  it.each([
    ["demo", "en-GB"],
    ["demo", "es-ES"],
    ["prepare", "en-GB"],
    ["prepare", "es-ES"],
  ] as const)(
    "when the intent is %s, in %s at 1280px, puts the email inbox link in the shared bar above the banner",
    async (intent, locale) => {
      const api = alertsApi({
        getMe: vi
          .fn()
          .mockResolvedValue({ ...meResponse, sessionDefault: locale, onboardingIntent: intent }),
        listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
      });
      const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
        api,
        request: stubRequest,
      });
      await flush(el);
      await atViewport(host, 1280, async () => {
        const bar = el.shadowRoot!.querySelector("wt-demo-bar")!;
        const link = bar
          .shadowRoot!.querySelector('a[href="/manage/email"]')!
          .getBoundingClientRect();
        const current = bar
          .shadowRoot!.querySelector('[aria-current="page"]')!
          .getBoundingClientRect();
        const banner = brandBanner(el)!.getBoundingClientRect();
        expect(link.width).toBeGreaterThan(0);
        expect(link.left).toBeGreaterThan(current.right);
        expect(link.bottom).toBeLessThanOrEqual(banner.top);
        expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
      });
    },
  );

  it.each(
    (["demo", "prepare"] as const).flatMap((intent) =>
      (["en-GB", "es-ES"] as const).flatMap((locale) =>
        ([360, 390, 480] as const).map((width) => [intent, locale, width] as const),
      ),
    ),
  )(
    "when the intent is %s, in %s, fits banner items and the shared bar at %ipx",
    async (intent, locale, width) => {
      const api = alertsApi({
        getMe: vi
          .fn()
          .mockResolvedValue({ ...meResponse, sessionDefault: locale, onboardingIntent: intent }),
        listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1", "error")] }),
      });
      const { el, host } = await mountWidget<DashboardApp>("dashboard-app", {
        api,
        request: stubRequest,
      });
      await flush(el);
      await atViewport(host, width, async () => {
        const banner = brandBanner(el)!;
        const items = [
          "[data-test=nav-toggle]",
          ".brand-logo",
          "[data-test=venue-name]",
          "[data-test=language-chooser]",
          "[data-test=alerts-bell]",
          "[data-test=account-menu]",
        ].map((selector) => ({
          selector,
          box: el.shadowRoot!.querySelector(selector)!.getBoundingClientRect(),
        }));
        const outer = banner.getBoundingClientRect();
        for (const { selector, box } of items) {
          expect(box.width, `${selector} is visible`).toBeGreaterThan(0);
          expect(box.left, `${selector} starts inside the banner`).toBeGreaterThanOrEqual(
            outer.left,
          );
          expect(box.right, `${selector} ends inside the banner`).toBeLessThanOrEqual(outer.right);
        }
        for (const [i, a] of items.entries()) {
          for (const b of items.slice(i + 1)) {
            const overlapX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
            const overlapY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
            expect(overlapX > 0.5 && overlapY > 0.5, `${a.selector} overlaps ${b.selector}`).toBe(
              false,
            );
          }
        }
        expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
        const logo = items[1]!.box;
        const bar = el.shadowRoot!.querySelector("wt-demo-bar")!;
        const link = bar
          .shadowRoot!.querySelector('a[href="/manage/email"]')!
          .getBoundingClientRect();
        const current = bar
          .shadowRoot!.querySelector('[aria-current="page"]')!
          .getBoundingClientRect();
        expect(logo.width, "the lockup keeps a readable width").toBeGreaterThanOrEqual(60);
        expect(link.width, "the inbox link is visible").toBeGreaterThan(0);
        const overlapX = Math.min(link.right, current.right) - Math.max(link.left, current.left);
        const overlapY = Math.min(link.bottom, current.bottom) - Math.max(link.top, current.top);
        expect(overlapX > 0.5 && overlapY > 0.5, "the bar links do not overlap").toBe(false);
        expect(link.bottom, "the bar stays above the banner").toBeLessThanOrEqual(outer.top);
        expect(link.height, "the inbox link meets the minimum tap size").toBeGreaterThanOrEqual(
          tapMin(el),
        );
        expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
        const chooser = items[3]!.box;
        const menu = items[5]!.box;
        expect(menu.top, "the account menu shares the lockup's row").toBeLessThan(logo.bottom);
        expect(chooser.top, "the language chooser shares the lockup's row").toBeLessThan(
          logo.bottom,
        );
      });
    },
  );

  it.each([1280, 400])(
    "puts the pop-up below the banner, and inside its width, at %ipx",
    async (width) => {
      const { el, host } = await mountWithPopup();
      await atViewport(host, width, async () => {
        const box = toast(el).getBoundingClientRect();
        const banner = brandBanner(el)!.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(banner.bottom);
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(banner.left);
        expect(box.right).toBeLessThanOrEqual(banner.right);
      });
    },
  );

  it("shows no bell when the session may see no alerts", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: alertsApi(),
      request: stubRequest,
    });
    await flush(el);
    expect(bell(el)).toBeNull();
  });

  it("stops watching alerts once a read says they are not visible", async () => {
    const liveData = new LiveData();
    const listAlerts = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, alerts: [alert("1")] })
      .mockResolvedValue({ visible: false, alerts: [] });
    const api = alertsApi({ listAlerts, liveData });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(bell(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() => expect(bell(el)).toBeNull());
    const reads = listAlerts.mock.calls.length;
    liveData.invalidate([{ type: "incidents" }]);
    await flush(el);
    expect(listAlerts).toHaveBeenCalledTimes(reads);
  });

  it("keeps the last alerts when a later read fails", async () => {
    const liveData = new LiveData();
    const listAlerts = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, alerts: [alert("1")] })
      .mockRejectedValue({ code: "server.internal" });
    const api = alertsApi({ listAlerts, liveData });
    const record = vi.spyOn(diag, "record");
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api,
        request: stubRequest,
      });
      await flush(el);
      liveData.invalidate([{ type: "incidents" }]);
      await vi.waitFor(() =>
        expect(record).toHaveBeenCalledWith("warn", "alerts.load_failed", {
          code: "server.internal",
        }),
      );
      await flush(el);
      expect(countOf(el)).toBe(1);
      expect(toast(el).open).toBe(false);
    } finally {
      record.mockRestore();
    }
  });

  it("pops up a new alert, and opens the panel when the pop-up is pressed", async () => {
    const { el } = await mountWithPopup();
    expect(toast(el).message).toContain("A card payment of €12.50 taken while offline");
    expect(toast(el).tone).toBe("error");
    toastButton(el, "message").click();
    expect(panel(el).matches(":popover-open")).toBe(true);
    await flush(el);
    expect(toast(el).open).toBe(false);
  });

  describe.each(["light", "dark"] as const)("alert language switching (%s theme)", (theme) => {
    it.each([false, true])(
      "retranslates the bell list with close-before-switch=%s",
      async (closeFirst) => {
        const listAlerts = vi
          .fn()
          .mockResolvedValue({ visible: true, alerts: [alert("1", "error")] });
        const { el } = await mountWidget<DashboardApp>(
          "dashboard-app",
          { api: alertsApi({ listAlerts }), request: stubRequest },
          theme,
        );
        await flush(el);
        const widget = bell(el) as AlertsBell;
        widget.open();
        await flush(el);
        const item = () => widget.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-item]")!;
        expect(item().textContent).toContain("A card payment of €12.50 taken while offline");
        if (closeFirst) {
          widget
            .shadowRoot!.querySelector<import("@waitron/ui").WtRowActions>("wt-row-actions")!
            .hide();
        }
        emit(shellChooser(el)!, "wt-locale-selected", { code: "es-ES" });
        await flush(el);
        if (closeFirst) widget.open();
        await widget.updateComplete;
        expect(panel(el).matches(":popover-open")).toBe(true);
        expect(item().textContent).toContain(
          "Un pago con tarjeta de 12,50\u00a0€ cobrado sin conexión",
        );
        expect(item().textContent).toContain("Problema");
        expect(item().textContent).toContain("Pagos con tarjeta");
        expect(item().querySelector("[data-test=alert-handle]")!.textContent).toBe(
          "Marcar como resuelto",
        );
        emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
        await flush(el);
        expect(item().textContent).toContain("A card payment of €12.50 taken while offline");
        expect(item().querySelector("[data-test=alert-handle]")!.textContent).toBe("Mark handled");
        expect(listAlerts).toHaveBeenCalledTimes(1);
      },
    );

    it.each([1, 2])(
      "retranslates a visible %i-alert pop-up without a new arrival",
      async (count) => {
        const liveData = new LiveData();
        const listAlerts = vi
          .fn()
          .mockResolvedValueOnce({ visible: true, alerts: [] })
          .mockResolvedValue({
            visible: true,
            alerts: Array.from({ length: count }, (_, i) => alert(String(i + 1), "error")),
          });
        const { el } = await mountWidget<DashboardApp>(
          "dashboard-app",
          { api: alertsApi({ listAlerts, liveData }), request: stubRequest },
          theme,
        );
        await flush(el);
        liveData.invalidate([{ type: "incidents" }]);
        await vi.waitFor(() => expect(toast(el).open).toBe(true));
        await flush(el);
        const message = () => toastButton(el, "message").textContent!.trim();
        const english =
          count === 1
            ? "A card payment of €12.50 taken while offline was declined when it was sent on (reference pi_1). Collect the money another way."
            : "2 new alerts";
        const spanish =
          count === 1
            ? "Un pago con tarjeta de 12,50\u00a0€ cobrado sin conexión se rechazó al enviarlo (referencia pi_1). Cobra el importe de otra forma."
            : "2 avisos nuevos";
        expect(message()).toBe(english);
        emit(shellChooser(el)!, "wt-locale-selected", { code: "es-ES" });
        await flush(el);
        expect(message()).toBe(spanish);
        expect(toast(el).open).toBe(true);
        expect(toast(el).tone).toBe("error");
        emit(shellChooser(el)!, "wt-locale-selected", { code: "en-GB" });
        await flush(el);
        expect(message()).toBe(english);
        expect(listAlerts).toHaveBeenCalledTimes(2);
        toastButton(el, "close").click();
        await flush(el);
        emit(shellChooser(el)!, "wt-locale-selected", { code: "es-ES" });
        await flush(el);
        expect(toast(el).open).toBe(false);
        expect(toast(el).message).toBe("");
        expect(toastButton(el, "message")).toBeNull();
      },
    );
  });

  it("counts several new alerts in one pop-up, with the error tone only when one is an error", async () => {
    const liveData = new LiveData();
    const listAlerts = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, alerts: [] })
      .mockResolvedValue({ visible: true, alerts: [alert("1"), alert("2")] });
    const api = alertsApi({ listAlerts, liveData });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() => expect(toast(el).open).toBe(true));
    expect(toast(el).message).toBe("2 new alerts");
    expect(toast(el).tone).toBe("info");
  });

  it("gives the pop-up a fresh countdown when a later batch brings the same text", async () => {
    const liveData = new LiveData();
    const listAlerts = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, alerts: [] })
      .mockResolvedValueOnce({ visible: true, alerts: [alert("1"), alert("2")] })
      .mockResolvedValue({
        visible: true,
        alerts: [alert("1"), alert("2"), alert("3"), alert("4")],
      });
    const api = alertsApi({ listAlerts, liveData });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() => expect(toast(el).open).toBe(true));
    await flush(el);
    // wt-toast never calls show() on itself, and an equal message changes none of its properties,
    // so show() is the only thing that restarts its countdown (proven in wt-toast.test.ts).
    const show = vi.spyOn(toast(el), "show");
    liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() => expect(listAlerts).toHaveBeenCalledTimes(3));
    await flush(el);
    expect(toast(el).message).toBe("2 new alerts");
    expect(show).toHaveBeenCalled();
  });

  it("moves focus into the panel when the pop-up is pressed", async () => {
    const { el } = await mountWithPopup();
    toastButton(el, "message").focus();
    toastButton(el, "message").click();
    const focused = bell(el)!.shadowRoot!.activeElement;
    expect(focused).not.toBeNull();
    expect(focused!.closest("wt-row-actions")).not.toBeNull();
    expect(focused!.tagName.toLowerCase()).toBe("wt-button");
  });

  it("returns focus to where it was when the pop-up is closed from the keyboard", async () => {
    const { el } = await mountWithPopup();
    const accountMenu = el.shadowRoot!.querySelector<HTMLElement>("[data-test=account-menu]")!;
    accountMenu.focus();
    expect(el.shadowRoot!.activeElement).toBe(accountMenu);
    toastButton(el, "close").focus();
    toastButton(el, "close").click();
    await flush(el);
    expect(toast(el).open).toBe(false);
    expect(el.shadowRoot!.activeElement).toBe(accountMenu);
  });

  it("leaves focus alone when the pop-up closes without having had focus", async () => {
    const { el } = await mountWithPopup();
    const accountMenu = el.shadowRoot!.querySelector<HTMLElement>("[data-test=account-menu]")!;
    accountMenu.focus();
    accountMenu.blur();
    toastButton(el, "close").click();
    await flush(el);
    expect(toast(el).open).toBe(false);
    expect(el.shadowRoot!.activeElement).toBeNull();
  });

  it("marks an alert handled from the panel and the bell updates", async () => {
    const api = alertsApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [alert("7")] })
        .mockResolvedValue({ visible: true, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!.click();
    expect(api.markIncidentHandled).toHaveBeenCalledWith("7");
    await vi.waitFor(() => expect(countOf(el)).toBe(0));
  });

  it("shows the error on the bell when marking handled fails", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("7")] }),
      markIncidentHandled: vi.fn().mockRejectedValue({ code: "alert.not_found" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!.click();
    await vi.waitFor(() =>
      expect(bell(el)!.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("alert.not_found"),
      ),
    );
    expect(countOf(el)).toBe(1);
  });

  it("handling on the Alerts screen also updates the bell, which reads the same query", async () => {
    const api = alertsApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [alert("7")] })
        .mockResolvedValue({ visible: true, alerts: [] }),
      listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alerts-see-all]")!.click();
    await flush(el);
    const screen = el.shadowRoot!.querySelector("dashboard-alerts-screen")!;
    await vi.waitFor(() =>
      expect(
        screen
          .shadowRoot!.querySelector("[data-test=open-alerts-table]")!
          .shadowRoot!.querySelector("[data-test=alert-handle]"),
      ).not.toBeNull(),
    );
    screen
      .shadowRoot!.querySelector("[data-test=open-alerts-table]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!
      .click();
    await vi.waitFor(() => expect(countOf(el)).toBe(0));
  });

  it("See all opens the Alerts screen", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
      listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alerts-see-all]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-alerts-screen")).not.toBeNull();
    expect(location.pathname).toMatch(/^\/manage\/alerts/);
  });

  it("opens the Alerts screen from a deep link for a non-staff session", async () => {
    history.replaceState(null, "", "/manage/alerts");
    const api = alertsApi({
      listHandledAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-alerts-screen")).not.toBeNull();
  });

  it("follows a Go to request from the panel to that screen", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({
        visible: true,
        alerts: [
          {
            key: "printer.offline:kitchen",
            kind: "ongoing",
            // `printer.offline` has no alert wording; the wording is not under test here.
            code: "printer.offline",
            params: { printerName: "Kitchen" },
            severity: "warning",
            since: "2026-09-14T12:00:00.000Z",
            area: "printing",
            screen: "printers",
          },
        ],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-go-to]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-printers-screen")).not.toBeNull();
    expect(location.pathname).toBe("/manage/printers");
  });

  it("does not open the Alerts screen for a staff session", async () => {
    history.replaceState(null, "", "/manage/alerts");
    const api = alertsApi({
      getMe: vi
        .fn()
        .mockResolvedValue({ ...meResponse, role: "staff", permissions: ["sale.take_payment"] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-alerts-screen")).toBeNull();
    expect(api.listAlerts).not.toHaveBeenCalled();
  });

  it("does not carry a Mark handled failure from an ended session onto the next one", async () => {
    let fail!: (error: unknown) => void;
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("7")] }),
      markIncidentHandled: vi.fn().mockReturnValue(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!.click();
    // main.ts reports an expired session before the request's promise rejects.
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: { code: "management_session.required" },
      }),
    );
    await flush(el);
    fail({ code: "management_session.required" });
    await flush(el);
    el.shadowRoot!.querySelector("dashboard-login-screen")!.dispatchEvent(
      new CustomEvent("logged-in", { bubbles: true, composed: true, detail: {} }),
    );
    await vi.waitFor(() => expect(bell(el)).not.toBeNull());
    await flush(el);
    expect(bell(el)!.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("clears the pop-up, the bell's error and a pending Mark handled on logout", async () => {
    const liveData = new LiveData();
    let current = [alert("1")];
    const api = alertsApi({
      liveData,
      listAlerts: vi.fn(async () => ({ visible: true, alerts: current })),
      markIncidentHandled: vi
        .fn()
        .mockRejectedValueOnce({ code: "alert.not_found" })
        .mockReturnValue(new Promise(() => undefined)),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    const logOutAndIn = async () => {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
      await flush(el);
      el.shadowRoot!.querySelector("dashboard-login-screen")!.dispatchEvent(
        new CustomEvent("logged-in", { bubbles: true, composed: true, detail: {} }),
      );
      await vi.waitFor(() => expect(bell(el)).not.toBeNull());
      await flush(el);
      await (bell(el) as AlertsBell).updateComplete;
    };
    const handle = () =>
      bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!;
    await flush(el);
    current = [alert("1"), alert("2")];
    liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() => expect(toast(el).open).toBe(true));
    handle().click();
    await vi.waitFor(() =>
      expect(bell(el)!.shadowRoot!.querySelector("[role=alert]")).not.toBeNull(),
    );

    await logOutAndIn();
    expect(toast(el).open).toBe(false);
    expect(bell(el)!.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    handle().click();
    await vi.waitFor(() => expect(handle().hasAttribute("loading")).toBe(true));
    await logOutAndIn();
    expect(handle().hasAttribute("loading")).toBe(false);
  });

  it("removes the bell when a re-check finds the session is now staff", async () => {
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ ...meResponse, sessionDefault: "en-GB" })
      .mockResolvedValue({
        ...meResponse,
        sessionDefault: "en-GB",
        role: "staff",
        permissions: ["sale.take_payment"],
      });
    const api = alertsApi({
      getMe,
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(bell(el)).not.toBeNull();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-my-schedule-screen")).not.toBeNull();
    expect(bell(el)).toBeNull();
  });

  it("drops a Mark handled failure that lands after a re-check found the session is now staff", async () => {
    let fail!: (error: unknown) => void;
    const manager = { ...meResponse, sessionDefault: "en-GB" };
    const getMe = vi
      .fn()
      .mockResolvedValueOnce(manager)
      .mockResolvedValueOnce({ ...manager, role: "staff", permissions: ["sale.take_payment"] })
      .mockResolvedValue(manager);
    const api = alertsApi({
      getMe,
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("7")] }),
      markIncidentHandled: vi.fn().mockReturnValue(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      ),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!.click();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(bell(el)).toBeNull();
    fail({ code: "alert.not_found" });
    await flush(el);
    // Back to a manager: the same session, so only the alerts reset can tell the failure is stale.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(getMe).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(bell(el)).not.toBeNull());
    await flush(el);
    await (bell(el) as AlertsBell).updateComplete;
    expect(bell(el)!.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(
      bell(el)!.shadowRoot!.querySelector("[data-test=alert-handle]")!.hasAttribute("loading"),
    ).toBe(false);
  });

  it("forgets the previous session's alerts on logout", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
    await flush(el);
    // The next session's first alerts read fails, so anything the bell shows is left over.
    (api as unknown as { listAlerts: unknown }).listAlerts = vi
      .fn()
      .mockRejectedValue({ code: "server.internal" });
    el.shadowRoot!.querySelector("dashboard-login-screen")!.dispatchEvent(
      new CustomEvent("logged-in", { bubbles: true, composed: true, detail: {} }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=account-menu]")).not.toBeNull();
    expect(bell(el)).toBeNull();
  });
});

describe("dashboard-app: session signals", () => {
  const DEADLINE_KEY = "waitron-management-session-deadline";
  const notice = (el: DashboardApp) =>
    login(el)?.shadowRoot!.querySelector<HTMLElement>(".notice")?.textContent?.trim() ?? null;
  const sessionInvalid = (code: string) =>
    window.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));
  const otherTabDeadline = (newValue: string | null, key = DEADLINE_KEY) =>
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));

  async function signedIn(overrides: Record<string, unknown> = {}) {
    const api = stubApi(overrides);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(overview(el)).not.toBeNull();
    return { el, api };
  }

  /** Makes the next visibility change read as the tab coming back into view. */
  function tabVisible(): void {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("stays signed in when a request reports a code that is not about the session", async () => {
    const { el } = await signedIn();
    sessionInvalid("catalogue.not_found");
    await flush(el);
    expect(overview(el)).not.toBeNull();
    expect(login(el)).toBeNull();
  });

  it("returns to login with the suspension notice when the person is suspended", async () => {
    const { el } = await signedIn();
    sessionInvalid("person.suspended");
    await flush(el);
    expect(notice(el)).toBe(codeMessage("person.suspended"));
  });

  it("does not re-check a signed-out tab when it comes back into view", async () => {
    const getMe = vi.fn().mockRejectedValue({ code: "management_session.required" });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi({ getMe }) });
    await flush(el);
    expect(login(el)).not.toBeNull();
    tabVisible();
    await flush(el);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("broadcasts no session deadline for activity before anyone has signed in", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }) }),
    });
    await flush(el);
    window.dispatchEvent(new Event("waitron-session-active"));
    expect(localStorage.getItem(DEADLINE_KEY)).toBeNull();
  });

  it("ignores another tab's storage writes that are not the session deadline", async () => {
    const { el } = await signedIn();
    otherTabDeadline("0", "some-other-key");
    await flush(el);
    expect(overview(el)).not.toBeNull();
  });

  it.each([
    ["ended the session", "0"],
    ["wrote an unreadable deadline", "not-a-number"],
    ["removed the deadline", null],
  ])("returns to login when another tab %s", async (_what, value) => {
    const { el } = await signedIn();
    otherTabDeadline(value);
    // Before any timer can run: the return is immediate, not a deadline scheduled for "now".
    await el.updateComplete;
    expect(notice(el)).toBe(codeMessage("management_session.expired"));
  });

  it("follows another tab's later deadline instead of its own", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi({
        getMe: vi.fn().mockResolvedValue({ ...meResponse, sessionExpiresInSeconds: 1 }),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(overview(el)).not.toBeNull();
      otherTabDeadline(String(Date.now() + 5_000));
      await vi.advanceTimersByTimeAsync(4_999);
      await el.updateComplete;
      expect(overview(el)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await el.updateComplete;
      expect(notice(el)).toBe(codeMessage("management_session.expired"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores another tab's deadline while signed out", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }) }),
    });
    await flush(el);
    otherTabDeadline("0");
    await flush(el);
    expect(login(el)).not.toBeNull();
    expect(notice(el)).toBeNull();
  });

  it.each([
    ["no notice when the re-check cannot reach the server", "connection.failed", null],
    [
      "the suspension notice when the re-check finds a suspension",
      "person.suspended",
      "person.suspended",
    ],
  ])("a signed-in tab's failed re-check returns to login with %s", async (_what, code, shown) => {
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ ...meResponse })
      .mockRejectedValueOnce({ code });
    const { el } = await signedIn({ getMe });
    tabVisible();
    await flush(el);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(login(el)).not.toBeNull();
    expect(notice(el)).toBe(shown === null ? null : codeMessage(shown));
  });

  it("drops a re-check failure that lands after the session has already ended", async () => {
    let fail!: (error: unknown) => void;
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ ...meResponse })
      .mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    const { el } = await signedIn({ getMe });
    tabVisible();
    sessionInvalid("management_session.expired");
    await flush(el);
    fail({ code: "person.suspended" });
    await flush(el);
    expect(notice(el)).toBe(codeMessage("management_session.expired"));
  });
});

describe("dashboard-app: remaining faces and shell controls", () => {
  // Reads that never answer: each face below is asserted mounted, not loaded.
  const pending = () => vi.fn(() => new Promise(() => undefined));
  const faceApi = () =>
    stubApi({
      listLibraryProducts: pending(),
      getLocationSettings: pending(),
      listDeviceProfiles: pending(),
      getBackupStatus: pending(),
      getStreamSettings: pending(),
      getCloudStatus: pending(),
      getEmailInbox: pending(),
      listPaymentProviders: pending(),
      listReaders: pending(),
      listStuckBillPayments: pending(),
      listStuckBillRefunds: pending(),
      liveData: new LiveData(),
    });

  it.each([
    ["menus", "dashboard-menus-screen"],
    ["device-profiles", "dashboard-device-profiles-screen"],
    ["diagnostics", "dashboard-diagnostics-screen"],
    ["backup", "dashboard-backup-screen"],
    ["cloud", "dashboard-cloud-services-screen"],
    ["email", "dashboard-email-screen"],
    ["payments", "dashboard-payments-screen"],
    ["alerts", "dashboard-alerts-screen"],
  ])("opens %s for a manager from its address, with the shell's api", async (screen, tag) => {
    history.replaceState(null, "", `/manage/${screen}`);
    const api = faceApi();
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    const face = el.shadowRoot!.querySelector<HTMLElement & { api: DashboardApi }>(tag);
    expect(face).not.toBeNull();
    expect(face!.api).toBe(api);
    expect(location.pathname).toMatch(new RegExp(`^/manage/${screen}(/|$)`));
  });

  it("handles the retired Sections address as an unknown screen", async () => {
    history.replaceState(null, "", "/manage/sections");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: faceApi(),
      request: stubRequest,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-sections-screen")).toBeNull();
    expect(location.pathname).toBe("/manage/overview");
  });

  it("hands the payments face the request primitive and the venue's onboarding mode", async () => {
    history.replaceState(null, "", "/manage/payments");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: faceApi(),
      request: stubRequest,
    });
    await flush(el);
    const payments = el.shadowRoot!.querySelector<
      HTMLElement & { request: DashboardRequest; mode?: string }
    >("dashboard-payments-screen")!;
    expect(payments.request).toBe(stubRequest);
    expect(payments.mode).toBe("prepare");
  });

  it("follows a Go to from the Alerts face, keeping the event inside the shell", async () => {
    history.replaceState(null, "", "/manage/alerts");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: faceApi(),
      request: stubRequest,
    });
    await flush(el);
    const alertsFace = el.shadowRoot!.querySelector<
      HTMLElement & { canOpen: (screen: string) => boolean }
    >("dashboard-alerts-screen")!;
    expect(alertsFace.canOpen("sales")).toBe(true);
    expect(alertsFace.canOpen("no-such-screen")).toBe(false);
    const escaped = vi.fn();
    el.addEventListener("wt-alert-go-to", escaped);
    emit(alertsFace, "wt-alert-go-to", { screen: "sales" });
    await flush(el);
    expect(sales(el)).not.toBeNull();
    expect(location.pathname).toBe("/manage/sales");
    expect(escaped).not.toHaveBeenCalled();
  });

  it("orders the groups as the spec does, and files Venue operations' pages among its modules' pages", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "venue-service"],
        permissions: ["booking.manage", "venue_service.manage"],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    const items = (group: string) =>
      [
        ...el.shadowRoot!.querySelectorAll<HTMLElement>(`#nav-group-panel-${group} [data-test]`),
      ].map((item) => item.dataset.test);
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")].map(
        (header) => header.dataset.test,
      ),
    ).toEqual([
      "nav-group-reports",
      "nav-group-service",
      "nav-group-menu",
      "nav-group-operations",
      "nav-group-team",
      "nav-group-purchasing",
      "nav-group-configuration",
    ]);
    expect(items("service")).toEqual(["nav-bookings"]);
    expect(items("operations")).toEqual([
      "nav-venue-operations",
      "nav-hours",
      "nav-floor",
      "nav-prep-stations",
      "nav-venue-settings",
    ]);
    expect(navItem(el, "venue-operations")!.textContent!.trim()).toBe("Departamentos y zonas");
    expect(items("configuration")).not.toContain("nav-venue-settings");
  });

  it.each([
    ["Bookings is not enabled", { modules: [], permissions: ["booking.manage"] }],
    ["the session may not open Bookings", { modules: ["bookings"], permissions: [] }],
  ])("draws no Service header when %s", async (_label, me) => {
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, ...me }) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="nav-group-service"]')).toBeNull();
    expect(el.shadowRoot!.querySelector("#nav-group-panel-service")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="nav-group-operations"]')).not.toBeNull();
  });

  it("offers the server's languages in the signed-in shell's chooser", async () => {
    const getLocales = vi.fn().mockResolvedValue({
      locales: [{ code: "en-GB", label: "English (server)" }],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getLocales }),
    });
    await flush(el);
    expect(getLocales).not.toHaveBeenCalled();
    const chooser = shellChooser(el)!;
    chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await vi.waitFor(() =>
      expect(
        chooser.shadowRoot!.querySelector('[data-test="lang-en-GB"]')?.textContent?.trim(),
      ).toBe("English (server)"),
    );
    expect(getLocales).toHaveBeenCalledTimes(1);
  });

  it("ignores a request to open a product's editor from a session that cannot see the catalogue", async () => {
    const api = stubApi({
      getMe: vi
        .fn()
        .mockResolvedValue({ ...meResponse, role: "staff", permissions: ["sale.take_payment"] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(mySchedule(el)).not.toBeNull();
    const before = location.href;
    const lastTrailEntry = diag.snapshot().at(-1);
    const escaped = vi.fn();
    el.addEventListener("wt-edit-product", escaped);
    emit(mySchedule(el)!, "wt-edit-product", { productId: "p1" });
    await flush(el);
    expect(mySchedule(el)).not.toBeNull();
    expect(catalogue(el)).toBeNull();
    expect(location.href).toBe(before);
    // No navigation happened, so none is recorded on the diagnostics trail.
    expect(diag.snapshot().at(-1)).toEqual(lastTrailEntry);
    expect(escaped).not.toHaveBeenCalled();
  });

  it("keeps the drawer open for keys other than Escape", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const layout = () => el.shadowRoot!.querySelector<HTMLElement>(".layout")!;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await el.updateComplete;
    layout().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(layout().classList.contains("drawer-open")).toBe(true);
  });
});

describe("the nav search", () => {
  const sessionIn = (locale: string, me: Record<string, unknown> = {}) =>
    stubApi({
      getMe: vi
        .fn()
        .mockResolvedValue({ ...meResponse, venueLocale: locale, sessionDefault: locale, ...me }),
      listStaff: vi.fn().mockResolvedValue([]),
    });
  const searchBox = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
  const shownItems = (el: DashboardApp) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item")]
      .filter((item) => item.checkVisibility())
      .map((item) => item.dataset.test);
  const shownHeaders = (el: DashboardApp) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-group")]
      .filter((header) => header.checkVisibility())
      .map((header) => header.dataset.test);
  const expandedHeaders = (el: DashboardApp) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")]
      .filter((header) => header.getAttribute("aria-expanded") === "true")
      .map((header) => header.dataset.test);
  const emptyStatus = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-search-empty]");
  const layout = (el: DashboardApp) => el.shadowRoot!.querySelector<HTMLElement>(".layout")!;

  /** Types into the box the way a person does, replacing whatever it held. */
  async function search(el: DashboardApp, term: string): Promise<void> {
    const box = searchBox(el);
    box.focus();
    box.shadowRoot!.querySelector("input")!.select();
    await userEvent.keyboard(term === "" ? "{Backspace}" : term);
    await flush(el);
  }

  async function press(el: DashboardApp, key: string): Promise<void> {
    searchBox(el).focus();
    await userEvent.keyboard(`{${key}}`);
    await flush(el);
  }

  // The test frame is narrower than the drawer breakpoint, where a closed drawer is inert and its
  // box cannot take focus; each case picks the width it describes.
  let restoreViewport: [number, number];
  beforeEach(() => {
    restoreViewport = [window.innerWidth, window.innerHeight];
  });
  afterEach(async () => {
    await page.viewport(...restoreViewport);
  });

  async function mountSession(api: DashboardApi, width = 1280): Promise<DashboardApp> {
    await page.viewport(width, 800);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    return el;
  }

  async function openDrawer(el: DashboardApp): Promise<void> {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
    await el.updateComplete;
    expect(layout(el).classList.contains("drawer-open")).toBe(true);
  }

  it("has no Categories screen", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "Categories");
    expect(shownItems(el)).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-test=nav-categories]")).toBeNull();
  });

  it("is a named search box at the top of the nav", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    const box = searchBox(el);
    expect(box.type).toBe("search");
    expect(box.name).toBe("nav-search");
    expect(box.autocomplete).toBe("off");
    expect(box.shadowRoot!.querySelector("input")!.getAttribute("aria-label")).toBe("Search pages");
    expect(box.placeholder).toBe("Search pages");
    expect(el.shadowRoot!.querySelector("nav")!.firstElementChild).toBe(box);
  });

  it("is the shared search field, named by its hidden label, and filters on its change", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    const box = el.shadowRoot!.querySelector("wt-input[data-test=nav-search]") as
      | (HTMLElement & { type: string; label: string; hideLabel: boolean; placeholder: string })
      | null;
    expect(box!.type).toBe("search");
    expect(box!.label).toBe(t("nav.search"));
    expect(box!.hideLabel).toBe(true);
    expect(box!.placeholder).toBe(t("nav.search"));
    box!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "print" }, bubbles: true, composed: true }),
    );
    await flush(el);
    expect(shownItems(el)).toEqual(["nav-printers"]);
  });

  it("shows only the pages whose label holds the term, whatever its case", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "PRINT");
    expect(shownItems(el)).toEqual(["nav-printers"]);
    expect(shownHeaders(el)).toEqual(["nav-group-configuration"]);

    await search(el, "book");
    expect(shownItems(el)).toEqual(["nav-bookings"]);
  });

  it("ignores accents, so a Spanish label is found typed without them", async () => {
    const el = await mountSession(sessionIn("es-ES"));
    await search(el, "DIAGNOSTICO");
    expect(shownItems(el)).toEqual(["nav-diagnostics"]);
    await search(el, "impresoras");
    expect(shownItems(el)).toEqual(["nav-printers"]);
  });

  it("shows every page of a group whose name holds the term", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "team");
    expect(shownHeaders(el)).toEqual(["nav-group-team"]);
    expect(shownItems(el)).toEqual([
      "nav-staff",
      "nav-roster",
      "nav-approvals",
      "nav-planned-actual",
    ]);
  });

  it("finds the moved pages under Venue operations", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "venue");
    expect(shownHeaders(el)).toEqual(["nav-group-operations"]);
    expect(shownItems(el)).toEqual(["nav-floor", "nav-venue-settings"]);
  });

  it("opens a collapsed group holding a match, and clearing the term leaves the nav as it was", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    expect(expandedHeaders(el)).toEqual([]);

    await search(el, "print");
    expect(shownHeaders(el)).toEqual(["nav-group-configuration"]);
    expect(
      el.shadowRoot!.querySelector<HTMLElement>("#nav-group-panel-configuration")!.hidden,
    ).toBe(false);

    await search(el, "");
    expect(expandedHeaders(el)).toEqual([]);
    expect(shownHeaders(el)).toEqual([
      "nav-group-reports",
      "nav-group-service",
      "nav-group-menu",
      "nav-group-operations",
      "nav-group-team",
      "nav-group-purchasing",
      "nav-group-configuration",
    ]);
    expect(shownItems(el)).toEqual(["nav-overview"]);
  });

  it("never offers a page the person may not open, typed with its exact label", async () => {
    const el = await mountSession(
      sessionIn("en-GB", { role: "supervisor", permissions: [], modules: ["bookings"] }),
    );
    // "Menus" is a manager page; its group's name holds the term, so the group's other pages show.
    await search(el, "Menus");
    expect(shownItems(el)).toEqual(["nav-catalogue", "nav-units"]);
    await search(el, "Diagnostics");
    expect(shownItems(el)).toEqual([]);
    // Bookings is enabled for the venue, but this session lacks its permission.
    await search(el, "Bookings");
    expect(shownItems(el)).toEqual([]);
  });

  it("says so when no page matches", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "zzz");
    expect(shownItems(el)).toEqual([]);
    expect(shownHeaders(el)).toEqual([]);
    const status = emptyStatus(el)!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent!.trim()).toBe("No pages match.");

    await search(el, "print");
    expect(emptyStatus(el)?.textContent?.trim() ?? "").toBe("");
  });

  it("opens the first match on Enter, closes the drawer and clears the term", async () => {
    const el = await mountSession(sessionIn("en-GB"), 390);
    await openDrawer(el);

    await search(el, "print");
    await press(el, "Enter");

    expect(screenPrinters(el)).toBeTruthy();
    expect(new URL(location.href).pathname).toBe("/manage/printers");
    expect(navPrinters(el)!.getAttribute("aria-current")).toBe("page");
    expect(layout(el).classList.contains("drawer-open")).toBe(false);
    expect(searchBox(el).value).toBe("");
    expect(expandedHeaders(el)).toEqual(["nav-group-configuration"]);
    expect(shownHeaders(el)).toHaveLength(NAV_GROUP_KEYS.length);
  });

  it("opens the current page's group again when a search picks another page in it after it was collapsed", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const el = await mountSession(sessionIn("en-GB"));
    const menu = () => el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!;
    menu().click();
    await flush(el);
    expect(expandedHeaders(el)).toEqual([]);

    await search(el, "Units");
    await press(el, "Enter");

    expect(new URL(location.href).pathname).toBe("/manage/units");
    expect(expandedHeaders(el)).toEqual(["nav-group-menu"]);
    expect(navItem(el, "units")!.checkVisibility()).toBe(true);
  });

  it("opens the current page's collapsed group when a search picks that same page", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const el = await mountSession(sessionIn("en-GB"));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!.click();
    await flush(el);
    expect(expandedHeaders(el)).toEqual([]);

    await search(el, "Products");
    await press(el, "Enter");

    expect(new URL(location.href).pathname).toBe("/manage/catalogue");
    expect(expandedHeaders(el)).toEqual(["nav-group-menu"]);
    expect(navItem(el, "catalogue")!.checkVisibility()).toBe(true);
  });

  it("opens Orders, chosen by a search, inside an expanded Reporting section", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    expect(expandedHeaders(el)).toEqual([]);

    await search(el, "Orders");
    await press(el, "Enter");

    expect(el.shadowRoot!.querySelector("dashboard-orders-screen")).not.toBeNull();
    expect(new URL(location.href).pathname).toBe("/manage/orders");
    expect(expandedHeaders(el)).toEqual(["nav-group-reports"]);
    expect(navItem(el, "orders")!.getAttribute("aria-current")).toBe("page");
    expect(navItem(el, "orders")!.checkVisibility()).toBe(true);
  });

  it("does nothing on Enter when no page matches", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    const path = new URL(location.href).pathname;
    await search(el, "zzz");
    await press(el, "Enter");
    expect(overview(el)).toBeTruthy();
    expect(new URL(location.href).pathname).toBe(path);
    expect(searchBox(el).value).toBe("zzz");
  });

  it("does nothing on Enter in an empty or blank box", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const el = await mountSession(sessionIn("en-GB"));
    expect(catalogue(el)).toBeTruthy();
    await press(el, "Enter");
    await search(el, "   ");
    await press(el, "Enter");
    expect(catalogue(el)).toBeTruthy();
    expect(new URL(location.href).pathname).toBe("/manage/catalogue");
  });

  it("clears the term and closes the drawer when a match is clicked", async () => {
    const el = await mountSession(sessionIn("en-GB"), 390);
    await openDrawer(el);
    await search(el, "print");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-printers]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-printers-screen")).toBeTruthy();
    expect(layout(el).classList.contains("drawer-open")).toBe(false);
    expect(searchBox(el).value).toBe("");
    expect(shownHeaders(el)).toHaveLength(NAV_GROUP_KEYS.length);
  });

  it("clears a term on Escape without closing the drawer, and an empty box's Escape still closes it", async () => {
    const el = await mountSession(sessionIn("en-GB"), 390);
    await openDrawer(el);
    await search(el, "print");
    expect(shownItems(el)).toEqual(["nav-printers"]);

    await press(el, "Escape");
    expect(searchBox(el).value).toBe("");
    expect(shownHeaders(el)).toHaveLength(NAV_GROUP_KEYS.length);
    expect(layout(el).classList.contains("drawer-open")).toBe(true);

    await press(el, "Escape");
    expect(layout(el).classList.contains("drawer-open")).toBe(false);
  });

  it("keeps the term across a language switch and searches the new language's labels", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "impresora");
    expect(shownItems(el)).toEqual([]);

    emit(shellChooser(el)!, "wt-locale-selected", { code: "es-ES" });
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
    expect(searchBox(el).value).toBe("impresora");
    expect(searchBox(el).placeholder).toBe("Buscar páginas");
    expect(shownItems(el)).toEqual(["nav-printers"]);
  });

  it("starts the next session with an empty box", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "print");
    logoutBtn(el)!.click();
    await flush(el);
    emitLoggedIn(login(el)!);
    await flush(el);
    expect(searchBox(el).value).toBe("");
    expect(shownHeaders(el)).toHaveLength(NAV_GROUP_KEYS.length);
  });

  it("keeps the folds a header click made before a search, when a header is clicked during it", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    const settings = () =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-configuration]")!;
    settings().click();
    await flush(el);
    expect(settings().getAttribute("aria-expanded")).toBe("true");

    await search(el, "print");
    settings().click();
    await flush(el);
    await search(el, "");

    expect(settings().getAttribute("aria-expanded")).toBe("true");
    expect(
      el.shadowRoot!.querySelector<HTMLElement>("#nav-group-panel-configuration")!.hidden,
    ).toBe(false);
  });

  it("shows a group header as a label, not a collapse control, while a term is typed", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "print");
    const header = el.shadowRoot!.querySelector<HTMLElement>(
      "[data-test=nav-group-configuration]",
    )!;
    expect(header.checkVisibility()).toBe(true);
    expect(header.textContent!.trim()).toBe("Settings");
    expect(header.tagName).not.toBe("BUTTON");
    expect(header.hasAttribute("aria-expanded")).toBe(false);
    expect(header.hasAttribute("aria-controls")).toBe(false);
    expect(header.querySelector(".chevron")).toBeNull();
  });

  it("ignores Enter and Escape that belong to a text composition", async () => {
    const el = await mountSession(sessionIn("en-GB"), 390);
    await openDrawer(el);
    const path = new URL(location.href).pathname;
    await search(el, "print");

    for (const key of ["Enter", "Escape"]) {
      searchBox(el).dispatchEvent(
        new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true, composed: true }),
      );
      await flush(el);
      expect(overview(el)).toBeTruthy();
      expect(new URL(location.href).pathname).toBe(path);
      expect(searchBox(el).value).toBe("print");
      expect(shownItems(el)).toEqual(["nav-printers"]);
      expect(layout(el).classList.contains("drawer-open")).toBe(true);
    }
  });

  for (const [key, typed] of [
    ["Enter", "{Enter}"],
    ["Space", "[Space]"],
  ]) {
    it(`leaves focus on the opened page's row after a match is chosen with ${key}`, async () => {
      const el = await mountSession(sessionIn("en-GB"));
      await search(el, "print");
      navPrinters(el)!.focus();
      await userEvent.keyboard(typed);
      await flush(el);

      expect(screenPrinters(el)).toBeTruthy();
      expect(searchBox(el).value).toBe("");
      const focused = el.shadowRoot!.activeElement as HTMLElement | null;
      expect(focused?.dataset.test).toBe("nav-printers");
      expect(focused?.getAttribute("aria-current")).toBe("page");
      expect(focused?.textContent!.trim()).toBe("Printers");
    });
  }
});

describe("telling the password manager which passkeys are accepted after a sign-in", () => {
  const SIGNALS = {
    rpId: "localhost",
    userId: "cDE",
    credentialIds: ["cred-1"],
    name: "manager@example.com",
    displayName: "Manager",
  };
  const signedOutThenIn = () =>
    vi
      .fn()
      .mockRejectedValueOnce({ code: "management_session.required" })
      .mockResolvedValue({ ...meResponse });

  it("sends the accepted passkeys once the sign-in's identity probe succeeds", async () => {
    const api = stubApi({
      getMe: signedOutThenIn(),
      passkeySignals: vi.fn().mockResolvedValue(SIGNALS),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(api.passkeySignals).not.toHaveBeenCalled();
    emitLoggedIn(login(el)!);
    await vi.waitFor(() => expect(signalAll).toHaveBeenCalledOnce());
    expect(signalAll).toHaveBeenCalledWith({
      rpId: "localhost",
      userId: "cDE",
      allAcceptedCredentialIds: ["cred-1"],
    });
    expect(signalDetails).toHaveBeenCalledExactlyOnceWith({
      rpId: "localhost",
      userId: "cDE",
      name: "manager@example.com",
      displayName: "Manager",
    });
  });

  it("sends them after a Google sign-in returns", async () => {
    history.replaceState(null, "", "/manage/?login=google");
    const api = stubApi({ passkeySignals: vi.fn().mockResolvedValue(SIGNALS) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    await vi.waitFor(() => expect(signalAll).toHaveBeenCalledOnce());
  });

  it("sends nothing when a page opens on a session that already existed", async () => {
    const api = stubApi({ passkeySignals: vi.fn().mockResolvedValue(SIGNALS) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    await flush(el);
    expect(api.passkeySignals).not.toHaveBeenCalled();
    expect(signalAll).not.toHaveBeenCalled();
    expect(signalDetails).not.toHaveBeenCalled();
  });

  it("sends nothing when the sign-in's identity probe fails", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      passkeySignals: vi.fn().mockResolvedValue(SIGNALS),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    emitLoggedIn(login(el)!);
    await flush(el);
    await flush(el);
    expect(api.passkeySignals).not.toHaveBeenCalled();
    expect(signalAll).not.toHaveBeenCalled();
    expect(signalDetails).not.toHaveBeenCalled();
  });
});

describe("the Products screen in the shell", () => {
  const listed = Array.from({ length: 40 }, (_, index) => ({
    id: `p${index}`,
    name: `Product ${index}`,
    primaryCategoryId: null,
    categoryId: null,
    active: true,
    catalogueId: "cat-a",
    modifiers: [],
    customerName: null,
    unitId: "u",
    unit: { id: "u", name: { es: "Unidad" }, abbreviation: { es: "ud" }, precision: 0 },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "reduced",
    available: true,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
  }));
  const productsApi = () => {
    const api = stubApi({
      listCatalogues: vi
        .fn()
        .mockResolvedValue([{ id: "cat-a", name: "Comida", active: true, version: 1 }]),
      listProducts: vi.fn().mockResolvedValue(listed),
      listUnits: vi.fn().mockResolvedValue([]),
      listExtraLists: vi.fn().mockResolvedValue([]),
      listOptionLists: vi.fn().mockResolvedValue([]),
      listMadeAt: vi.fn().mockResolvedValue({}),
      getFolderRouting: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    Object.defineProperty(api, "background", { get: () => api });
    return api;
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  async function openProducts(width: number, height: number) {
    await page.viewport(width, height);
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api: productsApi() });
    // The page gives the app the viewport's height, as index.html does.
    host.style.height = `${height}px`;
    await flush(el);
    navCatalogue(el)!.click();
    await flush(el);
    const screen = catalogue(el)!;
    const browser = screen.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
    await vi.waitFor(() =>
      expect(browser.shadowRoot!.querySelector("dashboard-product-list")).not.toBeNull(),
    );
    const list = browser.shadowRoot!.querySelector("dashboard-product-list")!;
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await vi.waitFor(() =>
      expect(table.shadowRoot!.querySelectorAll("tbody tr").length).toBeGreaterThan(40),
    );
    await frame();
    const main = el.shadowRoot!.querySelector<HTMLElement>(".main")!;
    const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    return { el, screen, table, main, scroll };
  }

  it("fills the main column at desktop size, keeping its title, the table's toolbar and its headings in view while the rows scroll", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      const { screen, table, main, scroll } = await openProducts(1280, 800);
      expect(screen.stickyHeader).toBe(true);
      expect(screen.hasAttribute("sticky-header")).toBe(true);
      expect(main.scrollHeight).toBe(main.clientHeight);
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
      const fixed = [
        screen.shadowRoot!.querySelector("h1")!,
        table.shadowRoot!.querySelector(".table-toolbar")!,
        table.shadowRoot!.querySelector("thead th")!,
      ];
      const before = fixed.map((item) => item.getBoundingClientRect().toJSON());
      scroll.scrollTop = scroll.scrollHeight;
      await frame();
      expect(scroll.scrollTop).toBeGreaterThan(0);
      expect(fixed.map((item) => item.getBoundingClientRect().toJSON())).toEqual(before);
      const port = main.getBoundingClientRect();
      for (const item of fixed) {
        expect(item.getBoundingClientRect().top).toBeGreaterThanOrEqual(port.top);
        expect(item.getBoundingClientRect().bottom).toBeLessThanOrEqual(port.bottom);
      }
      // The box reaches down to the body's padding: the rows use the whole column.
      const body = main.querySelector<HTMLElement>(".body")!;
      expect(scroll.getBoundingClientRect().bottom).toBeCloseTo(
        port.bottom - parseFloat(getComputedStyle(body).paddingBottom),
        0,
      );
    } finally {
      await page.viewport(width, height);
    }
  });

  it.each([
    [390, 844],
    [375, 667],
  ])(
    "at %i×%i the content column does not overflow, the table's box does, and the toolbar and headings stay inside the column with the rows scrolled to the end",
    async (w, h) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      try {
        const { table, main, scroll } = await openProducts(w, h);
        expect(main.scrollHeight).toBeLessThanOrEqual(main.clientHeight);
        expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
        scroll.scrollTop = scroll.scrollHeight;
        await frame();
        expect(scroll.scrollTop).toBeGreaterThan(0);
        const port = main.getBoundingClientRect();
        for (const item of [
          table.shadowRoot!.querySelector(".table-toolbar")!,
          table.shadowRoot!.querySelector("thead th")!,
        ]) {
          expect(item.getBoundingClientRect().top).toBeGreaterThanOrEqual(port.top);
          expect(item.getBoundingClientRect().bottom).toBeLessThanOrEqual(port.bottom);
        }
      } finally {
        await page.viewport(width, height);
      }
    },
  );

  it("leaves another screen's body a plain block", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: productsApi() });
    await flush(el);
    navStaff(el)!.click();
    await flush(el);
    expect(staff(el)).not.toBeNull();
    expect(getComputedStyle(el.shadowRoot!.querySelector(".body")!).display).toBe("block");
  });
});

describe("application unsaved changes renderer", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    for (const decision of ["keep", "discard"] as const) {
      it(`${locale}: ${decision} uses the shell's single localized confirmation`, async () => {
        const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
        await flush(el);
        setLocale(locale);
        await el.updateComplete;
        const child = el.shadowRoot!.querySelector<HTMLElement>("div, main")!;
        const coordinator = leaveCoordinatorFor(child);
        expect(coordinator, "descendant resolves the application registry").toBeDefined();
        let draft = "Original";
        const scope = coordinator!.register({
          id: child,
          current: () => draft,
          snapshot: (value) => value,
          equal: (a, b) => a === b,
          restore: (value) => {
            draft = value;
          },
        });
        draft = "Edited";
        scope.changed();
        let left = 0;
        const pending = coordinator!.request({
          scopes: [scope.id],
          reason: "cancel",
          proceed() {
            left++;
          },
        });
        await el.updateComplete;
        const questions = el.shadowRoot!.querySelectorAll("wt-unsaved-changes");
        expect(questions).toHaveLength(1);
        const question = questions[0]!;
        await question.updateComplete;
        const modal = question.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        expect(question.heading).toBe(
          locale === "en-GB" ? "Discard unsaved changes?" : "¿Descartar los cambios sin guardar?",
        );
        expect(question.message).toBe(
          locale === "en-GB"
            ? "Your changes have not been saved."
            : "Tus cambios no se han guardado.",
        );
        expect(question.keepLabel).toBe(locale === "en-GB" ? "Keep editing" : "Seguir editando");
        expect(question.discardLabel).toBe(
          locale === "en-GB" ? "Discard changes" : "Descartar cambios",
        );
        question.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${decision}"]`)!.click();
        expect(await pending).toBe(decision === "keep" ? "kept" : "proceeded");
        expect(left).toBe(decision === "keep" ? 0 : 1);
        expect(draft).toBe(decision === "keep" ? "Edited" : "Original");
        scope.dispose();
      });
    }
  }
});

it("forced session exit aborts an open unsaved question and clears its registry immediately", async () => {
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
  await flush(el);
  const child = el.shadowRoot!.querySelector<HTMLElement>("div")!;
  const coordinator = leaveCoordinatorFor(child)!;
  let value = "Original";
  const scope = coordinator.register({
    id: child,
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  value = "Typed secret";
  scope.changed();
  let left = 0;
  const pending = coordinator.request({
    scopes: [scope.id],
    reason: "cancel",
    proceed() {
      left++;
    },
  });
  await el.updateComplete;
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await flush(el);
  expect(login(el)).not.toBeNull();
  expect(coordinator.isDirty()).toBe(false);
  expect(await pending).toBe("stale");
  const activeQuestion = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await activeQuestion.updateComplete;
  expect(activeQuestion.open).toBe(false);
  question.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(left).toBe(0);
  expect(value).toBe("Typed secret");
});

describe("printer breadcrumb during a pending save", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const editor of ["name", "connection"] as const) {
        it(`${locale}/${theme}: keeps the ${editor} save and its refusal under the real app`, async () => {
          history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
          let refuse!: (error: unknown) => void;
          const api = stubApi({
            getMe: vi.fn().mockResolvedValue({ ...meResponse, locale }),
            listPrinters: vi.fn().mockResolvedValue([
              {
                id: "p1",
                name: "Kitchen",
                transport: "network_tcp",
                host: "10.0.0.9",
                port: 9100,
                localKey: null,
                pollId: null,
                watcherId: null,
                paperWidth: "80mm",
                resolution: "180dpi",
                hasCashDrawer: false,
                portable: false,
                holder: null,
                pendingJobs: 0,
                lastPrintAt: null,
                lastPrintAgentId: null,
                active: true,
              },
            ]),
            listPrinterProfiles: vi.fn().mockResolvedValue([]),
            listDiscoveredPrinters: vi.fn().mockResolvedValue([]),
            pairingMode: vi.fn().mockResolvedValue({
              open: false,
              openUntil: null,
              deviceAddress: "https://waitron.local",
            }),
            joinRequests: vi.fn().mockResolvedValue([]),
            updatePrinter: vi.fn(
              () =>
                new Promise<void>((_resolve, reject) => {
                  refuse = reject;
                }),
            ),
          });
          const { el } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
          await flush(el);
          const screen = screenPrinters(el)!;
          await expect
            .poll(() => screen.shadowRoot!.querySelector("[data-test=printer-status]"))
            .not.toBeNull();
          const q = (selector: string) => screen.shadowRoot!.querySelector<HTMLElement>(selector)!;
          await screen.updateComplete;
          expect(q("[data-test=printer-refresh-error]")).toBeNull();
          if (editor === "connection") {
            const disclosure = q(
              "[data-test=printer-section-connection]",
            ) as import("@waitron/ui").WtDisclosure;
            disclosure.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
            await screen.updateComplete;
            await disclosure.updateComplete;
          }
          q(`[data-test=edit-printer-${editor}]`).click();
          await screen.updateComplete;
          const input = q(
            `[name="printer-detail-${editor === "name" ? "name" : "host"}"]`,
          ) as WtInput;
          input.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: editor === "name" ? "New kitchen" : "10.0.0.10" },
              bubbles: true,
              composed: true,
            }),
          );
          await screen.updateComplete;
          const save = q(`[data-test=save-printer-${editor}]`) as import("@waitron/ui").WtButton;
          save.click();
          await expect.poll(() => typeof refuse).toBe("function");
          await screen.updateComplete;
          expect(save.disabled).toBe(true);
          q("[data-test=all-printers-link]").click();
          await flush(el);
          expect(location.pathname).toBe("/manage/printers/view/printers/printer/p1");
          expect(screenPrinters(el)).toBe(screen);
          expect(input.isConnected).toBe(true);
          expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
          refuse({ code: "printer.invalid_config" });
          await expect
            .poll(() =>
              editor === "name"
                ? q("[data-test=printer-name-refusal]")?.textContent?.trim()
                : q("[data-test=printer-section-connection] [role=alert]")?.textContent?.trim(),
            )
            .toBe(
              locale === "en-GB"
                ? "Check the printer's connection settings"
                : "Revisa los ajustes de conexión de la impresora",
            );
          expect(save.disabled).toBe(false);
          q("[data-test=all-printers-link]").click();
          const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
          await expect.poll(() => question.open).toBe(true);
          await question.updateComplete;
          question.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
          await expect.poll(() => location.pathname).toBe("/manage/printers/view/printers");
          await expect
            .poll(() => screen.shadowRoot!.querySelector("[data-test=printer-status]"))
            .toBeNull();
        });
      }
    }
  }
});
