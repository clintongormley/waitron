import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { DashboardApi, PersonSummary } from "./api/client.js";

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
    // seed reads `getLocales` (venueDefault es-ES) and the logged-in persist path writes `putLocale`.
    getMe: vi
      .fn()
      .mockResolvedValue({ personId: "p1", role: "manager", locale: null, venueLocale: "es-ES" }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue(people),
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
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
    // The layout + receipt screens the nav mounts both load `getLayout` on connect; resolve it (and
    // stub the two writers they call on Guardar) so navigating to either leaves no stray rejection.
    getLayout: vi.fn().mockResolvedValue({ definition: [], receipt: {} }),
    putLayout: vi.fn().mockResolvedValue(undefined),
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
    // The bookings screen the nav mounts loads both on connect (listTables for the form picker + seat
    // prompt, then the day's bookings); resolve them so navigating to it leaves no stray rejection.
    listTables: vi.fn().mockResolvedValue([]),
    listBookings: vi.fn().mockResolvedValue([]),
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
const layout = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-layout-screen");
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
const navOverview = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]");
const navSales = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-sales]");
const navStaff = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-staff]");
const navCatalogue = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-catalogue]");
const navLayout = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-layout]");
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

/** The twenty manager faces the grouped sidebar switches between (for a manager/admin session —
 * `diagnostics` is manager-gated), every one keeping its `data-test` id. Order is the sidebar's render
 * order (pinned overview+sales, then Menu / Service / Team / Purchasing / Configuration). */
const NAV_SCREENS = [
  "overview",
  "sales",
  "catalogue",
  "location-menus",
  "recipe",
  "floor",
  "bookings",
  "statuses",
  "kitchen",
  "staff",
  "roster",
  "approvals",
  "planned-actual",
  "purchases",
  "layout",
  "receipt",
  "devices",
  "printers",
  "canvas-editor",
  "diagnostics",
] as const;

/** The five group-header i18n keys the sidebar renders (the pinned overview+sales group has none). */
const NAV_GROUP_KEYS = [
  "nav.group.menu",
  "nav.group.service",
  "nav.group.team",
  "nav.group.purchasing",
  "nav.group.configuration",
] as const;
/** The chooser in the logged-in header chrome (present only when logged in). */
const headerChooser = (el: DashboardApp) =>
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
  "dashboard-layout-screen",
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

afterEach(cleanupWidgets);
// `setLocale` mutates module-global state that outlives a test, so pin it back to the shipped default
// around every case — otherwise one test's switch leaks into the next.
beforeEach(() => setLocale("es-ES"));
afterEach(() => setLocale("es-ES"));

