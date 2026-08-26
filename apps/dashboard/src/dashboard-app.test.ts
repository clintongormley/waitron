import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
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
    // The devices screen the nav mounts loads this on connect (listStations is already stubbed above);
    // resolve it so navigating to it leaves no stray rejection.
    listDevices: vi.fn().mockResolvedValue([]),
    // The printers screen the nav mounts loads these three on connect; resolve them so navigating to it
    // leaves no stray rejection.
    listAgents: vi.fn().mockResolvedValue([]),
    listPrinters: vi.fn().mockResolvedValue([]),
    listRecentJobs: vi.fn().mockResolvedValue([]),
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
const logoutBtn = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]");
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

  it("shows login when no session, manager staff screen after a manager logs in", async () => {
    // getMe rejects at boot (no session) then resolves as a MANAGER after login — the real shape: the
    // whoami 401s before login and resolves once the cookie is set.
    const api = stubApi({
      getMe: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.required" })
        .mockResolvedValue({ personId: "p1", role: "manager" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
    expect(staff(el)).toBeNull();

    emitLoggedIn(login(el)!);
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect(login(el)).toBeNull();
  });

  it("starts on the manager staff screen when a manager session already exists", async () => {
    // Default getMe resolves as a manager → the shell lands on the manager `staff` screen.
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect(mySchedule(el)).toBeNull();
    expect(login(el)).toBeNull();
  });

  it("a STAFF-role session opens on the self-service my-schedule screen, never the manager staff screen", async () => {
    // The whole point of the fast-follow: a staff person (empty permission set) resolves via role-blind
    // getMe and lands on the self-service view, not the manager screens. Proven by deletion: dropping
    // the `role === "staff" ? "my-schedule" : "staff"` branch in #applyMe lands them on `staff` instead.
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

    expect(staff(el)).toBeTruthy();
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

  it("logout: ends the session and returns to login (staff → login)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(staff(el)).toBeTruthy();

    logoutBtn(el)!.click();
    await flush(el);

    expect(api.logout).toHaveBeenCalledOnce();
    expect(login(el)).toBeTruthy();
    expect(staff(el)).toBeNull();
  });

  // The logged-in shell gains a nav between the staff and catalogue screens. It opens on staff (the
  // probe's landing), and the nav switches the mounted screen — exactly one shows at a time.
  it("navigates between the staff and catalogue screens", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    // Opens on staff, with both nav controls present.
    expect(staff(el)).toBeTruthy();
    expect(catalogue(el)).toBeNull();
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();

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

  // Roster ("Turnos"), approvals ("Aprobaciones"), planned-actual ("Previsto vs real"), purchases
  // ("Compras") and service-status ("Estados de servicio") each have their own dedicated nav test
  // above, so this test walks the remaining four faces (staff / catalogue / layout / receipt).
  // Exactly one screen — and exactly one <h1> (each screen owns its own; the shell adds none) — shows
  // at a time.
  it("navigates the four non-roster logged-in screens, one screen and one h1 at a time", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);

    // Opens on staff, with all four nav controls present.
    expect(mountedScreens(el)).toEqual(["dashboard-staff-screen"]);
    expect(countH1(el)).toBe(1);
    expect(navStaff(el)).toBeTruthy();
    expect(navCatalogue(el)).toBeTruthy();
    expect(navLayout(el)).toBeTruthy();
    expect(navReceipt(el)).toBeTruthy();

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

  it("does not show the nav on the login screen", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(login(el)).toBeTruthy();
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
    const rosterField = login(el)!.shadowRoot!.querySelector(".field")!;
    expect(rosterField.textContent).toContain(t("login.roster", "en-GB")); // "User"
    expect(rosterField.textContent).not.toContain(t("login.roster", "es-ES")); // not "Usuario"
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
    expect(staff(el)).toBeTruthy();
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
    expect(staff(el)).toBeTruthy();
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
    expect(staff(el)).toBeTruthy();
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
