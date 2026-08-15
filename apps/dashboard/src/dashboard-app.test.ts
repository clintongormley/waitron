import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
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
 * itself calls `listStaff` (the session probe) and `logout`; the login screen it mounts calls
 * `getStaffRoster`/`login`, and the staff screen calls `listStaff`/`createPerson`. Each defaults to a
 * resolved value; a test overrides any with its own `vi.fn()`. Cast through `unknown` because the
 * shell touches only this method surface, mirroring `apps/till/src/till-app.test.ts`'s `stubApi`.
 */
function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(people),
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    createPerson: vi.fn().mockResolvedValue({ id: "p2" }),
    logout: vi.fn().mockResolvedValue(undefined),
    // The catalogue screen the nav mounts loads these on connect; resolve them so navigating to it
    // does not leave a stray rejection (a rejection is a finding — the suite runs pristine).
    listCatalogues: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    // The layout + receipt screens the nav mounts both load `getLayout` on connect; resolve it (and
    // stub the two writers they call on Guardar) so navigating to either leaves no stray rejection.
    getLayout: vi.fn().mockResolvedValue({ definition: [], receipt: {} }),
    putLayout: vi.fn().mockResolvedValue(undefined),
    putReceipt: vi.fn().mockResolvedValue(undefined),
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
    ...overrides,
  } as unknown as DashboardApi;
}

/** Drains the microtask queue (settling the awaited probe/logout promises) then Lit's render. */
async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const login = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-login-screen");
const staff = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-staff-screen");
const catalogue = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-catalogue-screen");
const layout = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-layout-screen");
const receipt = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-receipt-screen");
const roster = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-roster-screen");
const approvals = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-approvals-screen");
const plannedActual = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-planned-actual-screen");
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
const navRoster = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-roster]");
const navApprovals = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-approvals]");
const navPlannedActual = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-planned-actual]");

/** The seven logged-in screen tags — exactly one is mounted at a time. */
const SCREEN_TAGS = [
  "dashboard-staff-screen",
  "dashboard-catalogue-screen",
  "dashboard-layout-screen",
  "dashboard-receipt-screen",
  "dashboard-roster-screen",
  "dashboard-approvals-screen",
  "dashboard-planned-actual-screen",
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

afterEach(cleanupWidgets);

describe("dashboard-app", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-app")).toBe(DashboardApp);
  });

  it("shows login when no session, staff after logged-in", async () => {
    const api = stubApi({
      listStaff: vi.fn().mockRejectedValue({ code: "management_session.required" }),
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

  it("starts on staff when a session already exists", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(staff(el)).toBeTruthy();
    expect(login(el)).toBeNull();
  });

  it("treats ANY probe rejection as not-logged-in, never an unhandled rejection", async () => {
    // The common case is the `management_session.required`/401 reject, but the probe catches
    // EVERYTHING so a stray/network rejection still lands on login rather than escaping unhandled
    // (the whole suite runs with pristine output, which pins that). A bare Error carries no `code`.
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue(new Error("network down")) });
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
      listStaff: vi.fn().mockRejectedValue({ code: "management_session.required" }),
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
      listStaff: vi.fn().mockRejectedValue({ code: "management_session.required" }),
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

  // The logged-in shell now switches between SEVEN screens (staff / catalogue / layout / receipt /
  // roster / approvals / planned-actual). Roster ("Turnos"), approvals ("Aprobaciones") and
  // planned-actual ("Previsto vs real") each have their own dedicated nav test above, so this test
  // walks the remaining four faces. Exactly one screen — and exactly one <h1> (each screen owns its
  // own; the shell adds none) — shows at a time.
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
      listStaff: vi.fn().mockRejectedValue({ code: "management_session.required" }),
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