describe("dashboard-app", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-app")).toBe(DashboardApp);
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
        .mockResolvedValue({ personId: "p1", role: "manager" }),
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
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p9", role: "staff" }) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(mySchedule(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
    expect(mountedScreens(el)).toEqual(["dashboard-my-schedule-screen"]);
    expect(countH1(el)).toBe(1);
  });

  it("a staff session shows NO manager nav (its only face is self-service)", async () => {
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p9", role: "staff" }) });
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
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p9", role: "staff" }) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect((mySchedule(el) as unknown as { myPersonId: string }).myPersonId).toBe("p9");
  });

  it("a STAFF login (after no session) lands on the my-schedule screen", async () => {
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({ personId: "p9", role: "staff" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();

    emitLoggedIn(login(el)!);
    await flush(el);
    expect(mySchedule(el)).toBeTruthy();
    expect(login(el)).toBeNull();
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
        .mockResolvedValue({ personId: "p1", role: "manager" }),
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
  // above, so this test walks the remaining four faces (staff / catalogue / layout / receipt).
  // Exactly one screen — and exactly one <h1> (each screen owns its own; the shell adds none) — shows
  // at a time.
  it("navigates the four non-roster logged-in screens, one screen and one h1 at a time", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    // Opens on overview (Task 9's non-staff landing), with all four nav controls present.
    expect(mountedScreens(el)).toEqual(["dashboard-overview-screen"]);
    expect(countH1(el)).toBe(1);
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();
    expect(navLayout(el)).toBeTruthy();
    expect(navReceipt(el)).toBeTruthy();

    // To staff.
    navStaff(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-staff-screen"]);
    expect(staff(el)).toBeTruthy();
    expect(countH1(el)).toBe(1);

    // To layout.
    navLayout(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-layout-screen"]);
    expect(layout(el)).toBeTruthy();
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
  // faces (a manager session sees the gated `diagnostics` too) keeps its `data-test="nav-<screen>"` id,
  // and the active face is marked `aria-current="page"`.
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
    // …and every one of the twenty manager faces is present by its stable data-test id.
    for (const s of NAV_SCREENS) expect(navItem(el, s)).toBeTruthy();
    expect(NAV_SCREENS).toHaveLength(20);
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
  // its nineteen nav buttons leave the tab order + a11y tree rather than lurking off-screen ahead of
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

      // Narrow + closed → inert (the nineteen nav buttons leave the tab order + a11y tree).
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
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p9", role: "staff" }) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=nav-toggle]")).toBeNull();
  });

  it("a staff session still gets no nav (no navigation landmark)", async () => {
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p9", role: "staff" }) });
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
    expect(navLayout(el)).toBeNull();
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
type LocalesResponse = { locales: { code: string; label: string }[]; venueDefault: string };
/** The resolved shape the widened `getMe` answers with. */
type MeResponse = { personId: string; role: string; locale: string | null; venueLocale: string };

describe("dashboard-app — per-user locale (Task 10)", () => {
  it("seeds the login screen to the venue default when there is no session (deep child via keyed)", async () => {
    // No session → stays on `login`; the boot seed reads getLocales and applies its venueDefault (en-GB,
    // which differs from the es-ES module default so the switch is observable). The login screen is
    // recreated by the `keyed(currentLocale(), …)` wrapper, so a DEEP child of its own shadow renders English.
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
      getLocales: vi.fn().mockResolvedValue({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(currentLocale()).toBe("en-GB");
    // The email/password field labels live inside the wt-input primitive's own shadow root, so a
    // localised string that renders in the login screen's OWN shadow is the observable proxy: the
    // submit button's slotted text. It differs across locales, so it proves the keyed re-render
    // reached this deep child in the seeded venue default (en-GB), not the module default (es-ES).
    const submit = login(el)!.shadowRoot!.querySelector("[data-test=submit]")!;
    expect(submit.textContent).toContain(t("action.login", "en-GB")); // "Log in"
    expect(submit.textContent).not.toContain(t("action.login", "es-ES")); // not "Entrar"
  });

  it("applies the person's stored locale on a logged-in boot — the seed never clobbers it, and never runs", async () => {
    // Pins the race fix. Venue default es-ES; the signed-in person's stored locale is en-GB. Because a
    // session is found, the venue-default seed is SKIPPED entirely (serialized: probe first, seed only
    // when still on `login`), so the UI ends on the PERSON's en-GB — never the venue default — and
    // getLocales is never called (one WHOAMI round trip). A DEEP child (the my-schedule <h1>) renders it.
    const getLocales = vi.fn().mockResolvedValue({ locales: [], venueDefault: "es-ES" });
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p9",
        role: "staff",
        locale: "en-GB",
        venueLocale: "es-ES",
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
      getMe: vi
        .fn()
        .mockResolvedValue({ personId: "p1", role: "manager", locale: null, venueLocale: "es-ES" }),
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

  it("renders the chooser in the logged-in header, and a pick there persists (putLocale) then switches (setLocale)", async () => {
    const putLocale = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ putLocale }),
    });
    await flush(el);
    expect(overview(el)).toBeTruthy();
    expect(headerChooser(el)).toBeTruthy(); // the logged-in header renders the chooser
    expect(currentLocale()).toBe("es-ES"); // manager, no stored preference, es-ES venue

    emit(headerChooser(el)!, "locale-selected", { code: "en-GB" });
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

    emit(headerChooser(el)!, "locale-selected", { code: "en-GB" });
    await flush(el);
    expect(putLocale).toHaveBeenCalledWith("en-GB");
    expect(currentLocale()).toBe("es-ES"); // unchanged — the failed write never switched the UI
  });

  it("logout reverts the UI to the venue default", async () => {
    // Log in as an en-GB manager (UI → English), then log out: the UI must return to the venue default
    // (es-ES) so the next person meets the venue language, not the previous operator's choice.
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: "en-GB",
        venueLocale: "es-ES",
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

  // ── Disconnect guards: each post-await setLocale is skipped on a detached app (proven by deletion) ──

  it("does not seed the venue default if the app disconnects mid-getLocales", async () => {
    // The seed's setLocale(venueDefault) runs AFTER `await getLocales()`. Start with no session so the
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
    resolveLocales({ locales: [], venueDefault: "en-GB" });
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
    resolveMe({ personId: "p1", role: "manager", locale: "en-GB", venueLocale: "es-ES" });
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

    emit(headerChooser(el)!, "locale-selected", { code: "en-GB" }); // putLocale now pending
    await el.updateComplete;
    host.remove(); // torn down before putLocale resolves
    resolvePut();
    await flush(el);
    expect(putLocale).toHaveBeenCalledWith("en-GB"); // the durable write still happened
    expect(currentLocale()).toBe("es-ES"); // but the local repaint was skipped on the detached app
  });

  it("does not revert the locale if the app disconnects mid-logout", async () => {
    // #onLogout's venue-default revert runs AFTER `await logout()`. Log in as en-GB, start logout with
    // logout() pending, detach, then resolve: the revert to es-ES must be SKIPPED. Deleting the
    // `if (!this.isConnected) return` before the revert makes it fire and this fail.
    let resolveLogout!: () => void;
    const logout = vi.fn(() => new Promise<void>((r) => (resolveLogout = r)));
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: "en-GB",
        venueLocale: "es-ES",
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
  });
});
